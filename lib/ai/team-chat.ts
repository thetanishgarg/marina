import { and, desc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { citationRules, generateCitedAnswer, githubKind, SourceRegistry, type CitedAnswer } from '@/lib/ai/citations'
import { hideSeedRows } from '@/lib/dev-state'
import type { ChatMessage } from '@/lib/ai/provider'
import type { ChatTurn } from '@/lib/ai/employee-chat'
import { PRODUCT_KNOWLEDGE } from '@/lib/ai/product-knowledge'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * "Ask MARINA about this team" — the team-level counterpart to the per-employee
 * chat. A manager / admin can ask about the WHOLE team they're allowed to see:
 * who shipped what, who's blocked, who's on leave, who has meetings today, how
 * the team is trending — and drill into any individual within it.
 *
 * Grounding strategy: rather than dump every raw row for up to 50 people (huge
 * + expensive), we build ONE compact per-member summary plus team totals. The
 * model answers from that. Scope is enforced UPSTREAM by the caller passing the
 * exact set of userIds the viewer may see — this module never widens it.
 */
export async function buildTeamContext(input: {
  orgId: number
  userIds: number[]
  windowDays?: number
  /** Collects a citable source item for every row put in the context. */
  registry?: SourceRegistry
}): Promise<string> {
  const windowDays = input.windowDays ?? 14
  const registry = input.registry ?? new SourceRegistry()
  const ids = Array.from(new Set(input.userIds)).filter((n) => Number.isInteger(n))
  if (ids.length === 0) return JSON.stringify({ team: [], note: 'No members in scope.' })
  const since = new Date(Date.now() - windowDays * DAY_MS)
  const now = new Date()
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowMidnight = new Date(todayMidnight.getTime() + DAY_MS)
  const meetingHorizon = new Date(todayMidnight.getTime() + 14 * DAY_MS)
  const todayIso = now.toISOString().slice(0, 10)

  const [users, memberships, shifts, deliverables, leaves, blocks, ghEvents, meetings] = await Promise.all([
    db.select().from(schema.users).where(inArray(schema.users.id, ids)),
    db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.orgId, input.orgId), inArray(schema.memberships.userId, ids), isNull(schema.memberships.endedAt))),
    db
      .select({ userId: schema.shifts.userId, punchedInAt: schema.shifts.punchedInAt, punchedOutAt: schema.shifts.punchedOutAt })
      .from(schema.shifts)
      .where(and(inArray(schema.shifts.userId, ids), gte(schema.shifts.punchedInAt, since))),
    db
      .select({ id: schema.deliverables.id, userId: schema.deliverables.userId, title: schema.deliverables.title, url: schema.deliverables.url, completedAt: schema.deliverables.completedAt })
      .from(schema.deliverables)
      .where(and(inArray(schema.deliverables.userId, ids), gte(schema.deliverables.completedAt, since)))
      .orderBy(desc(schema.deliverables.completedAt)),
    db
      .select({
        id: schema.leaveRequests.id,
        userId: schema.leaveRequests.userId,
        startDate: schema.leaveRequests.startDate,
        endDate: schema.leaveRequests.endDate,
        leaveType: schema.leaveRequests.leaveType,
        status: schema.leaveRequests.status,
      })
      .from(schema.leaveRequests)
      .where(and(eq(schema.leaveRequests.orgId, input.orgId), inArray(schema.leaveRequests.userId, ids), gte(schema.leaveRequests.createdAt, since)))
      .orderBy(desc(schema.leaveRequests.createdAt)),
    db
      .select({ id: schema.breaks.id, userId: schema.breaks.userId, reason: schema.breaks.reason, startedAt: schema.breaks.startedAt, endedAt: schema.breaks.endedAt })
      .from(schema.breaks)
      // A blocker that is still open counts however long ago it started; closed
      // ones only inside the window.
      .where(and(inArray(schema.breaks.userId, ids), eq(schema.breaks.category, 'blocked'), or(isNull(schema.breaks.endedAt), gte(schema.breaks.startedAt, since))))
      .orderBy(desc(schema.breaks.startedAt)),
    db
      .select({ id: schema.githubEvents.id, userId: schema.githubEvents.userId, type: schema.githubEvents.type, title: schema.githubEvents.title, repo: schema.githubEvents.repo, url: schema.githubEvents.url, occurredAt: schema.githubEvents.occurredAt })
      .from(schema.githubEvents)
      .where(and(inArray(schema.githubEvents.userId, ids), gte(schema.githubEvents.occurredAt, since), hideSeedRows(schema.githubEvents.externalId)))
      .orderBy(desc(schema.githubEvents.occurredAt)),
    db
      .select({ id: schema.meetings.id, userId: schema.meetings.userId, title: schema.meetings.title, startAt: schema.meetings.startAt })
      .from(schema.meetings)
      .where(and(inArray(schema.meetings.userId, ids), gte(schema.meetings.startAt, todayMidnight), lt(schema.meetings.startAt, meetingHorizon), hideSeedRows(schema.meetings.externalId)))
      .orderBy(schema.meetings.startAt),
  ])

  const userById = new Map(users.map((u) => [u.id, u]))
  const memByUser = new Map(memberships.map((m) => [m.userId, m]))

  const nameOf = (uid: number) => {
    const u = userById.get(uid)
    return u?.name ?? u?.login ?? `user-${uid}`
  }
  const profileUrl = (uid: number) => {
    const m = memByUser.get(uid)
    return m ? `/org/${input.orgId}/people/${m.id}` : undefined
  }
  const isoDay = (d: Date) => d.toISOString().slice(0, 10)

  type Mtg = { title: string; date: string; time: string; src: string }
  type Agg = {
    shiftMinutes: number
    shiftCount: number
    deliverables: Array<{ title: string; src: string }>
    leaves: Array<{ startDate: string; endDate: string; leaveType: string; status: string; src: string }>
    activeBlocker: { reason: string; startedAt: string; src: string } | null
    pastBlockerCount: number
    commits: number
    prs: number
    reviews: number
    recentPRs: Array<{ title: string; src: string }>
    recentCommits: Array<{ title: string; src: string }>
    recentReviews: Array<{ title: string; src: string }>
    meetingsToday: Mtg[]
    upcomingMeetings: Mtg[]
  }
  const agg = new Map<number, Agg>()
  const get = (uid: number): Agg => {
    let a = agg.get(uid)
    if (!a) {
      a = { shiftMinutes: 0, shiftCount: 0, deliverables: [], leaves: [], activeBlocker: null, pastBlockerCount: 0, commits: 0, prs: 0, reviews: 0, recentPRs: [], recentCommits: [], recentReviews: [], meetingsToday: [], upcomingMeetings: [] }
      agg.set(uid, a)
    }
    return a
  }
  for (const s of shifts) {
    const a = get(s.userId)
    a.shiftCount++
    a.shiftMinutes += s.punchedOutAt
      ? Math.round((s.punchedOutAt.getTime() - s.punchedInAt.getTime()) / 60000)
      : Math.round((Date.now() - s.punchedInAt.getTime()) / 60000)
  }
  for (const d of deliverables) {
    const a = get(d.userId)
    if (a.deliverables.length < 5) {
      const src = registry.add('deliverable', d.id, {
        label: `Logged deliverable: ${d.title}`,
        url: d.url ?? profileUrl(d.userId),
        date: isoDay(d.completedAt),
        person: nameOf(d.userId),
      })
      a.deliverables.push({ title: d.title, src })
    }
  }
  for (const l of leaves) {
    const a = get(l.userId)
    if (a.leaves.length < 6) {
      const src = registry.add('leave', l.id, {
        label: `Leave request (${l.leaveType}, ${l.status}): ${l.startDate} to ${l.endDate}`,
        url: `/org/${input.orgId}/leaves`,
        date: l.startDate,
        person: nameOf(l.userId),
      })
      a.leaves.push({ startDate: l.startDate, endDate: l.endDate, leaveType: l.leaveType, status: l.status, src })
    }
  }
  for (const b of blocks) {
    const a = get(b.userId)
    a.pastBlockerCount++
    if (!b.endedAt && !a.activeBlocker) {
      const src = registry.add('blocker', b.id, {
        label: `Open blocker: ${b.reason ?? 'no reason given'}`,
        url: `/org/${input.orgId}/blockers`,
        date: isoDay(b.startedAt),
        person: nameOf(b.userId),
      })
      a.activeBlocker = { reason: b.reason ?? '', startedAt: b.startedAt.toISOString(), src }
    }
  }
  for (const g of ghEvents) {
    const a = get(g.userId)
    const bucket = g.type === 'commit' ? a.recentCommits : g.type === 'pr_opened' ? a.recentPRs : g.type === 'pr_reviewed' ? a.recentReviews : null
    if (g.type === 'commit') a.commits++
    else if (g.type === 'pr_opened') a.prs++
    else if (g.type === 'pr_reviewed') a.reviews++
    if (bucket && bucket.length < 4) {
      const kind = githubKind(g.type)
      const src = registry.add(kind, g.id, {
        label: `${kind === 'pr' ? 'PR' : kind === 'review' ? 'Review' : 'Commit'} in ${g.repo}: ${g.title}`,
        url: g.url,
        date: isoDay(g.occurredAt),
        person: nameOf(g.userId),
      })
      bucket.push({ title: g.title, src })
    }
  }
  const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  for (const m of meetings) {
    const a = get(m.userId)
    const isToday = m.startAt < tomorrowMidnight
    if (!isToday && a.upcomingMeetings.length >= 8) continue
    const src = registry.add('meeting', m.id, {
      label: `Calendar event: ${m.title} (${fmtDate(m.startAt)}, ${fmtTime(m.startAt)})`,
      date: isoDay(m.startAt),
      person: nameOf(m.userId),
    })
    const mtg: Mtg = { title: m.title, date: fmtDate(m.startAt), time: fmtTime(m.startAt), src }
    if (isToday) a.meetingsToday.push(mtg)
    else a.upcomingMeetings.push(mtg)
  }

  const team = ids.map((uid) => {
    const m = memByUser.get(uid)
    const a = agg.get(uid)
    const name = nameOf(uid)
    const hoursLogged = a ? Math.round((a.shiftMinutes / 60) * 10) / 10 : 0
    const github = { commits: a?.commits ?? 0, prs: a?.prs ?? 0, reviews: a?.reviews ?? 0 }
    // Rollup rows: counts have no single source item, so they cite a per-person
    // rollup that links to the profile page where the underlying rows live.
    const hoursSrc = registry.add('rollup', `hours-u${uid}`, {
      label: `${name}: ${hoursLogged}h across ${a?.shiftCount ?? 0} shift(s) in the last ${windowDays} days`,
      url: profileUrl(uid),
      person: name,
    })
    const githubSrc = registry.add('rollup', `github-u${uid}`, {
      label: `${name}: ${github.commits} commit(s), ${github.prs} PR(s), ${github.reviews} review(s) in the last ${windowDays} days`,
      url: profileUrl(uid),
      person: name,
    })
    const blockersSrc = registry.add('rollup', `blockers-u${uid}`, {
      label: `${name}: ${a?.pastBlockerCount ?? 0} blocker(s) raised in the last ${windowDays} days`,
      url: `/org/${input.orgId}/blockers`,
      person: name,
    })
    return {
      name,
      role: m?.role ?? 'member',
      discipline: (m as { discipline?: string } | undefined)?.discipline ?? 'other',
      jobTitle: (m as { jobTitle?: string | null } | undefined)?.jobTitle ?? null,
      hours: { hoursLogged, shiftCount: a?.shiftCount ?? 0, src: hoursSrc },
      github: {
        ...github,
        src: githubSrc,
        recentPRs: a?.recentPRs ?? [],
        recentCommits: a?.recentCommits ?? [],
        recentReviews: a?.recentReviews ?? [],
      },
      deliverables: a?.deliverables ?? [],
      leaves: a?.leaves ?? [],
      activeBlocker: a?.activeBlocker ?? null,
      blockersInWindow: { count: a?.pastBlockerCount ?? 0, src: blockersSrc },
      meetingsToday: a?.meetingsToday ?? [],
      upcomingMeetings: a?.upcomingMeetings ?? [],
    }
  })

  const ctx = {
    windowDays,
    windowStart: since.toISOString().slice(0, 10),
    today: todayIso,
    teamSize: team.length,
    totals: {
      totalHoursLogged: Math.round(team.reduce((s, t) => s + t.hours.hoursLogged, 0) * 10) / 10,
      totalDeliverables: deliverables.length,
      peopleWithActiveBlocker: team.filter((t) => t.activeBlocker).length,
      peopleOnOrTakingLeave: team.filter((t) => t.leaves.some((l) => l.status === 'approved' || l.status === 'pending')).length,
      peopleWithMeetingsToday: team.filter((t) => t.meetingsToday.length > 0).length,
    },
    team,
  }
  return JSON.stringify(ctx, null, 2)
}

