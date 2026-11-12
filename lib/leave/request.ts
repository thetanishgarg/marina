import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { LEAVE_TYPE_LABELS, type LeaveType } from '@/lib/db/schema'
import { notify } from '@/lib/notify/send'
import { inbox } from '@/lib/notify/inbox'
import { audit } from '@/lib/audit/log'
import { afterResponse } from '@/lib/after'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const VALID_LEAVE_TYPES: ReadonlyArray<LeaveType> = [
  'sick', 'casual', 'earned', 'maternity', 'paternity', 'bereavement', 'compoff', 'unpaid', 'other',
]

/**
 * Channel-agnostic leave request. Mirrors app/api/me/leaves POST (validation +
 * insert + audit + notify + in-app to managers) so the Slack surface files
 * leave through identical domain semantics. The caller is responsible for
 * confirming the actor's identity (Slack signature → membership).
 */
export async function requestLeave(input: {
  userId: number
  orgId: number
  startDate: string
  endDate: string
  reason: string
  leaveType?: string
  via?: 'slack' | 'agent' | 'web'
}): Promise<{ ok: true; leaveId: number } | { ok: false; error: string }> {
  if (!ISO_DATE.test(input.startDate)) return { ok: false, error: 'startDate must be YYYY-MM-DD' }
  if (!ISO_DATE.test(input.endDate)) return { ok: false, error: 'endDate must be YYYY-MM-DD' }
  if (input.endDate < input.startDate) return { ok: false, error: 'End date must be on or after the start date.' }
  const reason = (input.reason ?? '').trim().slice(0, 500)
  if (!reason) return { ok: false, error: 'Please add a reason.' }
  const leaveType: LeaveType = VALID_LEAVE_TYPES.includes(input.leaveType as LeaveType)
    ? (input.leaveType as LeaveType)
    : 'casual'

  const member = await db.query.memberships.findFirst({
    where: and(
      eq(schema.memberships.userId, input.userId),
      eq(schema.memberships.orgId, input.orgId),
      isNull(schema.memberships.endedAt),
    ),
  })
  if (!member) return { ok: false, error: 'You are not a member of this workspace.' }

  const [row] = await db
    .insert(schema.leaveRequests)
    .values({
      userId: input.userId,
      orgId: input.orgId,
      startDate: input.startDate,
      endDate: input.endDate,
      reason,
      leaveType,
      status: 'pending',
    })
    .returning()

  const me = await db.query.users.findFirst({ where: eq(schema.users.id, input.userId) })
  const requesterName = me?.name ?? `@${me?.login ?? 'someone'}`

  void audit({
    action: 'leave.requested',
    orgId: input.orgId,
    actorUserId: input.userId,
    targetType: 'leave',
    targetId: row.id,
    payload: { startDate: input.startDate, endDate: input.endDate, leaveType, via: input.via ?? 'slack' },
  })

  void notify({
    kind: 'leave.requested',
    leaveId: row.id,
    orgId: input.orgId,
    actorUserId: input.userId,
    userName: requesterName,
    userLogin: me?.login ?? 'someone',
    startDate: input.startDate,
    endDate: input.endDate,
    leaveType: LEAVE_TYPE_LABELS[leaveType],
    reason,
  })

  const title = `${requesterName} requested ${LEAVE_TYPE_LABELS[leaveType]}`
  const bodyText = `${input.startDate}${input.startDate !== input.endDate ? ` → ${input.endDate}` : ''}${reason ? ` · ${reason.slice(0, 120)}` : ''}`
  afterResponse(async () => {
    const managers = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.orgId, input.orgId),
          isNull(schema.memberships.endedAt),
          inArray(schema.memberships.role, ['admin', 'manager']),
          ne(schema.memberships.userId, input.userId),
        ),
      )
    for (const m of managers) {
      inbox({
        userId: m.userId,
        orgId: input.orgId,
        kind: 'leave.requested',
        title,
        body: bodyText.slice(0, 200),
        href: `/org/${input.orgId}/leaves`,
      })
    }
  }, 'leave notify managers')

  return { ok: true, leaveId: row.id }
}
