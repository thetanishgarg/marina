import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { HttpError, ensureScopeUser, requireScope } from '@/lib/auth/guards'
import { buildBlockerContext, diagnoseBlocker } from '@/lib/ai/blocker-resolver'
import { canSpend, estimateCostCents, recordSpend } from '@/lib/ai/budget'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Blocker Resolver v2. One long-context model call (Gemini first) over the
 * blocked person's PRs, reviews, standups, blocker thread, calendars and
 * leave, returning the likely cause, who can unblock them, and a drafted
 * message — each with source ids that were verified server-side.
 *
 * Read-only: nothing is sent or changed. The manager decides what to do with
 * the draft in the modal.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ orgId: string; breakId: string }> },
) {
  const { orgId: rawOrg, breakId: rawBreak } = await ctx.params
  const orgId = Number(rawOrg)
  const breakId = Number(rawBreak)
  if (!Number.isInteger(orgId) || !Number.isInteger(breakId)) {
    return NextResponse.json({ error: 'invalid ids' }, { status: 400 })
  }

  try {
    const { session, scope } = await requireScope(orgId, 'manager')

    const row = await db
      .select({ userId: schema.breaks.userId, category: schema.breaks.category })
      .from(schema.breaks)
      .where(and(eq(schema.breaks.id, breakId), eq(schema.breaks.orgId, orgId)))
      .limit(1)
      .then((rows) => rows[0])
    if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
    // RBAC scope: only diagnose blockers of people you manage.
    ensureScopeUser(scope, row.userId)
    if (row.category !== 'blocked') return NextResponse.json({ error: 'not a blocker' }, { status: 400 })

    const decision = await canSpend(orgId, 'blocker_resolver')
    if (!decision.allowed) {
      return NextResponse.json(
        { error: 'AI budget for this workspace is exhausted for the month. Raise the limit in Settings → Billing.' },
        { status: 402 },
      )
    }

    const context = await buildBlockerContext({ orgId, breakId, visibleUserIds: scope.userIds })
    if (!context) return NextResponse.json({ error: 'not found' }, { status: 404 })

    const result = await diagnoseBlocker(context)

    const inputTokens = Math.ceil(result.contextBytes / 4)
    const outputTokens = Math.ceil(
      ((result.likelyCause?.text.length ?? 0) + (result.unblocker?.why.length ?? 0) + (result.draftMessage?.text.length ?? 0)) / 4,
    )
    recordSpend({
      orgId,
      userId: session.appUserId,
      kind: 'blocker_resolver',
      provider: result.provider,
      model: result.model,
      inputTokens,
      outputTokens,
      costCents: estimateCostCents({ kind: 'blocker_resolver', provider: result.provider, model: result.model, inputTokens, outputTokens }),
    })

    return NextResponse.json({
      blockedName: context.blockedName,
      likelyCause: result.likelyCause,
      unblocker: result.unblocker,
      draftMessage: result.draftMessage,
      missing: result.missing,
      confidence: result.confidence,
      sources: result.sources,
      dropped: result.dropped,
      provider: result.provider,
      model: result.model,
      usage: { contextBytes: result.contextBytes },
    })
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[blocker-diagnose] failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not diagnose this blocker right now. Try again in a moment.' }, { status: 500 })
  }
}
