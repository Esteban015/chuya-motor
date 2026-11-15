/**
 * pricing-service.ts — Orchestrates automatic price research for the PARTS of a list or quote.
 * SERVER ONLY. Spike (Incremento 7C): not wired to any route or UI yet.
 *
 * Guarantees:
 *   - Labor and other concepts are never searched or compared.
 *   - Each description passes the 7B safety screen (same Safety Gate, unchanged) before any
 *     outbound call; unsafe or non-part text is never sent to a third party.
 *   - Limits: max parts per request, one provider call per part, provider timeout, in-memory cache.
 *   - Offers are only what the provider returned (validated); no LLM is involved, so no price,
 *     source or link can be invented. Discarded offers are counted, never presented.
 *   - Provider down / disabled → structured status; the 7B manual flow keeps working.
 */
import { screenPartDescription, localSafetyCheck } from '@/domain/budget/research/local-safety'
import type { LineCategory, Presentation, VehicleInfo } from '@/domain/budget/research/types'
import { evaluateMatch, type MatchResult } from './matching'
import { buildProviderQuery } from './query'
import { pricingCacheKey, type PricingCache } from './shared-cache'
import { buildDiscardAudit, type DiscardAudit } from './discard-audit'
import type { CacheOutcome, PricingSearchListener } from './search-telemetry'
import type { PriceOffer, PriceProvider, PriceQuery, ProviderDiagnostics, ProviderId, ProviderResult } from './types'

export const PRICING_LIMITS = Object.freeze({
  maxPartsPerRequest: 5,
  maxOffersPerPart: 5,
  cacheTtlMs: 6 * 60 * 60 * 1000,
  cacheMaxEntries: 500,
})

export interface PricingLine {
  id: string
  description: string
  category: LineCategory
  partBrand?: string
  partCode?: string
  presentation?: Presentation
  quantity?: number
}

export interface PricedItem {
  lineId: string
  status: 'ok' | 'no_results' | 'unavailable' | 'skipped'
  reason?: string
  offers: Array<{ offer: PriceOffer; match: MatchResult }>
  /** Offers discarded by matching (evidence of a different product). */
  discarded: number
  /** Results dropped by the adapter's validation (currency, URL, price, merchant). */
  droppedInvalid?: number
  /** Matching discard reasons → count (e.g. { position_mismatch: 2 }). */
  discardReasons?: Record<string, number>
  /** Safe provider diagnostics (counters and codes; no keys, URLs or raw provider text). */
  diagnostics?: ProviderDiagnostics
  /** Opt-in probe only (research({ audit: true })): discarded / dropped titles and duplicates. */
  audit?: DiscardAudit
}

export interface PricingResult {
  status: 'ok' | 'disabled'
  provider: ProviderId | null
  items: PricedItem[]
  truncated: boolean
}

/** Called before each BILLED provider search (cache miss). Denied → the part is not searched. */
export type SearchGate = () => Promise<{ ok: true } | { ok: false; reason: 'quota_exceeded' | 'store_unavailable' }>

