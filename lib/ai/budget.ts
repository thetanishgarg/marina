import { and, desc, eq, gte, sum } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { afterResponse } from '@/lib/after'

/**
 * Per-org AI spend gatekeeper. Every AI call should:
 *
 *   1. Ask `canSpend(orgId, kind)` BEFORE making the API request.
 *   2. After the call returns, log the actual spend with `recordSpend()`.
 *
 * Behavior:
 *   - `canSpend()` returns `{ allowed: true }` if the running month's spend
 *     is below `orgs.monthlyAiBudgetCents`, else `{ allowed: false, reason }`.
 *   - When monthly spend crosses 80%, the org owner gets an email warning.
 *   - When it crosses 100%, AI is degraded: vision skipped, story falls back
 *     to rules, narrative regeneration disabled.
 *
 * Spend is cents-of-USD (matching providers' billing units). 1 USD = 100c.
 */

export type SpendKind = 'vision' | 'story' | 'narrative' | 'verify_shift' | 'employee_chat' | 'blocker_resolver'

export type SpendDecision = {
  allowed: boolean
  reason?: string
  monthSpentCents: number
  budgetCents: number
}

export async function canSpend(orgId: number | null, kind: SpendKind): Promise<SpendDecision> {
  void kind
  if (!orgId) {
    // Unscoped calls — allow but cap them via global env, default $20/month total
    const globalBudget = Number(process.env.AI_GLOBAL_BUDGET_CENTS ?? 2000)
    const spent = await monthSpendCents(null)
    return spent >= globalBudget
      ? { allowed: false, reason: 'global_budget_exhausted', monthSpentCents: spent, budgetCents: globalBudget }
      : { allowed: true, monthSpentCents: spent, budgetCents: globalBudget }
  }

  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) })
  // Fail CLOSED if the org can't be resolved — a missing/deleted org must
  // never be treated as "unlimited budget".
  if (!org) return { allowed: false, reason: 'org_not_found', monthSpentCents: 0, budgetCents: 0 }

  const spent = await monthSpendCents(orgId)
  if (spent >= org.monthlyAiBudgetCents) {
    return {
      allowed: false,
      reason: 'org_budget_exhausted',
      monthSpentCents: spent,
      budgetCents: org.monthlyAiBudgetCents,
    }
  }
  return { allowed: true, monthSpentCents: spent, budgetCents: org.monthlyAiBudgetCents }
}

/** Persist a spend entry. Wrapped in after() so we never block the caller. */
export function recordSpend(input: {
  orgId: number | null
  userId: number | null
  kind: SpendKind
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
  imageCount?: number
  costCents: number
}): void {
  afterResponse(
    () =>
      db.insert(schema.aiSpend).values({
        orgId: input.orgId,
        userId: input.userId,
        kind: input.kind,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        imageCount: input.imageCount ?? 0,
        costCents: input.costCents,
      }),
    `ai-spend:${input.kind}`,
  )
}

async function monthSpendCents(orgId: number | null): Promise<number> {
  // Spend resets on the 1st of the calendar month (matches what the schema +
  // settings UI promise), not a rolling 31-day window that would bleed a
  // day-1 burst across the boundary and never reset.
  const now = new Date()
  const since = new Date(now.getFullYear(), now.getMonth(), 1)
  const where = orgId
    ? and(eq(schema.aiSpend.orgId, orgId), gte(schema.aiSpend.createdAt, since))
    : gte(schema.aiSpend.createdAt, since)
  const [row] = await db.select({ total: sum(schema.aiSpend.costCents) }).from(schema.aiSpend).where(where)
  return Number(row?.total ?? 0)
}

/** Rough cost estimation per model. Tune as you observe real bills. */
export function estimateCostCents(input: {
  kind: SpendKind
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
  imageCount?: number
}): number {
  // gpt-4o-mini: $0.150 / 1M input, $0.600 / 1M output, ~$0.000638 / image
  // Groq llama-3.3-70b: ~$0.59 / 1M input, $0.79 / 1M output
  const inT = input.inputTokens ?? 0
  const outT = input.outputTokens ?? 0
  const img = input.imageCount ?? 0
  let usd = 0
  if (input.model.includes('gemini') && input.model.includes('lite')) {
    // Gemini Flash-Lite — priced conservatively above published Flash-Lite rates.
    usd = (inT / 1_000_000) * 0.25 + (outT / 1_000_000) * 1.5 + img * 0.0005
  } else if (input.model.includes('gemini')) {
    // Gemini Flash
    usd = (inT / 1_000_000) * 0.5 + (outT / 1_000_000) * 3 + img * 0.001
  } else if (input.model.includes('gpt-oss')) {
    // Groq gpt-oss-120b
    usd = (inT / 1_000_000) * 0.15 + (outT / 1_000_000) * 0.75
  } else if (input.model.includes('gpt-4o-mini')) {
    usd = (inT / 1_000_000) * 0.15 + (outT / 1_000_000) * 0.6 + img * 0.000638
  } else if (input.model.includes('llama-3.3')) {
    usd = (inT / 1_000_000) * 0.59 + (outT / 1_000_000) * 0.79
  } else if (input.model.includes('gpt-4o')) {
    usd = (inT / 1_000_000) * 2.5 + (outT / 1_000_000) * 10
  } else {
    // Unknown model — conservative
    usd = (inT / 1_000_000) * 1 + (outT / 1_000_000) * 3 + img * 0.005
  }
  return Math.ceil(usd * 100)
}

/** Most recent budget snapshot (for the settings UI). */
export async function spendThisMonth(orgId: number): Promise<{
  spentCents: number
  budgetCents: number
  latest: Array<{ kind: string; costCents: number; createdAt: Date }>
}> {
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) })
  const budgetCents = org?.monthlyAiBudgetCents ?? 0
  const spentCents = await monthSpendCents(orgId)
  const latest = await db
    .select({
      kind: schema.aiSpend.kind,
      costCents: schema.aiSpend.costCents,
      createdAt: schema.aiSpend.createdAt,
    })
    .from(schema.aiSpend)
    .where(eq(schema.aiSpend.orgId, orgId))
    .orderBy(desc(schema.aiSpend.createdAt))
    .limit(10)
  return { spentCents, budgetCents, latest }
}
