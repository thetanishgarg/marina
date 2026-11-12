import { NextResponse } from 'next/server'
import { db, schema } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import { authenticateAgent } from '@/lib/agent/auth'
import { resolveAgentOrg } from '@/lib/agent/org'
import { requestLeave } from '@/lib/leave/request'

export const runtime = 'nodejs'

/**
 * Agent-authenticated leave-request submission.
 *
 * Goes through the same domain function as Slack (validation, audit, Slack
 * notify, in-app rows for every manager) so a leave filed from the desktop is
 * indistinguishable from one filed on the web. Previously this route inserted
 * the row directly — managers were never notified — and resolved the org from
 * the user's first membership, including orgs they had left.
 */
export async function POST(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: {
    orgId?: number
    startDate?: string
    endDate?: string
    reason?: string
    leaveType?: string
  } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // A stale orgId (an org the user has left) falls back to their current org.
  let org = await resolveAgentOrg(agent.user.id, body.orgId)
  if (!org.ok && org.reason === 'forbidden') org = await resolveAgentOrg(agent.user.id)
  if (!org.ok) {
    return NextResponse.json({ error: 'no team — accept a team invite first' }, { status: 400 })
  }

  const result = await requestLeave({
    userId: agent.user.id,
    orgId: org.orgId,
    startDate: String(body.startDate ?? ''),
    endDate: String(body.endDate ?? ''),
    reason: String(body.reason ?? ''),
    leaveType: body.leaveType,
    via: 'agent',
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const row = await db.query.leaveRequests.findFirst({
    where: eq(schema.leaveRequests.id, result.leaveId),
  })
  if (!row) return NextResponse.json({ error: 'internal' }, { status: 500 })

  return NextResponse.json({
    ok: true,
    leave: {
      id: row.id,
      startDate: row.startDate,
      endDate: row.endDate,
      reason: row.reason,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    },
  })
}
