'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/toast'
import { ScheduleMeetingDialog } from '@/components/schedule-meeting-dialog'
import { BlockerResolver } from '@/components/blocker-resolver'
import { EmployeeChat } from '@/components/employee-chat'

type Detail = {
  user: {
    id: number
    login: string
    name: string | null
    email: string | null
    avatarUrl?: string | null
    image?: string | null
    hasGithub: boolean
    lastSyncedAt: string | null
    lastSyncError: string | null
  }
  role: string
  discipline: string
  jobTitle: string | null
  workingDays: boolean[]
  birthdayMmDd: string | null
  joinedOn: string | null
  extraCaps: string[]
  latestShift: {
    id: number
    punchedInAt: string
    punchedOutAt: string | null
    workSummary: string | null
    verificationStatus: string
    verificationScore: number | null
  } | null
  shiftTotals: { workMin: number; breakMin: number; idleMin: number }
  recentBreaks: Array<{
    id: number
    category: string
    reason: string
    startedAt: string
    endedAt: string | null
    waitingOnExternal: string | null
  }>
  recentDeliverables: Array<{
    id: number
    title: string
    detail: string | null
    url: string | null
    completedAt: string
    verificationStatus: string
  }>
  todayMeetings: Array<{
    id: number
    title: string
    startAt: string
    endAt: string
    conferenceUrl: string | null
    rsvpStatus: string | null
  }>
  weekMeetingsCount: number
  weekMeetingsMin: number
  recentLeaves: Array<{
    id: number
    startDate: string
    endDate: string
    leaveType: string
    reason: string
    status: 'pending' | 'approved' | 'denied' | 'cancelled'
    decidedNote: string | null
  }>
  devices: Array<{
    id: number
    label: string
    platform: string | null
    agentVersion: string | null
    pairedAt: string
    lastSeenAt: string | null
    revokedAt: string | null
  }>
  story: { narrative: string; generatedAt: string } | null
  narrative: { body: string; signal: string; createdAt: string } | null
  githubEvents: Array<{
    id: number
    type: 'commit' | 'pr_opened' | 'pr_reviewed' | 'issue_closed'
    repo: string
    title: string
    url: string
    occurredAt: string
  }>
  last7DaysOutput: Array<{
    date: string
    commits: number
    prs: number
    reviews: number
    issues: number
    focusMin: number
    onlineMin: number
  }>
  topRepos: Array<{ repo: string; events: number }>
  attendance28d: Array<{
    date: string
    kind: 'present' | 'absent' | 'leave' | 'weekend' | 'today' | 'future' | 'pre_join'
    minutesWorked: number
  }>
  last7Shifts: Array<{
    id: number
    punchedInAt: string
    punchedOutAt: string | null
    totalMin: number
  }>
  risks: Array<{ kind: string; severity: 'low' | 'medium' | 'high'; label: string }>
}

/**
 * Comprehensive employee profile page.
 *
 * Designed for two personas who land here from different contexts:
 *
 *   1. Manager prepping for a 1:1 — needs everything visible to drive the
 *      conversation: what shipped, what's blocked, what's coming up.
 *   2. Admin doing a performance check or HR action — needs the deeper
 *      record (attendance, shifts, leaves, paired devices, profile fields).
 *
 * Action buttons are sticky in the header so the page is task-flow ready:
 *   • Brief             — regenerate the AI narrative (refreshes signals)
 *   • Schedule meeting  — book a 1:1
 *   • Resolve blocker   — opens the resolver flow when there's an active block
 *   • Performance review — opens the printable PDF route
 *   • Sync GitHub        — for engineers with GitHub linked
 *
 * The content is two-column on desktop, single-column on mobile. The day
 * picker filters deliverables + breaks in-place so a manager can answer
 * "what did you do on Tuesday?" without leaving the page.
 */
