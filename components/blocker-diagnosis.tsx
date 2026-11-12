'use client'

import { useState } from 'react'
import { SourceChip, type AnswerSource } from '@/components/cited-answer'

type Cited = { text: string; evidence: string[] }
export type Diagnosis = {
  blockedName: string
  likelyCause: Cited | null
  unblocker: { userId: number; name: string; login: string; why: string; evidence: string[] } | null
  draftMessage: { to: string; text: string; evidence: string[] } | null
  missing: string[]
  confidence: 'low' | 'medium' | 'high'
  sources: AnswerSource[]
  dropped: string[]
  provider: string
  model: string
}

/**
 * Blocker Resolver v2 panel. One click sends the blocker's surrounding context
 * to the model and shows the likely cause, who can unblock, and a drafted
 * message. Every part lists the records it relied on; nothing is sent until
 * the manager chooses to use the draft.
 */
export function BlockerDiagnosis({
  orgId,
  breakId,
  disabled,
  onUseDraft,
}: {
  orgId: number
  breakId: number
  disabled?: boolean
  /** Prefill the existing "Ask someone else" form with the suggested person + draft. */
  onUseDraft: (person: { userId: number; name: string; login: string }, text: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Diagnosis | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/orgs/${orgId}/blockers/${breakId}/diagnose`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`)
      setResult(data as Diagnosis)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const byId = new Map((result?.sources ?? []).map((s) => [s.id, s]))
  const chips = (ids: string[]) => (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {ids.map((id) => {
        const s = byId.get(id)
        return s ? <SourceChip key={id} source={s} /> : null
      })}
    </div>
  )

  return (
    <section
      data-testid="blocker-diagnosis"
      className="rounded-lg border border-[var(--m-accent)]/25 bg-[var(--m-accent-soft)]/40 p-3"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-[12px] uppercase tracking-wider font-semibold text-[var(--m-accent-2)]">
            Why are they stuck?
          </h3>
          <p className="text-[11px] text-[var(--m-ink-3)]">
            Reads their recent PRs, reviews, standups, this thread, calendars and leave. Every finding links to its
            source.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy || disabled}
          className="shrink-0 px-3 py-1.5 rounded-md bg-[var(--m-accent)] hover:bg-[var(--m-accent-2)] text-white text-[12.5px] font-medium disabled:opacity-50 transition"
        >
          {busy ? 'Reading the evidence…' : result ? 'Run again' : 'Diagnose with Gemini'}
        </button>
      </div>

      {error && <p className="mt-2 text-[12.5px] text-rose-700">{error}</p>}

      {result && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--m-ink-3)]">Likely cause</p>
            {result.likelyCause ? (
              <>
                <p className="mt-0.5 text-[13px] text-[var(--m-ink)] leading-snug">{result.likelyCause.text}</p>
                {chips(result.likelyCause.evidence)}
              </>
            ) : (
              <p className="mt-0.5 text-[13px] text-[var(--m-ink-2)] leading-snug">
                Not enough recorded evidence to name a cause, so none is suggested.
              </p>
            )}
          </div>

          <div>
            <p className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--m-ink-3)]">Who can unblock</p>
            {result.unblocker ? (
              <>
                <p className="mt-0.5 text-[13px] text-[var(--m-ink)] leading-snug">
                  <span className="font-semibold">{result.unblocker.name}</span>: {result.unblocker.why}
                </p>
                {chips(result.unblocker.evidence)}
              </>
            ) : (
              <p className="mt-0.5 text-[13px] text-[var(--m-ink-2)] leading-snug">
                No teammate is supported by the evidence, so nobody is suggested.
              </p>
            )}
          </div>

          {result.draftMessage && result.unblocker && (
            <div>
              <p className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--m-ink-3)]">
                Drafted message to {result.draftMessage.to}
              </p>
              <p className="mt-1 rounded-md border border-[var(--m-border)] bg-white px-3 py-2 text-[13px] text-[var(--m-ink)] leading-snug whitespace-pre-line">
                {result.draftMessage.text}
              </p>
              {chips(result.draftMessage.evidence)}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onUseDraft(result.unblocker!, result.draftMessage!.text)}
                className="mt-2 px-2.5 py-1 rounded-md bg-white border border-[var(--m-border)] hover:bg-[var(--m-bg-soft)] text-[12px] font-medium text-[var(--m-ink-2)] disabled:opacity-50 transition"
              >
                Use this draft (review before sending)
              </button>
            </div>
          )}

          {result.missing.length > 0 && (
            <div>
              <p className="text-[10.5px] uppercase tracking-wider font-semibold text-[var(--m-ink-3)]">What is missing</p>
              <ul className="mt-0.5 list-disc pl-4 text-[12px] text-[var(--m-ink-2)] space-y-0.5">
                {result.missing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10.5px] text-[var(--m-ink-4)]">
            Confidence: {result.confidence}
            {result.dropped.length > 0 && ` · ${result.dropped.length} part(s) removed because their evidence did not check out`}
            {' · '}via {result.provider} ({result.model}) · AI suggestion, check the sources before acting
          </p>
        </div>
      )}
    </section>
  )
}
