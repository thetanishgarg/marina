/**
 * Offline check of the time-to-unblock maths (no network, no database):
 *   tsx scripts/test-unblock-stats.ts
 */
import assert from 'node:assert/strict'
import { computeUnblockStats } from '../lib/brief/early-warnings'

const t = (h: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + h * 3_600_000)
const row = (userId: number, startH: number, endH: number | null, resolvedBy: number | null) => ({
  userId,
  startedAt: t(startH),
  endedAt: endH == null ? null : t(endH),
  resolvedByUserId: resolvedBy,
})

// Empty → no figures, never a made-up zero.
let s = computeUnblockStats([], 30)
assert.equal(s.resolvedCount, 0)
assert.equal(s.medianMinutes, null)

// 1h and 3h helped, 5h self-ended, one still open (ignored).
s = computeUnblockStats([row(1, 0, 1, 9), row(2, 0, 3, 9), row(3, 0, 5, null), row(4, 0, null, null)], 30)
assert.equal(s.resolvedCount, 3)
assert.equal(s.medianMinutes, 180)
assert.equal(s.helpedCount, 2)
assert.equal(s.medianHelpedMinutes, 120)
assert.equal(s.selfCount, 1)
assert.equal(s.medianSelfMinutes, 300)

// Resolved "by" the blocked person themselves counts as self, not helped.
s = computeUnblockStats([row(1, 0, 2, 1)], 30)
assert.equal(s.helpedCount, 0)
assert.equal(s.selfCount, 1)

console.log('unblock-stats: 3 checks passed')
