/**
 * route-handler.ts — POST /api/budget/parts-prices (Incremento 7C, minimal integration). SERVER ONLY.
 *
 * Order of checks (each one fails safe, none calls the provider):
 *   1. Feature flag (server env only). Off → 404, as if the route did not exist.
 *   2. Content-Type, body size, JSON, strict Zod schema (unknown keys rejected: the client cannot
 *      pass flags, providers, URLs or budgets).
 *   3. Per-client request rate (hashed IP; shared store, per-instance fallback).
 *   4. Provider configured? (PARTS_PRICING_PROVIDER + server credential) and runtime kill switch
 *      (Upstash flag, no redeploy needed) not set? else status "disabled".
 *   5. Per part: server-side identification (labor / other concepts are never searched), the 7B
 *      safety screen (unchanged Safety Gate), per-process + shared cache, in-flight de-duplication,
 *      and — only on a cache miss — ONE atomic reservation of the search budget (search-budget.ts):
 *      per client per day, per SerpApi account per hour / day / rolling 31 days. Production
 *      without a distributed store → fail closed (no provider call).
 * The response carries only validated offers, decisions and "missing data" codes: never the API
 * key, provider diagnostics, request URLs, or any price difference / average / verdict.
 */
import { z } from 'zod'
import { classifyDescription } from '@/domain/budget/research/line-parser'
import { readLlmProtectionConfig, type LlmProtectionConfig } from '@/server/llm-protection/protection-config'
import { InMemoryQuotaStore, type QuotaStore } from '@/server/llm-protection/quota-store'
import { resolveSharedStore } from '@/server/llm-protection/runtime'
import { clientKeyFor, resolveClientIp } from '@/server/llm-protection/client-identity'
import { readPartsPricingConfig, type PartsPricingConfig } from './pricing-config'
import { PRICING_LIMITS, createPricingService, type PricedItem, type SearchGate } from './pricing-service'
import { selectPriceProvider } from './provider-registry'
import { createSearchGate, isPricingKillSwitchOn } from './search-budget'
import { MemoryPricingCache, UpstashPricingCache, type PricingCache } from './shared-cache'
import { consoleSearchListener, type PricingSearchListener } from './search-telemetry'
import type { ClientOffer, ClientPricedItem, MissingData, PartsPricesResponse } from '@/domain/budget/research/parts-prices-contract'
import type { PriceProvider } from './types'

if (typeof window !== 'undefined') throw new Error('parts-pricing is server-only')

export const MAX_BODY_BYTES = 8_192
const HOUR_MS = 3_600_000


const optText = (max: number) => z.string().max(max).optional()

export const PartsPricesRequestSchema = z
  .object({
    vehicle: z
      .object({
        make: optText(40),
        model: optText(40),
        year: z.union([z.literal(''), z.string().regex(/^(19|20)\d{2}$/)]).optional(),
        engine: optText(40),
      })
      .strict(),
    lines: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
            description: z.string().min(1).max(200),
            presentation: z.enum(['unit', 'pair', 'set', 'kit', 'liter']).optional(),
            quantity: z.number().int().min(1).max(999).optional(),
            partBrand: optText(40),
            partCode: optText(40),
          })
          .strict(),
      )
      .min(1)
      .max(PRICING_LIMITS.maxPartsPerRequest),
  })
  .strict()

export type { ClientOffer, ClientPricedItem, MissingData, PartsPricesResponse }

export interface HandlerDeps {
  env?: Record<string, string | undefined>
  /** Test overrides (never set in the route). */
  provider?: PriceProvider | null
  store?: QuotaStore | null
  cache?: PricingCache
  now?: () => number
  /** Safe search diagnostics sink (default: one JSON line on stdout, silent under tests). */
  onSearch?: PricingSearchListener
}

// Per-process singletons (counters fallback, cache, service) — survive across requests.
let localStore: InMemoryQuotaStore | null = null
let memoryCache: MemoryPricingCache | null = null
let upstashCache: { sig: string; cache: UpstashPricingCache } | null = null
const services = new Map<string, ReturnType<typeof createPricingService>>()

export function resetPartsPricingRuntimeForTests(): void {
  localStore = null
  memoryCache = null
  upstashCache = null
  services.clear()
}

function json(status: number, body: PartsPricesResponse): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

function missingData(item: PricedItem['offers'][number], vehicle: { year?: string; engine?: string }): MissingData[] {
  const s = item.match.signals
  const r = item.match.reasons
  const out: MissingData[] = []
  if (s.partCode !== 'match') out.push('part_code')
  if (s.presentation !== 'match') out.push('presentation')
  if (s.condition !== 'new') out.push('condition')
  if (s.model !== 'match') out.push('model')
  if (vehicle.year && s.year !== 'match') out.push('year')
  if (vehicle.engine && (s.engine !== 'match' || r.includes('fuel_unverified'))) out.push('engine')
  if (r.includes('multi_vehicle_listing')) out.push('multi_vehicle')
  if (r.includes('model_variant')) out.push('model_variant')
  if (s.position === 'unverified') out.push('position')
  return out
}

function toClientItem(item: PricedItem, vehicle: { model?: string; year?: string; engine?: string }): ClientPricedItem {
  // Only offers whose title names the requested model are shown; the rest are counted.
  const visible = item.offers.filter((o) => !vehicle.model || o.match.signals.model === 'match')
  return {
    lineId: item.lineId,
    status: item.status === 'ok' && visible.length === 0 ? 'no_results' : item.status,
    ...(item.reason ? { reason: item.reason } : {}),
    hidden: item.offers.length - visible.length,
    offers: visible.map((o) => ({
      title: o.offer.title,
      merchant: o.offer.merchant,
      priceMinor: o.offer.priceMinor,
      currency: 'ARS',
      url: o.offer.url,
      retrievedAt: o.offer.retrievedAt,
      decision: o.match.decision === 'candidate' ? 'candidate' : 'needs_review',
      codeMatch: o.match.signals.partCode === 'match',
      missing: missingData(o, vehicle),
    })),
  }
}

