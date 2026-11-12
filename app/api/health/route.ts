import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cheap, public health probe. Returns:
 *   { ok, db, ai, version, uptimeSec, env }
 *
 * - `db`: ping the database with `SELECT 1` and a 2-second timeout
 * - `ai`: returns 'configured' if at least one provider key is set
 *
 * Plug this into an uptime monitor (UptimeRobot, BetterStack, Cronitor)
 * with a 1-minute check. Page on 2 consecutive failures.
 */
export async function GET(req: Request) {
  const started = Date.now()
  let dbStatus: 'ok' | 'fail' = 'fail'
  let dbError: string | null = null
  try {
    const ping = db.execute(sql`SELECT 1 as ok`)
    await Promise.race([
      ping,
      new Promise((_, reject) => setTimeout(() => reject(new Error('db timeout')), 2000)),
    ])
    dbStatus = 'ok'
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err)
  }

  const aiStatus =
    process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY
      ? 'configured'
      : 'missing'

  // Which auth providers are actually wired up AT RUNTIME (booleans only — no
  // secret values are ever returned). This is the fast way to diagnose the
  // GitHub "Configuration" sign-in error: if `auth.github` is false here on
  // prod, the env vars aren't reaching the running deployment (wrong Vercel
  // environment scope, or no redeploy after adding them). If it's true but
  // sign-in still errors, the problem is the GitHub OAuth App itself (callback
  // URL must be https://<host>/api/auth/callback/github, and it must be an
  // OAuth App, not the GitHub App).
  const authProviders = {
    github: !!(process.env.GITHUB_ID && process.env.GITHUB_SECRET),
    googleSso: !!(process.env.GOOGLE_SSO_CLIENT_ID && process.env.GOOGLE_SSO_CLIENT_SECRET),
    googleCalendar: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    secret: !!(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET),
  }

  // Log the real DB error server-side (where ops can see it) but NEVER return
  // it to the caller — Neon/pg error strings routinely embed the connection
  // string, host, role, and DB name. The public probe is intentionally terse.
  if (dbError) console.error('[health] db ping failed:', dbError)

  const ok = dbStatus === 'ok'

  // Detailed diagnostics are gated behind a shared secret so an uptime monitor
  // can still see them, but anonymous callers only get { ok, db, ai }.
  const url = new URL(req.url)
  const probeSecret = process.env.HEALTH_PROBE_SECRET
  const authorized =
    !!probeSecret &&
    (url.searchParams.get('token') === probeSecret ||
      req.headers.get('authorization') === `Bearer ${probeSecret}`)

  // Anonymous callers get liveness only; which providers are wired is a
  // reconnaissance hint, so it lives behind the probe secret too.
  const body: Record<string, unknown> = { ok, db: dbStatus }
  if (authorized) {
    body.ai = aiStatus
    body.auth = authProviders
    body.env = process.env.NODE_ENV ?? 'unknown'
    body.version = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev'
    body.durationMs = Date.now() - started
    body.dbError = dbError
  }
  return NextResponse.json(body, { status: ok ? 200 : 503 })
}