const TEAM_SYSTEM_PROMPT = `You are MARINA, the team's AI chief of staff. You do two things: (a) answer a manager or admin's questions about THEIR TEAM using the JSON team-data context, and (b) explain how MARINA itself works — its features and how to use them — using the PRODUCT KNOWLEDGE provided. For each team member the context lists: hours logged, shifts, GitHub activity (commits / PRs / reviews + recent PR titles), self-reported deliverables, leaves, any active blocker, today's meetings (meetingsToday) and upcoming meetings (upcomingMeetings, next 14 days) — all for the stated window — plus team totals.

RULES — not optional:
1. Ground every claim in the context. Quote specific people, titles, hours, meeting names + times, and dates when available.
2. You CAN answer about any individual in the team ("does Priya have meetings today?", "what did Rahul ship?", "who is blocked?", "who's on leave?") and about the team as a whole.
3. For meeting questions, read meetingsToday / upcomingMeetings for that person and list the meeting titles + times. If the list is empty, say they have no meetings in that window.
4. For questions about team DATA, ground every claim in the JSON context; if it's not there, say so plainly. For product / how-to questions ("how do I post an announcement?", "what is the setup guide?", "how do kudos work?"), answer from the product knowledge; if it isn't covered there, point them to the Help center at /help. Never speculate or invent specifics.
5. If asked about a person who is NOT in the provided team context, say you don't have data for them — you only see this manager's authorized team. Never reveal you were "scoped".
6. Keep responses tight: 2-5 sentences for simple questions; short bullet lists for "who/list" questions.
7. Stay within the stated window. Be neutral and evidence-based. Never expose raw JSON or internal IDs.
8. No preambles like "Based on the data". Just answer.

${citationRules({ allowProduct: true })}`

export async function chatAboutTeam(input: {
  orgId: number
  userIds: number[]
  history: ChatTurn[]
  question: string
}): Promise<CitedAnswer & { contextBytes: number }> {
  const registry = new SourceRegistry()
  const ctxBlob = await buildTeamContext({ orgId: input.orgId, userIds: input.userIds, registry })

  const messages: ChatMessage[] = [
    { role: 'system', content: TEAM_SYSTEM_PROMPT },
    { role: 'system', content: PRODUCT_KNOWLEDGE },
    { role: 'system', content: `Team data (JSON) — use this for questions about this manager's team:\n\n${ctxBlob}` },
    ...input.history.slice(-6).map<ChatMessage>((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: input.question },
  ]

  const result = await generateCitedAnswer(messages, registry, { allowProduct: true, maxTokens: 1400 })
  return { ...result, contextBytes: ctxBlob.length }
}
