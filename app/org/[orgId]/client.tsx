'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CharacterAvatar } from '@/components/character-avatar'
import { getCharacter } from '@/lib/characters/data'
import { useToast } from '@/components/toast'
import { MemberDetailModal } from './member-detail-modal'
import { MeetingsPanel } from '@/components/meetings-panel'
import { CelebrationsWidget } from '@/components/celebrations-widget'
import { BlockerResolver } from '@/components/blocker-resolver'
import { ScheduleMeetingDialog } from '@/components/schedule-meeting-dialog'
import { TeamChat } from '@/components/team-chat'
import { MarinaBrief, marinaBriefEvidence, marinaBriefLine, type BriefWarning } from '@/components/marina-brief'
import { stateLabel } from '@/lib/engine/state-labels'
import { ComingSoonAgent } from '@/components/coming-soon-agent'
import { IntegrationsPanel } from '@/components/integrations-panel'
import { NextMeetingBanner } from '@/components/next-meeting-banner'
import type { MeetingCard } from '@/lib/meetings/upcoming'
import { DashboardTour } from '@/components/dashboard-tour'

type Signal = 'High' | 'Steady' | 'Low' | 'Blocked'
type DailyState = 'High' | 'Steady' | 'Blocked' | 'Disengaged' | 'PossiblyDummying' | 'NoData'

type BreakCategory = 'focus' | 'meeting' | 'blocked' | 'lunch' | 'errand' | 'personal' | 'other'

type WaitingOn = { login: string; name: string | null; characterKey: string | null }

type OngoingBreak = {
  id: number
  reason: string
  startedAt: string
  category?: BreakCategory
  waitingOnUserId?: number | null
  waitingOnExternal?: string | null
  waitingOn?: WaitingOn | null
  expectedEndAt?: string | null
}

type MemberCard = {
  membershipId: number
  userId: number
  login: string
  name: string | null
  avatarUrl: string | null
  characterKey: string | null
  role: string
  teamIds: number[]
  hasGithub: boolean
  activity: {
    activeSeconds: number
    idleSeconds: number
    lockedSeconds: number
    topApp: string | null
    presence: 'active' | 'idle' | 'locked' | null
    paused: boolean
  }
  onLeaveToday: boolean
  ongoingBreak: OngoingBreak | null
  activeShift: { id: number; punchedInAt: string } | null
  dailyState: {
    state: DailyState
    reason: string
    outputCount: number
    focusWorkRatio: number
    staticIdleRuns: number
  } | null
  narrative: {
    body: string
    signal: Signal
    createdAt: string
  } | null
  recentDeliverable: { title: string; completedAt: string } | null
}

type Blocker = {
  breakId: number
  startedAt: string
  expectedEndAt: string | null
  reason: string
  blockedUser: { membershipId: number; login: string; name: string | null; characterKey: string | null }
  waitingOnUser?: WaitingOn | null
  waitingOnExternal?: string | null
  waitingOnYou: boolean
}

type SlackAlert = {
  membershipId: number
  userId: number
  login: string
  name: string | null
  characterKey: string | null
  minutes: number
  unproductiveCount: number
  totalCount: number
  topHint: string
  topCategory: string
}

type PendingLeave = {
  id: number
  startDate: string
  endDate: string
  reason: string
  createdAt: string
  user: { id: number; login: string; name: string | null; characterKey: string | null }
}

type RecentBreak = {
  id: number
  startedAt: string
  endedAt: string | null
  reason: string
  category?: BreakCategory
  user: { id: number; login: string; name: string | null; characterKey: string | null }
}

type Snapshot = {
  followupCount: number
  onLeaveCount: number
  activeCount: number
  waitingOnReview: number
  totalMembers: number
  blockerCount: number
  blockedOnYouCount: number
  /** Org-wide productivity 0–100, computed server-side. Shown as a KPI tile
   * at the top of the dashboard so HR has a one-glance health number. */
  orgProductivity: number | null
}

/**
 * Four-status taxonomy — every internal signal collapses to one of these.
 * Intuitive for a first-time HR or manager: is this person Working, Paused,
 * Blocked, or Off?
 *
 * Status colors are the single source of truth — pill, ribbon, badge, dot
 * all read from STATUS[s].color.
 */
type SimpleStatus = 'working' | 'paused' | 'blocked' | 'off'

const STATUS: Record<SimpleStatus, {
  label: string
  pill: string         // pill-* class
  fg: string           // tailwind text-* token for inline text
  ring: string         // tailwind bg-* for the ribbon active segment
  dot: string          // hex for the small status dot
}> = {
  working: { label: 'Working', pill: 'pill-good',   fg: 'text-emerald-700', ring: 'bg-emerald-500', dot: '#10b981' },
  paused:  { label: 'Paused',  pill: 'pill-slate',  fg: 'text-[var(--m-ink-2)]',   ring: 'bg-[var(--m-ink-4)]',   dot: '#94a3b8' },
  blocked: { label: 'Blocked', pill: 'pill-bad',    fg: 'text-rose-700',    ring: 'bg-rose-500',    dot: '#f43f5e' },
  off:     { label: 'Off',     pill: 'pill-slate',  fg: 'text-[var(--m-ink-3)]',   ring: 'bg-[var(--m-ink-5)]',   dot: '#cbd5e1' },
}

/** Derive a single status from all the signals on a member. Order matters. */
function deriveStatus(m: MemberCard): SimpleStatus {
  if (m.onLeaveToday) return 'off'
  if (m.ongoingBreak?.category === 'blocked') return 'blocked'
  if (m.ongoingBreak) return 'paused'
  if (!m.activeShift) return 'off'
  // On shift, no break, not blocked — let dailyState decide if they're actually working
  const s = m.dailyState?.state
  if (s === 'High' || s === 'Steady') return 'working'
  if (s === 'Blocked') return 'blocked'
  if (s === 'Disengaged' || s === 'PossiblyDummying') return 'paused'
  // Default for active shift without dailyState evidence yet
  return 'working'
}

