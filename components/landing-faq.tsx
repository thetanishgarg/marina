'use client'

import { useState } from 'react'

export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'What does MARINA actually do?',
    a: 'MARINA is an AI chief of staff for your team. Every morning it hands you a 4-minute brief on who shipped what, who is blocked, and what needs your attention — pulled from GitHub, calendar, Slack and focus time. It runs async standups, tracks attendance and time off, surfaces blockers the moment they appear, and writes your reviews and 1:1 prep from real evidence. You stop being the human dashboard.',
  },
  {
    q: 'Is this employee surveillance?',
    a: 'No — and the design reflects that. The optional desktop agent only records during a shift (never when paused or off the clock), it captures which app is in focus and idle time, never keystrokes, mouse positions, or screen contents. People can pause tracking anytime and revoke a device instantly. Managers see only the people they manage. The goal is to make honest work visible, not to micromanage.',
  },
  {
    q: 'Do my teammates have to install anything?',
    a: 'No. MARINA works from the web and Slack out of the box — standups, blockers, kudos and time off all work with zero installs. The desktop agent is optional; it just makes focus-time tracking automatic so nobody logs hours by hand.',
  },
  {
    q: 'How is this different from a Slack standup bot like Geekbot?',
    a: 'A standup bot collects text. MARINA understands the work. It pulls real GitHub activity, calendar load and focus time into one picture, drafts your standup for you, auto-detects blockers, and lets you ask it anything about anyone and get a grounded, cited answer in seconds. The standup is one feature, not the whole product.',
  },
  {
    q: 'What does it cost?',
    a: 'It is free for your first 5 teammates, with no credit card required. Early-access teams get every feature free while in the founding cohort, plus founding pricing locked for life when paid plans launch.',
  },
  {
    q: 'How long does setup take?',
    a: 'About five minutes. Sign in, create your workspace, invite your team, and connect Slack and GitHub in a click each. You will see your first morning brief the next day.',
  },
  {
    q: 'Which tools does it integrate with?',
    a: 'Live today: GitHub, Slack, and Google Calendar. Linear, Jira, Notion and more are on the way. MARINA reads identity and activity only — it never needs write access to your repos.',
  },
  {
    q: 'Where is my data stored and is it secure?',
    a: 'Data is stored on managed Postgres (Neon) and served from Vercel. We collect the minimum needed, never screen contents or keystrokes, and you can export or review your own data anytime. See our Privacy and Security pages for the full detail.',
  },
]

/**
 * Interactive FAQ accordion for the landing page. Also emits FAQPage JSON-LD so
 * the same answers can win rich results in search — SEO and conversion in one.
 */
export function LandingFaq() {
  const [open, setOpen] = useState<number | null>(0)
  const faqJson = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  return (
    <section id="faq" className="relative py-20 sm:py-28">
      <div className="max-w-3xl mx-auto px-6">
        <p className="app-eyebrow text-center">Questions, answered</p>
        <h2 className="font-display text-[34px] sm:text-[44px] leading-[1.05] tracking-tight text-[var(--m-ink)] text-center mt-2">
          Everything you’re wondering
        </h2>
        <div className="mt-10 divide-y divide-[var(--m-border)] border-y border-[var(--m-border)]">
          {FAQ_ITEMS.map((f, i) => {
            const isOpen = open === i
            return (
              <div key={i}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between gap-4 py-5 text-left group"
                >
                  <span className="text-[16px] sm:text-[17px] font-medium text-[var(--m-ink)] group-hover:text-[var(--m-accent)] transition-colors">
                    {f.q}
                  </span>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                    className={`shrink-0 text-[var(--m-ink-4)] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {isOpen && (
                  <p className="pb-5 -mt-1 text-[14.5px] leading-relaxed text-[var(--m-ink-2)] max-w-2xl">{f.a}</p>
                )}
              </div>
            )
          })}
        </div>
        <p className="text-center text-[13.5px] text-[var(--m-ink-3)] mt-8">
          Still curious?{' '}
          <a href="/help" className="text-[var(--m-accent)] hover:underline">
            Browse the help center
          </a>{' '}
          or{' '}
          <a href="#cta" className="text-[var(--m-accent)] hover:underline">
            just start free
          </a>
          .
        </p>
      </div>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJson) }}
      />
    </section>
  )
}
