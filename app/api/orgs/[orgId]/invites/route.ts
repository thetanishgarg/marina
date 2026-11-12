import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { and, count, desc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { HttpError, requireCapability, roleAtLeast } from '@/lib/auth/guards'
import { sendInviteEmail } from '@/lib/email/send'
import type { Discipline, Role } from '@/lib/db/schema'

const VALID_DISCIPLINES = new Set<Discipline>([
  'engineering', 'design', 'product', 'sales', 'support',
  'marketing', 'ops', 'hr', 'finance', 'exec', 'other',
])
import { planFor } from '@/lib/billing/plans'

export const runtime = 'nodejs'

const INVITE_TTL_DAYS = 7

export async function GET(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId: orgIdRaw } = await ctx.params
  const orgId = Number(orgIdRaw)
  if (!Number.isInteger(orgId)) {
    return NextResponse.json({ error: 'invalid orgId' }, { status: 400 })
  }

  try {
    // Same capability as creating/revoking invites — leads share the
    // manager rank but must not see (or harvest) the pending-invite list.
    await requireCapability(orgId, 'manage_members')
    const rows = await db
      .select()
      .from(schema.invites)
      .where(and(eq(schema.invites.orgId, orgId), isNull(schema.invites.acceptedAt)))
      .orderBy(desc(schema.invites.createdAt))
    return NextResponse.json({ invites: rows })
  } catch (err) {
    return errorResponse(err)
  }

  // suppress unused-var on req when only inspecting params
  void req
}

export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId: orgIdRaw } = await ctx.params
  const orgId = Number(orgIdRaw)
  if (!Number.isInteger(orgId)) {
    return NextResponse.json({ error: 'invalid orgId' }, { status: 400 })
  }

  try {
    // Roster mutation → capability-gated (a `lead` has rank ≥ manager but does
    // NOT hold manage_members), matching members DELETE / managers endpoints.
    const { session, membership } = await requireCapability(orgId, 'manage_members')
    const {
      email,
      role,
      discipline,
      jobTitle,
    } = (await req.json()) as {
      email?: string
      role?: string
      discipline?: string
      jobTitle?: string | null
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'valid email required' }, { status: 400 })
    }
    const normalizedEmail = email.trim().toLowerCase()
    if (!isAllowedRole(role)) {
      return NextResponse.json({ error: 'role must be member, manager, or admin' }, { status: 400 })
    }
    // Only an admin/owner can mint another admin. A manager inviting an admin
    // would be a privilege-escalation path, so reject it explicitly.
    if (role === 'admin' && !roleAtLeast(membership.role, 'admin')) {
      return NextResponse.json(
        { error: 'Only an owner/admin can invite another admin.' },
        { status: 403 },
      )
    }
    const inviteDiscipline: Discipline =
      typeof discipline === 'string' && VALID_DISCIPLINES.has(discipline as Discipline)
        ? (discipline as Discipline)
        : 'other'
    const inviteJobTitle =
      typeof jobTitle === 'string' && jobTitle.trim().length > 0
        ? jobTitle.trim().slice(0, 80)
        : null

    const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.id, orgId) })
    if (!org) return NextResponse.json({ error: 'org not found' }, { status: 404 })

    // Seat-cap enforcement. Free tier hard-capped; paid tiers limited by
    // seatsPurchased. Count active memberships + outstanding (unaccepted,
    // unexpired) invites so we don't sell the same seat twice.
    const plan = planFor(org.plan)
    const effectiveCap = plan.seatCap ?? org.seatsPurchased
    const now = new Date()
    const [activeMembers, pendingInvites] = await Promise.all([
      db
        .select({ n: count() })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.orgId, orgId), isNull(schema.memberships.endedAt))),
      db
        .select({ n: count() })
        .from(schema.invites)
        .where(
          and(
            eq(schema.invites.orgId, orgId),
            isNull(schema.invites.acceptedAt),
          ),
        ),
    ])
    const usedSeats =
      Number(activeMembers[0]?.n ?? 0) + Number(pendingInvites[0]?.n ?? 0)
    void now
    if (usedSeats >= effectiveCap) {
      return NextResponse.json(
        {
          error: `Seat cap reached (${usedSeats}/${effectiveCap}).`,
          upgradeRequired: true,
          currentPlan: plan.key,
          recommendedPlan: plan.key === 'free' ? 'team' : 'scale',
        },
        { status: 402 },
      )
    }

    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)

    const [invite] = await db
      .insert(schema.invites)
      .values({
        orgId,
        email: normalizedEmail,
        role: role as Role,
        discipline: inviteDiscipline,
        jobTitle: inviteJobTitle,
        token,
        invitedBy: session.appUserId,
        expiresAt,
      })
      .returning()

    const inviteUrl = buildInviteUrl(req, token)
    const sendResult = await sendInviteEmail({
      to: normalizedEmail,
      inviteUrl,
      orgName: org.name,
      inviterLogin: session.login,
      role: invite.role,
    })

    return NextResponse.json({ ok: true, invite, inviteUrl, email: sendResult })
  } catch (err) {
    return errorResponse(err)
  }
}

function isAllowedRole(r: unknown): r is Role {
  return r === 'member' || r === 'manager' || r === 'admin'
}

function buildInviteUrl(req: Request, token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  return `${base.replace(/\/$/, '')}/invite/${token}`
}

function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  console.error('invites route failed', err)
  return NextResponse.json({ error: 'internal', message: String(err) }, { status: 500 })
}
