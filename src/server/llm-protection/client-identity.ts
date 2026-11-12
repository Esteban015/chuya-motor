/**
 * client-identity.ts — Client identification for rate limits and per-client LLM quotas (6.4D).
 *
 * - Only ONE configured header is trusted (CLIENT_IP_HEADER, default x-forwarded-for). On Vercel the
 *   platform sets x-forwarded-for / x-real-ip itself; on other proxies, set TRUSTED_PROXY_HOPS so the
 *   address appended by the trusted proxy is used (right-most minus hops-1), never a client-supplied
 *   left-most value.
 * - The address is never stored: keys use a truncated SHA-256 of (salt + address).
 * - Missing or malformed address → one shared "anon" bucket (conservative: shares its limits).
 * - Shared IPs (CGNAT, offices, mobile carriers) are handled by keeping the per-client limits modest
 *   and NON-blocking for the deterministic path: once a client exhausts its LLM quota it still gets
 *   the Safety Gate and the deterministic warnings, only without generative text.
 */
import { createHash } from 'node:crypto'

const IP_LIKE = /^[0-9a-fA-F:.]{2,45}$/

export function resolveClientIp(headers: Headers, headerName: string, trustedProxyHops: number): string | null {
  const raw = headers.get(headerName)
  if (!raw) return null
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (list.length === 0) return null
  const idx = Math.max(0, list.length - trustedProxyHops)
  const candidate = list[idx]!
  return IP_LIKE.test(candidate) ? candidate : null
}

export function clientKeyFor(ip: string | null, salt: string): string {
  if (!ip) return 'anon'
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32)
}
