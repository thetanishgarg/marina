'use client'

import { AskMarinaDock, type DockTurn } from './ask-marina-dock'

const TEAM_PRESETS = [
  'How is the team doing this week?',
  'Who is blocked right now?',
  'Who shipped the most in the last 2 weeks?',
  'Who is on leave or has leave coming up?',
  'Is anyone logging unusually high hours?',
  'Who has been quiet — low output recently?',
]

/**
 * "Ask MARINA about this team" — the team-level chat dock. Mounted on the team
 * dashboard so a manager/admin can ask about the whole team (scoped to who
 * they can see) and drill into any individual contributor.
 */
export function TeamChat({ orgId, teamLabel = 'your team' }: { orgId: number; teamLabel?: string }) {
  return (
    <AskMarinaDock
      storageKey={`marina-team-chat:${orgId}`}
      title="Ask MARINA about the team"
      launcherLabel="Ask MARINA AI"
      grounding={`Grounded in the last 14 days of shifts, output, blockers and leaves across ${teamLabel}. Answers about the team and any individual in it.`}
      presets={TEAM_PRESETS}
      onAsk={async (question, history: DockTurn[]) => {
        const res = await fetch(`/api/orgs/${orgId}/team-chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            history: history.map((t) => ({ role: t.role, content: t.content })),
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          return { error: data?.error || 'Something went wrong on our side. Try again in a moment.' }
        }
        return { answer: data.answer, provider: data.provider, claims: data.claims, sources: data.sources, droppedClaims: data.droppedClaims }
      }}
    />
  )
}
