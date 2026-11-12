import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { hideSeedRows } from '@/lib/dev-state'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** A pull request counts as waiting once it has been open this long without a review. */
export const REVIEW_WAIT_HOURS = 24

export type WarningEvidence = { id: string; label: string; href?: string }

export type EarlyWarning = {
  userId: number
  name: string
  kind: 'review_wait' | 'standup_blocker'
  /** One neutral sentence saying what was observed. */
  text: string
  /** The records the sentence was built from. */
  evidence: WarningEvidence[]
  /** Hours the person has been waiting, for ordering. */
  hours: number
}

/**
 * Early warnings for the morning brief: people who look likely to get stuck
 * but have NOT flagged a blocker yet. Deterministic rules over stored data,
 * with no model call, so the result is instant, free and cannot invent
 * anything. Each warning lists the records it was derived from.
 *
 * Rules:
 *  1. An open, non-draft pull request with no review after 24h. If the person
 *     who usually reviews their work is on approved leave, that is added.
 *  2. A standup that mentions a blocker while no blocker has been flagged.
 *
 * People with a blocker already open are skipped: the manager already knows.
 * Scope is enforced by the caller passing only the user ids it may see.
 */
export async function detectEarlyWarnings(input: { orgId: number; userIds: number[] }): Promise<EarlyWarning[]> {
  const ids = Array.from(new Set(input.userIds))
  if (ids.length === 0) return []
  const now = Date.now()
  const todayIso = new Date(now).toISOString().slice(0, 10)

  const [users, ghEvents, openBlockers, leaves, standups] = await Promise.all([
    db
      .select({ id: schema.users.id, name: schema.users.name, login: schema.users.login, githubLogin: schema.users.githubLogin })
      .from(schema.users)
      .where(inArray(schema.users.id, ids)),
    db
      .select()
      .from(schema.githubEvents)
      .where(and(inArray(schema.githubEvents.userId, ids), gte(schema.githubEvents.occurredAt, new Date(now - 30 * DAY_MS)), hideSeedRows(schema.githubEvents.externalId)))
      .orderBy(desc(schema.githubEvents.occurredAt))
      .limit(1500),
    db
      .select({ userId: schema.breaks.userId })
      .from(schema.breaks)
      .where(and(eq(schema.breaks.orgId, input.orgId), inArray(schema.breaks.userId, ids), eq(schema.breaks.category, 'blocked'), isNull(schema.breaks.endedAt))),
    db
      .select()
      .from(schema.leaveRequests)
      .where(and(eq(schema.leaveRequests.orgId, input.orgId), inArray(schema.leaveRequests.userId, ids), eq(schema.leaveRequests.status, 'approved'), gte(schema.leaveRequests.endDate, todayIso))),
    db
      .select()
      .from(schema.standups)
      .where(and(eq(schema.standups.orgId, input.orgId), inArray(schema.standups.userId, ids), gte(schema.standups.createdAt, new Date(now - 36 * HOUR_MS))))
      .orderBy(desc(schema.standups.createdAt)),
  ])

  const userById = new Map(users.map((u) => [u.id, u]))
  const nameOf = (uid: number) => userById.get(uid)?.name ?? `@${userById.get(uid)?.login ?? uid}`
  const alreadyFlagged = new Set(openBlockers.map((b) => b.userId))
  const onLeaveNow = new Map(leaves.filter((l) => l.startDate <= todayIso).map((l) => [l.userId, l]))
  const raw = (g: (typeof ghEvents)[number]) => (g.raw ?? {}) as Record<string, unknown>

  const reviews = ghEvents.filter((g) => g.type === 'pr_reviewed')
  const warnings: EarlyWarning[] = []

  // ── Rule 1: open PR waiting on review ─────────────────────────────────────
  for (const pr of ghEvents) {
    if (pr.type !== 'pr_opened' || alreadyFlagged.has(pr.userId)) continue
    const r = raw(pr)
    const isOpen = (r.status ?? r.state) === 'open' && r.merged !== true && r.draft !== true
    if (!isOpen) continue
    const hours = Math.floor((now - pr.occurredAt.getTime()) / HOUR_MS)
    if (hours < REVIEW_WAIT_HOURS) continue
    const reviewed = reviews.some(
      (rv) => rv.repo === pr.repo && rv.userId !== pr.userId && rv.occurredAt >= pr.occurredAt && (raw(rv).number === r.number || rv.title === pr.title),
    )
    if (reviewed) continue

    const evidence: WarningEvidence[] = [{ id: `pr-${pr.id}`, label: `PR in ${pr.repo}: ${pr.title}`, href: pr.url }]
    let text = `${nameOf(pr.userId)}'s pull request "${pr.title}" has waited ${hours}h with no review.`

    // Who usually reviews this person's work? (Most reviews of their PRs in the window.)
    const authorLogin = userById.get(pr.userId)?.githubLogin ?? userById.get(pr.userId)?.login
    const counts = new Map<number, { n: number; last: (typeof ghEvents)[number] }>()
    for (const rv of reviews) {
      if (rv.userId === pr.userId || raw(rv).prAuthor !== authorLogin) continue
      const c = counts.get(rv.userId)
      if (c) c.n++
      else counts.set(rv.userId, { n: 1, last: rv })
    }
    const usual = Array.from(counts.entries()).sort((a, b) => b[1].n - a[1].n)[0]
    if (usual) {
      const [reviewerId, info] = usual
      const leave = onLeaveNow.get(reviewerId)
      if (leave) {
        text += ` ${nameOf(reviewerId)}, who last reviewed their work, is on leave until ${leave.endDate}.`
        evidence.push(
          { id: `review-${info.last.id}`, label: `Review by ${nameOf(reviewerId)}: ${info.last.title}`, href: info.last.url },
          { id: `leave-${leave.id}`, label: `${nameOf(reviewerId)} on leave ${leave.startDate} to ${leave.endDate}`, href: `/org/${input.orgId}/leaves` },
        )
      }
    }
    warnings.push({ userId: pr.userId, name: nameOf(pr.userId), kind: 'review_wait', text, evidence, hours })
  }

  // ── Rule 2: standup mentions a blocker, none flagged ──────────────────────
  const seenStandup = new Set<number>()
  for (const s of standups) {
    if (seenStandup.has(s.userId)) continue
    seenStandup.add(s.userId)
    const said = s.blockers.trim()
    if (alreadyFlagged.has(s.userId) || said.length < 4 || /^(none|no|nope|nil|n\/a|na|nothing|-)\.?$/i.test(said)) continue
    if (warnings.some((w) => w.userId === s.userId)) continue
    warnings.push({
      userId: s.userId,
      name: nameOf(s.userId),
      kind: 'standup_blocker',
      text: `${nameOf(s.userId)} mentioned a blocker in standup but has not flagged one: "${said.slice(0, 140)}"`,
      evidence: [{ id: `standup-${s.id}`, label: `Standup (${s.source}) on ${s.day}` }],
      hours: Math.floor((now - s.createdAt.getTime()) / HOUR_MS),
    })
  }

  // One warning per person (the longest wait), longest first.
  const byUser = new Map<number, EarlyWarning>()
  for (const w of warnings.sort((a, b) => b.hours - a.hours)) if (!byUser.has(w.userId)) byUser.set(w.userId, w)
  return Array.from(byUser.values()).slice(0, 5)
}

