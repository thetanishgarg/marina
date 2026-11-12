import { Notification, shell } from 'electron'
import { ackNotifications, fetchDay, fetchMeetingsToday, fetchNotifications, ApiError } from './api'
import { bus } from './state'

/**
 * Everything the SERVER wants the desktop to know, pulled on one cadence:
 *
 *   1. Notifications — the same rows that light up the web bell (leave
 *      decided, blocker pinged, "help requested", meeting scheduled…). Each is
 *      shown once as a native OS notification and then acked so it never
 *      fires twice, even across restarts. Before this module existed the
 *      endpoint was built but nothing on the desktop ever called it.
 *   2. Today snapshot — productivity %, shipped today, next meeting — for
 *      the tray menu, so the agent shows the same numbers as the web card.
 *   3. Meeting reminders — a native "starts in 5 minutes" ping with a Join
 *      link, from today's calendar.
 */

const POLL_MS = 60_000
const REMIND_BEFORE_MS = 5 * 60_000

let timer: NodeJS.Timeout | null = null
let running = false
// Meeting ids we've already reminded about today (reset when the day changes).
const reminded = new Set<number>()
let remindedDay = ''

function show(title: string, body: string, onClick?: () => void): void {
  try {
    const n = new Notification({ title, body, silent: false })
    if (onClick) n.on('click', onClick)
    n.show()
  } catch (err) {
    console.warn('[server-feed] notification failed', err)
  }
}

function openWeb(href: string | null): void {
  const base = bus.get().serverBaseUrl.replace(/\/+$/, '')
  // Only follow app-relative paths from the server; anything else opens the dashboard.
  const path = href && href.startsWith('/') && !href.startsWith('//') ? href : '/dashboard'
  void shell.openExternal(`${base}${path}`)
}

async function pullNotifications(): Promise<void> {
  const { notifications } = await fetchNotifications()
  if (!notifications?.length) return
  const shown: number[] = []
  for (const n of notifications.slice(0, 5)) {
    show(n.title || 'Marina', n.body ?? '', () => openWeb(n.href))
    shown.push(n.id)
  }
  // Anything past the first 5 is acked as a single summary, not a flood.
  if (notifications.length > 5) {
    show('Marina', `${notifications.length - 5} more updates — open Marina to see them.`, () => openWeb('/dashboard'))
    for (const n of notifications.slice(5)) shown.push(n.id)
  }
  await ackNotifications(shown)
}

async function pullDay(): Promise<void> {
  const d = await fetchDay()
  bus.patch({
    today: {
      punchedIn: d.punchedIn,
      productivity: d.productivity,
      focusMinutes: d.focusMinutes,
      deliverablesToday: d.deliverablesToday,
      meetingsRemainingToday: d.meetingsRemainingToday,
      nextMeetingAt: d.nextMeetingAt,
      nextMeetingTitle: d.nextMeetingTitle,
    },
  })
}

async function pullMeetings(): Promise<void> {
  const day = new Date().toDateString()
  if (day !== remindedDay) {
    reminded.clear()
    remindedDay = day
  }
  const { meetings } = await fetchMeetingsToday()
  const now = Date.now()
  for (const m of meetings ?? []) {
    const startsIn = new Date(m.startAt).getTime() - now
    if (startsIn > 0 && startsIn <= REMIND_BEFORE_MS && !reminded.has(m.id)) {
      reminded.add(m.id)
      const mins = Math.max(1, Math.round(startsIn / 60_000))
      show(`${m.title} in ${mins} min`, m.conferenceUrl ? 'Click to join.' : 'Coming up next.', () => {
        if (m.conferenceUrl && /^https:\/\//i.test(m.conferenceUrl)) void shell.openExternal(m.conferenceUrl)
        else openWeb('/dashboard/meetings')
      })
    }
  }
}

async function tick(): Promise<void> {
  if (running || !bus.get().paired) return
  running = true
  try {
    const results = await Promise.allSettled([pullNotifications(), pullDay(), pullMeetings()])
    for (const r of results) {
      if (r.status === 'rejected') {
        const e = r.reason as ApiError
        // 401 is handled centrally by the heartbeat (revocation flow).
        if (e?.status !== 401) console.warn('[server-feed]', e?.message ?? r.reason)
      }
    }
  } finally {
    running = false
  }
}

export function startServerFeed(): void {
  if (timer) return
  void tick()
  timer = setInterval(() => void tick(), POLL_MS)
}

export function stopServerFeed(): void {
  if (timer) clearInterval(timer)
  timer = null
}
