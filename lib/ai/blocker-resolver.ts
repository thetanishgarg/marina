import { and, asc, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { hideSeedRows } from '@/lib/dev-state'
import { githubKind, SourceRegistry, type SourceItem } from '@/lib/ai/citations'
import { generateWithFallback } from '@/lib/ai/registry'
import type { ChatMessage } from '@/lib/ai/provider'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Blocker Resolver v2 — one long-context Gemini call that reads everything
 * MARINA knows around a blocked teammate (their recent PRs and review state,
 * reviews others left on their work, standups, the blocker thread, calendars
 * and leave of the people involved) and returns three things a manager can
 * act on: the likely cause, who can unblock them, and a drafted message.
 *
 * Every field must cite source ids from the context. Citations are verified
 * on the server; an uncited cause or an unblocker who is not in the context
 * is discarded and reported as "not enough data", never guessed.
 *
 * Note on Slack: MARINA does not ingest Slack channel history. The
 * conversational evidence here is standups (posted from Slack or the web) and
 * the blocker's own discussion thread.
 */

export type BlockerCandidate = { key: string; userId: number; name: string; login: string }

export type BlockerContext = {
  /** JSON blob sent to the model. Every row carries a `src` id. */
  blob: string
  registry: SourceRegistry
  /** People the model may name as the unblocker. */
  candidates: BlockerCandidate[]
  blockedName: string
}

export type BlockerDiagnosis = {
  likelyCause: { text: string; evidence: string[] } | null
  unblocker: { userId: number; name: string; login: string; why: string; evidence: string[] } | null
  draftMessage: { to: string; text: string; evidence: string[] } | null
  /** What the model said it was missing, shown so the manager knows the limits. */
  missing: string[]
  confidence: 'low' | 'medium' | 'high'
  /** Only the sources cited by a surviving field. */
  sources: SourceItem[]
  /** Fields removed because their evidence did not check out. */
  dropped: string[]
  provider: string
  model: string
  contextBytes: number
}

const SYSTEM_PROMPT = `You are MARINA's Blocker Resolver. A teammate has flagged that they are blocked. You are given ONE JSON context holding everything known around the blocker: the blocker record, its discussion thread, the blocked person's recent pull requests (with review state), reviews by others, standups, calendars, leave, and a list of candidate teammates with their own recent work, calendar and leave.

Work out, from the context only:
1. likelyCause — the most likely concrete reason this person is still blocked.
2. unblocker — the ONE candidate best placed to unblock them right now, considering who owns or reviewed the related work and who is actually available (not on leave, not in back-to-back meetings).
3. draftMessage — a short, friendly, specific message the manager can send to that person. Name the PR / item concerned. No blame. Under 90 words.

RULES — not optional:
- Every row in the context carries a "src" id. Each of the three fields MUST list in "evidence" the src ids of the exact rows it relies on (1 to 6 ids). Copy ids exactly; never invent an id.
- "unblocker.candidate" MUST be the "key" of one entry in "candidates". Never name anyone else.
- Choosing the unblocker: prefer the person being waited on when they are available. If they are on leave, blocked themselves, or have no free time soon, pick the available candidate whose "relatedWork" shows they reviewed this person's pull requests or worked in the same repository; those rows are valid evidence. Set "unblocker" to null only when no candidate has any related row.
- If the context does not support a cause, set "likelyCause" to null and explain in "missing" what data would be needed. Never guess, and never infer anything about a person's effort or character.
- If the unblocker is null, set "draftMessage" to null as well.
- "confidence" is "high" only when several independent rows agree.
- Do not put src ids or raw JSON inside any "text" or "why".
- "draftMessage.text" is written TO the unblocker (greet them by first name), from the manager, about the blocked person.

Return ONLY this JSON object:
{"likelyCause":{"text":"...","evidence":["..."]}|null,"unblocker":{"candidate":"<candidate key>","why":"...","evidence":["..."]}|null,"draftMessage":{"text":"...","evidence":["..."]}|null,"missing":["..."],"confidence":"low"|"medium"|"high"}`

type RawField = { text?: unknown; why?: unknown; candidate?: unknown; evidence?: unknown }

function validEvidence(field: RawField | null | undefined, registry: SourceRegistry): string[] {
  const ids = Array.isArray(field?.evidence) ? field!.evidence.filter((s): s is string => typeof s === 'string') : []
  return Array.from(new Set(ids)).filter((id) => registry.get(id))
}

function parseObject(text: string): Record<string, unknown> | null {
  const attempt = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  let obj = attempt(text)
  if (obj === undefined) {
    const a = text.indexOf('{')
    const b = text.lastIndexOf('}')
    if (a >= 0 && b > a) obj = attempt(text.slice(a, b + 1))
  }
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null
}

/**
 * Check the model's output against what we actually supplied. Pure (no I/O)
 * so the rules can be tested without a model call.
 */
export function verifyDiagnosis(
  rawText: string,
  ctx: Pick<BlockerContext, 'registry' | 'candidates'>
): Pick<BlockerDiagnosis, 'likelyCause' | 'unblocker' | 'draftMessage' | 'missing' | 'confidence' | 'sources' | 'dropped'> {
  const obj = parseObject(rawText)
  const dropped: string[] = []
  const used = new Map<string, SourceItem>()
  const keep = (ids: string[]) => ids.forEach((id) => used.set(id, ctx.registry.get(id)!))
  // Source ids belong in `evidence`, not in prose: strip any that leak into text.
  const str = (v: unknown) =>
    typeof v === 'string'
      ? v
          .replace(/\s*\(?\b[a-z_]+-\d+\b\)?/g, (m) => (ctx.registry.get(m.replace(/[\s()]/g, '')) ? '' : m))
          .replace(/\s+([.,;])/g, '$1')
          .trim()
      : ''

  if (!obj) {
    return {
      likelyCause: null,
      unblocker: null,
      draftMessage: null,
      missing: ['The model did not return a readable answer.'],
      confidence: 'low',
      sources: [],
      dropped: ['likelyCause', 'unblocker', 'draftMessage'],
    }
  }

  let likelyCause: BlockerDiagnosis['likelyCause'] = null
  const rawCause = obj.likelyCause as RawField | null
  if (rawCause && str(rawCause.text)) {
    const ev = validEvidence(rawCause, ctx.registry)
    if (ev.length > 0) {
      likelyCause = { text: str(rawCause.text), evidence: ev }
      keep(ev)
    } else dropped.push('likelyCause')
  }

  let unblocker: BlockerDiagnosis['unblocker'] = null
  const rawUnblocker = obj.unblocker as RawField | null
  if (rawUnblocker) {
    const cand = ctx.candidates.find((c) => c.key === rawUnblocker.candidate)
    const ev = validEvidence(rawUnblocker, ctx.registry)
    if (cand && ev.length > 0 && str(rawUnblocker.why)) {
      unblocker = { userId: cand.userId, name: cand.name, login: cand.login, why: str(rawUnblocker.why), evidence: ev }
      keep(ev)
    } else dropped.push('unblocker')
  }

  let draftMessage: BlockerDiagnosis['draftMessage'] = null
  const rawDraft = obj.draftMessage as RawField | null
  if (rawDraft && str(rawDraft.text)) {
    const ev = validEvidence(rawDraft, ctx.registry)
    // A draft only makes sense addressed to a verified unblocker.
    if (unblocker && ev.length > 0) {
      draftMessage = { to: unblocker.name, text: str(rawDraft.text), evidence: ev }
      keep(ev)
    } else dropped.push('draftMessage')
  }

  const missing = Array.isArray(obj.missing)
    ? obj.missing.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).slice(0, 5)
    : []
  if (!likelyCause && missing.length === 0) {
    missing.push('There is not enough recorded activity around this blocker to name a cause.')
  }
  const conf = obj.confidence
  const confidence: BlockerDiagnosis['confidence'] =
    !likelyCause || dropped.length > 0 ? 'low' : conf === 'high' || conf === 'medium' ? conf : 'low'

  return { likelyCause, unblocker, draftMessage, missing, confidence, sources: Array.from(used.values()), dropped }
}