export function ProfilePageClient({
  orgId,
  membershipId,
  canViewReports = false,
}: {
  orgId: number
  membershipId: number
  /** Whether the viewer can open the per-employee performance report (view_all_data). */
  canViewReports?: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [resolverBreakId, setResolverBreakId] = useState<number | null>(null)
  const [day, setDay] = useState<string>(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/orgs/${orgId}/members/${membershipId}/detail`, { cache: 'no-store' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error || 'failed to load')
        }
        const data = (await res.json()) as Detail
        if (!cancelled) setDetail(data)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, membershipId])

  async function regenBrief() {
    if (!detail) return
    setBusy('brief')
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${membershipId}/narrative`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('brief failed')
      // Re-fetch detail to pick up the new narrative.
      const fresh = await fetch(`/api/orgs/${orgId}/members/${membershipId}/detail`)
      if (fresh.ok) setDetail(await fresh.json())
      toast.push({ kind: 'success', title: 'Brief regenerated' })
    } catch (e) {
      toast.push({ kind: 'error', title: 'Brief failed', body: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  async function syncGitHub() {
    setBusy('sync')
    try {
      const res = await fetch(`/api/orgs/${orgId}/members/${membershipId}/sync`, { method: 'POST' })
      if (!res.ok) throw new Error('sync failed')
      const fresh = await fetch(`/api/orgs/${orgId}/members/${membershipId}/detail`)
      if (fresh.ok) setDetail(await fresh.json())
      toast.push({ kind: 'success', title: 'GitHub synced' })
    } catch (e) {
      toast.push({ kind: 'error', title: 'Sync failed', body: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  function openPerformanceReview() {
    if (!detail) return
    const today = new Date()
    const from = new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 10)
    const to = today.toISOString().slice(0, 10)
    window.open(
      `/org/${orgId}/reports/performance?userId=${detail.user.id}&from=${from}&to=${to}`,
      '_blank',
      'noopener,noreferrer',
    )
  }

  // Derived state
  const activeBreak = useMemo(
    () => (detail ? detail.recentBreaks.find((b) => !b.endedAt) ?? null : null),
    [detail],
  )

  if (error) {
    return (
      <p className="text-[13px] text-rose-600 px-4 py-6 rounded-xl border border-rose-200 bg-rose-50">
        {error}
      </p>
    )
  }
  if (!detail) {
    return (
      <div className="space-y-3">
        <div className="h-12 rounded-xl bg-[var(--m-bg-soft)] animate-pulse" />
        <div className="h-24 rounded-xl bg-[var(--m-bg-soft)] animate-pulse" />
        <div className="h-40 rounded-xl bg-[var(--m-bg-soft)] animate-pulse" />
        <div className="h-40 rounded-xl bg-[var(--m-bg-soft)] animate-pulse" />
      </div>
    )
  }

  const isOnShift = !!detail.latestShift && !detail.latestShift.punchedOutAt
  const onLeaveToday = detail.recentLeaves.find(
    (l) => l.status === 'approved' && l.startDate <= day && l.endDate >= day,
  )
  const status: { label: string; cls: string } = onLeaveToday
    ? { label: `On leave · ${onLeaveToday.leaveType}`, cls: 'bg-amber-50 text-amber-700 border-amber-200' }
    : activeBreak?.category === 'blocked'
      ? { label: 'Blocked', cls: 'bg-rose-50 text-rose-700 border-rose-200' }
      : activeBreak
        ? { label: `Break · ${activeBreak.category}`, cls: 'bg-amber-50 text-amber-700 border-amber-200' }
        : isOnShift
          ? { label: 'Working', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
          : { label: 'Off-clock', cls: 'bg-[var(--m-bg-soft)] text-[var(--m-ink-2)] border-[var(--m-border)]' }

  const todayIso = new Date().toISOString().slice(0, 10)
  const dayDeliverables = detail.recentDeliverables.filter((d) => d.completedAt.slice(0, 10) === day)
  const dayBreaks = detail.recentBreaks.filter((b) => b.startedAt.slice(0, 10) === day)

  const ghLast7 = detail.last7DaysOutput.reduce(
    (acc, d) => acc + d.commits + d.prs + d.reviews + d.issues,
    0,
  )
  const shipped7d =
    ghLast7 +
    detail.recentDeliverables.filter((d) => new Date(d.completedAt).getTime() > Date.now() - 7 * 86400000).length

  const pairedDevices = detail.devices.filter((d) => !d.revokedAt)
  const tenureStr = (() => {
    if (!detail.joinedOn) return null
    const days = Math.floor(
      (Date.now() - new Date(detail.joinedOn + 'T00:00:00').getTime()) / 86400000,
    )
    if (days < 0) return null
    if (days < 30) return `${days}d`
    if (days < 365) return `${Math.floor(days / 30)}mo`
    return `${(days / 365).toFixed(1)}y`
  })()

  return (
    <div className="space-y-5 pb-16">
      {/* Action bar — sticky behaviour so the actions are always within reach
          as the manager scrolls through the long page. */}
      <section className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-[var(--m-border-soft)]">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className={`text-[12px] font-medium px-2.5 py-1 rounded-full border ${status.cls}`}>
            {status.label}
          </span>
          {tenureStr && (
            <span className="text-[11.5px] text-[var(--m-ink-3)]">
              with the team {tenureStr}
            </span>
          )}
          {detail.discipline !== 'other' && (
            <span className="text-[11.5px] text-[var(--m-ink-3)] capitalize">
              {detail.discipline}
            </span>
          )}
          {detail.user.lastSyncError && (
            <span className="text-[11.5px] text-rose-600">
              GitHub sync error
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
          {activeBreak?.category === 'blocked' && (
            <button
              type="button"
              onClick={() => setResolverBreakId(activeBreak.id)}
              className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-[12.5px] font-medium transition"
            >
              Resolve blocker
            </button>
          )}
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="px-3 py-1.5 rounded-md bg-white border border-[var(--m-border)] hover:bg-[var(--m-bg-soft)] text-[12.5px] font-medium text-[var(--m-ink-2)] transition"
          >
            Schedule meeting
          </button>
          {detail.user.hasGithub && (
            <button
              type="button"
              onClick={syncGitHub}
              disabled={busy !== null}
              className="px-3 py-1.5 rounded-md bg-white border border-[var(--m-border)] hover:bg-[var(--m-bg-soft)] text-[12.5px] font-medium text-[var(--m-ink-2)] disabled:opacity-50 transition"
            >
              {busy === 'sync' ? 'Syncing…' : 'Sync GitHub'}
            </button>
          )}
          <button
            type="button"
            onClick={regenBrief}
            disabled={busy !== null}
            className="px-3 py-1.5 rounded-md bg-[var(--m-accent)] hover:bg-[var(--m-accent-2)] text-white text-[12.5px] font-medium disabled:opacity-50 transition"
          >
            {busy === 'brief' ? 'Briefing…' : 'Brief'}
          </button>
          {canViewReports && (
            <button
              type="button"
              onClick={openPerformanceReview}
              className="px-3 py-1.5 rounded-md bg-[var(--m-ink)] hover:bg-[var(--m-ink-2)] text-white text-[12.5px] font-medium transition"
            >
              Performance review
            </button>
          )}
        </div>
      </section>

      {/* Active blocker callout — top because it's the most urgent thing */}
      {activeBreak?.category === 'blocked' && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-[10.5px] uppercase tracking-wider text-rose-700 font-semibold">
                Active blocker · {Math.floor((Date.now() - new Date(activeBreak.startedAt).getTime()) / 60000)}m open
              </p>
              <p className="text-[13.5px] text-rose-900 mt-1">
                {activeBreak.reason || '(no reason given)'}
              </p>
              {activeBreak.waitingOnExternal && (
                <p className="text-[11.5px] text-rose-700 mt-0.5">Waiting on {activeBreak.waitingOnExternal}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setResolverBreakId(activeBreak.id)}
              className="shrink-0 text-[12px] font-medium px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white transition"
            >
              Resolve →
            </button>
          </div>
        </section>
      )}

      {/* KPI snapshot */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Today" value={isOnShift ? fmtHm(detail.shiftTotals.workMin) : '—'} sub={isOnShift ? 'on the clock' : 'not punched in'} />
        <Kpi label="Shipped · 7d" value={shipped7d.toString()} sub="commits + PRs + deliverables" />
        <Kpi label="Meetings · week" value={detail.weekMeetingsCount.toString()} sub={`${fmtHm(detail.weekMeetingsMin)} of cal time`} />
        <Kpi label="Agent" value={pairedDevices.length.toString()} sub={pairedDevices.length === 0 ? 'no paired device' : pairedDevices[0].platform ?? 'paired'} tone={pairedDevices.length === 0 ? 'warn' : 'neutral'} />
      </section>

      {/* Risks */}
      {detail.risks.length > 0 && (
        <Section title="Worth your attention">
          <ul className="flex flex-wrap gap-1.5">
            {detail.risks.map((r, i) => {
              const cls =
                r.severity === 'high'
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : r.severity === 'medium'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-[var(--m-bg-soft)] text-[var(--m-ink-2)] border-[var(--m-border)]'
              return (
                <li key={i} className={`text-[11.5px] px-2 py-1 rounded-md border ${cls}`}>
                  {r.label}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Left column · activity + day picker */}
        <div className="lg:col-span-2 space-y-5">
          {detail.story && (
            <Section title="Today's story" hint={fmtAgo(detail.story.generatedAt)}>
              <p className="text-[13.5px] text-[var(--m-ink-2)] leading-relaxed whitespace-pre-line">
                {detail.story.narrative}
              </p>
            </Section>
          )}

          {detail.narrative && (
            <Section
              title="Latest brief"
              hint={fmtAgo(detail.narrative.createdAt)}
              chip={<SignalPill signal={detail.narrative.signal} />}
            >
              <p className="text-[13px] text-[var(--m-ink-2)] leading-relaxed whitespace-pre-line">
                {detail.narrative.body}
              </p>
            </Section>
          )}

          {detail.todayMeetings.length > 0 && (
            <Section title="Today's meetings" hint={`${detail.todayMeetings.length} scheduled`}>
              <ul className="divide-y divide-[var(--m-border-soft)]">
                {detail.todayMeetings.map((m) => (
                  <li key={m.id} className="py-2 flex items-center gap-3">
                    <span className="text-[11px] text-[var(--m-ink-3)] tabular-nums w-28 shrink-0">
                      {new Date(m.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} – {new Date(m.endAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </span>
                    <span className="text-[13px] text-[var(--m-ink)] flex-1 truncate">{m.title}</span>
                    {m.conferenceUrl && (
                      <a href={m.conferenceUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] text-[var(--m-accent)] hover:underline shrink-0">
                        Join →
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section
            title="Jump to a day"
            hint={day === todayIso ? 'today' : day}
            right={
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                max={todayIso}
                className="px-2 py-1 rounded-md bg-white border border-[var(--m-border)] text-[12px]"
              />
            }
          >
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-[10.5px] uppercase tracking-wider text-[var(--m-ink-3)] font-semibold mb-2">
                  Deliverables ({dayDeliverables.length})
                </p>
                {dayDeliverables.length === 0 ? (
                  <p className="text-[12.5px] text-[var(--m-ink-3)] italic">Nothing logged on this day.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {dayDeliverables.map((d) => (
                      <li key={d.id} className="text-[12.5px] text-[var(--m-ink-2)]">
                        <span className="text-[var(--m-ink-4)] text-[10.5px] tabular-nums mr-1.5">
                          {new Date(d.completedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </span>
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                            {d.title}
                          </a>
                        ) : (
                          d.title
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-[10.5px] uppercase tracking-wider text-[var(--m-ink-3)] font-semibold mb-2">
                  Breaks ({dayBreaks.length})
                </p>
                {dayBreaks.length === 0 ? (
                  <p className="text-[12.5px] text-[var(--m-ink-3)] italic">No breaks logged this day.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {dayBreaks.map((b) => (
                      <li key={b.id} className="text-[12.5px] text-[var(--m-ink-2)]">
                        <span className={`text-[10px] uppercase tracking-wider mr-1.5 ${b.category === 'blocked' ? 'text-rose-700 font-semibold' : 'text-[var(--m-ink-3)]'}`}>
                          {b.category}
                        </span>
                        {b.reason || '(no reason)'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Section>

          {detail.recentDeliverables.length > 0 && (
            <Section title="Recent deliverables" hint="last 14 days">
              <ul className="divide-y divide-[var(--m-border-soft)]">
                {detail.recentDeliverables.slice(0, 12).map((d) => (
                  <li key={d.id} className="py-2 flex items-start gap-3">
                    <span className="text-[11px] text-[var(--m-ink-3)] tabular-nums w-20 shrink-0">
                      {new Date(d.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                    <div className="min-w-0 flex-1">
                      {d.url ? (
                        <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[var(--m-ink)] hover:underline">
                          {d.title}
                        </a>
                      ) : (
                        <span className="text-[13px] text-[var(--m-ink)]">{d.title}</span>
                      )}
                    </div>
                    {d.verificationStatus === 'verified' && (
                      <span className="text-[10.5px] text-emerald-700 font-medium shrink-0">verified</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {detail.githubEvents.length > 0 && (
            <Section title="GitHub activity" hint={`latest ${Math.min(20, detail.githubEvents.length)}`}>
              <ul className="divide-y divide-[var(--m-border-soft)]">
                {detail.githubEvents.slice(0, 20).map((e) => (
                  <li key={e.id} className="py-2 flex items-center gap-3">
                    <span className="text-[10.5px] uppercase tracking-wider text-[var(--m-ink-3)] w-20 shrink-0">
                      {e.type.replace('_', ' ')}
                    </span>
                    <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[var(--m-ink)] hover:underline truncate flex-1">
                      {e.title}
                    </a>
                    <span className="text-[10.5px] text-[var(--m-ink-3)] shrink-0 truncate max-w-[180px]">{e.repo}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {detail.last7Shifts.length > 0 && (
            <Section title="Recent shifts" hint="last 7 days">
              <ul className="divide-y divide-[var(--m-border-soft)]">
                {detail.last7Shifts.map((s) => (
                  <li key={s.id} className="py-2 flex items-center gap-3">
                    <span className="text-[11px] text-[var(--m-ink-3)] tabular-nums w-32 shrink-0">
                      {new Date(s.punchedInAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    <span className="text-[12.5px] text-[var(--m-ink-2)] flex-1 tabular-nums">
                      {new Date(s.punchedInAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      {' – '}
                      {s.punchedOutAt
                        ? new Date(s.punchedOutAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                        : 'in progress'}
                    </span>
                    <span className="text-[12.5px] text-[var(--m-ink)] tabular-nums shrink-0">{fmtHm(s.totalMin)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        {/* Right column · profile + trends */}
        <div className="space-y-5">
          {detail.last7DaysOutput.length > 0 && (
            <Section title="7-day output">
              <div className="grid grid-cols-7 gap-1">
                {detail.last7DaysOutput.map((d) => {
                  const total = d.commits + d.prs + d.reviews + d.issues
                  return (
                    <div key={d.date} className="text-center" title={`${d.date}: ${total} events · ${fmtHm(d.focusMin)} focus`}>
                      <div className="h-10 rounded-md bg-[var(--m-bg-soft)] relative overflow-hidden">
                        <div
                          className="absolute bottom-0 left-0 right-0 bg-[var(--m-accent)] rounded-md"
                          style={{ height: `${Math.min(100, total * 8)}%` }}
                        />
                      </div>
                      <p className="text-[9.5px] text-[var(--m-ink-3)] mt-1 tabular-nums">{total}</p>
                      <p className="text-[8.5px] uppercase tracking-wider text-[var(--m-ink-4)]">
                        {new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1)}
                      </p>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {detail.topRepos.length > 0 && (
            <Section title="Top repos · 7d">
              <ul className="space-y-1">
                {detail.topRepos.slice(0, 5).map((r) => (
                  <li key={r.repo} className="flex items-center justify-between text-[12.5px]">
                    <span className="text-[var(--m-ink-2)] truncate">{r.repo}</span>
                    <span className="text-[var(--m-ink-3)] tabular-nums shrink-0">{r.events}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {detail.attendance28d.length > 0 && (
            <Section title="Attendance · 28d">
              <div className="grid grid-cols-7 gap-1">
                {detail.attendance28d.map((a) => {
                  const cls =
                    a.kind === 'present'
                      ? 'bg-emerald-200'
                      : a.kind === 'leave'
                        ? 'bg-amber-200'
                        : a.kind === 'absent'
                          ? 'bg-rose-200'
                          : a.kind === 'today'
                            ? 'bg-[var(--m-accent)]'
                            : a.kind === 'pre_join'
                              ? 'bg-[var(--m-bg-soft)]'
                              : 'bg-[var(--m-bg-soft)]'
                  return (
                    <div
                      key={a.date}
                      className={`aspect-square rounded-sm ${cls}`}
                      title={`${a.date} · ${a.kind}${a.minutesWorked ? ` · ${fmtHm(a.minutesWorked)}` : ''}`}
                    />
                  )
                })}
              </div>
              <div className="mt-3 flex items-center gap-3 text-[10.5px] text-[var(--m-ink-3)] flex-wrap">
                <Legend cls="bg-emerald-200" label="Present" />
                <Legend cls="bg-amber-200" label="Leave" />
                <Legend cls="bg-rose-200" label="Absent" />
                <Legend cls="bg-[var(--m-bg-soft)]" label="Weekend" />
              </div>
            </Section>
          )}

          {pairedDevices.length > 0 && (
            <Section title="Paired devices" hint={`${pairedDevices.length} active`}>
              <ul className="space-y-2">
                {pairedDevices.map((d) => {
                  const onlineMs = d.lastSeenAt ? Date.now() - new Date(d.lastSeenAt).getTime() : Infinity
                  const isOnline = onlineMs < 24 * 60 * 60 * 1000
                  return (
                    <li key={d.id} className="text-[12.5px] flex items-center gap-2.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? 'bg-emerald-500' : 'bg-[var(--m-ink-5)]'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[var(--m-ink)] truncate">{d.label}</p>
                        <p className="text-[10.5px] text-[var(--m-ink-3)] truncate">
                          {d.platform ?? 'unknown'} · v{d.agentVersion ?? '?'} · last {fmtAgo(d.lastSeenAt)}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Section>
          )}

          {detail.recentLeaves.length > 0 && (
            <Section title="Recent leaves" hint="last 60 days">
              <ul className="space-y-2">
                {detail.recentLeaves.slice(0, 5).map((l) => (
                  <li key={l.id} className="text-[12.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[var(--m-ink)] capitalize">{l.leaveType}</span>
                      <span className={`text-[10.5px] px-1.5 py-0.5 rounded-full capitalize ${
                        l.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                        l.status === 'denied' ? 'bg-rose-100 text-rose-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{l.status}</span>
                    </div>
                    <p className="text-[10.5px] text-[var(--m-ink-3)] mt-0.5">
                      {l.startDate} → {l.endDate}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="About">
            <dl className="space-y-1.5 text-[12.5px]">
              <Field label="Role" value={detail.role} />
              {detail.jobTitle && <Field label="Job title" value={detail.jobTitle} />}
              {detail.user.email && <Field label="Email" value={detail.user.email} />}
              <Field label="Discipline" value={detail.discipline} />
              <Field label="GitHub" value={detail.user.hasGithub ? 'Linked' : 'Not linked'} />
              {detail.joinedOn && <Field label="Joined" value={new Date(detail.joinedOn + 'T00:00:00').toLocaleDateString()} />}
              {detail.birthdayMmDd && <Field label="Birthday" value={prettyMmDd(detail.birthdayMmDd)} />}
              <Field label="Working days" value={fmtWorkingDays(detail.workingDays)} />
              {detail.extraCaps.length > 0 && (
                <Field label="Capabilities" value={detail.extraCaps.join(', ')} />
              )}
            </dl>
          </Section>
        </div>
      </div>

      {/* Ask MARINA — the USP. Full-width below the data sections so a
          manager can scroll past the dashboards and "just ask" rather than
          synthesising the answer from the tiles themselves. */}
      <EmployeeChat
        orgId={orgId}
        membershipId={membershipId}
        employeeFirstName={
          (detail.user.name?.split(' ')[0] ?? `@${detail.user.login}`) || 'them'
        }
      />

      {/* Dialogs */}
      <ScheduleMeetingDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        orgId={orgId}
        membershipId={membershipId}
        attendeeName={detail.user.name ?? `@${detail.user.login}`}
      />
      <BlockerResolver
        orgId={orgId}
        breakId={resolverBreakId}
        open={resolverBreakId !== null}
        onClose={() => setResolverBreakId(null)}
        onResolved={() => {
          setResolverBreakId(null)
          router.refresh()
          void fetch(`/api/orgs/${orgId}/members/${membershipId}/detail`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d && setDetail(d))
        }}
      />
    </div>
  )
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: 'warn' | 'neutral'
}) {
  const fg = tone === 'warn' ? 'text-amber-700' : 'text-[var(--m-ink)]'
  return (
    <div className="rounded-xl border border-[var(--m-border)] bg-white px-4 py-3.5">
      <p className="text-[10.5px] uppercase tracking-widest text-[var(--m-ink-3)] font-medium">{label}</p>
      <p className={`mt-1 text-[22px] tracking-tight tabular-nums ${fg}`}>{value}</p>
      <p className="text-[11px] text-[var(--m-ink-3)] mt-0.5 truncate">{sub}</p>
    </div>
  )
}

function Section({
  title,
  hint,
  right,
  chip,
  children,
}: {
  title: string
  hint?: string
  right?: React.ReactNode
  chip?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-[var(--m-border)] bg-white p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <p className="text-[11px] uppercase tracking-widest text-[var(--m-ink-3)] font-semibold">
            {title}
          </p>
          {chip}
          {hint && <span className="text-[11.5px] text-[var(--m-ink-3)]">· {hint}</span>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-[10.5px] uppercase tracking-wider text-[var(--m-ink-3)] font-semibold w-24 shrink-0">
        {label}
      </dt>
      <dd className="text-[var(--m-ink)] capitalize">{value}</dd>
    </div>
  )
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2.5 h-2.5 rounded-sm border border-[var(--m-border)] ${cls}`} />
      {label}
    </span>
  )
}

function SignalPill({ signal }: { signal: string }) {
  const cls =
    signal === 'High'
      ? 'bg-emerald-100 text-emerald-700'
      : signal === 'Steady'
        ? 'bg-sky-100 text-sky-700'
        : signal === 'Blocked'
          ? 'bg-rose-100 text-rose-700'
          : 'bg-amber-100 text-amber-700'
  return <span className={`text-[10.5px] font-medium px-1.5 py-0.5 rounded-full ${cls}`}>{signal}</span>
}

function fmtHm(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

function fmtAgo(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtWorkingDays(days: boolean[]): string {
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days.map((on, i) => (on ? labels[i] : null)).filter(Boolean).join(', ') || 'None set'
}

function prettyMmDd(mmDd: string): string {
  const [mm, dd] = mmDd.split('-')
  const d = new Date(Date.UTC(2000, Number(mm) - 1, Number(dd)))
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
}
