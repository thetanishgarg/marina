import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { auth, signIn } from "@/auth";
import { db, schema } from "@/lib/db/client";
import { listMembershipsForCurrentUser, roleAtLeast } from "@/lib/auth/guards";
import { CHARACTERS } from "@/lib/characters/data";
import { CharacterAvatar } from "@/components/character-avatar";
import { Reveal } from "@/components/reveal";
import { HeroVideo } from "@/components/hero-video";
import LandingClient from "./landing-client";
import { LandingFaq } from "@/components/landing-faq";
import { LandingStructuredData } from "@/components/landing-structured-data";
import { LandingTimeSaved } from "@/components/landing-time-saved";
import { LandingHr } from "@/components/landing-hr";
import {
  AskMarinaMockup,
  AiBriefMockup,
  BlockerResolverMockup,
  ScrumModeMockup,
  MemberDetailMockup,
  ActivityFeedMockup,
  TeamsMockup,
} from "@/components/landing-showcase";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (session?.appUserId) {
    const me = await db.query.users.findFirst({
      where: eq(schema.users.id, session.appUserId),
    });
    // Character pick was removed — users now use uploaded photo or initials avatar

    const jar = await cookies();
    const pendingInvite = jar.get("marina_pending_invite")?.value;
    if (pendingInvite) redirect(`/invite/${pendingInvite}`);

    const memberships = await listMembershipsForCurrentUser();
    if (memberships.length === 0) {
      // No org yet. An individual who chose the employee flow goes straight to
      // their personal dashboard; everyone else keeps the manager default of
      // creating/joining a team. (Keeps the manager onboarding untouched.)
      const solo = jar.get("marina_flow")?.value === "solo";
      redirect(solo ? "/dashboard" : "/onboarding");
    }
    const first = memberships[0];
    if (roleAtLeast(first.role, "manager")) redirect(`/org/${first.orgId}`);
    redirect("/dashboard");
  }

  async function googleSignIn() {
    "use server";
    // Root (/) = the company / manager flow. Clear any stale "solo" marker and
    // come back to / after auth, so the no-org branch sends a brand-new signup
    // into org onboarding (/onboarding) — NOT the employee dashboard.
    (await cookies()).delete("marina_flow");
    await signIn("google", { redirectTo: "/" });
  }

  const googleEnabled = !!(
    process.env.GOOGLE_SSO_CLIENT_ID && process.env.GOOGLE_SSO_CLIENT_SECRET
  );

  return (
    <main className="relative isolate min-h-screen paper text-[var(--m-ink)] overflow-x-hidden">
      {/* Subtle ambient blobs — sage + clay, very low opacity. Placed inside
          the main's stacking context so negative z-index sits behind content
          but above the cream page background. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 overflow-hidden pointer-events-none h-[1000px]"
      >
        <div
          className="absolute left-1/2 -translate-x-1/2 -top-40 w-[1400px] h-[700px] rounded-full opacity-60 blur-3xl"
          style={{
            background:
              "radial-gradient(40% 40% at 30% 50%, rgba(63,107,84,0.22), transparent 70%), radial-gradient(40% 40% at 70% 30%, rgba(196,123,86,0.18), transparent 70%), radial-gradient(40% 40% at 60% 80%, rgba(193,154,77,0.12), transparent 70%)",
          }}
        />
      </div>

      <Nav />
      <LandingStructuredData />

      <Hero
        sp={sp}
        googleSignIn={googleEnabled ? googleSignIn : null}
        characters={CHARACTERS.slice(0, 8).map((c) => ({
          key: c.key,
          name: c.name,
          color: c.color,
        }))}
      />

      {/*<AudienceSplit />*/}
      <ProofStrip />
      {/* Product-forward: the real product surfaces lead the page, right after
          the hero + proof numbers. The morning brief first (what you wake up
          to), then the full feature gallery — so a visitor "gets it" in the
          first scroll instead of reading five abstract sections first. */}
      <ProductSection />
      <ShowcaseSection />
      {/* Then the outcome / payoff: the daily transformation, the hours saved,
          and the HR half — the "why it's worth it" once they've seen the how. */}
      <PainSection />
      <LandingTimeSaved />
      <LandingHr />
      <Workflows />
      {/*<RosterShowcase />*/}
      {/* <ValueProps /> removed — its "1 brief / 2 sec / 0 follow-ups" cards
          duplicated the ProofStrip numbers and the Pain "with MARINA" column. */}
      <Integrations />
      {/* Pricing is hidden during the early-access phase — we're onboarding a
          founding cohort for free first. The <Pricing/> component is kept
          below (unused) so it's a one-line swap to bring paid tiers back. */}
      {/* <Pricing /> */}
      <LandingFaq />
      <EarlyAccess />
      {/*<ResourceCards />*/}
      {/*<FinalCTA
        githubSignIn={githubSignIn}
        googleSignIn={googleEnabled ? googleSignIn : null}
      />*/}
      <Footer />
    </main>
  );
}

/* ============================ NAV ============================ */

function Nav() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-[var(--m-bg)]/75 border-b border-[var(--m-border)]/50">
      <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between gap-6">
        <a href="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-display text-[19px] leading-none text-[var(--m-ink)] tracking-tight">
            MARINA
          </span>
        </a>
        <nav className="hidden md:flex items-center gap-7 text-[13.5px] text-[var(--m-ink-2)]">
          <a
            href="#product"
            className="hover:text-[var(--m-ink)] transition-colors"
          >
            Product
          </a>
          <a href="/individuals" className="hover:text-[var(--m-ink)] transition-colors">
            For individuals
          </a>
          <a
            href="#workflows"
            className="hover:text-[var(--m-ink)] transition-colors"
          >
            Workflows
          </a>
          <a
            href="#pricing"
            className="hover:text-[var(--m-ink)] transition-colors"
          >
            Early access
          </a>
          <a
            href="/download"
            className="hover:text-[var(--m-ink)] transition-colors"
          >
            Download
          </a>
          <a
            href="/security"
            className="hover:text-[var(--m-ink)] transition-colors"
          >
            Security
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <a
            href="#get-started"
            className="hidden sm:inline-flex text-[13px] text-[var(--m-ink-2)] hover:text-[var(--m-ink)] px-3 py-1.5 transition-colors"
          >
            Sign in
          </a>
          {/* Two distinct conversion paths: a high-friction "book a demo"
              CTA for buyers who want to talk to a human, and a low-friction
              "start free" anchor for managers who want to try it now. The
              old single `mailto:` button silently failed for users without
              a default mail handler — replaced by `/demo` (a real form). */}
          <a
            href="/demo"
            className="hidden sm:inline-flex text-[13px] text-[var(--m-ink-2)] hover:text-[var(--m-ink)] px-3 py-1.5 transition-colors"
          >
            Book a demo
          </a>
          <a href="#get-started" className="btn-primary">
            Start free
          </a>
        </div>
      </div>
    </header>
  );
}

/* ============================ HERO ============================ */

