import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { authenticateAgent } from '@/lib/agent/auth'
import { resolveAgentOrg } from '@/lib/agent/org'
import { notify } from '@/lib/notify/send'
import type { BreakCategory } from '@/lib/db/schema'

export const runtime = 'nodejs'

const REASON_MAX = 500
const EXTERNAL_MAX = 120
const VALID_CATEGORIES: BreakCategory[] = ['focus', 'meeting', 'blocked', 'lunch', 'errand', 'personal', 'other']

function coerceCategory(raw: unknown): BreakCategory {
  return VALID_CATEGORIES.includes(raw as BreakCategory) ? (raw as BreakCategory) : 'other'
}

function parseExpectedEnd(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !raw) return undefined
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return undefined
  const now = Date.now()
  const t = d.getTime()
  if (t < now - 60_000) return undefined
  if (t > now + 12 * 60 * 60 * 1000) return new Date(now + 12 * 60 * 60 * 1000)
  return d
}

/** Agent-authenticated pause-start. Returns the new pause row. */
export async function POST(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: {
    reason?: string
    orgId?: number
    category?: string
    waitingOnUserId?: number | null
    waitingOnExternal?: string | null
    expectedEndAt?: string | null
  } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const reason = (body.reason ?? '').toString().trim().slice(0, REASON_MAX)
  const category = coerceCategory(body.category)
  if (reason.length === 0 && category !== 'blocked') {
    return NextResponse.json({ error: 'reason required' }, { status: 400 })
  }

  // Resolve org. A supplied orgId MUST be one this agent's user belongs to —
  // never trust the body to attribute a break (and manager notification) to an
  // arbitrary org. Falls back to the user's first membership when omitted.
  // An orgId the user has LEFT is treated as stale (old agents cached it from
  // the heartbeat) and we fall back to their current org instead of a 403.
  let org = await resolveAgentOrg(agent.user.id, body.orgId)
  if (!org.ok && org.reason === 'forbidden') org = await resolveAgentOrg(agent.user.id)
  const orgId: number | null = org.ok ? org.orgId : null

  let waitingOnUserId: number | null = null
  if (category === 'blocked' && typeof body.waitingOnUserId === 'number' && orgId) {
    const peer = await db.query.memberships.findFirst({
      where: and(
        eq(schema.memberships.orgId, orgId),
        eq(schema.memberships.userId, body.waitingOnUserId),
        isNull(schema.memberships.endedAt),
      ),
    })
    if (peer) waitingOnUserId = body.waitingOnUserId
  }
  const waitingOnExternal =
    category === 'blocked' && typeof body.waitingOnExternal === 'string'
      ? body.waitingOnExternal.trim().slice(0, EXTERNAL_MAX) || null
      : null
  const expectedEndAt = parseExpectedEnd(body.expectedEndAt)

  // End any existing ongoing pause — at most one ongoing at a time.
  await db
    .update(schema.breaks)
    .set({ endedAt: new Date() })
    .where(and(eq(schema.breaks.userId, agent.user.id), isNull(schema.breaks.endedAt)))

  const [row] = await db
    .insert(schema.breaks)
    .values({
      userId: agent.user.id,
      orgId: orgId ?? undefined,
      reason: reason || `Blocked${waitingOnUserId ? ' — waiting on a teammate' : waitingOnExternal ? ` — waiting on ${waitingOnExternal}` : ''}`,
      category,
      waitingOnUserId,
      waitingOnExternal,
      expectedEndAt,
    })
    .returning()

  // Fire the standard `state.blocked` notification so managers see this on
  // their dashboard / Slack / agent the same way they would when an
  // employee marked themselves blocked from the web app. Previously the
  // agent path silently inserted the row and the team only found out via
  // the periodic poll — now it propagates immediately.
  if (category === 'blocked' && orgId) {
    notify({
      kind: 'state.blocked',
      orgId,
      actorUserId: agent.user.id,
      userName: agent.user.name ?? `@${agent.user.login}`,
      userLogin: agent.user.login,
      reason: row.reason,
    })
  }

  return NextResponse.json({
    ok: true,
    break: {
      id: row.id,
      startedAt: row.startedAt.toISOString(),
      endedAt: null,
      reason: row.reason,
      category: row.category,
      waitingOnUserId: row.waitingOnUserId,
      waitingOnExternal: row.waitingOnExternal,
      expectedEndAt: row.expectedEndAt?.toISOString() ?? null,
    },
  })
}
