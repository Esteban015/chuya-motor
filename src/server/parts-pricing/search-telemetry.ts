/**
 * search-telemetry.ts — Safe diagnostics for automatic parts searches (7C resilience). SERVER ONLY.
 *
 * One structured line per part lookup, for the runtime logs (Vercel captures stdout):
 *   [parts-pricing] {"event":"search","provider":"serpapi","cache":"miss","outcome":"unavailable",
 *                    "reason":"timeout","phase":"request","durationMs":15003,"timeoutMs":15000}
 *
 * Built from an explicit ALLOW-LIST of codes and counters. It never contains the API key, the
 * provider URL or query, the part description, the vehicle, offers, titles, prices, the client IP
 * or its hash, or the provider's raw error text — whatever the caller passes in.
 */
import type { ProviderDiagnostics, ProviderId, ProviderResult } from './types'

if (typeof window !== 'undefined') throw new Error('parts-pricing is server-only')

/**
 * memory_hit / shared_hit: served from the per-process / shared cache (no provider call).
 * inflight: joined an identical search already running in this process (no extra provider call).
 * miss: not cached; the search budget was consulted and, if granted, the provider was called once.
 */
export type CacheOutcome = 'memory_hit' | 'shared_hit' | 'inflight' | 'miss'

export interface PricingSearchEvent {
  provider: ProviderId
  cache: CacheOutcome
  result: ProviderResult
  /** Wall time of the lookup in this request (ms), including cache and budget checks. */
  durationMs: number
}

export type PricingSearchListener = (event: PricingSearchEvent) => void

const REASONS = new Set(['unauthorized', 'forbidden', 'rate_limited', 'provider_error', 'timeout', 'network', 'bad_response', 'quota_exceeded', 'store_unavailable'])
const PROVIDER_STATUS = new Set<ProviderDiagnostics['providerStatus']>(['success', 'error', 'processing', 'unknown'])
const PROVIDER_ERROR = new Set<ProviderDiagnostics['providerError']>(['empty_results', 'invalid_key', 'quota', 'other'])
const CACHE = new Set<CacheOutcome>(['memory_hit', 'shared_hit', 'inflight', 'miss'])
const STATUS = new Set<ProviderResult['status']>(['ok', 'no_results', 'unavailable', 'disabled'])

const ms = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 600_000) : undefined)
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, 10_000) : undefined)

/** The only fields that may ever be logged. Unknown values are dropped, not echoed. */
export function toSafeSearchLog(e: PricingSearchEvent): Record<string, string | number> {
  const r = e.result
  const d = r.diagnostics
  const out: Record<string, string | number> = { event: 'search', provider: e.provider === 'mercadolibre' ? 'mercadolibre' : 'serpapi' }
  if (CACHE.has(e.cache)) out.cache = e.cache
  if (STATUS.has(r.status)) out.outcome = r.status
  if (r.reason && REASONS.has(r.reason)) out.reason = r.reason
  if (d?.failurePhase === 'request' || d?.failurePhase === 'body') out.phase = d.failurePhase
  const duration = ms(e.durationMs)
  if (duration !== undefined) out.durationMs = duration
  // Provider latency only when the provider was actually called by this lookup.
  const latency = e.cache === 'miss' ? ms(r.latencyMs) : undefined
  if (latency !== undefined && r.latencyMs > 0) out.providerMs = latency
  const timeout = ms(d?.timeoutMs)
  if (timeout !== undefined) out.timeoutMs = timeout
  if (d && Number.isInteger(d.httpStatus) && d.httpStatus! >= 100 && d.httpStatus! <= 599) out.httpStatus = d.httpStatus!
  if (d?.providerStatus && PROVIDER_STATUS.has(d.providerStatus)) out.providerStatus = d.providerStatus
  if (d?.providerError && PROVIDER_ERROR.has(d.providerError)) out.providerError = d.providerError
  const raw = count(d?.rawCount)
  if (raw !== undefined && d) out.rawCount = raw
  const offers = count(r.offers?.length)
  if (offers !== undefined) out.offers = offers
  return out
}

/** Default sink: one JSON line on stdout; silent under tests (NODE_ENV=test). Never throws. */
export function consoleSearchListener(env: Record<string, string | undefined> = process.env): PricingSearchListener {
  if (env.NODE_ENV === 'test') return () => undefined
  return (event) => {
    try {
      console.info('[parts-pricing]', JSON.stringify(toSafeSearchLog(event)))
    } catch {
      // diagnostics must never break a search
    }
  }
}