export default function TeamDashboardClient({
  orgId,
  viewerUserId,
  isManager,
  isOwner,
  greeting,
  snapshot,
  members,
  teams,
  blockers,
  earlyWarnings = [],
  slackAlerts,
  pendingLeaves,
  recentBreaks,
  integrations,
  nextMeeting,
}: {
  orgId: number
  viewerUserId: number
  isManager: boolean
  isOwner: boolean
  greeting: string
  snapshot: Snapshot
  members: MemberCard[]
  teams: { id: number; name: string; color: string | null }[]
  blockers: Blocker[]
  /** People likely to get stuck who have not flagged a blocker yet. */
  earlyWarnings?: BriefWarning[]
  slackAlerts: SlackAlert[]
  pendingLeaves: PendingLeave[]
  recentBreaks: RecentBreak[]
  /** Connection state for the inline "Connections" card. */
  integrations: {
    githubInstalled: boolean
    githubAppInstallUrl: string
    calendarConnected: boolean
    slackConnected: boolean
    slackTeamName: string | null
  }
  nextMeeting: MeetingCard | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [detailMember, setDetailMember] = useState<{ membershipId: number; name: string } | null>(null)
  /** Member currently in the Schedule-meeting flow (opened from the team card). */
  const [meetingFor, setMeetingFor] = useState<MemberCard | null>(null)
  const [resolverBreakId, setResolverBreakId] = useState<number | null>(null)
  // Status filter — managers often want to see only blocked or only off
  // teammates. `null` means "all". Combines with the search box.
  const [statusFilter, setStatusFilter] = useState<SimpleStatus | null>(null)
  // Filter by team — null means "all teams".
  const [teamFilter, setTeamFilter] = useState<number | null>(null)

  function openDetail(m: { membershipId: number; name: string | null; login: string }) {
    setDetailMember({ membershipId: m.membershipId, name: m.name ?? `@${m.login}` })
  }

  // Per-status counts for the filter chips. Computed once so chips show
  // live numbers ("Blocked · 3") and we don't recount on every render.
  const statusCounts = useMemo(() => {
    const c: Record<SimpleStatus, number> = { working: 0, paused: 0, blocked: 0, off: 0 }
    for (const m of members) c[deriveStatus(m)]++
    return c
  }, [members])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members.filter((m) => {
      if (statusFilter && deriveStatus(m) !== statusFilter) return false
      if (teamFilter !== null && !m.teamIds.includes(teamFilter)) return false
      if (!q) return true
      return (
        (m.name ?? '').toLowerCase().includes(q) ||
        m.login.toLowerCase().includes(q) ||
        (m.activity.topApp ?? '').toLowerCase().includes(q)
      )
    })
  }, [members, query, statusFilter, teamFilter])

  async function decideLeave(leaveId: number, decision: 'approve' | 'deny') {
    setBusy(`leave-${leaveId}-${decision}`)
    try {
      const res = await fetch(`/api/orgs/${orgId}/leaves/${leaveId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`)
      }
      toast.push({
        kind: 'success',
        title: decision === 'approve' ? 'Leave approved' : 'Leave denied',
        body: 'The team member has been notified.',
      })
      router.refresh()
    } catch (e) {
      console.error('[decideLeave] failed', e)
      toast.push({
        kind: 'error',
        title: 'Could not decide the leave',
        body: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(null)
    }
  }

  async function syncMember(membershipId: number, label: string) {
    setBusy(`sync-${membershipId}`)
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${membershipId}/sync`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`)
      toast.push({
        kind: 'success',
        title: `Synced ${label}`,
        body: `${(data as { inserted?: number }).inserted ?? 0} new GitHub events.`,
      })
      router.refresh()
    } catch (e) {
      toast.push({
        kind: 'error',
        title: `Sync failed for ${label}`,
        body: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(null)
    }
  }

  async function pingBlocker(b: Blocker) {
    const target = b.waitingOnUser ? `@${b.waitingOnUser.login}` : b.waitingOnExternal ?? 'them'
    setBusy(`ping-${b.breakId}`)
    try {
      const res = await fetch(`/api/orgs/${orgId}/blockers/${b.breakId}/ping`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`)
      toast.push({
        kind: 'success',
        title: `Nudged ${target}`,
        body: `They’ll see a notification about ${b.blockedUser.name ?? `@${b.blockedUser.login}`}.`,
      })
    } catch (e) {
      toast.push({
        kind: 'error',
        title: 'Could not send ping',
        body: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setBusy(null)
    }
  }


  // "Things worth reviewing today" — up to 3 picks. We surface (in priority):
  //   1. Oldest pending leave request
  //   2. Anyone with an active 'blocked' break
  //   3. Anyone flagged Blocked / Disengaged / PossiblyDummying via dailyState
  //   4. Anyone on a long shift (>9h active) — worth a wellbeing check-in
  // The section always renders so managers see the empty-state when calm.
  const reviewing = useMemo(() => {
    const picks: Array<{
      kind: 'leave' | 'block' | 'inactive' | 'long-day'
      member: MemberCard | null
      leave?: PendingLeave
      label: string
      detail: string
    }> = []

    if (pendingLeaves[0]) {
      const lv = pendingLeaves[0]
      const member = members.find((m) => m.userId === lv.user.id) ?? null
      picks.push({
        kind: 'leave',
        member,
        leave: lv,
        label: 'Leave request',
        detail: lv.reason,
      })
    }

    // Active blockers first (structured signal trumps dailyState heuristics)
    for (const m of members) {
      if (picks.length >= 3) break
      if (m.ongoingBreak?.category === 'blocked' && !picks.find((p) => p.member?.userId === m.userId)) {
        const target = m.ongoingBreak.waitingOn
          ? `@${m.ongoingBreak.waitingOn.login}`
          : m.ongoingBreak.waitingOnExternal ?? 'someone'
        picks.push({
          kind: 'block',
          member: m,
          label: 'Blocked now',
          detail: `Waiting on ${target}. ${m.ongoingBreak.reason ?? ''}`.trim(),
        })
      }
    }

    for (const m of members) {
      if (picks.length >= 3) break
      if (!m.dailyState) continue
      if (m.dailyState.state === 'Blocked' && !picks.find((p) => p.member?.userId === m.userId)) {
        picks.push({
          kind: 'block',
          member: m,
          label: 'Waiting on review',
          detail: m.dailyState.reason || 'Activity pattern suggests they are stuck.',
        })
      } else if (
        (m.dailyState.state === 'Disengaged' || m.dailyState.state === 'PossiblyDummying') &&
        !picks.find((p) => p.member?.userId === m.userId)
      ) {
        picks.push({
          kind: 'inactive',
          member: m,
          label: stateLabel(m.dailyState.state),
          detail: m.dailyState.reason || 'Quiet signals so far today. A quick check-in may help.',
        })
      }
    }

    // Long-day check (>9h total activity captured)
    for (const m of members) {
      if (picks.length >= 3) break
      const totalSec = m.activity.activeSeconds + m.activity.idleSeconds
      if (totalSec > 9 * 3600 && !picks.find((p) => p.member?.userId === m.userId)) {
        picks.push({
          kind: 'long-day',
          member: m,
          label: 'Long day',
          detail: `${Math.floor(totalSec / 3600)}h tracked today — consider a wellbeing check-in.`,
        })
      }
    }

    return picks.slice(0, 3)
  }, [members, pendingLeaves])

  return (
    <>
      <LivePoll router={router} />

      {/* Next team meeting — pinned at the very top, mirroring the employee view. */}
      {nextMeeting && (
        <div className="mb-4">
          <NextMeetingBanner meeting={nextMeeting} />
        </div>
      )}

      {/* Marina's morning brief — the persona-led hero. She greets the manager
          and tells them, in her own voice, what (if anything) needs them. */}
      <div data-tour="brief">
        <MarinaBrief
          greeting={greeting}
          line={marinaBriefLine(snapshot)}
          evidence={marinaBriefEvidence(orgId, snapshot, blockers)}
          warnings={earlyWarnings}
        />
      </div>

      {/* Desktop agent is on hold — a dismissible "coming soon" teaser. The team
          punches in/out from the web for now. */}
      <div className="mb-6">
        <ComingSoonAgent variant="manager" />
      </div>

      {/* Connections — inline on the dashboard so there's no separate page to
          hunt for. Drops away once GitHub, Slack and Calendar are all set up. */}
      {!(integrations.githubInstalled && integrations.slackConnected && integrations.calendarConnected) && (
        <div className="mb-6">
          <IntegrationsPanel
            variant="manager"
            orgId={orgId}
            github={{ connected: integrations.githubInstalled }}
            calendar={{ connected: integrations.calendarConnected }}
            slack={{
              connected: integrations.slackConnected,
              detail: integrations.slackTeamName ? `Connected to ${integrations.slackTeamName}.` : undefined,
            }}
            githubAppInstallUrl={integrations.githubAppInstallUrl}
            calendarReturnTo={`/org/${orgId}`}
            dismissible
            settingsHref={`/org/${orgId}/settings`}
          />
        </div>
      )}

      {/* Inline stats — typography-led, no boxes. Org productivity is the
          headline KPI: HR can glance and tell whether the org as a whole is
          firing today. Anything below 45% deserves a manager's attention. */}
      <div data-tour="stats" className="mb-6 flex items-center gap-x-8 gap-y-2 flex-wrap pb-5 border-b border-[var(--m-border)]">
        <InlineStat
          n={snapshot.orgProductivity == null ? '—' : `${snapshot.orgProductivity}%`}
          label={snapshot.orgProductivity == null ? 'org productivity · no signals yet' : 'org productivity today'}
          tone={
            snapshot.orgProductivity == null
              ? 'muted'
              : snapshot.orgProductivity >= 65
                ? 'emerald'
                : snapshot.orgProductivity >= 45
                  ? 'amber'
                  : 'rose'
          }
        />
        <InlineStat
          n={snapshot.blockerCount}
          label={snapshot.blockedOnYouCount > 0 ? `blocked (${snapshot.blockedOnYouCount} on you)` : 'blocked'}
          tone={snapshot.blockerCount > 0 ? 'rose' : 'muted'}
        />
        <InlineStat n={snapshot.activeCount} label="shipping" tone="emerald" />
        <InlineStat n={snapshot.onLeaveCount} label="on leave" tone="amber" />
        <InlineStat n={pendingLeaves.length} label="pending leaves" tone="muted" />
        <InlineStat n={snapshot.waitingOnReview} label="awaiting review" tone="muted" />
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Main column */}
        <div className="col-span-12 xl:col-span-9 space-y-5">
          {slackAlerts.length > 0 && (
            <SlackingPanel
              alerts={slackAlerts}
              onOpenMember={(a) =>
                openDetail({ membershipId: a.membershipId, name: a.name, login: a.login })
              }
            />
          )}

          {blockers.length > 0 && (
            <BlockersPanel
              orgId={orgId}
              blockers={blockers}
              busy={busy}
              onPing={(b) => pingBlocker(b)}
              onOpenBlocked={(b) => setResolverBreakId(b.breakId)}
            />
          )}

          <section className="rounded-xl border border-[var(--m-border)] bg-white">
            <div className="px-5 py-3.5 border-b border-[var(--m-border-soft)] flex items-baseline justify-between gap-3">
              <h2 className="text-[14px] font-semibold text-[var(--m-ink)]">
                Worth a look
                {reviewing.length > 0 && (
                  <span className="ml-1.5 text-[var(--m-ink-4)] tabular-nums">{reviewing.length}</span>
                )}
              </h2>
              <Link
                href={`/org/${orgId}/leaves`}
                className="text-[12px] text-[var(--m-ink-3)] hover:text-[var(--m-ink)]"
              >
                View leaves →
              </Link>
            </div>
            {reviewing.length === 0 ? (
              <p className="px-5 py-8 text-center text-[12.5px] text-[var(--m-ink-3)]">
                All quiet — no pending leaves, no blockers, no long days. Great time to plan ahead.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--m-border-soft)]">
                {reviewing.map((r, idx) => (
                  <ReviewCard
                    key={idx}
                    pick={r}
                    isManager={isManager}
                    busy={busy}
                    onDecide={decideLeave}
                    onOpen={openDetail}
                    onResolveBlocker={(breakId) => setResolverBreakId(breakId)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Team Members */}
          <section data-tour="members">
            <div className="flex items-baseline gap-3 mb-3 flex-wrap">
              <h2 className="text-[15px] font-semibold text-[var(--m-ink)]">Team Members</h2>
              <span className="text-[12px] text-[var(--m-ink-3)]">
                {statusFilter || query ? `${filtered.length} of ${members.length}` : members.length}
              </span>
              <div className="ml-auto relative w-full sm:w-auto">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--m-ink-4)]" />
                <input
                  type="search"
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9 pr-3 py-1.5 w-full sm:w-[240px] rounded-lg border border-[var(--m-border)] bg-white text-[12.5px] outline-none focus:border-[var(--m-accent)] focus:ring-2 focus:ring-[var(--m-accent-glow)] transition"
                />
              </div>
            </div>

            {/* Status filter chips — managers can scope to "only blocked",
                "only off" etc. with one click. Counts are live. */}
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <StatusChip
                label="All"
                count={members.length}
                active={statusFilter === null}
                onClick={() => setStatusFilter(null)}
                tone="ink"
              />
              <StatusChip
                label="Working"
                count={statusCounts.working}
                active={statusFilter === 'working'}
                onClick={() => setStatusFilter('working')}
                tone="good"
              />
              <StatusChip
                label="Paused"
                count={statusCounts.paused}
                active={statusFilter === 'paused'}
                onClick={() => setStatusFilter('paused')}
                tone="warn"
              />
              <StatusChip
                label="Blocked"
                count={statusCounts.blocked}
                active={statusFilter === 'blocked'}
                onClick={() => setStatusFilter('blocked')}
                tone="bad"
              />
              <StatusChip
                label="Off"
                count={statusCounts.off}
                active={statusFilter === 'off'}
                onClick={() => setStatusFilter('off')}
                tone="mute"
              />

              {/* Team filter — scope the board to one team. */}
              {teams.length > 0 && (
                <select
                  value={teamFilter ?? ''}
                  onChange={(e) => setTeamFilter(e.target.value === '' ? null : Number(e.target.value))}
                  className="ml-1 text-[12px] rounded-full border border-[var(--m-border)] bg-white px-2.5 py-1 text-[var(--m-ink-2)] outline-none focus:border-[var(--m-accent)] cursor-pointer"
                  aria-label="Filter by team"
                >
                  <option value="">All teams</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--m-border)] p-10 text-center text-[13px] text-[var(--m-ink-3)]">
                {statusFilter
                  ? `No one is currently ${statusFilter}.`
                  : query
                  ? 'No matching members.'
                  : 'No members yet — invite teammates from the Members page.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
                {filtered.map((m) => (
                  <MemberCardView
                    key={m.membershipId}
                    member={m}
                    orgId={orgId}
                    isManager={isManager}
                    isSelf={m.userId === viewerUserId}
                    busy={busy}
                    onSchedule={() => setMeetingFor(m)}
                    onOpen={() => openDetail(m)}
                    onResolveBlocker={(breakId) => setResolverBreakId(breakId)}
                  />
                ))}
              </div>
            )}

            <div className="mt-3">
              <Link
                href={`/org/${orgId}/members`}
                className="text-[12.5px] text-[var(--m-ink-3)] hover:text-[var(--m-ink)]"
              >
                Manage members →
              </Link>
            </div>
          </section>
        </div>

        {/* Right rail — consolidated, minimal */}
        <aside className="col-span-12 xl:col-span-3 space-y-5">
          <MeetingsPanel />
          <CelebrationsWidget orgId={orgId} />
          <LeavePanel
            orgId={orgId}
            isManager={isManager}
            leaves={pendingLeaves}
            busy={busy}
            onDecide={decideLeave}
          />
          <BreakPanel breaks={recentBreaks} orgId={orgId} />
        </aside>
      </div>

      <MemberDetailModal
        orgId={orgId}
        membershipId={detailMember?.membershipId ?? null}
        initialName={detailMember?.name ?? ''}
        open={detailMember !== null}
        onClose={() => setDetailMember(null)}
        isManager={isManager}
        isOwner={isOwner}
        viewerUserId={viewerUserId}
      />

      <BlockerResolver
        orgId={orgId}
        breakId={resolverBreakId}
        open={resolverBreakId !== null}
        onClose={() => setResolverBreakId(null)}
        onResolved={() => router.refresh()}
      />

      {meetingFor && (
        <ScheduleMeetingDialog
          open
          orgId={orgId}
          membershipId={meetingFor.membershipId}
          attendeeName={meetingFor.name ?? `@${meetingFor.login}`}
          onClose={() => setMeetingFor(null)}
        />
      )}

      {/* Flagship: ask the AI about the whole team (scoped to who you can see).
          Floating right-dock launcher; only managers/admins reach this page. */}
      <TeamChat orgId={orgId} />

      {/* Marina's first-run, skippable coachmark tour of this dashboard. */}
      <DashboardTour />
    </>
  )
}

/* ---------- Sub-components ---------- */

function SlackingPanel({
  alerts,
  onOpenMember,
}: {
  alerts: SlackAlert[]
  onOpenMember: (a: SlackAlert) => void
}) {
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/60 overflow-hidden">
      <div className="px-5 py-3 border-b border-amber-100 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[14px] font-semibold text-amber-900">
            May need a check-in
          </h2>
          <span className="text-[12px] text-amber-700 font-medium tabular-nums">
            {alerts.length}
          </span>
        </div>
        <span className="text-[11px] text-amber-700/80">
          Mostly non-work apps in the last 30 min · on-shift only · a prompt to ask, not a verdict
        </span>
      </div>
      <ul className="divide-y divide-amber-100">
        {alerts.map((a) => (
          <li
            key={a.userId}
            onClick={() => onOpenMember(a)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpenMember(a)
              }
            }}
            role="button"
            tabIndex={0}
            className="px-5 py-3 flex items-center gap-3 cursor-pointer hover:bg-amber-100/40 focus:outline-none focus-visible:bg-amber-100/40 transition"
          >
            <CharacterAvatar characterKey={a.characterKey} name={a.name} login={a.login} size={28} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-[var(--m-ink)]">
                <span className="font-medium">{a.name ?? `@${a.login}`}</span>
                <span className="text-amber-700"> · {slackTopicLabel(a)}</span>
              </p>
              <p className="text-[11.5px] text-amber-700/80">
                {a.unproductiveCount} of the last {a.totalCount} screen check-ins were outside work apps ({a.minutes} min)
              </p>
            </div>
            <span className="text-[11px] text-amber-700 font-medium">
              Check in →
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function slackTopicLabel(a: SlackAlert): string {
  if (a.topHint === 'social_media') return 'social media'
  if (a.topHint === 'video_streaming') return 'video / streaming'
  if (a.topCategory === 'media') return 'media'
  if (a.topCategory === 'browser_personal') return 'personal browsing'
  return 'non-work content'
}

function BlockersPanel({
  orgId,
  blockers,
  busy,
  onPing,
  onOpenBlocked,
}: {
  orgId: number
  blockers: Blocker[]
  busy: string | null
  onPing: (b: Blocker) => void
  onOpenBlocked: (b: Blocker) => void
}) {
  const blockedOnYou = blockers.filter((b) => b.waitingOnYou)
  return (
    <section className="rounded-xl border border-[var(--m-border)] bg-white overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[var(--m-border-soft)] flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[14px] font-semibold text-[var(--m-ink)]">
            Active blockers
          </h2>
          <span className="text-[12px] text-rose-600 font-medium tabular-nums">
            {blockers.length}
          </span>
          {blockedOnYou.length > 0 && (
            <span className="text-[11.5px] text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full font-medium">
              {blockedOnYou.length} on you
            </span>
          )}
        </div>
        <Link
          href={`/org/${orgId}/breaks`}
          className="text-[12px] text-[var(--m-ink-3)] hover:text-[var(--m-ink)]"
        >
          All paused →
        </Link>
      </div>
      <ul className="divide-y divide-[var(--m-border-soft)]">
        {blockers.map((b) => {
          const duration = humanDuration(Date.now() - new Date(b.startedAt).getTime())
          const aged = Date.now() - new Date(b.startedAt).getTime() > 4 * 3600 * 1000
          const target = b.waitingOnUser
            ? {
                kind: 'user' as const,
                label: b.waitingOnUser.name ?? `@${b.waitingOnUser.login}`,
                characterKey: b.waitingOnUser.characterKey,
              }
            : b.waitingOnExternal
              ? { kind: 'external' as const, label: b.waitingOnExternal, characterKey: null }
              : { kind: 'unknown' as const, label: 'Someone (unspecified)', characterKey: null }
          return (
            <li
              key={b.breakId}
              onClick={() => onOpenBlocked(b)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpenBlocked(b)
                }
              }}
              role="button"
              tabIndex={0}
              className={`px-5 py-3 flex items-center gap-3 flex-wrap cursor-pointer hover:bg-[var(--m-bg-soft)]/70 focus:outline-none focus-visible:bg-[var(--m-bg-soft)]/70 transition ${b.waitingOnYou ? 'bg-rose-50/50' : ''}`}
            >
              <CharacterAvatar characterKey={b.blockedUser.characterKey} name={b.blockedUser.name} login={b.blockedUser.login} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-[var(--m-ink)] truncate">
                  <span className="font-medium">{b.blockedUser.name ?? `@${b.blockedUser.login}`}</span>
                  <span className="text-[var(--m-ink-4)]"> waiting on </span>
                  {target.kind === 'user' && (
                    <span className="inline-flex items-center gap-1 align-middle">
                      <CharacterAvatar characterKey={target.characterKey} name={target.label} size={14} />
                      <span className="font-medium">{target.label}</span>
                    </span>
                  )}
                  {target.kind !== 'user' && <span className="font-medium">{target.label}</span>}
                </p>
                {b.reason && (
                  <p className="text-[11.5px] text-[var(--m-ink-3)] truncate mt-0.5">
                    {truncate(b.reason, 110)}
                  </p>
                )}
              </div>
              <span
                className={`text-[11px] font-medium tabular-nums ${aged ? 'text-rose-600' : 'text-amber-600'}`}
                title={`Blocked since ${new Date(b.startedAt).toLocaleString()}`}
              >
                {duration}
              </span>
              {target.kind === 'user' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPing(b)
                  }}
                  disabled={busy === `ping-${b.breakId}`}
                  className="px-2.5 py-1 rounded-md bg-[var(--m-ink)] hover:bg-[var(--m-ink-2)] text-white text-[11.5px] font-medium disabled:opacity-50 transition"
                >
                  {busy === `ping-${b.breakId}` ? 'Pinging…' : b.waitingOnYou ? 'Acknowledge' : 'Nudge'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function InlineStat({
  n,
  label,
  tone,
}: {
  // Accepts string so callers can pass "78%" without forcing a number-only
  // contract; the dim-on-zero shortcut still works for numeric inputs.
  n: number | string
  label: string
  tone: 'rose' | 'emerald' | 'amber' | 'muted'
}) {
  const dim = typeof n === 'number' && n === 0
  const colorClass = dim
    ? 'text-[var(--m-ink-4)]'
    : tone === 'rose'
      ? 'text-rose-700'
      : tone === 'emerald'
        ? 'text-emerald-700'
        : tone === 'amber'
          ? 'text-amber-700'
          : 'text-[var(--m-ink)]'
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-[22px] font-semibold tabular-nums tracking-tight ${colorClass}`}>{n}</span>
      <span className="text-[12px] text-[var(--m-ink-3)]">{label}</span>
    </div>
  )
}

function ReviewCard({
  pick,
  isManager,
  busy,
  onDecide,
  onOpen,
  onResolveBlocker,
}: {
  pick: {
    kind: 'leave' | 'block' | 'inactive' | 'long-day'
    member: MemberCard | null
    leave?: PendingLeave
    label: string
    detail: string
  }
  isManager: boolean
  busy: string | null
  onDecide: (id: number, decision: 'approve' | 'deny') => void
  onOpen?: (m: MemberCard) => void
  onResolveBlocker?: (breakId: number) => void
}) {
  const m = pick.member
  const lv = pick.leave
  const character = getCharacter(m?.characterKey ?? lv?.user.characterKey ?? null)

  const tone =
    pick.kind === 'leave'
      ? 'pill-warn'
      : pick.kind === 'block'
        ? 'pill-bad'
        : pick.kind === 'long-day'
          ? 'pill-info'
          : 'pill-slate'

  const clickable = !!(m && onOpen)
  const handleOpen = () => {
    if (clickable && m && onOpen) onOpen(m)
  }

  return (
    <div
      className={`p-4 flex flex-col gap-2.5 min-w-0 ${clickable ? 'cursor-pointer hover:bg-[var(--m-bg-soft)]/60 transition' : ''}`}
      onClick={clickable ? handleOpen : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleOpen()
              }
            }
          : undefined
      }
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="flex items-center gap-2.5">
        <CharacterAvatar
          characterKey={m?.characterKey ?? lv?.user.characterKey ?? null}
          name={m?.name ?? lv?.user.name ?? null}
          login={m?.login ?? lv?.user.login ?? null}
          size={32}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-[var(--m-ink)] truncate">
            {m?.name ?? lv?.user.name ?? `@${m?.login ?? lv?.user.login}`}
          </p>
          <p className="text-[11px] text-[var(--m-ink-3)] truncate">
            {character?.name ?? `@${m?.login ?? lv?.user.login}`}
          </p>
        </div>
        <span className={`pill ${tone}`}>{pick.label}</span>
      </div>
      <p className="text-[12.5px] text-[var(--m-ink-2)] leading-snug">{pick.detail}</p>

      {lv && (
        <div className="text-[11.5px] text-[var(--m-ink-3)] flex items-center gap-1">
          <CalSmallIcon />
          <span>{fmtDateRange(lv.startDate, lv.endDate)}</span>
          <span className="text-[var(--m-ink-4)]">· {timeAgo(lv.createdAt)}</span>
        </div>
      )}

      <div className="flex items-center gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
        {lv && isManager ? (
          <>
            <button
              className="px-3 py-1.5 rounded-md bg-[var(--m-ink)] hover:bg-[var(--m-ink-2)] text-white text-[12px] font-medium disabled:opacity-50 transition flex-1"
              disabled={busy === `leave-${lv.id}-approve`}
              onClick={() => onDecide(lv.id, 'approve')}
            >
              {busy === `leave-${lv.id}-approve` ? '…' : 'Approve'}
            </button>
            <button
              className="px-3 py-1.5 rounded-md bg-white border border-[var(--m-border)] hover:bg-[var(--m-bg-soft)] text-[var(--m-ink-2)] text-[12px] font-medium disabled:opacity-50 transition flex-1"
              disabled={busy === `leave-${lv.id}-deny`}
              onClick={() => onDecide(lv.id, 'deny')}
            >
              {busy === `leave-${lv.id}-deny` ? '…' : 'Deny'}
            </button>
          </>
        ) : pick.kind === 'block' ? (
          <div className="flex items-center gap-2 flex-1">
            <span className="text-[11.5px] text-rose-600 inline-flex items-center gap-1">
              <DotRed /> Blocked {timeSinceLabel(m?.activity)}
            </span>
            {isManager && m?.ongoingBreak?.id && onResolveBlocker && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onResolveBlocker(m.ongoingBreak!.id)
                }}
                className="ml-auto px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white text-[11.5px] font-medium transition"
              >
                Resolve →
              </button>
            )}
          </div>
        ) : pick.kind === 'inactive' ? (
          <span className="text-[11.5px] text-[var(--m-ink-3)]">
            Last active {timeSinceLabel(m?.activity)}
          </span>
        ) : pick.kind === 'long-day' ? (
          <span className="text-[11.5px] text-[var(--m-accent)]">
            Suggest a wellbeing check-in
          </span>
        ) : null}
      </div>
    </div>
  )
}

