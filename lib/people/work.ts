import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { hideSeedRows } from '@/lib/dev-state'
import { db, schema } from '@/lib/db/client'

/**
 * "What is this person actually working on?" — the structured, manager-grade
 * read of one teammate's GitHub work over a window, built ENTIRELY from
 * github_events the App sync produces (commits, PRs with status, reviews).
 *
 * This is the data layer behind the member modal's Work view and the on-demand
 * AI work summary. Deterministic, no LLM — the LLM only narrates this object.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export type PrStatus = 'open' | 'in_review' | 'merged' | 'closed' | 'draft'

export type MemberWork = {
  windowDays: number
  hasGithub: boolean
  prs: Array<{ title: string; url: string; repo: string; number: number | null; status: PrStatus; occurredAt: string }>
  prCounts: Record<PrStatus, number>
  reviewsGiven: Array<{ title: string; url: string; repo: string; prAuthor: string | null; verdict: string | null; occurredAt: string }>
  reviewsReceived: Array<{ title: string; url: string; repo: string; reviewer: string; verdict: string | null; occurredAt: string }>
  commitCount: number
  commitRepos: Array<{ repo: string; count: number }>
  recentCommitTitles: string[]
  /** The single most important "is this person stuck?" signal, or null. */
  blocked: { kind: 'pr_waiting' | 'break'; title: string; detail: string; ageDays?: number } | null
  meetings: { count: number; minutes: number }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawOf(e: { raw: unknown }): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (e.raw ?? {}) as any
}

/** Derive the display status, promoting an open PR with reviewers to "in review". */
function displayStatus(raw: { status?: string; requestedReviewers?: number }): PrStatus {
  const s = (raw.status as PrStatus) ?? 'open'
  if (s === 'open' && (raw.requestedReviewers ?? 0) > 0) return 'in_review'
  return s
}

/**
 * Org-free core: one person's GitHub work over a window, keyed entirely by
 * userId. `github_events` (and meetings/breaks) are user-scoped, so this needs
 * no org — it powers both the manager member-modal and the solo employee's own
 * work journal / review packet.
 */
export async function buildUserWork(userId: number, days = 14): Promise<MemberWork> {
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) })
  const hasGithub = !!user?.accessToken || user?.githubId != null || !!user?.githubLogin
  // For review attribution we match on the github username the App reports.
  // Prefer the explicit github_login; fall back to the app handle (== github
  // login for OAuth users).
  const login = user?.githubLogin ?? user?.login ?? ''
  const since = new Date(Date.now() - days * DAY_MS)
  const NOT_SEED = hideSeedRows(schema.githubEvents.externalId)

  const [events, received, meetingRows, activeBlock] = await Promise.all([
    // This person's own events in the window.
    db
      .select()
      .from(schema.githubEvents)
      .where(and(eq(schema.githubEvents.userId, userId), gte(schema.githubEvents.occurredAt, since), NOT_SEED))
      .orderBy(desc(schema.githubEvents.occurredAt)),
    // Reviews OTHERS gave on THIS person's PRs (raw.prAuthor === their login).
    login
      ? db
          .select({ ev: schema.githubEvents, reviewerName: schema.users.name, reviewerLogin: schema.users.login })
          .from(schema.githubEvents)
          .innerJoin(schema.users, eq(schema.githubEvents.userId, schema.users.id))
          .where(
            and(
              eq(schema.githubEvents.type, 'pr_reviewed'),
              gte(schema.githubEvents.occurredAt, since),
              sql`lower(${schema.githubEvents.raw}->>'prAuthor') = lower(${login})`,
            ),
          )
          .orderBy(desc(schema.githubEvents.occurredAt))
          .limit(20)
      : Promise.resolve([] as Array<{ ev: typeof schema.githubEvents.$inferSelect; reviewerName: string | null; reviewerLogin: string }>),
    // Meetings in the window (calendar load → focus context).
    db
      .select({ startAt: schema.meetings.startAt, endAt: schema.meetings.endAt })
      .from(schema.meetings)
      .where(and(eq(schema.meetings.userId, userId), gte(schema.meetings.startAt, since))),
    // Active "blocked" break, if any.
    db.query.breaks.findFirst({
      where: and(eq(schema.breaks.userId, userId), eq(schema.breaks.category, 'blocked')),
      orderBy: [desc(schema.breaks.startedAt)],
    }),
  ])

  // ── PRs (this person opened), grouped by status ──
  const prCounts: Record<PrStatus, number> = { open: 0, in_review: 0, merged: 0, closed: 0, draft: 0 }
  const prs = events
    .filter((e) => e.type === 'pr_opened')
    .map((e) => {
      const raw = rawOf(e)
      const status = displayStatus(raw)
      prCounts[status]++
      return {
        title: e.title,
        url: e.url,
        repo: e.repo,
        number: typeof raw.number === 'number' ? raw.number : null,
        status,
        occurredAt: e.occurredAt.toISOString(),
      }
    })

  // ── Reviews this person GAVE ──
  const reviewsGiven = events
    .filter((e) => e.type === 'pr_reviewed')
    .map((e) => {
      const raw = rawOf(e)
      return {
        title: e.title,
        url: e.url,
        repo: e.repo,
        prAuthor: raw.prAuthor ?? null,
        verdict: raw.verdict ?? null,
        occurredAt: e.occurredAt.toISOString(),
      }
    })

  // ── Reviews this person RECEIVED ──
  const reviewsReceived = received.map((r) => ({
    title: r.ev.title,
    url: r.ev.url,
    repo: r.ev.repo,
    reviewer: r.reviewerName ?? `@${r.reviewerLogin}`,
    verdict: rawOf(r.ev).verdict ?? null,
    occurredAt: r.ev.occurredAt.toISOString(),
  }))

  // ── Commits → count, repo spread, recent titles (the "themes") ──
  const commits = events.filter((e) => e.type === 'commit')
  const commitCount = commits.length
  const repoCount = new Map<string, number>()
  for (const c of commits) repoCount.set(c.repo, (repoCount.get(c.repo) ?? 0) + 1)
  const commitRepos = Array.from(repoCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([repo, count]) => ({ repo, count }))
  // De-duplicate near-identical commit titles ("wip", "fix") for a cleaner theme list.
  const seenTitle = new Set<string>()
  const recentCommitTitles: string[] = []
  for (const c of commits) {
    const key = c.title.trim().toLowerCase()
    if (key.length < 3 || seenTitle.has(key)) continue
    seenTitle.add(key)
    recentCommitTitles.push(c.title)
    if (recentCommitTitles.length >= 6) break
  }

  // ── Blocked signal ── prefer an explicit active blocker; else an open PR
  // that's been awaiting review for >2 days.
  let blocked: MemberWork['blocked'] = null
  if (activeBlock && !activeBlock.endedAt) {
    const ageDays = Math.max(0, Math.round((Date.now() - activeBlock.startedAt.getTime()) / DAY_MS))
    blocked = {
      kind: 'break',
      title: `Blocked — waiting on ${activeBlock.waitingOnExternal ?? 'a teammate'}`,
      detail: activeBlock.reason || 'No reason given.',
      ageDays,
    }
  } else {
    const waiting = prs
      .filter((p) => (p.status === 'in_review' || p.status === 'open'))
      .map((p) => ({ p, ageDays: Math.floor((Date.now() - new Date(p.occurredAt).getTime()) / DAY_MS) }))
      .filter((x) => x.ageDays >= 2)
      .sort((a, b) => b.ageDays - a.ageDays)[0]
    if (waiting) {
      blocked = {
        kind: 'pr_waiting',
        title: 'PR awaiting review',
        detail: `"${waiting.p.title}" (${waiting.p.repo}) has been open ${waiting.ageDays} day${waiting.ageDays === 1 ? '' : 's'} without a merge.`,
        ageDays: waiting.ageDays,
      }
    }
  }

  const meetingMinutes = meetingRows.reduce(
    (acc, m) => acc + Math.max(0, Math.round((m.endAt.getTime() - m.startAt.getTime()) / 60_000)),
    0,
  )

  return {
    windowDays: days,
    hasGithub,
    prs,
    prCounts,
    reviewsGiven,
    reviewsReceived,
    commitCount,
    commitRepos,
    recentCommitTitles,
    blocked,
    meetings: { count: meetingRows.length, minutes: meetingMinutes },
  }
}

