/**
 * Live provider check — makes ONE real call per check with the keys in the
 * environment and prints provider, model and a trimmed response. Never prints
 * keys.
 *
 *   tsx --env-file=.env scripts/ai-live-check.ts text
 *   tsx --env-file=.env scripts/ai-live-check.ts vision [path/to/image.png|jpg]
 *   tsx --env-file=.env scripts/ai-live-check.ts blocker   (sample context, no database)
 *
 * `text` calls the default provider directly (no fallback) so an auth error
 * on the primary is visible instead of being hidden by Groq/OpenAI.
 */
import { readFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { getProvider } from '../lib/ai/registry'
import { GeminiVisionProvider, getVisionProvider } from '../lib/ai/vision'
import { SourceRegistry } from '../lib/ai/citations'
import { diagnoseBlocker, type BlockerContext } from '../lib/ai/blocker-resolver'

const trim = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** Minimal valid PNG (solid dark grey, 64x64) so vision works with no fixture file. */
function blankPng(): Buffer {
  const w = 64
  const h = 64
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x22)])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function text() {
  const provider = getProvider()
  const out = await provider.generate(
    [
      { role: 'system', content: 'Reply with JSON only.' },
      { role: 'user', content: 'Return {"ok": true, "greeting": "<five words about teamwork>"}' },
    ],
    { responseFormat: 'json', temperature: 0, maxTokens: 200 }
  )
  console.log(JSON.stringify({ check: 'text', provider: provider.name, model: provider.model, response: trim(out) }, null, 2))
}

async function vision(path?: string) {
  const bytes = path ? readFileSync(path) : blankPng()
  const mime = path && /\.jpe?g$/i.test(path) ? 'image/jpeg' : 'image/png'
  // Gemini directly when its key is present, so a Gemini failure is not masked
  // by the OpenAI fallback; otherwise whatever the fallback chain resolves to.
  const provider = process.env.GEMINI_API_KEY ? new GeminiVisionProvider() : getVisionProvider()
  const res = await provider.analyze({ bytes, mime })
  console.log(
    JSON.stringify(
      { check: 'vision', image: path ?? 'generated blank 64x64 PNG', provider: res.provider, model: res.model, analysis: res.analysis, raw: trim(String(res.raw)) },
      null,
      2
    )
  )
}

/** Hand-built SAMPLE context in the same shape buildBlockerContext() produces. */
function sampleBlockerContext(): BlockerContext {
  const r = new SourceRegistry()
  const ctx = {
    now: '2026-11-12T10:00:00.000Z',
    blocker: {
      src: r.add('blocker', 1, { label: 'Blocker: Waiting on review of the payments webhook PR', person: 'Sample Dev A' }),
      blockedPerson: 'Sample Dev A',
      reason: 'Waiting on review of the payments webhook PR before I can start the refund flow',
      startedAt: '2026-11-11T05:00:00.000Z',
      hoursBlocked: 29,
      waitingOn: 'person-2',
      waitingOnExternal: null,
      expectedEndAt: null,
    },
    thread: [
      { src: r.add('thread_message', 1, { label: 'Blocker thread nudge: Pinged Sample Dev B for review', person: 'Sample Manager' }), kind: 'nudge', author: 'Sample Manager', body: 'Pinged Sample Dev B for review', at: '2026-11-11T09:00:00.000Z' },
    ],
    blockedPerson: {
      name: 'Sample Dev A',
      github: [
        { src: r.add('pr', 10, { label: 'PR in sample/payments: Add payments webhook handler', url: 'https://github.com/sample/payments/pull/10', person: 'Sample Dev A' }), type: 'pr_opened', repo: 'sample/payments', title: 'Add payments webhook handler', at: '2026-11-10T11:00:00.000Z', status: 'open', draft: false, requestedReviewers: 1 },
      ],
      standups: [
        { src: r.add('standup', 5, { label: 'Standup (slack) on 2026-11-12', person: 'Sample Dev A' }), day: '2026-11-12', source: 'slack', yesterday: 'Finished webhook handler, opened PR', today: 'Refund flow once the webhook PR is reviewed', blockers: 'Webhook PR still unreviewed' },
      ],
      calendar: [],
    },
    candidates: [
      {
        key: 'person-2', name: 'Sample Dev B', isWhoTheyAreWaitingOn: true, relatedWork: [], standups: [],
        calendarNext3Days: [],
        leave: [{ src: r.add('leave', 3, { label: 'Leave (approved): 2026-11-11 to 2026-11-14', person: 'Sample Dev B' }), startDate: '2026-11-11', endDate: '2026-11-14', status: 'approved' }],
        currentlyBlockedThemselves: null,
      },
      {
        key: 'person-3', name: 'Sample Dev C', isWhoTheyAreWaitingOn: false,
        relatedWork: [
          { src: r.add('review', 21, { label: 'Review in sample/payments: Add payment retries', url: 'https://github.com/sample/payments/pull/8', person: 'Sample Dev C' }), type: 'pr_reviewed', repo: 'sample/payments', title: 'Add payment retries', at: '2026-11-07T08:00:00.000Z', prAuthor: 'sample-dev-a', verdict: 'APPROVED' },
          { src: r.add('commit', 22, { label: 'Commit in sample/payments: Refactor webhook signature check', url: 'https://github.com/sample/payments/commit/abc', person: 'Sample Dev C' }), type: 'commit', repo: 'sample/payments', title: 'Refactor webhook signature check', at: '2026-11-09T08:00:00.000Z' },
        ],
        standups: [], calendarNext3Days: [], leave: [], currentlyBlockedThemselves: null,
      },
    ],
  }
  return {
    blob: JSON.stringify(ctx),
    registry: r,
    candidates: [
      { key: 'person-2', userId: 2, name: 'Sample Dev B', login: 'sample-dev-b' },
      { key: 'person-3', userId: 3, name: 'Sample Dev C', login: 'sample-dev-c' },
    ],
    blockedName: 'Sample Dev A',
  }
}

async function blocker() {
  const d = await diagnoseBlocker(sampleBlockerContext())
  console.log(
    JSON.stringify(
      {
        check: 'blocker-resolver-v2 (sample context)',
        provider: d.provider,
        model: d.model,
        likelyCause: d.likelyCause,
        unblocker: d.unblocker,
        draftMessage: d.draftMessage && { ...d.draftMessage, text: trim(d.draftMessage.text, 300) },
        missing: d.missing,
        confidence: d.confidence,
        dropped: d.dropped,
        citedSourceIds: d.sources.map((x) => x.id),
      },
      null,
      2
    )
  )
}

const [mode, arg] = process.argv.slice(2)
const run =
  mode === 'vision'
    ? vision(arg)
    : mode === 'text'
      ? text()
      : mode === 'blocker'
        ? blocker()
        : Promise.reject(new Error('usage: ai-live-check.ts text | vision [image] | blocker'))
run.catch((err) => {
  console.error('LIVE CHECK FAILED:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
