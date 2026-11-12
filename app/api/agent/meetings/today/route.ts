import { NextResponse } from 'next/server'
import { and, eq, gte, lt } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { authenticateAgent } from '@/lib/agent/auth'
import { checkLimit, rateLimitHeaders } from '@/lib/agent/rate-limit'
import { orgTimezone, resolveAgentOrg } from '@/lib/agent/org'
import { dayBoundsInTz } from '@/lib/time/tz'

export const runtime = 'nodejs'

/**
 * Today's meetings list for the agent's calendar panel.
 *
 * Returns every meeting on the user's calendar from midnight local to
 * midnight + 24h. The agent renders them in a list with conference URLs
 * (so the user can click "Join" without a browser context-switch) and uses
 * the start times to schedule pre-meeting OS notifications ("Standup in 5
 * minutes").
 */
export async function GET(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const limit = checkLimit('heartbeat', agent.token.id)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate limited' },
      { status: 429, headers: rateLimitHeaders(limit) },
    )
  }

  const now = new Date()
  // Org-timezone day, not server-local (UTC) — see /api/agent/day.
  const org = await resolveAgentOrg(agent.user.id)
  const { startIso: todayMidnight, endIso: tomorrowMidnight } = dayBoundsInTz(
    now,
    await orgTimezone(org.ok ? org.orgId : null),
  )

  const rows = await db
    .select({
      id: schema.meetings.id,
      title: schema.meetings.title,
      startAt: schema.meetings.startAt,
      endAt: schema.meetings.endAt,
      conferenceUrl: schema.meetings.conferenceUrl,
      rsvpStatus: schema.meetings.rsvpStatus,
    })
    .from(schema.meetings)
    .where(
      and(
        eq(schema.meetings.userId, agent.user.id),
        gte(schema.meetings.startAt, todayMidnight),
        lt(schema.meetings.startAt, tomorrowMidnight),
      ),
    )
    .orderBy(schema.meetings.startAt)

  return NextResponse.json(
    {
      meetings: rows.map((m) => ({
        id: m.id,
        title: m.title,
        startAt: m.startAt.toISOString(),
        endAt: m.endAt.toISOString(),
        conferenceUrl: m.conferenceUrl,
        rsvpStatus: m.rsvpStatus,
        isLive: now >= m.startAt && now <= m.endAt,
        isPast: now > m.endAt,
      })),
    },
    { headers: rateLimitHeaders(limit) },
  )
}
