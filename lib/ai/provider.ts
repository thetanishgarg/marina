export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type GenerateOpts = {
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
}

export type AIProvider = {
  name: 'gemini' | 'groq' | 'openai' // 'gemini' = parked provider in lib/ai/gemini.ts
  model: string
  generate(messages: ChatMessage[], opts?: GenerateOpts): Promise<string>
}

export class AIProviderError extends Error {
  constructor(public provider: string, message: string, public cause?: unknown) {
    super(`[${provider}] ${message}`)
  }
}
