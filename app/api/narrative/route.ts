import { isProviderName } from '@/lib/ai/registry'
import { NextResponse } from 'next/server'
import { and, eq, gte } from 'drizzle-orm'
import { auth } from '@/auth'
import { db, schema } from '@/lib/db/client'
import { buildNarrativeMessages, parseNarrative } from '@/lib/ai/narrative-prompt'
import { generateWithFallback } from '@/lib/ai/registry'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.appUserId || !session.login) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const providerParam = url.searchParams.get('provider')
  const preferred = isProviderName(providerParam) ? providerParam : undefined

  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000)

  const events = await db
    .select()
    .from(schema.githubEvents)
    .where(and(eq(schema.githubEvents.userId, session.appUserId), gte(schema.githubEvents.occurredAt, periodStart)))

  const messages = buildNarrativeMessages({
    userLogin: session.login,
    periodStart,
    periodEnd,
    events,
  })

  try {
    const result = await generateWithFallback(messages, { responseFormat: 'json', temperature: 0.5 }, preferred)
    const parsed = parseNarrative(result.text)

    const [saved] = await db
      .insert(schema.narratives)
      .values({
        userId: session.appUserId,
        periodStart,
        periodEnd,
        body: parsed.body,
        signal: parsed.signal,
        blockers: parsed.blockers,
        provider: result.provider,
        model: result.model,
      })
      .returning()

    return NextResponse.json({ ok: true, narrative: saved })
  } catch (err) {
    console.error('narrative failed', err)
    return NextResponse.json({ error: 'narrative failed', message: String(err) }, { status: 500 })
  }
}
