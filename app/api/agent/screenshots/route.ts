import { NextResponse } from 'next/server'
import { and, desc, eq, gte, isNull } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { authenticateAgent } from '@/lib/agent/auth'
import { checkLimit, rateLimitHeaders } from '@/lib/agent/rate-limit'
import { getBlobStore, shotKey } from '@/lib/storage/blob'
import { getVisionProvider, progressScore } from '@/lib/ai/vision'
import { canSpend, estimateCostCents, recordSpend } from '@/lib/ai/budget'
import { log } from '@/lib/log/log'
import { SCREENSHOTS_ENABLED } from '@/lib/flags'
import type { VisionAnalysis } from '@/lib/ai/vision'

export const runtime = 'nodejs'

// Generous server-side cap — at q70 / 1280px wide we expect <200KB JPEG bytes.
const MAX_JPEG_BYTES = 1_500_000
const RETENTION_MS = 48 * 60 * 60 * 1000

type Body = {
  capturedAt?: string
  displayIndex?: number
  jpegBase64?: string
}

export async function POST(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // GATEKEPT: screenshot capture/analysis is disabled for now. We still 200 so
  // any older agent that posts treats it like a pause (no error/retry storm)
  // and uploads nothing further. Everything below is preserved, just unreached.
  if (!SCREENSHOTS_ENABLED) {
    return NextResponse.json({ ok: true, discarded: true, disabled: true })
  }

  const limit = checkLimit('screenshots', agent.token.id)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'rate limited', resetSeconds: Math.ceil(limit.resetMs / 1000) },
      { status: 429, headers: rateLimitHeaders(limit) }
    )
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : null
  if (!capturedAt || !Number.isFinite(capturedAt.getTime())) {
    return NextResponse.json({ error: 'capturedAt required (ISO 8601)' }, { status: 400 })
  }
  const now = Date.now()
  if (now - capturedAt.getTime() > RETENTION_MS) {
    return NextResponse.json({ error: 'capturedAt too old' }, { status: 400 })
  }
  if (capturedAt.getTime() - now > 60_000) {
    return NextResponse.json({ error: 'capturedAt in the future' }, { status: 400 })
  }

  if (!body.jpegBase64 || typeof body.jpegBase64 !== 'string') {
    return NextResponse.json({ error: 'jpegBase64 required' }, { status: 400 })
  }
  let jpeg: Buffer
  try {
    jpeg = Buffer.from(body.jpegBase64, 'base64')
  } catch {
    return NextResponse.json({ error: 'invalid base64' }, { status: 400 })
  }
  if (jpeg.byteLength === 0 || jpeg.byteLength > MAX_JPEG_BYTES) {
    return NextResponse.json({ error: 'invalid jpeg size' }, { status: 413 })
  }
  // Quick magic-bytes check — first bytes of JPEG are FF D8 FF.
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) {
    return NextResponse.json({ error: 'not a JPEG' }, { status: 400 })
  }

  const settings = await db.query.userSettings.findFirst({
    where: eq(schema.userSettings.userId, agent.user.id),
  })

  // Consent gate (DPDP): never store or send a capture to vision unless the
  // user's recorded consent matches the CURRENT policy version. Pairing writes
  // consentAt/consentPolicyVersion; bumping MARINA_POLICY_VERSION invalidates
  // it until the agent re-prompts and the device re-pairs.
  const currentPolicy = process.env.MARINA_POLICY_VERSION ?? 'v1'
  if (!settings?.consentAt || settings.consentPolicyVersion !== currentPolicy) {
    log.info('agent.shot.no_consent_discard', { userId: agent.user.id, tokenId: agent.token.id })
    return NextResponse.json(
      { error: 'screenshot consent missing for the current policy version' },
      { status: 403, headers: rateLimitHeaders(limit) },
    )
  }

  if (settings?.trackingPausedAt) {
    log.info('agent.shot.paused_discard', {
      userId: agent.user.id,
      tokenId: agent.token.id,
    })
    return NextResponse.json(
      {
        ok: true,
        discarded: true,
        pausedAt: settings.trackingPausedAt.toISOString(),
      },
      { headers: rateLimitHeaders(limit) }
    )
  }

  const blob = getBlobStore()
  const key = shotKey(agent.user.id, capturedAt)
  let storedKey: string
  let storedDriver: string
  try {
    const putRes = await blob.put(key, jpeg, 'image/jpeg')
    storedKey = putRes.key
    storedDriver = putRes.driver
  } catch (err) {
    log.error('agent.shot.blob_put_failed', {
      userId: agent.user.id,
      err: String(err),
    })
    return NextResponse.json({ error: 'storage failed' }, { status: 502 })
  }

  const [shotRow] = await db
    .insert(schema.screenshots)
    .values({
      userId: agent.user.id,
      agentTokenId: agent.token.id,
      capturedAt,
      storageKey: storedKey,
      storageDriver: storedDriver,
      displayIndex: typeof body.displayIndex === 'number' ? body.displayIndex : 0,
      mime: 'image/jpeg',
      sizeBytes: jpeg.byteLength,
      expiresAt: new Date(capturedAt.getTime() + RETENTION_MS),
    })
    .returning()

  // Resolve the user's org so spend can be charged to it.
  const firstMembership = await db.query.memberships.findFirst({
    where: and(eq(schema.memberships.userId, agent.user.id), isNull(schema.memberships.endedAt)),
  })
  const orgIdForBudget = firstMembership?.orgId ?? null

  // Inline vision. Best-effort: if it fails, we still keep the screenshot and
  // a stagnation engine pass can re-analyze later.
  let analysisOut: VisionAnalysis | null = null
  try {
    if (!process.env.OPENAI_API_KEY) {
      log.warn('agent.shot.vision_skipped_no_key', { userId: agent.user.id })
    } else if (!(await canSpend(orgIdForBudget, 'vision')).allowed) {
      // Budget exhausted — skip vision but keep the screenshot. The "no analysis"
      // case is already handled downstream (focus ratio dampens to neutral).
      log.warn('agent.shot.vision_skipped_budget', { userId: agent.user.id, orgId: orgIdForBudget })
    } else {
      const provider = getVisionProvider()
      const visionRes = await provider.analyze({ bytes: jpeg, mime: 'image/jpeg' })

      recordSpend({
        orgId: orgIdForBudget,
        userId: agent.user.id,
        kind: 'vision',
        provider: visionRes.provider,
        model: visionRes.model,
        imageCount: 1,
        costCents: estimateCostCents({
          kind: 'vision',
          provider: visionRes.provider,
          model: visionRes.model,
          imageCount: 1,
        }),
      })

      // Find the most recent prior analysis for this user within the last 90 min.
      const since = new Date(capturedAt.getTime() - 90 * 60 * 1000)
      const prev = await db
        .select()
        .from(schema.shotAnalyses)
        .where(
          and(
            eq(schema.shotAnalyses.userId, agent.user.id),
            gte(schema.shotAnalyses.analyzedAt, since)
          )
        )
        .orderBy(desc(schema.shotAnalyses.analyzedAt))
        .limit(1)
        .then((rows) => rows[0])

      const score = progressScore(
        prev
          ? {
              appCategory: prev.appCategory,
              visibleContentHint: prev.visibleContentHint,
              workAppLabel: prev.workAppLabel,
            }
          : null,
        visionRes.analysis
      )

      await db.insert(schema.shotAnalyses).values({
        screenshotId: shotRow.id,
        userId: agent.user.id,
        workAppLabel: visionRes.analysis.workAppLabel,
        appCategory: visionRes.analysis.appCategory,
        visibleContentHint: visionRes.analysis.visibleContentHint,
        confidence: Math.round(visionRes.analysis.confidence * 100),
        progressScore: Math.round(score * 100),
        provider: visionRes.provider,
        model: visionRes.model,
        rawJson: { text: visionRes.raw },
      })
      analysisOut = visionRes.analysis
    }
  } catch (err) {
    log.error('agent.shot.vision_failed', {
      userId: agent.user.id,
      err: String(err),
    })
  }

  return NextResponse.json(
    {
      ok: true,
      screenshotId: shotRow.id,
      analysis: analysisOut,
      pausedAt: null,
    },
    { headers: rateLimitHeaders(limit) }
  )
}
