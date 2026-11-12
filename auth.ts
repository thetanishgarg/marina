import NextAuth from 'next-auth'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'
import { db, schema } from '@/lib/db/client'
import { and, eq } from 'drizzle-orm'
import { consumeMagicToken } from '@/lib/auth/magic'
import { syncUserActivity } from '@/lib/github/sync'

type MarinaTokenFields = {
  accessToken?: string
  appUserId?: number
  login?: string
}

async function pickUniqueLogin(base: string): Promise<string> {
  const cleaned = (base || 'user').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'user'
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? cleaned : `${cleaned}${attempt + 1}`
    const exists = await db.query.users.findFirst({ where: eq(schema.users.login, candidate) })
    if (!exists) return candidate
  }
  // Fall back to a random suffix in the extremely unlikely case of 25 collisions
  return `${cleaned}-${Math.random().toString(36).slice(2, 8)}`
}

type GhProfile = {
  id: number
  login: string
  name?: string
  email?: string
  avatar_url?: string
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // Use our own error page so users see a helpful message instead of
  // NextAuth's default "Server error / Configuration" black box.
  pages: {
    error: '/auth/error',
  },
  providers: [
    GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
      // Identity ONLY. Repo activity (commits/PRs/reviews, incl. private) now
      // comes from the org-level GitHub App installation — not per-user tokens.
      // So the only thing we need from a personal GitHub link is *who they are*
      // (`read:user` → id + login, used to attribute commits to this account).
      // Dropping `repo`/`read:org` removes the alarming "grant access to your
      // repositories / organisations" consent screen that made teammates wary.
      authorization: { params: { scope: 'read:user user:email' } },
      // Trust GitHub's verified email so an existing email/Google user can
      // click "Connect GitHub" from the dashboard and have the GitHub
      // identity merged into their account in one step, instead of being
      // bounced into a second account they have to consolidate later.
      allowDangerousEmailAccountLinking: true,
    }),

    // Google Workspace SSO — only loaded when env vars are set. Requires a
    // separate OAuth client from the Calendar-connect one (this is sign-in,
    // not data scope), but the same project works fine.
    ...(process.env.GOOGLE_SSO_CLIENT_ID && process.env.GOOGLE_SSO_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_SSO_CLIENT_ID,
            clientSecret: process.env.GOOGLE_SSO_CLIENT_SECRET,
            authorization: {
              params: {
                // Identity ONLY. Calendar is connected separately via the
                // explicit "Connect my calendar" flow, which requests
                // calendar.events WRITE (needed to schedule meetings). We
                // deliberately do NOT bundle calendar scope into sign-in — a
                // first-time visitor shouldn't be asked to grant calendar
                // access just to log in (same reasoning as identity-only GitHub).
                prompt: 'select_account',
                scope: ['openid', 'email', 'profile'].join(' '),
              },
            },
            // Trust verified Google emails to merge accounts with existing
            // GitHub/magic-link users that share the same address.
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),

    // Email magic-link via Credentials.
    Credentials({
      id: 'magic',
      name: 'Email magic link',
      credentials: {
        token: { label: 'Token', type: 'text' },
      },
      async authorize(credentials) {
        try {
          const token = (credentials?.token as string | undefined)?.trim()
          if (!token) {
            console.warn('[auth/magic] empty token in authorize')
            return null
          }
          const email = await consumeMagicToken(token)
          if (!email) {
            console.warn('[auth/magic] consumeMagicToken returned null — token invalid/expired/missing-table')
            return null
          }
          let user = await db.query.users.findFirst({ where: eq(schema.users.email, email) })
          if (!user) {
            const login = await pickUniqueLogin(email.split('@')[0]!.slice(0, 32))
            const [created] = await db
              .insert(schema.users)
              .values({ email, login, name: null })
              .returning()
            user = created
          }
          return {
            id: String(user.id),
            email: user.email ?? undefined,
            name: user.name ?? null,
            image: user.image ?? user.avatarUrl ?? null,
          }
        } catch (err) {
          // Defensive — NextAuth turns thrown errors into Configuration. Log and return null.
          console.error('[auth/magic] authorize threw:', err)
          return null
        }
      },
    }),

    // Dev-only sign in. The provider is EXCLUDED FROM THE ARRAY ENTIRELY in
    // production (build-time), so the `/api/auth/callback/dev` endpoint does
    // not exist in prod — not merely a runtime `authorize` guard. This removes
    // the single-point-of-failure where a misconfigured NODE_ENV would expose
    // an impersonate-any-user backdoor. Lets you sign in as any seeded user
    // instantly for local testing.
    ...(process.env.NODE_ENV !== 'production'
      ? [
          Credentials({
            id: 'dev',
            name: 'Dev login',
            credentials: {
              userId: { label: 'User ID', type: 'text' },
            },
            async authorize(credentials) {
              try {
                const userId = Number(credentials?.userId)
                if (!Number.isInteger(userId)) return null
                const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) })
                if (!user) return null
                return {
                  id: String(user.id),
                  email: user.email ?? undefined,
                  name: user.name ?? null,
                  image: user.image ?? user.avatarUrl ?? null,
                }
              } catch (err) {
                console.error('[auth/dev] authorize threw:', err)
                return null
              }
            },
          }),
        ]
      : []),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    /**
     * Account merging trusts the provider's email (allowDangerousEmailAccountLinking).
     * That is only safe when the provider asserts the address is VERIFIED —
     * otherwise someone could register an unverified address and be merged
     * into the victim's MARINA account. GitHub only exposes verified emails
     * on the profile; Google tells us explicitly via `email_verified`.
     */
    async signIn({ account, profile }) {
      if (account?.provider === 'google') {
        const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified
        if (verified !== true) return false
      }
      return true
    },
    async jwt({ token, account, profile, user }) {
      const t = token as typeof token & MarinaTokenFields

      try {
        // GitHub sign-in path. Order matters:
        //
        //   1. Try by `githubId` — the canonical key once a user has
        //      ever signed in with GitHub.
        //   2. Fall back to email match — covers the "I signed up via
        //      Google, now I'm clicking Link my GitHub" case. Without
        //      this branch we'd attempt to INSERT a duplicate email and
        //      hit the unique constraint, which surfaces as the dreaded
        //      `?error=Configuration` page.
        //   3. Last resort: actually create a new user.
        if (account?.provider === 'github' && account?.access_token && profile) {
          const ghProfile = profile as unknown as GhProfile
          let existing = await db.query.users.findFirst({
            where: eq(schema.users.githubId, ghProfile.id),
          })
          if (!existing && ghProfile.email) {
            existing = await db.query.users.findFirst({
              where: eq(schema.users.email, ghProfile.email),
            })
          }
          const row = existing
            ? (
                await db
                  .update(schema.users)
                  .set({
                    githubId: ghProfile.id,
                    login: ghProfile.login,
                    name: ghProfile.name ?? existing.name,
                    email: ghProfile.email ?? existing.email,
                    avatarUrl: ghProfile.avatar_url ?? existing.avatarUrl,
                    accessToken: account.access_token,
                  })
                  .where(eq(schema.users.id, existing.id))
                  .returning()
              )[0]
            : (
                await db
                  .insert(schema.users)
                  .values({
                    githubId: ghProfile.id,
                    login: ghProfile.login,
                    name: ghProfile.name,
                    email: ghProfile.email,
                    avatarUrl: ghProfile.avatar_url,
                    accessToken: account.access_token,
                  })
                  .returning()
              )[0]
          t.appUserId = row.id
          t.login = row.login
          t.accessToken = account.access_token

          // Auto-sync GitHub activity in the background. We don't await — sign-in
          // must stay snappy. Failures are persisted to users.lastSyncError so
          // managers see what happened on the Activity tab.
          void syncUserActivity(row.id, row.login, account.access_token, 30).catch(async (err) => {
            console.error('[auth] background github sync failed', err)
            try {
              await db
                .update(schema.users)
                .set({ lastSyncError: String(err).slice(0, 500) })
                .where(eq(schema.users.id, row.id))
            } catch (writeErr) {
              console.error('[auth] failed to persist sync error', writeErr)
            }
          })
        }

        // Magic-link & dev paths share the same logic
        if ((account?.provider === 'magic' || account?.provider === 'dev') && user?.id) {
          const numericId = Number(user.id)
          if (Number.isFinite(numericId)) {
            const row = await db.query.users.findFirst({ where: eq(schema.users.id, numericId) })
            if (row) {
              t.appUserId = row.id
              t.login = row.login
              t.accessToken = undefined
            }
          }
        }

        // Google SSO — merge with existing user-by-email when possible.
        if (account?.provider === 'google' && profile) {
          const gProfile = profile as { email?: string; name?: string; picture?: string; sub?: string }
          const email = gProfile.email?.toLowerCase()
          if (email) {
            let row = await db.query.users.findFirst({
              where: eq(schema.users.email, email),
            })
            if (!row) {
              const login = await pickUniqueLogin(email.split('@')[0]!.slice(0, 32))
              const [created] = await db
                .insert(schema.users)
                .values({
                  email,
                  login,
                  name: gProfile.name ?? null,
                  avatarUrl: gProfile.picture ?? null,
                  image: gProfile.picture ?? null,
                })
                .returning()
              row = created
            } else if (gProfile.picture && (!row.image || !row.avatarUrl)) {
              // Returning user whose avatar was never captured (e.g. created via
              // invite/magic-link first, or an older row): backfill whichever of
              // image/avatarUrl is missing from Google's picture. We DON'T
              // clobber a value that's already set, so a custom uploaded photo
              // survives.
              await db
                .update(schema.users)
                .set({
                  image: row.image ?? gProfile.picture,
                  avatarUrl: row.avatarUrl ?? gProfile.picture,
                  name: row.name ?? gProfile.name ?? null,
                })
                .where(eq(schema.users.id, row.id))
              row = { ...row, image: row.image ?? gProfile.picture, avatarUrl: row.avatarUrl ?? gProfile.picture }
            }
            if (row) {
              t.appUserId = row.id
              t.login = row.login
              t.accessToken = undefined
            }

            // If we got calendar scope, persist the tokens onto the existing
            // `accounts` row for this user — and kick off a calendar sync so
            // the dashboard already shows today's meetings on first load.
            // The accounts row is what the calendar fetcher uses; without
            // backfilling here, our auth-merge-by-email path can leave a
            // freshly-merged Google account without tokens.
            if (row && account.access_token) {
              const gotCalendar =
                typeof account.scope === 'string' &&
                account.scope.includes('calendar')
              const existing = await db.query.accounts.findFirst({
                where: (t, { and, eq: e }) =>
                  and(e(t.userId, row!.id), e(t.provider, 'google')),
              })
              // Only write calendar tokens when this sign-in actually carried
              // calendar scope — otherwise an identity-only SSO would overwrite
              // a previously-connected calendar token with one that can't read
              // the calendar. (With the decoupled flow this is effectively never
              // true for SSO; kept defensively for incremental-grant edge cases.)
              if (existing && gotCalendar) {
                await db
                  .update(schema.accounts)
                  .set({
                    access_token: account.access_token ?? existing.access_token,
                    refresh_token: account.refresh_token ?? existing.refresh_token,
                    expires_at: account.expires_at ?? existing.expires_at,
                    scope: account.scope ?? existing.scope,
                    token_type: account.token_type ?? existing.token_type,
                    id_token: account.id_token ?? existing.id_token,
                  })
                  .where(and(eq(schema.accounts.userId, row.id), eq(schema.accounts.provider, 'google')))
              }
              if (gotCalendar) {
                // Background sync — never block the auth flow on a slow
                // Google API. The dashboard polls meetings on open anyway.
                import('@/lib/google/calendar')
                  .then((m) => m.syncCalendar(row!.id))
                  .catch((e) => console.warn('[auth] post-sign-in calendar sync failed', e))
              }
            }
          }
        }
      } catch (err) {
        console.error('[auth] jwt callback threw — returning token as-is:', err)
      }

      return t
    },
    async session({ session, token }) {
      const t = token as typeof token & MarinaTokenFields
      // NOTE: we deliberately DO NOT copy the GitHub access token onto the
      // client-visible session. It's `repo`-scoped; exposing it via
      // /api/auth/session would let any XSS exfiltrate full private-repo
      // access. Server code that needs it reads users.accessToken from the DB.
      session.appUserId = t.appUserId
      session.login = t.login
      return session
    },
  },
})
