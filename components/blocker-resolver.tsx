'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CharacterAvatar } from '@/components/character-avatar'
import { Modal } from '@/components/modal'
import { TutorialHint } from '@/components/tutorial-hint'
import { useToast } from '@/components/toast'
import { celebrate } from '@/components/celebration'
import { BlockerDiagnosis } from '@/components/blocker-diagnosis'

type Detail = {
  blocker: {
    id: number
    startedAt: string
    endedAt: string | null
    reason: string
    waitingOnExternal: string | null
    resolutionType: string | null
    resolutionNote: string | null
  }
  blockedUser: {
    id: number
    login: string
    name: string | null
    characterKey: string | null
    email: string | null
  } | null
  waitingOnUser: {
    id: number
    login: string
    name: string | null
    characterKey: string | null
  } | null
  thread: Array<{
    id: number
    kind: 'nudge' | 'suggestion' | 'note' | 'resolution'
    body: string
    createdAt: string
    author: { id: number; login: string; name: string | null; characterKey: string | null } | null
  }>
}

/**
 * Blocker triage dialog.
 *
 * Optimised for a manager who has 10 seconds: the **Unblock** input + button
 * sits front-and-centre, with Nudge + Suggest as secondary actions in a
 * collapsed strip. The Thread tab shows the full history.
 *
 * Uses the shared <Modal> primitive so it sizes correctly on every viewport
 * and inherits the existing focus-trap / Esc / backdrop logic.
 */
type Teammate = {
  userId: number
  login: string
  name: string | null
  characterKey: string | null
}

