import { NextResponse } from 'next/server'
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { hideSeedRows } from '@/lib/dev-state'
import { db, schema } from '@/lib/db/client'
import { HttpError, ensureScopeMembership, requireScope } from '@/lib/auth/guards'
import { membershipWindow } from '@/lib/auth/tenant-scope'
import { buildMemberWork } from '@/lib/people/work'
import { getTodayStandup } from '@/lib/standups/save'

export const runtime = 'nodejs'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Full drill-down payload for a single member: today's scenes, GitHub events
 * for the last 7 days, recent breaks (7d), recent leaves (60d), latest shift,
 * latest narrative + story. Fed to the in-app member-detail modal so the
 * dashboard payload stays small.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ orgId: string; membershipId: string }> },
) {
  const { orgId: rawO, membershipId: rawM } = await ctx.params
  const orgId = Number(rawO)
  const membershipId = Number(rawM)
  if (!Number.isInteger(orgId) || !Number.isInteger(membershipId)) {
    return NextResponse.json({ error: 'invalid ids' }, { status: 400 })
  }

  try {
    const { scope } = await requireScope(orgId, 'manager')

    const membership = await db.query.memberships.findFirst({
      where: and(
        eq(schema.memberships.id, membershipId),
        eq(schema.memberships.orgId, orgId),
        isNull(schema.memberships.endedAt),
      ),
    })
    if (!membership) return NextResponse.json({ error: 'member not found' }, { status: 404 })
    // RBAC scope: a manager/lead may only drill into people they manage.
    ensureScopeMembership(scope, membershipId)

    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, membership.userId),
    })
    if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })

    const since7 = new Date(Date.now() - 7 * DAY_MS)
    const since60 = new Date(Date.now() - 60 * DAY_MS)
    const today = new Date()
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    // Multi-tenant scope: only consider events / narratives from the user's
    // active-membership window for THIS org.
    const window = await membershipWindow(orgId, user.id)
    const windowStart = window?.start ?? new Date(0)
    const windowEnd = window?.end ?? new Date('2999-12-31')
    const narrativeStart = windowStart > since60 ? windowStart : since60
    const eventStart = windowStart > since7 ? windowStart : since7

    // Look back 28 days for the attendance strip + day picker on the Activity tab.
    const since28 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 27)

    // Self-reported deliverables for the last 14 days. Universal — every
    // role can log these so the Activity tab is useful even without GitHub.
    const since14 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14)
    const recentDeliverables = await db
      .select()
      .from(schema.deliverables)
      .where(
        and(
          eq(schema.deliverables.userId, user.id),
          gte(schema.deliverables.completedAt, since14),
        ),
      )
      .orderBy(desc(schema.deliverables.completedAt))
      .limit(50)

    const [latestNarrative, todayStory, ghEvents, recentBreaks, recentLeaves, latestShift, shifts28d, breaks28d] = await Promise.all([
      db.query.narratives.findFirst({
        where: and(
          eq(schema.narratives.userId, user.id),
          gte(schema.narratives.createdAt, narrativeStart),
          sql`${schema.narratives.createdAt} <= ${windowEnd}`,
        ),
        orderBy: [desc(schema.narratives.createdAt)],
      }),
      db.query.dailyStories.findFirst({
        where: and(
          eq(schema.dailyStories.userId, user.id),
          eq(schema.dailyStories.day, todayIso),
        ),
      }),
      db
        .select()
        .from(schema.githubEvents)
        .where(
          and(
            eq(schema.githubEvents.userId, user.id),
            gte(schema.githubEvents.occurredAt, eventStart),
            sql`${schema.githubEvents.occurredAt} <= ${windowEnd}`,
            hideSeedRows(schema.githubEvents.externalId),
          ),
        )
        .orderBy(desc(schema.githubEvents.occurredAt))
        .limit(30),
      db
        .select()
        .from(schema.breaks)
        .where(
          and(
            eq(schema.breaks.userId, user.id),
            gte(schema.breaks.startedAt, since7),
          ),
        )
        .orderBy(desc(schema.breaks.startedAt))
        .limit(20),
      db
        .select()
        .from(schema.leaveRequests)
        .where(
          and(
            eq(schema.leaveRequests.userId, user.id),
            gte(schema.leaveRequests.createdAt, since60),
          ),
        )
        .orderBy(desc(schema.leaveRequests.createdAt))
        .limit(10),
      db.query.shifts.findFirst({
        where: eq(schema.shifts.userId, user.id),
        orderBy: [desc(schema.shifts.punchedInAt)],
      }),
      // Shifts overlapping the last 28 days — used to derive per-day attendance
      db
        .select({
          id: schema.shifts.id,
          punchedInAt: schema.shifts.punchedInAt,
          punchedOutAt: schema.shifts.punchedOutAt,
        })
        .from(schema.shifts)
        .where(
          and(
            eq(schema.shifts.userId, user.id),
            gte(schema.shifts.punchedInAt, since28),
          ),
        ),
      // Breaks within the last 28 days — feeds the day picker on the Activity tab
      db
        .select()
        .from(schema.breaks)
        .where(
          and(
            eq(schema.breaks.userId, user.id),
            gte(schema.breaks.startedAt, since28),
          ),
        )
        .orderBy(desc(schema.breaks.startedAt)),
    ])

    // Per-day attendance for the last 28 days, derived from real shifts + leaves.
    // `pre_join` covers days before the user started — without this, fresh
    // accounts get a sea of pink "absent" cells for the 28 days before they
    // joined, which is both wrong AND a bad first impression on the profile.
    const attendance28d: Array<{
      date: string
      kind: 'present' | 'absent' | 'leave' | 'weekend' | 'today' | 'future' | 'pre_join'
      minutesWorked: number
      leaveType?: string
      leaveReason?: string
    }> = []
    // Earliest day this person should be counted as working. Prefer the
    // user-set `joinedOn` (filled via the dashboard prompt) and fall back to
    // the membership's `createdAt` — the moment they accepted the invite.
    const joinedOnStr =
      (user as { joinedOn?: string | null }).joinedOn ??
      (membership.createdAt
        ? `${membership.createdAt.getFullYear()}-${String(membership.createdAt.getMonth() + 1).padStart(2, '0')}-${String(membership.createdAt.getDate()).padStart(2, '0')}`
        : null)
    const approvedLeaves = recentLeaves.filter((l) => l.status === 'approved')
    const minutesByDay = new Map<string, number>()
    for (const s of shifts28d) {
      const start = s.punchedInAt
      const end = s.punchedOutAt ?? new Date()
      // Bucket the shift into per-day minutes (handles shifts that cross midnight)
      let cursor = new Date(start)
      while (cursor < end) {
        const dayEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
        const segEnd = dayEnd < end ? dayEnd : end
        const mins = Math.max(0, Math.round((segEnd.getTime() - cursor.getTime()) / 60000))
        const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`
        minutesByDay.set(iso, (minutesByDay.get(iso) ?? 0) + mins)
        cursor = dayEnd
      }
    }
    // Per-employee working days override the legacy Mon–Fri assumption.
    // Defaults to [Sun=false, Mon=true, …, Sat=false] for older rows.
    const workingDays =
      (membership as { workingDays?: boolean[] }).workingDays ??
      [false, true, true, true, true, true, false]

    for (let i = 27; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const dow = d.getDay()
      const isToday = i === 0
      const isWorkingDay = workingDays[dow] ?? false
      const leave = approvedLeaves.find((l) => l.startDate <= iso && l.endDate >= iso)
      const mins = minutesByDay.get(iso) ?? 0
      let kind: typeof attendance28d[number]['kind']
      if (joinedOnStr && iso < joinedOnStr) {
        kind = 'pre_join'
      } else if (leave) {
        kind = 'leave'
      } else if (mins > 0) {
        kind = isToday ? 'today' : 'present'
      } else if (isToday) {
        kind = 'today'
      } else if (!isWorkingDay) {
        kind = 'weekend'
      } else {
        kind = 'absent'
      }
      attendance28d.push({
        date: iso,
        kind,
        minutesWorked: mins,
        leaveType: leave?.leaveType,
        leaveReason: leave?.reason,
      })
    }

    // Pull activity windows that overlap the latest shift so the Shifts tab
    // can render a real per-segment timeline (what app was being used when).
    let shiftSegments: Array<{
      startAt: string
      endAt: string
      kind: 'work' | 'break' | 'idle'
      label: string
      app?: string | null
      detail?: string
    }> = []
    const shiftTotals: { workMin: number; breakMin: number; idleMin: number; lockedMin: number } = { workMin: 0, breakMin: 0, idleMin: 0, lockedMin: 0 }
    if (latestShift) {
      const shiftStart = latestShift.punchedInAt
      const shiftEnd = latestShift.punchedOutAt ?? new Date()
      const acts = await db
        .select({
          windowStart: schema.localActivity.windowStart,
          windowEnd: schema.localActivity.windowEnd,
          activeApp: schema.localActivity.activeApp,
          activeSeconds: schema.localActivity.activeSeconds,
          idleSeconds: schema.localActivity.idleSeconds,
          lockedSeconds: schema.localActivity.lockedSeconds,
          windowTitle: schema.localActivity.windowTitle,
        })
        .from(schema.localActivity)
        .where(
          and(
            eq(schema.localActivity.userId, user.id),
            gte(schema.localActivity.windowStart, shiftStart),
            sql`${schema.localActivity.windowEnd} <= ${shiftEnd}`,
          ),
        )
        .orderBy(schema.localActivity.windowStart)

      const shiftBreaks = await db
        .select()
        .from(schema.breaks)
        .where(
          and(
            eq(schema.breaks.userId, user.id),
            gte(schema.breaks.startedAt, shiftStart),
            sql`${schema.breaks.startedAt} <= ${shiftEnd}`,
          ),
        )
        .orderBy(schema.breaks.startedAt)

      // Build a coarse, minute-resolution timeline from the shift's start
      // to end. We collapse adjacent activity windows that share an active app
      // into one segment so the bar isn't a thousand stripes.
      type Seg = {
        startAt: Date
        endAt: Date
        kind: 'work' | 'break' | 'idle'
        label: string
        app?: string | null
        detail?: string
      }
      const segs: Seg[] = []
      const pushOrExtend = (seg: Seg) => {
        const last = segs[segs.length - 1]
        if (
          last &&
          last.kind === seg.kind &&
          (last.app ?? null) === (seg.app ?? null) &&
          seg.startAt.getTime() - last.endAt.getTime() < 2 * 60_000 // < 2 min gap
        ) {
          last.endAt = seg.endAt
          last.detail = seg.detail ?? last.detail
        } else {
          segs.push(seg)
        }
      }
      for (const a of acts) {
        const isIdle = a.idleSeconds > a.activeSeconds * 1.5
        pushOrExtend({
          startAt: a.windowStart,
          endAt: a.windowEnd,
          kind: isIdle ? 'idle' : 'work',
          label: isIdle ? 'Idle' : (a.activeApp || 'Working'),
          app: a.activeApp,
          detail: a.windowTitle ?? undefined,
        })
      }

      // Smooth over short idle blips — a 5-minute bathroom break or a window
      // shuffle shouldn't shatter a long productive stretch into ten green
      // stripes. Anything ≤ 10 min that sits between work (or at the start/
      // end of a work run) gets absorbed into the surrounding work segment.
      const IDLE_ABSORB_MS = 10 * 60_000
      const smoothed: Seg[] = []
      for (let i = 0; i < segs.length; i++) {
        const cur = segs[i]!
        const isShortIdle =
          cur.kind === 'idle' &&
          cur.endAt.getTime() - cur.startAt.getTime() <= IDLE_ABSORB_MS
        if (isShortIdle) {
          const prev = smoothed[smoothed.length - 1]
          const next = segs[i + 1]
          // Absorb into preceding work segment if there is one
          if (prev && prev.kind === 'work') {
            prev.endAt = cur.endAt
            continue
          }
          // If next is work, drop the idle (the work segment will be pushed next)
          if (next && next.kind === 'work') continue
        }
        smoothed.push(cur)
      }

      // After absorption, two adjacent same-kind+same-app work segments may
      // now actually touch — coalesce them.
      const coalesced: Seg[] = []
      for (const seg of smoothed) {
        const last = coalesced[coalesced.length - 1]
        if (
          last &&
          last.kind === seg.kind &&
          (last.app ?? null) === (seg.app ?? null) &&
          seg.startAt.getTime() - last.endAt.getTime() < 60_000
        ) {
          last.endAt = seg.endAt
          last.detail = seg.detail ?? last.detail
        } else {
          coalesced.push(seg)
        }
      }
      segs.length = 0
      segs.push(...coalesced)

      // Overlay breaks on top — these take precedence visually
      for (const b of shiftBreaks) {
        segs.push({
          startAt: b.startedAt,
          endAt: b.endedAt ?? shiftEnd,
          kind: 'break',
          label: b.category === 'meeting' ? 'Meeting' :
                 b.category === 'lunch'   ? 'Lunch'   :
                 b.category === 'blocked' ? 'Blocked' :
                 b.category === 'focus'   ? 'Focus (heads-down)' :
                 'Break',
          detail: b.reason || undefined,
        })
      }
      segs.sort((x, y) => x.startAt.getTime() - y.startAt.getTime())

      // Compute totals from raw (pre-overlap) data to keep them honest
      for (const a of acts) {
        const mins = Math.round((a.windowEnd.getTime() - a.windowStart.getTime()) / 60_000)
        if (a.lockedSeconds > a.activeSeconds && a.lockedSeconds > a.idleSeconds) {
          shiftTotals.lockedMin += mins
        } else if (a.idleSeconds > a.activeSeconds * 1.5) {
          shiftTotals.idleMin += mins
        } else {
          shiftTotals.workMin += mins
        }
      }
      for (const b of shiftBreaks) {
        const end = b.endedAt ?? shiftEnd
        shiftTotals.breakMin += Math.round((end.getTime() - b.startedAt.getTime()) / 60_000)
      }

      // ── Enrich each segment with what was on screen ────────────────────
      // The whole point of the screenshot pipeline is to *interpret* what the
      // person was doing — not just log the app name. We pull every shot
      // analysis that overlaps the shift, then attach the dominant
      // visible-content hint + a derived natural-language label to each
      // segment. So "Chrome" becomes "Reading docs in Chrome", "VS Code"
      // becomes "Editing code", and so on.
      const shotsInShift = await db
        .select({
          analyzedAt: schema.shotAnalyses.analyzedAt,
          workAppLabel: schema.shotAnalyses.workAppLabel,
          appCategory: schema.shotAnalyses.appCategory,
          visibleContentHint: schema.shotAnalyses.visibleContentHint,
          progressScore: schema.shotAnalyses.progressScore,
        })
        .from(schema.shotAnalyses)
        .where(
          and(
            eq(schema.shotAnalyses.userId, user.id),
            gte(schema.shotAnalyses.analyzedAt, shiftStart),
            sql`${schema.shotAnalyses.analyzedAt} <= ${shiftEnd}`,
          ),
        )
        .orderBy(schema.shotAnalyses.analyzedAt)

      // For each segment, find the predominant content hint + app category
      // by counting shots that fall inside it.
      function describeSegment(seg: { startAt: Date; endAt: Date; kind: string; app?: string | null }): {
        activity:
          | 'coding'
          | 'designing'
          | 'reading'
          | 'meeting'
          | 'comms'
          | 'browsing'
          | 'media'
          | 'social'
          | 'working'
          | 'idle'
          | 'break'
        label: string
        topApp?: string | null
      } {
        if (seg.kind === 'break') return { activity: 'break', label: 'Break' }
        if (seg.kind === 'idle') return { activity: 'idle', label: 'Idle' }
        // Work — try to infer activity from screen analyses in the window
        const inWindow = shotsInShift.filter(
          (s) =>
            s.analyzedAt >= seg.startAt && s.analyzedAt <= seg.endAt,
        )
        const hintCounts: Record<string, number> = {}
        const catCounts: Record<string, number> = {}
        for (const s of inWindow) {
          hintCounts[s.visibleContentHint] = (hintCounts[s.visibleContentHint] ?? 0) + 1
          catCounts[s.appCategory] = (catCounts[s.appCategory] ?? 0) + 1
        }
        const topHint = Object.entries(hintCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
        const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
        const appName = seg.app ?? null

        // Map the (hint, category) tuple to a natural phrase. We lean on the
        // hint first because it's intent — fall back to category, then to a
        // generic "Working in X".
        switch (topHint) {
          case 'code_editing':
            return { activity: 'coding', label: appName ? `Coding in ${appName}` : 'Coding', topApp: appName }
          case 'design_canvas':
            return { activity: 'designing', label: appName ? `Designing in ${appName}` : 'Designing', topApp: appName }
          case 'reading_docs':
            return { activity: 'reading', label: appName ? `Reading docs in ${appName}` : 'Reading docs', topApp: appName }
          case 'chat':
            return { activity: 'comms', label: appName ? `Chatting in ${appName}` : 'In chat / comms', topApp: appName }
          case 'video_streaming':
            return { activity: 'media', label: appName ? `Watching video in ${appName}` : 'Watching video', topApp: appName }
          case 'social_media':
            return { activity: 'social', label: 'On social media', topApp: appName }
          case 'static_idle':
            return { activity: 'idle', label: 'Idle (no input)', topApp: appName }
          default:
            // No hint signal — fall back to category
            switch (topCat) {
              case 'ide':
                return { activity: 'coding', label: appName ? `Coding in ${appName}` : 'Coding', topApp: appName }
              case 'design':
                return { activity: 'designing', label: appName ? `Designing in ${appName}` : 'Designing', topApp: appName }
              case 'comms':
                return { activity: 'comms', label: appName ? `In ${appName}` : 'In comms', topApp: appName }
              case 'browser_work':
                return { activity: 'reading', label: appName ? `Working in ${appName}` : 'Working in browser', topApp: appName }
              case 'browser_personal':
                return { activity: 'browsing', label: appName ? `Browsing in ${appName}` : 'Browsing', topApp: appName }
              case 'media':
                return { activity: 'media', label: 'Watching media', topApp: appName }
            }
            return { activity: 'working', label: appName ? `Working in ${appName}` : 'Working', topApp: appName }
        }
      }

      // Re-coalesce by ACTIVITY (not raw app) so two adjacent VS Code +
      // Cursor blocks become one "Coding" stretch in the timeline.
      type RichSeg = {
        startAt: Date
        endAt: Date
        kind: 'work' | 'break' | 'idle'
        activity: string
        label: string
        topApp?: string | null
        detail?: string
      }
      const rich: RichSeg[] = []
      for (const s of segs) {
        const desc = describeSegment(s)
        const last = rich[rich.length - 1]
        const sameContext =
          last &&
          last.kind === s.kind &&
          last.activity === desc.activity &&
          s.startAt.getTime() - last.endAt.getTime() < 60_000
        if (sameContext) {
          last.endAt = s.endAt
          last.detail = s.detail ?? last.detail
        } else {
          // For break segments, keep the human-given category label
          // ("Lunch", "Meeting", "Blocked") rather than the generic "Break".
          const useOriginalLabel = s.kind === 'break' && s.label !== 'Break'
          rich.push({
            startAt: s.startAt,
            endAt: s.endAt,
            kind: s.kind,
            activity: desc.activity,
            label: useOriginalLabel ? s.label : desc.label,
            topApp: desc.topApp ?? s.app ?? null,
            detail: s.detail,
          })
        }
      }

      shiftSegments = rich.map((s) => ({
        startAt: s.startAt.toISOString(),
        endAt: s.endAt.toISOString(),
        kind: s.kind,
        // The label is now intent-driven ("Coding in Cursor") not raw app
        label: s.label,
        app: s.topApp ?? null,
        detail: s.detail,
      }))
    }

    // Aggregate today's app usage from localActivity so the modal can show a
    // bar chart of "where time went". Cheap aggregation, no join needed.
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const appRows = await db
      .select({
        app: schema.localActivity.activeApp,
        seconds: sql<number>`SUM(${schema.localActivity.activeSeconds})`,
      })
      .from(schema.localActivity)
      .where(
        and(
          eq(schema.localActivity.userId, user.id),
          gte(schema.localActivity.windowStart, dayStart),
        ),
      )
      .groupBy(schema.localActivity.activeApp)

    const appUsage = appRows
      .map((r) => ({ app: r.app, seconds: Number(r.seconds) || 0 }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 6)

    // Aggregate today's screen-content mix from shotAnalyses. Tells managers
    // how the day broke down between work / non-work / ambiguous screens.
    const shotRows = await db
      .select({
        workAppLabel: schema.shotAnalyses.workAppLabel,
        appCategory: schema.shotAnalyses.appCategory,
        visibleContentHint: schema.shotAnalyses.visibleContentHint,
      })
      .from(schema.shotAnalyses)
      .where(
        and(
          eq(schema.shotAnalyses.userId, user.id),
          gte(schema.shotAnalyses.analyzedAt, dayStart),
        ),
      )
    const screenMix = (() => {
      const counts = { work: 0, non_work: 0, ambiguous: 0 }
      const hintCounts: Record<string, number> = {}
      const catCounts: Record<string, number> = {}
      for (const r of shotRows) {
        counts[r.workAppLabel as keyof typeof counts] =
          (counts[r.workAppLabel as keyof typeof counts] ?? 0) + 1
        hintCounts[r.visibleContentHint] = (hintCounts[r.visibleContentHint] ?? 0) + 1
        catCounts[r.appCategory] = (catCounts[r.appCategory] ?? 0) + 1
      }
      const total = shotRows.length
      const top = (m: Record<string, number>) =>
        Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, n]) => ({ k, n }))
      return { total, counts, topHints: top(hintCounts), topCategories: top(catCounts) }
    })()

    // ───── Derived: 7-day output strip ────────────────────────────────────
    // Daily output across the last 7 days so the modal can show a sparkline
    // and the Scrum Mode can show "yesterday vs 7-day avg" deltas without
    // doing another round-trip.
    const last7DaysOutput: Array<{
      date: string
      commits: number
      prs: number
      reviews: number
      issues: number
      focusMin: number
      onlineMin: number
    }> = []
    const eventsBy7Day = new Map<string, { commits: number; prs: number; reviews: number; issues: number }>()
    for (const e of ghEvents) {
      const d = e.occurredAt
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const b = eventsBy7Day.get(iso) ?? { commits: 0, prs: 0, reviews: 0, issues: 0 }
      if (e.type === 'commit') b.commits++
      else if (e.type === 'pr_opened') b.prs++
      else if (e.type === 'pr_reviewed') b.reviews++
      else if (e.type === 'issue_closed') b.issues++
      eventsBy7Day.set(iso, b)
    }
    // Fetch daily activity rollup for 7d
    const daily7dStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
    const daily7dActivity = await db
      .select({
        windowStart: schema.localActivity.windowStart,
        activeSeconds: schema.localActivity.activeSeconds,
        idleSeconds: schema.localActivity.idleSeconds,
      })
      .from(schema.localActivity)
      .where(
        and(
          eq(schema.localActivity.userId, user.id),
          gte(schema.localActivity.windowStart, daily7dStart),
        ),
      )
    const activityByDay = new Map<string, { focusSec: number; onlineSec: number }>()
    for (const a of daily7dActivity) {
      const d = a.windowStart
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const b = activityByDay.get(iso) ?? { focusSec: 0, onlineSec: 0 }
      b.focusSec += a.activeSeconds
      b.onlineSec += a.activeSeconds + a.idleSeconds
      activityByDay.set(iso, b)
    }
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const ev = eventsBy7Day.get(iso) ?? { commits: 0, prs: 0, reviews: 0, issues: 0 }
      const act = activityByDay.get(iso) ?? { focusSec: 0, onlineSec: 0 }
      last7DaysOutput.push({
        date: iso,
        commits: ev.commits,
        prs: ev.prs,
        reviews: ev.reviews,
        issues: ev.issues,
        focusMin: Math.round(act.focusSec / 60),
        onlineMin: Math.round(act.onlineSec / 60),
      })
    }

    // ───── Derived: top collaborator repos ───────────────────────────────
    // Cheap proxy for "who they work with" — counts events per repo, takes
    // the top 5. When we add review-author parsing, this becomes proper
    // co-worker data; for now repos are the most actionable signal.
    const repoCounts: Record<string, number> = {}
    for (const e of ghEvents) {
      repoCounts[e.repo] = (repoCounts[e.repo] ?? 0) + 1
    }
    const topRepos = Object.entries(repoCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([repo, n]) => ({ repo, events: n }))

    // ───── Derived: recent shifts mini-list ──────────────────────────────
    // The Shifts tab gets a strip of the last few shifts so the manager can
    // see a trend at a glance (when did they punch in? was the shift verified?).
    const last7Shifts = shifts28d
      .filter((s) => s.punchedInAt >= since7)
      .sort((a, b) => b.punchedInAt.getTime() - a.punchedInAt.getTime())
      .slice(0, 7)
      .map((s) => {
        const start = s.punchedInAt
        const end = s.punchedOutAt ?? new Date()
        const min = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000))
        return {
          id: s.id,
          punchedInAt: start.toISOString(),
          punchedOutAt: s.punchedOutAt?.toISOString() ?? null,
          totalMin: min,
        }
      })

    // ───── Derived: today's meetings + 7-day meeting count ─────────────────
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const tomorrowMidnight = new Date(todayMidnight.getTime() + DAY_MS)
    const [todayMeetings, weekMeetings] = await Promise.all([
      db
        .select({
          id: schema.meetings.id,
          title: schema.meetings.title,
          startAt: schema.meetings.startAt,
          endAt: schema.meetings.endAt,
          conferenceUrl: schema.meetings.conferenceUrl,
          rsvpStatus: schema.meetings.rsvpStatus,
          attendees: schema.meetings.attendees,
        })
        .from(schema.meetings)
        .where(
          and(
            eq(schema.meetings.userId, user.id),
            gte(schema.meetings.startAt, todayMidnight),
            sql`${schema.meetings.startAt} < ${tomorrowMidnight}`,
            hideSeedRows(schema.meetings.externalId),
          ),
        )
        .orderBy(schema.meetings.startAt),
      db
        .select({
          id: schema.meetings.id,
          title: schema.meetings.title,
          startAt: schema.meetings.startAt,
          endAt: schema.meetings.endAt,
        })
        .from(schema.meetings)
        .where(
          and(
            eq(schema.meetings.userId, user.id),
            gte(schema.meetings.startAt, since7),
            hideSeedRows(schema.meetings.externalId),
          ),
        )
        .orderBy(desc(schema.meetings.startAt)),
    ])
    const weekMeetingsCount = weekMeetings.length
    const weekMeetingsMin = weekMeetings.reduce(
      (acc, m) => acc + Math.max(0, Math.round((m.endAt.getTime() - m.startAt.getTime()) / 60_000)),
      0,
    )

    // ───── Derived: risk flags ───────────────────────────────────────────
    // Compact list of things the manager should care about. Each one is
    // grounded in raw data we already have on hand — no LLM, no surprises.
    const risks: Array<{ kind: 'shift' | 'output' | 'block' | 'github' | 'idle'; severity: 'low' | 'medium' | 'high'; label: string }> = []
    if (latestShift?.verificationStatus === 'suspect') {
      risks.push({
        kind: 'shift',
        severity: 'high',
        label: `Latest shift flagged suspect (score ${latestShift.verificationScore ?? '?'}/100)`,
      })
    }
    const last7Commits = last7DaysOutput.reduce((acc, d) => acc + d.commits, 0)
    if (user.accessToken && last7Commits === 0) {
      risks.push({ kind: 'output', severity: 'medium', label: 'No commits in the last 7 days' })
    }
    const activeBlocker = recentBreaks.find((b) => !b.endedAt && b.category === 'blocked')
    if (activeBlocker) {
      const mins = Math.round((Date.now() - activeBlocker.startedAt.getTime()) / 60_000)
      risks.push({
        kind: 'block',
        severity: mins > 120 ? 'high' : 'medium',
        label: `Blocked for ${mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`} — waiting on ${activeBlocker.waitingOnExternal ?? 'a teammate'}`,
      })
    }
    if (!user.accessToken) {
      risks.push({ kind: 'github', severity: 'low', label: 'GitHub not linked — work is invisible to MARINA' })
    }
    if (user.lastSyncError) {
      risks.push({ kind: 'github', severity: 'medium', label: `Last GitHub sync failed: ${user.lastSyncError.slice(0, 90)}` })
    }
    if (shiftTotals.idleMin > 240) {
      risks.push({ kind: 'idle', severity: 'medium', label: `${Math.floor(shiftTotals.idleMin / 60)}h of idle time during the latest shift` })
    }

    // Paired desktop devices for this employee — managers need to know who
    // is and isn't running the agent, and owners need a one-click revoke
    // so a lost laptop can't keep streaming activity.
    const devices = await db
      .select({
        id: schema.agentTokens.id,
        label: schema.agentTokens.label,
        platform: schema.agentTokens.platform,
        agentVersion: schema.agentTokens.agentVersion,
        pairedAt: schema.agentTokens.pairedAt,
        lastSeenAt: schema.agentTokens.lastSeenAt,
        revokedAt: schema.agentTokens.revokedAt,
      })
      .from(schema.agentTokens)
      .where(eq(schema.agentTokens.userId, user.id))
      .orderBy(desc(schema.agentTokens.pairedAt))

    // Manager-grade "what are they working on" — PRs by status, reviews given /
    // received, commit themes, a blocked signal — over the last 14 days.
    const work = await buildMemberWork(orgId, user.id, 14)

    // Today's self-reported standup (yesterday / today / blockers) — what the
    // person told the team they'd work on. Powers the Scrum-mode "Today" panel.
    const standupToday = await getTodayStandup(user.id)

    return NextResponse.json({
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        characterKey: user.characterKey,
        hasGithub: !!user.accessToken || user.githubId != null || !!user.githubLogin,
        lastSyncedAt: user.lastSyncedAt?.toISOString() ?? null,
        lastSyncError: user.lastSyncError,
      },
      role: membership.role,
      // Discipline drives the role-aware UI labels (engineering shows PRs,
      // design shows files, sales shows deals, etc.). Falls back to 'other'
      // for legacy memberships predating the column.
      discipline: (membership as { discipline?: string }).discipline ?? 'other',
      jobTitle: (membership as { jobTitle?: string | null }).jobTitle ?? null,
      workingDays:
        (membership as { workingDays?: boolean[] }).workingDays ??
        [false, true, true, true, true, true, false],
      birthdayMmDd: (user as { birthdayMmDd?: string | null }).birthdayMmDd ?? null,
      joinedOn: (user as { joinedOn?: string | null }).joinedOn ?? null,
      extraCaps: (membership as { extraCaps?: string[] }).extraCaps ?? [],
      narrative: latestNarrative
        ? {
            body: latestNarrative.body,
            signal: latestNarrative.signal,
            createdAt: latestNarrative.createdAt.toISOString(),
            provider: latestNarrative.provider,
            model: latestNarrative.model,
          }
        : null,
      story: todayStory
        ? {
            narrative: todayStory.narrative,
            scenes: todayStory.scenes,
            generatedAt: todayStory.generatedAt.toISOString(),
          }
        : null,
      githubEvents: ghEvents.map((e) => ({
        id: e.id,
        type: e.type,
        repo: e.repo,
        title: e.title,
        url: e.url,
        occurredAt: e.occurredAt.toISOString(),
      })),
      // New: aggregated visualisable evidence beyond the prose narrative.
      appUsage,
      screenMix,
      recentBreaks: recentBreaks.map((b) => ({
        id: b.id,
        category: b.category,
        reason: b.reason,
        startedAt: b.startedAt.toISOString(),
        endedAt: b.endedAt?.toISOString() ?? null,
        waitingOnUserId: b.waitingOnUserId,
        waitingOnExternal: b.waitingOnExternal,
        resolutionType: b.resolutionType ?? null,
        resolutionNote: b.resolutionNote ?? null,
      })),
      recentLeaves: recentLeaves.map((l) => ({
        id: l.id,
        startDate: l.startDate,
        endDate: l.endDate,
        leaveType: l.leaveType,
        reason: l.reason,
        status: l.status,
        decidedNote: l.decidedNote,
      })),
      latestShift: latestShift
        ? {
            id: latestShift.id,
            punchedInAt: latestShift.punchedInAt.toISOString(),
            punchedOutAt: latestShift.punchedOutAt?.toISOString() ?? null,
            workSummary: latestShift.workSummary,
            verificationStatus: latestShift.verificationStatus,
            verificationScore: latestShift.verificationScore,
          }
        : null,
      // Real per-day attendance for the last 28 days
      attendance28d,
      // Segmented timeline + totals for the latest shift
      shiftSegments,
      shiftTotals,
      // 28-day break feed for the Activity tab day picker
      breaks28d: breaks28d.map((b) => ({
        id: b.id,
        category: b.category,
        reason: b.reason,
        startedAt: b.startedAt.toISOString(),
        endedAt: b.endedAt?.toISOString() ?? null,
        waitingOnExternal: b.waitingOnExternal,
      })),
      // Today's standup (what they said they'd work on) for Scrum mode.
      standupToday,
      // Manager-grade depth: per-day output trend, who they collaborate with,
      // last week of shifts, today's calendar, and a curated risk list.
      last7DaysOutput,
      topRepos,
      // Structured "what they're working on" — PRs by status, reviews, themes.
      work,
      last7Shifts,
      weekMeetingsCount,
      weekMeetingsMin,
      // Last 7 days of meetings (most-recent first) — powers the Scrum "meetings"
      // filter (yesterday vs this week).
      weekMeetings: weekMeetings.map((m) => ({
        id: m.id,
        title: m.title,
        startAt: m.startAt.toISOString(),
        endAt: m.endAt.toISOString(),
      })),
      todayMeetings: todayMeetings.map((m) => ({
        id: m.id,
        title: m.title,
        startAt: m.startAt.toISOString(),
        endAt: m.endAt.toISOString(),
        conferenceUrl: m.conferenceUrl,
        rsvpStatus: m.rsvpStatus,
        attendeeCount: Array.isArray(m.attendees) ? m.attendees.length : 0,
      })),
      risks,
      // Self-reported deliverables (manual "I shipped X"), 14-day window
      recentDeliverables: recentDeliverables.map((d) => ({
        id: d.id,
        title: d.title,
        detail: d.detail,
        url: d.url,
        kind: d.kind,
        completedAt: d.completedAt.toISOString(),
        verificationStatus: d.verificationStatus,
      })),
      // Paired desktop devices — managers see who's running the agent; owners
      // also get a Revoke button to nuke access when a laptop is lost or an
      // employee is offboarding.
      devices: devices.map((d) => ({
        id: d.id,
        label: d.label,
        platform: d.platform,
        agentVersion: d.agentVersion,
        pairedAt: d.pairedAt.toISOString(),
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        revokedAt: d.revokedAt?.toISOString() ?? null,
      })),
    })
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('member detail failed', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
