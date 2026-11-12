"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRevoked = handleRevoked;
exports.resetRevokedFlag = resetRevokedFlag;
exports.pingOnce = pingOnce;
exports.startHeartbeat = startHeartbeat;
exports.stopHeartbeat = stopHeartbeat;
exports.reconcileTrackingNow = reconcileTrackingNow;
const api_1 = require("./api");
const store_1 = require("./store");
const state_1 = require("./state");
const sampler_1 = require("./sampler");
const shotter_1 = require("./shotter");
const config_1 = require("./config");
const consent_1 = require("./consent");
const onboarding_1 = require("./onboarding");
const server_feed_1 = require("./server-feed");
let revokedHandled = false;
/**
 * The server rejected our token (device revoked from /settings, or the user
 * was removed). Stop everything, drop the dead token + queued batches (they
 * can never upload), and open setup so the person can re-pair — instead of
 * silently going dark until someone happens to click the tray.
 */
function handleRevoked() {
    if (revokedHandled)
        return;
    revokedHandled = true;
    (0, sampler_1.stopSampler)();
    (0, shotter_1.stopShotter)();
    (0, server_feed_1.stopServerFeed)();
    (0, store_1.clearSensitive)();
    state_1.bus.patch({ paired: false, activeShift: null, activeBreak: null, today: null, pendingCount: 0, lastError: 'device unpaired — set up again' });
    (0, onboarding_1.openOnboardingWindow)();
}
/** Called after a successful (re)pair so a later revocation is handled again. */
function resetRevokedFlag() {
    revokedHandled = false;
}
let timer = null;
/**
 * Tracking is gated by BOTH punch state and pause:
 *   tracking = activeShift !== null && !paused
 * This function reconciles after each heartbeat.
 */
function reconcileTracking() {
    const s = state_1.bus.get();
    // No current consent (e.g. the server bumped the policy version) → no tracking.
    const shouldTrack = !!s.activeShift && !s.paused && (0, consent_1.hasConsented)();
    if (shouldTrack) {
        (0, sampler_1.startSampler)();
        // GATEKEPT: screenshot capture is off for now. The shotter is never started
        // while SCREENSHOTS_ENABLED is false; flip the flag to bring it back.
        if (config_1.SCREENSHOTS_ENABLED)
            (0, shotter_1.startShotter)();
    }
    else {
        (0, sampler_1.stopSampler)({ flush: true });
        (0, shotter_1.stopShotter)();
    }
}
async function pingOnce() {
    try {
        const res = await (0, api_1.postHeartbeat)();
        state_1.bus.patch({
            paused: !!res.pausedAt,
            windowTitlesEnabled: res.windowTitlesEnabled,
            sampleIntervalSeconds: res.sampleIntervalSeconds,
            flushIntervalSeconds: res.flushIntervalSeconds,
            primaryOrgId: res.primaryOrgId,
            activeBreak: res.activeBreak,
            activeShift: res.activeShift,
            lastHeartbeatAt: new Date(),
            lastError: null,
        });
        (0, store_1.set)(store_1.STORE_KEYS.paused, !!res.pausedAt);
        (0, store_1.set)(store_1.STORE_KEYS.windowTitlesEnabled, res.windowTitlesEnabled);
        (0, store_1.set)(store_1.STORE_KEYS.sampleIntervalSeconds, res.sampleIntervalSeconds);
        (0, store_1.set)(store_1.STORE_KEYS.flushIntervalSeconds, res.flushIntervalSeconds);
        // Policy roll: MARINA_POLICY_VERSION changed on the server → stop tracking
        // and ask for consent again before anything else is collected.
        if (res.policyVersion && res.policyVersion !== (0, store_1.get)(store_1.STORE_KEYS.requiredPolicyVersion)) {
            (0, store_1.set)(store_1.STORE_KEYS.requiredPolicyVersion, res.policyVersion);
        }
        if (!(0, consent_1.hasConsented)()) {
            reconcileTracking();
            (0, onboarding_1.openOnboardingWindow)();
            return;
        }
        reconcileTracking();
    }
    catch (err) {
        const e = err;
        if (e.status === 401) {
            handleRevoked();
            return;
        }
        state_1.bus.patch({ lastError: `heartbeat: ${e.message}` });
    }
}
function startHeartbeat() {
    if (timer)
        return;
    void pingOnce();
    timer = setInterval(() => {
        void pingOnce();
    }, 60_000);
}
function stopHeartbeat() {
    if (timer)
        clearInterval(timer);
    timer = null;
}
/** Called by punch + pause + break flows to instantly reconcile tracking. */
function reconcileTrackingNow() {
    reconcileTracking();
}
//# sourceMappingURL=heartbeat.js.map