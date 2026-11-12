import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { authenticateAgent } from '@/lib/agent/auth'
import { checkLimit, rateLimitHeaders } from '@/lib/agent/rate-limit'
import { log } from '@/lib/log/log'
import type { NewLocalActivity } from '@/lib/db/schema'

export const runtime = 'nodejs'

const MAX_BATCH = 200
// The agent's durable queue holds up to ~17 days of batches so a laptop that
// was offline over a weekend (or a long trip) can catch up. Rejecting
// anything older than 24h silently threw that data away. 14 days keeps the
// guard against garbage timestamps while honouring the offline promise.
const MAX_WINDOW_AGE_MS = 14 * 24 * 60 * 60 * 1000
const MAX_APP_LEN = 128
const MAX_TITLE_LEN = 512

type IncomingBatch = {
  windowStart?: string
  windowEnd?: string
  activeApp?: string
  activeSeconds?: number
  idleSeconds?: number
  lockedSeconds?: number
  sampleCount?: number
  windowTitle?: string | null
}

export async function POST(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const limit = checkLimit('events', agent.token.id)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate limited', resetSeconds: Math.ceil(limit.resetMs / 1000) },
      { status: 429, headers: rateLimitHeaders(limit) }
    )
  }

  let body: { batches?: IncomingBatch[]; agentVersion?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (!Array.isArray(body.batches)) {
    return NextResponse.json({ error: 'batches[] required' }, { status: 400 })
  }
  if (body.batches.length > MAX_BATCH) {
    return NextResponse.json({ error: `batch size > ${MAX_BATCH}` }, { status: 413 })
  }

  // Update agentVersion if changed.
  if (body.agentVersion && body.agentVersion !== agent.token.agentVersion) {
    void db
      .update(schema.agentTokens)
      .set({ agentVersion: String(body.agentVersion).slice(0, 32) })
      .where(eq(schema.agentTokens.id, agent.token.id))
      .catch((err) => console.error('agentVersion update failed', err))
  }

  const settings = await db.query.userSettings.findFirst({
    where: eq(schema.userSettings.userId, agent.user.id),
  })

  // Respect pause: discard the batch entirely, surface state to the agent.
  if (settings?.trackingPausedAt) {
    log.info('agent.events.paused_discard', {
      userId: agent.user.id,
      tokenId: agent.token.id,
      discarded: body.batches.length,
    })
    return NextResponse.json(
      {
        ok: true,
        discarded: body.batches.length,
        pausedAt: settings.trackingPausedAt.toISOString(),
      },
      { headers: rateLimitHeaders(limit) }
    )
  }

  const allowWindowTitles = !!settings?.windowTitlesEnabled
  const now = Date.now()
  const rows: NewLocalActivity[] = []
  const rejected: Array<{ index: number; reason: string }> = []

  body.batches.forEach((b, i) => {
    const start = b.windowStart ? Date.parse(b.windowStart) : NaN
    const end = b.windowEnd ? Date.parse(b.windowEnd) : NaN
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      rejected.push({ index: i, reason: 'bad window' })
      return
    }
    if (now - end > MAX_WINDOW_AGE_MS) {
      rejected.push({ index: i, reason: 'too old' })
      return
    }
    if (end - now > 60_000) {
      rejected.push({ index: i, reason: 'future window' })
      return
    }
    const activeApp = String(b.activeApp ?? '').trim().slice(0, MAX_APP_LEN)
    if (!activeApp) {
      rejected.push({ index: i, reason: 'missing activeApp' })
      return
    }
    const activeSeconds = clampInt(b.activeSeconds, 0, 24 * 60 * 60)
    const idleSeconds = clampInt(b.idleSeconds, 0, 24 * 60 * 60)
    const lockedSeconds = clampInt(b.lockedSeconds, 0, 24 * 60 * 60)
    const sampleCount = clampInt(b.sampleCount, 1, 10_000)
    let windowTitle: string | null = null
    if (allowWindowTitles && typeof b.windowTitle === 'string') {
      windowTitle = b.windowTitle.trim().slice(0, MAX_TITLE_LEN) || null
    }
    rows.push({
      userId: agent.user.id,
      agentTokenId: agent.token.id,
      windowStart: new Date(start),
      windowEnd: new Date(end),
      activeApp,
      activeSeconds,
      idleSeconds,
      lockedSeconds,
      sampleCount,
      windowTitle,
    })
  })

  if (rows.length > 0) {
    await db.insert(schema.localActivity).values(rows)
  }

  log.info('agent.events', {
    userId: agent.user.id,
    tokenId: agent.token.id,
    inserted: rows.length,
    rejected: rejected.length,
  })

  return NextResponse.json(
    {
      ok: true,
      inserted: rows.length,
      rejected,
      pausedAt: null,
      windowTitlesEnabled: allowWindowTitles,
    },
    { headers: rateLimitHeaders(limit) }
  )
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? Math.floor(v) : 0
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}
