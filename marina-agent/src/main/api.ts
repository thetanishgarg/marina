import { AGENT_VERSION } from './config'
import { readToken } from './store'
import { bus } from './state'
import type { PendingBatch } from './store'

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message)
  }
}

function headers(token?: string | null): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': `marina-agent/${AGENT_VERSION}`,
  }
  if (token) h.authorization = `Bearer ${token}`
  return h
}

export async function rawPost<T>(
  baseUrl: string,
  path: string,
  body: unknown,
  token?: string | null
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(body ?? {}),
    })
  } catch (err) {
    throw new ApiError(0, `network: ${(err as Error).message}`)
  }
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status} ${path}`, parsed)
  }
  return parsed as T
}

export async function authedPost<T>(path: string, body: unknown): Promise<T> {
  const state = bus.get()
  const token = readToken()
  if (!token) throw new ApiError(401, 'no token')
  return rawPost<T>(state.serverBaseUrl, path, body, token)
}

export type PairCompleteResponse = {
  ok: true
  token: string
  tokenPrefix: string
  device: { id: number; label: string; platform: string }
  user: { id: number; login: string; name: string | null; email: string | null }
  config: {
    sampleIntervalSeconds: number
    flushIntervalSeconds: number
    windowTitlesEnabled: boolean
  }
}

export type HeartbeatResponse = {
  ok: true
  pausedAt: string | null
  windowTitlesEnabled: boolean
  sampleIntervalSeconds: number
  flushIntervalSeconds: number
  policyVersion: string
  primaryOrgId: number | null
  orgIds?: number[]
  activeBreak: { id: number; startedAt: string; reason: string; category?: string } | null
  activeShift: { id: number; punchedInAt: string } | null
}

export type ShiftInResponse = {
  ok: true
  alreadyOpen?: boolean
  shift: { id: number; punchedInAt: string; punchedOutAt: string | null }
}

export type ShiftOutResponse = {
  ok: true
  shift: { id: number; punchedInAt: string; punchedOutAt: string | null }
  verification: { status: string; score: number; notes: string }
}

export type BreakCategory = 'focus' | 'meeting' | 'blocked' | 'lunch' | 'errand' | 'personal' | 'other'

export type BreakRow = {
  id: number
  startedAt: string
  endedAt: string | null
  reason: string
  category?: BreakCategory
  waitingOnUserId?: number | null
  waitingOnExternal?: string | null
  expectedEndAt?: string | null
}

export type BreakResponse = {
  ok: true
  break: BreakRow
}

export type TeamRosterResponse = {
  orgId?: number | null
  members: Array<{
    userId: number
    login: string
    name: string | null
    avatarUrl: string | null
    characterKey: string | null
  }>
}

export type StartBreakInput = {
  reason: string
  orgId?: number
  category?: BreakCategory
  waitingOnUserId?: number | null
  waitingOnExternal?: string | null
  expectedEndAt?: string | null
}

export type EndBreakResponse = {
  ok: true
  ended: boolean
  break?: BreakRow
}

export type LeaveResponse = {
  ok: true
  leave: {
    id: number
    startDate: string
    endDate: string
    reason: string
    status: 'pending' | 'approved' | 'denied' | 'cancelled'
    createdAt: string
  }
}

export type EventsResponse = {
  ok: true
  inserted?: number
  discarded?: number
  rejected?: Array<{ index: number; reason: string }>
  pausedAt?: string | null
  windowTitlesEnabled?: boolean
}

export async function postEvents(batches: PendingBatch[]): Promise<EventsResponse> {
  return authedPost<EventsResponse>('/api/agent/events', {
    batches,
    agentVersion: AGENT_VERSION,
  })
}

export async function postHeartbeat(): Promise<HeartbeatResponse> {
  return authedPost<HeartbeatResponse>('/api/agent/heartbeat', {
    agentVersion: AGENT_VERSION,
  })
}

export async function postPause(paused: boolean): Promise<{ ok: true; pausedAt: string | null }> {
  return authedPost<{ ok: true; pausedAt: string | null }>('/api/agent/pause', { paused })
}

export async function punchIn(): Promise<ShiftInResponse> {
  return authedPost<ShiftInResponse>('/api/agent/shifts/in', {})
}

export async function punchOut(summary: string): Promise<ShiftOutResponse> {
  return authedPost<ShiftOutResponse>('/api/agent/shifts/out', { summary })
}

export async function postBreak(input: StartBreakInput): Promise<BreakResponse> {
  return authedPost<BreakResponse>('/api/agent/breaks', input)
}

export type LogDeliverableInput = {
  title: string
  url?: string | null
}

export type DeliverableResponse = {
  ok: boolean
  deliverable?: {
    id: number
    title: string
    url: string | null
    completedAt: string
    pinnedShotAt: string | null
    verificationStatus: string
  }
  duplicateOf?: number
}

/** Log a "Mark work as done" entry. Mirrors POST /api/me/deliverables. */
export async function postDeliverable(input: LogDeliverableInput): Promise<DeliverableResponse> {
  return authedPost<DeliverableResponse>('/api/agent/deliverables', input)
}

async function authedGet<T>(path: string): Promise<T> {
  const state = bus.get()
  const token = readToken()
  if (!token) throw new ApiError(401, 'no token')
  const url = `${state.serverBaseUrl.replace(/\/+$/, '')}${path}`
  let res: Response
  try {
    res = await fetch(url, { method: 'GET', headers: headers(token) })
  } catch (err) {
    throw new ApiError(0, `network: ${(err as Error).message}`)
  }
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  if (!res.ok) throw new ApiError(res.status, `${res.status} GET ${path}`, parsed)
  return parsed as T
}

export type ServerNotification = {
  id: number
  kind: string
  title: string
  body: string | null
  href: string | null
  createdAt: string
}

/** Unread in-app notifications (leave decided, blocker pinged, help requested…). */
export async function fetchNotifications(): Promise<{ notifications: ServerNotification[] }> {
  return authedGet('/api/agent/notifications')
}

export async function ackNotifications(shownIds: number[]): Promise<void> {
  if (shownIds.length === 0) return
  await authedPost('/api/agent/notifications', { shownIds })
}

export type DayResponse = {
  punchedIn: boolean
  productivity: number
  focusMinutes: number
  deliverablesToday: number
  meetingsRemainingToday: number
  nextMeetingAt: string | null
  nextMeetingTitle: string | null
}

export async function fetchDay(): Promise<DayResponse> {
  return authedGet('/api/agent/day')
}

export type MeetingRow = {
  id: number
  title: string
  startAt: string
  endAt: string
  conferenceUrl: string | null
}

export async function fetchMeetingsToday(): Promise<{ meetings: MeetingRow[] }> {
  return authedGet('/api/agent/meetings/today')
}

export async function fetchTeamRoster(): Promise<TeamRosterResponse> {
  const state = bus.get()
  const token = readToken()
  if (!token) throw new ApiError(401, 'no token')
  const url = `${state.serverBaseUrl.replace(/\/+$/, '')}/api/agent/team`
  let res: Response
  try {
    res = await fetch(url, { method: 'GET', headers: headers(token) })
  } catch (err) {
    throw new ApiError(0, `network: ${(err as Error).message}`)
  }
  const text = await res.text()
  const parsed = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, `${res.status} GET /team`, parsed)
  return parsed as TeamRosterResponse
}

export async function endActiveBreak(): Promise<EndBreakResponse> {
  const state = bus.get()
  const token = readToken()
  if (!token) throw new ApiError(401, 'no token')
  const url = `${state.serverBaseUrl.replace(/\/+$/, '')}/api/agent/breaks/active`
  let res: Response
  try {
    res = await fetch(url, { method: 'PATCH', headers: headers(token) })
  } catch (err) {
    throw new ApiError(0, `network: ${(err as Error).message}`)
  }
  const text = await res.text()
  const parsed = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(res.status, `${res.status} PATCH /breaks/active`, parsed)
  return parsed as EndBreakResponse
}

export async function postLeave(input: {
  orgId?: number
  startDate: string
  endDate: string
  reason: string
}): Promise<LeaveResponse> {
  return authedPost<LeaveResponse>('/api/agent/leaves', input)
}

export async function completePairing(input: {
  serverBaseUrl: string
  code: string
  label: string
}): Promise<PairCompleteResponse> {
  return rawPost<PairCompleteResponse>(input.serverBaseUrl, '/api/agent/pair/complete', {
    code: input.code,
    label: input.label,
    platform: process.platform === 'win32' ? 'windows' : 'darwin',
    agentVersion: AGENT_VERSION,
  })
}
