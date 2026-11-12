import { NextResponse } from 'next/server'
import { HttpError, requireCapability } from '@/lib/auth/guards'
import { buildWeeklyDigest, renderDigestEmail } from '@/lib/digest/weekly'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Live preview of next Monday's digest. Returns either:
 *   - JSON structured payload (default)
 *   - HTML email render (when ?format=html — useful to view in a browser tab)
 *
 * The weekly digest is the org-wide CEO view, so it needs `view_all_data`
 * (owners/admins implicitly; HR heads when granted). A plain manager/lead
 * used to get every team's numbers here.
 */
export async function GET(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId: raw } = await ctx.params
  const orgId = Number(raw)
  if (!Number.isInteger(orgId)) {
    return NextResponse.json({ error: 'invalid orgId' }, { status: 400 })
  }
  try {
    await requireCapability(orgId, 'view_all_data')
    const digest = await buildWeeklyDigest(orgId)
    if (!digest) return NextResponse.json({ error: 'org not found' }, { status: 404 })

    const url = new URL(req.url)
    if (url.searchParams.get('format') === 'html') {
      const email = renderDigestEmail(digest)
      return new NextResponse(email.html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }
    return NextResponse.json(digest)
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('digest preview failed', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
