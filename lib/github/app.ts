import { createSign } from 'crypto'
import { Octokit } from '@octokit/rest'

/**
 * GitHub App authentication.
 *
 * Why an App (not per-user OAuth): an org admin installs the MARINA GitHub App
 * once and picks which repos to share. GitHub then lets us authenticate AS the
 * installation to read those repos' commits + PRs server-side — no per-employee
 * token, no org third-party-access friction, works for PRIVATE repos. Employees
 * separately link their GitHub account just so we can map activity to them.
 *
 * Env needed (set after you create the App on github.com):
 *   GITHUB_APP_ID            — numeric App id
 *   GITHUB_APP_PRIVATE_KEY   — the App's PEM private key (literal \n is fine)
 *   GITHUB_APP_SLUG          — the App's URL slug, e.g. "marina-tracker"
 */

export function githubAppConfigured(): boolean {
  return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY)
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

/**
 * Coerce whatever is in GITHUB_APP_PRIVATE_KEY into a PEM that Node's crypto can
 * actually parse. We've been bitten by three real-world manglings:
 *   1. A filesystem path to the .pem (local-dev convenience) — read the file.
 *   2. Literal "\n" escapes instead of real newlines (common in .env) — unescape.
 *   3. Structural newlines replaced by SPACES or stripped entirely — what
 *      happens when a multi-line PEM is pasted into many env-var UIs (Vercel
 *      included). A PEM with no newlines fails to parse with the opaque
 *      "DECODER routines::unsupported", which is exactly what silently broke
 *      sync. We rebuild it: pull the base64 body from between the header and
 *      footer, strip ALL whitespace, and re-wrap at 64 columns.
 */
function normalizePrivateKey(raw: string): string {
  let k = raw.trim()
  // Path-to-.pem is a local-dev convenience only. Loading `fs` lazily (and
  // never in production) keeps Next's file tracer from pulling the whole repo
  // into this route's serverless bundle on Vercel.
  if (!k.includes('BEGIN') && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs')
    if (fs.existsSync(k)) k = fs.readFileSync(k, 'utf8')
  }
  if (k.includes('\\n')) k = k.replace(/\\n/g, '\n')
  const m = k.match(/-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/)
  if (m) {
    const label = m[1].trim()
    const body = m[2].replace(/\s+/g, '')
    const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? ''
    k = `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`
  }
  return k
}

/** Short-lived (10 min) App JWT, signed RS256 with the App private key. */
function appJwt(): string {
  const appId = process.env.GITHUB_APP_ID
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !rawKey) throw new Error('GitHub App not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)')
  const privateKey = normalizePrivateKey(rawKey)

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  // iat backdated 60s to tolerate clock skew; exp 9 min (GitHub max is 10).
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }))
  const unsigned = `${header}.${payload}`
  try {
    const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey)
    return `${unsigned}.${b64url(signature)}`
  } catch (e) {
    // Make the most common misconfiguration legible instead of a 0-repos mystery.
    throw new Error(
      `GitHub App private key could not be parsed (${(e as Error).message}). ` +
        `Set GITHUB_APP_PRIVATE_KEY to the full contents of the .pem file ` +
        `(BEGIN/END lines included).`,
    )
  }
}

/** Exchange the App JWT for a short-lived installation access token. */
export async function installationToken(installationId: number): Promise<string> {
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!res.ok) {
    throw new Error(`installation token failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { token: string }
  return data.token
}

/** An Octokit authenticated as the installation (can read the shared repos). */
export async function installationOctokit(installationId: number): Promise<Octokit> {
  return new Octokit({ auth: await installationToken(installationId) })
}

/**
 * Every account this App is currently installed on (authenticated as the App
 * itself). Used to self-heal a stale stored installation id — GitHub issues a
 * NEW installation id every time the admin reinstalls, so the id we saved can
 * silently 404. Listing lets us recover the current one.
 */
export async function listAppInstallations(): Promise<
  Array<{ id: number; account: string | null; targetType: string | null }>
> {
  const res = await fetch('https://api.github.com/app/installations?per_page=100', {
    headers: {
      Authorization: `Bearer ${appJwt()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error(`list installations failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as Array<{
    id: number
    account?: { login?: string } | null
    target_type?: string
  }>
  return data.map((i) => ({ id: i.id, account: i.account?.login ?? null, targetType: i.target_type ?? null }))
}

/** Where to send an org admin to install/configure the App for their org. */
export function appInstallUrl(orgId: number): string {
  const slug = process.env.GITHUB_APP_SLUG ?? 'marina'
  // `state` carries the orgId so our setup callback knows which workspace this
  // installation belongs to.
  return `https://github.com/apps/${slug}/installations/new?state=${orgId}`
}
