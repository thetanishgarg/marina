import { NextResponse } from 'next/server'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { resolveAgentOrg } from '@/lib/agent/org'
import { db, schema } from '@/lib/db/client'
import { authenticateAgent } from '@/lib/agent/auth'

export const runtime = 'nodejs'

/**
 * Agent-side roster: the list of teammates the operator can mention as
 * "waiting on" in their break dialog. Excludes the operator themselves.
 */
export async function GET(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const org = await resolveAgentOrg(agent.user.id)
  if (!org.ok) return NextResponse.json({ orgId: null, members: [] })
  const orgId = org.orgId

  const rows = await db
    .select({
      userId: schema.users.id,
      login: schema.users.login,
      name: schema.users.name,
      avatarUrl: schema.users.avatarUrl,
      characterKey: schema.users.characterKey,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(
      and(
        eq(schema.memberships.orgId, orgId),
        isNull(schema.memberships.endedAt), // never offer ex-members as "waiting on"
        ne(schema.users.id, agent.user.id),
      ),
    )

  rows.sort((a, b) => (a.name ?? a.login).localeCompare(b.name ?? b.login))

  return NextResponse.json({ orgId, members: rows })
}
