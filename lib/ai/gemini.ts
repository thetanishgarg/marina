import { AIProvider, AIProviderError, ChatMessage, GenerateOpts } from './provider'

/**
 * Google Gemini via the Gemini API (AI Studio key, `GEMINI_API_KEY`).
 *
 * Plain REST (no SDK) so it runs anywhere the app runs — Vercel today, Cloud
 * Run tomorrow — with zero new dependencies.
 *
 * Model: `GEMINI_MODEL`, default `gemini-3.5-flash-lite` — the newest
 * Flash-Lite, Google's cheapest/fastest tier, which is what every MARINA job
 * (stories, digests, 1:1 briefs, grounded chat) needs: short, structured,
 * cheap, high-volume.
 *
 * - `system` turns become `systemInstruction`; `assistant` turns → role `model`.
 * - `responseFormat: 'json'` → `responseMimeType: application/json`, so the
 *   model is constrained to valid JSON instead of us stripping code fences.
 * - Flash-Lite 3.x models think by default and thinking tokens count against
 *   `maxOutputTokens`; MARINA's prompts are summarisation, so we ask for
 *   minimal thinking. If a model rejects that field we retry once without it.
 * - 429/5xx are retried with backoff; after that we throw so
 *   generateWithFallback() moves on to Groq/OpenAI.
 */

const API_BASE = process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta'
const MAX_RETRIES = Math.max(0, Number(process.env.GEMINI_MAX_RETRIES ?? 2))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// A 401/403 (bad key, API disabled, no quota tier on the project) won't fix
// itself between calls. Skip Gemini for a while so every AI request doesn't
// pay a failed round-trip before falling back to Groq/OpenAI.
const AUTH_COOLDOWN_MS = 10 * 60_000
let disabledUntil = 0

type GeminiPart = { text?: string }
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  error?: { code?: number; message?: string; status?: string }
}

export class GeminiProvider implements AIProvider {
  name = 'gemini' as const
  model: string
  private apiKey: string
  private thinkingSupported = true

  constructor(opts: { model?: string } = {}) {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
    if (!apiKey) throw new AIProviderError('gemini', 'GEMINI_API_KEY is not set')
    this.apiKey = apiKey
    this.model = opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite'
  }

  async generate(messages: ChatMessage[], opts: GenerateOpts = {}): Promise<string> {
    if (Date.now() < disabledUntil) {
      throw new AIProviderError('gemini', 'temporarily disabled after an auth/quota error')
    }
    return this.call(messages, opts, 0)
  }

  private body(messages: ChatMessage[], opts: GenerateOpts) {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    // Gemini requires at least one user turn.
    if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: system || 'Hello' }] })

    const generationConfig: Record<string, unknown> = {
      temperature: opts.temperature ?? 0.6,
      maxOutputTokens: opts.maxTokens ?? 1024,
    }
    if (opts.responseFormat === 'json') generationConfig.responseMimeType = 'application/json'
    if (this.thinkingSupported) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' }

    return {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents,
      generationConfig,
    }
  }

  private async call(messages: ChatMessage[], opts: GenerateOpts, attempt: number): Promise<string> {
    const url = `${API_BASE}/models/${encodeURIComponent(this.model)}:generateContent`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(this.body(messages, opts)),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(600 * 2 ** attempt)
        return this.call(messages, opts, attempt + 1)
      }
      throw new AIProviderError('gemini', 'network error', err)
    }

    const text = await res.text()
    let data: GeminiResponse = {}
    try {
      data = text ? (JSON.parse(text) as GeminiResponse) : {}
    } catch {
      /* non-JSON error page */
    }

    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`
      // A model that doesn't accept thinkingConfig → drop it and retry once.
      if (res.status === 400 && this.thinkingSupported && /thinking/i.test(msg)) {
        this.thinkingSupported = false
        return this.call(messages, opts, attempt)
      }
      if (res.status === 401 || res.status === 403) {
        disabledUntil = Date.now() + AUTH_COOLDOWN_MS
      }
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const ra = Number(res.headers.get('retry-after') ?? 0) * 1000
        await sleep(Math.max(ra, 800 * 2 ** attempt) + Math.floor(Math.random() * 400))
        return this.call(messages, opts, attempt + 1)
      }
      throw new AIProviderError('gemini', `${res.status} ${msg.slice(0, 300)}`)
    }

    if (data.promptFeedback?.blockReason) {
      throw new AIProviderError('gemini', `blocked: ${data.promptFeedback.blockReason}`)
    }
    const out = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
    return out
  }
}
