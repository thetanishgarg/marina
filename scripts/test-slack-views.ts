/**
 * Unit test for the PURE Slack Block Kit view builders. No server / DB / Slack
 * needed — just asserts the builders emit structurally-valid views (the bit we
 * can verify without a connected workspace).
 *
 *   pnpm tsx scripts/test-slack-views.ts
 */
import {
  appHomeView,
  linkAccountHomeView,
  deliverableModal,
  leaveModal,
  punchOutModal,
  blockerModal,
  standupModal,
  kudosModal,
} from '../lib/slack/views'

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log('PASS  ' + name) }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')) }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const isBlock = (b: any) => b && typeof b.type === 'string'
const validView = (v: any) => v && typeof v.type === 'string' && Array.isArray(v.blocks) && v.blocks.every(isBlock)
const inputs = (v: any) => v.blocks.filter((b: any) => b.type === 'input')

const personal = {
  activeShift: { id: 1, sinceMin: 95 },
  deliverablesToday: { count: 2, titles: ['Shipped onboarding v2', 'Fixed the webhook retry'] },
  activeBreak: { category: 'blocked', reason: 'waiting on staging creds', sinceMin: 30 },
  leave: { type: 'casual', remaining: 8, quota: 12 },
  pendingLeaves: 1,
}
const pulse = { total: 50, onShift: 5, blocked: 3, blockers: [{ breakId: 1, userId: 1, name: 'Sneha', sinceMin: 40, waitingOn: 'Kavya' }] }

// Employee home (active shift, not a manager, no web url)
const emp = appHomeView({ greeting: 'Good morning, Arjun', personal, isManager: false, pulse: null, orgId: 16, webUrl: '' })
check('employee home is valid', validView(emp))
check('employee home type=home', (emp as any).type === 'home')
check('employee home shows Punch out (active shift)', JSON.stringify(emp).includes('open_punchout_modal'))
check('employee home hides team section', !JSON.stringify(emp).includes('On shift'))
check('employee home emits NO empty url button', !JSON.stringify(emp).includes('"url":""'))

// Manager home (no shift, has web url)
const mgr = appHomeView({ greeting: 'Good morning, Tanish', personal: { ...personal, activeShift: null }, isManager: true, pulse, orgId: 16, webUrl: 'https://marina.team/org/16' })
check('manager home is valid', validView(mgr))
check('manager home shows Punch in (no shift)', JSON.stringify(mgr).includes('"action_id":"punch_in"'))
check('manager home shows Team section', JSON.stringify(mgr).includes('On shift'))
check('manager home links to dashboard', JSON.stringify(mgr).includes('marina.team/org/16'))

check('link-account home is valid', validView(linkAccountHomeView('https://marina.team')))

// Modals
const modals: Array<[string, any]> = [
  ['deliverable', deliverableModal(16)],
  ['leave', leaveModal(16)],
  ['punchout', punchOutModal(16, 120)],
  ['blocker', blockerModal(16)],
  ['standup', standupModal(16, { yesterday: 'shipped the thing', blockers: '' })],
  ['kudos', kudosModal(16)],
]
for (const [name, v] of modals) {
  check(`${name} modal is valid`, validView(v) && v.type === 'modal')
  check(`${name} modal has callback_id`, typeof v.callback_id === 'string')
  check(`${name} modal carries orgId in metadata`, (() => { try { return JSON.parse(v.private_metadata).orgId === 16 } catch { return false } })())
  check(`${name} modal has >=1 input`, inputs(v).length > 0)
}
check(
  'blocker modal adds a teammate picker when members are passed',
  (() => {
    const v = blockerModal(16, [{ userId: 7, name: 'Priya' }])
    const s = JSON.stringify(v)
    return s.includes('"block_id":"waiting_on_user"') && s.includes('static_select') && s.includes('"value":"7"')
  })(),
)
check('blocker modal omits the teammate picker when no members', !JSON.stringify(blockerModal(16)).includes('waiting_on_user'))
check('kudos modal has a users_select', JSON.stringify(kudosModal(16)).includes('users_select'))
check('deliverable enforces title min_length 10', JSON.stringify(deliverableModal(16)).includes('"min_length":10'))
check('punchout enforces summary min_length 20', JSON.stringify(punchOutModal(16)).includes('"min_length":20'))
check('leave has two datepickers', (JSON.stringify(leaveModal(16)).match(/datepicker/g) || []).length === 2)

console.log(`\n${pass}/${pass + fail} view checks passed`)
if (fail) process.exit(1)