function Hero({
  sp,
  googleSignIn,
  characters,
}: {
  sp: { auth_error?: string };
  googleSignIn: (() => Promise<void>) | null;
  characters: Array<{ key: string; name: string; color: string }>;
}) {
  return (
    <section className="relative max-w-7xl mx-auto px-6 pt-16 pb-20 md:pt-24 md:pb-28">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        <div className="lg:col-span-6 min-w-0">
          <Reveal>
            <p className="inline-flex items-center gap-2 text-[12px] tracking-wide uppercase text-[var(--m-ink-3)] mb-5">
              <span className="relative inline-flex">
                <span className="absolute inset-0 rounded-full bg-[var(--m-accent)]/40 m-slow-pulse" />
                <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-[var(--m-accent)]" />
              </span>
              For managers &amp; HR teams
            </p>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="font-display text-[44px] md:text-[64px] leading-[1.02] tracking-tight text-[var(--m-ink)]">
              The busywork of
              <br />
              managing people,
              <br />
              <span className="italic brand-gradient-text">handled.</span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="mt-6 max-w-xl text-[17px] md:text-[19px] leading-snug text-[var(--m-ink-2)] font-medium">
              Marina is the AI chief of staff for managers and HR.
              <span className="block mt-1.5 text-[var(--m-ink-3)] font-normal text-[15px] md:text-[16px]">
                Status-chasing, standups, attendance, leave and reviews &mdash;
                even every birthday and 1:1 reminder. Automated. Managers get an estimated{" "}
                <span className="font-semibold text-[var(--m-ink-2)]">
                  5+ hours back
                </span>
                , every week.
              </span>
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div id="get-started" className="mt-8 scroll-mt-28">
              <LandingClient
                authError={sp.auth_error ?? null}
                googleSignIn={googleSignIn}
                characters={characters}
                flow="org"
                redirectTo="/"
              />
            </div>
            <p className="mt-5 text-[12.5px] text-[var(--m-ink-3)] flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="text-[var(--m-good)]"
                >
                  <path
                    d="M5 13l4 4 10-10"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Free for the first 5 teammates
              </span>
              <span className="text-[var(--m-ink-5)]">·</span>
              <span className="inline-flex items-center gap-1.5">
                <svg
                  width={14}
                  height={14}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="text-[var(--m-good)]"
                >
                  <path
                    d="M5 13l4 4 10-10"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                No credit card required
              </span>
            </p>
          </Reveal>
        </div>

        {/* Hero — the product demo video (how to use Marina, end to end). */}
        <Reveal delay={320} className="lg:col-span-6">
          <HeroVideo />
        </Reveal>
      </div>
    </section>
  );
}

/* ============================ AUDIENCE SPLIT ============================ */

/**
 * The fork right under the hero: one Marina, two ways in. Managers/HR get the
 * team product (the rest of this page); individuals get the free personal
 * product — "get credit for your work" — and self-serve straight into it via
 * /api/flow?to=solo, which marks them as a solo employee so they skip the
 * team-creation onboarding and land on their own dashboard.
 */
function AudienceSplit() {
  return (
    <section
      id="who"
      className="max-w-6xl mx-auto px-6 pb-4 md:pb-8 -mt-4 md:-mt-8"
    >
      <Reveal>
        <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--m-ink-4)] font-medium mb-4 text-center">
          One Marina, two ways in
        </p>
      </Reveal>
      <div className="grid md:grid-cols-2 gap-4 items-stretch">
        {/* Managers / HR — the team product */}
        <Reveal>
          <div className="h-full rounded-2xl border border-[var(--m-border)] bg-white p-6 md:p-7 flex flex-col shadow-[var(--m-shadow-sm)]">
            <p className="text-[10.5px] tracking-[0.18em] uppercase font-semibold text-[var(--m-accent)]">
              For managers &amp; HR
            </p>
            <h3 className="font-display text-[24px] md:text-[27px] leading-tight tracking-tight text-[var(--m-ink)] mt-2">
              See your team without chasing.
            </h3>
            <p className="text-[14px] text-[var(--m-ink-2)] leading-relaxed mt-2 flex-1">
              A morning brief, auto-detected blockers, async standups,
              attendance and recognition — clarity and control without becoming
              the bottleneck.
            </p>
            <a
              href="#get-started"
              className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--m-accent-2)] hover:gap-2.5 transition-all"
            >
              Run it for my team
              <svg
                width={15}
                height={15}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  d="M5 12h14M13 5l7 7-7 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </div>
        </Reveal>

        {/* Individuals — the personal product (the new employee flow) */}
        <Reveal delay={100}>
          <div className="h-full rounded-2xl border border-[var(--m-accent)]/35 bg-gradient-to-br from-[var(--m-accent-soft)]/60 to-white p-6 md:p-7 flex flex-col shadow-[var(--m-shadow)] relative">
            <span className="absolute -top-3 right-6 text-[10.5px] tracking-[0.16em] uppercase font-semibold bg-[var(--m-accent)] text-white px-2.5 py-1 rounded-full">
              Free
            </span>
            <p className="text-[10.5px] tracking-[0.18em] uppercase font-semibold text-[var(--m-clay-deep)]">
              For individuals
            </p>
            <h3 className="font-display text-[24px] md:text-[27px] leading-tight tracking-tight text-[var(--m-ink)] mt-2">
              Get credit for your work.
            </h3>
            <p className="text-[14px] text-[var(--m-ink-2)] leading-relaxed mt-2 flex-1">
              Marina turns your real activity into an AI work journal and a
              review / 1:1 packet — so you never walk into a review
              empty-handed. No manager or team needed.
            </p>
            <a
              href="/individuals"
              className="mt-5 inline-flex items-center gap-2 self-start bg-[var(--m-accent)] text-white hover:bg-[var(--m-accent-2)] px-4 py-2 rounded-lg text-[14px] font-semibold shadow-[var(--m-shadow-sm)] transition-colors"
            >
              Start free for myself
              <svg
                width={15}
                height={15}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  d="M5 12h14M13 5l7 7-7 7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================ PROOF STRIP ============================ */

/**
 * The first thing a scrolling visitor sees after the hero: four giant
 * outcome numbers in display font. Numbers convert better than prose at
 * the top of the funnel — the reader skims, the eye locks on a digit,
 * the brain extrapolates "this saves me hours". No graphs. No icons we
 * have to explain. Just the bottom line.
 */