function MemberCardView({
  member: m,
  orgId,
  isManager,
  isSelf,
  busy,
  onSchedule,
  onOpen,
  onResolveBlocker,
}: {
  member: MemberCard
  orgId: number
  isManager: boolean
  /** True when this card belongs to the logged-in user. Manager actions
   * (schedule meeting, nudge) are suppressed so the user doesn't
   * end up trying to nudge themselves. */
  isSelf: boolean
  busy: string | null
  onSchedule: () => void
  onOpen: () => void
  /** Open the blocker-resolver flow for this member's active block. */
  onResolveBlocker: (breakId: number) => void
}) {
  const character = getCharacter(m.characterKey)
  const statusKey = deriveStatus(m)
  const status = STATUS[statusKey]
  // Refined label: distinguish "On leave" vs "Off-clock" within the "off" bucket
  const displayLabel = statusKey === 'off'
    ? (m.onLeaveToday ? 'On leave' : 'Off-clock')
    : status.label

  return (
    <article
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open details for ${m.name ?? `@${m.login}`}`}
      className="cursor-pointer text-left w-full h-full flex flex-col rounded-2xl bg-white border border-[var(--m-border)] shadow-sm hover:shadow-md hover:border-[var(--m-border)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--m-accent)]/40 transition-all overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-start gap-3">
        <CharacterAvatar characterKey={m.characterKey} name={m.name} login={m.login} size={48} ring />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-[var(--m-ink)] truncate">
              {m.name ?? `@${m.login}`}
            </h3>
            <span className={`pill ${status.pill}`}>
              <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5" style={{ background: status.dot }} />
              {displayLabel}
            </span>
          </div>
          <p className="text-[11.5px] text-[var(--m-ink-3)] mt-0.5 truncate">
            {character ? `${character.name} · ${m.role}` : m.role}
          </p>
        </div>
      </div>

      {/* Blocker badge — highest priority signal */}
      {m.ongoingBreak?.category === 'blocked' && (
        <div className="px-5 pb-3">
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
            <span className="font-semibold">Waiting on </span>
            {m.ongoingBreak.waitingOn ? (
              <>@{m.ongoingBreak.waitingOn.login}</>
            ) : m.ongoingBreak.waitingOnExternal ? (
              <>{m.ongoingBreak.waitingOnExternal}</>
            ) : (
              <>someone (unspecified)</>
            )}
            <span className="text-rose-600"> · {humanDuration(Date.now() - new Date(m.ongoingBreak.startedAt).getTime())}</span>
            {m.ongoingBreak.reason && (
              <p className="text-rose-700 mt-0.5 text-[11.5px] leading-snug">{truncate(m.ongoingBreak.reason, 120)}</p>
            )}
          </div>
        </div>
      )}

      {/* Right now — instant-read line. Manager glances and knows what's happening.
          (Activity telemetry intentionally omitted — the desktop agent is on
          hold, so we show punch + real work signals instead of focus/idle bars.) */}
      <div className="px-5 pb-3">
        <RightNowLine member={m} statusKey={statusKey} />
        {m.activeShift && (
          <p className="mt-1.5 text-[11.5px] text-[var(--m-ink-3)]">
            On the clock since{' '}
            <span className="text-[var(--m-ink)] font-medium">
              {new Date(m.activeShift.punchedInAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
          </p>
        )}
      </div>

      {/* Live signal — what they LAST SHIPPED + today's rules-based status.
          We deliberately do NOT render the AI narrative on the card: it can be
          hours stale and showing it as the headline made the card lie. The
          "Brief" action generates a fresh narrative on demand in the profile
          when a manager wants the deeper write-up. */}
      <div className="px-5 pb-3 space-y-1.5">
        {m.recentDeliverable && (
          <p className="text-[12.5px] text-[var(--m-ink-2)] leading-snug flex items-start gap-1.5">
            <span className="text-[var(--m-accent)] mt-0.5">✓</span>
            <span className="min-w-0">
              <span className="break-words">Shipped: {m.recentDeliverable.title}</span>
              <span className="text-[var(--m-ink-4)]"> · {timeAgo(m.recentDeliverable.completedAt)}</span>
            </span>
          </p>
        )}
        {!m.recentDeliverable && (
          <p className="text-[12px] text-[var(--m-ink-4)] leading-snug">
            {statusKey === 'off'
              ? m.onLeaveToday
                ? 'On leave today.'
                : 'Not on the clock right now.'
              : statusKey === 'blocked'
                ? 'Needs a hand to get unblocked.'
                : m.hasGithub
                  ? 'No commits or PRs yet today.'
                  : 'Working — check the daily standup for an update.'}
          </p>
        )}
      </div>

      {/* Action footer */}
      {isManager && (
        <div
          className="mt-auto border-t border-[var(--m-border-soft)] bg-[var(--m-bg-soft)]/40 px-5 py-2.5 flex items-center justify-between gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {/* "no GitHub" pill removed — not every teammate uses GitHub
                (sales, design, ops, etc) and showing the absence as a flag
                made the card feel judgmental. Brief tells you all you need
                to know about activity sources. */}
            {m.activity.paused && (
              <span className="text-[10.5px] text-[var(--m-ink-2)] bg-[var(--m-bg-soft)] border border-[var(--m-border)] px-1.5 py-0.5 rounded-full">
                paused
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* When this teammate is in a blocked break and the viewer is a
                manager, show the most useful single action right on the
                outer card. Avoids forcing the manager to open the modal
                just to nudge / route / suggest. */}
            {isManager && !isSelf && m.ongoingBreak?.category === 'blocked' && m.ongoingBreak.id && (
              <button
                type="button"
                onClick={() => onResolveBlocker(m.ongoingBreak!.id)}
                disabled={busy !== null}
                className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[11.5px] font-medium disabled:opacity-50 disabled:cursor-not-allowed transition"
                title="Help resolve this blocker — nudge, route, or suggest a workaround"
              >
                Resolve blocker
              </button>
            )}
            {/* Schedule meeting replaces the old Sync button. Managers reach
                for "book a 1:1" 10× more than they reach for "sync GitHub
                events" — sync runs automatically anyway. The action is
                manager-only AND hidden on the viewer's own card — you
                can't schedule a 1:1 with yourself. */}
            {isManager && !isSelf && (
              <button
                type="button"
                onClick={(e) => {
                  // The whole card is clickable (opens the member modal). Stop
                  // propagation so "Schedule meeting" ONLY opens the dialog —
                  // otherwise the modal also popped open behind it and the two
                  // overlays stacked into a blank-looking mess.
                  e.stopPropagation()
                  onSchedule()
                }}
                disabled={busy !== null}
                className="px-2.5 py-1 rounded-md bg-white border border-[var(--m-border)] hover:border-[var(--m-accent)] hover:bg-[var(--m-accent-soft)] text-[11.5px] font-medium text-[var(--m-ink-2)] disabled:opacity-50 disabled:cursor-not-allowed transition"
                title={`Schedule a 1:1 with ${m.name ?? `@${m.login}`}`}
              >
                Schedule meeting
              </button>
            )}
            {/* "Brief" button removed from the card — we don't surface a brief
                on the card itself, so generating one here was confusing. The
                brief lives inside the member modal's Today tab. */}
            {isSelf && (
              <span className="text-[10.5px] text-[var(--m-ink-4)] italic px-2">This is you</span>
            )}
            {/* Full-page profile route — sharable URL, deep links from emails,
                day-by-day jumping. The in-page modal still works on card
                click; this is the secondary discoverability path. */}
            <a
              href={`/org/${orgId}/people/${m.membershipId}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] text-[var(--m-ink-3)] hover:text-[var(--m-accent)] px-2 py-1 hover:bg-[var(--m-bg-soft)] rounded-md transition"
              title="Open full profile page"
            >
              Profile ↗
            </a>
          </div>
        </div>
      )}
    </article>
  )
}

