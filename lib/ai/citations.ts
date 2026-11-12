import type { ChatMessage } from './provider'
import { generateWithFallback, type ProviderName } from './registry'

/**
 * Checkable answers.
 *
 * Every item we hand the model (a commit, PR, meeting, logged deliverable,
 * blocker, standup…) is registered here first and gets a stable source id.
 * The model must answer as JSON claims, each naming the source ids it relied
 * on. We then verify those ids against the registry ON THE SERVER: a data
 * claim whose sources we never supplied is dropped, so an invented citation
 * can't reach the UI. If nothing survives, the answer says there is no
 * supporting data instead of guessing.
 */

export type SourceKind =
  | 'commit'
  | 'pr'
  | 'review'
  | 'issue'
  | 'meeting'
  | 'one_on_one'
  | 'deliverable'
  | 'blocker'
  | 'break'
  | 'thread_message'
  | 'standup'
  | 'leave'
  | 'shift'
  | 'rollup'
  | 'ai_summary'

export type SourceItem = {
  /** Stable id the model cites and the UI shows, e.g. "pr-481". */
  id: string
  kind: SourceKind
  /** Human-readable description of the item. */
  label: string
  /** Link to the item (GitHub URL, deliverable link, or an in-app page). */
  url?: string
  /** ISO date (YYYY-MM-DD) the item happened. */
  date?: string
  /** Whose item it is, when the context spans several people. */
  person?: string
}

export type CitedClaim = { text: string; sources: string[] }

export type CitedAnswer = {
  /** Plain-text answer (claims joined) — what history, Slack and old clients use. */
  answer: string
  claims: CitedClaim[]
  /** Only the sources actually cited by a surviving claim. */
  sources: SourceItem[]
  /** False when no claim was backed by a supplied source item. */
  grounded: boolean
  /** Data claims removed because they cited nothing we supplied. */
  droppedClaims: number
  provider: string
  model: string
}

export const NO_DATA_ANSWER =
  "I don't have data that supports an answer to that, so I won't guess."

/** Maps GitHub event types onto source kinds. */
export function githubKind(type: string): SourceKind {
  if (type === 'commit') return 'commit'
  if (type === 'pr_opened') return 'pr'
  if (type === 'pr_reviewed') return 'review'
  return 'issue'
}

/** Collects the source items for one model call and hands out their ids. */
export class SourceRegistry {
  private items = new Map<string, SourceItem>()

  /** Register an item and return its id (put this id on the context row as `src`). */
  add(kind: SourceKind, key: string | number, item: Omit<SourceItem, 'id' | 'kind'>): string {
    const id = `${kind}-${key}`
    if (!this.items.has(id)) {
      this.items.set(id, {
        id,
        kind,
        label: item.label.slice(0, 200),
        ...(item.url ? { url: item.url } : {}),
        ...(item.date ? { date: item.date } : {}),
        ...(item.person ? { person: item.person } : {}),
      })
    }
    return id
  }

  get(id: string): SourceItem | undefined {
    return this.items.get(id)
  }

  get size(): number {
    return this.items.size
  }
}

/** Appended to each chat's system prompt. `allowProduct` enables how-to answers. */
export function citationRules(opts: { allowProduct: boolean }): string {
  return `OUTPUT FORMAT — return ONLY a JSON object, no prose around it:
{"claims":[{"text":"<one sentence or one list item, plain text>","basis":"data"${opts.allowProduct ? '|"product"' : ''}|"no_data","sources":["<src id>", "..."]}]}

CITATION RULES — not optional:
- Every row in the data context carries a "src" id. Each factual statement about people or work is one claim with basis "data" and MUST list the src ids of the exact rows it relies on (1 to 6 ids). Copy ids exactly; never invent or alter an id.
- For counts and totals, cite the rows you counted (up to 6) or the matching rollup row.
- A "data" claim with no valid src id will be deleted before the user sees it. If you cannot point to a row, do not make the claim.
- If the data does not contain what was asked, return a single claim with basis "no_data" saying plainly what is missing. Use "no_data" only for that, or for a short clarifying question. Never use it for a guess, an inference, or advice.${
    opts.allowProduct
      ? '\n- For questions about how MARINA itself works, use basis "product" (no sources) and answer from the product knowledge only.'
      : ''
  }
- Do not write src ids, raw JSON or internal ids inside "text". Keep the whole answer to at most 8 claims.`
}

type RawClaim = { text?: unknown; basis?: unknown; sources?: unknown }

function parseClaims(text: string): RawClaim[] | null {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s)
    } catch {
      return undefined
    }
  }
  let obj = tryParse(text)
  if (obj === undefined) {
    // Tolerate a fenced or prefixed object from providers without strict JSON mode.
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) obj = tryParse(text.slice(start, end + 1))
  }
  if (!obj || typeof obj !== 'object') return null
  const claims = (obj as { claims?: unknown }).claims
  return Array.isArray(claims) ? (claims as RawClaim[]) : null
}

/**
 * Turn raw model output into a verified answer. Pure (no I/O) so the rule
 * "no supplied source → no claim" can be tested without a model call.
 */
export function verifyCitedOutput(
  rawText: string,
  registry: SourceRegistry,
  opts: { allowProduct: boolean }
): Omit<CitedAnswer, 'provider' | 'model'> {
  const raw = parseClaims(rawText)
  const claims: CitedClaim[] = []
  const used = new Map<string, SourceItem>()
  let dropped = 0
  let dataClaims = 0

  for (const c of raw ?? []) {
    const text = typeof c.text === 'string' ? c.text.trim() : ''
    if (!text) continue
    const ids = Array.isArray(c.sources) ? c.sources.filter((s): s is string => typeof s === 'string') : []
    const valid = Array.from(new Set(ids)).filter((id) => registry.get(id))

    if (c.basis === 'no_data' || (c.basis === 'product' && opts.allowProduct)) {
      claims.push({ text, sources: [] })
      continue
    }
    // Anything else is treated as a data claim and must be backed.
    if (valid.length === 0) {
      dropped++
      continue
    }
    dataClaims++
    for (const id of valid) used.set(id, registry.get(id)!)
    claims.push({ text, sources: valid })
  }

  if (claims.length === 0) {
    return { answer: NO_DATA_ANSWER, claims: [{ text: NO_DATA_ANSWER, sources: [] }], sources: [], grounded: false, droppedClaims: dropped }
  }
  return {
    answer: claims.map((c) => c.text).join('\n'),
    claims,
    sources: Array.from(used.values()),
    grounded: dataClaims > 0,
    droppedClaims: dropped,
  }
}

/** One JSON-mode model call, then server-side verification of every citation. */
export async function generateCitedAnswer(
  messages: ChatMessage[],
  registry: SourceRegistry,
  opts: { allowProduct: boolean; temperature?: number; maxTokens?: number; preferred?: ProviderName }
): Promise<CitedAnswer> {
  const { text, provider, model } = await generateWithFallback(
    messages,
    { temperature: opts.temperature ?? 0.2, maxTokens: opts.maxTokens ?? 1200, responseFormat: 'json' },
    opts.preferred
  )
  return { ...verifyCitedOutput(text, registry, { allowProduct: opts.allowProduct }), provider, model }
}
