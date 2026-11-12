import { MarinaMark } from './marina-mark'

/**
 * Marina's morning brief — the hero of the manager dashboard.
 *
 * Instead of a bare "Good morning, Tanish" title, Marina greets the manager
 * personally and tells them, in one warm grounded line, exactly what (if
 * anything) needs them today — then signs it. This is the "first glance"
 * moment: a chief of staff who already read the room, not a dashboard.
 */
export type BriefEvidence = {
  /** Source id shown on the chip, e.g. "blocker-42". */
  id: string
  label: string
  href: string
}

/** Someone likely to get stuck who has not flagged a blocker (lib/brief/early-warnings.ts). */
export type BriefWarning = {
  userId: number
  name: string
  text: string
  evidence: Array<{ id: string; label: string; href?: string }>
}

export function MarinaBrief({
  greeting,
  line,
  evidence = [],
  warnings = [],
}: {
  greeting: string
  line: string
  /** The records each number in the line was counted from. */
  evidence?: BriefEvidence[]
  /** Early warnings: not flagged as blocked yet, but the records suggest a wait. */
  warnings?: BriefWarning[]
}) {
  return (
    <div className="mb-6 rounded-2xl border border-[var(--m-border)] bg-gradient-to-br from-[var(--m-accent-soft)]/70 via-white to-white p-5 flex items-start gap-4 shadow-[var(--m-shadow-sm)]">
      <MarinaMark size={38} className="mt-0.5" label="Marina" />
      <div className="min-w-0">
        <h1 className="app-h1">{greeting}</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--m-ink-2)] max-w-2xl">{line}</p>
        {evidence.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="brief-sources">
            <span className="text-[10.5px] uppercase tracking-wider text-[var(--m-ink-4)]">Based on</span>
            {evidence.map((e) => (
              <a
                key={e.id}
                href={e.href}
                title={`${e.label} (${e.id})`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--m-border)] bg-white px-2 py-0.5 text-[11px] text-[var(--m-ink-2)] hover:border-[var(--m-accent)] hover:text-[var(--m-accent-2)] transition-colors"
              >
                <span className="truncate max-w-[220px]">{e.label}</span>
                <span className="font-mono text-[9.5px] text-[var(--m-ink-4)]">{e.id}</span>
              </a>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3 max-w-2xl" data-testid="brief-warnings">
            <p className="text-[10.5px] uppercase tracking-wider font-semibold text-amber-800">
              Might get stuck · not flagged yet
            </p>
            <ul className="mt-1.5 space-y-2">
              {warnings.map((w) => (
                <li key={w.userId}>
                  <p className="text-[13px] leading-snug text-[var(--m-ink)]">{w.text}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.evidence.map((e) => {
                      const cls =
                        'inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--m-border)] bg-white px-2 py-0.5 text-[10.5px] text-[var(--m-ink-2)]'
                      const body = (
                        <>
                          <span className="truncate max-w-[220px]">{e.label}</span>
                          <span className="font-mono text-[9.5px] text-[var(--m-ink-4)]">{e.id}</span>
                        </>
                      )
                      return e.href ? (
                        <a key={e.id} href={e.href} title={e.label} className={`${cls} hover:border-[var(--m-accent)] transition-colors`}>
                          {body}
                        </a>
                      ) : (
                        <span key={e.id} title={e.label} className={cls}>
                          {body}
                        </span>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-amber-800/80">
              Worked out from pull requests, reviews, leave and standups. A prompt to ask, not a verdict.
            </p>
          </div>
        )}
        <p className="mt-2 font-display italic text-[13px] text-[var(--m-ink-4)]">
          — Marina, your chief of staff
        </p>
      </div>
    </div>
  )
}

/**
 * The records behind each number in the brief line, so the manager can check
 * it: every open blocker (ones waiting on the viewer first), plus the pages
 * the "shipping" and "on leave" counts were taken from.
 */
export function marinaBriefEvidence(
  orgId: number,
  s: { blockerCount: number; activeCount: number; totalMembers: number; onLeaveCount: number },
  blockers: Array<{ breakId: number; reason: string; waitingOnYou: boolean; blockedUser: { name: string | null; login: string } }>,
): BriefEvidence[] {
  if (s.totalMembers === 0) return []
  const out: BriefEvidence[] = [...blockers]
    .sort((a, b) => Number(b.waitingOnYou) - Number(a.waitingOnYou))
    .slice(0, 4)
    .map((b) => ({
      id: `blocker-${b.breakId}`,
      label: `${b.blockedUser.name ?? `@${b.blockedUser.login}`} blocked: ${b.reason}`,
      href: `/org/${orgId}/blockers`,
    }))
  out.push({
    id: 'activity-today',
    label: `${s.activeCount} of ${s.totalMembers} shipping today`,
    href: `/org/${orgId}/activity`,
  })
  if (s.onLeaveCount > 0) {
    out.push({ id: 'leaves-today', label: `${s.onLeaveCount} on leave`, href: `/org/${orgId}/leaves` })
  }
  return out
}

/**
 * Build Marina's one-line read of the morning from the dashboard snapshot.
 * Deterministic + grounded in real numbers (no model call) so the hero is
 * instant, free, and never hallucinates — but written in her voice: warm,
 * proactive, never alarmist.
 */
export function marinaBriefLine(s: {
  blockedOnYouCount: number
  blockerCount: number
  activeCount: number
  totalMembers: number
  onLeaveCount: number
}): string {
  const shipping = `${s.activeCount} of ${s.totalMembers} shipping`
  const leave = s.onLeaveCount ? `, ${s.onLeaveCount} on leave` : ''

  if (s.totalMembers === 0) {
    return "Your team's just getting set up. Invite a few people and I'll start watching the work so you don't have to."
  }
  if (s.blockedOnYouCount > 0) {
    const who = s.blockedOnYouCount === 1 ? 'teammate is' : 'teammates are'
    return `Heads up — ${s.blockedOnYouCount} ${who} waiting on you. ${cap(shipping)} today. Want to clear those first?`
  }
  if (s.blockerCount > 0) {
    const b = s.blockerCount === 1 ? 'blocker' : 'blockers'
    return `${s.blockerCount} ${b} to clear and ${shipping} today — I'd start with whoever's been stuck longest.`
  }
  if (s.activeCount >= Math.ceil(s.totalMembers * 0.6)) {
    return `Smooth morning — ${shipping}${leave}. Nothing needs you right now, so go do your own work.`
  }
  return `Quiet so far — ${shipping}${leave}. I'll flag anything the moment it needs you.`
}

function cap(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1)
}
