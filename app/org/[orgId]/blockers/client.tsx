'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CharacterAvatar } from '@/components/character-avatar'
import type { UnblockStats } from '@/lib/brief/early-warnings'
import { BlockerResolver } from '@/components/blocker-resolver'
import { TutorialHint } from '@/components/tutorial-hint'

type Person = {
  id: number
  login: string
  name: string | null
  characterKey: string | null
}

type Blocker = {
  id: number
  startedAt: string
  endedAt: string | null
  minutesElapsed: number
  reason: string
  waitingOnExternal: string | null
  waitingOnUser: Person | null
  resolutionType: string | null
  resolutionNote: string | null
  blockedUser: Person
}

type Tab = 'active' | 'resolved'

/**
 * Unified blockers workflow page. The visual model is borrowed from the
 * landing-page Blocker Resolver mockup: each row reads like a single,
 * scannable card with the blocked person on the left, the wait target on
 * the right, and a one-tap "Open" action that opens the existing
 * BlockerResolver modal we already use elsewhere.
 *
 * Sort options:
 *   - Stuck longest (default for active — the things that need a manager NOW)
 *   - Most recent (for resolved — the latest wins)
 */
export default function BlockersClient({
  orgId,
  active,
  resolved,
  initialOpenId = null,
  stats,
}: {
  orgId: number
  /** Blocker to open on load, when it is one of the listed ones. */
  initialOpenId?: number | null
  /** Time-to-unblock figures from resolved blockers. */
  stats?: UnblockStats
  active: Blocker[]
  resolved: Blocker[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('active')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  // Deep link (`?open=<breakId>`): open after mount, never during the first
  // render — the modal is client-only, so opening it in initial state would
  // not match the server HTML.
  const deepLinkId =
    initialOpenId != null && [...active, ...resolved].some((b) => b.id === initialOpenId) ? initialOpenId : null
  useEffect(() => {
    if (deepLinkId == null) return
    const frame = requestAnimationFrame(() => setOpenId(deepLinkId))
    return () => cancelAnimationFrame(frame)
    // Only on first mount: later list refreshes must not reopen a closed modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const list = tab === 'active' ? active : resolved
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (b) =>
        b.blockedUser.name?.toLowerCase().includes(q) ||
        b.blockedUser.login.toLowerCase().includes(q) ||
        b.reason.toLowerCase().includes(q) ||
        b.waitingOnUser?.name?.toLowerCase().includes(q) ||
        b.waitingOnUser?.login?.toLowerCase().includes(q) ||
        b.waitingOnExternal?.toLowerCase().includes(q),
    )
  }, [list, search])

  // Buckets — stuck > 4h is loud-red, > 1h is amber, fresh is neutral.
  const stuckLong = active.filter((b) => b.minutesElapsed >= 240).length
  const stuckMed = active.filter((b) => b.minutesElapsed >= 60 && b.minutesElapsed < 240).length

  return (
    <>
      <div className="mb-3 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="app-h1">Blockers</h1>
          <p className="mt-1.5 text-[13px] text-[var(--m-ink-2)]">
            One queue for everything the team is stuck on. Triage in the order they need
            you — longest stuck first — and clear them with one click each.
          </p>
        </div>
        {tab === 'active' && active.length > 0 && (
          <div className="flex items-center gap-2 text-[12px] flex-wrap">
            {stuckLong > 0 && (
              <Pill tone="bad">
                <Pulse /> {stuckLong} stuck &gt;4h
              </Pill>
            )}
            {stuckMed > 0 && <Pill tone="warn">{stuckMed} stuck &gt;1h</Pill>}
            <Pill tone="good">
              {active.length} active
            </Pill>
          </div>
        )}
      </div>

      {stats && (
        <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-2" data-testid="unblock-stats">
          <StatTile
            label={`Median time to unblock · last ${stats.windowDays} days`}
            value={stats.medianMinutes == null ? '—' : fmtDuration(stats.medianMinutes)}
            hint={
              stats.resolvedCount === 0
                ? 'No blockers resolved in this period yet'
                : `From ${stats.resolvedCount} resolved blocker${stats.resolvedCount === 1 ? '' : 's'}`
            }
          />
          <StatTile
            label="Cleared with help"
            value={stats.medianHelpedMinutes == null ? '—' : fmtDuration(stats.medianHelpedMinutes)}
            hint={`${stats.helpedCount} resolved by a manager or teammate (median)`}
          />
          <StatTile
            label="Cleared on their own"
            value={stats.medianSelfMinutes == null ? '—' : fmtDuration(stats.medianSelfMinutes)}
            hint={`${stats.selfCount} ended by the blocked person (median)`}
          />
        </div>
      )}

      <div className="mb-3">
        <TutorialHint id="blockers-page-intro" title="Run this like a manager queue">
          Tap any row to open the Resolver — you can <b>Unblock</b>, <b>Nudge</b> the
          waited-on teammate, or <b>Route</b> to a backup if the original blocker is on
          leave. Everything you do here is logged in the blocker thread.
        </TutorialHint>
      </div>

      {/* Tab strip + search */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex bg-white border border-[var(--m-border)] rounded-lg p-0.5">
          <TabButton active={tab === 'active'} onClick={() => setTab('active')}>
            Active{' '}
            <span className="ml-1 text-[var(--m-ink-4)] tabular-nums">{active.length}</span>
          </TabButton>
          <TabButton active={tab === 'resolved'} onClick={() => setTab('resolved')}>
            Resolved (7d){' '}
            <span className="ml-1 text-[var(--m-ink-4)] tabular-nums">{resolved.length}</span>
          </TabButton>
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name, reason, or teammate…"
          className="input w-72 max-w-full"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <ul className="space-y-2.5">
          {visible.map((b) => (
            <li key={b.id}>
              <BlockerRow
                blocker={b}
                onOpen={() => setOpenId(b.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <BlockerResolver
        orgId={orgId}
        breakId={openId}
        open={openId !== null}
        onClose={() => setOpenId(null)}
        onResolved={() => {
          setOpenId(null)
          router.refresh()
        }}
      />
    </>
  )
}

/* ----------------------------- one row ----------------------------- */

function BlockerRow({
  blocker,
  onOpen,
}: {
  blocker: Blocker
  onOpen: () => void
}) {
  const isResolved = !!blocker.endedAt
  const long = blocker.minutesElapsed >= 240
  const medium = !long && blocker.minutesElapsed >= 60

  const elapsed = formatElapsed(blocker.minutesElapsed)

  const accent = isResolved
    ? 'border-l-[var(--m-good)]/40 bg-[var(--m-good-soft)]/30'
    : long
      ? 'border-l-[var(--m-bad)] bg-[var(--m-bad-soft)]/40'
      : medium
        ? 'border-l-[var(--m-warn)] bg-[var(--m-warn-soft)]/40'
        : 'border-l-[var(--m-accent)]/60 bg-white'

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group w-full text-left rounded-xl border border-[var(--m-border)] border-l-[3px] ${accent} hover:border-[var(--m-border)] hover:shadow-[var(--m-shadow)] transition-all px-4 py-3.5 flex items-center gap-3 flex-wrap`}
    >
      {/* Blocked person */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <CharacterAvatar characterKey={blocker.blockedUser.characterKey} name={blocker.blockedUser.name} login={blocker.blockedUser.login} size={36} />
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-[var(--m-ink)] truncate">
            {blocker.blockedUser.name ?? `@${blocker.blockedUser.login}`}
          </p>
          <p className="text-[13px] text-[var(--m-ink-2)] leading-snug line-clamp-2">
            {blocker.reason}
          </p>
        </div>
      </div>

      {/* Arrow + waiting-on */}
      {(blocker.waitingOnUser || blocker.waitingOnExternal) && (
        <div className="flex items-center gap-2 shrink-0">
          <ArrowRight />
          <div className="flex items-center gap-2">
            {blocker.waitingOnUser ? (
              <>
                <CharacterAvatar characterKey={blocker.waitingOnUser.characterKey} name={blocker.waitingOnUser.name} login={blocker.waitingOnUser.login} size={26} />
                <span className="text-[12.5px] text-[var(--m-ink-2)] font-medium">
                  {blocker.waitingOnUser.name ?? `@${blocker.waitingOnUser.login}`}
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-[var(--m-ink-2)] font-medium">
                <span className="w-5 h-5 rounded-full bg-[var(--m-bg-soft)] inline-flex items-center justify-center text-[var(--m-ink-4)] text-[10px]">
                  ?
                </span>
                {blocker.waitingOnExternal}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stuck timer or resolved badge */}
      <div className="shrink-0 ml-auto flex items-center gap-2">
        {isResolved ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full bg-[var(--m-good-soft)] text-[var(--m-good)]">
            ✓ {blocker.resolutionType ?? 'resolved'} · {elapsed}
          </span>
        ) : (
          <span
            className={`inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full tabular-nums ${
              long
                ? 'bg-[var(--m-bad-soft)] text-[var(--m-bad)]'
                : medium
                  ? 'bg-[var(--m-warn-soft)] text-[var(--m-warn)]'
                  : 'bg-[var(--m-bg-soft)] text-[var(--m-ink-2)]'
            }`}
          >
            {!isResolved && <Pulse small />}
            {elapsed} stuck
          </span>
        )}
        <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-[var(--m-ink-4)]">
          Open →
        </span>
      </div>
    </button>
  )
}

/* ----------------------------- bits ----------------------------- */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-[12.5px] font-medium transition ${
        active
          ? 'bg-[var(--m-ink)] text-white shadow-sm'
          : 'text-[var(--m-ink-2)] hover:text-[var(--m-ink)] hover:bg-[var(--m-bg-soft)]'
      }`}
    >
      {children}
    </button>
  )
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`
}

function StatTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-[var(--m-border)] bg-white px-4 py-3">
      <p className="text-[10.5px] uppercase tracking-wider text-[var(--m-ink-3)]">{label}</p>
      <p className="mt-1 text-[22px] font-semibold text-[var(--m-ink)] tabular-nums leading-none">{value}</p>
      <p className="mt-1.5 text-[11.5px] text-[var(--m-ink-3)]">{hint}</p>
    </div>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: 'good' | 'warn' | 'bad'
  children: React.ReactNode
}) {
  const cls = {
    good: 'bg-[var(--m-good-soft)] text-[var(--m-good)]',
    warn: 'bg-[var(--m-warn-soft)] text-[var(--m-warn)]',
    bad: 'bg-[var(--m-bad-soft)] text-[var(--m-bad)]',
  }[tone]
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-0.5 rounded-full tabular-nums ${cls}`}
    >
      {children}
    </span>
  )
}

function Pulse({ small = false }: { small?: boolean }) {
  return (
    <span className="relative inline-flex">
      <span
        className="absolute inset-0 rounded-full bg-current opacity-40 animate-ping"
      />
      <span
        className={`relative inline-block rounded-full bg-current ${
          small ? 'w-1 h-1' : 'w-1.5 h-1.5'
        }`}
      />
    </span>
  )
}

function ArrowRight() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="text-[var(--m-ink-5)]"
    >
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="rounded-xl border border-[var(--m-border)] bg-white px-6 py-10 text-center">
      <p className="font-display text-[22px] text-[var(--m-ink)] leading-tight">
        {tab === 'active' ? 'No blockers right now.' : 'No resolved blockers this week.'}
      </p>
      <p className="mt-1.5 text-[13px] text-[var(--m-ink-3)]">
        {tab === 'active'
          ? 'When someone marks themselves blocked, they’ll show up here. Refresh anytime.'
          : 'Once you resolve a blocker, it’ll appear here for the next seven days.'}
      </p>
    </div>
  )
}

function formatElapsed(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}
