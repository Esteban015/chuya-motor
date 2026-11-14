/**
 * catalog-rate-limit.ts — Per-client request rate for GET /api/vehicle-catalog (Incremento 7D.2).
 *
 * The catalog is public, non-personal, local static data, so the limit protects the server, not a
 * paid upstream. Same client identity as the rest of the app (hashed IP, llm-protection), shared
 * store when configured, per-instance memory fallback otherwise. It fails OPEN to the memory store
 * (never to "unlimited") if the shared store errors.
 *
 *   VEHICLE_CATALOG_RATE_PER_MINUTE  (default 120; one full selection is ~5 requests and the
 *                                    browser caches answers per session)
 */
import { readLlmProtectionConfig, type LlmProtectionConfig } from '@/server/llm-protection/protection-config'
import { InMemoryQuotaStore, type QuotaStore } from '@/server/llm-protection/quota-store'
import { resolveSharedStore } from '@/server/llm-protection/runtime'
import { clientKeyFor, resolveClientIp } from '@/server/llm-protection/client-identity'

type Env = Record<string, string | undefined>
const MINUTE_MS = 60_000
export const DEFAULT_CATALOG_RATE_PER_MINUTE = 120

let localStore: InMemoryQuotaStore | null = null

export function resetCatalogRateLimitForTests(): void {
  localStore = null
}

export function catalogRatePerMinute(env: Env): number {
  const n = Number(env['VEHICLE_CATALOG_RATE_PER_MINUTE'])
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : DEFAULT_CATALOG_RATE_PER_MINUTE
}

export async function allowCatalogRequest(
  headers: Headers,
  env: Env = process.env,
  deps: { store?: QuotaStore | null; now?: () => number } = {},
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const now = deps.now ?? Date.now
  let llm: LlmProtectionConfig | null
  try {
    llm = readLlmProtectionConfig(env)
  } catch {
    llm = null
  }
  let store: QuotaStore | null = deps.store !== undefined ? deps.store : null
  if (deps.store === undefined && llm) {
    try {
      store = resolveSharedStore(llm)
    } catch {
      store = null
    }
  }
  const clientKey = clientKeyFor(llm ? resolveClientIp(headers, llm.clientIpHeader, llm.trustedProxyHops) : null, llm?.clientIdSalt ?? '')
  const window = Math.floor(now() / MINUTE_MS)
  const key = `${llm?.keyPrefix ?? 'chuya'}:vc:rl:${clientKey}:${window}`
  const limit = catalogRatePerMinute(env)
  const retryAfterSec = Math.max(1, Math.ceil(((window + 1) * MINUTE_MS - now()) / 1000))
  try {
    if (!store) throw new Error('no store')
    return { allowed: (await store.reserve(key, 1, limit, MINUTE_MS)).ok, retryAfterSec }
  } catch {
    localStore ??= new InMemoryQuotaStore()
    return { allowed: (await localStore.reserve(key, 1, limit, MINUTE_MS)).ok, retryAfterSec }
  }
}
