'use client'

import { useMemo } from 'react'
import { STATE_DISPLAY } from '@/lib/engine/state-labels'
import Link from 'next/link'
import { CharacterAvatar } from '@/components/character-avatar'
import { TeamMeetingScheduler } from '@/components/team-meeting-scheduler'

type Github = { commits: number; prs: number; reviews: number; issues: number; total: number }

type TeamMember = {
  userId: number
  membershipId: number
  name: string | null
  login: string
  avatarUrl: string | null
  characterKey: string | null
  role: string
  discipline: string
  jobTitle: string | null
  isLead: boolean
  weekHours: number
  dailyState: string | null
  efficiency: number | null
  github: Github
  postedStandup: boolean
}

type Standup = {
  userId: number
  membershipId: number | null
  name: string | null
  login: string
  avatarUrl: string | null
  characterKey: string | null
  yesterday: string
  today: string
  blockers: string
}

type Break = {
  id: number
  userId: number
  membershipId: number | null
  name: string | null
  login: string
  avatarUrl: string | null
  characterKey: string | null
  category: string
  reason: string
  startedAt: string
  endedAt: string | null
  active: boolean
}

type Lead = {
  name: string | null
  login: string
  avatarUrl: string | null
  characterKey: string | null
  membershipId: number
} | null

// Labels come from the shared map so the manager and the employee read the
// same words (see lib/engine/state-labels.ts).
const STATE_STYLE: Record<string, { label: string; cls: string }> = {
  High: { label: STATE_DISPLAY.High.label, cls: 'bg-[var(--m-good)]/12 text-[var(--m-good)]' },
  Steady: { label: STATE_DISPLAY.Steady.label, cls: 'bg-[var(--m-accent-soft)] text-[var(--m-accent-2)]' },
  Blocked: { label: STATE_DISPLAY.Blocked.label, cls: 'bg-[var(--m-bad)]/12 text-[var(--m-bad)]' },
  Disengaged: { label: STATE_DISPLAY.Disengaged.label, cls: 'bg-[var(--m-warn)]/15 text-[var(--m-warn)]' },
  PossiblyDummying: { label: STATE_DISPLAY.PossiblyDummying.label, cls: 'bg-[var(--m-warn)]/15 text-[var(--m-warn)]' },
  NoData: { label: STATE_DISPLAY.NoData.label, cls: 'bg-[var(--m-bg-soft)] text-[var(--m-ink-4)]' },
}

