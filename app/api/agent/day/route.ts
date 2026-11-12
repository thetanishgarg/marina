import { NextResponse } from 'next/server'
import { and, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { authenticateAgent } from '@/lib/agent/auth'
import { checkLimit, rateLimitHeaders } from '@/lib/agent/rate-limit'
import { orgTimezone, resolveAgentOrg } from '@/lib/agent/org'
import { dayBoundsInTz } from '@/lib/time/tz'

export const runtime = 'nodejs'

/**
 * Agent-side "Today" panel feed.
 *
 * Identical shape to the web's /api/me/day-snapshot, but bearer-token auth
 * instead of session cookie. Both endpoints share the same return contract
 * so the desktop "Today" panel can render the exact same numbers as the
 * web's "Your day" card — no surprises if the user flips between surfaces.
 *
 * The agent polls this every 60s and renders:
 *   - The big productivity %
 *   - Headline ("On a roll" / "Steady" / etc.)
 *   - Deliverables shipped today
 *   - Meetings remaining + next-meeting clock
 *   - "End break" or "Take a break" button depending on activeBreak
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

  const userId = agent.user.id
  const now = new Date()
  // Day boundaries in the ORG's timezone — the server runs in UTC, so
  // server-local midnight was 5:30 AM IST and early meetings fell off "today".
  const org = await resolveAgentOrg(userId)
  const { startIso: todayMidnight } = dayBoundsInTz(now, await orgTimezone(org.ok ? org.orgId : null))

  const activeShift = await db.query.shifts.findFirst({
    where: and(eq(schema.shifts.userId, userId), isNull(schema.shifts.punchedOutAt)),
    orderBy: [desc(schema.shifts.punchedInAt)],
  })

  if (!activeShift) {
    return NextResponse.json(
      {
        punchedIn: false,
        shiftStartedAt: null,
        productivity: 0,
        focusMinutes: 0,
        totalShiftMinutes: 0,
        deliverablesToday: 0,
        meetingsRemainingToday: 0,
        nextMeetingAt: null,
        nextMeetingTitle: null,
        activeBreak: null,
      },
      { headers: rateLimitHeaders(limit) },
    )
  }

  const [activitySum, activeBreak, deliverablesCount, meetings] = await Promise.all([
    db
      .select({
        focus: sql<number>`COALESCE(SUM(${schema.localActivity.activeSeconds}), 0)`,
        idle: sql<number>`COALESCE(SUM(${schema.localActivity.idleSeconds}), 0)`,
      })
      .from(schema.localActivity)
      .where(
        and(
          eq(schema.localActivity.userId, userId),
          gte(schema.localActivity.windowStart, activeShift.punchedInAt),
        ),
      ),
    db.query.breaks.findFirst({
      where: and(eq(schema.breaks.userId, userId), isNull(schema.breaks.endedAt)),
      orderBy: [desc(schema.breaks.startedAt)],
    }),
    db
      .select({ n: count() })
      .from(schema.deliverables)
      .where(
        and(
          eq(schema.deliverables.userId, userId),
          gte(schema.deliverables.completedAt, todayMidnight),
        ),
      ),
    db
      .select({
        id: schema.meetings.id,
        title: schema.meetings.title,
        startAt: schema.meetings.startAt,
        endAt: schema.meetings.endAt,
      })
      .from(schema.meetings)
      .where(
        and(
          eq(schema.meetings.userId, userId),
          gte(schema.meetings.startAt, todayMidnight),
          lt(schema.meetings.startAt, new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000)),
        ),
      )
      .orderBy(schema.meetings.startAt),
  ])

  const focusSec = Number(activitySum[0]?.focus ?? 0)
  const idleSec = Number(activitySum[0]?.idle ?? 0)
  const totalSec = focusSec + idleSec
  const productivity = totalSec > 0 ? Math.round((focusSec / totalSec) * 100) : 0
  const upcoming = meetings.filter((m) => m.endAt.getTime() > now.getTime())
  const next = upcoming[0] ?? null

  return NextResponse.json(
    {
      punchedIn: true,
      shiftStartedAt: activeShift.punchedInAt.toISOString(),
      productivity,
      focusMinutes: Math.round(focusSec / 60),
      totalShiftMinutes: Math.round(totalSec / 60),
      deliverablesToday: Number(deliverablesCount[0]?.n ?? 0),
      meetingsRemainingToday: upcoming.length,
      nextMeetingAt: next?.startAt.toISOString() ?? null,
      nextMeetingTitle: next?.title ?? null,
      activeBreak: activeBreak
        ? {
            id: activeBreak.id,
            reason: activeBreak.reason,
            category: activeBreak.category,
            startedAt: activeBreak.startedAt.toISOString(),
            minutesAgo: Math.max(0, Math.round((now.getTime() - activeBreak.startedAt.getTime()) / 60_000)),
          }
        : null,
    },
    { headers: rateLimitHeaders(limit) },
  )
}