export function createPricingService(deps: {
  provider: PriceProvider | null
  now?: () => number
  /** Shared cache (e.g. Upstash) consulted after the per-process cache. Errors are ignored. */
  sharedCache?: PricingCache
  cacheKeyPrefix?: string
  /** Safe per-lookup diagnostics (search-telemetry.ts). Listener errors are ignored. */
  onSearch?: PricingSearchListener
}) {
  const cache = new Map<string, { at: number; result: ProviderResult }>()
  /** Identical concurrent searches in this process share ONE provider call. */
  const inFlight = new Map<string, Promise<{ result: ProviderResult; cache: CacheOutcome }>>()
  const now = deps.now ?? Date.now

  async function fetchAndStore(provider: PriceProvider, query: PriceQuery, key: string, sharedKey: string, gate: SearchGate | undefined): Promise<{ result: ProviderResult; cache: CacheOutcome }> {
    if (deps.sharedCache) {
      try {
        const shared = await deps.sharedCache.get(sharedKey)
        if (shared) return { result: shared, cache: 'shared_hit' }
      } catch {
        // cache down: continue (the search budget still bounds provider calls)
      }
    }
    if (gate) {
      const decision = await gate().catch(() => ({ ok: false as const, reason: 'store_unavailable' as const }))
      if (!decision.ok) return { result: { status: 'unavailable', reason: decision.reason, offers: [], droppedInvalid: 0, latencyMs: 0 }, cache: 'miss' }
    }
    let result: ProviderResult
    // Exactly one provider call per cache miss: failures (timeout included) are never retried and
    // never cached, so a timeout is reported as "unavailable", never as "no results".
    try {
      result = await provider.search(query)
    } catch {
      result = { status: 'unavailable', reason: 'provider_error', offers: [], droppedInvalid: 0, latencyMs: 0 }
    }
    if (result.status === 'ok' || result.status === 'no_results') {
      if (cache.size >= PRICING_LIMITS.cacheMaxEntries) cache.delete(cache.keys().next().value as string)
      cache.set(key, { at: now(), result })
      if (deps.sharedCache) await deps.sharedCache.set(sharedKey, result, PRICING_LIMITS.cacheTtlMs).catch(() => undefined)
    }
    return { result, cache: 'miss' }
  }

  function report(provider: PriceProvider, outcome: { result: ProviderResult; cache: CacheOutcome }, startedAt: number): ProviderResult {
    try {
      deps.onSearch?.({ provider: provider.id, cache: outcome.cache, result: outcome.result, durationMs: Date.now() - startedAt })
    } catch {
      // diagnostics must never break a search
    }
    return outcome.result
  }

  async function lookup(provider: PriceProvider, query: PriceQuery, gate: SearchGate | undefined): Promise<ProviderResult> {
    const startedAt = Date.now()
    const q = buildProviderQuery(query)
    const key = `${provider.id}:${q.toLowerCase()}`
    const hit = cache.get(key)
    if (hit && now() - hit.at < PRICING_LIMITS.cacheTtlMs) return report(provider, { result: hit.result, cache: 'memory_hit' }, startedAt)
    const pending = inFlight.get(key)
    if (pending) return report(provider, { result: (await pending).result, cache: 'inflight' }, startedAt)
    const p = fetchAndStore(provider, query, key, pricingCacheKey(deps.cacheKeyPrefix ?? 'chuya', provider.id, q), gate).finally(() => inFlight.delete(key))
    inFlight.set(key, p)
    return report(provider, await p, startedAt)
  }

  return {
    /** `beforeProviderCall` runs before each billed search (per request: client / global budgets). */
    async research(input: { lines: PricingLine[]; vehicle: VehicleInfo; beforeProviderCall?: SearchGate; audit?: boolean }): Promise<PricingResult> {
      if (!deps.provider) return { status: 'disabled', provider: null, items: [], truncated: false }
      const provider = deps.provider
      const parts = input.lines.filter((l) => l.category === 'part')
      const selected = parts.slice(0, PRICING_LIMITS.maxPartsPerRequest)

      const items = await Promise.all(
        selected.map(async (line): Promise<PricedItem> => {
          const screen = screenPartDescription(line.description)
          if (!screen.ok) return { lineId: line.id, status: 'skipped', reason: screen.reason, offers: [], discarded: 0 }
          if (localSafetyCheck(line.description).blocked) return { lineId: line.id, status: 'skipped', reason: 'unsafe', offers: [], discarded: 0 }

          const query: PriceQuery = {
            description: line.description,
            partBrand: line.partBrand,
            partCode: line.partCode,
            vehicle: input.vehicle,
            presentation: line.presentation ?? 'unit',
            quantity: line.quantity ?? 1,
          }
          const result = await lookup(provider, query, input.beforeProviderCall)
          const diag = result.diagnostics ? { diagnostics: result.diagnostics } : {}
          if (result.status === 'unavailable' || result.status === 'disabled') {
            return { lineId: line.id, status: 'unavailable', reason: result.reason ?? result.status, offers: [], discarded: 0, droppedInvalid: 0, ...diag }
          }
          const evaluated = result.offers.map((offer) => ({ offer, match: evaluateMatch(query, offer) }))
          const kept = evaluated.filter((e) => e.match.decision !== 'discard')
          const discardReasons: Record<string, number> = {}
          for (const e of evaluated) {
            if (e.match.decision === 'discard') for (const r of e.match.reasons) discardReasons[r] = (discardReasons[r] ?? 0) + 1
          }
          // Candidates first, then review; provider order otherwise. Never sorted by price.
          kept.sort((a, b) => (a.match.decision === b.match.decision ? 0 : a.match.decision === 'candidate' ? -1 : 1))
          return {
            lineId: line.id,
            status: kept.length ? 'ok' : 'no_results',
            offers: kept.slice(0, PRICING_LIMITS.maxOffersPerPart),
            discarded: evaluated.length - kept.length,
            droppedInvalid: result.droppedInvalid,
            discardReasons,
            ...diag,
            ...(input.audit ? { audit: buildDiscardAudit(query, evaluated, result.auditDropped) } : {}),
          }
        }),
      )
      return { status: 'ok', provider: provider.id, items, truncated: parts.length > selected.length }
    },
  }
}
