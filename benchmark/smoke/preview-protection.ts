/**
 * preview-protection.ts — Checks, WITHOUT credentials, that a Vercel deployment URL is protected
 * (Vercel Authentication / Password Protection) before the parts pricing flag is enabled there.
 *
 * Two anonymous requests, neither of which can trigger a search:
 *   1. GET  <url>/demo/presupuesto
 *   2. POST <url>/api/budget/parts-prices with Content-Type text/plain and an empty body: even on an
 *      UNPROTECTED deployment the route rejects it (404 flag off / 415) before any rate limit,
 *      store or provider step. A protected deployment answers 401/403 or redirects to the SSO.
 * No cookies, tokens or bypass headers are sent.
 */
export type ProtectionVerdict = 'protected' | 'public' | 'unknown'

export function classifyProtection(status: number, location: string | null): ProtectionVerdict {
  if (status === 401 || status === 403) return 'protected'
  if (status >= 300 && status < 400) {
    return location && /vercel\.com\/(sso|login)|\/_vercel\/|sso-api|password/i.test(location) ? 'protected' : 'unknown'
  }
  if ((status >= 200 && status < 300) || status === 400 || status === 404 || status === 405 || status === 413 || status === 415 || status === 429) return 'public'
  return 'unknown'
}

export interface ProtectionReport {
  page: { status: number; verdict: ProtectionVerdict }
  api: { status: number; verdict: ProtectionVerdict }
  protected: boolean
}

export async function checkDeploymentProtection(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<ProtectionReport> {
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:') throw new Error('The deployment URL must be https.')
  const base = url.origin
  const page = await fetchImpl(`${base}/demo/presupuesto`, { method: 'GET', redirect: 'manual', cache: 'no-store' })
  const api = await fetchImpl(`${base}/api/budget/parts-prices`, { method: 'POST', redirect: 'manual', cache: 'no-store', headers: { 'Content-Type': 'text/plain' }, body: '' })
  const p = { status: page.status, verdict: classifyProtection(page.status, page.headers.get('location')) }
  const a = { status: api.status, verdict: classifyProtection(api.status, api.headers.get('location')) }
  return { page: p, api: a, protected: p.verdict === 'protected' && a.verdict === 'protected' }
}
