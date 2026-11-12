import { getSlackInstall, sendSlackDm } from '@/lib/slack/client'
import { resolveSlackActor } from '@/lib/slack/identity'
import { roleAtLeast } from '@/lib/auth/guards'
import { getVisibleScope } from '@/lib/auth/scope'
import { chatAboutEmployee } from '@/lib/ai/employee-chat'
import { chatAboutTeam } from '@/lib/ai/team-chat'
import type { CitedAnswer } from '@/lib/ai/citations'

/**
 * "Ask Marina" inside Slack. A DM (or @mention) to the bot is treated as a
 * question. Managers/leads get the team-scoped answer (bounded by their
 * visible RBAC scope); members get an answer about their own work only. Reuses
 * the exact same grounded chat engines the web dashboard uses — no new AI.
 */
export async function handleAssistantMessage(
  teamId: string,
  slackUserId: string,
  text: string,
): Promise<void> {
  const question = (text ?? '').trim()
  if (!question) return

  const actor = await resolveSlackActor(teamId, slackUserId)
  if (!actor) return // can't answer for someone we can't identify / scope
  const install = await getSlackInstall(actor.org.id)
  if (!install) return

  try {
    let answer: string
    if (roleAtLeast(actor.membership.role, 'lead')) {
      const scope = await getVisibleScope(actor.org.id, {
        userId: actor.user.id,
        membershipId: actor.membership.id,
        role: actor.membership.role,
      })
      const res = await chatAboutTeam({
        orgId: actor.org.id,
        userIds: [...scope.userIds],
        history: [],
        question,
      })
      answer = withSlackSources(res)
    } else {
      const res = await chatAboutEmployee({
        orgId: actor.org.id,
        userId: actor.user.id,
        membershipId: actor.membership.id,
        history: [],
        question,
      })
      answer = withSlackSources(res)
    }
    const trimmed = answer.slice(0, 2900)
    await sendSlackDm(install, slackUserId, {
      text: trimmed,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: trimmed } }],
    })
  } catch {
    await sendSlackDm(install, slackUserId, {
      text: "I couldn't get to that just now — try again in a moment.",
    })
  }
}

/** Append the cited source items so a Slack answer can be checked too. */
function withSlackSources(res: CitedAnswer): string {
  if (res.sources.length === 0) return res.answer
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const lines = res.sources.slice(0, 8).map((s) => {
    const url = s.url ? (/^https?:\/\//.test(s.url) ? s.url : base ? `${base}${s.url}` : '') : ''
    const label = s.label.replace(/[<>|]/g, ' ')
    return url ? `• <${url}|${label}> (${s.id})` : `• ${label} (${s.id})`
  })
  return `${res.answer}\n\n*Sources*\n${lines.join('\n')}`
}
