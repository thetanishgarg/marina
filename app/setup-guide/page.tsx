import Link from 'next/link'
import type { Metadata } from 'next'
import SetupGuidePrintButton from './print-button'

export const metadata: Metadata = {
  title: 'MARINA · Employee setup guide',
  description:
    'Print-ready employee setup guide for the MARINA desktop agent. Share this with new hires on day one.',
}

/**
 * Printable employee setup guide. The page is designed for browser
 * print-to-PDF (⌘P → Save as PDF). All chrome — header, footer, navigation
 * — is hidden in print via the `.no-print` class.
 *
 * Linked from the public /download page AND from the in-product Teams
 * page so managers can hand it to new hires either way.
 */
export default function SetupGuidePage() {
  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .guide-page { padding: 0 !important; box-shadow: none !important; border: 0 !important; }
        }
        @page { size: A4; margin: 16mm; }
      `}</style>

      {/* Toolbar — hidden in print */}
      <div className="no-print sticky top-0 z-20 bg-white border-b border-[var(--m-border)] px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] uppercase tracking-wider font-semibold text-[var(--m-ink-3)]">
            Employee setup guide
          </p>
          <p className="text-[13px] text-[var(--m-ink)]">Print this and hand it to every new hire on day one.</p>
        </div>
        <div className="flex items-center gap-2">
          <SetupGuidePrintButton />
          <Link
            href="/download"
            className="px-3 py-1.5 rounded-md bg-white border border-[var(--m-border)] hover:bg-[var(--m-bg-soft)] text-[var(--m-ink-2)] text-[12.5px] font-medium transition"
          >
            ← Download page
          </Link>
        </div>
      </div>

      <div className="bg-[var(--m-bg)] min-h-screen py-6">
        <article className="guide-page max-w-[820px] mx-auto bg-white border border-[var(--m-border)] rounded-md shadow-sm p-12 text-[var(--m-ink)]">
          {/* Letterhead */}
          <div className="flex items-center gap-3 pb-5 mb-6 border-b border-[var(--m-border)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" width={36} height={36} alt="" className="block object-contain" />
            <div>
              <p className="font-display text-[26px] leading-tight text-[var(--m-ink)]">
                MARINA
              </p>
              <p className="text-[11.5px] text-[var(--m-ink-3)]">AI Chief of Staff · Employee setup guide</p>
            </div>
          </div>

          <p className="font-display text-[26px] leading-tight">Welcome to MARINA.</p>
          <p className="mt-3 text-[14px] text-[var(--m-ink)] leading-relaxed">
            This guide gets the desktop agent running on your work computer. It takes about
            <strong> 10 minutes</strong> end-to-end and only needs to be done once per device.
          </p>

          <hr className="my-6 border-[var(--m-border)]" />

          <Section title="What MARINA does">
            <ul className="text-[13.5px] text-[var(--m-ink)] space-y-1.5 leading-relaxed">
              <li>· You get credit for what you ship — the agent watches focus time, apps, breaks.</li>
              <li>· You don&apos;t write status updates — MARINA drafts them from your real activity.</li>
              <li>· Standups stop wasting time — Scrum Mode pre-fills yesterday / today / blockers.</li>
              <li>· One click when you&apos;re stuck — your manager sees blockers instantly.</li>
            </ul>
            <p className="mt-3 text-[12.5px] text-[var(--m-ink-2)] leading-relaxed">
              <strong>What it does NOT do:</strong> read your messages, emails, files, or browser history.
              No screen capture, no keystroke logging, no tracking outside your working hours.
              You can pause anytime.
            </p>
          </Section>

          <Section title="Before you start">
            <p className="text-[13.5px] text-[var(--m-ink)] leading-relaxed">You&apos;ll need:</p>
            <ul className="mt-2 text-[13.5px] text-[var(--m-ink)] space-y-1 list-disc pl-5 leading-relaxed">
              <li>A Mac (macOS 13 Ventura or later) <strong>or</strong> a Windows 10/11 PC.</li>
              <li>Your work email — the same one your HR used to invite you.</li>
              <li>About 10 minutes.</li>
            </ul>
          </Section>

          <Section title="Step 1 — Accept your invite (3 min)">
            <ol className="text-[13.5px] text-[var(--m-ink)] space-y-1.5 list-decimal pl-5 leading-relaxed">
              <li>Find the email titled <em>“You&apos;re invited to join [Workspace] on MARINA”</em>.</li>
              <li>Click <strong>Open your workspace</strong>.</li>
              <li>Choose a sign-in method: GitHub (engineers), Google (Workspace teams), or email magic link.</li>
              <li>Pick a character avatar — your teammates spot you across the product. You can change it anytime.</li>
              <li>Fill in: discipline, job title, joining date, and (optional) birthday.</li>
            </ol>
          </Section>

          <Section title="Step 2 — Install the desktop agent (4 min)">
            <div className="grid grid-cols-2 gap-5 mt-1">
              <div>
                <p className="text-[12px] uppercase tracking-wider font-semibold text-[var(--m-accent)]">
                  On Mac
                </p>
                <ol className="mt-1.5 text-[12.5px] text-[var(--m-ink)] space-y-1 list-decimal pl-5 leading-snug">
                  <li>Download <strong>Marina.dmg</strong> from <code className="font-mono text-[11.5px] bg-[var(--m-bg-soft)] px-1 rounded">marina.team/download</code>.</li>
                  <li>Open the DMG and drag <strong>Marina</strong> into Applications.</li>
                  <li>Launch Marina from Applications. macOS blocks it the first time — follow <strong>“If macOS says it can&apos;t verify Marina”</strong> just below.</li>
                  <li>Grant <strong>Accessibility</strong> (System Settings → Privacy &amp; Security → Accessibility) so it can tell active from idle.</li>
                  <li>A <strong>welcome window opens automatically</strong> — continue setup there.</li>
                </ol>
              </div>
              <div>
                <p className="text-[12px] uppercase tracking-wider font-semibold text-[var(--m-clay-deep)]">
                  On Windows
                </p>
                <ol className="mt-1.5 text-[12.5px] text-[var(--m-ink)] space-y-1 list-decimal pl-5 leading-snug">
                  <li>Download <strong>Marina-Setup.exe</strong> from <code className="font-mono text-[11.5px] bg-[var(--m-bg-soft)] px-1 rounded">marina.team/download</code>.</li>
                  <li>Run the installer. If SmartScreen warns you, click <strong>More info → Run anyway</strong>.</li>
                  <li>Marina starts in the system tray (bottom right, click <strong>^</strong> to expand) and opens its <strong>welcome window</strong>.</li>
                  <li>Pin it to the tray: right-click the tray → Taskbar settings → toggle Marina on.</li>
                </ol>
              </div>
            </div>
          </Section>

          {/* macOS Gatekeeper — the #1 thing that stops new hires. Make it loud. */}
          <section className="mb-6 break-inside-avoid rounded-lg border border-[var(--m-clay)] bg-[var(--m-clay-soft)] p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[15px]" aria-hidden="true">🍎</span>
              <h2 className="font-display text-[17px] text-[var(--m-clay-deep)] leading-tight">
                If macOS says it can&apos;t verify Marina
              </h2>
            </div>
            <p className="text-[12.5px] text-[var(--m-ink)] leading-relaxed">
              The first time you open it, macOS may show:
              <span className="block mt-1.5 italic text-[var(--m-ink-2)] border-l-2 border-[var(--m-clay)] pl-3">
                “Apple could not verify ‘Marina’ is free of malware that may harm your Mac or
                compromise your privacy.”
              </span>
            </p>
            <p className="mt-2 text-[12.5px] text-[var(--m-ink-2)] leading-relaxed">
              This is expected — Marina is distributed directly to your company, not through the Mac
              App Store, so Apple hasn&apos;t notarized it. It&apos;s safe to open. Here&apos;s how:
            </p>
            <ol className="mt-2 text-[12.5px] text-[var(--m-ink)] space-y-1 list-decimal pl-5 leading-relaxed">
              <li>On that message, click <strong>Done</strong> (do <em>not</em> click “Move to Trash”).</li>
              <li>Open <strong>System Settings → Privacy &amp; Security</strong>.</li>
              <li>Scroll to the <strong>Security</strong> section. You&apos;ll see <em>“Marina was blocked to protect your Mac.”</em> Click <strong>Open Anyway</strong>.</li>
              <li>Confirm with Touch ID or your password, then click <strong>Open Anyway</strong> once more.</li>
            </ol>
            <p className="mt-2 text-[12px] text-[var(--m-ink-3)] leading-relaxed">
              On macOS Sonoma and earlier you can instead <strong>right-click Marina in Applications →
              Open → Open</strong>. You only do this once — after that it launches normally.
            </p>
            <p className="mt-2 text-[12px] text-[var(--m-ink-3)] leading-relaxed">
              Still see <strong>“Marina is damaged and can&apos;t be opened”</strong>? That&apos;s the download
              quarantine flag. Open <strong>Terminal</strong>, paste{' '}
              <code className="font-mono text-[11.5px] bg-[var(--m-bg-soft)] px-1 rounded">xattr -cr /Applications/Marina.app</code>,
              press Return, then open Marina again.
            </p>
          </section>

          <Section title="Step 3 — Pair the agent (1 min)">
            <p className="text-[13.5px] text-[var(--m-ink)] leading-relaxed">
              When Marina first opens, a <strong>welcome window</strong> walks you through what it does,
              your privacy, and connecting this computer. At the <strong>“Connect this Mac”</strong> step:
            </p>
            <ol className="mt-2 text-[13.5px] text-[var(--m-ink)] space-y-1.5 list-decimal pl-5 leading-relaxed">
              <li>On the web at <code className="font-mono text-[11.5px] bg-[var(--m-bg-soft)] px-1 rounded">marina.team</code>, open <strong>Settings → Pair a device</strong> and click <strong>Generate code</strong>.</li>
              <li>Type the <strong>8-character code</strong> into the welcome window (it&apos;s valid for 10 minutes).</li>
              <li>Click <strong>Pair device</strong>. You&apos;ll see <strong>“Welcome, [your name]”</strong> and a quick tour of the menu-bar actions.</li>
            </ol>
            <p className="mt-2 text-[12.5px] text-[var(--m-ink-2)] leading-relaxed">
              Lost the window? Click the <strong>Marina</strong> icon in your menu bar (top-right) →
              <strong> Set up Marina</strong> to reopen it.
            </p>
          </Section>

          <Section title="Step 4 — Your first day (2 min)">
            <p className="text-[13.5px] text-[var(--m-ink)] leading-relaxed">
              Everything is one click in the menu bar — click the <strong>Marina</strong> icon (top-right)
              to punch in or out, take a break, request leave, mark work as done, pause tracking, or open
              your dashboard. Two actions also have global keyboard shortcuts:
            </p>
            <table className="mt-2 w-full text-[12.5px]">
              <tbody>
                <ShortcutRow keys="⌘⇧D / Ctrl+Shift+D" what="Mark work as done — quick deliverable log" />
                <ShortcutRow keys="⌘⇧B / Ctrl+Shift+B" what="Take a break (Coffee / Lunch / Personal / Blocked)" />
              </tbody>
            </table>
            <p className="mt-3 text-[12.5px] text-[var(--m-ink-2)] leading-relaxed">
              Your day: punch in when you open your laptop · log deliverables with ⌘⇧D when you finish
              something · take a break when you step away · punch out at end of day.
            </p>
          </Section>

          <Section title="Optional but recommended">
            <ul className="text-[13.5px] text-[var(--m-ink)] space-y-1.5 list-disc pl-5 leading-relaxed">
              <li><strong>Connect Google Calendar</strong> — see meetings in the agent.</li>
              <li><strong>Connect GitHub</strong> (engineers) — PRs and commits show up automatically.</li>
              <li><strong>Set working days</strong> — for hybrid / 4-day weeks.</li>
            </ul>
          </Section>

          <Section title="What your manager sees">
            <div className="grid grid-cols-2 gap-5 text-[12.5px] leading-relaxed">
              <div>
                <p className="font-semibold text-[var(--m-good)] mb-1">Yes</p>
                <ul className="space-y-1 list-disc pl-5 text-[var(--m-ink)]">
                  <li>Punch in / out times</li>
                  <li>Focus % during your shift</li>
                  <li>App categories you used</li>
                  <li>What you marked as done</li>
                  <li>Working / paused / blocked / off state</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-[var(--m-bad)] mb-1">No</p>
                <ul className="space-y-1 list-disc pl-5 text-[var(--m-ink)]">
                  <li>Messages, emails, document contents</li>
                  <li>Window titles or URLs (unless opted in)</li>
                  <li>Your screen — never captured</li>
                  <li>Anything during pause or off-hours</li>
                </ul>
              </div>
            </div>
          </Section>

          <Section title="Help">
            <p className="text-[12.5px] text-[var(--m-ink-2)] leading-relaxed">
              · Can&apos;t sign in or pair? Email <code className="font-mono text-[11.5px] bg-[var(--m-bg-soft)] px-1 rounded">thetanishgarg@gmail.com</code> — we usually reply within an hour during IST business hours.<br />
              · Found a bug? Desktop agent menu → <em>Report an issue</em> — logs attach automatically.<br />
              · Security / privacy questions? <code className="font-mono text-[11.5px] bg-[var(--m-bg-soft)] px-1 rounded">thetanishgarg@gmail.com</code> · <code className="font-mono text-[11.5px] bg-[var(--m-bg-soft)] px-1 rounded">thetanishgarg@gmail.com</code>
            </p>
          </Section>

          <hr className="my-6 border-[var(--m-border)]" />
          <p className="text-[11px] text-[var(--m-ink-4)] text-center">
            We hope MARINA makes your work life better. If anything feels off, tell us — we ship
            fixes weekly. — The MARINA team
          </p>
        </article>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 break-inside-avoid">
      <h2 className="font-display text-[18px] text-[var(--m-ink)] leading-tight mb-2">{title}</h2>
      {children}
    </section>
  )
}

function ShortcutRow({ keys, what }: { keys: string; what: string }) {
  return (
    <tr className="border-b border-[var(--m-border-soft)] last:border-0">
      <td className="py-1.5 pr-3 font-mono text-[11.5px] text-[var(--m-ink-2)] whitespace-nowrap w-44">
        {keys}
      </td>
      <td className="py-1.5 text-[var(--m-ink)]">{what}</td>
    </tr>
  )
}
