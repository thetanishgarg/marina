import { and, eq, gte, isNull, sql } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'

/**
 * Shared deliverable creation logic.
 *
 * Used by both the web (`/api/me/deliverables`) and the desktop agent
 * (`/api/agent/deliverables`) so the rules are identical regardless of
 * surface: minimum length, URL validation, primary-org auto-attach, 4-hour
 * dedupe on identical titles, screenshot pinning for verification.
 *
 * The verification job (cron) reads `pinnedShotAt` and cross-references the
 * `shot_analyses` row taken closest to that timestamp — if the claim
 * ("shipped Figma redesign") matches the screen content category ("design"),
 * we mark it verified. Otherwise it stays unverified or flips to mismatch.
 */
export type CreateDeliverableInput = {
  userId: number
  /** Free-text title of the work, 10–200 chars (single sentence). */
  title: string
  /** Optional URL to the artifact (Figma file, PR, deal, ticket). */
  url?: string | null
  /** Optional discipline hint — design, deal, ticket, doc, etc. */
  kind?: string | null
  /** Optional longer detail / notes. */
  detail?: string | null
  /** Optional completion time. Defaults to "now". */
  completedAt?: Date
  /** Explicit org override. Defaults to the user's primary membership. */
  orgId?: number | null
}

export type CreateDeliverableResult =
  | {
      ok: true
      deliverable: {
        id: number
        title: string
        detail: string | null
        url: string | null
        kind: string | null
        completedAt: string
        pinnedShotAt: string
        verificationStatus: 'unverified' | 'verified' | 'mismatch'
      }
    }
  | { ok: false; error: string; status: 400 | 403 | 409 | 500; duplicateOf?: number }

const MIN_TITLE = 10
const MAX_TITLE = 200
const DEDUPE_WINDOW_HOURS = 4

export async function createDeliverable(input: CreateDeliverableInput): Promise<CreateDeliverableResult> {
  const title = (input.title ?? '').trim()

  // Title: 10–200 chars enforces "real sentences" not noise.
  if (title.length < MIN_TITLE) {
    return {
      ok: false,
      status: 400,
      error: `Title must be at least ${MIN_TITLE} characters. Write what you shipped, not just "done".`,
    }
  }
  if (title.length > MAX_TITLE) {
    return {
      ok: false,
      status: 400,
      error: `Title must be at most ${MAX_TITLE} characters.`,
    }
  }

  const url =
    typeof input.url === 'string' && input.url.trim().length > 0
      ? input.url.trim().slice(0, 500)
      : null
  if (url && !/^https?:\/\//i.test(url)) {
    return { ok: false, status: 400, error: 'url must start with http(s)://' }
  }

  const kind =
    typeof input.kind === 'string' && input.kind.trim().length > 0
      ? input.kind.trim().slice(0, 40)
      : null

  const detail =
    typeof input.detail === 'string' && input.detail.trim().length > 0
      ? input.detail.trim().slice(0, 1000)
      : null

  const completedAt = input.completedAt ?? new Date()
  if (Number.isNaN(completedAt.getTime())) {
    return { ok: false, status: 400, error: 'invalid completedAt' }
  }

  // Dedupe: if the user logged the exact same title in the last 4 hours, treat
  // as duplicate so they don't accidentally double-log from agent + web.
  const dedupSince = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000)
  const dupes = await db
    .select({ id: schema.deliverables.id })
    .from(schema.deliverables)
    .where(
      and(
        eq(schema.deliverables.userId, input.userId),
        gte(schema.deliverables.completedAt, dedupSince),
        // Postgres-side trimmed-lowercase comparison so "Shipped X" and
        // "shipped x " collapse.
        sql`lower(trim(${schema.deliverables.title})) = ${title.toLowerCase()}`,
      ),
    )
    .limit(1)
  if (dupes.length > 0) {
    return {
      ok: false,
      status: 409,
      error: `You already logged this in the last ${DEDUPE_WINDOW_HOURS} hours.`,
      duplicateOf: dupes[0].id,
    }
  }

  // Resolve org — explicit > user's primary membership. SECURITY: an explicit
  // orgId MUST be one the user actually belongs to, otherwise a caller could
  // inject a deliverable into any org's feed (visible to that org's managers).
  let orgId: number | null = null
  if (typeof input.orgId === 'number') {
    const member = await db.query.memberships.findFirst({
      where: and(
        eq(schema.memberships.userId, input.userId),
        eq(schema.memberships.orgId, input.orgId),
        isNull(schema.memberships.endedAt),
      ),
    })
    if (!member) {
      return {
        ok: false,
        status: 403,
        error: 'You are not a member of that workspace.',
      }
    }
    orgId = input.orgId
  } else {
    const m = await db.query.memberships.findFirst({
      where: and(eq(schema.memberships.userId, input.userId), isNull(schema.memberships.endedAt)),
      // Same rule as lib/agent/org.ts: most recently joined active org wins.
      orderBy: (t, { desc }) => [desc(t.createdAt), desc(t.id)],
    })
    orgId = m?.orgId ?? null
  }

  const [row] = await db
    .insert(schema.deliverables)
    .values({
      userId: input.userId,
      orgId,
      title,
      detail,
      url,
      kind,
      completedAt,
      // Pin the moment-of-log so the verification cron has a precise
      // timestamp to look up the corresponding screenshot.
      pinnedShotAt: completedAt,
    })
    .returning()

  return {
    ok: true,
    deliverable: {
      id: row.id,
      title: row.title,
      detail: row.detail,
      url: row.url,
      kind: row.kind,
      completedAt: row.completedAt.toISOString(),
      // pinnedShotAt is the contract field the agent uses to show
      // "pinned for verification at HH:MM" in its success toast.
      pinnedShotAt: (row.pinnedShotAt ?? row.completedAt).toISOString(),
      verificationStatus: row.verificationStatus,
    },
  }
}
