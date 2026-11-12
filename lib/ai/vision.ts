import OpenAI from 'openai'
import { AIProviderError } from './provider'
import type { ShotAppCategory, ShotContentHint, ShotWorkLabel } from '@/lib/db/schema'

export type VisionAnalysis = {
  appCategory: ShotAppCategory
  workAppLabel: ShotWorkLabel
  visibleContentHint: ShotContentHint
  confidence: number // 0..1
}

export type VisionAnalysisResult = {
  analysis: VisionAnalysis
  provider: string
  model: string
  raw: unknown
}

export interface VisionProvider {
  name: string
  model: string
  analyze(image: { bytes: Buffer; mime: string }): Promise<VisionAnalysisResult>
}

const PROMPT = `You are analyzing a workplace screenshot from a productivity tool.

Return strict JSON matching exactly:
{
  "appCategory": "ide" | "design" | "comms" | "browser_work" | "browser_personal" | "media" | "unknown",
  "workAppLabel": "work" | "non_work" | "ambiguous",
  "visibleContentHint": "code_editing" | "design_canvas" | "reading_docs" | "chat" | "video_streaming" | "social_media" | "static_idle" | "other",
  "confidence": <number between 0 and 1>
}

Rules:
- "ide" covers VS Code, IntelliJ, Xcode, terminals/REPLs with code visible.
- "design" covers Figma, Sketch, Photoshop.
- "comms" covers Slack, Teams, Discord, email clients with chat-like UI.
- "browser_work" covers GitHub, Jira, Linear, docs, internal tools, Stack Overflow.
- "browser_personal" covers social media in a browser, shopping, personal email.
- "media" covers YouTube, Netflix, Spotify, Twitch playing video/audio.
- "static_idle" specifically for desktops with no visible app activity (empty desktop, lock-screen-adjacent, fullscreen screensaver, the same paused state).
- "workAppLabel" should err on "ambiguous" when unsure, never invent.
- Do not include any screen contents, names, or text beyond these labels.
- Return only the JSON object — no prose, no markdown fences.`

export class OpenAIVisionProvider implements VisionProvider {
  name = 'openai'
  model: string
  private client: OpenAI