const BREAK_LABEL: Record<string, string> = {
  focus: 'Focus time',
  meeting: 'In a meeting',
  blocked: 'Blocked / Waiting',
  lunch: 'Lunch / Meal',
  errand: 'Quick errand',
  personal: 'Personal',
  other: 'Break',
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function TeamPageClient({
  orgId,
  teamId,
  team,
  lead,
  members,
  meetingMembers,
  todayStandups,
  activeBreaks,
  totals,
  day,
}: {
  orgId: number
  teamId: number
  team: { name: string; description: string | null; color: string | null }
  lead: Lead
  members: TeamMember[]
  meetingMembers: Array<{ userId: number; name: string | null; login: string }>
  todayStandups: Standup[]
  activeBreaks: Break[]
  totals: { totalHours: number; avgEfficiency: number | null; standupCount: number; memberCount: number }
  day: string
}) {
  const accent = team.color ?? 'var(--m-accent)'
  const allUserIds = useMemo(() => meetingMembers.map((m) => m.userId), [meetingMembers])

  const liveBreaks = activeBreaks.filter((b) => b.active)
  const recentBreaks = activeBreaks.filter((b) => !b.active)

  return (
    <>
      {/* ── Header ── */}
      <div className="mb-4">
        <Link
          href={`/org/${orgId}/teams`}
          className="inline-flex items-center gap-1 text-[12px] text-[var(--m-ink-3)] hover:text-[var(--m-ink)] mb-2"
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          All teams
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                className="inline-block w-3.5 h-3.5 rounded-full shrink-0"
                style={{ background: accent }}
                aria-hidden
              />
              <h1 className="app-h1">{team.name}</h1>
            </div>
            {team.description && (
              <p className="mt-1.5 text-[13px] text-[var(--m-ink-2)] leading-snug max-w-2xl">
                {team.description}
              </p>
            )}
            <div className="mt-2 flex items-center gap-3 flex-wrap text-[12.5px] text-[var(--m-ink-3)]">
              <span>
                {totals.memberCount} {totals.memberCount === 1 ? 'member' : 'members'}
              </span>
              {lead && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-[var(--m-ink-4)]">Lead</span>
                  <CharacterAvatar
                    characterKey={lead.characterKey}
                    name={lead.name}
                    login={lead.login}
                    imageUrl={lead.avatarUrl}
                    size={18}
                  />
                  <Link
                    href={`/org/${orgId}/people/${lead.membershipId}`}
                    className="text-[var(--m-ink)] font-medium hover:text-[var(--m-accent)]"
                  >
                    {lead.name ?? `@${lead.login}`}
                  </Link>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/org/${orgId}/teams/${teamId}/report`}
              className="btn-secondary text-[12.5px]"
            >
              Team report
            </Link>
            <TeamMeetingScheduler
              orgId={orgId}
              members={meetingMembers}
              preselect={allUserIds}
              label="Book meeting with team"
            />
          </div>
        </div>
      </div>

      {/* ── Team rollup stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Total hours · 7d" value={`${totals.totalHours}h`} />
        <Stat
          label="Avg efficiency · today"
          value={totals.avgEfficiency == null ? '—' : `${totals.avgEfficiency}%`}
        />
        <Stat
          label="Standups today"
          value={`${totals.standupCount}/${totals.memberCount}`}
        />
        <Stat
          label="On a break now"
          value={String(liveBreaks.length)}
          tone={liveBreaks.length > 0 ? 'warn' : undefined}
        />
      </div>

      {/* ── Members ── */}
      <section className="mb-6">
        <h2 className="app-h2 mb-2.5">Team members</h2>
        {members.length === 0 ? (
          <div className="rounded-xl border border-[var(--m-border)] bg-white px-6 py-10 text-center">
            <p className="font-display text-[18px] text-[var(--m-ink)]">No members on this team yet.</p>
            <p className="mt-1.5 text-[13px] text-[var(--m-ink-3)]">
              Add people from the{' '}
              <Link href={`/org/${orgId}/teams`} className="text-[var(--m-accent)] hover:underline">
                Teams page
              </Link>
              .
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {members.map((m) => (
              <MemberCard key={m.membershipId} orgId={orgId} m={m} />
            ))}
          </ul>
        )}
      </section>

      {/* ── Two-column activity: standups + breaks ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Today's standups */}
        <section>
          <div className="flex items-baseline justify-between mb-2.5">
            <h2 className="app-h2">Today&apos;s standups</h2>
            <span className="text-[12px] text-[var(--m-ink-4)] tabular-nums">{day}</span>
          </div>
          {todayStandups.length === 0 ? (
            <div className="rounded-xl border border-[var(--m-border)] bg-white px-4 py-8 text-center text-[13px] text-[var(--m-ink-3)]">
              No standups posted yet today.
            </div>
          ) : (
            <ul className="space-y-3">
              {todayStandups.map((s) => (
                <li
                  key={s.userId}
                  className="rounded-xl border border-[var(--m-border)] bg-white p-3.5"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <CharacterAvatar
                      characterKey={s.characterKey}
                      name={s.name}
                      login={s.login}
                      imageUrl={s.avatarUrl}
                      size={24}
                    />
                    {s.membershipId != null ? (
                      <Link
                        href={`/org/${orgId}/people/${s.membershipId}`}
                        className="text-[13px] font-semibold text-[var(--m-ink)] hover:text-[var(--m-accent)]"
                      >
                        {s.name ?? `@${s.login}`}
                      </Link>
                    ) : (
                      <span className="text-[13px] font-semibold text-[var(--m-ink)]">
                        {s.name ?? `@${s.login}`}
                      </span>
                    )}
                  </div>
                  <StandupLine label="Yesterday" body={s.yesterday} />
                  <StandupLine label="Today" body={s.today} />
                  {s.blockers && <StandupLine label="Blockers" body={s.blockers} tone="bad" />}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Breaks */}
        <section>
          <h2 className="app-h2 mb-2.5">Breaks &amp; pauses</h2>
          {liveBreaks.length === 0 && recentBreaks.length === 0 ? (
            <div className="rounded-xl border border-[var(--m-border)] bg-white px-4 py-8 text-center text-[13px] text-[var(--m-ink-3)]">
              Nobody&apos;s paused in the last day.
            </div>
          ) : (
            <div className="space-y-3">
              {liveBreaks.length > 0 && (
                <ul className="space-y-2">
                  {liveBreaks.map((b) => (
                    <BreakRow key={b.id} orgId={orgId} b={b} />
                  ))}
                </ul>
              )}
              {recentBreaks.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-[var(--m-ink-4)] font-semibold mb-1.5 mt-1">
                    Earlier today
                  </p>
                  <ul className="space-y-2">
                    {recentBreaks.map((b) => (
                      <BreakRow key={b.id} orgId={orgId} b={b} />
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

/* ----------------------------- sub-components ----------------------------- */

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl border border-[var(--m-border)] bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-[var(--m-ink-4)] font-semibold">{label}</p>
      <p
        className={`mt-0.5 text-[22px] font-display leading-none tabular-nums ${
          tone === 'warn' ? 'text-[var(--m-warn)]' : 'text-[var(--m-ink)]'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function MemberCard({ orgId, m }: { orgId: number; m: TeamMember }) {
  const state = m.dailyState ? STATE_STYLE[m.dailyState] ?? STATE_STYLE.NoData : null
  return (
    <li className="rounded-xl border border-[var(--m-border)] bg-white p-4">
      <div className="flex items-start gap-3">
        <CharacterAvatar
          characterKey={m.characterKey}
          name={m.name}
          login={m.login}
          imageUrl={m.avatarUrl}
          size={40}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/org/${orgId}/people/${m.membershipId}`}
              className="text-[14px] font-semibold text-[var(--m-ink)] hover:text-[var(--m-accent)] truncate"
            >
              {m.name ?? `@${m.login}`}
            </Link>
            {m.isLead && (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--m-accent-soft)] text-[var(--m-accent-2)]">
                Lead
              </span>
            )}
          </div>
          <p className="text-[12px] text-[var(--m-ink-3)] truncate">
            {m.jobTitle ?? m.discipline}
          </p>
        </div>
        {state && (
          <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${state.cls}`}>
            {state.label}
          </span>
        )}
      </div>

      {/* metrics row */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Metric label="Hours · 7d" value={`${m.weekHours}h`} />
        <Metric label="Efficiency" value={m.efficiency == null ? '—' : `${m.efficiency}%`} />
        <Metric
          label="Standup"
          value={m.postedStandup ? 'Posted' : 'Missing'}
          tone={m.postedStandup ? 'good' : 'muted'}
        />
      </div>

      {/* github activity */}
      <div className="mt-3 flex items-center gap-3 flex-wrap text-[11.5px] text-[var(--m-ink-2)]">
        <span className="text-[var(--m-ink-4)] uppercase tracking-wide text-[10px] font-semibold">
          GitHub · 7d
        </span>
        {m.github.total === 0 ? (
          <span className="text-[var(--m-ink-4)]">No activity</span>
        ) : (
          <>
            <GhStat n={m.github.commits} label="commits" />
            <GhStat n={m.github.prs} label="PRs" />
            <GhStat n={m.github.reviews} label="reviews" />
            {m.github.issues > 0 && <GhStat n={m.github.issues} label="issues" />}
          </>
        )}
      </div>
    </li>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'muted'
}) {
  return (
    <div className="rounded-lg bg-[var(--m-bg-soft)] px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-[var(--m-ink-4)] font-semibold">{label}</p>
      <p
        className={`text-[14px] font-semibold tabular-nums ${
          tone === 'good'
            ? 'text-[var(--m-good)]'
            : tone === 'muted'
              ? 'text-[var(--m-ink-4)]'
              : 'text-[var(--m-ink)]'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function GhStat({ n, label }: { n: number; label: string }) {
  return (
    <span className="tabular-nums">
      <span className="font-semibold text-[var(--m-ink)]">{n}</span>{' '}
      <span className="text-[var(--m-ink-3)]">{label}</span>
    </span>
  )
}

function StandupLine({
  label,
  body,
  tone,
}: {
  label: string
  body: string
  tone?: 'bad'
}) {
  return (
    <div className="mb-1 last:mb-0">
      <span
        className={`text-[10px] uppercase tracking-wide font-semibold ${
          tone === 'bad' ? 'text-[var(--m-bad)]' : 'text-[var(--m-ink-4)]'
        }`}
      >
        {label}
      </span>
      <p className="text-[12.5px] text-[var(--m-ink-2)] leading-snug whitespace-pre-wrap">
        {body || '—'}
      </p>
    </div>
  )
}

function BreakRow({ orgId, b }: { orgId: number; b: Break }) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg border border-[var(--m-border)] bg-white px-3 py-2">
      <CharacterAvatar
        characterKey={b.characterKey}
        name={b.name}
        login={b.login}
        imageUrl={b.avatarUrl}
        size={26}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {b.membershipId != null ? (
            <Link
              href={`/org/${orgId}/people/${b.membershipId}`}
              className="text-[12.5px] font-medium text-[var(--m-ink)] hover:text-[var(--m-accent)] truncate"
            >
              {b.name ?? `@${b.login}`}
            </Link>
          ) : (
            <span className="text-[12.5px] font-medium text-[var(--m-ink)] truncate">
              {b.name ?? `@${b.login}`}
            </span>
          )}
          {b.active && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--m-warn)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--m-warn)]" aria-hidden />
              now
            </span>
          )}
        </div>
        <p className="text-[11.5px] text-[var(--m-ink-3)] truncate">
          {BREAK_LABEL[b.category] ?? 'Break'}
          {b.reason ? ` · ${b.reason}` : ''}
        </p>
      </div>
      <span className="shrink-0 text-[11px] text-[var(--m-ink-4)] tabular-nums">
        {b.active ? `since ${relTime(b.startedAt)}` : relTime(b.endedAt!)}
      </span>
    </li>
  )
}
