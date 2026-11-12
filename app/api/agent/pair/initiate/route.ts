import { NextResponse } from 'next/server'
import { db, schema } from '@/lib/db/client'
import { HttpError, requireSession } from '@/lib/auth/guards'
import { generatePairingCode } from '@/lib/agent/auth'
import { checkRateLimit } from '@/lib/auth/rate-limit'

export const runtime = 'nodejs'

const CODE_TTL_MS = 10 * 60 * 1000

export async function POST() {
  try {
    const session = await requireSession()
    // Durable (Postgres) limit — the in-memory agent limiter resets on every
    // serverless instance, so it can't protect code minting.
    const rl = await checkRateLimit(`pair_code:${session.appUserId}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many pairing codes. Try again in a few minutes.' },
        { status: 429, headers: { 'retry-after': String(Math.ceil((rl.resetAtMs - Date.now()) / 1000)) } },
      )
    }
    const { plaintext, hash } = generatePairingCode()
    const expiresAt = new Date(Date.now() + CODE_TTL_MS)
    const [row] = await db
      .insert(schema.pairingCodes)
      .values({ userId: session.appUserId, codeHash: hash, expiresAt })
      .returning()

    return NextResponse.json({
      ok: true,
      code: plaintext,
      expiresAt: row.expiresAt.toISOString(),
      ttlSeconds: Math.floor(CODE_TTL_MS / 1000),
    })
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('pair/initiate failed', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
