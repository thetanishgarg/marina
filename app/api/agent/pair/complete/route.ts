import { NextResponse } from 'next/server'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import {
  generateAgentToken,
  hashPairingCode,
  normalizePairingCode,
} from '@/lib/agent/auth'
import { checkRateLimit } from '@/lib/auth/rate-limit'

export const runtime = 'nodejs'

type Body = {
  code?: string
  label?: string
  platform?: string
  agentVersion?: string
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const normalized = normalizePairingCode(body.code ?? '')
  if (normalized.length !== 8) {
    return NextResponse.json({ error: 'code must be 8 characters' }, { status: 400 })
  }
  const label = (body.label ?? 'Mac').toString().slice(0, 80) || 'Mac'
  const platform = (body.platform ?? 'darwin').toString().slice(0, 16) || 'darwin'
  const agentVersion = body.agentVersion ? String(body.agentVersion).slice(0, 32) : null

  // Brute-force guard: 8-char codes are ~40 bits, but an unthrottled endpoint
  // that matches ANY user's live code is still a target. Per-IP, durable.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown'
  const rl = await checkRateLimit(`pair_complete:${ip}`, 10, 10 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'too many attempts — wait a few minutes' }, { status: 429 })
  }

  const hash = hashPairingCode(normalized)

  try {
    // Find a matching pairing code that's unconsumed and unexpired.
    // ATOMIC single-use claim: flip consumedAt only if it's still null AND
    // unexpired, returning the row in the same statement. Two concurrent
    // completes of the same code now race on one UPDATE — exactly one gets a
    // row back; the other gets none (→ 410). The old find-then-update had a
    // window where both reads saw an unconsumed code and both minted a token.
    const claimed = await db
      .update(schema.pairingCodes)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(schema.pairingCodes.codeHash, hash),
          isNull(schema.pairingCodes.consumedAt),
          gt(schema.pairingCodes.expiresAt, new Date()),
        ),
      )
      .returning()
    const code = claimed[0]
    if (!code) {
      return NextResponse.json({ error: 'invalid or expired code' }, { status: 410 })
    }

    const user = await db.query.users.findFirst({ where: eq(schema.users.id, code.userId) })
    if (!user) {
      return NextResponse.json({ error: 'user not found' }, { status: 404 })
    }

    const { plaintext, hash: tokenHash, prefix } = generateAgentToken()

    const [token] = await db
      .insert(schema.agentTokens)
      .values({
        userId: user.id,
        tokenHash,
        tokenPrefix: prefix,
        label,
        platform,
        agentVersion: agentVersion ?? undefined,
        lastSeenAt: new Date(),
      })
      .returning()

    // Ensure the user has a settings row so pause/heartbeat work immediately.
    await db
      .insert(schema.userSettings)
      .values({
        userId: user.id,
        consentAt: new Date(),
        consentAgentVersion: agentVersion ?? undefined,
        consentPolicyVersion: process.env.MARINA_POLICY_VERSION ?? 'v1',
      })
      .onConflictDoUpdate({
        target: schema.userSettings.userId,
        set: {
          // Refresh consent timestamp when a new device pairs (proves explicit re-acceptance).
          consentAt: new Date(),
          consentAgentVersion: agentVersion ?? undefined,
          updatedAt: new Date(),
        },
      })

    return NextResponse.json({
      ok: true,
      token: plaintext,
      tokenPrefix: prefix,
      device: {
        id: token.id,
        label: token.label,
        platform: token.platform,
      },
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        email: user.email,
      },
      config: {
        sampleIntervalSeconds: 30,
        flushIntervalSeconds: 300,
        windowTitlesEnabled: false,
      },
    })
  } catch (err) {
    console.error('pair/complete failed', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
