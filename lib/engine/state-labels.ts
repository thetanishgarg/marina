import type { DailyState } from '@/lib/db/schema'

/**
 * Display wording for the stored daily states. The database values
 * ('PossiblyDummying', 'Disengaged', …) are unchanged; this is the ONLY place
 * that decides what a person reads. Managers and the employee themselves get
 * the same label and the same explanation, so nobody is described in words
 * they cannot see.
 *
 * Client-safe: no database imports.
 */
export type StateTone = 'good' | 'steady' | 'blocked' | 'checkin' | 'none'

export const STATE_DISPLAY: Record<DailyState, { label: string; tone: StateTone; meaning: string }> = {
  High: { label: 'High output', tone: 'good', meaning: 'Work was shipped today and the activity signals agree.' },
  Steady: { label: 'Steady', tone: 'steady', meaning: 'A normal working day with nothing that needs attention.' },
  Blocked: {
    label: 'Blocked',
    tone: 'blocked',
    meaning: 'Time was spent on work but nothing shipped yet, which often means waiting on something or someone.',
  },
  Disengaged: {
    label: 'Needs a check-in',
    tone: 'checkin',
    meaning: 'The signals for today are quiet. This is a prompt for a supportive conversation, not a conclusion about effort.',
  },
  PossiblyDummying: {
    label: 'Needs a check-in',
    tone: 'checkin',
    meaning: 'The activity signals for today disagree with each other. This is a prompt for a supportive conversation, not a conclusion about effort.',
  },
  NoData: { label: 'No signal', tone: 'none', meaning: 'There is no activity data for today yet.' },
}

/** Label for a stored state value; unknown values fall back to "No signal". */
export function stateLabel(state: string | null | undefined): string {
  return (STATE_DISPLAY as Record<string, { label: string }>)[state ?? '']?.label ?? STATE_DISPLAY.NoData.label
}

/** True for the states shown as "Needs a check-in". */
export function needsCheckIn(state: string | null | undefined): boolean {
  return state === 'Disengaged' || state === 'PossiblyDummying'
}
