"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiError = void 0;
exports.rawPost = rawPost;
exports.authedPost = authedPost;
exports.postEvents = postEvents;
exports.postHeartbeat = postHeartbeat;
exports.postPause = postPause;
exports.punchIn = punchIn;
exports.punchOut = punchOut;
exports.postBreak = postBreak;
exports.postDeliverable = postDeliverable;
exports.fetchNotifications = fetchNotifications;
exports.ackNotifications = ackNotifications;
exports.fetchDay = fetchDay;
exports.fetchMeetingsToday = fetchMeetingsToday;
exports.fetchTeamRoster = fetchTeamRoster;
exports.endActiveBreak = endActiveBreak;
exports.postLeave = postLeave;
exports.completePairing = completePairing;
const config_1 = require("./config");
const store_1 = require("./store");
const state_1 = require("./state");
class ApiError extends Error {
    status;
    body;
    constructor(status, message, body) {
        super(message);
        this.status = status;
        this.body = body;
    }
}
exports.ApiError = ApiError;
function headers(token) {
    const h = {
        'content-type': 'application/json',
        'user-agent': `marina-agent/${config_1.AGENT_VERSION}`,
    };
    if (token)
        h.authorization = `Bearer ${token}`;
    return h;
}
async function rawPost(baseUrl, path, body, token) {
    const url = `${baseUrl.replace(/\/+$/, '')}${path}`;
    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify(body ?? {}),
        });
    }
    catch (err) {
        throw new ApiError(0, `network: ${err.message}`);
    }
    const text = await res.text();
    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    }
    catch {
        parsed = text;
    }
    if (!res.ok) {
        throw new ApiError(res.status, `${res.status} ${path}`, parsed);
    }
    return parsed;
}
async function authedPost(path, body) {
    const state = state_1.bus.get();
    const token = (0, store_1.readToken)();
    if (!token)
        throw new ApiError(401, 'no token');
    return rawPost(state.serverBaseUrl, path, body, token);
}
async function postEvents(batches) {
    return authedPost('/api/agent/events', {
        batches,
        agentVersion: config_1.AGENT_VERSION,
    });
}
async function postHeartbeat() {
    return authedPost('/api/agent/heartbeat', {
        agentVersion: config_1.AGENT_VERSION,
    });
}
async function postPause(paused) {
    return authedPost('/api/agent/pause', { paused });
}
async function punchIn() {
    return authedPost('/api/agent/shifts/in', {});
}
async function punchOut(summary) {
    return authedPost('/api/agent/shifts/out', { summary });
}
async function postBreak(input) {
    return authedPost('/api/agent/breaks', input);
}
/** Log a "Mark work as done" entry. Mirrors POST /api/me/deliverables. */
async function postDeliverable(input) {
    return authedPost('/api/agent/deliverables', input);
}
async function authedGet(path) {
    const state = state_1.bus.get();
    const token = (0, store_1.readToken)();
    if (!token)
        throw new ApiError(401, 'no token');
    const url = `${state.serverBaseUrl.replace(/\/+$/, '')}${path}`;
    let res;
    try {
        res = await fetch(url, { method: 'GET', headers: headers(token) });
    }
    catch (err) {
        throw new ApiError(0, `network: ${err.message}`);
    }
    const text = await res.text();
    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    }
    catch {
        parsed = text;
    }
    if (!res.ok)
        throw new ApiError(res.status, `${res.status} GET ${path}`, parsed);
    return parsed;
}
/** Unread in-app notifications (leave decided, blocker pinged, help requested…). */
async function fetchNotifications() {
    return authedGet('/api/agent/notifications');
}
async function ackNotifications(shownIds) {
    if (shownIds.length === 0)
        return;
    await authedPost('/api/agent/notifications', { shownIds });
}
async function fetchDay() {
    return authedGet('/api/agent/day');
}
async function fetchMeetingsToday() {
    return authedGet('/api/agent/meetings/today');
}
async function fetchTeamRoster() {
    const state = state_1.bus.get();
    const token = (0, store_1.readToken)();
    if (!token)
        throw new ApiError(401, 'no token');
    const url = `${state.serverBaseUrl.replace(/\/+$/, '')}/api/agent/team`;
    let res;
    try {
        res = await fetch(url, { method: 'GET', headers: headers(token) });
    }
    catch (err) {
        throw new ApiError(0, `network: ${err.message}`);
    }
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!res.ok)
        throw new ApiError(res.status, `${res.status} GET /team`, parsed);
    return parsed;
}
async function endActiveBreak() {
    const state = state_1.bus.get();
    const token = (0, store_1.readToken)();
    if (!token)
        throw new ApiError(401, 'no token');
    const url = `${state.serverBaseUrl.replace(/\/+$/, '')}/api/agent/breaks/active`;
    let res;
    try {
        res = await fetch(url, { method: 'PATCH', headers: headers(token) });
    }
    catch (err) {
        throw new ApiError(0, `network: ${err.message}`);
    }
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!res.ok)
        throw new ApiError(res.status, `${res.status} PATCH /breaks/active`, parsed);
    return parsed;
}
async function postLeave(input) {
    return authedPost('/api/agent/leaves', input);
}
async function completePairing(input) {
    return rawPost(input.serverBaseUrl, '/api/agent/pair/complete', {
        code: input.code,
        label: input.label,
        platform: process.platform === 'win32' ? 'windows' : 'darwin',
        agentVersion: config_1.AGENT_VERSION,
    });
}
//# sourceMappingURL=api.js.map