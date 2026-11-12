import { and, desc, eq, gte, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { citationRules, generateCitedAnswer, githubKind, SourceRegistry, type CitedAnswer } from '@/lib/ai/citations'
import type { ChatMessage } from '@/lib/ai/provider'
import { PRODUCT_KNOWLEDGE } from '@/lib/ai/product-knowledge'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * "Ask MARINA about this employee" — the AI agent that turns the rich
 * per-employee data we already collect into a conversational answer for a
 * manager or admin.
 *
 * Why this is the USP: every other tool gives you a dashboard. We give you a
 * line. A manager can ask "what did Sneha do this week?", "are there any
 * stuck blockers?", "is she likely to miss the launch?" and get a grounded,
 * citable answer instead of clicking through 7 tabs.
 *
 * Design principles:
 *   - **Grounded only.** The system prompt forbids speculation. If the data
 *     doesn't have the answer, the model must say so.
 *   - **Citation-friendly.** We pass dates + ids inside the context blob so
 *     the model can quote specifics ("on Tuesday she shipped X, see
 *     deliverable #42").
 *   - **Window-aware.** Default context window is the last 30 days. Manager
 *     can override per-conversation by passing fromDate/toDate.
 *   - **Read-only.** This pipeline never writes back — no auto-replies, no
 *     "let me schedule that for you". A manager asking "should I escalate
 *     this?" gets a recommendation, not an action.
 *
 * Cost: each turn is ~3-6k input tokens (the context blob) + ~300 output
 * tokens. With Groq llama-3.3-70b that's $0.002–0.005 per turn. We log
 * usage to `aiSpend` for the admin AI costs dashboard.
 */
export async function buildEmployeeContext(input: {
  orgId: number
  userId: number
  membershipId: number
  windowDays?: number
  /** Collects a citable source item for every row put in the context. */
  registry?: SourceRegistry
}): Promise<string> {
  const windowDays = input.windowDays ?? 30
  const registry = input.registry ?? new SourceRegistry()
  const since = new Date(Date.now() - windowDays * DAY_MS)
  const sinceIso = since.toISOString().slice(0, 10)

  const [
    user,
    membership,
    shifts,
    breaks,
    deliverables,
    leaves,
    meetings,
    githubEvents,
    narrative,
    todayStory,
    devices,
  ] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, input.userId) }),
    db.query.memberships.findFirst({
      where: and(
        eq(schema.memberships.id, input.membershipId),
        eq(schema.memberships.orgId, input.orgId),
      ),
    }),
    db
      .select()
      .from(schema.shifts)
      .where(and(eq(schema.shifts.userId, input.userId), gte(schema.shifts.punchedInAt, since)))
      .orderBy(desc(schema.shifts.punchedInAt))
      .limit(40),
    db
      .select()
      .from(schema.breaks)
      .where(and(eq(schema.breaks.userId, input.userId), gte(schema.breaks.startedAt, since)))
      .orderBy(desc(schema.breaks.startedAt))
      .limit(40),
    db
      .select()
      .from(schema.deliverables)
      .where(
        and(
          eq(schema.deliverables.userId, input.userId),
          gte(schema.deliverables.completedAt, since),
        ),
      )
      .orderBy(desc(schema.deliverables.completedAt))
      .limit(40),
    db
      .select()
      .from(schema.leaveRequests)
      .where(
        and(
          eq(schema.leaveRequests.userId, input.userId),
          eq(schema.leaveRequests.orgId, input.orgId),
          gte(schema.leaveRequests.createdAt, since),
        ),
      )
      .orderBy(desc(schema.leaveRequests.createdAt))
      .limit(20),
    db
      .select()
      .from(schema.scheduledMeetings)
      .where(
        and(
          eq(schema.scheduledMeetings.attendeeUserId, input.userId),
          gte(schema.scheduledMeetings.startAt, since),
        ),
      )
      .orderBy(desc(schema.scheduledMeetings.startAt))
      .limit(20),
    db
      .select()
      .from(schema.githubEvents)
      .where(
        and(
          eq(schema.githubEvents.userId, input.userId),
          gte(schema.githubEvents.occurredAt, since),
        ),
      )
      .orderBy(desc(schema.githubEvents.occurredAt))
      .limit(60),
    db.query.narratives.findFirst({
      where: eq(schema.narratives.userId, input.userId),
      orderBy: [desc(schema.narratives.createdAt)],
    }),
    db.query.dailyStories.findFirst({
      where: eq(schema.dailyStories.userId, input.userId),
      orderBy: [desc(schema.dailyStories.generatedAt)],
    }),
    db
      .select()
      .from(schema.agentTokens)
      .where(and(eq(schema.agentTokens.userId, input.userId), isNull(schema.agentTokens.revokedAt))),
  ])

  if (!user || !membership) return 'No employee data available.'

  // Every row below carries a `src` id registered here, so the model can cite
  // it and the server can verify the citation afterwards.
  const profileUrl = `/org/${input.orgId}/people/${input.membershipId}`
  const isoDay = (d: Date) => d.toISOString().slice(0, 10)

  // Compact JSON-like context — much cheaper than verbose prose, and the
  // model handles structured data well.
  const ctx = {
    employee: {
      name: user.name,
      login: user.login,
      email: user.email,
      role: membership.role,
      discipline: (membership as { discipline?: string }).discipline ?? 'other',
      jobTitle: (membership as { jobTitle?: string | null }).jobTitle ?? null,
      joinedOn: (user as { joinedOn?: string | null }).joinedOn ?? null,
      hasGithub: !!user.accessToken || user.githubId != null || !!user.githubLogin,
    },
    windowDays,
    windowStart: sinceIso,
    today: new Date().toISOString().slice(0, 10),
    shifts: shifts.map((s) => ({
      src: registry.add('shift', s.id, {
        label: `Shift on ${isoDay(s.punchedInAt)}${s.workSummary ? `: ${s.workSummary}` : ''}`,
        url: profileUrl,
        date: isoDay(s.punchedInAt),
      }),
      date: s.punchedInAt.toISOString().slice(0, 10),
      punchedInAt: s.punchedInAt.toISOString(),
      punchedOutAt: s.punchedOutAt?.toISOString() ?? null,
      minutes: s.punchedOutAt
        ? Math.round((s.punchedOutAt.getTime() - s.punchedInAt.getTime()) / 60000)
        : Math.round((Date.now() - s.punchedInAt.getTime()) / 60000),
      summary: s.workSummary,
    })),
    breaks: breaks.map((b) => ({
      src: registry.add(b.category === 'blocked' ? 'blocker' : 'break', b.id, {
        label: `${b.category === 'blocked' ? 'Blocker' : 'Break'}: ${b.reason}`,
        url: b.category === 'blocked' ? `/org/${input.orgId}/blockers` : profileUrl,
        date: isoDay(b.startedAt),
      }),
      date: b.startedAt.toISOString().slice(0, 10),
      category: b.category,
      reason: b.reason,
      startedAt: b.startedAt.toISOString(),
      endedAt: b.endedAt?.toISOString() ?? null,
      durationMinutes: b.endedAt
        ? Math.round((b.endedAt.getTime() - b.startedAt.getTime()) / 60000)
        : Math.round((Date.now() - b.startedAt.getTime()) / 60000),
      waitingOnExternal: b.waitingOnExternal,
      stillActive: !b.endedAt,
    })),
    deliverables: deliverables.map((d) => ({
      src: registry.add('deliverable', d.id, {
        label: `Logged deliverable: ${d.title}`,
        url: d.url ?? profileUrl,
        date: isoDay(d.completedAt),
      }),
      title: d.title,
      url: d.url,
      detail: d.detail,
      kind: d.kind,
      completedAt: d.completedAt.toISOString(),
      verificationStatus: d.verificationStatus,
    })),
    leaves: leaves.map((l) => ({
      src: registry.add('leave', l.id, {
        label: `Leave request (${l.leaveType}, ${l.status}): ${l.startDate} to ${l.endDate}`,
        url: `/org/${input.orgId}/leaves`,
        date: l.startDate,
      }),
      startDate: l.startDate,
      endDate: l.endDate,
      leaveType: l.leaveType,
      reason: l.reason,
      status: l.status,
      decidedNote: l.decidedNote,
    })),
    meetings: meetings.map((m) => ({
      src: registry.add('one_on_one', m.id, {
        label: `Scheduled meeting: ${m.title}`,
        url: profileUrl,
        date: isoDay(m.startAt),
      }),
      title: m.title,
      startAt: m.startAt.toISOString(),
      endAt: m.endAt.toISOString(),
      agenda: m.agenda,
      hadConference: !!m.conferenceUrl,
    })),
    githubEvents: githubEvents.map((g) => ({
      src: registry.add(githubKind(g.type), g.id, {
        label: `${g.type === 'commit' ? 'Commit' : g.type === 'pr_opened' ? 'PR' : g.type === 'pr_reviewed' ? 'Review' : 'Issue'} in ${g.repo}: ${g.title}`,
        url: g.url,
        date: isoDay(g.occurredAt),
      }),
      date: g.occurredAt.toISOString().slice(0, 10),
      type: g.type,
      repo: g.repo,
      title: g.title,
    })),
    latestNarrative: narrative
      ? {
          src: registry.add('ai_summary', `narrative-${narrative.id}`, {
            label: 'MARINA narrative (AI-written summary, not a primary record)',
            url: profileUrl,
            date: isoDay(narrative.createdAt),
          }),
          createdAt: narrative.createdAt.toISOString(),
          signal: narrative.signal,
          body: narrative.body,
        }
      : null,
    todayStory: todayStory
      ? {
          src: registry.add('ai_summary', `story-${todayStory.id}`, {
            label: 'MARINA daily story (AI-written summary, not a primary record)',
            url: profileUrl,
            date: isoDay(todayStory.generatedAt),
          }),
          generatedAt: todayStory.generatedAt.toISOString(),
          narrative: todayStory.narrative,
        }
      : null,
    pairedDevices: devices.map((d) => ({
      platform: d.platform,
      pairedAt: d.pairedAt.toISOString(),
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    })),
    totals: {
      totalShiftMinutes: shifts.reduce(
        (acc, s) =>
          acc +
          (s.punchedOutAt
            ? Math.round((s.punchedOutAt.getTime() - s.punchedInAt.getTime()) / 60000)
            : Math.round((Date.now() - s.punchedInAt.getTime()) / 60000)),
        0,
      ),
      deliverableCount: deliverables.length,
      githubEventCount: githubEvents.length,
      blockerCount: breaks.filter((b) => b.category === 'blocked').length,
      activeBlocker: breaks.find((b) => b.category === 'blocked' && !b.endedAt)
        ? {
            reason: breaks.find((b) => b.category === 'blocked' && !b.endedAt)!.reason,
            startedAt: breaks
              .find((b) => b.category === 'blocked' && !b.endedAt)!
              .startedAt.toISOString(),
          }
        : null,
      leaveCount: leaves.length,
      meetingCount: meetings.length,
    },
  }
  return JSON.stringify(ctx, null, 2)
}

