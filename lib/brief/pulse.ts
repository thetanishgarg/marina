import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'

/**
 * Channel-agnostic "team pulse" — the structured form of what `/marina pulse`
 * renders as text. Surfaces (Slack App Home, the daily brief, the web brief)
 * read this and render it their own way. Part of the surface-abstraction seam:
 * domain data here, presentation in each adapter.
 */
export type TeamPulse = {
  total: number
  onShift: number
  blocked: number
  blockers: { breakId: number; userId: number; name: string; sinceMin: number; waitingOn: string }[]
}

export async function getTeamPulse(orgId: number): Promise<TeamPulse> {
  const members = await db
    .select({ id: schema.memberships.userId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, orgId), isNull(schema.memberships.endedAt)))

  const blockerRows = await db
    .select({ b: schema.breaks, u: schema.users })
    .from(schema.breaks)
    .innerJoin(schema.users, eq(schema.breaks.userId, schema.users.id))
    .where(
      and(
        eq(schema.breaks.orgId, orgId),
        eq(schema.breaks.category, 'blocked'),
        isNull(schema.breaks.endedAt),
      ),
    )

  const openShifts = await db
    .select({ id: schema.shifts.id })
    .from(schema.shifts)
    .where(and(eq(schema.shifts.orgId, orgId), isNull(schema.shifts.punchedOutAt)))

  const blockers = blockerRows.map(({ b, u }) => ({
    breakId: b.id,
    userId: u.id,
    name: u.name ?? `@${u.login}`,
    sinceMin: Math.floor((Date.now() - new Date(b.startedAt).getTime()) / 60000),
    waitingOn: b.waitingOnExternal ?? 'a teammate',
  }))

  return {
    total: members.length,
    onShift: openShifts.length,
    blocked: blockerRows.length,
    blockers,
  }
}