/** The single long-context model call (JSON mode), then verification. */
export async function diagnoseBlocker(ctx: BlockerContext): Promise<BlockerDiagnosis> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Blocker context (JSON):\n\n${ctx.blob}` },
  ]
  const { text, provider, model } = await generateWithFallback(
    messages,
    { temperature: 0.2, maxTokens: 1500, responseFormat: 'json' },
    'gemini'
  )
  return { ...verifyDiagnosis(text, ctx), provider, model, contextBytes: ctx.blob.length }
}

/**
 * Gather everything around one blocker into a single context.
 *
 * `visibleUserIds` is the caller's RBAC scope. People outside it (for example
 * the person being waited on, in another team) appear by name with busy/leave
 * availability only — never their meeting titles or work items.
 */
export async function buildBlockerContext(input: {
  orgId: number
  breakId: number
  visibleUserIds: Set<number>
}): Promise<BlockerContext | null> {
  const registry = new SourceRegistry()
  const now = new Date()
  const since = new Date(now.getTime() - 14 * DAY_MS)
  const horizon = new Date(now.getTime() + 3 * DAY_MS)
  const todayIso = now.toISOString().slice(0, 10)
  const isoDay = (d: Date) => d.toISOString().slice(0, 10)

  const blocker = await db.query.breaks.findFirst({
    where: and(eq(schema.breaks.id, input.breakId), eq(schema.breaks.orgId, input.orgId)),
  })
  if (!blocker || blocker.category !== 'blocked') return null

  // Candidate pool: the caller's visible people in this org, plus whoever the
  // blocker says it is waiting on. Capped so the context stays one call.
  const memberships = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.orgId, input.orgId), isNull(schema.memberships.endedAt)))
  const orgUserIds = new Set(memberships.map((m) => m.userId))
  const poolIds = memberships
    .map((m) => m.userId)
    .filter((uid) => uid !== blocker.userId && (input.visibleUserIds.has(uid) || uid === blocker.waitingOnUserId))
    .slice(0, 40)
  if (blocker.waitingOnUserId && orgUserIds.has(blocker.waitingOnUserId) && !poolIds.includes(blocker.waitingOnUserId)) {
    poolIds.push(blocker.waitingOnUserId)
  }
  const allIds = [blocker.userId, ...poolIds]

  const [users, thread, ghEvents, standups, meetings, leaves, openBlockers] = await Promise.all([
    db.select().from(schema.users).where(inArray(schema.users.id, allIds)),
    db
      .select()
      .from(schema.blockerThread)
      .where(eq(schema.blockerThread.breakId, input.breakId))
      .orderBy(asc(schema.blockerThread.createdAt))
      .limit(30),
    db
      .select()
      .from(schema.githubEvents)
      .where(and(inArray(schema.githubEvents.userId, allIds), gte(schema.githubEvents.occurredAt, since), hideSeedRows(schema.githubEvents.externalId)))
      .orderBy(desc(schema.githubEvents.occurredAt))
      .limit(400),
    db
      .select()
      .from(schema.standups)
      .where(and(eq(schema.standups.orgId, input.orgId), inArray(schema.standups.userId, allIds), gte(schema.standups.createdAt, new Date(now.getTime() - 5 * DAY_MS))))
      .orderBy(desc(schema.standups.createdAt))
      .limit(60),
    db
      .select()
      .from(schema.meetings)
      .where(and(inArray(schema.meetings.userId, allIds), gte(schema.meetings.endAt, now), lt(schema.meetings.startAt, horizon), hideSeedRows(schema.meetings.externalId)))
      .orderBy(asc(schema.meetings.startAt))
      .limit(200),
    db
      .select()
      .from(schema.leaveRequests)
      .where(and(eq(schema.leaveRequests.orgId, input.orgId), inArray(schema.leaveRequests.userId, allIds), gte(schema.leaveRequests.endDate, todayIso)))
      .limit(100),
    db
      .select()
      .from(schema.breaks)
      .where(and(eq(schema.breaks.orgId, input.orgId), inArray(schema.breaks.userId, poolIds.length ? poolIds : [-1]), eq(schema.breaks.category, 'blocked'), isNull(schema.breaks.endedAt))),
  ])

  const userById = new Map(users.map((u) => [u.id, u]))
  const nameOf = (uid: number) => {
    const u = userById.get(uid)
    return u?.name ?? (u?.login ? `@${u.login}` : `user-${uid}`)
  }
  const visible = (uid: number) => uid === blocker.userId || input.visibleUserIds.has(uid)
  const blockedName = nameOf(blocker.userId)
  const blockersUrl = `/org/${input.orgId}/blockers`

  const ghRow = (g: (typeof ghEvents)[number]) => {
    const raw = (g.raw ?? {}) as Record<string, unknown>
    const kind = githubKind(g.type)
    return {
      src: registry.add(kind, g.id, {
        label: `${kind === 'pr' ? 'PR' : kind === 'review' ? 'Review' : kind === 'commit' ? 'Commit' : 'Issue'} in ${g.repo}: ${g.title}`,
        url: g.url,
        date: isoDay(g.occurredAt),
        person: nameOf(g.userId),
      }),
      type: g.type,
      repo: g.repo,
      title: g.title,
      at: g.occurredAt.toISOString(),
      ...(g.type === 'pr_opened'
        ? { status: raw.status ?? raw.state ?? null, draft: raw.draft ?? null, requestedReviewers: raw.requestedReviewers ?? null }
        : {}),
      ...(g.type === 'pr_reviewed' ? { prAuthor: raw.prAuthor ?? null, verdict: raw.verdict ?? null } : {}),
    }
  }
  const meetingRow = (m: (typeof meetings)[number]) => ({
    src: registry.add('meeting', m.id, {
      label: visible(m.userId) ? `Calendar event: ${m.title}` : 'Calendar event (busy)',
      date: isoDay(m.startAt),
      person: nameOf(m.userId),
    }),
    title: visible(m.userId) ? m.title : 'Busy',
    startAt: m.startAt.toISOString(),
    endAt: m.endAt.toISOString(),
  })
  const leaveRow = (l: (typeof leaves)[number]) => ({
    src: registry.add('leave', l.id, {
      label: `Leave (${l.status}): ${l.startDate} to ${l.endDate}`,
      url: `/org/${input.orgId}/leaves`,
      date: l.startDate,
      person: nameOf(l.userId),
    }),
    startDate: l.startDate,
    endDate: l.endDate,
    status: l.status,
  })
  const standupRow = (s: (typeof standups)[number]) => ({
    src: registry.add('standup', s.id, {
      label: `Standup (${s.source}) on ${s.day}`,
      date: s.day,
      person: nameOf(s.userId),
    }),
    day: s.day,
    source: s.source,
    yesterday: s.yesterday,
    today: s.today,
    blockers: s.blockers,
  })

  const blockedLogin = userById.get(blocker.userId)?.githubLogin ?? userById.get(blocker.userId)?.login ?? null
  const blockedRepos = new Set(ghEvents.filter((g) => g.userId === blocker.userId).map((g) => g.repo))

  const candidates: BlockerCandidate[] = poolIds.map((uid) => ({
    key: `person-${uid}`,
    userId: uid,
    name: nameOf(uid),
    login: userById.get(uid)?.login ?? '',
  }))

  const ctx = {
    now: now.toISOString(),
    blocker: {
      src: registry.add('blocker', blocker.id, {
        label: `Blocker: ${blocker.reason}`,
        url: blockersUrl,
        date: isoDay(blocker.startedAt),
        person: blockedName,
      }),
      blockedPerson: blockedName,
      reason: blocker.reason,
      startedAt: blocker.startedAt.toISOString(),
      hoursBlocked: Math.round(((now.getTime() - blocker.startedAt.getTime()) / 3_600_000) * 10) / 10,
      waitingOn: blocker.waitingOnUserId ? `person-${blocker.waitingOnUserId}` : null,
      waitingOnExternal: blocker.waitingOnExternal,
      expectedEndAt: blocker.expectedEndAt?.toISOString() ?? null,
    },
    thread: thread.map((t) => ({
      src: registry.add('thread_message', t.id, {
        label: `Blocker thread ${t.kind}: ${t.body}`,
        url: blockersUrl,
        date: isoDay(t.createdAt),
        person: nameOf(t.authorUserId),
      }),
      kind: t.kind,
      author: nameOf(t.authorUserId),
      body: t.body,
      at: t.createdAt.toISOString(),
    })),
    blockedPerson: {
      name: blockedName,
      github: ghEvents.filter((g) => g.userId === blocker.userId).slice(0, 40).map(ghRow),
      standups: standups.filter((s) => s.userId === blocker.userId).map(standupRow),
      calendar: meetings.filter((m) => m.userId === blocker.userId).slice(0, 15).map(meetingRow),
    },
    candidates: poolIds.map((uid) => {
      const v = visible(uid)
      const gh = ghEvents.filter((g) => g.userId === uid)
      // Work that touches the blocked person: reviews of their PRs, or activity
      // in the same repos. Only for people the caller is allowed to see.
      const related = v
        ? gh.filter(
            (g) =>
              (g.type === 'pr_reviewed' && blockedLogin != null && (g.raw as { prAuthor?: string } | null)?.prAuthor === blockedLogin) ||
              blockedRepos.has(g.repo)
          )
        : []
      const open = openBlockers.find((b) => b.userId === uid)
      return {
        key: `person-${uid}`,
        name: nameOf(uid),
        isWhoTheyAreWaitingOn: uid === blocker.waitingOnUserId,
        relatedWork: related.slice(0, 12).map(ghRow),
        standups: v ? standups.filter((s) => s.userId === uid).slice(0, 2).map(standupRow) : [],
        calendarNext3Days: meetings.filter((m) => m.userId === uid).slice(0, 10).map(meetingRow),
        leave: leaves.filter((l) => l.userId === uid && l.status !== 'denied' && l.status !== 'cancelled').map(leaveRow),
        currentlyBlockedThemselves: open && v
          ? {
              src: registry.add('blocker', open.id, {
                label: `Open blocker: ${open.reason}`,
                url: blockersUrl,
                date: isoDay(open.startedAt),
                person: nameOf(uid),
              }),
              reason: open.reason,
            }
          : null,
      }
    }),
  }

  return { blob: JSON.stringify(ctx), registry, candidates, blockedName }
}