const SYSTEM_PROMPT = `You are MARINA, the team's AI chief of staff. You help a manager or admin in two ways: (a) answer questions about ONE specific employee using the JSON employee-data context, and (b) explain how MARINA itself works — its features and how to use them — using the PRODUCT KNOWLEDGE provided.

RULES — these are not optional:
1. Ground every claim in the context. Quote specific dates, deliverable titles, repo names, hours when available.
2. For questions about the employee's DATA, if it's not in the context, say so plainly. For product / how-to questions, answer from the product knowledge (or point to the Help center at /help). Never speculate, never invent specifics.
3. Keep responses tight — 2-5 sentences for simple questions, short bullet lists for "list" questions.
4. Be neutral and professional. You are talking to the employee's manager, not the employee. Don't editorialise about performance — present evidence.
5. When discussing dates, use natural language ("last Tuesday", "three days ago"). When precision matters (deliverable timestamps), include the date.
6. If asked for a recommendation (e.g. "should I escalate?"), describe the trade-offs based on the data. Don't make the decision.
7. Never expose raw JSON or internal IDs in your reply.
8. If the user asks about another person, refuse politely — you only have data for the open profile.
9. Prefer primary records (commits, PRs, deliverables, shifts, blockers) over the AI-written narrative/story rows. No preambles like "Based on the data…". Just answer.

${citationRules({ allowProduct: true })}`

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export async function chatAboutEmployee(input: {
  orgId: number
  userId: number
  membershipId: number
  history: ChatTurn[]
  question: string
}): Promise<CitedAnswer & { contextBytes: number }> {
  const registry = new SourceRegistry()
  const ctxBlob = await buildEmployeeContext({
    orgId: input.orgId,
    userId: input.userId,
    membershipId: input.membershipId,
    registry,
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: PRODUCT_KNOWLEDGE },
    {
      role: 'system',
      content: `Employee data (JSON) — use this for questions about this person:\n\n${ctxBlob}`,
    },
    ...input.history.slice(-6).map<ChatMessage>((t) => ({
      role: t.role,
      content: t.content,
    })),
    { role: 'user', content: input.question },
  ]

  const result = await generateCitedAnswer(messages, registry, { allowProduct: true, maxTokens: 1200 })
  return { ...result, contextBytes: ctxBlob.length }
}
