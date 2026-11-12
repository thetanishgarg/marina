import { AIProvider, AIProviderError, ChatMessage, GenerateOpts } from './provider'
import { GroqProvider } from './groq'
import { OpenAIProvider } from './openai'

// ─── Google Gemini: parked for later ───────────────────────────────────────
// lib/ai/gemini.ts holds a complete GeminiProvider (REST, JSON mode, minimal
// thinking, retry/backoff, auth cooldown). It is switched off for now because
// the current AI Studio key's project has no Gemini free tier enabled
// (generateContent → 403 "free tier is not available for this project").
//
// To turn Gemini on once the key works:
//   1. Uncomment the import below and the `gemini` entries marked GEMINI.
//   2. Set DEFAULT_AI_PROVIDER=gemini (and NEXT_PUBLIC_DEFAULT_AI_PROVIDER).
//   3. (provider.ts already allows the 'gemini' name.)
//   4. Update the sub-processor lists in app/(legal)/privacy + dpa.
// import { GeminiProvider } from './gemini' // GEMINI
// ───────────────────────────────────────────────────────────────────────────

export type ProviderName = 'groq' | 'openai' // GEMINI: | 'gemini'
export const PROVIDER_NAMES: readonly ProviderName[] = ['groq', 'openai'] // GEMINI: put 'gemini' first

export function isProviderName(v: unknown): v is ProviderName {
  return typeof v === 'string' && (PROVIDER_NAMES as readonly string[]).includes(v)
}

/** Groq is MARINA's primary model today; OpenAI is the fallback. */
function defaultProvider(): ProviderName {
  const env = process.env.DEFAULT_AI_PROVIDER
  return isProviderName(env) ? env : 'groq'
}

const cache: Partial<Record<ProviderName, AIProvider>> = {}

export function getProvider(name?: ProviderName): AIProvider {
  const resolved = name ?? defaultProvider()
  if (cache[resolved]) return cache[resolved]!
  const provider: AIProvider = resolved === 'openai' ? new OpenAIProvider() : new GroqProvider()
  // GEMINI: : resolved === 'gemini' ? new GeminiProvider()
  cache[resolved] = provider
  return provider
}

/**
 * Try the preferred provider, then every other configured one in order
 * (groq → openai). A provider with no API key is skipped silently,
 * so a deployment only needs the keys it actually has.
 */
export async function generateWithFallback(
  messages: ChatMessage[],
  opts: GenerateOpts = {},
  preferred?: ProviderName
): Promise<{ text: string; provider: string; model: string }> {
  const primary = preferred ?? defaultProvider()
  const order: ProviderName[] = [primary, ...PROVIDER_NAMES.filter((p) => p !== primary)]

  for (const name of order) {
    try {
      const provider = getProvider(name)
      const text = await provider.generate(messages, opts)
      if (text.trim().length === 0) continue
      return { text, provider: provider.name, model: provider.model }
    } catch (err) {
      if (err instanceof AIProviderError && err.message.includes('is not set')) {
        // missing API key for this provider — try the next one silently
        continue
      }
      console.error(`AI provider ${name} failed, trying fallback`, err)
    }
  }
  throw new Error('All AI providers failed or are not configured')
}
