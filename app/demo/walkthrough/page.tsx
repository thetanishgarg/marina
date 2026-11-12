import Link from 'next/link'
import { and, eq, isNull } from 'drizzle-orm'
import { auth, signIn } from '@/auth'
import { db, schema } from '@/lib/db/client'
import { isSampleEmail, SAMPLE_EMPLOYEE_LOGIN, SAMPLE_MANAGER_LOGIN, SAMPLE_ORG_NAME } from '@/lib/sample-org'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Demo walkthrough · MARINA' }

/**
 * Guided demo over the sample workspace, in the order the story is told:
 * morning brief → blocked teammate → Blocker Resolver v2 → cited chat answer
 * → the employee's own transparency page.
 *
 * Each step opens the real product page. Switching persona uses the existing
 * dev-only sign-in, so one-click switching works under `pnpm dev`; it is
 * restricted here to the fictional sample users.
 */
export default async function DemoWalkthroughPage() {
  const isDev = process.env.NODE_ENV !== 'production'
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.name, SAMPLE_ORG_NAME) })

  if (!org) {
    return (
      <Shell>
        <h1 className="app-h1">Demo walkthrough</h1>
        <p className="mt-3 text-[14px] text-[var(--m-ink-2)] leading-relaxed">
          The sample workspace has not been created in this database yet. Create it with:
        </p>
        <pre className="mt-3 rounded-lg bg-[var(--m-bg-soft)] border border-[var(--m-border)] px-4 py-3 text-[13px] font-mono">
          pnpm seed:sample
        </pre>
        <p className="mt-3 text-[12.5px] text-[var(--m-ink-3)]">
          It adds one workspace of fictional people, clearly labelled as sample data, and touches nothing else.
        </p>
      </Shell>
    )
  }

  const [manager, employee, blocker, session] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.login, SAMPLE_MANAGER_LOGIN) }),
    db.query.users.findFirst({ where: eq(schema.users.login, SAMPLE_EMPLOYEE_LOGIN) }),
    db.query.breaks.findFirst({
      where: and(eq(schema.breaks.orgId, org.id), eq(schema.breaks.category, 'blocked'), isNull(schema.breaks.endedAt)),
    }),
    auth(),
  ])
  const currentUserId = session?.appUserId ?? null

  async function switchPersona(formData: FormData) {
    'use server'
    if (process.env.NODE_ENV === 'production') return
    const userId = Number(formData.get('userId'))
    const to = String(formData.get('to') ?? '/')
    if (!Number.isInteger(userId) || !to.startsWith('/') || to.startsWith('//')) return
    // Only the fictional sample users can be assumed from this page.
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) })
    if (!user || !isSampleEmail(user.email)) return
    await signIn('dev', { userId: String(userId), redirectTo: to })
  }

  const base = `/org/${org.id}`
  const steps: Array<{ title: string; say: string; do?: string; href: string; persona: 'manager' | 'employee' }> = [
    {
      title: 'Morning brief',
      say: 'Meera opens her dashboard. One line tells her what needs her today, and the chips under it link to the records each number came from. Below it, an early warning: Nandini has not flagged a blocker, but her pull request has waited over a day and her usual reviewer is on leave.',
      href: base,
      persona: 'manager',
    },
    {
      title: 'A blocked teammate',
      say: 'Arnav flagged that he is blocked. The blockers page shows who is stuck, on whom, and for how long, plus the median time it has taken to clear blockers, with and without help.',
      href: `${base}/blockers`,
      persona: 'manager',
    },
    {
      title: 'Blocker Resolver v2',
      say: 'One Gemini call reads his PRs, reviews, standups, the blocker thread, calendars and leave, and returns the likely cause, who can unblock him and a drafted message, each with its evidence.',
      do: 'Click "Diagnose with Gemini", then "Use this draft".',
      href: blocker ? `${base}/blockers?open=${blocker.id}` : `${base}/blockers`,
      persona: 'manager',
    },
    {
      title: 'A cited chat answer',
      say: 'Every statement in a chat answer carries the source items it relied on. A statement with no source is removed before it is shown.',
      do: 'Click "Ask MARINA AI" (bottom right) and ask "Who is blocked right now?"',
      href: base,
      persona: 'manager',
    },
    {
      title: "The employee's own view",
      say: 'Arnav sees the same status label and the same explanation his manager sees, plus everything MARINA collects about him.',
      href: '/dashboard/data',
      persona: 'employee',
    },
  ]

  return (
    <Shell>
      <span className="inline-block rounded-full bg-amber-100 text-amber-900 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1">
        Sample data
      </span>
      <h1 className="app-h1 mt-3">Demo walkthrough</h1>
      <p className="mt-2 text-[14px] text-[var(--m-ink-2)] leading-relaxed">
        Five steps over the sample workspace <strong>{org.name}</strong>. Its people and activity are fictional. The AI
        answers are generated live.
      </p>
      {!isDev && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
          One-click persona switching is only available in development mode. On this build, sign in as the persona
          first, then use the links below.
        </p>
      )}

      <ol className="mt-6 space-y-3">
        {steps.map((s, i) => {
          const persona = s.persona === 'manager' ? manager : employee
          const personaLabel = s.persona === 'manager' ? `${manager?.name ?? 'the manager'} (manager)` : `${employee?.name ?? 'the employee'} (employee)`
          const alreadyThem = persona != null && currentUserId === persona.id
          return (
            <li key={s.title} className="app-card app-card-lg flex items-start gap-4" data-testid={`demo-step-${i + 1}`}>
              <span className="shrink-0 w-7 h-7 rounded-full bg-[var(--m-accent-soft)] text-[var(--m-accent-2)] text-[13px] font-semibold inline-flex items-center justify-center">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="app-h3">{s.title}</h2>
                <p className="mt-1 text-[13px] text-[var(--m-ink-2)] leading-relaxed">{s.say}</p>
                {s.do && <p className="mt-1 text-[12.5px] text-[var(--m-ink-3)]">On the page: {s.do}</p>}
                <div className="mt-3">
                  {alreadyThem || !isDev || !persona ? (
                    <Link href={s.href} className="btn-sage text-[13px] inline-flex">
                      Open step {i + 1}
                    </Link>
                  ) : (
                    <form action={switchPersona}>
                      <input type="hidden" name="userId" value={persona.id} />
                      <input type="hidden" name="to" value={s.href} />
                      <button type="submit" className="btn-sage text-[13px]">
                        Open step {i + 1} as {personaLabel}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="paper min-h-screen text-[var(--m-ink)]">
      <div className="max-w-2xl mx-auto px-6 py-14">{children}</div>
    </main>
  )
}
