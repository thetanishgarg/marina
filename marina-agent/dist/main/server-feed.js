"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServerFeed = startServerFeed;
exports.stopServerFeed = stopServerFeed;
const electron_1 = require("electron");
const api_1 = require("./api");
const state_1 = require("./state");
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
const POLL_MS = 60_000;
const REMIND_BEFORE_MS = 5 * 60_000;
let timer = null;
let running = false;
// Meeting ids we've already reminded about today (reset when the day changes).
const reminded = new Set();
let remindedDay = '';
function show(title, body, onClick) {
    try {
        const n = new electron_1.Notification({ title, body, silent: false });
        if (onClick)
            n.on('click', onClick);
        n.show();
    }
    catch (err) {
        console.warn('[server-feed] notification failed', err);
    }
}
function openWeb(href) {
    const base = state_1.bus.get().serverBaseUrl.replace(/\/+$/, '');
    // Only follow app-relative paths from the server; anything else opens the dashboard.
    const path = href && href.startsWith('/') && !href.startsWith('//') ? href : '/dashboard';
    void electron_1.shell.openExternal(`${base}${path}`);
}
async function pullNotifications() {
    const { notifications } = await (0, api_1.fetchNotifications)();
    if (!notifications?.length)
        return;
    const shown = [];
    for (const n of notifications.slice(0, 5)) {
        show(n.title || 'Marina', n.body ?? '', () => openWeb(n.href));
        shown.push(n.id);
    }
    // Anything past the first 5 is acked as a single summary, not a flood.
    if (notifications.length > 5) {
        show('Marina', `${notifications.length - 5} more updates — open Marina to see them.`, () => openWeb('/dashboard'));
        for (const n of notifications.slice(5))
            shown.push(n.id);
    }
    await (0, api_1.ackNotifications)(shown);
}
async function pullDay() {
    const d = await (0, api_1.fetchDay)();
    state_1.bus.patch({
        today: {
            punchedIn: d.punchedIn,
            productivity: d.productivity,
            focusMinutes: d.focusMinutes,
            deliverablesToday: d.deliverablesToday,
            meetingsRemainingToday: d.meetingsRemainingToday,
            nextMeetingAt: d.nextMeetingAt,
            nextMeetingTitle: d.nextMeetingTitle,
        },
    });
}
async function pullMeetings() {
    const day = new Date().toDateString();
    if (day !== remindedDay) {
        reminded.clear();
        remindedDay = day;
    }
    const { meetings } = await (0, api_1.fetchMeetingsToday)();
    const now = Date.now();
    for (const m of meetings ?? []) {
        const startsIn = new Date(m.startAt).getTime() - now;
        if (startsIn > 0 && startsIn <= REMIND_BEFORE_MS && !reminded.has(m.id)) {
            reminded.add(m.id);
            const mins = Math.max(1, Math.round(startsIn / 60_000));
            show(`${m.title} in ${mins} min`, m.conferenceUrl ? 'Click to join.' : 'Coming up next.', () => {
                if (m.conferenceUrl && /^https:\/\//i.test(m.conferenceUrl))
                    void electron_1.shell.openExternal(m.conferenceUrl);
                else
                    openWeb('/dashboard/meetings');
            });
        }
    }
}
async function tick() {
    if (running || !state_1.bus.get().paired)
        return;
    running = true;
    try {
        const results = await Promise.allSettled([pullNotifications(), pullDay(), pullMeetings()]);
        for (const r of results) {
            if (r.status === 'rejected') {
                const e = r.reason;
                // 401 is handled centrally by the heartbeat (revocation flow).
                if (e?.status !== 401)
                    console.warn('[server-feed]', e?.message ?? r.reason);
            }
        }
    }
    finally {
        running = false;
    }
}
function startServerFeed() {
    if (timer)
        return;
    void tick();
    timer = setInterval(() => void tick(), POLL_MS);
}
function stopServerFeed() {
    if (timer)
        clearInterval(timer);
    timer = null;
}
//# sourceMappingURL=server-feed.js.map