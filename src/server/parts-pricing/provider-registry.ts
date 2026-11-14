/**
 * provider-registry.ts — Explicit opt-in. No provider runs unless PARTS_PRICING_PROVIDER names a
 * known provider AND its server-side credential exists. Default: none (7B manual flow only).
 * Env vars are server-only (never NEXT_PUBLIC_*).
 */
import { createMercadoLibreProvider } from './mercadolibre-provider'
import { createSerpApiProvider } from './serpapi-provider'
import type { PriceProvider } from './types'

/** `audit` is for the opt-in probe only (keeps dropped titles locally); the API route never sets it. */
export function selectPriceProvider(env: Record<string, string | undefined>, opts: { audit?: boolean } = {}): PriceProvider | null {
  switch (env.PARTS_PRICING_PROVIDER) {
    case 'mercadolibre':
      return env.MELI_ACCESS_TOKEN ? createMercadoLibreProvider({ accessToken: env.MELI_ACCESS_TOKEN }) : null
    case 'serpapi':
      return env.SERPAPI_API_KEY ? createSerpApiProvider({ apiKey: env.SERPAPI_API_KEY, audit: opts.audit }) : null
    default:
      return null
  }
}
