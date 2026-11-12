export const metadata = { title: 'Data Processing Agreement · MARINA' }

export default function DPAPage() {
  return (
    <>
      <h1 className="text-[28px] font-semibold text-[var(--m-ink)] mb-2">Data Processing Agreement</h1>
      <p className="text-[12px] text-[var(--m-ink-3)] mb-8">
        Template · Last updated: 6 June 2026 · India (DPDP Act 2023) + EU/UK (Art. 28 GDPR)
      </p>

      <p>
        This Data Processing Agreement (&quot;<strong>DPA</strong>&quot;) supplements the Terms of
        Service between Project MARINA Private Limited (&quot;<strong>Processor</strong>&quot;) and
        the Customer (&quot;<strong>Controller</strong>&quot; / &quot;<strong>Data Fiduciary</strong>&quot;).
        By executing the order form or beginning paid use of the Service, the parties agree to this
        DPA. Print-ready PDF: <code>/dpa/marina-dpa.pdf</code>.
      </p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">1. Subject matter and duration</h2>
      <p>
        Processor processes Personal Data on Controller&apos;s behalf to provide the workforce
        intelligence Service. Duration: the term of the underlying agreement plus any wind-down period.
      </p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">2. Nature and purpose of processing</h2>
      <p>
        Collection, storage, transmission, and analysis of employee activity telemetry, AI summary
        generation and verification, dashboarding for managers, audit logging, and notification.
      </p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">3. Categories of Data Principals</h2>
      <p>Controller&apos;s employees, contractors, and the Controller&apos;s own administrators.</p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">4. Types of Personal Data</h2>
      <p>
        Identity (name, email, GitHub login, avatar); workstation telemetry (active app names, idle
        time, optional window titles); GitHub events; punch-in/out shifts with summaries; break
        reasons; leave dates and reasons; AI-derived labels.
      </p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">5. Processor obligations</h2>
      <ol className="list-decimal pl-6 space-y-1">
        <li>Process Personal Data only on Controller&apos;s documented instructions.</li>
        <li>Ensure persons authorised to process are under confidentiality obligations.</li>
        <li>Implement the security measures set out in Annex II (Sub-processor list and Technical &amp; Organisational Measures), available at <a href="/security">/security</a>.</li>
        <li>Engage Sub-processors only with Controller&apos;s prior general authorisation. The current list is at <code>/sub-processors</code>. Material additions notified 30 days in advance.</li>
        <li>Assist Controller with Data Principal rights requests under DPDP Act §§ 11–15 and GDPR Arts. 12–22.</li>
        <li>Assist Controller with the security obligations under DPDP Act § 8 and GDPR Arts. 32–36.</li>
        <li>Notify Controller of a Personal Data Breach <strong>without undue delay and in any event within 24 hours</strong>.</li>
        <li>At end of services, at Controller&apos;s choice, delete or return all Personal Data within 30 days.</li>
        <li>Make available all information needed to demonstrate compliance, and allow audits (max once per year, on 30 days&apos; notice).</li>
      </ol>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">6. Sub-processors (Annex II)</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Neon</strong> (US, EU) — Postgres database hosting.</li>
        <li><strong>Vercel</strong> (Global edge) — application hosting.</li>
        <li><strong>Google LLC</strong> (US) — primary AI inference (Gemini API) for narrative, stories, briefs, chat + verification.</li>
        <li><strong>Groq, Inc.</strong> (US) — first fallback AI inference (open-weight gpt-oss models), used only if Gemini is unavailable.</li>
        <li><strong>OpenAI, LLC</strong> (US) — second fallback AI inference (gpt-4o-mini), used only if Gemini and Groq are unavailable.</li>
        <li><strong>Resend</strong> (US, EU) — transactional email.</li>
        <li><strong>Slack</strong> (US) — only if Controller configures Slack webhook.</li>
        <li><strong>Cloudflare R2</strong> or <strong>Vercel Blob</strong> — file/avatar blob storage.</li>
      </ul>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">7. Cross-border transfers</h2>
      <p>
        Some Sub-processors host data outside India. Transfers are made under DPDP Act § 16 and,
        where applicable, the EU Standard Contractual Clauses (Commission Decision 2021/914). On
        request, MARINA will execute the UK International Data Transfer Addendum.
      </p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">8. Liability and indemnity</h2>
      <p>
        The liability provisions of the main agreement apply to this DPA. Nothing here limits any
        party&apos;s liability under applicable law for fines imposed by a regulator on the
        party that caused the breach.
      </p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">9. Governing law</h2>
      <p>India, courts of Bengaluru.</p>

      <h2 className="text-[18px] font-semibold mt-8 mb-2">Annex I · Technical and organisational measures</h2>
      <p>
        See <a href="/security">/security</a>. Summary: TLS 1.3 everywhere, sha256-hashed tokens at
        rest, Keychain-backed local token storage, sandboxed Electron preload, rate limiting on agent
        endpoints, audit log of every privileged action, owner-only org
        settings, automatic database backups with point-in-time recovery.
      </p>

      <p className="mt-6 text-[13px] text-[var(--m-ink-3)]">
        To execute this DPA, email <code>thetanishgarg@gmail.com</code> with your company details. A
        countersigned PDF will be returned within 2 business days.
      </p>
    </>
  )
}