/**
 * Status-driven progress bar: shows focus / idle proportion for today, tinted
 * by the member's current status. Colors agree with the pill on the same card.
 *
 * - working: emerald active, slate idle
 * - paused:  same proportions, but the right edge becomes a muted slate stripe
 * - blocked: same proportions, right edge becomes a rose stripe
 * - off:     flat muted bar (no segments) — they're not working today
 */
/**
 * Status filter chip for the Team Members grid. Shows a label, a live
 * count, and color-codes by tone so the strip reads like a legend at a
 * glance — managers can spot "Blocked · 3" without thinking.
 */
function StatusChip({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  tone: 'ink' | 'good' | 'warn' | 'bad' | 'mute'
}) {
  // Active state uses the tone's full color for the background; inactive uses
  // a soft variant so the strip doesn't fight for attention.
  const activeStyles =
    tone === 'good' ? 'bg-[var(--m-good)] text-white border-[var(--m-good)]' :
    tone === 'warn' ? 'bg-[var(--m-warn)] text-white border-[var(--m-warn)]' :
    tone === 'bad'  ? 'bg-[var(--m-bad)] text-white border-[var(--m-bad)]' :
    tone === 'mute' ? 'bg-[var(--m-ink-2)] text-white border-[var(--m-ink-2)]' :
                      'bg-[var(--m-ink)] text-white border-[var(--m-ink)]'
  const inactiveStyles =
    tone === 'good' ? 'bg-[var(--m-good-soft)] text-[var(--m-good)] border-[var(--m-good)]/15 hover:border-[var(--m-good)]/30' :
    tone === 'warn' ? 'bg-[var(--m-warn-soft)] text-[var(--m-warn)] border-[var(--m-warn)]/15 hover:border-[var(--m-warn)]/30' :
    tone === 'bad'  ? 'bg-[var(--m-bad-soft)] text-[var(--m-bad)] border-[var(--m-bad)]/15 hover:border-[var(--m-bad)]/30' :
    tone === 'mute' ? 'bg-[var(--m-bg-soft)] text-[var(--m-ink-2)] border-[var(--m-border)] hover:border-[var(--m-border)]' :
                      'bg-white text-[var(--m-ink-2)] border-[var(--m-border)] hover:border-[var(--m-border)]'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition ${
        active ? activeStyles : inactiveStyles
      } ${count === 0 && !active ? 'opacity-50' : ''}`}
    >
      {label}
      <span className={`tabular-nums text-[11px] ${active ? 'opacity-90' : 'opacity-70'}`}>
        {count}
      </span>
    </button>
  )
}

/**
 * Productivity % pill — focused / (focused + idle) since shift start.
 *
 * Three buckets:
 *   ≥ 65 % — green   "On a roll"
 *   45-64 % — amber  "Steady"
 *    < 45 % — rose   "Patchy"
 *
 * Updates live as the day progresses (the activity payload is polled by the
 * parent), so HR sees the number trend up as the person hits their stride
 * and back down if a long meeting eats the afternoon. Single number, scan
 * across the team in a glance.
 */
function ProductivityPill({ activeSec, totalSec }: { activeSec: number; totalSec: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((activeSec / Math.max(1, totalSec)) * 100)))
  const tone =
    pct >= 65 ? { bg: 'bg-[var(--m-good-soft)]', fg: 'text-[var(--m-good)]', label: 'On a roll' } :
    pct >= 45 ? { bg: 'bg-[var(--m-warn-soft)]', fg: 'text-[var(--m-warn)]', label: 'Steady' } :
                { bg: 'bg-[var(--m-bad-soft)]',  fg: 'text-[var(--m-bad)]',  label: 'Patchy' }
  return (
    <span
      title={`${pct}% productive · ${tone.label}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold tabular-nums ${tone.bg} ${tone.fg}`}
    >
      {pct}%
    </span>
  )
}

function TodayRibbon({
  member: m,
  statusKey,
}: {
  member: MemberCard
  statusKey: SimpleStatus
}) {
  if (statusKey === 'off') {
    const offReason = m.onLeaveToday ? 'On leave today' : 'Off-clock'
    return <div className="h-1.5 rounded-full bg-[var(--m-bg-soft)]" title={offReason} />
  }

  const totalSec = m.activity.activeSeconds + m.activity.idleSeconds
  if (totalSec === 0) {
    return (
      <div className="h-1.5 rounded-full bg-[var(--m-bg-soft)]" title="Awaiting first activity sample" />
    )
  }

  const total = Math.max(1, totalSec)
  const activePct = (m.activity.activeSeconds / total) * 100
  const idlePct = (m.activity.idleSeconds / total) * 100
  const breakCls = statusKey === 'blocked' ? 'bg-[var(--m-bad)]/70' : 'bg-[var(--m-ink-4)]/70'
  return (
    <div
      className="h-1.5 rounded-full overflow-hidden flex bg-[var(--m-bg-soft)]"
      title={`${formatHm(m.activity.activeSeconds)} focused · ${formatHm(m.activity.idleSeconds)} idle`}
    >
      <div className="h-full bg-[var(--m-accent)]" style={{ width: `${activePct}%` }} />
      <div className="h-full bg-[var(--m-ink-5)]" style={{ width: `${idlePct}%` }} />
      {m.ongoingBreak && <div className={`h-full flex-1 min-w-[6%] ${breakCls}`} />}
    </div>
  )
}

/**
 * "Right now" line — first thing a manager reads on each member card.
 *
 * Surfaces in priority order:
 *   1. Blocked → "Blocked · waiting on @rahul · 47m"
 *   2. On break → "On a meeting break · 12m"
 *   3. On leave → "On leave today · Sick"
 *   4. Off-clock → "Off-clock · last seen 4h ago"
 *   5. Working → "Right now: VS Code · auth-flow.ts" (with live pulse dot)
 *
 * The pulse dot is a CSS animation so it ticks even when the rest of the
 * dashboard is idle — the manager subconsciously perceives "this is live."
 */
function RightNowLine({
  member: m,
  statusKey,
}: {
  member: MemberCard
  statusKey: SimpleStatus
}) {
  const baseCls = 'inline-flex items-center gap-2 text-[12.5px] leading-snug'

  if (statusKey === 'blocked' && m.ongoingBreak) {
    const mins = humanDuration(Date.now() - new Date(m.ongoingBreak.startedAt).getTime())
    const target = m.ongoingBreak.waitingOn
      ? `@${m.ongoingBreak.waitingOn.login}`
      : m.ongoingBreak.waitingOnExternal ?? 'someone'
    return (
      <div className={`${baseCls} text-[var(--m-bad)]`}>
        <PulseDot tone="bad" />
        <span><span className="font-medium">Blocked</span> · waiting on {target} · {mins}</span>
      </div>
    )
  }

  if (statusKey === 'paused' && m.ongoingBreak) {
    const mins = humanDuration(Date.now() - new Date(m.ongoingBreak.startedAt).getTime())
    const label =
      m.ongoingBreak.category === 'meeting' ? 'In a meeting' :
      m.ongoingBreak.category === 'lunch'   ? 'Out for lunch' :
      m.ongoingBreak.category === 'errand'  ? 'On an errand' :
      m.ongoingBreak.category === 'focus'   ? 'Focus / no-disturb' :
      m.ongoingBreak.category === 'personal' ? 'Personal time' :
      'Paused'
    return (
      <div className={`${baseCls} text-[var(--m-ink-2)]`}>
        <PulseDot tone="paused" />
        <span><span className="font-medium">{label}</span> · {mins}</span>
      </div>
    )
  }

  if (statusKey === 'off') {
    if (m.onLeaveToday) {
      return (
        <div className={`${baseCls} text-[var(--m-warn)]`}>
          <Dot tone="warn" />
          <span><span className="font-medium">On leave</span> today</span>
        </div>
      )
    }
    return (
      <div className={`${baseCls} text-[var(--m-ink-3)]`}>
        <Dot tone="off" />
        <span><span className="font-medium">Off-clock</span></span>
      </div>
    )
  }

  // Working — refine with the agent's live presence when it's reporting.
  const app = m.activity.topApp
  const presence = m.activity.presence
  // Telemetry-aware: only claim "Heads-down" (focused, no foreground app) when
  // the agent is actually reporting. With no telemetry, "Heads-down" is a lie —
  // we only know they're punched in.
  const hasTelemetry =
    (m.activity.activeSeconds ?? 0) + (m.activity.idleSeconds ?? 0) + (m.activity.lockedSeconds ?? 0) > 0

  if (presence === 'locked') {
    return (
      <div className={`${baseCls} text-[var(--m-ink-2)] min-w-0`}>
        <Dot tone="off" />
        <span className="text-[var(--m-ink-3)] shrink-0">Right now</span>
        <span className="font-medium text-[var(--m-warn)]">Away · screen locked</span>
      </div>
    )
  }
  if (presence === 'idle') {
    return (
      <div className={`${baseCls} text-[var(--m-ink-2)] min-w-0`}>
        <Dot tone="warn" />
        <span className="text-[var(--m-ink-3)] shrink-0">Right now</span>
        <span className="font-medium text-[var(--m-warn)]">Idle</span>
        {app && <span className="text-[var(--m-ink-4)] truncate">· {app}</span>}
      </div>
    )
  }
  return (
    <div className={`${baseCls} text-[var(--m-ink)] min-w-0`}>
      <PulseDot tone="good" />
      <span className="text-[var(--m-ink-3)] shrink-0">Right now</span>
      {app ? (
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <AppGlyph app={app} />
          <span className="font-medium truncate">{app}</span>
        </span>
      ) : hasTelemetry ? (
        <span className="font-medium text-[var(--m-good)]">Heads-down</span>
      ) : (
        <span className="font-medium text-[var(--m-ink-3)]">On the clock</span>
      )}
    </div>
  )
}

function PulseDot({ tone }: { tone: 'good' | 'bad' | 'paused' }) {
  const color =
    tone === 'good' ? 'var(--m-good)' :
    tone === 'bad'  ? 'var(--m-bad)'  :
    'var(--m-ink-4)'
  return (
    <span className="relative inline-flex shrink-0">
      <span
        className="absolute inset-0 rounded-full opacity-60 animate-ping"
        style={{ background: color }}
      />
      <span className="relative inline-block w-2 h-2 rounded-full" style={{ background: color }} />
    </span>
  )
}

function Dot({ tone }: { tone: 'warn' | 'off' }) {
  const color = tone === 'warn' ? 'var(--m-warn)' : 'var(--m-ink-5)'
  return <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
}

/**
 * Tiny mono-color glyph per known app family. Falls back to a colored dot
 * when the app isn't recognised. Keeps the right-now line scannable.
 */
function AppGlyph({ app }: { app: string }) {
  const lower = app.toLowerCase()
  if (/code|webstorm|intellij|vim|emacs|cursor|xcode|android studio/.test(lower)) return <CodeGlyph />
  if (/figma|sketch|illustrator|photoshop|adobe/.test(lower)) return <DesignGlyph />
  if (/slack|discord|teams|telegram|whatsapp/.test(lower)) return <ChatGlyph />
  if (/zoom|meet|hangouts|webex/.test(lower)) return <VideoGlyph />
  if (/chrome|safari|firefox|edge|arc/.test(lower)) return <BrowserGlyph />
  if (/mail|outlook|gmail/.test(lower)) return <MailGlyph />
  if (/notion|linear|jira|confluence/.test(lower)) return <DocGlyph />
  return (
    <span
      className="inline-block w-3 h-3 rounded-sm shrink-0"
      style={{ background: appColor(app) }}
    />
  )
}

function CodeGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-[var(--m-accent)] shrink-0">
      <path d="M8 8l-4 4 4 4M16 8l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function DesignGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-[var(--m-clay)] shrink-0">
      <circle cx={12} cy={12} r={4} />
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4" strokeLinecap="round" />
    </svg>
  )
}
function ChatGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-[var(--m-info)] shrink-0">
      <path d="M21 12a8 8 0 11-3-6.2V11l3 1z" strokeLinejoin="round" />
    </svg>
  )
}
function VideoGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-[var(--m-info)] shrink-0">
      <rect x={3} y={6} width={13} height={12} rx={2} />
      <path d="M16 10l5-2v8l-5-2z" />
    </svg>
  )
}
function BrowserGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-[var(--m-ink-3)] shrink-0">
      <circle cx={12} cy={12} r={9} />
      <path d="M3 12h18M12 3a13 13 0 010 18M12 3a13 13 0 000 18" strokeLinecap="round" />
    </svg>
  )
}
function MailGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-[var(--m-clay)] shrink-0">
      <rect x={3} y={5} width={18} height={14} rx={2} />
      <path d="M3 7l9 6 9-6" strokeLinejoin="round" />
    </svg>
  )
}
function DocGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="text-[var(--m-gold)] shrink-0">
      <path d="M6 3h9l4 4v14H6z" strokeLinejoin="round" />
      <path d="M15 3v4h4M9 13h6M9 17h4" strokeLinecap="round" />
    </svg>
  )
}

function Spinner({ light = false }: { light?: boolean }) {
  return (
    <span
      className={`inline-block w-3 h-3 rounded-full border-2 ${
        light ? 'border-white/40 border-t-white' : 'border-[var(--m-border)] border-t-slate-600'
      } animate-spin`}
    />
  )
}

function LeavePanel({
  orgId,
  isManager,
  leaves,
  busy,
  onDecide,
}: {
  orgId: number
  isManager: boolean
  leaves: PendingLeave[]
  busy: string | null
  onDecide: (id: number, decision: 'approve' | 'deny') => void
}) {
  return (
    <div className="rounded-xl border border-[var(--m-border)] bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--m-border-soft)] flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold text-[var(--m-ink)]">Leave Requests</h3>
        <Link
          href={`/org/${orgId}/leaves`}
          className="text-[11.5px] text-[var(--m-ink-3)] hover:text-[var(--m-ink)]"
        >
          All
        </Link>
      </div>
      {leaves.length === 0 ? (
        <p className="px-4 py-5 text-[12px] text-[var(--m-ink-3)]">No pending requests.</p>
      ) : (
        <ul className="divide-y divide-[var(--m-border-soft)]">
          {leaves.slice(0, 3).map((lv) => (
            <li key={lv.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2.5">
                <CharacterAvatar characterKey={lv.user.characterKey} name={lv.user.name} login={lv.user.login} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-[var(--m-ink)] truncate">
                    {lv.user.name ?? `@${lv.user.login}`}
                  </p>
                  <p className="text-[11px] text-[var(--m-ink-3)] truncate">
                    {fmtDateRange(lv.startDate, lv.endDate)}
                  </p>
                </div>
              </div>
              <p className="text-[11.5px] text-[var(--m-ink-2)] leading-snug line-clamp-2">{truncate(lv.reason, 110)}</p>
              {isManager && (
                <div className="flex gap-1.5">
                  <button
                    className="flex-1 px-2 py-1 rounded-md bg-[var(--m-ink)] hover:bg-[var(--m-ink-2)] text-white text-[11.5px] font-medium disabled:opacity-50 transition"
                    disabled={busy === `leave-${lv.id}-approve`}
                    onClick={() => onDecide(lv.id, 'approve')}
                  >
                    Approve
                  </button>
                  <button
                    className="flex-1 px-2 py-1 rounded-md bg-white border border-[var(--m-border)] hover:bg-[var(--m-bg-soft)] text-[var(--m-ink-2)] text-[11.5px] font-medium disabled:opacity-50 transition"
                    disabled={busy === `leave-${lv.id}-deny`}
                    onClick={() => onDecide(lv.id, 'deny')}
                  >
                    Deny
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const CATEGORY_PILL: Record<BreakCategory, { label: string; cls: string }> = {
  focus: { label: 'Focus', cls: 'bg-[var(--m-accent-soft)] text-[var(--m-accent-2)]' },
  meeting: { label: 'Meeting', cls: 'bg-sky-50 text-sky-700' },
  blocked: { label: 'Blocked', cls: 'bg-rose-50 text-rose-700' },
  lunch: { label: 'Lunch', cls: 'bg-amber-50 text-amber-700' },
  errand: { label: 'Errand', cls: 'bg-orange-50 text-orange-700' },
  personal: { label: 'Personal', cls: 'bg-[var(--m-bg-soft)] text-[var(--m-ink-2)]' },
  other: { label: 'Paused', cls: 'bg-[var(--m-bg-soft)] text-[var(--m-ink-2)]' },
}

function BreakPanel({ breaks, orgId }: { breaks: RecentBreak[]; orgId: number }) {
  const ongoing = breaks.filter((b) => !b.endedAt)
  const recent = breaks.filter((b) => b.endedAt)
  const visible = ongoing.length > 0 ? ongoing.slice(0, 4) : recent.slice(0, 4)
  return (
    <div className="rounded-xl border border-[var(--m-border)] bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--m-border-soft)] flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold text-[var(--m-ink)]">
          {ongoing.length > 0 ? 'Currently paused' : 'Recently paused'}
        </h3>
        <Link
          href={`/org/${orgId}/breaks`}
          className="text-[11.5px] text-[var(--m-ink-3)] hover:text-[var(--m-ink)]"
        >
          All
        </Link>
      </div>
      {visible.length === 0 ? (
        <p className="px-4 py-5 text-[12px] text-[var(--m-ink-3)]">Nobody&apos;s paused right now.</p>
      ) : (
        <ul className="divide-y divide-[var(--m-border-soft)]">
          {visible.map((b) => {
            const cat = CATEGORY_PILL[b.category ?? 'other']
            return (
              <li key={b.id} className="px-4 py-2.5 flex items-start gap-2.5">
                <CharacterAvatar characterKey={b.user.characterKey} name={b.user.name} login={b.user.login} size={26} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-medium text-[var(--m-ink)] truncate flex items-center gap-1.5">
                    <span className="truncate">{b.user.name ?? `@${b.user.login}`}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cat.cls}`}>
                      {cat.label}
                    </span>
                  </p>
                  <p className="text-[11px] text-[var(--m-ink-3)] leading-snug truncate" title={b.reason}>
                    {truncate(b.reason, 60)}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ---------- helpers ---------- */

