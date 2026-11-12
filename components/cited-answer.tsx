'use client'

/** Shapes returned by the chat APIs (see lib/ai/citations.ts). */
export type AnswerSource = {
  id: string
  kind: string
  label: string
  url?: string
  date?: string
  person?: string
}
export type AnswerClaim = { text: string; sources: string[] }

const KIND_LABEL: Record<string, string> = {
  commit: 'Commit',
  pr: 'PR',
  review: 'Review',
  issue: 'Issue',
  meeting: 'Calendar',
  one_on_one: 'Meeting',
  deliverable: 'Deliverable',
  blocker: 'Blocker',
  break: 'Break',
  thread_message: 'Thread',
  standup: 'Standup',
  leave: 'Leave',
  shift: 'Shift',
  rollup: 'Totals',
  ai_summary: 'AI summary',
}

/**
 * Renders an AI answer claim by claim, each followed by the source items it
 * cites. Every chip shows the item's id and opens the item when it has a link,
 * so a reader can check the claim against the underlying record.
 */
export function CitedAnswer({
  claims,
  sources,
  droppedClaims = 0,
}: {
  claims: AnswerClaim[]
  sources: AnswerSource[]
  droppedClaims?: number
}) {
  const byId = new Map(sources.map((s) => [s.id, s]))
  return (
    <div className="space-y-2">
      {claims.map((c, i) => (
        <div key={i}>
          <p className="whitespace-pre-line">{c.text}</p>
          {c.sources.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.sources.map((id) => {
                const s = byId.get(id)
                if (!s) return null
                return <SourceChip key={id} source={s} />
              })}
            </div>
          )}
        </div>
      ))}
      {droppedClaims > 0 && (
        <p className="text-[10.5px] text-[var(--m-ink-4)]">
          {droppedClaims} statement{droppedClaims === 1 ? '' : 's'} removed: no source item supported{' '}
          {droppedClaims === 1 ? 'it' : 'them'}.
        </p>
      )}
    </div>
  )
}

export function SourceChip({ source }: { source: AnswerSource }) {
  const kind = KIND_LABEL[source.kind] ?? source.kind
  const title = [source.person, source.label, source.date].filter(Boolean).join(' · ')
  const cls =
    'inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--m-border)] bg-white px-2 py-0.5 text-[10.5px] leading-tight text-[var(--m-ink-2)]'
  const body = (
    <>
      {!source.label.toLowerCase().startsWith(kind.toLowerCase()) && (
        <span className="font-medium text-[var(--m-accent-2)]">{kind}</span>
      )}
      <span className="truncate max-w-[180px]">{source.label}</span>
      <span className="font-mono text-[9.5px] text-[var(--m-ink-4)]">{source.id}</span>
    </>
  )
  if (!source.url) {
    return (
      <span className={cls} title={title}>
        {body}
      </span>
    )
  }
  const external = /^https?:\/\//.test(source.url)
  return (
    <a
      href={source.url}
      title={title}
      className={`${cls} hover:border-[var(--m-accent)] hover:text-[var(--m-accent-2)] transition-colors`}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {body}
    </a>
  )
}
