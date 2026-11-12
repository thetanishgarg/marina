import { app } from 'electron'
import { hostname } from 'os'

export const AGENT_VERSION: string = app.getVersion() || '0.1.0'

// Production domain shipped in packaged builds. Override at build/release time
// (or per-user via the pairing dialog, which is editable). Kept as a single
// constant so there's one place to change when the real domain is wired up.
const PROD_SERVER_BASE_URL = 'https://marina.team'

// Default server the pairing dialog pre-fills.
//   1. MARINA_SERVER_URL env — explicit override, always wins (any environment).
//   2. Unpackaged (`pnpm dev` / `pnpm start` / bare `electron .`) — localhost:3000,
//      because that's where the web app runs while developing/testing. Defaulting
//      to the prod domain here was THE pairing bug: a code generated on
//      localhost was POSTed to the prod server, which never has it → every pair
//      attempt failed with "invalid or expired code" (or a network error if the
//      domain didn't resolve).
//   3. Packaged build (real employees) — the production domain.
export const DEFAULT_SERVER_BASE_URL: string = (() => {
  const override = process.env.MARINA_SERVER_URL?.replace(/\/+$/, '')
  if (override) return override
  if (!app.isPackaged) return 'http://localhost:3000'
  return PROD_SERVER_BASE_URL
})()
export const POLICY_VERSION = 'v1'

// GATEKEPT: the screenshot-capture feature is disabled for the first release
// (privacy + AI-cost risk). The shotter is never started while this is false.
// Nothing is deleted — the full capture code is preserved and just not wired.
// Flip with MARINA_SCREENSHOTS_ENABLED=true (matches the web app's flag).
export const SCREENSHOTS_ENABLED: boolean = process.env.MARINA_SCREENSHOTS_ENABLED === 'true'
export const DEFAULT_DEVICE_LABEL = (() => {
  try {
    return hostname() || 'Mac'
  } catch {
    return 'Mac'
  }
})()

export const STORE_KEYS = {
  serverBaseUrl: 'serverBaseUrl',
  encryptedToken: 'encryptedToken',
  deviceId: 'deviceId',
  userLogin: 'userLogin',
  userName: 'userName',
  consentAt: 'consentAt',
  paused: 'paused',
  windowTitlesEnabled: 'windowTitlesEnabled',
  sampleIntervalSeconds: 'sampleIntervalSeconds',
  flushIntervalSeconds: 'flushIntervalSeconds',
  pendingBatches: 'pendingBatches',
  lastFlushAt: 'lastFlushAt',
  policyVersionAccepted: 'policyVersionAccepted',
  requiredPolicyVersion: 'requiredPolicyVersion',
} as const
