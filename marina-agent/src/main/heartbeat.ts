import { postHeartbeat, ApiError } from './api'
import { STORE_KEYS, clearSensitive, get, set } from './store'
import { bus } from './state'
import { startSampler, stopSampler } from './sampler'
import { startShotter, stopShotter } from './shotter'
import { SCREENSHOTS_ENABLED } from './config'
import { hasConsented } from './consent'
import { openOnboardingWindow } from './onboarding'
import { stopServerFeed } from './server-feed'

let revokedHandled = false

/**
 * The server rejected our token (device revoked from /settings, or the user
 * was removed). Stop everything, drop the dead token + queued batches (they
 * can never upload), and open setup so the person can re-pair — instead of
 * silently going dark until someone happens to click the tray.
 */
export function handleRevoked(): void {
  if (revokedHandled) return
  revokedHandled = true
  stopSampler()
  stopShotter()
  stopServerFeed()
  clearSensitive()
  bus.patch({ paired: false, activeShift: null, activeBreak: null, today: null, pendingCount: 0, lastError: 'device unpaired — set up again' })
  openOnboardingWindow()
}

/** Called after a successful (re)pair so a later revocation is handled again. */
export function resetRevokedFlag(): void {
  revokedHandled = false
}

let timer: NodeJS.Timeout | null = null

/**
 * Tracking is gated by BOTH punch state and pause:
 *   tracking = activeShift !== null && !paused
 * This function reconciles after each heartbeat.
 */
function reconcileTracking(): void {
  const s = bus.get()
  // No current consent (e.g. the server bumped the policy version) → no tracking.
  const shouldTrack = !!s.activeShift && !s.paused && hasConsented()
  if (shouldTrack) {
    startSampler()
    // GATEKEPT: screenshot capture is off for now. The shotter is never started
    // while SCREENSHOTS_ENABLED is false; flip the flag to bring it back.
    if (SCREENSHOTS_ENABLED) startShotter()
  } else {
    stopSampler({ flush: true })
    stopShotter()
  }
}

export async function pingOnce(): Promise<void> {
  try {
    const res = await postHeartbeat()
    bus.patch({
      paused: !!res.pausedAt,
      windowTitlesEnabled: res.windowTitlesEnabled,
      sampleIntervalSeconds: res.sampleIntervalSeconds,
      flushIntervalSeconds: res.flushIntervalSeconds,
      primaryOrgId: res.primaryOrgId,
      activeBreak: res.activeBreak,
      activeShift: res.activeShift,
      lastHeartbeatAt: new Date(),
      lastError: null,
    })
    set(STORE_KEYS.paused, !!res.pausedAt)
    set(STORE_KEYS.windowTitlesEnabled, res.windowTitlesEnabled)
    set(STORE_KEYS.sampleIntervalSeconds, res.sampleIntervalSeconds)
    set(STORE_KEYS.flushIntervalSeconds, res.flushIntervalSeconds)

    // Policy roll: MARINA_POLICY_VERSION changed on the server → stop tracking
    // and ask for consent again before anything else is collected.
    if (res.policyVersion && res.policyVersion !== get(STORE_KEYS.requiredPolicyVersion)) {
      set(STORE_KEYS.requiredPolicyVersion, res.policyVersion)
    }
    if (!hasConsented()) {
      reconcileTracking()
      openOnboardingWindow()
      return
    }

    reconcileTracking()
  } catch (err) {
    const e = err as ApiError
    if (e.status === 401) {
      handleRevoked()
      return
    }
    bus.patch({ lastError: `heartbeat: ${e.message}` })
  }
}

export function startHeartbeat(): void {
  if (timer) return
  void pingOnce()
  timer = setInterval(() => {
    void pingOnce()
  }, 60_000)
}

export function stopHeartbeat(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** Called by punch + pause + break flows to instantly reconcile tracking. */
export function reconcileTrackingNow(): void {
  reconcileTracking()
}
