import { EventEmitter } from 'events'
import { DEFAULT_SERVER_BASE_URL } from './config'

export type ActiveBreak = {
  id: number
  startedAt: string
  reason: string
}

export type TodaySnapshot = {
  punchedIn: boolean
  productivity: number
  focusMinutes: number
  deliverablesToday: number
  meetingsRemainingToday: number
  nextMeetingAt: string | null
  nextMeetingTitle: string | null
}

export type ActiveShift = {
  id: number
  punchedInAt: string
}

export type AgentState = {
  paired: boolean
  paused: boolean
  windowTitlesEnabled: boolean
  sampleIntervalSeconds: number
  flushIntervalSeconds: number
  userLogin: string | null
  serverBaseUrl: string
  lastHeartbeatAt: Date | null
  lastFlushAt: Date | null
  pendingCount: number
  lastError: string | null
  primaryOrgId: number | null
  activeBreak: ActiveBreak | null
  activeShift: ActiveShift | null
  today: TodaySnapshot | null
}

class StateBus extends EventEmitter {
  private state: AgentState = {
    paired: false,
    paused: false,
    windowTitlesEnabled: false,
    sampleIntervalSeconds: 30,
    flushIntervalSeconds: 300,
    userLogin: null,
    // Default to whatever config.ts resolves — the prod domain in packaged
    // builds, http://localhost:3000 when unpackaged (dev), or MARINA_SERVER_URL
    // if set. Once the user pairs, the serverBaseUrl they typed in the pairing
    // dialog is persisted to the encrypted store and overrides this on boot.
    serverBaseUrl: DEFAULT_SERVER_BASE_URL,
    lastHeartbeatAt: null,
    lastFlushAt: null,
    pendingCount: 0,
    lastError: null,
    primaryOrgId: null,
    activeBreak: null,
    activeShift: null,
    today: null,
  }

  get(): Readonly<AgentState> {
    return this.state
  }

  patch(patch: Partial<AgentState>): void {
    let changed = false
    for (const k of Object.keys(patch) as Array<keyof AgentState>) {
      const v = patch[k]
      if (this.state[k] !== v) {
        ;(this.state as Record<string, unknown>)[k] = v as unknown
        changed = true
      }
    }
    if (changed) this.emit('change', this.state)
  }
}

export const bus = new StateBus()