function pct(num: number, denom: number): number {
  if (!denom) return 0
  return Math.round((num / denom) * 100)
}

function humanDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Format seconds as Xh Ym (or just minutes when <60m). */
function formatHm(seconds: number): string {
  return humanDuration(seconds * 1000)
}

/** Split a free-text narrative into 1–3 short bullet points. */
function narrativeBullets(body: string): string[] {
  if (!body) return []
  const cleaned = body.replace(/\s+/g, ' ').trim()
  // Prefer explicit splits on " · " or "; " — that's how MARINA's prompts emit segments
  const segments = cleaned
    .split(/(?:\s+·\s+|;\s+|\.\s+(?=[A-Z]))/)
    .map((s) => s.trim().replace(/^[-–•]\s*/, '').replace(/\.$/, ''))
    .filter((s) => s.length > 0)
  return segments.slice(0, 3)
}

function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

function fmtDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  const fmt = (d: Date, withMonth: boolean) =>
    d.toLocaleDateString(undefined, withMonth ? { day: 'numeric', month: 'short' } : { day: 'numeric' })
  const days = Math.round((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)) + 1
  const label = start === end ? fmt(s, true) : `${fmt(s, !sameMonth)} – ${fmt(e, true)}`
  return `${label} (${days} day${days === 1 ? '' : 's'})`
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function timeSinceLabel(activity: MemberCard['activity'] | undefined): string {
  if (!activity) return ''
  const seconds = activity.activeSeconds + activity.idleSeconds
  if (seconds === 0) return 'today'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function appColor(app: string | null): string {
  if (!app) return '#cbd5e1'
  const palette = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6', '#84cc16', '#f97316']
  let h = 0
  for (let i = 0; i < app.length; i++) h = (h * 31 + app.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

/* ---------- inline icons ---------- */

/**
 * Silent live updater: refreshes the page's RSC tree every 45 seconds while
 * the tab is in the foreground. No spinner, no visible button — just fresh
 * data the next time the user looks.
 */
function LivePoll({ router }: { router: ReturnType<typeof useRouter> }) {
  useEffect(() => {
    const INTERVAL_MS = 45_000
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer) return
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') router.refresh()
      }, INTERVAL_MS)
    }
    const stop = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Catch up immediately when the user returns to the tab
        router.refresh()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [router])

  return null
}

function CalSmallIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} className="inline-block align-[-2px] mr-1">
      <rect x={3} y={4} width={18} height={17} rx={2} />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  )
}
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx={11} cy={11} r={7} />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  )
}
function DotRed() {
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 mr-1" />
}
