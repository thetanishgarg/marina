import { isProviderName } from '@/lib/ai/registry'
import { NextResponse } from 'next/server'
import { and, eq, gte, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { HttpError, ensureScopeMembership, requireScope } from '@/lib/auth/guards'
import { buildNarrativeMessages, parseNarrative } from '@/lib/ai/narrative-prompt'
import { generateWithFallback } from '@/lib/ai/registry'
import { canSpend, estimateCostCents, recordSpend } from '@/lib/ai/budget'

export const runtime = 'nodejs'

export async function POST(
  req: Request,
  ctx: { params: Promise<{ orgId: string; membershipId: string }> }
) {
  const { orgId: orgIdRaw, membershipId: midRaw } = await ctx.params
  const orgId = Number(orgIdRaw)
  const membershipId = Number(midRaw)
  if (!Number.isInteger(orgId) || !Number.isInteger(membershipId)) {
    return NextResponse.json({ error: 'invalid ids' }, { status: 400 })
  }

  const url = new URL(req.url)
  const providerParam = url.searchParams.get('provider')
  const preferred = isProviderName(providerParam) ? providerParam : undefined

  try {
    const { session, scope } = await requireScope(orgId, 'manager')

    const target = await db.query.memberships.findFirst({
      where: and(
        eq(schema.memberships.id, membershipId),
        eq(schema.memberships.orgId, orgId),
        isNull(schema.memberships.endedAt),
      ),
    })
    if (!target) return NextResponse.json({ error: 'membership not found' }, { status: 404 })
    // RBAC scope: only generate for people the manager actually manages.
    ensureScopeMembership(scope, membershipId)

    // AI budget gate — refuse if the org has exhausted its monthly cap.
    const decision = await canSpend(orgId, 'narrative')
    if (!decision.allowed) {
      return NextResponse.json(
        { error: 'AI budget for this workspace is exhausted for the month.' },
        { status: 402 },
      )
    }

    const user = await db.query.users.findFirst({ where: eq(schema.users.id, target.userId) })
    if (!user) return NextResponse.json({ error: 'user missing' }, { status: 404 })

    const periodEnd = new Date()
    const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000)

    const events = await db
      .select()
      .from(schema.githubEvents)
      .where(and(eq(schema.githubEvents.userId, user.id), gte(schema.githubEvents.occurredAt, periodStart)))

    const messages = buildNarrativeMessages({
      userLogin: user.login,
      periodStart,
      periodEnd,
      events,
    })

    const result = await generateWithFallback(
      messages,
      { responseFormat: 'json', temperature: 0.5 },
      preferred
    )
    const parsed = parseNarrative(result.text)

    // Record spend so the per-org AI ledger stays accurate.
    const inputTokens = Math.ceil(JSON.stringify(messages).length / 4)
    const outputTokens = Math.ceil(result.text.length / 4)
    recordSpend({
      orgId,
      userId: session.appUserId,
      kind: 'narrative',
      provider: result.provider,
      model: result.model,
      inputTokens,
      outputTokens,
      costCents: estimateCostCents({ kind: 'narrative', provider: result.provider, model: result.model, inputTokens, outputTokens }),
    })

    const [saved] = await db
      .insert(schema.narratives)
      .values({
        userId: user.id,
        periodStart,
        periodEnd,
        body: parsed.body,
        signal: parsed.signal,
        blockers: parsed.blockers,
        provider: result.provider,
        model: result.model,
      })
      .returning()

    return NextResponse.json({ ok: true, narrative: saved })
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('member narrative failed', err)
    return NextResponse.json({ error: 'internal', message: String(err) }, { status: 500 })
  }
}
