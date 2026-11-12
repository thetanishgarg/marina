import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { chatAboutMe, type ChatTurn } from '@/lib/ai/my-chat'

export const runtime = 'nodejs'

/** Marina AI for the signed-in individual — grounded in their own work data. */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.appUserId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let question = ''
  let history: ChatTurn[] = []
  try {
    const body = (await req.json()) as { question?: string; history?: ChatTurn[] }
    question = (body.question ?? '').trim().slice(0, 1000)
    if (Array.isArray(body.history)) {
      history = body.history
        .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
        .slice(-8)
    }
  } catch {
    /* invalid body */
  }
  if (!question) return NextResponse.json({ error: 'question_required' }, { status: 400 })

  try {
    const result = await chatAboutMe({ userId: session.appUserId, history, question })
    return NextResponse.json({
      ok: true,
      answer: result.answer,
      claims: result.claims,
      sources: result.sources,
      grounded: result.grounded,
      droppedClaims: result.droppedClaims,
      provider: result.provider,
      model: result.model,
    })
  } catch (err) {
    console.error('me/chat failed', err)
    return NextResponse.json({ error: 'chat_failed' }, { status: 500 })
  }
}