export function BlockerResolver({
  orgId,
  breakId,
  open,
  onClose,
  onResolved,
}: {
  orgId: number
  breakId: number | null
  open: boolean
  onClose: () => void
  onResolved?: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [resolution, setResolution] = useState('')
  const [resolutionType, setResolutionType] = useState<'unblocked' | 'workaround' | 'cancelled'>('unblocked')
  const [suggestion, setSuggestion] = useState('')
  const [showSuggest, setShowSuggest] = useState(false)
  const [showThread, setShowThread] = useState(false)
  // "Ask someone else" routing state
  const [showRoute, setShowRoute] = useState(false)
  const [routeQuery, setRouteQuery] = useState('')
  const [routeOptions, setRouteOptions] = useState<Teammate[]>([])
  const [routePicked, setRoutePicked] = useState<Teammate | null>(null)
  const [routeNote, setRouteNote] = useState('')

  // Live ticker so the elapsed time updates on screen.
  const [nowTick, setNowTick] = useState(Date.now())
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [open])

  useEffect(() => {
    if (!open || !breakId) return
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setDetail(null)
    setResolution('')
    setResolutionType('unblocked')
    setSuggestion('')
    setShowSuggest(false)
    setShowThread(false)
    setShowRoute(false)
    setRouteQuery('')
    setRouteOptions([])
    setRoutePicked(null)
    setRouteNote('')
    ;(async () => {
      try {
        const res = await fetch(`/api/orgs/${orgId}/blockers/${breakId}`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok) {
          setDetail(data as Detail)
        } else if (res.status === 409) {
          setLoadError(
            (data as { error?: string })?.error ??
              "This isn't a blocker — it's a regular break.",
          )
        } else {
          setLoadError(
            (data as { error?: string })?.error ?? `Failed to load (HTTP ${res.status}).`,
          )
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Network error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, orgId, breakId])

  async function refresh() {
    const res = await fetch(`/api/orgs/${orgId}/blockers/${breakId}`)
    if (res.ok) setDetail(await res.json())
  }

  async function ping() {
    if (!detail) return
    setBusy('ping')
    try {
      const res = await fetch(`/api/orgs/${orgId}/blockers/${breakId}/ping`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`)
      toast.push({ kind: 'success', title: 'Nudge sent' })
      await refresh()
    } catch (e) {
      toast.push({ kind: 'error', title: 'Nudge failed', body: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  // Search teammates as the manager types (debounced via state).
  useEffect(() => {
    if (!showRoute) return
    const q = routeQuery.trim()
    if (q.length === 0) {
      setRouteOptions([])
      return
    }
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/orgs/${orgId}/members/search?q=${encodeURIComponent(q)}`)
        if (!res.ok) return
        const data = await res.json()
        const rows = (data.members ?? []) as Teammate[]
        // Filter out the blocked person — can't route to yourself.
        const filtered = rows.filter((r) => r.userId !== detail?.blockedUser?.id)
        setRouteOptions(filtered)
      } catch {
        // ignore
      }
    }, 180)
    return () => clearTimeout(id)
  }, [routeQuery, showRoute, orgId, detail?.blockedUser?.id])

  async function routeToTeammate() {
    if (!routePicked) return
    setBusy('route')
    try {
      const res = await fetch(`/api/orgs/${orgId}/blockers/${breakId}/route-to`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          helperUserId: routePicked.userId,
          note: routeNote.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`)
      toast.push({
        kind: 'success',
        title: 'Help request sent',
        body: `${routePicked.name ?? '@' + routePicked.login} will see it on their dashboard + desktop.`,
      })
      setShowRoute(false)
      setRouteQuery('')
      setRoutePicked(null)
      setRouteNote('')
      await refresh()
    } catch (e) {
      toast.push({ kind: 'error', title: 'Failed', body: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  async function sendSuggestion() {
    if (!suggestion.trim()) return
    setBusy('suggest')
    try {
      const res = await fetch(`/api/orgs/${orgId}/blockers/${breakId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'suggestion',
          body: suggestion.trim(),
          notifyEmployee: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`)
      toast.push({ kind: 'success', title: 'Suggestion sent', body: 'Employee will see it on their dashboard.' })
      setSuggestion('')
      setShowSuggest(false)
      await refresh()
    } catch (e) {
      toast.push({ kind: 'error', title: 'Failed', body: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  async function resolve() {
    if (!resolution.trim()) {
      toast.push({ kind: 'error', title: 'Add a quick note', body: 'Tell them what changed so they can pick up where they left off.' })
      return
    }
    setBusy('resolve')
    try {
      const res = await fetch(`/api/orgs/${orgId}/blockers/${breakId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: resolution.trim(),
          resolutionType,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`)
      const mins = (data as { minutesBlocked?: number }).minutesBlocked ?? 0
      const dur = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
      const who = detail?.blockedUser?.name?.split(' ')[0] ?? detail?.blockedUser?.login ?? 'They'
      celebrate()
      toast.push({
        kind: 'success',
        title: `${who} is unblocked`,
        body: `That's ${dur} back in their day. Nice work. — Marina`,
      })
      onResolved?.()
      router.refresh()
      onClose()
    } catch (e) {
      toast.push({ kind: 'error', title: 'Failed', body: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  const isResolved = !!detail?.blocker.endedAt
  const startedMs = detail ? new Date(detail.blocker.startedAt).getTime() : nowTick
  const elapsedMs = (isResolved ? new Date(detail!.blocker.endedAt!).getTime() : nowTick) - startedMs
  const elapsedLabel = humanDur(Math.max(0, elapsedMs))

  const blockedName = detail?.blockedUser?.name ?? detail?.blockedUser?.login ?? '—'
  const waitingOnName =
    detail?.waitingOnUser?.name ??
    detail?.waitingOnUser?.login ??
    detail?.blocker.waitingOnExternal ??
    '—'

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <span aria-hidden className="relative inline-flex">
            {!isResolved && (
              <span className="absolute inset-0 rounded-full bg-rose-500/30 animate-ping" />
            )}
            <span
              className={`relative inline-block w-2 h-2 rounded-full ${
                isResolved ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            />
          </span>
          {isResolved ? 'Resolved blocker' : 'Active blocker'}
        </span>
      }
      subtitle={
        detail
          ? `${blockedName} is waiting on ${waitingOnName} · ${isResolved ? 'was blocked' : 'blocked'} for ${elapsedLabel}`
          : 'Loading…'
      }
      footer={
        !isResolved && detail
          ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={busy !== null}
                className="px-3 py-1.5 rounded-md bg-white border border-[var(--m-border)] hover:bg-[var(--m-bg-soft)] text-[var(--m-ink-2)] text-[12.5px] font-medium disabled:opacity-50 transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={resolve}
                disabled={busy !== null || !resolution.trim()}
                className="px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[12.5px] font-semibold disabled:opacity-50 transition"
              >
                {busy === 'resolve' ? 'Unblocking…' : 'Unblock teammate'}
              </button>
            </>
          )
          : null
      }
    >
      {loading && !detail && !loadError && (
        <p className="text-[13px] text-[var(--m-ink-3)]">Loading blocker details…</p>
      )}

      {loadError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
          <p className="text-[10.5px] uppercase tracking-wider font-semibold text-amber-700 mb-1">
            Couldn't open this blocker
          </p>
          <p className="text-[13px] text-[var(--m-ink)] leading-snug">{loadError}</p>
          <p className="mt-2 text-[11.5px] text-[var(--m-ink-3)]">
            If you just deployed, the database may be missing the new blocker-thread
            columns. Run <code className="px-1 rounded bg-[var(--m-bg-soft)] font-mono text-[11px]">pnpm db:push</code> and try again.
          </p>
        </div>
      )}

      {detail && (
        <div className="space-y-4">
          {/* First-time tip — explains the four actions in one breath. */}
          <TutorialHint id="blocker-resolver-intro" title="How this works">
            Use <b>Unblock</b> when you&rsquo;ve actually cleared the issue.{' '}
            <b>Nudge</b> pings the person they&rsquo;re waiting on across every channel they have.{' '}
            <b>Route to teammate</b> hands the blocker to someone who can help instead. Everything
            you do here is logged in the thread below.
          </TutorialHint>

          {/* Reason quote */}
          {detail.blocker.reason && (
            <blockquote className="rounded-lg border-l-4 border-rose-300 bg-rose-50/40 px-3 py-2 text-[13px] text-[var(--m-ink-2)] leading-snug italic">
              "{detail.blocker.reason}"
            </blockquote>
          )}

          {isResolved ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3">
              <p className="text-[10.5px] uppercase tracking-wider font-semibold text-emerald-700">
                Resolved as {detail.blocker.resolutionType ?? 'unblocked'}
              </p>
              {detail.blocker.resolutionNote && (
                <p className="text-[13px] text-[var(--m-ink)] mt-1 leading-snug">
                  {detail.blocker.resolutionNote}
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Blocker Resolver v2 — cited diagnosis. "Use this draft" only
                  prefills the route-to form below; the manager still sends it. */}
              {breakId != null && (
                <BlockerDiagnosis
                  key={breakId}
                  orgId={orgId}
                  breakId={breakId}
                  disabled={busy !== null}
                  onUseDraft={(person, text) => {
                    setRoutePicked({ userId: person.userId, login: person.login, name: person.name, characterKey: null })
                    setRouteNote(text.slice(0, 500))
                    setRouteQuery('')
                    setShowSuggest(false)
                    setShowRoute(true)
                  }}
                />
              )}

              {/* PRIMARY ACTION — Unblock */}
              <section>
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <h3 className="text-[12px] uppercase tracking-wider font-semibold text-emerald-700">
                    Unblock them
                  </h3>
                  <span className="text-[10.5px] text-[var(--m-ink-4)]">closes on their behalf</span>
                </div>
                <div className="flex gap-1.5 mb-2 flex-wrap">
                  {(
                    [
                      { key: 'unblocked', label: 'Dependency met' },
                      { key: 'workaround', label: 'Going around it' },
                      { key: 'cancelled', label: 'Cancelling work' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setResolutionType(t.key)}
                      className={`text-[11.5px] font-medium px-2.5 py-1 rounded-md border transition ${
                        resolutionType === t.key
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'bg-white border-[var(--m-border)] text-[var(--m-ink-2)] hover:bg-[var(--m-bg-soft)]'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  disabled={busy !== null}
                  placeholder='What changed? e.g. "Anil approved over Slack — PR is good to merge."'
                  rows={2}
                  maxLength={500}
                  className="w-full text-[13px] border border-[var(--m-border)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-200 resize-none"
                />
                <p className="mt-1 text-[10.5px] text-[var(--m-ink-4)]">
                  {blockedName} gets a notification with this note.
                </p>
              </section>

              {/* SECONDARY actions — three large clickable cards. The old
                  small-strip layout buried these so HRs / managers never
                  found them. The new version prints "what each one does"
                  inline so the first-time user knows when to reach for
                  which without reading the tutorial hint. */}
              <section>
                <p className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--m-ink-3)] mb-2">
                  Or take one of these actions
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <ActionCard
                    accent="amber"
                    icon={<NudgeIcon />}
                    title={busy === 'ping' ? 'Pinging…' : 'Nudge the blocker'}
                    sub="Sends an in-app + Slack + desktop ping to whoever they're waiting on."
                    onClick={ping}
                    disabled={busy !== null}
                  />
                  <ActionCard
                    accent="clay"
                    icon={<RouteIcon />}
                    title="Ask someone else"
                    sub="Hand the blocker to a different teammate who can help right now."
                    active={showRoute}
                    onClick={() => { setShowRoute((s) => !s); setShowSuggest(false) }}
                    disabled={busy !== null}
                  />
                  <ActionCard
                    accent="sage"
                    icon={<BulbIcon />}
                    title="Suggest a workaround"
                    sub="Send the blocked teammate a note + dashboard card with an alternative path."
                    active={showSuggest}
                    onClick={() => { setShowSuggest((s) => !s); setShowRoute(false) }}
                    disabled={busy !== null}
                  />
                </div>
                {detail.thread.length > 0 && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowThread((s) => !s)}
                      className="inline-flex items-center gap-1.5 text-[12px] text-[var(--m-ink-3)] hover:text-[var(--m-ink)] transition"
                    >
                      {showThread ? 'Hide' : 'Show'} history · {detail.thread.length} entr{detail.thread.length === 1 ? 'y' : 'ies'}
                    </button>
                  </div>
                )}
              </section>

              {/* Route-to-teammate form (collapsed) */}
              {showRoute && (
                <section className="rounded-lg border border-[var(--m-border)] bg-[var(--m-bg-soft)]/60 p-3 space-y-2">
                  <p className="text-[11.5px] text-[var(--m-ink-2)]">
                    Pick a teammate who might be able to help unblock{' '}
                    <strong>{blockedName}</strong>. They'll get an in-app + email + Slack ping
                    {' '}plus a desktop notification if their MARINA agent is running.
                  </p>
                  {routePicked ? (
                    <div className="flex items-center gap-2 rounded-md bg-white border border-[var(--m-border)] px-2.5 py-1.5">
                      <CharacterAvatar characterKey={routePicked.characterKey} name={routePicked.name} login={routePicked.login} size={22} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-medium text-[var(--m-ink)] truncate">
                          {routePicked.name ?? `@${routePicked.login}`}
                        </p>
                        <p className="text-[10.5px] text-[var(--m-ink-3)] truncate">@{routePicked.login}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setRoutePicked(null); setRouteQuery('') }}
                        className="text-[11px] text-[var(--m-ink-4)] hover:text-[var(--m-ink-2)]"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <input
                        type="text"
                        value={routeQuery}
                        onChange={(e) => setRouteQuery(e.target.value)}
                        placeholder="Type a name or @login…"
                        disabled={busy !== null}
                        className="w-full text-[13px] border border-[var(--m-border)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-200 bg-white"
                        autoFocus
                      />
                      {routeQuery.trim() && routeOptions.length > 0 && (
                        <ul className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-[var(--m-border)] bg-white shadow-lg">
                          {routeOptions.slice(0, 6).map((u) => (
                            <li key={u.userId}>
                              <button
                                type="button"
                                onClick={() => { setRoutePicked(u); setRouteOptions([]); setRouteQuery('') }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-[var(--m-bg-soft)] transition"
                              >
                                <CharacterAvatar characterKey={u.characterKey} name={u.name} login={u.login} size={20} />
                                <span className="text-[12.5px] text-[var(--m-ink)] truncate">
                                  {u.name ?? `@${u.login}`}
                                </span>
                                <span className="ml-auto shrink-0 text-[10.5px] text-[var(--m-ink-4)]">
                                  @{u.login}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <textarea
                    value={routeNote}
                    onChange={(e) => setRouteNote(e.target.value)}
                    disabled={busy !== null}
                    placeholder={'Optional note (e.g. "You set up the auth flow last sprint — got a minute?")'}
                    rows={2}
                    maxLength={500}
                    className="w-full text-[13px] border border-[var(--m-border)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-200 bg-white resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowRoute(false); setRoutePicked(null); setRouteQuery(''); setRouteNote('') }}
                      disabled={busy !== null}
                      className="text-[11.5px] text-[var(--m-ink-3)] hover:text-[var(--m-ink)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={routeToTeammate}
                      disabled={busy !== null || !routePicked}
                      className="px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white text-[12px] font-medium disabled:opacity-50 transition"
                    >
                      {busy === 'route' ? 'Sending…' : 'Send help request'}
                    </button>
                  </div>
                </section>
              )}

              {/* Suggestion form (collapsed) */}
              {showSuggest && (
                <section className="rounded-lg border border-[var(--m-border)] bg-[var(--m-bg-soft)]/60 p-3 space-y-2">
                  <textarea
                    value={suggestion}
                    onChange={(e) => setSuggestion(e.target.value)}
                    disabled={busy !== null}
                    placeholder='Path forward without the original dependency. Goes to the employee as a notification.'
                    rows={2}
                    maxLength={2000}
                    className="w-full text-[13px] border border-[var(--m-border)] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-sky-200 resize-none bg-white"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => { setShowSuggest(false); setSuggestion('') }}
                      disabled={busy !== null}
                      className="text-[11.5px] text-[var(--m-ink-3)] hover:text-[var(--m-ink)]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={sendSuggestion}
                      disabled={busy !== null || !suggestion.trim()}
                      className="px-3 py-1 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-[12px] font-medium disabled:opacity-50 transition"
                    >
                      {busy === 'suggest' ? 'Sending…' : 'Send suggestion'}
                    </button>
                  </div>
                </section>
              )}
            </>
          )}

          {/* Thread (collapsed by default) */}
          {(showThread || isResolved) && detail.thread.length > 0 && (
            <section className="border-t border-[var(--m-border-soft)] pt-3">
              <p className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--m-ink-3)] mb-2">
                History
              </p>
              <ul className="space-y-2.5">
                {detail.thread.map((t) => (
                  <li key={t.id} className="flex items-start gap-2.5">
                    <CharacterAvatar characterKey={t.author?.characterKey ?? null} size={22} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[12px] font-medium text-[var(--m-ink)]">
                          {t.author?.name ?? t.author?.login ?? 'Unknown'}
                        </span>
                        <span className={`text-[9.5px] uppercase tracking-wider font-semibold ${KIND_COLOR[t.kind]}`}>
                          {t.kind}
                        </span>
                        <span className="ml-auto shrink-0 text-[10.5px] text-[var(--m-ink-4)] tabular-nums">
                          {timeAgoShort(t.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-[var(--m-ink-2)] leading-snug whitespace-pre-line">
                        {t.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  )
}

const KIND_COLOR: Record<string, string> = {
  nudge:       'text-amber-700',
  suggestion:  'text-sky-700',
  note:        'text-[var(--m-ink-2)]',
  resolution:  'text-emerald-700',
}

function humanDur(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}

function timeAgoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/* ─── Bottom-of-modal action cards ──────────────────────────────────────
 * Three full-width cards (Nudge / Ask someone / Suggest) that finally
 * give these actions the visual weight they deserve. The icon + title +
 * subtitle pattern reads at-a-glance — a manager who's never opened this
 * modal before still knows exactly what each does.
 */
function ActionCard({
  accent,
  icon,
  title,
  sub,
  active,
  disabled,
  onClick,
}: {
  accent: 'amber' | 'clay' | 'sage'
  icon: React.ReactNode
  title: string
  sub: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const palette =
    accent === 'amber'
      ? { ring: 'ring-amber-300/50', bg: 'bg-amber-50', icon: 'text-amber-700' }
      : accent === 'clay'
        ? { ring: 'ring-[var(--m-clay)]/40', bg: 'bg-[var(--m-clay-soft)]/60', icon: 'text-[var(--m-clay-deep)]' }
        : { ring: 'ring-[var(--m-accent)]/40', bg: 'bg-[var(--m-accent-soft)]/60', icon: 'text-[var(--m-accent-2)]' }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group relative text-left rounded-xl border border-[var(--m-border)] bg-white hover:border-[var(--m-border)] hover:shadow-[var(--m-shadow)] transition-all p-3 disabled:opacity-50 disabled:cursor-not-allowed ${
        active ? `ring-2 ${palette.ring}` : ''
      }`}
    >
      <div className={`w-8 h-8 rounded-lg ${palette.bg} ${palette.icon} inline-flex items-center justify-center mb-2`}>
        {icon}
      </div>
      <p className="text-[13px] font-semibold text-[var(--m-ink)] leading-snug">{title}</p>
      <p className="mt-0.5 text-[11.5px] text-[var(--m-ink-3)] leading-snug">{sub}</p>
    </button>
  )
}

function NudgeIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M14.5 3.5l3 3M3 21l5-1 11-11-4-4L4 16l-1 5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function RouteIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M3 12h6l3-6 4 14 3-8h2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
function BulbIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c1 .9 1.5 1.8 1.5 2.5h5c0-.7.5-1.6 1.5-2.5A6 6 0 0 0 12 3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
