/**
 * Sample-org seed for the buildathon demo.
 *
 * Builds ONE small, clearly labelled workspace ("Sample Org (sample data)")
 * with fictional people and a deterministic story, so the demo works with no
 * live GitHub / Slack / Calendar integration:
 *
 *   Arnav is blocked: his payments-webhook PR needs a review from Ishita, who
 *   is on approved leave. Kabir reviewed Arnav's last PR in the same repo and
 *   is free today. Meera manages the team.
 *
 *   Early warning: Nandini has NOT flagged a blocker, but her PR #91 has been
 *   open for over a day with no review and her usual reviewer (Ishita) is away.
 *   Farhan mentions a blocker in standup without flagging one (second rule).
 *   Three past blockers are already resolved, so time-to-unblock has data.
 *
 *   pnpm seed:sample            # create (no-op if it already exists)
 *   SAMPLE_RESET=1 pnpm seed:sample   # delete ONLY the sample org + its users, then recreate
 *
 * Safety: it only ever inserts its own org and users (emails at the reserved
 * `sample.marina.invalid` domain) and a reset only deletes those. It refuses
 * to run with NODE_ENV=production. Point DATABASE_URL at a dev/local database.
 */
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import { db, schema } from '../lib/db/client'
import {
  SAMPLE_EMAIL_DOMAIN,
  SAMPLE_EMPLOYEE_LOGIN,
  SAMPLE_EXTERNAL_PREFIX,
  SAMPLE_MANAGER_LOGIN,
  SAMPLE_ORG_NAME,
  sampleSourceUrl,
} from '../lib/sample-org'
import { dayBoundsUtc } from '../lib/engine/state'

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const REPO = 'sample-org/payments-service'
const WEB_REPO = 'sample-org/web-app'

type Person = {
  login: string
  name: string
  role: 'admin' | 'member'
  discipline: 'engineering' | 'design'
  jobTitle: string
  characterKey: string
}

const PEOPLE: Person[] = [
  { login: SAMPLE_MANAGER_LOGIN, name: 'Meera Krishnan', role: 'admin', discipline: 'engineering', jobTitle: 'Engineering Manager', characterKey: 'amazon' },
  { login: SAMPLE_EMPLOYEE_LOGIN, name: 'Arnav Deshpande', role: 'member', discipline: 'engineering', jobTitle: 'Backend Engineer', characterKey: 'star_captain' },
  { login: 'sample-ishita', name: 'Ishita Rao', role: 'member', discipline: 'engineering', jobTitle: 'Senior Backend Engineer', characterKey: 'brightest' },
  { login: 'sample-kabir', name: 'Kabir Sethi', role: 'member', discipline: 'engineering', jobTitle: 'Backend Engineer', characterKey: 'detective' },
  { login: 'sample-nandini', name: 'Nandini Pillai', role: 'member', discipline: 'engineering', jobTitle: 'Frontend Engineer', characterKey: 'web_crawler' },
  { login: 'sample-farhan', name: 'Farhan Qureshi', role: 'member', discipline: 'design', jobTitle: 'Product Designer', characterKey: 'fox_ninja' },
]

