export const metadata = { title: 'Privacy Policy · MARINA' }

export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-[28px] font-semibold text-[var(--m-ink)] mb-2">Privacy Policy</h1>
      <p className="text-[12px] text-[var(--m-ink-3)] mb-8">Last updated: 6 June 2026 · Effective for: India (DPDP Act 2023), EU/UK (GDPR), CCPA</p>

      <p>
        This Privacy Policy explains how <strong>Project MARINA</strong> (&quot;<strong>MARINA</strong>&quot;, &quot;we&quot;, &quot;us&quot;) collects, uses,
        and protects information when employers (&quot;<strong>Customers</strong>&quot;) and their employees (&quot;<strong>Users</strong>&quot;)
        use our software, websites, and Mac/Windows agents (collectively the &quot;<strong>Service</strong>&quot;).
      </p>

      <p className="mt-4">
        Under India&apos;s <em>Digital Personal Data Protection Act, 2023</em>, MARINA acts as a{' '}
        <strong>Data Processor</strong> on behalf of the Customer (Data Fiduciary). Customers are responsible for
        obtaining legal basis from their employees; MARINA processes data on documented instructions.
      </p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">1. What we collect</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Account info:</strong> name, email, GitHub login, avatar, character selection.</li>
        <li><strong>GitHub activity:</strong> commits, PRs opened, PR reviews, issues closed — fetched via OAuth at the User&apos;s consent.</li>
        <li><strong>Workstation telemetry (Mac/Windows agent):</strong> active app name, idle time, optionally foreground window title — only between punch-in and punch-out, and only after explicit on-device consent.</li>
        {/* GATEKEPT (screenshot feature disabled for now — restore with the feature):
        <li><strong>Disclosed-randomized screenshots:</strong> 2–4 captures per active hour, ONLY if the Customer enables this and the User accepts. Original images are deleted within <strong>48 hours</strong>; only AI-derived labels persist.</li> */}
        <li><strong>HR data:</strong> punch-in/out shifts with work summaries, breaks with reasons, leave requests with types and dates.</li>
        <li><strong>Audit logs:</strong> who did what, when, from where — for security and compliance.</li>
      </ul>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">2. What we never collect</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>Keystrokes, mouse positions, or file contents.</li>
        <li>Workstation activity while tracking is paused or the User is off-clock.</li>
        <li>Screenshots or screen contents of any kind.</li>
        <li>Activity from your personal device — only the device on which you install the agent and explicitly consent.</li>
      </ul>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">3. How we use it</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>To compute daily-state signals (Productive / Blocked / Inactive) for managers — a support tool, not a performance scoring tool.</li>
        <li>To generate AI work narratives and verify end-of-shift summaries against telemetry.</li>
        <li>To deliver invitations, notifications, and the dashboard you logged in to view.</li>
        <li>To detect abuse, debug issues, and improve the Service.</li>
      </ul>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">4. Third-party processors</h2>
      <p>We rely on the following sub-processors:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Neon</strong> (Postgres hosting) — primary data store.</li>
        <li><strong>Vercel</strong> (web hosting + edge functions).</li>
        <li><strong>Groq</strong> — our primary AI provider for narratives, daily stories, briefs and shift verification. <strong>OpenAI</strong> is used only as a fallback if Groq is unavailable. We send only the minimum context needed.</li>
        <li><strong>Resend</strong> — transactional email.</li>
        <li><strong>Slack</strong> (only if your Customer configures a webhook).</li>
      </ul>
      <p className="mt-2">A current list of sub-processors is available at <code>/sub-processors</code>.</p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">5. Cross-border transfers</h2>
      <p>
        Some of our processors host data outside India. The list above includes the relevant
        regions. We rely on contractual safeguards (DPAs incorporating the SCCs where applicable)
        and the Indian government&apos;s permitted-country framework under DPDP Act § 16.
        Customers can request India-region deployment under a custom contract.
      </p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">6. Retention</h2>
      <ul className="list-disc pl-6 space-y-1">
        {/* GATEKEPT (screenshot feature disabled for now):
        <li>Screenshots (raw): <strong>48 hours</strong>, auto-purged.</li>
        <li>Derived screenshot labels: 12 months.</li> */}
        <li>GitHub events, narratives, activity, shifts, breaks, leaves: kept for the duration of your subscription.</li>
        <li>Audit logs: 24 months.</li>
        <li>After Customer deletion: 30-day rolling backup window, then full erasure.</li>
      </ul>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">7. Your rights (DPDP Act / GDPR)</h2>
      <p>You can, at any time:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Access:</strong> download all your data as JSON via <code>/dashboard → Settings → Export my data</code> or <code>GET /api/me/export</code>.</li>
        <li><strong>Correct:</strong> update your profile in settings.</li>
        <li><strong>Erase:</strong> permanently delete your account via Settings → Danger zone, or <code>DELETE /api/me/account</code>. Cascade is immediate.</li>
        <li><strong>Pause:</strong> stop the agent from collecting anything new — the menu bar &quot;Pause tracking&quot; button.</li>
        <li><strong>Object / complain:</strong> contact our DPO at <code>thetanishgarg@gmail.com</code>, or file a complaint with the Data Protection Board of India.</li>
      </ul>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">8. Security</h2>
      <p>
        Bearer tokens are sha256-hashed at rest. The Mac agent encrypts the local token copy via
        macOS Keychain (Electron <code>safeStorage</code>). All traffic is TLS-only. We run
        rate-limiting on agent endpoints and append-only audit logs on every privileged action.
        Full controls are described at <a href="/security">/security</a>.
      </p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">9. Data Protection Officer</h2>
      <p>
        Project MARINA Private Limited<br />
        DPO: <code>thetanishgarg@gmail.com</code><br />
        Security incidents: <code>thetanishgarg@gmail.com</code> (24h SLA)<br />
        Postal: [Registered office address — TBD]
      </p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">10. Changes</h2>
      <p>
        Material changes are notified 30 days in advance via email to org owners and a banner in
        the dashboard. The current version is always at this URL.
      </p>
    </>
  )
}
