import { NextResponse } from 'next/server'
import { asc, eq, gt } from 'drizzle-orm'
import { db, schema } from '@/lib/db/client'
import { authorizeCron } from '@/lib/cron/auth'
import { buildStory } from '@/lib/engine/story'
import { log } from '@/lib/log/log'
import { chainCron } from '@/lib/cron/chain'

export const runtime = 'nodejs'
export const maxDuration = 300

const BATCH_SIZE = 15           // soft cap per invocation
const TIME_BUDGET_MS = 240_000  // hard cap (4 min) so we don't trip maxDuration
const JOB = 'stories:yesterday'

type Cursor = { day: string; lastUserId: number }

/**
 * Nightly story generator. Resumable: each invocation processes up to
 * BATCH_SIZE users or until TIME_BUDGET_MS elapses, then writes a cursor.
 * Vercel cron fires this once nightly; for orgs with hundreds of employees
 * you should add a "chain" mechanism (e.g. self-call after finish, or
 * run from an Inngest fan-out).
 *
 * Idempotent: `buildStory` upserts on (userId, day).
 */
export async function GET(req: Request) {
  if (!authorizeCron(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return run(req)
}
export async function POST(req: Request) {
  if (!authorizeCron(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return run(req)
}

async function run(req: Request) {
  const started = Date.now()

  // Resolve "yesterday in UTC" once per invocation so we don't drift mid-run.
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const todayKey = isoDay(yesterday)

  // Read cursor (if any). If the day differs, start fresh.
  const cursorRow = await db.query.jobCursors.findFirst({
    where: eq(schema.jobCursors.job, JOB),
  })
  let prevCursor: Cursor | null = null
  try {
    if (cursorRow?.cursor) prevCursor = JSON.parse(cursorRow.cursor) as Cursor
  } catch {
    prevCursor = null
  }
  const startAfterId =
    prevCursor && prevCursor.day === todayKey ? prevCursor.lastUserId : 0

  // Pull the next slice of users.
  // Process batches until the user table is drained or the time budget runs
  // out (previously: ONE batch per day, so big orgs never finished).
  let processed = 0
  let lastUserId = startAfterId
  let drained = false
  const errors: Array<{ userId: number; error: string }> = []

  outer: while (Date.now() - started < TIME_BUDGET_MS) {
    const users = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(gt(schema.users.id, lastUserId))
      .orderBy(asc(schema.users.id))
      .limit(BATCH_SIZE)
    if (users.length === 0) {
      drained = true
      break
    }
    for (const u of users) {
      if (Date.now() - started > TIME_BUDGET_MS) break outer
      try {
        await buildStory(u.id, yesterday)
        processed++
      } catch (err) {
        errors.push({ userId: u.id, error: String(err) })
        log.error('cron.stories.user_failed', { userId: u.id, err: String(err) })
      }
      lastUserId = u.id
    }
    if (users.length < BATCH_SIZE) {
      drained = true
      break
    }
  }
  const nextCursor: Cursor = drained
    ? { day: todayKey, lastUserId: 0 }
    : { day: todayKey, lastUserId }

  await db
    .insert(schema.jobCursors)
    .values({ job: JOB, cursor: JSON.stringify(nextCursor), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.jobCursors.job,
      set: { cursor: JSON.stringify(nextCursor), updatedAt: new Date() },
    })

  const chained = drained ? false : chainCron(req, 'stories')

  log.info('cron.stories.done', {
    processed,
    errors: errors.length,
    drained,
    chained,
    durationMs: Date.now() - started,
  })

  return NextResponse.json({
    ok: true,
    processed,
    errors,
    drained,
    nextCursor,
    elapsedMs: Date.now() - started,
  })
}

function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
