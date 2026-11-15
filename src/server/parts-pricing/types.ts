/**
 * types.ts — Automatic parts pricing (Incremento 7C spike). SERVER ONLY.
 * Provider calls never run in the browser; API keys live only in server env vars.
 */
import type { Presentation, VehicleInfo } from '@/domain/budget/research/types'

if (typeof window !== 'undefined') throw new Error('parts-pricing is server-only')

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type ProviderId = 'mercadolibre' | 'serpapi'

export interface PriceQuery {
  description: string
  partBrand?: string
  partCode?: string
  vehicle: VehicleInfo
  presentation: Presentation
  quantity: number
}

export type OfferCondition = 'new' | 'used' | 'refurbished' | 'unknown'

/** A published offer exactly as reported by an authorized provider (never generated). */
export interface PriceOffer {
  provider: ProviderId
  providerItemId: string
  title: string
  /** ARS minor units (centavos). */
  priceMinor: number
  currency: 'ARS'
  /** https URL reported by the provider (validated host); never fetched by Chuya Motor. */
  url: string
  merchant: string
  condition: OfferCondition
  /** ISO timestamp of the query. */
  retrievedAt: string
  brand?: string
  partNumber?: string
}

export type UnavailableReason =
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'provider_error'
  | 'timeout'
  | 'network'
  | 'bad_response'
  /** Search budget (client / daily / monthly) exhausted: the provider was NOT called. */
  | 'quota_exceeded'
  /** Production without a shared counter store: fail closed, the provider was NOT called. */
  | 'store_unavailable'

export type DropReason =
  | 'id_missing'
  | 'title_missing'
  | 'price_missing'
  | 'price_foreign_currency'
  | 'price_unparsed'
  | 'price_mismatch'
  | 'link_missing'
  | 'link_host'
  | 'merchant_missing'
  | 'not_object'

/**
 * Safe diagnostics: counters, codes and reasons only. Never contains the API key, the request URL,
 * the provider's raw error text, titles or prices. `priceFormats` are display strings with every
 * digit masked to 9 (shape only); `linkHosts` are hostnames of REJECTED links (no path or query).
 */
export interface ProviderDiagnostics {
  httpStatus?: number
  providerStatus?: 'success' | 'error' | 'processing' | 'unknown'
  providerError?: 'empty_results' | 'invalid_key' | 'quota' | 'other'
  /** Raw item counts per result array as returned by the provider (before de-duplication). */
  sourceCounts: Record<string, number>
  /** Unique items considered (after de-duplication, before the per-query cap). */
  rawCount: number
  dropReasons: Partial<Record<DropReason, number>>
  priceFormats: string[]
  linkHosts: string[]
}

export interface ProviderResult {
  status: 'ok' | 'no_results' | 'unavailable' | 'disabled'
  reason?: UnavailableReason
  offers: PriceOffer[]
  /** Results dropped by validation (currency, URL, price, title). */
  droppedInvalid: number
  latencyMs: number
  diagnostics?: ProviderDiagnostics
  /**
   * Audit mode only (opt-in probe): titles of results dropped by validation, with the reason.
   * Never cached, never sent to clients.
   */
  auditDropped?: Array<{ title: string; reason: DropReason }>
}

export interface PriceProvider {
  id: ProviderId
  /**
   * Billing account the search budget is charged to (e.g. "serpapi:<sha256 of the key, 16 hex>").
   * Never contains the credential. Defaults to the provider id.
   */
  budgetAccount?: string
  search(query: PriceQuery): Promise<ProviderResult>
}
