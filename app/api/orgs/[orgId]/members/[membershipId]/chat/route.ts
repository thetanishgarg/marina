import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { HttpError, requireMembership, roleAtLeast } from '@/lib/auth/guards'
import { getVisibleScope } from '@/lib/auth/scope'
import { chatAboutEmployee, type ChatTurn } from '@/lib/ai/employee-chat'
import { canSpend, estimateCostCents, recordSpend } from '@/lib/ai/budget'
import { trackEvent } from '@/lib/analytics/track'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * "Ask MARINA about this employee" — chat endpoint.
 *
 * Hard rules:
 *   - Only managers / admins. Plain members can't query teammates.
 *   - Manager can only ask about people in their visible scope. We re-use
 *     the same `getVisibleScope` helper that gates every other surface, so
 *     leaks are impossible at this layer.
 *   - Per-org AI budget applies. If the org has burned through its monthly
 *     allowance, requests are 402'd with a clear message.
 *   - Conversation history is supplied by the client; we don't store it on
 *     the server. The model only sees the last 6 turns plus the new
 *     question (history is trimmed inside `chatAboutEmployee`).
 *
 * Request body:
 *   {
 *     question: string,     // the manager's question
 *     history?: ChatTurn[]  // prior turns from this session
 *   }
 *
 * Response:
 *   {
 *     answer: string,
 *     claims: { text, sources: string[] }[],   // each claim + the source ids it cites
 *     sources: { id, kind, label, url?, date? }[],
 *     grounded: boolean, droppedClaims: number,
 *     provider: 'gemini' | 'groq' | 'openai',
 *     model: string,
 *     usage: { contextBytes }
 *   }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ orgId: string; membershipId: string }> },
) {
  const { orgId: rawO, membershipId: rawM } = await ctx.params
  const orgId = Number(rawO)
  const membershipId = Number(rawM)
  if (!Number.isInteger(orgId) || !Number.isInteger(membershipId)) {
    return NextResponse.json({ error: 'invalid ids' }, { status: 400 })
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

    // Plain members already filtered by requireMembership('manager'), but
    // we double-check role hierarchy here so leads (read-only) can ask too.
    if (!roleAtLeast(viewer.membership.role, 'manager')) {
      return NextResponse.json(
        { error: 'Only managers and admins can use the employee chat.' },
        { status: 403 },
      )
    }

    // Find the target membership + user.
    const target = await db.query.memberships.findFirst({
      where: and(
        eq(schema.memberships.id, membershipId),
        eq(schema.memberships.orgId, orgId),
        isNull(schema.memberships.endedAt),
      ),
    })
    if (!target) {
      return NextResponse.json({ error: 'member not found' }, { status: 404 })
    }

    // Scope check — same helper that gates the profile page.
    const scope = await getVisibleScope(orgId, {
      userId: viewer.session.appUserId,
      membershipId: viewer.membership.id,
      role: viewer.membership.role as 'admin' | 'manager' | 'lead' | 'member',
    })
    if (!scope.isAdminScope && !scope.userIds.has(target.userId)) {
      // Don't leak existence — same 404 as missing.
      return NextResponse.json({ error: 'member not found' }, { status: 404 })
    }

    // AI budget gate — refuse if the org has exhausted its monthly cap.
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

    const result = await chatAboutEmployee({
      orgId,
      userId: target.userId,
      membershipId,
      history,
      question,
    })

    // Record actual usage so the per-org AI cost dashboard stays accurate.
    // Approximation: most providers don't echo token counts back on chat
    // completions, so we estimate from byte length / 4 — close enough for
    // budget tracking, since the cap is per-org per-month, not per-call.
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
      kind: 'profile.opened', // closest existing kind; consider 'employee_chat.message' next
      orgId,
      userId: viewer.session.appUserId,
      payload: {
        targetMembershipId: membershipId,
        questionLength: question.length,
        answerLength: result.answer.length,
        provider: result.provider,
      },
    })

    return NextResponse.json({
      answer: result.answer,
      claims: result.claims,
      sources: result.sources,
      grounded: result.grounded,
      droppedClaims: result.droppedClaims,
      provider: result.provider,
      model: result.model,
      usage: { contextBytes: result.contextBytes },
    })
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[employee-chat] failed', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'internal' },
      { status: 500 },
    )
  }
}
