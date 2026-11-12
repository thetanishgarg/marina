import Groq from 'groq-sdk'
import { AIProvider, AIProviderError, ChatMessage, GenerateOpts } from './provider'

/**
 * Groq's free/on-demand tier enforces a per-minute token limit (TPM). A burst
 * of simultaneous calls — e.g. 20 teammates punching out at 6pm, each firing a
 * shift-verification — blows past it and returns 429 `rate_limit_exceeded`.
 * Two guards keep us under it without dropping work:
 *
 *   1. A process-wide concurrency gate, so a burst can't all hit Groq at once.
 *   2. Retry-on-429 that honours Groq's own "try again in N s" hint (and the
 *      Retry-After header), with jitter so a wave of retries doesn't re-collide
 *      on the next minute boundary.
 *
 * After retries are exhausted it still throws, so generateWithFallback() can
 * fall through to OpenAI (when configured).
 */
const MAX_CONCURRENCY = Math.max(1, Number(process.env.GROQ_MAX_CONCURRENCY ?? 5))
const MAX_RETRIES = Math.max(0, Number(process.env.GROQ_MAX_RETRIES ?? 3))

// Classic counting semaphore. When a holder releases, it hands its slot
// straight to the next waiter (active count unchanged) — no thundering herd.
let active = 0
const waiters: Array<() => void> = []
function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => waiters.push(resolve))
}
function release(): void {
  const next = waiters.shift()
  if (next) next()
  else active--
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; response?: { status?: number }; code?: string }
  const status = e?.status ?? e?.response?.status
  return status === 429 || status === 500 || status === 502 || status === 503 || e?.code === 'ECONNRESET'
}

/** ms to wait before the next attempt — prefer the server's hint, else backoff. */
function retryDelayMs(err: unknown, attempt: number): number {
  const e = err as { headers?: Record<string, string>; error?: { message?: string }; message?: string }
  let suggested = 0
  const ra = e?.headers?.['retry-after']
  if (ra) suggested = Math.ceil(parseFloat(ra) * 1000)
  const msg = String(e?.error?.message ?? e?.message ?? '')
  const m = msg.match(/try again in ([\d.]+)\s*s/i)
  if (m) suggested = Math.max(suggested, Math.ceil(parseFloat(m[1]) * 1000))
  const backoff = Math.min(10_000, 600 * 2 ** attempt)
  return Math.max(suggested, backoff) + Math.floor(Math.random() * 500)
}

export class GroqProvider implements AIProvider {
  name = 'groq' as const
  model: string
  private client: Groq
  private get isReasoning(): boolean {
    return this.model.includes('gpt-oss')
  }

  constructor(opts: { model?: string } = {}) {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) throw new AIProviderError('groq', 'GROQ_API_KEY is not set')
    // llama-3.3-70b-versatile was retired by Groq (404 model_not_found), which
    // silently took down every AI feature. gpt-oss-120b is Groq's current
    // flagship open model; override with GROQ_MODEL.
    this.model = opts.model ?? process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b'
    this.client = new Groq({ apiKey })
  }

  async generate(messages: ChatMessage[], opts: GenerateOpts = {}): Promise<string> {
    await acquire()
    try {
      return await this.call(messages, opts, 0)
    } finally {
      release()
    }
  }

  private async call(messages: ChatMessage[], opts: GenerateOpts, attempt: number): Promise<string> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: opts.temperature ?? 0.6,
        // gpt-oss models spend reasoning tokens inside max_tokens; keep the
        // caller's budget for the visible answer by adding headroom.
        max_tokens: (opts.maxTokens ?? 1024) + (this.isReasoning ? 768 : 0),
        response_format: opts.responseFormat === 'json' ? { type: 'json_object' } : undefined,
        ...(this.isReasoning ? { reasoning_effort: 'low' as const } : {}),
      })
      return res.choices[0]?.message?.content ?? ''
    } catch (err) {
      if (isRetryable(err) && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(err, attempt))
        return this.call(messages, opts, attempt + 1)
      }
      throw new AIProviderError('groq', 'generation failed', err)
    }
  }
}
