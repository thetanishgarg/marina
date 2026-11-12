'use client'

import { useRef, useState } from 'react'
import { CitedAnswer, type AnswerClaim, type AnswerSource } from '@/components/cited-answer'

type Turn = {
  role: 'user' | 'assistant'
  content: string
  claims?: AnswerClaim[]
  sources?: AnswerSource[]
  droppedClaims?: number
}

const SUGGESTIONS = [
  'What did I ship this week?',
  'How many meetings did I have last week?',
  'Which PRs did I review?',
]

/**
 * Marina AI for the individual — ask anything about your own work. Grounded in
 * your real GitHub + meetings + deliverables, so it can answer "how many
 * meetings with Suresh?" or "which navbar PRs merged?" — things ChatGPT can't,
 * because it has never seen your work.
 */
export function MyChat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function ask(q: string) {
    const question = q.trim()
    if (!question || busy) return
    const history = turns.map((t) => ({ role: t.role, content: t.content }))
    setTurns((t) => [...t, { role: 'user', content: question }])
    setValue('')
    setBusy(true)
    try {
      const res = await fetch('/api/me/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      })
      const data = await res.json()
      const answer = res.ok ? data.answer : `Sorry — I couldn't answer that (${data?.error ?? 'error'}).`
      setTurns((t) => [
        ...t,
        res.ok
          ? { role: 'assistant', content: answer, claims: data.claims, sources: data.sources, droppedClaims: data.droppedClaims }
          : { role: 'assistant', content: answer },
      ])
    } catch {
      setTurns((t) => [...t, { role: 'assistant', content: "Sorry — something went wrong. Try again." }])
    } finally {
      setBusy(false)
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
    }
  }

  return (
    <section className="app-card app-card-lg flex flex-col">
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 w-8 h-8 rounded-lg bg-[var(--m-accent-soft)] text-[var(--m-accent-2)] inline-flex items-center justify-center">
          <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
            <path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3Z" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <p className="app-eyebrow">Ask Marina</p>
          <h2 className="app-h2">Your work, on demand</h2>
        </div>
      </div>

      <div ref={scrollRef} className="mt-3 flex-1 min-h-[140px] max-h-[300px] overflow-y-auto space-y-2.5 pr-1">
        {turns.length === 0 ? (
          <div className="text-[13px] text-[var(--m-ink-3)] leading-relaxed">
            Ask about anything you&rsquo;ve done — meetings, PRs, reviews, who you met with. It only knows <em>your</em> work.
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={`max-w-[88%] text-[13px] leading-snug px-3 py-2 rounded-2xl whitespace-pre-wrap ${
                  t.role === 'user'
                    ? 'bg-[var(--m-accent)] text-white rounded-br-md'
                    : 'bg-[var(--m-bg-soft)] text-[var(--m-ink)] rounded-bl-md'
                }`}
              >
                {t.claims && t.claims.length > 0 ? (
                  <CitedAnswer claims={t.claims} sources={t.sources ?? []} droppedClaims={t.droppedClaims} />
                ) : (
                  t.content
                )}
              </div>
            </div>
          ))
        )}
        {busy && <div className="text-[12px] text-[var(--m-ink-4)] pl-1">Marina is thinking…</div>}
      </div>

      {turns.length === 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => ask(s)} disabled={busy} className="text-[12px] px-2.5 py-1 rounded-full border border-[var(--m-border)] text-[var(--m-ink-2)] hover:border-[var(--m-accent)] hover:text-[var(--m-accent)] transition-colors disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(value)
        }}
        className="mt-3 flex gap-1.5"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask about your work…"
          disabled={busy}
          className="flex-1 min-w-0 px-3 py-2 text-[13px] rounded-lg border border-[var(--m-border)] outline-none focus:border-[var(--m-accent)] focus:ring-2 focus:ring-[var(--m-accent)]/15 transition"
        />
        <button type="submit" disabled={busy || !value.trim()} className="btn-sage text-[13px] shrink-0 disabled:opacity-50">
          Ask
        </button>
      </form>
    </section>
  )
}