  constructor(opts: { model?: string } = {}) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new AIProviderError('openai', 'OPENAI_API_KEY is not set')
    this.model = opts.model ?? 'gpt-4o-mini'
    this.client = new OpenAI({ apiKey })
  }

  async analyze({ bytes, mime }: { bytes: Buffer; mime: string }): Promise<VisionAnalysisResult> {
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`
    let res
    try {
      res = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.1,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You output only valid JSON matching the user-provided schema. No prose.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
            ],
          },
        ],
      })
    } catch (err) {
      throw new AIProviderError('openai-vision', 'vision call failed', err)
    }

    const text = res.choices[0]?.message?.content ?? '{}'
    const parsed = parseAnalysis(text)
    return {
      analysis: parsed,
      provider: this.name,
      model: this.model,
      raw: text,
    }
  }
}

const GEMINI_API_BASE = process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta'

/** Constrains Gemini's JSON output to exactly the VisionAnalysis shape. */
const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    appCategory: {
      type: 'STRING',
      enum: ['ide', 'design', 'comms', 'browser_work', 'browser_personal', 'media', 'unknown'],
    },
    workAppLabel: { type: 'STRING', enum: ['work', 'non_work', 'ambiguous'] },
    visibleContentHint: {
      type: 'STRING',
      enum: [
        'code_editing',
        'design_canvas',
        'reading_docs',
        'chat',
        'video_streaming',
        'social_media',
        'static_idle',
        'other',
      ],
    },
    confidence: { type: 'NUMBER' },
  },
  required: ['appCategory', 'workAppLabel', 'visibleContentHint', 'confidence'],
}

type GeminiVisionResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

/**
 * Gemini multimodal screenshot labelling (Gemini API, `GEMINI_API_KEY`).
 * The image goes inline in the request and is not stored by this code; the
 * response is constrained to the label schema above, so no screen text or
 * names can come back. Model: `GEMINI_VISION_MODEL`, else `GEMINI_MODEL`.
 */
export class GeminiVisionProvider implements VisionProvider {
  name = 'gemini'
  model: string
  private apiKey: string
  private thinkingSupported = true

  constructor(opts: { model?: string } = {}) {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
    if (!apiKey) throw new AIProviderError('gemini', 'GEMINI_API_KEY is not set')
    this.apiKey = apiKey
    this.model =
      opts.model ?? process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite'
  }

  async analyze({ bytes, mime }: { bytes: Buffer; mime: string }): Promise<VisionAnalysisResult> {
    const generationConfig: Record<string, unknown> = {
      temperature: 0.1,
      maxOutputTokens: 300,
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
    }
    if (this.thinkingSupported) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' }

    let res: Response
    try {
      res = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'You output only valid JSON matching the user-provided schema. No prose.' }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: PROMPT }, { inlineData: { mimeType: mime, data: bytes.toString('base64') } }],
            },
          ],
          generationConfig,
        }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err) {
      throw new AIProviderError('gemini-vision', 'network error', err)
    }

    const body = await res.text()
    let data: GeminiVisionResponse = {}
    try {
      data = body ? (JSON.parse(body) as GeminiVisionResponse) : {}
    } catch {
      /* non-JSON error page */
    }

    if (!res.ok) {
      const msg = data.error?.message ?? `HTTP ${res.status}`
      // A model that doesn't accept thinkingConfig → drop it and retry once.
      if (res.status === 400 && this.thinkingSupported && /thinking/i.test(msg)) {
        this.thinkingSupported = false
        return this.analyze({ bytes, mime })
      }
      throw new AIProviderError('gemini-vision', `${res.status} ${msg.slice(0, 300)}`)
    }
    if (data.promptFeedback?.blockReason) {
      throw new AIProviderError('gemini-vision', `blocked: ${data.promptFeedback.blockReason}`)
    }

    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    if (!text.trim()) throw new AIProviderError('gemini-vision', 'empty response')
    return { analysis: parseAnalysis(text), provider: this.name, model: this.model, raw: text }
  }
}

const VALID_CATEGORIES: ShotAppCategory[] = [
  'ide',
  'design',
  'comms',
  'browser_work',
  'browser_personal',
  'media',
  'unknown',
]
const VALID_WORK: ShotWorkLabel[] = ['work', 'non_work', 'ambiguous']
const VALID_HINTS: ShotContentHint[] = [
  'code_editing',
  'design_canvas',
  'reading_docs',
  'chat',
  'video_streaming',
  'social_media',
  'static_idle',
  'other',
]

function parseAnalysis(text: string): VisionAnalysis {
  let obj: Record<string, unknown> = {}
  try {
    obj = JSON.parse(text) as Record<string, unknown>
  } catch {
    obj = {}
  }

  const appCategory = VALID_CATEGORIES.includes(obj.appCategory as ShotAppCategory)
    ? (obj.appCategory as ShotAppCategory)
    : 'unknown'
  const workAppLabel = VALID_WORK.includes(obj.workAppLabel as ShotWorkLabel)
    ? (obj.workAppLabel as ShotWorkLabel)
    : 'ambiguous'
  const visibleContentHint = VALID_HINTS.includes(obj.visibleContentHint as ShotContentHint)
    ? (obj.visibleContentHint as ShotContentHint)
    : 'other'
  let confidence = typeof obj.confidence === 'number' ? obj.confidence : 0
  if (!Number.isFinite(confidence)) confidence = 0
  confidence = Math.max(0, Math.min(1, confidence))

  return { appCategory, workAppLabel, visibleContentHint, confidence }
}

const VISION_ORDER = ['gemini', 'openai'] as const
type VisionProviderName = (typeof VISION_ORDER)[number]

function isVisionProviderName(v: unknown): v is VisionProviderName {
  return typeof v === 'string' && (VISION_ORDER as readonly string[]).includes(v)
}

/** True when at least one vision provider has an API key configured. */
export function hasVisionKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.OPENAI_API_KEY)
}

function buildVisionProvider(name: VisionProviderName): VisionProvider {
  return name === 'gemini' ? new GeminiVisionProvider() : new OpenAIVisionProvider()
}

/**
 * Gemini first, OpenAI as fallback (override the first choice with
 * `VISION_PROVIDER`). A provider with no API key is skipped; a provider that
 * errors falls through to the next. The result reports whichever provider
 * actually answered.
 */
class FallbackVisionProvider implements VisionProvider {
  private providers: VisionProvider[]

  constructor() {
    const preferred = process.env.VISION_PROVIDER
    const first: VisionProviderName = isVisionProviderName(preferred) ? preferred : 'gemini'
    const order = [first, ...VISION_ORDER.filter((n) => n !== first)]
    this.providers = []
    for (const name of order) {
      try {
        this.providers.push(buildVisionProvider(name))
      } catch {
        /* no API key for this provider — skip it */
      }
    }
    if (this.providers.length === 0) {
      throw new AIProviderError('vision', 'GEMINI_API_KEY or OPENAI_API_KEY is not set')
    }
  }

  get name(): string {
    return this.providers[0].name
  }

  get model(): string {
    return this.providers[0].model
  }

  async analyze(image: { bytes: Buffer; mime: string }): Promise<VisionAnalysisResult> {
    let lastErr: unknown
    for (const provider of this.providers) {
      try {
        return await provider.analyze(image)
      } catch (err) {
        lastErr = err
        // Message only: never log the image or the provider's raw response.
        console.error(`vision provider ${provider.name} failed, trying fallback:`, String(err))
      }
    }
    throw lastErr ?? new AIProviderError('vision', 'all vision providers failed')
  }
}

let cached: VisionProvider | null = null

export function getVisionProvider(): VisionProvider {
  if (cached) return cached
  cached = new FallbackVisionProvider()
  return cached
}

/**
 * Heuristic progress score: compares two consecutive analyses without an LLM call.
 * Returns 0..1.
 */
export function progressScore(
  previous: Pick<VisionAnalysis, 'appCategory' | 'visibleContentHint' | 'workAppLabel'> | null,
  current: Pick<VisionAnalysis, 'appCategory' | 'visibleContentHint' | 'workAppLabel'>
): number {
  const curHint: ShotContentHint = current.visibleContentHint
  const prevHint: ShotContentHint | null = previous?.visibleContentHint ?? null

  // Two consecutive static_idle frames is the strongest dummying signal.
  if (curHint === 'static_idle') {
    return prevHint === 'static_idle' ? 0 : 0.1
  }
  if (!previous) return current.workAppLabel === 'work' ? 1 : 0.5
  if (previous.appCategory !== current.appCategory) return 0.7
  if (
    prevHint === curHint &&
    (curHint === 'code_editing' || curHint === 'design_canvas')
  ) {
    return 1
  }
  return 0.6
}
