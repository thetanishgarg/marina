import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { authenticateAgent } from '@/lib/agent/auth'
import { checkLimit, rateLimitHeaders } from '@/lib/agent/rate-limit'
import { resolveAgentOrg } from '@/lib/agent/org'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const limit = checkLimit('heartbeat', agent.token.id)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate limited' },
      { status: 429, headers: rateLimitHeaders(limit) }
    )
  }

  let body: { agentVersion?: string } = {}
  try {
    body = (await req.json().catch(() => ({}))) ?? {}
  } catch {
    body = {}
  }
  if (body.agentVersion && body.agentVersion !== agent.token.agentVersion) {
    void db
      .update(schema.agentTokens)
      .set({ agentVersion: String(body.agentVersion).slice(0, 32) })
      .where(eq(schema.agentTokens.id, agent.token.id))
      .catch((err) => console.error('agentVersion update failed', err))
  }

  const [settings, activeBreak, org, activeShift] = await Promise.all([
    db.query.userSettings.findFirst({
      where: eq(schema.userSettings.userId, agent.user.id),
    }),
    db.query.breaks.findFirst({
      where: and(eq(schema.breaks.userId, agent.user.id), isNull(schema.breaks.endedAt)),
    }),
    // Active memberships only — a stale org here made every agent break 403.
    resolveAgentOrg(agent.user.id),
    db.query.shifts.findFirst({
      where: and(eq(schema.shifts.userId, agent.user.id), isNull(schema.shifts.punchedOutAt)),
    }),
  ])

  return NextResponse.json(
    {
      ok: true,
      pausedAt: settings?.trackingPausedAt?.toISOString() ?? null,
      windowTitlesEnabled: !!settings?.windowTitlesEnabled,
      sampleIntervalSeconds: settings?.sampleIntervalSeconds ?? 30,
      flushIntervalSeconds: settings?.flushIntervalSeconds ?? 300,
      policyVersion: process.env.MARINA_POLICY_VERSION ?? 'v1',
      primaryOrgId: org.ok ? org.orgId : null,
      orgIds: org.ok ? org.activeOrgIds : [],
      activeBreak: activeBreak
        ? {
            id: activeBreak.id,
            startedAt: activeBreak.startedAt.toISOString(),
            reason: activeBreak.reason,
            category: activeBreak.category,
          }
        : null,
      activeShift: activeShift
        ? {
            id: activeShift.id,
            punchedInAt: activeShift.punchedInAt.toISOString(),
          }
        : null,
    },
    { headers: rateLimitHeaders(limit) }
  )
}
