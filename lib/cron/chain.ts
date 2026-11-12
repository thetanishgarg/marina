import { afterResponse } from '@/lib/after'

const MAX_HOPS = 25

/**
 * Self-chaining for resumable crons. Vercel Cron (and Cloud Scheduler) fire a
 * job once; a job that runs out of its time budget used to just stop and wait
 * for tomorrow, so large orgs never got stories/states for everyone. After
 * the response is sent, re-invoke the same route with the cron bearer secret;
 * the persisted cursor makes the next hop continue where this one stopped.
 * A hop counter header bounds the chain.
 */
export function chainCron(req: Request, label: string): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const hop = Number(req.headers.get('x-marina-cron-hop') ?? '0')
  if (!Number.isFinite(hop) || hop >= MAX_HOPS) return false
  const url = new URL(req.url)
  url.searchParams.delete('secret')
  afterResponse(async () => {
    await fetch(url.toString(), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'x-marina-cron-hop': String(hop + 1) },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      // The next hop runs on its own; a client-side timeout here is expected.
    })
  }, `cron chain ${label}`)
  return true
}