/** Summary of how long blockers take to clear, from resolved blocker records. */
export type UnblockStats = {
  windowDays: number
  resolvedCount: number
  /** Median minutes from flagged to cleared; null when nothing was resolved. */
  medianMinutes: number | null
  /** Resolved by someone else (a manager or teammate) vs ended by the person. */
  helpedCount: number
  selfCount: number
  medianHelpedMinutes: number | null
  medianSelfMinutes: number | null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2)
}

/** Pure: compute unblock stats from resolved blocker rows. */
export function computeUnblockStats(
  rows: Array<{ startedAt: Date; endedAt: Date | null; resolvedByUserId: number | null; userId: number }>,
  windowDays: number,
): UnblockStats {
  const done = rows.filter((r): r is typeof r & { endedAt: Date } => r.endedAt != null)
  const mins = (r: { startedAt: Date; endedAt: Date }) => Math.max(0, Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60_000))
  const helped = done.filter((r) => r.resolvedByUserId != null && r.resolvedByUserId !== r.userId)
  const self = done.filter((r) => !(r.resolvedByUserId != null && r.resolvedByUserId !== r.userId))
  return {
    windowDays,
    resolvedCount: done.length,
    medianMinutes: median(done.map(mins)),
    helpedCount: helped.length,
    selfCount: self.length,
    medianHelpedMinutes: median(helped.map(mins)),
    medianSelfMinutes: median(self.map(mins)),
  }
}