function ProofStrip() {
  const stats: Array<{
    value: string;
    suffix?: string;
    label: string;
    tone: "sage" | "clay" | "gold" | "ink";
  }> = [
    {
      value: "5+",
      suffix: "hrs",
      label: "Est. hours back per manager / week",
      tone: "sage",
    },
    { value: "0", label: "Status meetings needed", tone: "clay" },
    {
      value: "0",
      label: "Timesheets or standup forms to fill",
      tone: "gold",
    },
    {
      value: "1",
      suffix: "min",
      label: "To know how your team is doing",
      tone: "ink",
    },
  ];
  return (
    <section className="relative bg-[var(--m-ink)] text-white overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-30"
        style={{
          background:
            "radial-gradient(40% 60% at 50% 50%, rgba(63,107,84,0.5), transparent 70%)",
        }}
      />
      <div className="relative max-w-7xl mx-auto px-6 py-14 md:py-20">
        <Reveal>
          <p className="text-[10.5px] tracking-[0.22em] uppercase text-white/60 font-medium mb-2 text-center">
            The painkiller, by the numbers
          </p>
          <h2 className="font-display text-[26px] md:text-[34px] leading-tight tracking-tight text-center max-w-3xl mx-auto">
            What managers &amp; HR get back when MARINA goes live.
          </h2>
        </Reveal>

        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-10">
          {stats.map((s, i) => (
            <Reveal key={s.label} delay={i * 90}>
              <ProofStat {...s} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProofStat({
  value,
  suffix,
  label,
  tone,
}: {
  value: string;
  suffix?: string;
  label: string;
  tone: "sage" | "clay" | "gold" | "ink";
}) {
  const color =
    tone === "sage"
      ? "#a8d3b9"
      : tone === "clay"
        ? "#e8b89a"
        : tone === "gold"
          ? "#f5d488"
          : "#ffffff";
  return (
    <div className="text-center md:text-left">
      <p className="font-display tracking-tight leading-none" style={{ color }}>
        <span className="text-[64px] md:text-[88px]">{value}</span>
        {suffix && (
          <span className="text-[24px] md:text-[32px] ml-0.5 opacity-90">
            {suffix}
          </span>
        )}
      </p>
      <p className="mt-3 text-[13px] md:text-[14px] text-white/70 leading-snug max-w-[200px] mx-auto md:mx-0">
        {label}
      </p>
    </div>
  );
}

/* ============================ PAIN ============================ */

/**
 * "Without MARINA / With MARINA" — the painkiller pitch.
 *
 * Goal: a visitor scrolling past the hero needs to feel the daily ache
 * before we start showing them features. Most remote engineering managers
 * are running on adrenaline, hand-holding their team through Slack threads.
 * This section names that ache out loud, then shows the relief.
 */
function PainSection() {
  return (
    <section className="relative isolate overflow-hidden bg-[var(--m-bg-soft)]/60 border-y border-[var(--m-border)]">
      <div className="max-w-7xl mx-auto px-6 py-20 md:py-24">
        <Reveal>
          <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--m-clay-deep)] font-medium mb-3 text-center">
            Your Monday, right now
          </p>
          <h2 className="font-display text-[40px] md:text-[60px] leading-[1.02] tracking-tight text-center max-w-3xl mx-auto text-[var(--m-ink)]">
            Stop being the
            <br />
            <span className="italic brand-gradient-text">human dashboard.</span>
          </h2>
        </Reveal>

        <div className="mt-14 grid md:grid-cols-2 gap-5 items-stretch">
          <Reveal delay={0} className="h-full">
            <article className="h-full rounded-2xl border border-[#f1d5d6] bg-[#fbf2f2]/60 p-7 md:p-9">
              <div className="flex items-center gap-2 mb-6">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--m-bad)] text-white text-[16px] font-bold">
                  ✕
                </span>
                <p className="text-[12px] uppercase tracking-[0.18em] text-[var(--m-bad)] font-semibold">
                  Without MARINA
                </p>
              </div>
              <ul className="space-y-4">
                <PainRow
                  headline="3 standups a week"
                  sub="Mostly &ldquo;catching up.&rdquo;"
                />
                <PainRow
                  headline="20+ status pings / day"
                  sub="Just to know what shipped."
                />
                <PainRow
                  headline="5 tabs always open"
                  sub="Slack, GitHub, calendar, Notion, Linear."
                />
                <PainRow
                  headline="Blockers found on Friday"
                  sub="Should have surfaced Tuesday."
                />
                <PainRow
                  headline="Silent underperformers"
                  sub="Hide for weeks. Surprise you in reviews."
                />
                <PainRow
                  headline="Reviews written from memory"
                  sub="Not from evidence."
                />
              </ul>
              <p className="mt-7 text-[15px] text-[var(--m-bad)] font-semibold tracking-tight">
                The team works. You worry.
              </p>
            </article>
          </Reveal>

          <Reveal delay={120} className="h-full">
            <article className="h-full rounded-2xl border border-[var(--m-accent)]/40 bg-gradient-to-br from-[var(--m-accent-soft)]/50 to-white p-7 md:p-9 shadow-[var(--m-shadow-xl)] relative">
              <span className="absolute -top-3 right-6 text-[10.5px] tracking-[0.18em] uppercase font-semibold bg-[var(--m-accent)] text-white px-2.5 py-1 rounded-full">
                With MARINA
              </span>
              <div className="flex items-center gap-2 mb-6">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--m-accent)] text-white">
                  <svg
                    width={16}
                    height={16}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.8}
                  >
                    <path
                      d="M5 13l4 4 10-10"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <p className="text-[12px] uppercase tracking-[0.18em] text-[var(--m-accent)] font-semibold">
                  Painkiller mode
                </p>
              </div>
              <ul className="space-y-4">
                <GainRow
                  headline="1 brief / morning"
                  sub="No standup needed."
                />
                <GainRow
                  headline="Blockers auto-detected"
                  sub="The moment they appear."
                />
                <GainRow
                  headline="1 calm dashboard"
                  sub="Ships, focus, meetings, risk."
                />
                <GainRow
                  headline="Ask MARINA anything"
                  sub="Grounded, cited answers in seconds."
                />
                <GainRow
                  headline="Weekly digests written for you"
                  sub="1:1 prep, too."
                />
                <GainRow
                  headline="Reviews from real evidence"
                  sub="No memory required."
                />
              </ul>
              <p className="mt-7 text-[15px] text-[var(--m-accent-2)] font-semibold tracking-tight">
                The team works. You lead.
              </p>
            </article>
          </Reveal>
        </div>

        <Reveal delay={240}>
          <p className="mt-12 text-center font-display text-[20px] md:text-[24px] text-[var(--m-ink)] italic max-w-2xl mx-auto leading-snug">
            &ldquo;People buy painkillers, not vitamins.&rdquo;
            <span className="not-italic block text-[13.5px] text-[var(--m-ink-3)] mt-2 font-sans">
              MARINA is the painkiller.
            </span>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function PainRow({ headline, sub }: { headline: string; sub: string }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className="mt-2 shrink-0 inline-block w-2 h-2 rounded-full bg-[var(--m-bad)]"
      />
      <div className="leading-snug">
        <p className="text-[16px] font-semibold text-[var(--m-ink)] tracking-tight">
          {headline}
        </p>
        <p
          className="text-[12.5px] text-[var(--m-ink-3)] mt-0.5"
          dangerouslySetInnerHTML={{ __html: sub }}
        />
      </div>
    </li>
  );
}
function GainRow({ headline, sub }: { headline: string; sub: string }) {
  return (
    <li className="flex items-start gap-3">
      <svg
        viewBox="0 0 24 24"
        width={16}
        height={16}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        className="mt-1.5 shrink-0 text-[var(--m-accent)]"
      >
        <path
          d="M5 13l4 4 10-10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="leading-snug">
        <p className="text-[16px] font-semibold text-[var(--m-ink)] tracking-tight">
          {headline}
        </p>
        <p
          className="text-[12.5px] text-[var(--m-ink-3)] mt-0.5"
          dangerouslySetInnerHTML={{ __html: sub }}
        />
      </div>
    </li>
  );
}

/* ============================ VALUE PROPS ============================ */

function ValueProps() {
  return (
    <section id="product" className="max-w-7xl mx-auto px-6 py-20 md:py-28">
      <Reveal>
        <div className="max-w-3xl">
          <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--m-accent)] font-medium mb-4">
            What you get back
          </p>
          <h2 className="font-display text-[40px] md:text-[60px] leading-[1.0] tracking-tight text-[var(--m-ink)]">
            <span className="italic brand-gradient-text">Clarity.</span>{" "}
            Alignment.
            <br />
            Control.
          </h2>
        </div>
      </Reveal>

      <div className="mt-14 grid md:grid-cols-3 gap-5 items-stretch">
        <Reveal delay={0} className="h-full">
          <ValueCard
            eyebrow="Clarity"
            metric="1 brief"
            metricSub="every morning"
            title="See your team without asking."
            body="Every commit, meeting, deliverable, and leave &mdash; summarised for you daily."
            tone="sage"
          />
        </Reveal>
        <Reveal delay={120} className="h-full">
          <ValueCard
            eyebrow="Confidence"
            metric="2 sec"
            metricSub="to any answer"
            title="Ask MARINA anything."
            body="&ldquo;What did Sneha ship?&rdquo; &ldquo;Who&rsquo;s burning out?&rdquo; Grounded. Cited. Done."
            tone="clay"
          />
        </Reveal>
        <Reveal delay={240} className="h-full">
          <ValueCard
            eyebrow="Control"
            metric="0"
            metricSub="follow-ups to write"
            title="Reviews. Digests. 1:1 prep."
            body="Written for you from evidence, not memory."
            tone="gold"
          />
        </Reveal>
      </div>
    </section>
  );
}

