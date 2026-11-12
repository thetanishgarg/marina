import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'

/**
 * Single source of truth for "which org does this agent act in?".
 *
 * Every /api/agent/* route used to roll its own lookup, and most of them
 * picked the user's *first* membership row — including memberships that had
 * ended. Someone who left org A and joined org B got A from the heartbeat,
 * the agent echoed A back on break/leave calls, and routes that validated
 * against *active* memberships answered 403. Shifts, breaks and leaves could
 * also land in different orgs.
 *
 * Rules (shared by heartbeat, shifts, breaks, leaves, team, deliverables):
 *   - only ACTIVE memberships count (`ended_at IS NULL`)
 *   - an explicitly requested orgId must be one of them, else `forbidden`
 *   - otherwise the most recently joined active membership wins
 */
export type AgentOrgResult =
  | { ok: true; orgId: number; membershipId: number; activeOrgIds: number[] }
  | { ok: false; reason: 'no_org' | 'forbidden' }

export async function resolveAgentOrg(
  userId: number,
  requestedOrgId?: unknown,
): Promise<AgentOrgResult> {
  const rows = await db
    .select({ id: schema.memberships.id, orgId: schema.memberships.orgId })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), isNull(schema.memberships.endedAt)))
    .orderBy(desc(schema.memberships.createdAt), desc(schema.memberships.id))

  if (rows.length === 0) return { ok: false, reason: 'no_org' }
  const activeOrgIds = rows.map((r) => r.orgId)

  if (typeof requestedOrgId === 'number' && Number.isInteger(requestedOrgId)) {
    const match = rows.find((r) => r.orgId === requestedOrgId)
    if (!match) return { ok: false, reason: 'forbidden' }
    return { ok: true, orgId: match.orgId, membershipId: match.id, activeOrgIds }
  }

  return { ok: true, orgId: rows[0].orgId, membershipId: rows[0].id, activeOrgIds }
}

/** The org's IANA timezone (falls back to IST, the product default). */
export async function orgTimezone(orgId: number | null | undefined): Promise<string> {
  if (!orgId) return 'Asia/Kolkata'
  const org = await db.query.orgs.findFirst({
    where: eq(schema.orgs.id, orgId),
    columns: { timezone: true },
  })
  return org?.timezone || 'Asia/Kolkata'
}
