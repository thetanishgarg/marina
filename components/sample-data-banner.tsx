import Link from 'next/link'

/**
 * Shown on every page of the sample workspace (see lib/sample-org.ts) so
 * nobody mistakes the demo's fictional people and activity for real data.
 */
export function SampleDataBanner() {
  return (
    <div
      data-testid="sample-data-banner"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[12.5px] text-amber-900 flex items-center justify-center gap-2 flex-wrap text-center"
      role="note"
    >
      <span className="font-semibold uppercase tracking-wider text-[10.5px] rounded-full bg-amber-200/70 px-2 py-0.5">
        Sample data
      </span>
      <span>
        This workspace is a demo. The people, pull requests, meetings and messages in it are fictional.
      </span>
      <Link href="/demo/walkthrough" className="underline hover:text-amber-700">
        Demo walkthrough
      </Link>
    </div>
  )
}
