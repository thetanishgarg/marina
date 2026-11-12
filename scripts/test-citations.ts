/**
 * Offline check of the citation verifier (no network, no database):
 *   tsx scripts/test-citations.ts
 */
import assert from 'node:assert/strict'
import { NO_DATA_ANSWER, SourceRegistry, verifyCitedOutput } from '../lib/ai/citations'

const reg = new SourceRegistry()
const pr = reg.add('pr', 12, { label: 'PR in acme/web: Fix navbar', url: 'https://github.com/acme/web/pull/12' })
assert.equal(pr, 'pr-12')

// 1. Backed claim survives, with only the supplied source attached.
let out = verifyCitedOutput(
  JSON.stringify({ claims: [{ text: 'Opened the navbar fix.', basis: 'data', sources: ['pr-12', 'pr-999'] }] }),
  reg,
  { allowProduct: true }
)
assert.equal(out.grounded, true)
assert.deepEqual(out.claims, [{ text: 'Opened the navbar fix.', sources: ['pr-12'] }])
assert.deepEqual(out.sources.map((s) => s.id), ['pr-12'])

// 2. A data claim citing only an invented id is dropped → "no data" answer.
out = verifyCitedOutput(JSON.stringify({ claims: [{ text: 'Shipped billing.', basis: 'data', sources: ['pr-999'] }] }), reg, { allowProduct: true })
assert.equal(out.grounded, false)
assert.equal(out.droppedClaims, 1)
assert.equal(out.answer, NO_DATA_ANSWER)

// 3. A claim with a missing/unknown basis is treated as data and needs a source.
out = verifyCitedOutput(JSON.stringify({ claims: [{ text: 'Probably fine.', sources: [] }] }), reg, { allowProduct: true })
assert.equal(out.answer, NO_DATA_ANSWER)

// 4. "product" is only honoured where product help is allowed.
const product = JSON.stringify({ claims: [{ text: 'Open Settings to post an announcement.', basis: 'product', sources: [] }] })
assert.equal(verifyCitedOutput(product, reg, { allowProduct: true }).claims.length, 1)
assert.equal(verifyCitedOutput(product, reg, { allowProduct: false }).answer, NO_DATA_ANSWER)

// 5. An explicit no-data statement is kept, ungrounded, with no sources.
out = verifyCitedOutput(JSON.stringify({ claims: [{ text: 'No meetings are recorded for that week.', basis: 'no_data', sources: ['pr-12'] }] }), reg, { allowProduct: false })
assert.equal(out.grounded, false)
assert.deepEqual(out.claims, [{ text: 'No meetings are recorded for that week.', sources: [] }])

// 6. Non-JSON output never becomes an unverified answer.
assert.equal(verifyCitedOutput('She shipped a lot this week!', reg, { allowProduct: true }).answer, NO_DATA_ANSWER)

// 7. Fenced JSON is tolerated.
out = verifyCitedOutput('```json\n{"claims":[{"text":"Opened the navbar fix.","basis":"data","sources":["pr-12"]}]}\n```', reg, { allowProduct: true })
assert.equal(out.grounded, true)

console.log('citations: 7 checks passed')