function sharedCacheFor(llm: LlmProtectionConfig | null): PricingCache {
  if (llm?.store === 'upstash' && llm.upstash) {
    const sig = `${llm.upstash.url}|${llm.upstash.token.length}|${llm.upstash.token.slice(-4)}`
    if (!upstashCache || upstashCache.sig !== sig) upstashCache = { sig, cache: new UpstashPricingCache(llm.upstash) }
    return upstashCache.cache
  }
  memoryCache ??= new MemoryPricingCache()
  return memoryCache
}

function serviceFor(provider: PriceProvider, cache: PricingCache, prefix: string, onSearch: PricingSearchListener) {
  const key = `${provider.id}|${cache.distributed}|${prefix}`
  let s = services.get(key)
  if (!s) {
    s = createPricingService({ provider, sharedCache: cache, cacheKeyPrefix: prefix, onSearch })
    services.set(key, s)
  }
  return s
}

export async function handlePartsPricesRequest(req: Request, deps: HandlerDeps = {}): Promise<Response> {
  const env = deps.env ?? process.env
  const now = deps.now ?? Date.now

  let cfg: PartsPricingConfig
  try {
    cfg = readPartsPricingConfig(env)
  } catch {
    return json(503, { status: 'error' })
  }
  if (!cfg.enabled) return json(404, { status: 'not_found' })

  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return json(415, { status: 'invalid_request' })
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return json(413, { status: 'invalid_request' })
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return json(400, { status: 'invalid_request' })
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { status: 'invalid_request' })
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    return json(400, { status: 'invalid_request' })
  }
  const parsed = PartsPricesRequestSchema.safeParse(parsedJson)
  if (!parsed.success) return json(400, { status: 'invalid_request' })
  const body = parsed.data

  let llm: LlmProtectionConfig | null = null
  try {
    llm = readLlmProtectionConfig(env)
  } catch {
    llm = null
  }
  const prefix = llm?.keyPrefix ?? 'chuya'
  let store: QuotaStore | null = deps.store !== undefined ? deps.store : null
  if (deps.store === undefined && llm) {
    try {
      store = resolveSharedStore(llm)
    } catch {
      store = null
    }
  }
  const clientKey = clientKeyFor(llm ? resolveClientIp(req.headers, llm.clientIpHeader, llm.trustedProxyHops) : null, llm?.clientIdSalt ?? '')

  // 3. Per-client request rate.
  const rlKey = `${prefix}:pp:rl:${clientKey}:${Math.floor(now() / HOUR_MS)}`
  let allowed: boolean
  try {
    if (!store) throw new Error('no store')
    allowed = (await store.reserve(rlKey, 1, cfg.clientRequestsPerHour, HOUR_MS)).ok
  } catch {
    localStore ??= new InMemoryQuotaStore()
    allowed = (await localStore.reserve(rlKey, 1, cfg.clientRequestsPerHour, HOUR_MS)).ok
  }
  if (!allowed) return json(429, { status: 'rate_limited' })

  // 4. Provider (server env only).
  const provider = deps.provider !== undefined ? deps.provider : selectPriceProvider(env)
  if (!provider) return json(200, { status: 'disabled' })
  // Runtime kill switch in the shared store (takes effect immediately, no redeploy).
  if (await isPricingKillSwitchOn(store)) return json(200, { status: 'disabled' })

  // 5. Search budget gate — runs only before a billed search (cache miss). One atomic reservation
  //    per search across every limit, charged to the provider account (search-budget.ts).
  const gate: SearchGate = createSearchGate({
    store,
    limits: cfg,
    clientKey,
    account: provider.budgetAccount ?? provider.id,
    now,
    requireDistributed: cfg.requireDistributedStore,
  })

  const cache = deps.cache ?? sharedCacheFor(llm)
  const onSearch = deps.onSearch ?? consoleSearchListener()
  const service =
    deps.provider !== undefined || deps.cache ? createPricingService({ provider, sharedCache: cache, cacheKeyPrefix: prefix, onSearch }) : serviceFor(provider, cache, prefix, onSearch)

  // Server-side identification: labor and other concepts are never searched.
  const identified = body.lines.map((l) => ({ line: l, category: classifyDescription(l.description) }))
  const searchable = identified.filter((x) => x.category === 'part' || x.category === 'unclassified')
  const vehicle = { make: body.vehicle.make || undefined, model: body.vehicle.model || undefined, year: body.vehicle.year || undefined, engine: body.vehicle.engine || undefined }

  try {
    const result = await service.research({
      lines: searchable.map(({ line }) => ({ id: line.id, description: line.description, category: 'part' as const, partBrand: line.partBrand || undefined, partCode: line.partCode || undefined, presentation: line.presentation, quantity: line.quantity })),
      vehicle,
      beforeProviderCall: gate,
    })
    const byId = new Map(result.items.map((i) => [i.lineId, i]))
    const items: ClientPricedItem[] = identified.map(({ line, category }) => {
      if (category === 'labor' || category === 'other') return { lineId: line.id, status: 'skipped', reason: 'not_a_part', offers: [], hidden: 0 }
      const item = byId.get(line.id)
      return item ? toClientItem(item, vehicle) : { lineId: line.id, status: 'skipped', reason: 'limit', offers: [], hidden: 0 }
    })
    return json(200, { status: 'ok', provider: provider.id, items, truncated: result.truncated })
  } catch {
    return json(200, { status: 'error' })
  }
}