/**
 * Back-compat wrapper for the manager surfaces that pass an orgId. The orgId is
 * not used for filtering (events are user-scoped); kept so existing call sites
 * don't change.
 */
export async function buildMemberWork(orgId: number, userId: number, days = 14): Promise<MemberWork> {
  void orgId
  return buildUserWork(userId, days)
}

/** Compact, token-thrifty context blob for the LLM work-summary prompt. */
export function workContextForLlm(name: string, w: MemberWork): string {
  const lines: string[] = []
  lines.push(`Person: ${name}`)
  lines.push(`Window: last ${w.windowDays} days`)
  lines.push(
    `PRs: ${w.prs.length} (open ${w.prCounts.open}, in_review ${w.prCounts.in_review}, merged ${w.prCounts.merged}, closed ${w.prCounts.closed}, draft ${w.prCounts.draft})`,
  )
  for (const p of w.prs.slice(0, 8)) lines.push(`  - [${p.status}] "${p.title}" (${p.repo})`)
  lines.push(`Reviews given: ${w.reviewsGiven.length}`)
  for (const r of w.reviewsGiven.slice(0, 6)) lines.push(`  - ${r.verdict ?? 'reviewed'} ${r.prAuthor ? `@${r.prAuthor}'s` : ''} "${r.title}" (${r.repo})`)
  lines.push(`Reviews received: ${w.reviewsReceived.length}`)
  for (const r of w.reviewsReceived.slice(0, 6)) lines.push(`  - ${r.reviewer} ${r.verdict ?? 'reviewed'} "${r.title}"`)
  lines.push(`Commits: ${w.commitCount} across ${w.commitRepos.map((c) => c.repo).join(', ') || 'none'}`)
  if (w.recentCommitTitles.length) lines.push(`Recent commit messages: ${w.recentCommitTitles.map((t) => `"${t}"`).join('; ')}`)
  lines.push(`Meetings in window: ${w.meetings.count} (${Math.round(w.meetings.minutes / 60)}h)`)
  lines.push(`Blocked: ${w.blocked ? `${w.blocked.title} — ${w.blocked.detail}` : 'no'}`)
  return lines.join('\n')
}
