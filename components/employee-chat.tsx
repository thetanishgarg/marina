'use client'

import { AskMarinaDock, type DockTurn } from './ask-marina-dock'

const PRESET_QUESTIONS = [
  'What did they ship in the last 7 days?',
  'Are there any active blockers?',
  'How many meetings did they have this week?',
  'How does their focus time compare to last week?',
  'Did they take any leaves recently?',
  'Are they at risk of burnout based on hours logged?',
]

/**
 * "Ask MARINA about <employee>" — thin wrapper over the shared right-side
 * AskMarinaDock. Grounded, per-employee chat for managers reading a profile.
 */
export function EmployeeChat({
  orgId,
  membershipId,
  employeeFirstName,
}: {
  orgId: number
  membershipId: number
  employeeFirstName: string
}) {
  return (
    <AskMarinaDock
      storageKey={`marina-chat:${orgId}:${membershipId}`}
      title={`Ask MARINA about ${employeeFirstName}`}
      launcherLabel={`Ask about ${employeeFirstName}`}
      grounding={`Grounded in ${employeeFirstName}'s last 30 days of shifts, breaks, deliverables, meetings, leaves, and GitHub activity.`}
      presets={PRESET_QUESTIONS}
      onAsk={async (question, history: DockTurn[]) => {
        const res = await fetch(`/api/orgs/${orgId}/members/${membershipId}/chat`, {
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
