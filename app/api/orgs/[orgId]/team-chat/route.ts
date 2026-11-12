import { NextResponse } from 'next/server'
import { HttpError, requireMembership, roleAtLeast } from '@/lib/auth/guards'
import { getVisibleScope } from '@/lib/auth/scope'
import { chatAboutTeam } from '@/lib/ai/team-chat'
import type { ChatTurn } from '@/lib/ai/employee-chat'
import { canSpend, estimateCostCents, recordSpend } from '@/lib/ai/budget'
import { trackEvent } from '@/lib/analytics/track'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * "Ask MARINA about this team" — team-level grounded chat.
 *
 * Scope is enforced via the SAME `getVisibleScope` that gates every other
 * surface: a manager can only ask about people they're allowed to see; an
 * admin / HR (view_all_data) gets the whole org. We pass that exact userId set
 * into the grounding builder, so the model never sees anyone out of scope.
 */
export async function POST(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId: rawO } = await ctx.params
  const orgId = Number(rawO)
  if (!Number.isInteger(orgId)) {
    return NextResponse.json({ error: 'invalid org id' }, { status: 400 })
  }

  let body: { question?: string; history?: ChatTurn[] }
  try {
    body = (await req.json()) ?? {}
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const question = (body.question ?? '').trim()
  if (question.length < 2) {
    return NextResponse.json({ error: 'question required' }, { status: 400 })
  }
  if (question.length > 1000) {
    return NextResponse.json(
      { error: 'Question is too long. Keep it under 1000 characters.' },
      { status: 400 },
    )
  }
  const history: ChatTurn[] = Array.isArray(body.history) ? body.history : []

  try {
    const viewer = await requireMembership(orgId, 'manager')
    if (!roleAtLeast(viewer.membership.role, 'manager')) {
      return NextResponse.json(
        { error: 'Only managers and admins can use the team chat.' },
        { status: 403 },
      )
    }

    const scope = await getVisibleScope(orgId, {
      userId: viewer.session.appUserId,
      membershipId: viewer.membership.id,
      role: viewer.membership.role as 'admin' | 'manager' | 'lead' | 'member',
    })

    const decision = await canSpend(orgId, 'employee_chat')
    if (!decision.allowed) {
      return NextResponse.json(
        {
          error:
            'AI budget for this workspace is exhausted for the month. Raise the limit in Settings → Billing.',
        },
        { status: 402 },
      )
    }

    const result = await chatAboutTeam({
      orgId,
      userIds: Array.from(scope.userIds),
      history,
      question,
    })

    const inputTokens = Math.ceil(result.contextBytes / 4)
    const outputTokens = Math.ceil(result.answer.length / 4)
    const costCents = estimateCostCents({
      kind: 'employee_chat',
      provider: result.provider,
      model: result.model,
      inputTokens,
      outputTokens,
    })
    recordSpend({
      orgId,
      userId: viewer.session.appUserId,
      kind: 'employee_chat',
      provider: result.provider,
      model: result.model,
      inputTokens,
      outputTokens,
      costCents,
    })

    trackEvent({
      kind: 'profile.opened',
      orgId,
      userId: viewer.session.appUserId,
      payload: { teamChat: true, questionLength: question.length, answerLength: result.answer.length, provider: result.provider },
    })

    return NextResponse.json({
      answer: result.answer,
      claims: result.claims,
      sources: result.sources,
      grounded: result.grounded,
      droppedClaims: result.droppedClaims,
      provider: result.provider,
      model: result.model,
    })
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[team-chat] failed', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'internal' }, { status: 500 })
  }
}