function ValueCard({
  eyebrow,
  metric,
  metricSub,
  title,
  body,
  tone,
}: {
  eyebrow: string;
  metric: string;
  metricSub: string;
  title: string;
  body: string;
  tone: "sage" | "clay" | "gold";
}) {
  const bgGradient = {
    sage: "linear-gradient(160deg, rgba(63,107,84,0.10), rgba(63,107,84,0.02))",
    clay: "linear-gradient(160deg, rgba(196,123,86,0.10), rgba(196,123,86,0.02))",
    gold: "linear-gradient(160deg, rgba(193,154,77,0.10), rgba(193,154,77,0.02))",
  }[tone];
  const dot = {
    sage: "var(--m-accent)",
    clay: "var(--m-clay)",
    gold: "var(--m-gold)",
  }[tone];
  return (
    <div
      className="lift-on-hover h-full rounded-2xl p-7 border border-[var(--m-border)] bg-white shadow-[var(--m-shadow-sm)] relative overflow-hidden"
      style={{ background: bgGradient }}
    >
      <div
        className="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl opacity-50"
        style={{ background: dot }}
      />
      <p
        className="text-[10.5px] tracking-[0.18em] uppercase font-semibold relative"
        style={{ color: dot }}
      >
        {eyebrow}
      </p>

      {/* Hero metric — the visual anchor */}
      <p
        className="mt-5 font-display leading-none relative flex items-baseline gap-2"
        style={{ color: dot }}
      >
        <span className="text-[52px] md:text-[64px] tracking-tight">
          {metric}
        </span>
        <span className="text-[12.5px] text-[var(--m-ink-3)] font-sans font-normal lowercase">
          {metricSub}
        </span>
      </p>

      <h3 className="mt-5 font-display text-[24px] leading-tight text-[var(--m-ink)] relative">
        {title}
      </h3>
      <p
        className="mt-2 text-[14px] text-[var(--m-ink-2)] leading-relaxed relative"
        dangerouslySetInnerHTML={{ __html: body }}
      />
    </div>
  );
}

/* ============================ PRODUCT SECTION ============================ */

function ProductSection() {
  return (
    <section
      id="product"
      className="scroll-mt-20 bg-[var(--m-bg-soft)] border-y border-[var(--m-border)]"
    >
      <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5 min-w-0">
            <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--m-clay)] font-medium mb-4">
              This is the product
            </p>
            <h2 className="font-display text-[32px] md:text-[44px] leading-[1.1] tracking-tight">
              Open Marina, and every teammate&rsquo;s day is{" "}
              <span className="italic brand-gradient-text">
                already written up.
              </span>
            </h2>
            <p className="mt-5 text-[15px] text-[var(--m-ink-2)] leading-relaxed">
              No forms, no standup, no chasing. Marina reads the real signals
              &mdash; GitHub activity, calendar, focus time &mdash; and hands
              you a grounded, cited summary of what each person shipped, where
              their time went, and what needs you. Every line points back to its source.
            </p>
            <ul className="mt-6 space-y-2.5 text-[13.5px] text-[var(--m-ink-2)]">
              <Bullet>
                Specific PR titles + commit subjects, not just counts
              </Bullet>
              <Bullet>Top apps used today, work vs non-work mix</Bullet>
              <Bullet>A daily story timeline of what they worked on</Bullet>
            </ul>
          </div>
          <div className="lg:col-span-7 min-w-0">
            <BriefPreview />
          </div>
        </div>
      </div>
    </section>
  );
}

function BriefPreview() {
  return (
    <div className="rounded-2xl bg-white border border-[var(--m-border)] shadow-[var(--m-shadow-lg)] p-6">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex w-10 h-10 rounded-lg bg-[var(--m-accent-soft)] items-center justify-center text-[var(--m-accent)] font-semibold">
            P
          </span>
          <div>
            <p className="text-[14px] font-medium text-[var(--m-ink)]">
              Priya Nair
            </p>
            <p className="text-[11.5px] text-[var(--m-ink-3)]">
              Senior · @priya
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 text-[10.5px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--m-good-soft)] text-[var(--m-good)]">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--m-good)]" />
          On a strong stretch
        </span>
      </div>

      {/* Timeline ribbon */}
      <div className="mb-4">
        <div className="flex justify-between text-[9.5px] text-[var(--m-ink-4)] mb-1 tabular-nums">
          <span>9:15 AM</span>
          <span>6:42 PM</span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-[var(--m-bg-soft)]">
          <div style={{ width: "12%", background: "var(--m-info)" }} />
          <div style={{ width: "28%", background: "var(--m-accent)" }} />
          <div style={{ width: "6%", background: "var(--m-warn)" }} />
          <div style={{ width: "22%", background: "var(--m-accent)" }} />
          <div style={{ width: "8%", background: "var(--m-info)" }} />
          <div style={{ width: "14%", background: "var(--m-clay)" }} />
          <div style={{ width: "10%", background: "var(--m-accent-2)" }} />
        </div>
      </div>

      {/* What shipped */}
      <p className="text-[10.5px] tracking-wider uppercase font-semibold text-[var(--m-ink-4)] mb-2">
        What shipped
      </p>
      <ul className="space-y-1.5 text-[13px]">
        <li className="flex items-center gap-2">
          <span className="text-[9.5px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--m-clay-soft)] text-[var(--m-clay-deep)]">
            PR
          </span>
          <span className="text-[var(--m-ink)] flex-1 truncate">
            Fix double-submit on leave form
          </span>
          <span className="text-[var(--m-ink-4)] text-[11px]">acme/web</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="text-[9.5px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--m-good-soft)] text-[var(--m-good)]">
            commit
          </span>
          <span className="text-[var(--m-ink)] flex-1 truncate">
            Bump react to 19.2 + migrate compiler
          </span>
          <span className="text-[var(--m-ink-4)] text-[11px]">acme/api</span>
        </li>
        <li className="flex items-center gap-2">
          <span className="text-[9.5px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--m-info-soft)] text-[var(--m-info)]">
            review
          </span>
          <span className="text-[var(--m-ink)] flex-1 truncate">
            Review: refactor auth middleware
          </span>
          <span className="text-[var(--m-ink-4)] text-[11px]">acme/api</span>
        </li>
      </ul>

      <p className="mt-4 text-[10.5px] tracking-wider uppercase font-semibold text-[var(--m-ink-4)] mb-2">
        Where time went today
      </p>
      <div className="flex rounded-full overflow-hidden h-1.5 mb-2">
        <div style={{ width: "45%", background: "var(--m-accent)" }} />
        <div style={{ width: "20%", background: "var(--m-clay)" }} />
        <div style={{ width: "15%", background: "var(--m-info)" }} />
        <div style={{ width: "20%", background: "var(--m-bg-soft)" }} />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-[var(--m-ink-3)] flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-sm bg-[var(--m-accent)]" />
          VS Code 3h 12m
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-sm bg-[var(--m-clay)]" />
          Figma 1h 25m
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-sm bg-[var(--m-info)]" />
          Slack 58m
        </span>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <svg
        width={16}
        height={16}
        viewBox="0 0 20 20"
        className="shrink-0 mt-0.5 text-[var(--m-accent)]"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <circle cx="10" cy="10" r="8" />
        <path
          d="M6.5 10.5l2.5 2.5 4.5-5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{children}</span>
    </li>
  );
}

