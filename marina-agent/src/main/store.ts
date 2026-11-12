import { safeStorage } from 'electron'
import Store from 'electron-store'
import { STORE_KEYS } from './config'

export { STORE_KEYS }

export type PendingBatch = {
  windowStart: string
  windowEnd: string
  activeApp: string
  activeSeconds: number
  idleSeconds: number
  lockedSeconds?: number
  sampleCount: number
  windowTitle?: string | null
}

type Schema = {
  [STORE_KEYS.serverBaseUrl]?: string
  [STORE_KEYS.encryptedToken]?: string
  [STORE_KEYS.deviceId]?: number
  [STORE_KEYS.userLogin]?: string
  [STORE_KEYS.userName]?: string | null
  [STORE_KEYS.consentAt]?: string
  [STORE_KEYS.paused]?: boolean
  [STORE_KEYS.windowTitlesEnabled]?: boolean
  [STORE_KEYS.sampleIntervalSeconds]?: number
  [STORE_KEYS.flushIntervalSeconds]?: number
  [STORE_KEYS.pendingBatches]?: PendingBatch[]
  [STORE_KEYS.lastFlushAt]?: string
  [STORE_KEYS.policyVersionAccepted]?: string
  [STORE_KEYS.requiredPolicyVersion]?: string
}

const store = new Store<Schema>({
  name: 'marina-agent',
  watch: true,
})

export function get<K extends keyof Schema>(key: K): Schema[K] {
  return store.get(key) as Schema[K]
}

export function set<K extends keyof Schema>(key: K, value: Schema[K]): void {
  if (value === undefined) {
    store.delete(key)
  } else {
    store.set(key, value as Schema[K])
  }
}

export function clearSensitive(): void {
  store.delete(STORE_KEYS.encryptedToken)
  store.delete(STORE_KEYS.deviceId)
  store.delete(STORE_KEYS.userLogin)
  store.delete(STORE_KEYS.userName)
  store.delete(STORE_KEYS.pendingBatches)
}

/** Returns the decrypted bearer token, or null if not paired / decryption fails. */
export function readToken(): string | null {
  const enc = get(STORE_KEYS.encryptedToken)
  if (!enc) return null
  if (!safeStorage.isEncryptionAvailable()) {
    console.error('safeStorage encryption not available — refusing to read token')
    return null
  }
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch (err) {
    console.error('failed to decrypt token', err)
    return null
  }
}

/** Encrypts and persists the bearer token. */
export function writeToken(plaintext: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this system')
  }
  const enc = safeStorage.encryptString(plaintext).toString('base64')
  set(STORE_KEYS.encryptedToken, enc)
}
