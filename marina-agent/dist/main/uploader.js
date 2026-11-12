"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueBatches = enqueueBatches;
exports.flush = flush;
exports.startUploader = startUploader;
exports.stopUploader = stopUploader;
exports.drainOnQuit = drainOnQuit;
const heartbeat_1 = require("./heartbeat");
const api_1 = require("./api");
const store_1 = require("./store");
const state_1 = require("./state");
const MAX_QUEUE_LENGTH = 5000; // ~17 days at 1 batch/5min
const UPLOAD_BATCH_SIZE = 200;
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60_000;
let uploading = false;
let retryAt = 0;
let retryDelay = RETRY_BASE_MS;
function readQueue() {
    return [...((0, store_1.get)(store_1.STORE_KEYS.pendingBatches) ?? [])];
}
function writeQueue(q) {
    (0, store_1.set)(store_1.STORE_KEYS.pendingBatches, q);
    state_1.bus.patch({ pendingCount: q.length });
}
function enqueueBatches(batches) {
    if (batches.length === 0)
        return;
    const q = readQueue();
    q.push(...batches);
    // Trim from the front if we've exceeded the cap (very long offline period).
    const overflow = q.length - MAX_QUEUE_LENGTH;
    if (overflow > 0) {
        q.splice(0, overflow);
        console.warn('[uploader] dropping', overflow, 'oldest batches (queue cap)');
    }
    writeQueue(q);
    // Try a flush immediately; even if it fails, the queue is durable.
    void flush();
}
async function flush() {
    if (uploading)
        return;
    if (Date.now() < retryAt)
        return;
    const state = state_1.bus.get();
    if (!state.paired || state.paused)
        return;
    const q = readQueue();
    if (q.length === 0)
        return;
    uploading = true;
    try {
        while (true) {
            const current = readQueue();
            if (current.length === 0)
                break;
            const slice = current.slice(0, UPLOAD_BATCH_SIZE);
            try {
                const res = await (0, api_1.postEvents)(slice);
                // Successful — drop those entries off the front.
                const next = current.slice(slice.length);
                writeQueue(next);
                (0, store_1.set)(store_1.STORE_KEYS.lastFlushAt, new Date().toISOString());
                state_1.bus.patch({ lastFlushAt: new Date(), lastError: null });
                // Server might tell us the user paused mid-flight — honour it.
                if (res.pausedAt) {
                    state_1.bus.patch({ paused: true });
                    (0, store_1.set)(store_1.STORE_KEYS.paused, true);
                    break;
                }
                retryDelay = RETRY_BASE_MS;
                if (next.length === 0)
                    break;
            }
            catch (err) {
                const e = err;
                if (e.status === 401) {
                    // Token revoked — stop, clear and send the user to re-pair.
                    (0, heartbeat_1.handleRevoked)();
                    break;
                }
                // Network / 5xx — back off with jitter.
                retryDelay = Math.min(RETRY_MAX_MS, retryDelay * 2 + Math.floor(Math.random() * 1000));
                retryAt = Date.now() + retryDelay;
                state_1.bus.patch({ lastError: `upload: ${e.message}` });
                console.warn('[uploader] retrying in', retryDelay, 'ms', e.message);
                break;
            }
        }
    }
    finally {
        uploading = false;
    }
}
let timer = null;
function startUploader() {
    if (timer)
        return;
    timer = setInterval(() => {
        void flush();
    }, 30_000); // poll every 30s — flush() short-circuits if nothing to do
    void flush();
}
function stopUploader() {
    if (timer)
        clearInterval(timer);
    timer = null;
}
/** Drain remaining queue before quit (best-effort). */
async function drainOnQuit() {
    try {
        await flush();
    }
    catch (err) {
        console.error('[uploader] drain failed', err);
    }
}
//# sourceMappingURL=uploader.js.map