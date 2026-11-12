import { notFound, redirect } from 'next/navigation'
import { and, desc, eq, gte, inArray, isNotNull, isNull } from 'drizzle-orm'
import { computeUnblockStats } from '@/lib/brief/early-warnings'
import { db, schema } from '@/lib/db/client'
import { HttpError, requireMembership } from '@/lib/auth/guards'
import { getVisibleScope } from '@/lib/auth/scope'
import BlockersClient from './client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Unified Blockers view — every active blocker in the org plus the
 * just-resolved ones from the last 7 days. Designed so a manager can sit
 * down for 5 minutes once a day and clear the queue.
 */
export default async function BlockersPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId: string }>
  searchParams: Promise<{ open?: string }>
}) {
  const { orgId: raw } = await params
  // `?open=<breakId>` opens that blocker's resolver straight away (used by the demo walkthrough).
  const openParam = Number((await searchParams).open)
  const initialOpenId = Number.isInteger(openParam) && openParam > 0 ? openParam : null
  const orgId = Number(raw)
  if (!Number.isInteger(orgId)) notFound()

  let viewer
  try {
    // Only managers/admins reach /org/* (the layout redirects plain members to
    // their dashboard). This is a manager surface, so it must respect the
    // viewer's visible scope — NOT show every blocker (incl. reasons) org-wide.
    viewer = await requireMembership(orgId, 'manager')
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) redirect('/')
    if (err instanceof HttpError && err.status === 403) redirect(`/org/${orgId}`)
    throw err
  }
  const scope = await getVisibleScope(orgId, {
    userId: viewer.session.appUserId,
    membershipId: viewer.membership.id,
    role: viewer.membership.role as 'admin' | 'manager' | 'lead' | 'member',
  })
  const scopeFilter = scope.isAdminScope ? undefined : inArray(schema.breaks.userId, Array.from(scope.userIds))

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // Pull active + recently-resolved blockers in two queries, then merge.
  const [active, resolved] = await Promise.all([
    db
      .select({
        b: schema.breaks,
        u: schema.users,
      })
      .from(schema.breaks)
      .innerJoin(schema.users, eq(schema.breaks.userId, schema.users.id))
      .where(
        and(
          eq(schema.breaks.orgId, orgId),
          eq(schema.breaks.category, 'blocked'),
          isNull(schema.breaks.endedAt),
          scopeFilter,
        ),
      )
      .orderBy(desc(schema.breaks.startedAt)),
    db
      .select({
        b: schema.breaks,
        u: schema.users,
      })
      .from(schema.breaks)
      .innerJoin(schema.users, eq(schema.breaks.userId, schema.users.id))
      .where(
        and(
          eq(schema.breaks.orgId, orgId),
          eq(schema.breaks.category, 'blocked'),
          isNotNull(schema.breaks.endedAt),
          gte(schema.breaks.endedAt, weekAgo),
          scopeFilter,
        ),
      )
      .orderBy(desc(schema.breaks.endedAt))
      .limit(40),
  ])

  // Time-to-unblock over the last 30 days, from resolved blocker records only.
  const STATS_WINDOW_DAYS = 30
  const statsSince = new Date(weekAgo.getTime() - (STATS_WINDOW_DAYS - 7) * 24 * 60 * 60 * 1000)
  const statsRows = await db
    .select({
      userId: schema.breaks.userId,
      startedAt: schema.breaks.startedAt,
      endedAt: schema.breaks.endedAt,
      resolvedByUserId: schema.breaks.resolvedByUserId,
    })
    .from(schema.breaks)
    .where(
      and(
        eq(schema.breaks.orgId, orgId),
        eq(schema.breaks.category, 'blocked'),
        isNotNull(schema.breaks.endedAt),
        gte(schema.breaks.endedAt, statsSince),
        scopeFilter,
      ),
    )
  const unblockStats = computeUnblockStats(statsRows, STATS_WINDOW_DAYS)

  // Hydrate waitingOnUser so the card can render avatar + name.
  const waitingOnIds = Array.from(
    new Set(
      [...active, ...resolved]
        .map((r) => r.b.waitingOnUserId)
        .filter((id): id is number => id != null),
    ),
  )
  const waitingOnUsers = waitingOnIds.length
    ? await db
        .select({
          id: schema.users.id,
          login: schema.users.login,
          name: schema.users.name,
          characterKey: schema.users.characterKey,
        })
        .from(schema.users)
        .where(inArray(schema.users.id, waitingOnIds))
    : []
  const waitingOnMap = new Map(waitingOnUsers.map((u) => [u.id, u]))

  const serialise = (row: { b: typeof schema.breaks.$inferSelect; u: typeof schema.users.$inferSelect }) => ({
    id: row.b.id,
    startedAt: row.b.startedAt.toISOString(),
    endedAt: row.b.endedAt?.toISOString() ?? null,
    minutesElapsed: Math.max(
      0,
      Math.round(
        ((row.b.endedAt ?? new Date()).getTime() - row.b.startedAt.getTime()) / 60_000,
      ),
    ),
    reason: row.b.reason,
    waitingOnExternal: row.b.waitingOnExternal,
    waitingOnUser: row.b.waitingOnUserId
      ? waitingOnMap.get(row.b.waitingOnUserId) ?? null
      : null,
    resolutionType: row.b.resolutionType ?? null,
    resolutionNote: row.b.resolutionNote ?? null,
    blockedUser: {
      id: row.u.id,
      login: row.u.login,
      name: row.u.name,
      characterKey: row.u.characterKey,
    },
  })

  return (
    <BlockersClient
      initialOpenId={initialOpenId}
      stats={unblockStats}
      orgId={orgId}
      active={active.map(serialise)}
      resolved={resolved.map(serialise)}
    />
  )
}
