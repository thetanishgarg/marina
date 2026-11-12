import { NextResponse } from 'next/server'
import { db, schema } from '@/lib/db/client'
import { authorizeCron } from '@/lib/cron/auth'
import { getSlackInstall, sendSlackChannel } from '@/lib/slack/client'
import { getTeamPulse } from '@/lib/brief/pulse'
import { detectEarlyWarnings } from '@/lib/brief/early-warnings'
import { and, eq, isNull } from 'drizzle-orm'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Morning brief → Slack. For every org that has the bot installed and a default
 * channel set, post the team pulse (on-shift / blocked / who to unblock first).
 * Orgs without Slack are skipped — so this is a safe no-op until a workspace is
 * connected. Schedule it alongside the email digest (e.g. 02:30 UTC weekdays).
 */
export async function GET(req: Request) {
  if (!authorizeCron(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return run()
}
export async function POST(req: Request) {
  if (!authorizeCron(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return run()
}

async function run() {
  const orgs = await db.select().from(schema.orgs)
  let posted = 0
  let skipped = 0

  for (const org of orgs) {
    if (!org.slackBotToken || !org.slackDefaultChannelId) {
      skipped++
      continue
    }
    const install = await getSlackInstall(org.id)
    if (!install) {
      skipped++
      continue
    }
    const pulse = await getTeamPulse(org.id)
    if (pulse.total === 0) {
      skipped++
      continue
    }

    // Each line cites the blocker record it came from so the brief is checkable.
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
    const blockersUrl = appUrl ? `${appUrl}/org/${org.id}/blockers` : ''
    const blockerLines = pulse.blockers
      .slice(0, 5)
      .map((b) => `• *${b.name}* — waiting on ${b.waitingOn} · ${b.sinceMin}m · ${blockersUrl ? `<${blockersUrl}|blocker-${b.breakId}>` : `blocker-${b.breakId}`}`)
      .join('\n')

    // Early warnings are inferred, not self-reported, and this posts to a team
    // channel — so the channel gets a COUNT and a link only. Names and evidence
    // stay on the manager's dashboard.
    const memberRows = await db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.orgId, org.id), isNull(schema.memberships.endedAt)))
    const warningCount = await detectEarlyWarnings({ orgId: org.id, userIds: memberRows.map((m) => m.userId) })
      .then((ws) => ws.length)
      .catch(() => 0)
    const dashboardUrl = appUrl ? `${appUrl}/org/${org.id}` : ''
    const warningLine =
      warningCount > 0
        ? `*Might get stuck*\n${warningCount} teammate${warningCount === 1 ? '' : 's'} may be waiting on something without having flagged it${dashboardUrl ? ` · <${dashboardUrl}|see the brief>` : ''}`
        : ''

    const blocks: unknown[] = [
      { type: 'header', text: { type: 'plain_text', text: 'Morning brief', emoji: true } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*On shift*\n${pulse.onShift}` },
          { type: 'mrkdwn', text: `*Blocked*\n${pulse.blocked}` },
          { type: 'mrkdwn', text: `*Team*\n${pulse.total}` },
        ],
      },
      ...(pulse.blockers.length
        ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Worth clearing first*\n${blockerLines}` } }]
        : []),
      ...(warningLine ? [{ type: 'section', text: { type: 'mrkdwn', text: warningLine } }] : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Marina · open the Home tab for your day' }] },
    ]

    const res = await sendSlackChannel(install, {
      text: `Morning brief — ${pulse.blocked} blocked, ${pulse.onShift} on-shift`,
      blocks,
    })
    if (res.ok) posted++
    else skipped++
  }

  return NextResponse.json({ ok: true, posted, skipped })
}
