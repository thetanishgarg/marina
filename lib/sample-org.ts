/**
 * The buildathon demo workspace. Everything in it is fictional SAMPLE data
 * created by scripts/seed-sample-org.ts — no real people, customers or
 * activity. These markers are how the UI recognises it and labels it.
 *
 * Client-safe: no database imports.
 */
export const SAMPLE_ORG_NAME = 'Sample Org (sample data)'

/** `.invalid` is a reserved TLD: these addresses can never receive mail. */
export const SAMPLE_EMAIL_DOMAIN = 'sample.marina.invalid'

/** Prefix for external ids of sample GitHub events and calendar meetings. */
export const SAMPLE_EXTERNAL_PREFIX = 'sample-'

/** Fixed logins the /demo/walkthrough page uses to find its two personas. */
export const SAMPLE_MANAGER_LOGIN = 'sample-meera'
export const SAMPLE_EMPLOYEE_LOGIN = 'sample-arnav'

export function isSampleOrgName(name: string | null | undefined): boolean {
  return name === SAMPLE_ORG_NAME
}

export function isSampleEmail(email: string | null | undefined): boolean {
  return !!email && email.endsWith(`@${SAMPLE_EMAIL_DOMAIN}`)
}

/** In-app page a sample source link opens, instead of a made-up GitHub URL. */
export function sampleSourceUrl(kind: 'pr' | 'commit' | 'review' | 'doc', ref: string): string {
  return `/demo/sample-source?kind=${kind}&ref=${encodeURIComponent(ref)}`
}
