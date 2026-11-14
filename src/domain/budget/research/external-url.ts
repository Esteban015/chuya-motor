/**
 * external-url.ts — Validation of links typed by the person (Incremento 7B).
 * Only http(s) to a public-looking host; no credentials; bounded length. Anything else → null,
 * so it is never rendered as a link (javascript:, data:, vbscript:, file:, protocol-relative…).
 * Chuya Motor never opens or fetches these URLs.
 */
export const MAX_URL_LENGTH = 500

export function sanitizeExternalUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value || value.length > MAX_URL_LENGTH) return null
  if (!/^https?:\/\//i.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return null
  return url.toString()
}
