import { Reveal } from '@/components/reveal'

/**
 * "Where your week goes back" — the figure-driven proof that Marina is a
 * painkiller, task by task, for managers and HR. Each row shows the before vs
 * after as a bar so the time saved is instantly legible.
 */
const TASKS = [
  {
    title: 'Chasing status & updates',
    before: { label: '~4 hrs/wk of pinging people', min: 240 },
    after: { label: 'a 4-minute daily brief', min: 20 },
    saved: '3.5 hrs',
  },
  {
    title: 'Running standups',
    before: { label: '3 live standups · 75 min', min: 75 },
    after: { label: 'async, auto-collected', min: 10 },
    saved: '1 hr',
  },
  {
    title: 'Attendance & leave admin',
    before: { label: 'spreadsheets & approval chains', min: 120 },
    after: { label: 'auto-tracked · 1-click', min: 10 },
    saved: '1.8 hrs',
  },
  {
    title: 'Birthdays, anniversaries & 1:1 reminders',
    before: { label: 'manual calendar juggling, often missed', min: 60 },
    after: { label: 'Marina reminds & posts for you', min: 0 },
    saved: '1 hr',
  },
  {
    title: 'Reviews & weekly digests',
    before: { label: 'written from memory · ~2 hrs', min: 120 },
    after: { label: 'drafted from real evidence', min: 15 },
    saved: '1.5 hrs',
  },
]
const MAX = 240

export function LandingTimeSaved() {
  return (
    <section id="time-saved" className="relative py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-6">
        <Reveal>
          <p className="app-eyebrow text-center">Proof, in hours</p>
          <h2 className="font-display text-[34px] sm:text-[44px] leading-[1.05] tracking-tight text-[var(--m-ink)] text-center mt-2">
            Where your week goes back
          </h2>
          <p className="text-center text-[15px] text-[var(--m-ink-2)] mt-3 max-w-xl mx-auto leading-relaxed">
            The recurring people-admin that quietly eats a manager’s and HR lead’s week — and exactly what Marina hands
            back.
          </p>
        </Reveal>

        <div className="mt-12 space-y-4">
          {TASKS.map((t, i) => (
            <Reveal key={t.title} delay={i * 70}>
              <div className="rounded-xl border border-[var(--m-border)] bg-white p-4 sm:p-5">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-[15px] font-semibold text-[var(--m-ink)]">{t.title}</p>
                  <span className="shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-full bg-[var(--m-good-soft)] text-[var(--m-good)]">
                    saves {t.saved}/wk
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  <Bar tone="before" widthPct={Math.max(8, Math.round((t.before.min / MAX) * 100))} label={t.before.label} caption="Without Marina" />
                  <Bar tone="after" widthPct={Math.max(3, Math.round((t.after.min / MAX) * 100))} label={t.after.label} caption="With Marina" />
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={140}>
          <div className="mt-10 rounded-2xl bg-[var(--m-ink)] text-white px-6 py-7 sm:px-9 sm:py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <div>
              <p className="text-[12px] uppercase tracking-[0.18em] text-white/55 font-medium">Net result</p>
              <p className="font-display text-[30px] sm:text-[40px] leading-tight mt-1">5+ hours back, every week.</p>
            </div>
            <p className="text-[14px] text-white/70 max-w-xs leading-snug">
              Estimated per manager or HR lead, from the task-by-task breakdown above. That’s most of a working day, returned to the work that actually moves your
              team forward.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Bar({
  tone,
  widthPct,
  label,
  caption,
}: {
  tone: 'before' | 'after'
  widthPct: number
  label: string
  caption: string
}) {
  const isAfter = tone === 'after'
  return (
    <div className="flex items-center gap-3">
      <span className="w-[92px] shrink-0 text-[11px] text-[var(--m-ink-4)]">{caption}</span>
      <div className="flex-1 flex items-center gap-2.5 min-w-0">
        <div
          className="h-2.5 rounded-full shrink-0"
          style={{
            width: `${widthPct}%`,
            maxWidth: '55%',
            minWidth: '10px',
            background: isAfter ? 'var(--m-accent)' : 'var(--m-clay)',
          }}
        />
        <span className={`text-[12.5px] truncate ${isAfter ? 'text-[var(--m-ink)] font-medium' : 'text-[var(--m-ink-3)]'}`}>
          {label}
        </span>
      </div>
    </div>
  )
}
