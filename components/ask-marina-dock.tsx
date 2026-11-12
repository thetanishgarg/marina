'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MarinaMark, MarinaPulse } from '@/components/marina-mark'
import { CitedAnswer, type AnswerClaim, type AnswerSource } from '@/components/cited-answer'

export type DockTurn = {
  role: 'user' | 'assistant'
  content: string
  failed?: boolean
  provider?: string
  /** Per-claim citations, when the endpoint returns them. */
  claims?: AnswerClaim[]
  sources?: AnswerSource[]
  droppedClaims?: number
}

export type DockAnswer = {
  answer?: string
  error?: string
  provider?: string
  claims?: AnswerClaim[]
  sources?: AnswerSource[]
  droppedClaims?: number
}

/**
 * "Ask MARINA" — a prominent, right-side dock panel for the grounded AI chat.
 *
 * This is a flagship feature, so it gets real estate: a labelled launcher
 * button parked at the bottom-right, and on open a full-height panel that
 * slides in from the RIGHT edge (not a cramped corner bubble). The page stays
 * readable behind a soft dim.
 *
 * It's generic: callers supply the title, the grounding note, preset
 * questions, and an `onAsk(question, history)` that talks to whatever endpoint
 * is relevant (one employee, or a whole team). Conversation persists per
 * `storageKey` in sessionStorage.
 */
