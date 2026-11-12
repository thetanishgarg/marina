import Link from 'next/link'

export const metadata = { title: 'Sample source · MARINA' }

const KIND_LABEL: Record<string, string> = {
  pr: 'pull request',
  commit: 'commit',
  review: 'code review',
  doc: 'document',
}

/**
 * Where source links in the sample workspace land. A real workspace links
 * each citation to the actual item (for example the pull request on GitHub);
 * the sample workspace has no real repository, so it says so instead of
 * pointing at a made-up URL.
 */
export default async function SampleSourcePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; ref?: string }>
}) {
  const sp = await searchParams
  const kind = KIND_LABEL[sp.kind ?? ''] ?? 'item'
  const ref = (sp.ref ?? '').slice(0, 80)
  return (
    <main className="paper min-h-screen text-[var(--m-ink)]">
      <div className="max-w-xl mx-auto px-6 py-20">
        <span className="inline-block rounded-full bg-amber-100 text-amber-900 text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1">
          Sample data
        </span>
        <h1 className="app-h1 mt-4">
          {ref ? `${ref} is a sample ${kind}` : `This is a sample ${kind}`}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--m-ink-2)]">
          You followed a source link from the demo workspace. Its people and activity are fictional, so there is no real{' '}
          {kind} to open. In a connected workspace this link opens the actual item, for example the pull request on
          GitHub, so you can check the claim against it.
        </p>
        <Link href="/demo/walkthrough" className="mt-6 inline-flex btn-sage text-[13px]">
          Back to the walkthrough
        </Link>
      </div>
    </main>
  )
}
