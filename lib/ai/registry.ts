import { AIProvider, AIProviderError, ChatMessage, GenerateOpts } from './provider'
import { GeminiProvider } from './gemini'
import { GroqProvider } from './groq'
import { OpenAIProvider } from './openai'

// Google Gemini is MARINA's primary model. Groq and OpenAI stay wired as
// automatic fallbacks, tried in this order when Gemini fails or has no key.
export type ProviderName = 'gemini' | 'groq' | 'openai'
export const PROVIDER_NAMES: readonly ProviderName[] = ['gemini', 'groq', 'openai']

export function isProviderName(v: unknown): v is ProviderName {
  return typeof v === 'string' && (PROVIDER_NAMES as readonly string[]).includes(v)
}

/** Gemini is the default; override with DEFAULT_AI_PROVIDER. */
function defaultProvider(): ProviderName {
  const env = process.env.DEFAULT_AI_PROVIDER
  return isProviderName(env) ? env : 'gemini'
}

const cache: Partial<Record<ProviderName, AIProvider>> = {}

export function getProvider(name?: ProviderName): AIProvider {
  const resolved = name ?? defaultProvider()
  if (cache[resolved]) return cache[resolved]!
  const provider: AIProvider =
    resolved === 'gemini'
      ? new GeminiProvider()
      : resolved === 'openai'
        ? new OpenAIProvider()
        : new GroqProvider()
  cache[resolved] = provider
  return provider
}

/**
 * Try the preferred provider, then every other configured one in order
 * (gemini → groq → openai). A provider with no API key is skipped silently,
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