function maskedDbHost(): string {
  try {
    const host = new URL(process.env.DATABASE_URL ?? '').hostname
    return host.replace(/^([a-z]+-[a-z]+)-[a-z0-9-]+?(-pooler)?\./, '$1-***$2.')
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

async function removeExisting(): Promise<void> {
  const org = await db.query.orgs.findFirst({ where: eq(schema.orgs.name, SAMPLE_ORG_NAME) })
  // Only users at the reserved sample domain are ever deleted.
  const sampleUsers = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(like(schema.users.email, `%@${SAMPLE_EMAIL_DOMAIN}`))
  if (org) await db.delete(schema.orgs).where(eq(schema.orgs.id, org.id))
  if (sampleUsers.length > 0) {
    await db.delete(schema.users).where(inArray(schema.users.id, sampleUsers.map((u) => u.id)))
  }
  console.log(`[seed-sample] removed sample org ${org ? `id=${org.id}` : '(none)'} and ${sampleUsers.length} sample user(s)`)
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed sample data with NODE_ENV=production.')
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.')
  console.log(`[seed-sample] database host: ${maskedDbHost()}`)

  const existing = await db.query.orgs.findFirst({ where: eq(schema.orgs.name, SAMPLE_ORG_NAME) })
  if (existing && process.env.SAMPLE_RESET !== '1') {
    console.log(`[seed-sample] "${SAMPLE_ORG_NAME}" already exists (id=${existing.id}). Use SAMPLE_RESET=1 to rebuild it.`)
    return
  }
  if (process.env.SAMPLE_RESET === '1') await removeExisting()

  const now = new Date()
  const today = dayBoundsUtc(now).iso
  const dayIso = (offset: number) => dayBoundsUtc(new Date(now.getTime() + offset * DAY)).iso

  // ─── People, org, memberships ─────────────────────────────────────────────
  const id: Record<string, number> = {}
  for (const p of PEOPLE) {
    const [u] = await db
      .insert(schema.users)
      .values({
        login: p.login,
        githubLogin: p.login,
        name: p.name,
        email: `${p.login}@${SAMPLE_EMAIL_DOMAIN}`,
        characterKey: p.characterKey,
        joinedOn: '2025-04-01',
      })
      .returning()
    id[p.login] = u.id
  }
  const meera = id[SAMPLE_MANAGER_LOGIN]
  const arnav = id[SAMPLE_EMPLOYEE_LOGIN]
  const ishita = id['sample-ishita']
  const kabir = id['sample-kabir']
  const nandini = id['sample-nandini']
  const farhan = id['sample-farhan']

  const [org] = await db.insert(schema.orgs).values({ name: SAMPLE_ORG_NAME, ownerId: meera, holidayRegion: 'IN' }).returning()

  const membershipId: Record<string, number> = {}
  for (const p of PEOPLE) {
    const [m] = await db
      .insert(schema.memberships)
      .values({ orgId: org.id, userId: id[p.login], role: p.role, discipline: p.discipline, jobTitle: p.jobTitle })
      .returning()
    membershipId[p.login] = m.id
  }
  for (const p of PEOPLE) {
    if (p.login === SAMPLE_MANAGER_LOGIN) continue
    await db
      .update(schema.memberships)
      .set({ reportsToMembershipId: membershipId[SAMPLE_MANAGER_LOGIN] })
      .where(eq(schema.memberships.id, membershipId[p.login]))
  }

  // ─── Shifts: 4 past days closed, today open for everyone not on leave ─────
  const summaries: Record<string, string> = {
    [SAMPLE_MANAGER_LOGIN]: 'Sprint planning, two 1:1s and reviewed the refunds design doc.',
    [SAMPLE_EMPLOYEE_LOGIN]: 'Worked on the payments webhook handler and its tests.',
    'sample-ishita': 'Reviewed payment retries and paired on the ledger migration.',
    'sample-kabir': 'Refactored webhook signature checks and reviewed a payments PR.',
    'sample-nandini': 'Built the refund status screen and fixed two checkout bugs.',
    'sample-farhan': 'Iterated on the refunds flow mockups after design review.',
  }
  for (const p of PEOPLE) {
    for (let d = 4; d >= 1; d--) {
      const start = new Date(now.getTime() - d * DAY - 3 * HOUR)
      await db.insert(schema.shifts).values({
        userId: id[p.login],
        orgId: org.id,
        punchedInAt: start,
        punchedInVia: 'web',
        punchedOutAt: new Date(start.getTime() + 8 * HOUR),
        punchedOutVia: 'web',
        workSummary: summaries[p.login],
      })
    }
    if (p.login !== 'sample-ishita') {
      await db.insert(schema.shifts).values({ userId: id[p.login], orgId: org.id, punchedInAt: new Date(now.getTime() - 3 * HOUR), punchedInVia: 'web' })
    }
  }

  // ─── The blocker + its thread ─────────────────────────────────────────────
  const [blocker] = await db
    .insert(schema.breaks)
    .values({
      userId: arnav,
      orgId: org.id,
      startedAt: new Date(now.getTime() - 26 * HOUR),
      reason: 'Waiting on review of PR #214 (payments webhook handler) before I can start the refund flow',
      category: 'blocked',
      waitingOnUserId: ishita,
    })
    .returning()
  await db.insert(schema.blockerThread).values({
    breakId: blocker.id,
    authorUserId: meera,
    kind: 'nudge',
    body: 'Nudged Ishita for a review of PR #214.',
    createdAt: new Date(now.getTime() - 22 * HOUR),
  })

  // ─── Past blockers, already resolved (feeds the time-to-unblock figures) ───
  const past = (userId: number, daysAgo: number, minutes: number, reason: string, resolvedBy: number | null, type: string, note: string | null) => {
    const startedAt = new Date(now.getTime() - daysAgo * DAY)
    return {
      userId,
      orgId: org.id,
      startedAt,
      endedAt: new Date(startedAt.getTime() + minutes * 60_000),
      reason,
      category: 'blocked' as const,
      resolvedByUserId: resolvedBy,
      resolutionType: type,
      resolutionNote: note,
    }
  }
  await db.insert(schema.breaks).values([
    past(kabir, 6, 95, 'Need staging credentials for the payments sandbox', meera, 'unblocked', 'Shared the sandbox credentials from the vault.'),
    past(farhan, 4, 150, 'Waiting on copy for the refund confirmation screen', meera, 'workaround', 'Use the placeholder copy from the spec for now.'),
    past(nandini, 3, 320, 'Design tokens for the refund screen were not published', null, 'self', null),
  ])

  // ─── Leave: the person he is waiting on is away ───────────────────────────
  await db.insert(schema.leaveRequests).values({
    userId: ishita,
    orgId: org.id,
    startDate: dayIso(-1),
    endDate: dayIso(2),
    leaveType: 'casual',
    reason: 'Family function out of town.',
    status: 'approved',
    decidedBy: meera,
    decidedAt: new Date(now.getTime() - 6 * DAY),
  })
  await db.insert(schema.leaveRequests).values({
    userId: nandini,
    orgId: org.id,
    startDate: dayIso(9),
    endDate: dayIso(10),
    leaveType: 'casual',
    reason: 'Travelling home for a festival.',
    status: 'pending',
  })

  // ─── GitHub activity (sample rows; links open an in-app sample page) ──────
  let seq = 0
  const gh = (
    userId: number,
    type: 'commit' | 'pr_opened' | 'pr_reviewed',
    repo: string,
    title: string,
    hoursAgo: number,
    ref: string,
    raw: Record<string, unknown> = {},
  ) => ({
    userId,
    type,
    repo,
    title,
    url: sampleSourceUrl(type === 'commit' ? 'commit' : type === 'pr_opened' ? 'pr' : 'review', ref),
    externalId: `${SAMPLE_EXTERNAL_PREFIX}${type}-${seq++}`,
    occurredAt: new Date(now.getTime() - hoursAgo * HOUR),
    raw: { ...raw, sample: true },
  })
  await db.insert(schema.githubEvents).values([
    // Arnav: the stuck PR, plus earlier merged work.
    gh(arnav, 'pr_opened', REPO, 'Add payments webhook handler', 30, 'PR #214', { number: 214, status: 'open', state: 'open', draft: false, merged: false, requestedReviewers: 1 }),
    gh(arnav, 'commit', REPO, 'Verify webhook signatures before enqueueing events', 31, 'commit 4f2a9c1'),
    gh(arnav, 'commit', REPO, 'Add idempotency key to webhook events', 34, 'commit 9be07d3'),
    gh(arnav, 'pr_opened', REPO, 'Add payment retries with backoff', 6 * 24, 'PR #206', { number: 206, status: 'merged', state: 'closed', draft: false, merged: true, requestedReviewers: 0 }),
    gh(arnav, 'commit', REPO, 'Cap retry attempts at five', 6 * 24 + 3, 'commit 1c88e02'),
    // Kabir: reviewed Arnav's last PR and works in the same code.
    gh(kabir, 'pr_reviewed', REPO, 'Add payment retries with backoff', 5 * 24, 'review on PR #206', { number: 206, prAuthor: SAMPLE_EMPLOYEE_LOGIN, verdict: 'APPROVED' }),
    gh(kabir, 'commit', REPO, 'Refactor webhook signature check into a helper', 3 * 24, 'commit 77ad310'),
    gh(kabir, 'pr_opened', REPO, 'Rotate webhook signing secrets without downtime', 2 * 24, 'PR #211', { number: 211, status: 'merged', state: 'closed', draft: false, merged: true, requestedReviewers: 0 }),
    gh(kabir, 'commit', REPO, 'Add signing-secret rotation runbook', 5, 'commit c03f5aa'),
    // Ishita: usual reviewer, last active before her leave.
    gh(ishita, 'pr_reviewed', REPO, 'Rotate webhook signing secrets without downtime', 2 * 24 + 2, 'review on PR #211', { number: 211, prAuthor: 'sample-kabir', verdict: 'APPROVED' }),
    gh(ishita, 'commit', REPO, 'Ledger migration: backfill settlement ids', 3 * 24 + 4, 'commit e41b7f9'),
    // Nandini: steady frontend output.
    gh(nandini, 'pr_opened', WEB_REPO, 'Refund status screen', 54, 'PR #88', { number: 88, status: 'merged', state: 'closed', draft: false, merged: true, requestedReviewers: 0 }),
    gh(nandini, 'commit', WEB_REPO, 'Fix checkout total rounding', 4, 'commit a9d2210'),
    gh(nandini, 'commit', WEB_REPO, 'Show refund timeline on order page', 2, 'commit 5e0c4b8'),
    // Ishita is also Nandini's usual reviewer; PR #91 has had no review since.
    gh(ishita, 'pr_reviewed', WEB_REPO, 'Refund status screen', 50, 'review on PR #88', { number: 88, prAuthor: 'sample-nandini', verdict: 'APPROVED' }),
    gh(nandini, 'pr_opened', WEB_REPO, 'Refund timeline on order page', 28, 'PR #91', { number: 91, status: 'open', state: 'open', draft: false, merged: false, requestedReviewers: 1 }),
  ])

  // ─── Standups (the Slack-style evidence MARINA actually stores) ───────────
  await db.insert(schema.standups).values([
    { orgId: org.id, userId: arnav, day: today, source: 'slack', yesterday: 'Finished the payments webhook handler and opened PR #214.', today: 'Start the refund flow as soon as PR #214 is reviewed.', blockers: 'PR #214 is still waiting for review. Ishita is the reviewer.' },
    { orgId: org.id, userId: kabir, day: today, source: 'slack', yesterday: 'Merged signing-secret rotation (PR #211).', today: 'Write the rotation runbook. Free for reviews this afternoon.', blockers: '' },
    { orgId: org.id, userId: nandini, day: today, source: 'web', yesterday: 'Merged the refund status screen.', today: 'Refund timeline on the order page.', blockers: '' },
    // Mentions a blocker in standup without flagging one: the second early-warning rule.
    { orgId: org.id, userId: farhan, day: today, source: 'slack', yesterday: 'Refunds flow mockups v2.', today: 'Final refund confirmation screen.', blockers: 'Still need the final legal copy for the refund confirmation screen.' },
  ])

  // ─── Calendar ─────────────────────────────────────────────────────────────
  let mseq = 0
  const mtg = (userId: number, title: string, startInHours: number, minutes: number, attendees: string[]) => ({
    userId,
    provider: 'google',
    externalId: `${SAMPLE_EXTERNAL_PREFIX}mtg-${mseq++}`,
    calendarId: 'primary',
    title,
    startAt: new Date(now.getTime() + startInHours * HOUR),
    endAt: new Date(now.getTime() + startInHours * HOUR + minutes * 60_000),
    organizerEmail: `${SAMPLE_MANAGER_LOGIN}@${SAMPLE_EMAIL_DOMAIN}`,
    attendees: attendees.map((l) => `${l}@${SAMPLE_EMAIL_DOMAIN}`),
    rsvpStatus: 'accepted',
  })
  await db.insert(schema.meetings).values([
    mtg(meera, 'Payments weekly sync', 1, 30, [SAMPLE_EMPLOYEE_LOGIN, 'sample-kabir']),
    mtg(arnav, 'Payments weekly sync', 1, 30, [SAMPLE_MANAGER_LOGIN, 'sample-kabir']),
    mtg(kabir, 'Payments weekly sync', 1, 30, [SAMPLE_MANAGER_LOGIN, SAMPLE_EMPLOYEE_LOGIN]),
    mtg(meera, 'Refunds design review', 4, 45, ['sample-farhan', 'sample-nandini']),
    mtg(farhan, 'Refunds design review', 4, 45, [SAMPLE_MANAGER_LOGIN, 'sample-nandini']),
    mtg(nandini, 'Refunds design review', 4, 45, [SAMPLE_MANAGER_LOGIN, 'sample-farhan']),
    mtg(arnav, 'Sprint planning', 26, 60, [SAMPLE_MANAGER_LOGIN]),
  ])

  // ─── Logged deliverables ──────────────────────────────────────────────────
  await db.insert(schema.deliverables).values([
    { userId: arnav, orgId: org.id, title: 'Payments webhook handler ready for review (PR #214)', url: sampleSourceUrl('pr', 'PR #214'), kind: 'ticket', completedAt: new Date(now.getTime() - 30 * HOUR) },
    { userId: arnav, orgId: org.id, title: 'Payment retries with backoff shipped (PR #206)', url: sampleSourceUrl('pr', 'PR #206'), kind: 'ticket', completedAt: new Date(now.getTime() - 5 * DAY) },
    { userId: kabir, orgId: org.id, title: 'Webhook signing-secret rotation shipped (PR #211)', url: sampleSourceUrl('pr', 'PR #211'), kind: 'ticket', completedAt: new Date(now.getTime() - 2 * DAY) },
    { userId: nandini, orgId: org.id, title: 'Refund status screen shipped (PR #88)', url: sampleSourceUrl('pr', 'PR #88'), kind: 'ticket', completedAt: new Date(now.getTime() - 27 * HOUR) },
    { userId: farhan, orgId: org.id, title: 'Refunds flow mockups v2', url: sampleSourceUrl('doc', 'Refunds flow mockups v2'), kind: 'design', completedAt: new Date(now.getTime() - 3 * DAY) },
  ])

  // ─── Daily status rows (what the dashboard and the employee both read) ────
  const st = (userId: number, day: string, state: 'High' | 'Steady' | 'Blocked' | 'Disengaged', reason: string, outputCount: number) => ({
    userId,
    day,
    state,
    reason,
    outputCount,
    onlineSeconds: 3 * 3600,
    focusWorkRatio: 0,
    staticIdleRuns: 0,
  })
  await db.insert(schema.dailyStates).values([
    st(meera, today, 'Steady', 'Mixed signals, nothing alarming.', 1),
    st(arnav, today, 'Blocked', 'Online 3.0h with a blocker open on PR #214 and no new GitHub output yet. Something may be in the way.', 0),
    st(arnav, dayIso(-1), 'Steady', 'Mixed signals, nothing alarming.', 2),
    st(arnav, dayIso(-2), 'High', '3 GitHub event(s).', 3),
    st(kabir, today, 'High', '1 GitHub event(s).', 1),
    st(nandini, today, 'High', '2 GitHub event(s).', 2),
    st(farhan, today, 'Disengaged', 'Online 3.0h with no output logged yet. A check-in may help.', 0),
  ])

  const check = await db
    .select({ id: schema.breaks.id })
    .from(schema.breaks)
    .where(and(eq(schema.breaks.orgId, org.id), eq(schema.breaks.category, 'blocked'), isNull(schema.breaks.endedAt)))
  console.log(`[seed-sample] created "${SAMPLE_ORG_NAME}" id=${org.id}: ${PEOPLE.length} people, ${check.length} open blocker (break id=${blocker.id}), 3 resolved`)
  console.log(`[seed-sample] manager: ${SAMPLE_MANAGER_LOGIN} (user id=${meera}) · employee: ${SAMPLE_EMPLOYEE_LOGIN} (user id=${arnav})`)
  console.log('[seed-sample] open /demo/walkthrough to run the demo.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-sample] failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