/* ============================ SHOWCASE ============================ */

/**
 * Four feature mockups in alternating layout. The visual cadence is
 * deliberate: each block leads with a verb-driven headline ("Unstick",
 * "Lead", "Understand", "See") so visitors can tell at a glance what the
 * feature actually does in their hands.
 */
function ShowcaseSection() {
  const blocks: Array<{
    eyebrow: string;
    title: React.ReactNode;
    body: string;
    bullets: string[];
    mockup: React.ReactNode;
    flip?: boolean;
  }> = [
    {
      eyebrow: "Ask MARINA · USP",
      title: (
        <>
          Ask anything about anyone.{" "}
          <span className="italic brand-gradient-text">
            Get a grounded answer in seconds.
          </span>
        </>
      ),
      body: "Real data. Plain English. No dashboards to decode, no people to chase.",
      bullets: [
        "Every answer cites the evidence",
        "Burnout & blockers surface on their own",
        "Manager-only. Scoped to your reports.",
      ],
      mockup: <AskMarinaMockup />,
    },
    {
      eyebrow: "AI Daily Brief",
      title: (
        <>
          The 4-minute team report,{" "}
          <span className="italic">written for you every morning</span>
        </>
      ),
      body: "What shipped. Who needs attention. What to do about it. Drafted from evidence, not a form.",
      bullets: [
        "AI summary of the team's week",
        "Risk detection: burnout, slipping work",
        "Specific next actions, never vague advice",
      ],
      mockup: <AiBriefMockup />,
      flip: true,
    },
    {
      eyebrow: "Blocker Resolver",
      title: (
        <>
          Unstick teammates{" "}
          <span className="italic brand-gradient-text">in one click</span>
        </>
      ),
      body: "See who's waiting, on whom, for how long. Nudge or reroute without Slack archaeology.",
      bullets: [
        "Live context: presence + last activity",
        "Route to a backup in one click",
        "Ping in-app, Slack, email, desktop",
      ],
      mockup: <BlockerResolverMockup />,
    },
    {
      eyebrow: "Scrum Mode",
      title: (
        <>
          Run a <span className="italic">25-minute standup in 9</span>
        </>
      ),
      body: "Yesterday, today, blockers — pre-filled. Arrow keys to advance. Space to mark covered.",
      bullets: [
        "Auto-drafted from GitHub + calendar",
        "Coverage saved per day, per team",
        "Keyboard-driven, room stays focused",
      ],
      mockup: <ScrumModeMockup />,
      flip: true,
    },
    {
      eyebrow: "Member Detail",
      title: (
        <>
          Understand each teammate,{" "}
          <span className="italic brand-gradient-text">no graphs to read</span>
        </>
      ),
      body: "What they're doing now. What they shipped. How they're trending. Engineer, designer, or sales — same modal.",
      bullets: [
        "5 tabs. Zero learning curve.",
        "Story-driven Today timeline",
        "Adapts to each role automatically",
      ],
      mockup: <MemberDetailMockup />,
    },
    {
      eyebrow: "Activity Feed",
      title: (
        <>
          See the team move <span className="italic">in real time</span>
        </>
      ),
      body: "Ships. Blockers. Deals. All in one stream. Same room — even when nobody's in the room.",
      bullets: [
        "One feed, every discipline",
        "Per-role icons so signal stays clear",
        "Scoped to the people you manage.",
      ],
      mockup: <ActivityFeedMockup />,
      flip: true,
    },
    {
      eyebrow: "Teams + Org chart",
      title: (
        <>
          Map your workspace,{" "}
          <span className="italic brand-gradient-text">visually</span>
        </>
      ),
      body: "Drag-and-drop reports-to. Living org chart. HR builds it once. Everyone sees who's where.",
      bullets: [
        "Multi-manager DAG, real chains",
        "One person, many teams",
        "Print, export SVG, share as a one-pager",
      ],
      mockup: <TeamsMockup />,
    },
  ];

  return (
    <section className="bg-[var(--m-bg)]">
      <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
        <Reveal>
          <div className="max-w-2xl mb-14">
            <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--m-clay)] font-medium mb-4">
              See the AI at work
            </p>
            <h2 className="font-display text-[40px] md:text-[56px] leading-[1.02] tracking-tight">
              Not another dashboard.{" "}
              <p className="italic brand-gradient-text">
                A Chief of Staff in your inbox.
              </p>
            </h2>
            <p className="mt-5 text-[15.5px] md:text-[16px] text-[var(--m-ink-2)] leading-relaxed">
              Every screen below is a real MARINA surface &mdash; the ones you
              and your team live in, day to day &mdash; shown here with sample
              data.
            </p>
          </div>
        </Reveal>

        <div className="space-y-16 md:space-y-24">
          {blocks.map((b, i) => (
            <Reveal key={i} delay={i * 80}>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center">
                <div
                  className={`min-w-0 lg:col-span-5 ${b.flip ? "lg:order-2" : ""}`}
                >
                  <p className="text-[10.5px] tracking-[0.18em] uppercase text-[var(--m-accent)] font-semibold mb-3">
                    {b.eyebrow}
                  </p>
                  <h3 className="font-display text-[28px] md:text-[36px] leading-[1.08] tracking-tight text-[var(--m-ink)]">
                    {b.title}
                  </h3>
                  <p className="mt-4 text-[15px] text-[var(--m-ink-2)] leading-relaxed">
                    {b.body}
                  </p>
                  <ul className="mt-5 space-y-2.5 text-[13.5px] text-[var(--m-ink-2)]">
                    {b.bullets.map((bullet) => (
                      <Bullet key={bullet}>{bullet}</Bullet>
                    ))}
                  </ul>
                </div>
                <div
                  className={`min-w-0 lg:col-span-7 ${b.flip ? "lg:order-1" : ""}`}
                >
                  {b.mockup}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================ WORKFLOWS ============================ */

function Workflows() {
  const items = [
    {
      eyebrow: "Standup Mode",
      stat: "9 min",
      title: "Run a 9-minute standup.",
      body: "Projection-mode. Arrow keys to advance. Yesterday / today / blockers pre-filled.",
    },
    {
      eyebrow: "Blockers",
      stat: "0 hops",
      title: "Unstuck in one click.",
      body: '"Waiting on @X" surfaces live. Nudge, reroute, or jump in.',
    },
    {
      eyebrow: "Attendance",
      stat: "0 sheets",
      title: "Auto-tracked. No spreadsheets.",
      body: "Punch-in, leaves, balances and Indian public holidays — all in one calendar.",
    },
    {
      eyebrow: "Briefs",
      stat: "Mon 9am",
      title: "CEO digest, every Monday.",
      body: "What shipped. Who's blocked. Who needs attention. Who's out.",
    },
  ];
  return (
    <section id="workflows" className="max-w-7xl mx-auto px-6 py-20 md:py-28">
      <div className="max-w-2xl mb-12">
        <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--m-accent)] font-medium mb-4">
          Workflows
        </p>
        <h2 className="font-display text-[40px] md:text-[56px] leading-[1.02] tracking-tight">
          High performance,{" "}
          <span className="italic brand-gradient-text">on rails.</span>
        </h2>
      </div>
      <div className="grid md:grid-cols-2 gap-5 items-stretch">
        {items.map((it, i) => (
          <Reveal key={it.title} delay={i * 100} className="h-full">
            <div className="lift-on-hover h-full rounded-2xl bg-white border border-[var(--m-border)] p-7 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10.5px] tracking-[0.18em] uppercase font-semibold text-[var(--m-clay)]">
                  {it.eyebrow}
                </p>
                <p className="font-display text-[22px] text-[var(--m-clay-deep)] tracking-tight">
                  {it.stat}
                </p>
              </div>
              <h3 className="mt-1 font-display text-[26px] leading-tight text-[var(--m-ink)]">
                {it.title}
              </h3>
              <p className="text-[14px] leading-relaxed text-[var(--m-ink-2)]">
                {it.body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ============================ ROSTER SHOWCASE ============================ */

/**
 * 50-character avatar wall. Renders every character in the roster as a
 * pixel-art bust — visitors see them all and can pick a vibe before
 * signing up. Names are intentionally generic ("The Iron Knight", "The
 * Web Crawler") — the silhouette tells you exactly who it&apos;s evoking
 * without us using a trademarked name in the marketing copy.
 *
 * Layout is a tight grid that flexes 4→6→8 columns across breakpoints so
 * the wall feels dense at desktop and stays readable on phones.
 */
function RosterShowcase() {
  return (
    <section className="bg-[var(--m-bg)] border-y border-[var(--m-border)]/60">
      <div className="max-w-7xl mx-auto px-6 py-20 md:py-28">
        <Reveal>
          <div className="max-w-3xl mx-auto text-center mb-12">
            <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--m-clay)] font-medium mb-3">
              Pick your character
            </p>
            <h2 className="font-display text-[36px] md:text-[48px] leading-[1.05] tracking-tight">
              Fifty heroes,{" "}
              <span className="italic brand-gradient-text">
                one for every personality
              </span>
            </h2>
            <p className="mt-5 text-[15px] md:text-[16px] text-[var(--m-ink-2)] leading-relaxed">
              Marvel hero, anime legend, fantasy wizard, masked vigilante —
              there&apos;s a pixel bust that fits how you see yourself at work.
              Pick one when you join, and your team spots you across every
              dashboard at a glance.
            </p>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3 md:gap-4">
            {CHARACTERS.map((c) => (
              <div
                key={c.key}
                className="group flex items-center justify-center rounded-xl bg-white border border-[var(--m-border)] aspect-square p-2 hover:shadow-[var(--m-shadow)] hover:-translate-y-0.5 transition-all"
                title={c.name}
              >
                <CharacterAvatar characterKey={c.key} size={64} />
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={240}>
          <p className="mt-10 text-center text-[12.5px] text-[var(--m-ink-3)]">
            One character per workspace — once a teammate claims The Last Son,
            they&apos;re the only Last Son on the dashboard.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================ INTEGRATIONS ============================ */

function Integrations() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            "linear-gradient(135deg, rgba(63,107,84,0.18) 0%, rgba(196,123,86,0.10) 50%, rgba(193,154,77,0.14) 100%)",
        }}
      />
      <div className="max-w-7xl mx-auto px-6 py-20 md:py-24 text-center">
        <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--m-ink-2)] font-medium mb-3">
          Integrations
        </p>
        <h2 className="font-display text-[36px] md:text-[52px] leading-tight tracking-tight text-[var(--m-ink)] max-w-3xl mx-auto">
          Plug into your stack.{" "}
          <span className="italic brand-gradient-text">Clean signal out.</span>
        </h2>

        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
          {[
            { name: "GitHub", live: true },
            { name: "Slack", live: true },
            { name: "Google Calendar", live: true },
            { name: "Mac + Windows agent", live: true },
            { name: "Linear", live: false },
            { name: "Jira", live: false },
            { name: "Notion", live: false },
            { name: "WhatsApp", live: false },
          ].map((n) => (
            <div
              key={n.name}
              className="rounded-xl bg-white border border-[var(--m-border)] py-4 px-3 text-[12.5px] text-[var(--m-ink-2)] font-medium shadow-[var(--m-shadow-sm)] hover:shadow-[var(--m-shadow)] transition-shadow relative"
            >
              {n.name}
              {!n.live && (
                <span className="ml-1.5 text-[9.5px] uppercase tracking-wider text-[var(--m-ink-4)]">
                  soon
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================ EARLY ACCESS ============================ */

/**
 * Founding-cohort CTA shown in place of paid pricing during the early-access
 * phase. We're onboarding our first companies for free to harden the product
 * with real teams before we switch paid tiers on. Framing is "founding
 * partner", never "tester" — these are real customers getting in early.
 *
 * Keeps `id="pricing"` as the anchor so the nav/footer "Pricing" links still
 * scroll here without a 404-feeling dead anchor. When paid tiers return, swap
 * <EarlyAccess/> back to <Pricing/> in the page composition above.
 */
function EarlyAccess() {
  const perks: Array<{
    title: string;
    body: string;
    tone: "sage" | "clay" | "gold";
  }> = [
    {
      tone: "sage",
      title: "Free while you're in the cohort",
      body: "Every feature, every seat, no card. You only ever consider paying once MARINA has already saved you hours.",
    },
    {
      tone: "clay",
      title: "A direct line to the founder",
      body: "Shared Slack channel. Your feature requests jump the queue and ship in days, not quarters.",
    },
    {
      tone: "gold",
      title: "Founding pricing, locked for life",
      body: "When paid plans launch, you keep the lowest price we ever offer — for as long as you stay.",
    },
  ];
  return (
    <section id="pricing" className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, #1f3d2c 0%, #2f5240 30%, #3f6b54 60%, #c19a4d 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(50% 60% at 50% 25%, rgba(255,255,255,0.16), transparent 70%)",
        }}
      />
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28 text-white">
        <Reveal>
          <div className="text-center max-w-2xl mx-auto">
            <p className="inline-flex items-center gap-2 text-[11px] tracking-[0.18em] uppercase text-white/75 font-medium mb-4">
              <span className="relative inline-flex">
                <span className="absolute inset-0 rounded-full bg-white/50 m-slow-pulse" />
                <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-white" />
              </span>
              Founding cohort · limited spots
            </p>
            <h2 className="font-display text-[40px] md:text-[60px] leading-[1.0] tracking-tight">
              Run MARINA free.
              <br />
              <span className="italic">Help shape it.</span>
            </h2>
            <p className="mt-5 text-[15px] md:text-[17px] text-white/85 leading-relaxed max-w-xl mx-auto">
              We&apos;re hand-picking a small group of remote teams to go live
              on MARINA before anyone else &mdash; completely free. You get the
              full product and a direct hand in where it goes next.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid md:grid-cols-3 gap-4">
          {perks.map((p, i) => {
            const accent =
              p.tone === "sage"
                ? "#a8d3b9"
                : p.tone === "clay"
                  ? "#e8b89a"
                  : "#f5d488";
            return (
              <Reveal key={p.title} delay={i * 100} className="h-full">
                <div className="h-full rounded-2xl bg-white/[0.07] border border-white/15 backdrop-blur-sm p-6">
                  <span
                    className="inline-flex w-9 h-9 rounded-xl items-center justify-center mb-4"
                    style={{
                      background: "rgba(255,255,255,0.12)",
                      color: accent,
                    }}
                  >
                    <svg
                      width={17}
                      height={17}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.4}
                    >
                      <path
                        d="M5 13l4 4 10-10"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <h3 className="font-display text-[20px] leading-tight text-white">
                    {p.title}
                  </h3>
                  <p className="mt-2 text-[13.5px] text-white/75 leading-relaxed">
                    {p.body}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>

        <Reveal delay={240}>
          <div className="mt-12 flex flex-col items-center gap-5">
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <a
                href="#get-started"
                className="inline-flex items-center gap-2 bg-white text-[var(--m-ink)] hover:bg-white/95 px-6 py-3 rounded-lg text-[14.5px] font-semibold shadow-lg transition"
              >
                Start free
                <svg
                  width={15}
                  height={15}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    d="M5 12h14M13 5l7 7-7 7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              <a
                href="/demo"
                className="text-[14px] text-white/90 hover:text-white border border-white/30 hover:border-white/60 rounded-lg px-6 py-3 transition"
              >
                Or book a demo
              </a>
            </div>

            {/* Honest trust signals — no fabricated logos or testimonials.
                Each one is a real promise we keep during early access. */}
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px] text-white/70">
              {[
                "Free for your first 5 teammates",
                "No credit card, no contract",
                "Your data stays private",
                "A direct line to the founder",
              ].map((t) => (
                <li key={t} className="inline-flex items-center gap-1.5">
                  <svg
                    width={13}
                    height={13}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.4}
                    className="text-white/80"
                  >
                    <path
                      d="M5 13l4 4 10-10"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================ PRICING (hidden during early access) ============================ */

function Pricing() {
  const plans = [
    {
      name: "Free",
      price: "₹0",
      period: "forever",
      roi: "Replaces your daily status pings — about 3 hours / week back.",
      blurb: "For up to 5 teammates. Get started, prove the value.",
      features: [
        "Up to 5 teammates",
        "AI weekly briefs",
        "Blockers panel",
        "Mac + Windows agents",
        "Email support",
      ],
      cta: "Start free",
      tone: "plain",
    },
    {
      name: "Team",
      price: "₹499",
      period: "per operator / month",
      roi: "Saves engineering managers 5+ hours every week. Pays for itself the first day.",
      blurb: "For founders and small teams shipping fast.",
      features: [
        "Everything in Free",
        "Unlimited teammates",
        "CEO weekly digest",
        "Standup Mode",
        "Slack + WhatsApp bots",
        "Compliance pack (IN + global)",
        "24h support SLA",
      ],
      cta: "Start free trial",
      tone: "sage",
    },
    {
      name: "Scale",
      price: "₹899",
      period: "per operator / month",
      roi: "Replaces a junior Chief of Staff. ~₹40k / month in ops time, recovered.",
      blurb: "When procurement starts asking questions.",
      features: [
        "Everything in Team",
        "SSO (Google / Microsoft)",
        "Custom roles + permissions",
        "India-region data residency",
        "DPA + security review",
        "Dedicated CSM",
      ],
      cta: "Talk to us",
      tone: "plain",
    },
  ];
  return (
    <section id="pricing" className="max-w-7xl mx-auto px-6 py-20 md:py-28">
      <div className="text-center max-w-2xl mx-auto mb-12">
        <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--m-accent)] font-medium mb-3">
          Pricing
        </p>
        <h2 className="font-display text-[36px] md:text-[48px] leading-tight tracking-tight">
          Priced in{" "}
          <span className="italic brand-gradient-text">hours saved</span>,<br />
          not seats sold.
        </h2>
        <p className="mt-4 text-[15px] text-[var(--m-ink-2)]">
          The average manager wastes 8 hours a week on status, follow-ups, and
          writing things up. MARINA gives most of that back — for less than what
          you spend on coffee.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-5 items-stretch">
        {plans.map((p) => {
          const featured = p.tone === "sage";
          return (
            <div
              key={p.name}
              className={`flex flex-col rounded-2xl border bg-white p-7 transition-all ${
                featured
                  ? "border-[var(--m-accent)] shadow-[var(--m-shadow-xl)] relative md:-mt-2"
                  : "border-[var(--m-border)] shadow-[var(--m-shadow-sm)] hover:shadow-[var(--m-shadow)]"
              }`}
            >
              {featured && (
                <p className="absolute -top-3 left-1/2 -translate-x-1/2 inline-block text-[10.5px] font-semibold tracking-wider uppercase text-white bg-[var(--m-accent)] px-2.5 py-0.5 rounded-full">
                  Most popular
                </p>
              )}
              <h3 className="font-display text-[24px] text-[var(--m-ink)]">
                {p.name}
              </h3>
              <p
                className={`mt-3 text-[14.5px] font-medium leading-snug ${
                  featured ? "text-[var(--m-accent-2)]" : "text-[var(--m-ink)]"
                }`}
              >
                {p.roi}
              </p>
              <div className="mt-3 flex items-baseline gap-1.5 text-[var(--m-ink-3)]">
                <span className="font-display text-[26px] tracking-tight">
                  {p.price}
                </span>
                <span className="text-[11.5px]">{p.period}</span>
              </div>
              <p className="mt-1.5 text-[13px] text-[var(--m-ink-2)]">
                {p.blurb}
              </p>
              <ul className="mt-6 space-y-2.5 text-[13px] text-[var(--m-ink-2)] flex-1">
                {p.features.map((f) => (
                  <Bullet key={f}>{f}</Bullet>
                ))}
              </ul>
              <a
                href="#cta"
                className={`mt-7 inline-flex w-full justify-center font-medium text-[13.5px] py-2.5 rounded-lg transition ${
                  featured
                    ? "bg-[var(--m-ink)] text-white hover:bg-[var(--m-ink-2)]"
                    : "border border-[var(--m-border)] text-[var(--m-ink-2)] hover:bg-[var(--m-bg)]"
                }`}
              >
                {p.cta}
              </a>
            </div>
          );
        })}
      </div>
      <p className="text-center mt-8 text-[12px] text-[var(--m-ink-3)]">
        All prices in INR, exclusive of 18% GST. GST-compliant invoices issued
        automatically.
      </p>
    </section>
  );
}

/* ============================ RESOURCE CARDS ============================ */

function ResourceCards() {
  const items = [
    {
      tone: "sage",
      title: "Library",
      body: "Explore the ultimate resource center for people management and HR ops.",
      icon: BookIcon,
    },
    {
      tone: "clay",
      title: "MARINA University",
      body: "Curriculum, training, and templates to build and implement successful people programs.",
      icon: GraduationIcon,
    },
    {
      tone: "gold",
      title: "Community",
      body: "Join the Resources for Humans community to connect with founders and team leads running distributed teams.",
      icon: PeopleIcon,
    },
    {
      tone: "sage",
      title: "Events",
      body: "Live and recorded webinars on all things people management and HR.",
      icon: SparkIcon,
    },
  ];
  return (
    <section className="bg-[var(--m-bg-soft)] border-y border-[var(--m-border)]">
      <div className="max-w-7xl mx-auto px-6 py-20 md:py-24">
        <div className="max-w-2xl mb-12">
          <p className="text-[11px] tracking-[0.18em] uppercase text-[var(--m-accent)] font-medium mb-3">
            Resources
          </p>
          <h2 className="font-display text-[32px] md:text-[42px] leading-tight tracking-tight">
            Power your{" "}
            <span className="italic">high-performing organization</span>
          </h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {items.map((it, i) => {
            const Icon = it.icon;
            const dot =
              it.tone === "sage"
                ? "var(--m-accent)"
                : it.tone === "clay"
                  ? "var(--m-clay)"
                  : "var(--m-gold)";
            const bg =
              it.tone === "sage"
                ? "var(--m-accent-soft)"
                : it.tone === "clay"
                  ? "var(--m-clay-soft)"
                  : "var(--m-gold-soft)";
            return (
              <a
                key={i}
                href="#"
                className="rounded-2xl bg-white border border-[var(--m-border)] p-6 hover:shadow-[var(--m-shadow-lg)] hover:-translate-y-0.5 transition-all block"
              >
                <span
                  className="inline-flex w-10 h-10 rounded-xl items-center justify-center mb-4"
                  style={{ background: bg, color: dot }}
                >
                  <Icon />
                </span>
                <h3 className="font-display text-[20px] text-[var(--m-ink)] leading-tight">
                  {it.title}
                </h3>
                <p className="mt-2 text-[13px] text-[var(--m-ink-2)] leading-relaxed">
                  {it.body}
                </p>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============================ FINAL CTA ============================ */

function FinalCTA({
  githubSignIn,
  googleSignIn,
}: {
  githubSignIn: () => Promise<void>;
  googleSignIn: (() => Promise<void>) | null;
}) {
  return (
    <section id="cta" className="relative isolate overflow-hidden">
      {/* `isolate` creates a local stacking context so the gradient sits
          behind the content without being pushed under the page's own
          cream background by negative z-index. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, #1f3d2c 0%, #2f5240 28%, #3f6b54 55%, #c19a4d 100%)",
        }}
      />
      {/* Subtle inner glow + grain so the gradient doesn't look flat */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            "radial-gradient(50% 60% at 50% 30%, rgba(255,255,255,0.18), transparent 70%)",
        }}
      />
      <div className="relative max-w-4xl mx-auto px-6 py-24 md:py-32 text-center text-white">
        <p className="text-[11px] tracking-[0.18em] uppercase text-white/80 font-medium mb-4">
          Ready when you are
        </p>
        <h2 className="font-display text-[40px] md:text-[56px] leading-[1.05] tracking-tight">
          Your people are <br />
          <span className="italic">your business</span>
        </h2>
        <p className="mt-5 max-w-xl mx-auto text-[15px] text-white/85 leading-relaxed">
          Ensure both are successful with MARINA. Free for the first 5
          teammates. ₹0 trial for 30 days on every paid plan. No credit card
          needed.
        </p>

        <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
          <form action={githubSignIn}>
            <button
              type="submit"
              className="inline-flex items-center gap-2 bg-white text-[var(--m-ink)] hover:bg-white/95 px-5 py-2.5 rounded-lg text-[14px] font-medium shadow-lg transition"
            >
              <GhIcon />
              Continue with GitHub
            </button>
          </form>
          {googleSignIn && (
            <form action={googleSignIn}>
              <button
                type="submit"
                className="inline-flex items-center gap-2 bg-white text-[var(--m-ink)] hover:bg-white/95 px-5 py-2.5 rounded-lg text-[14px] font-medium shadow-lg transition"
              >
                <CtaGoogleIcon />
                Continue with Google
              </button>
            </form>
          )}
          <a
            href="/demo"
            className="text-[14px] text-white/90 hover:text-white border border-white/30 hover:border-white/60 rounded-lg px-5 py-2.5 transition"
          >
            Book a demo
          </a>
        </div>
      </div>
    </section>
  );
}

/* ============================ FOOTER ============================ */

function Footer() {
  return (
    <footer className="border-t border-[var(--m-border)] bg-[var(--m-bg)]">
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="grid sm:grid-cols-2 md:grid-cols-5 gap-10 text-[13px]">
          <div className="sm:col-span-2 md:col-span-2">
            <div className="flex items-center gap-2.5 mb-3">
              <Logo />
              <span className="font-display text-[17px] tracking-tight">
                MARINA
              </span>
            </div>
            <p className="text-[var(--m-ink-3)] leading-relaxed max-w-xs">
              The AI Chief of Staff for modern remote teams. Built in India 🇮🇳
              for the world.
            </p>
          </div>
          <FooterCol
            title="Product"
            items={[
              ["Features", "#product"],
              ["Workflows", "#workflows"],
              ["Early access", "#pricing"],
              ["Download app", "/download"],
            ]}
          />
          <FooterCol
            title="Legal"
            items={[
              ["Privacy", "/privacy"],
              ["Terms", "/terms"],
              ["DPA", "/dpa"],
              ["Security", "/security"],
            ]}
          />
          <FooterCol
            title="Contact"
            items={[
              ["Email us", "mailto:thetanishgarg@gmail.com"],
              ["Book a demo", "/demo"],
            ]}
          />
        </div>
        <div className="mt-12 pt-6 border-t border-[var(--m-border)] flex items-center justify-between flex-wrap gap-3 text-[11.5px] text-[var(--m-ink-4)]">
          <p>© 2026 Project MARINA Private Limited. All rights reserved.</p>
          <p>Made with care in Bangalore.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  items,
}: {
  title: string;
  items: Array<[string, string]>;
}) {
  return (
    <div>
      <p className="font-medium text-[var(--m-ink)] mb-3">{title}</p>
      <ul className="space-y-1.5">
        {items.map(([label, href]) => (
          <li key={label}>
            <a
              href={href}
              className="text-[var(--m-ink-3)] hover:text-[var(--m-ink)] transition-colors"
            >
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ============================ INLINE ICONS ============================ */

function Logo() {
  // Canonical brand mark. We render via <img> rather than inline SVG so the
  // landing page, sidebar, favicon, and email letterhead are all guaranteed
  // to look identical — a single asset, one source of truth.
  return (
    <img
      src="/logo.svg"
      width={32}
      height={32}
      alt="MARINA"
      className="block object-contain"
    />
  );
}
function BookIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    >
      <path d="M4 5a2 2 0 012-2h12v18H6a2 2 0 01-2-2V5z" />
      <path d="M18 3v18M8 7h6M8 11h6" strokeLinecap="round" />
    </svg>
  );
}
function GraduationIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    >
      <path d="M2 9l10-5 10 5-10 5L2 9z" />
      <path d="M6 11v5c0 1 3 3 6 3s6-2 6-3v-5" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    >
      <circle cx={9} cy={8} r={3.5} />
      <circle cx={17} cy={10} r={2.5} />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
      <path d="M15 20c.6-2 2.5-3.5 4-3.5 2 0 3 1.5 3 3.5" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    >
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" strokeLinecap="round" />
      <circle cx={12} cy={12} r={2.5} />
    </svg>
  );
}
function CtaGoogleIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.7 4.7-6.2 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 16 18.9 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.1 0-9.5-3.3-11.2-7.9l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.1 5.6l6.2 5.2C41.4 35.3 44 30.1 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

function GhIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.1c-3.2.7-3.88-1.36-3.88-1.36-.52-1.31-1.28-1.66-1.28-1.66-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.18 1.18A11 11 0 0 1 12 6.8c.98.01 1.97.13 2.89.39 2.2-1.49 3.17-1.18 3.17-1.18.64 1.58.24 2.75.12 3.04.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.07.78 2.15v3.19c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
