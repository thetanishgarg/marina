import { handleRevoked } from './heartbeat'
import { postEvents, ApiError } from './api'
import { STORE_KEYS, get, set, type PendingBatch } from './store'
import { bus } from './state'

const MAX_QUEUE_LENGTH = 5000 // ~17 days at 1 batch/5min
const UPLOAD_BATCH_SIZE = 200
const RETRY_BASE_MS = 5000
const RETRY_MAX_MS = 60_000

let uploading = false
let retryAt = 0
let retryDelay = RETRY_BASE_MS

function readQueue(): PendingBatch[] {
  return [...(get(STORE_KEYS.pendingBatches) ?? [])]
}

function writeQueue(q: PendingBatch[]): void {
  set(STORE_KEYS.pendingBatches, q)
  bus.patch({ pendingCount: q.length })
}

export function enqueueBatches(batches: PendingBatch[]): void {
  if (batches.length === 0) return
  const q = readQueue()
  q.push(...batches)
  // Trim from the front if we've exceeded the cap (very long offline period).
  const overflow = q.length - MAX_QUEUE_LENGTH
  if (overflow > 0) {
    q.splice(0, overflow)
    console.warn('[uploader] dropping', overflow, 'oldest batches (queue cap)')
  }
  writeQueue(q)
  // Try a flush immediately; even if it fails, the queue is durable.
  void flush()
}

export async function flush(): Promise<void> {
  if (uploading) return
  if (Date.now() < retryAt) return
  const state = bus.get()
  if (!state.paired || state.paused) return

  const q = readQueue()
  if (q.length === 0) return

  uploading = true
  try {
    while (true) {
      const current = readQueue()
      if (current.length === 0) break
      const slice = current.slice(0, UPLOAD_BATCH_SIZE)
      try {
        const res = await postEvents(slice)
        // Successful — drop those entries off the front.
        const next = current.slice(slice.length)
        writeQueue(next)
        set(STORE_KEYS.lastFlushAt, new Date().toISOString())
        bus.patch({ lastFlushAt: new Date(), lastError: null })
        // Server might tell us the user paused mid-flight — honour it.
        if (res.pausedAt) {
          bus.patch({ paused: true })
          set(STORE_KEYS.paused, true)
          break
        }
        retryDelay = RETRY_BASE_MS
        if (next.length === 0) break
      } catch (err) {
        const e = err as ApiError
        if (e.status === 401) {
          // Token revoked — stop, clear and send the user to re-pair.
          handleRevoked()
          break
        }
        // Network / 5xx — back off with jitter.
        retryDelay = Math.min(RETRY_MAX_MS, retryDelay * 2 + Math.floor(Math.random() * 1000))
        retryAt = Date.now() + retryDelay
        bus.patch({ lastError: `upload: ${e.message}` })
        console.warn('[uploader] retrying in', retryDelay, 'ms', e.message)
        break
      }
    }
  } finally {
    uploading = false
  }
}

let timer: NodeJS.Timeout | null = null
export function startUploader(): void {
  if (timer) return
  timer = setInterval(() => {
    void flush()
  }, 30_000) // poll every 30s — flush() short-circuits if nothing to do
  void flush()
}

export function stopUploader(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** Drain remaining queue before quit (best-effort). */
export async function drainOnQuit(): Promise<void> {
  try {
    await flush()
  } catch (err) {
    console.error('[uploader] drain failed', err)
  }
}
