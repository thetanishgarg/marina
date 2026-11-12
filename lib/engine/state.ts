import { and, asc, eq, gte, lt, sql, sum } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import type { DailyState } from '@/lib/db/schema'
import { dayBoundsInTz, DEFAULT_TZ } from '@/lib/time/tz'

export type ComputedState = {
  state: DailyState
  outputCount: number
  onlineSeconds: number
  activeSeconds: number
  focusWorkRatio: number
  staticIdleRuns: number
  shotCount: number
  reason: string
}

/**
 * Calendar-day bounds. Kept named `dayBoundsUtc` for backward compat but it
 * is now timezone-aware: pass `tz` (org timezone) so 9pm IST work doesn't
 * land in tomorrow's bucket.
 *
 * When called without `tz`, falls back to Asia/Kolkata (MARINA is India-first).
 */
export function dayBoundsUtc(day: Date | string, tz: string = DEFAULT_TZ): { start: Date; end: Date; iso: string } {
  const d = typeof day === 'string' ? new Date(`${day}T12:00:00Z`) : new Date(day)
  const { startIso, endIso, iso } = dayBoundsInTz(d, tz)
  return { start: startIso, end: endIso, iso }
}

export async function computeDailyState(userId: number, day: Date | string = new Date()): Promise<ComputedState> {
  const { start, end } = dayBoundsUtc(day)

  // 1. Output signal — count distinct events.
  const outputRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.githubEvents)
    .where(
      and(
        eq(schema.githubEvents.userId, userId),
        gte(schema.githubEvents.occurredAt, start),
        lt(schema.githubEvents.occurredAt, end)
      )
    )
  const outputCount = Number(outputRows[0]?.c ?? 0)

  // 2. Presence — online seconds + active vs idle.
  const presenceRows = await db
    .select({
      active: sum(schema.localActivity.activeSeconds).mapWith(Number),
      idle: sum(schema.localActivity.idleSeconds).mapWith(Number),
    })
    .from(schema.localActivity)
    .where(
      and(
        eq(schema.localActivity.userId, userId),
        gte(schema.localActivity.windowStart, start),
        lt(schema.localActivity.windowStart, end)
      )
    )
  const activeSeconds = Number(presenceRows[0]?.active ?? 0)
  const idleSeconds = Number(presenceRows[0]?.idle ?? 0)
  const onlineSeconds = activeSeconds + idleSeconds

  // 3. Focus — fetch ordered shot analyses for the day.
  const shots = await db
    .select({
      hint: schema.shotAnalyses.visibleContentHint,
      label: schema.shotAnalyses.workAppLabel,
      analyzedAt: schema.shotAnalyses.analyzedAt,
    })
    .from(schema.shotAnalyses)
    .innerJoin(schema.screenshots, eq(schema.shotAnalyses.screenshotId, schema.screenshots.id))
    .where(
      and(
        eq(schema.shotAnalyses.userId, userId),
        gte(schema.screenshots.capturedAt, start),
        lt(schema.screenshots.capturedAt, end)
      )
    )
    .orderBy(asc(schema.screenshots.capturedAt))

  const shotCount = shots.length
  const workCount = shots.filter((s) => s.label === 'work').length
  const focusWorkRatio = shotCount === 0 ? 0 : Math.round((workCount / shotCount) * 100)

  // Longest run of static_idle hits.
  let bestRun = 0
  let currentRun = 0
  for (const s of shots) {
    if (s.hint === 'static_idle') {
      currentRun++
      if (currentRun > bestRun) bestRun = currentRun
    } else {
      currentRun = 0
    }
  }

  const noSignals = outputCount === 0 && onlineSeconds === 0 && shotCount === 0
  if (noSignals) {
    return {
      state: 'NoData',
      outputCount,
      onlineSeconds,
      activeSeconds,
      focusWorkRatio,
      staticIdleRuns: bestRun,
      shotCount,
      reason: 'No signals for this day.',
    }
  }

  const onlineHours = onlineSeconds / 3600
  const activeHours = activeSeconds / 3600

  // Stored as 'PossiblyDummying' (shown as "Needs a check-in", see
  // state-labels.ts): the agent reports a substantial active foreground window
  // while consecutive screen labels show no change. The reason text below is
  // read by the manager AND the employee, so it states the signals neutrally.
  if (activeHours >= 2 && bestRun >= 3) {
    return {
      state: 'PossiblyDummying',
      outputCount,
      onlineSeconds,
      activeSeconds,
      focusWorkRatio,
      staticIdleRuns: bestRun,
      shotCount,
      reason: `${activeHours.toFixed(1)}h of active time was recorded, while ${bestRun} screen check-ins in a row showed no change. The signals disagree, so a quick check-in is worth it.`,
    }
  }

  // Blocked: online a lot, trying (focus is work) but no output.
  if (onlineHours > 3 && outputCount === 0 && focusWorkRatio >= 50) {
    return {
      state: 'Blocked',
      outputCount,
      onlineSeconds,
      activeSeconds,
      focusWorkRatio,
      staticIdleRuns: bestRun,
      shotCount,
      reason: `Online ${onlineHours.toFixed(1)}h and focused on work (${focusWorkRatio}%), with no GitHub output yet. Something may be in the way.`,
    }
  }

  // Stored as 'Disengaged' (shown as "Needs a check-in"): online with no
  // output and little time in work apps. A low focus ratio only
  // counts as "distracted" when we actually have screenshots to back it up —
  // with screenshots off (shotCount === 0) focusWorkRatio is 0 by absence, not
  // by evidence, so we must NOT label someone Disengaged on that alone.
  if (onlineHours > 3 && outputCount === 0 && ((shotCount > 0 && focusWorkRatio < 30) || bestRun >= 3)) {
    return {
      state: 'Disengaged',
      outputCount,
      onlineSeconds,
      activeSeconds,
      focusWorkRatio,
      staticIdleRuns: bestRun,
      shotCount,
      reason: `Online ${onlineHours.toFixed(1)}h with no output logged yet and ${focusWorkRatio}% of screen check-ins in work apps. A check-in may help.`,
    }
  }

  // High vs Steady — calibrate on output and focus.
  if (outputCount > 0 && (focusWorkRatio === 0 || focusWorkRatio >= 60)) {
    return {
      state: 'High',
      outputCount,
      onlineSeconds,
      activeSeconds,
      focusWorkRatio,
      staticIdleRuns: bestRun,
      shotCount,
      reason: `${outputCount} GitHub event(s)${shotCount ? `, ${focusWorkRatio}% focus on work` : ''}.`,
    }
  }

  return {
    state: 'Steady',
    outputCount,
    onlineSeconds,
    activeSeconds,
    focusWorkRatio,
    staticIdleRuns: bestRun,
    shotCount,
    reason: 'Mixed signals, nothing alarming.',
  }
}

export async function upsertDailyState(userId: number, day: Date | string = new Date()): Promise<ComputedState & { dayIso: string }> {
  const { iso } = dayBoundsUtc(day)
  const result = await computeDailyState(userId, day)
  await db
    .insert(schema.dailyStates)
    .values({
      userId,
      day: iso,
      state: result.state,
      outputCount: result.outputCount,
      onlineSeconds: result.onlineSeconds,
      focusWorkRatio: result.focusWorkRatio,
      staticIdleRuns: result.staticIdleRuns,
      reason: result.reason,
    })
    .onConflictDoUpdate({
      target: [schema.dailyStates.userId, schema.dailyStates.day],
      set: {
        state: result.state,
        outputCount: result.outputCount,
        onlineSeconds: result.onlineSeconds,
        focusWorkRatio: result.focusWorkRatio,
        staticIdleRuns: result.staticIdleRuns,
        reason: result.reason,
        computedAt: new Date(),
      },
    })
  return { ...result, dayIso: iso }
}