export function AskMarinaDock({
  storageKey,
  title,
  grounding,
  presets,
  launcherLabel = 'Ask MARINA AI',
  onAsk,
}: {
  storageKey: string
  title: string
  grounding: string
  presets: string[]
  launcherLabel?: string
  onAsk: (
    question: string,
    history: DockTurn[],
  ) => Promise<DockAnswer>
}) {
  const [turns, setTurns] = useState<DockTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // Portal to <body> so the launcher stays viewport-fixed at the bottom-right
  // and isn't trapped inside a transformed ancestor (the page `.fade-in`
  // wrapper) — which made it sit at the bottom of the content instead.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Restore prior conversation.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as DockTurn[]
        if (Array.isArray(parsed)) setTurns(parsed)
      }
    } catch {
      // ignore
    }
  }, [storageKey])

  // Persist + keep the MESSAGES CONTAINER scrolled to the bottom. We scroll the
  // container itself (never the window) so the page is never yanked around.
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(turns))
    } catch {
      // sessionStorage may be unavailable in private windows
    }
    const list = listRef.current
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' })
  }, [turns, storageKey, open])

  // Esc closes the panel.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function ask(question: string) {
    if (busy) return
    const q = question.trim()
    if (q.length < 2) return
    const next: DockTurn[] = [...turns, { role: 'user', content: q }]
    setTurns(next)
    setInput('')
    setBusy(true)
    try {
      const r = await onAsk(q, turns)
      setTurns([
        ...next,
        r.error
          ? { role: 'assistant', content: r.error, failed: true }
          : {
              role: 'assistant',
              content: r.answer ?? 'No answer.',
              provider: r.provider,
              claims: r.claims,
              sources: r.sources,
              droppedClaims: r.droppedClaims,
            },
      ])
    } catch (err) {
      setTurns([
        ...next,
        { role: 'assistant', content: err instanceof Error ? err.message : String(err), failed: true },
      ])
    } finally {
      setBusy(false)
    }
  }

  function clear() {
    if (turns.length === 0) return
    if (!confirm('Clear this chat? The conversation history will be discarded.')) return
    setTurns([])
  }

  if (!mounted) return null
  return createPortal(
    <>
      {/* Prominent launcher — labelled, accent-coloured, always within reach. */}
      {!open && (
        <button
          type="button"
          data-tour="ask-marina"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-[150] inline-flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-full bg-[var(--m-accent)] hover:bg-[var(--m-accent-2)] text-white text-[13px] font-semibold shadow-[var(--m-shadow-xl)] transition group"
          aria-label={launcherLabel}
        >
          <SparkIcon />
          {launcherLabel}
        </button>
      )}

      {open && (
        <>
          {/* Soft dim — click to close, page stays readable behind. */}
          <button
            type="button"
            aria-label="Close chat"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[200] bg-[var(--m-ink)]/30 backdrop-blur-[1px] ask-dock-fade"
          />

          <aside
            className="fixed top-0 right-0 bottom-0 z-[210] w-[min(100vw,440px)] bg-white border-l border-[var(--m-border)] shadow-2xl flex flex-col ask-dock-slide"
            role="dialog"
            aria-label={title}
          >
            <header className="shrink-0 px-4 py-3 border-b border-[var(--m-border-soft)] flex items-center justify-between gap-2 bg-[var(--m-accent-soft)]/40">
              <div className="flex items-center gap-2 min-w-0">
                <MarinaMark size={22} className="shrink-0" label="" />
                <p className="text-[13px] font-semibold text-[var(--m-accent-2)] truncate">{title}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {turns.length > 0 && (
                  <button
                    type="button"
                    onClick={clear}
                    className="text-[11.5px] text-[var(--m-ink-3)] hover:text-rose-600 px-1.5 py-0.5"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--m-ink-4)] hover:text-[var(--m-ink-2)] hover:bg-[var(--m-bg-soft)] transition"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </header>

            <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
              {turns.length === 0 ? (
                <div>
                  <p className="text-[12.5px] text-[var(--m-ink-3)] mb-2">Try one of these to get started:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {presets.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => ask(q)}
                        disabled={busy}
                        className="text-[11.5px] px-2.5 py-1 rounded-full border border-[var(--m-accent)]/30 hover:border-[var(--m-accent)] hover:bg-[var(--m-accent-soft)] text-[var(--m-ink-2)] hover:text-[var(--m-accent-2)] disabled:opacity-50 transition text-left"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {turns.map((t, i) => (
                    <DockChatTurn key={i} turn={t} />
                  ))}
                  {busy && (
                    <div className="flex items-center gap-2.5 text-[12.5px] text-[var(--m-ink-3)]">
                      <MarinaPulse size={20} label="Marina is thinking" />
                      Thinking…
                    </div>
                  )}
                </>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (input.trim().length >= 2) ask(input)
              }}
              className="shrink-0 border-t border-[var(--m-border-soft)] p-3 flex items-center gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything…"
                disabled={busy}
                maxLength={1000}
                autoFocus
                className="flex-1 input !py-2 text-[13px] min-w-0"
              />
              <button
                type="submit"
                disabled={busy || input.trim().length < 2}
                className="shrink-0 px-3.5 py-2 rounded-lg bg-[var(--m-accent)] hover:bg-[var(--m-accent-2)] text-white text-[12.5px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {busy ? '…' : 'Ask'}
              </button>
            </form>

            <p className="shrink-0 px-3 pb-3 text-[10.5px] text-[var(--m-ink-4)] leading-snug">
              {grounding}
            </p>
          </aside>
        </>
      )}
    </>,
    document.body,
  )
}

function DockChatTurn({ turn }: { turn: DockTurn }) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-md bg-[var(--m-accent)] text-white text-[13px] leading-relaxed">
          {turn.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[92%] px-3 py-2 rounded-2xl rounded-bl-md text-[13px] leading-relaxed whitespace-pre-line ${
          turn.failed ? 'bg-rose-50 text-rose-900 border border-rose-200' : 'bg-[var(--m-bg-soft)] text-[var(--m-ink)]'
        }`}
      >
        {turn.claims && turn.claims.length > 0 && !turn.failed ? (
          <CitedAnswer claims={turn.claims} sources={turn.sources ?? []} droppedClaims={turn.droppedClaims} />
        ) : (
          turn.content
        )}
        {turn.provider && !turn.failed && (
          <p className="text-[10px] text-[var(--m-ink-3)] mt-1 uppercase tracking-wider">via {turn.provider}</p>
        )}
      </div>
    </div>
  )
}

function SparkIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.6 5.2L19 9l-5.4 1.8L12 16l-1.6-5.2L5 9l5.4-1.8L12 2z" />
    </svg>
  )
}
