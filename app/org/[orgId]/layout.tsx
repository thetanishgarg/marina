import { notFound, redirect } from 'next/navigation'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { auth, signOut as serverSignOut } from '@/auth'
import { db, schema } from '@/lib/db/client'
import { HttpError, listMembershipsForCurrentUser, requireMembership, roleAtLeast } from '@/lib/auth/guards'
import { capabilitiesFor } from '@/lib/auth/capabilities'
import { getVisibleScope } from '@/lib/auth/scope'
import { OrgSidebar } from '@/components/org-sidebar'
import { MobileNav } from '@/components/mobile-nav'
import { AnnouncementBanner } from '@/components/announcement-banner'
import { SampleDataBanner } from '@/components/sample-data-banner'
import { isSampleOrgName } from '@/lib/sample-org'

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ orgId: string }>
}) {
  const { orgId: raw } = await params
  const orgId = Number(raw)
  if (!Number.isInteger(orgId)) notFound()

  let viewer
  try {
    viewer = await requireMembership(orgId, 'member')
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) redirect('/')
    if (err instanceof HttpError && err.status === 403) redirect('/onboarding')
    throw err
  }

  // Only managers + owners reach any /org/* page. Plain members go to their console.
  if (!roleAtLeast(viewer.membership.role, 'manager')) {
    redirect('/dashboard')
  }

  const session = await auth()
  if (!session?.appUserId || !session.login) redirect('/')
  const me = await db.query.users.findFirst({ where: eq(schema.users.id, session.appUserId) })
  if (!me) redirect('/')

  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) })
  if (!org) notFound()

  // Pending leave count for the sidebar badge — scoped to the people this
  // viewer can actually act on. A manager sees the count for their team only;
  // an admin / HR (view_all_data) sees the whole org. Without this, every
  // manager saw the org-wide number.
  const scope = await getVisibleScope(orgId, {
    userId: session.appUserId,
    membershipId: viewer.membership.id,
    role: viewer.membership.role as 'admin' | 'manager' | 'lead' | 'member',
  })
  const pendingRows = await db
    .select({ id: schema.leaveRequests.id })
    .from(schema.leaveRequests)
    .where(
      and(
        eq(schema.leaveRequests.orgId, orgId),
        eq(schema.leaveRequests.status, 'pending'),
        scope.isAdminScope
          ? undefined
          : inArray(schema.leaveRequests.userId, Array.from(scope.userIds)),
      ),
    )
  const pendingLeaveCount = pendingRows.length

  async function signOutAction() {
    'use server'
    await serverSignOut({ redirectTo: '/' })
  }

  // Every workspace this user belongs to — powers the sidebar org switcher.
  const myMemberships = await listMembershipsForCurrentUser()
  const orgs = myMemberships.map((m) => ({
    id: m.orgId,
    name: m.org.name,
    role: m.role,
    logoUrl: (m.org as { logoUrl?: string | null }).logoUrl ?? null,
  }))

  // All teams in this workspace — shown in the sidebar for quick access. Managers
  // only ever reach /org/* so showing team names here is safe; the teams page
  // itself scopes any sensitive detail.
  const orgTeams = await db
    .select({ id: schema.teams.id, name: schema.teams.name, color: schema.teams.color })
    .from(schema.teams)
    .where(eq(schema.teams.orgId, orgId))
    .orderBy(schema.teams.name)

  // The manager's OWN open shift + break — powers the sidebar day-controls
  // (punch / break / blocked / leave) so they can act from any org page.
  const managerShiftRows = await db
    .select({ punchedInAt: schema.shifts.punchedInAt })
    .from(schema.shifts)
    .where(and(eq(schema.shifts.userId, session.appUserId), isNull(schema.shifts.punchedOutAt)))
    .orderBy(desc(schema.shifts.punchedInAt))
    .limit(1)
  const managerActiveSince = managerShiftRows[0]?.punchedInAt.toISOString() ?? null
  const managerBreakRow = await db.query.breaks.findFirst({
    where: and(eq(schema.breaks.userId, session.appUserId), isNull(schema.breaks.endedAt)),
  })
  const managerActiveBreak = managerBreakRow
    ? { id: managerBreakRow.id, startedAt: managerBreakRow.startedAt.toISOString(), reason: managerBreakRow.reason, category: managerBreakRow.category }
    : null

  return (
    <div className="app-shell">
      <OrgSidebar
        orgId={orgId}
        orgName={org.name}
        orgLogoUrl={(org as { logoUrl?: string | null }).logoUrl ?? null}
        userLogin={session.login}
        characterKey={me.characterKey}
        userName={me.name}
        userAvatarUrl={me.image ?? me.avatarUrl ?? null}
        role={viewer.membership.role}
        caps={[
          ...capabilitiesFor(
            viewer.membership.role,
            (viewer.membership as { extraCaps?: string[] }).extraCaps ?? [],
          ),
        ]}
        orgs={orgs}
        teams={orgTeams}
        pendingLeaveCount={pendingLeaveCount}
        activeSince={managerActiveSince}
        activeBreak={managerActiveBreak}
        signOutAction={signOutAction}
      />
      <main className="bg-[var(--m-bg)] min-w-0">
        {isSampleOrgName(org.name) && <SampleDataBanner />}
        <MobileNav orgName={org.name} />
        <AnnouncementBanner viewerRole={viewer.membership.role as 'admin' | 'manager' | 'lead' | 'member'} />
        <div className="px-4 pt-4 pb-10 sm:px-8 sm:pt-8 max-w-[1400px] mx-auto fade-in">
          {children}
        </div>
      </main>
    </div>
  )
}
