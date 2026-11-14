/**
 * mercadolibre-provider.ts — Mercado Libre Argentina official API (site MLA). SERVER ONLY.
 *
 * GET https://api.mercadolibre.com/sites/MLA/search?q=…&limit=10 with an OAuth bearer token from
 * MELI_ACCESS_TOKEN (never sent to the browser). Fixed host and path: no caller-provided URL.
 * Status 2025–2026: the official docs still list this resource with a bearer token, but several
 * independent reports describe 403 responses for keyword search. Validate with a registered app
 * before enabling (see docs/reviews/parts-pricing-spike-7c.md). A 403 maps to "forbidden".
 */
import { buildProviderQuery } from './query'
import { MAX_RESULTS_PER_QUERY, PROVIDER_TIMEOUT_MS, allowedHttpsUrl, bodyFailure, cleanText, countDrop, emptyDiagnostics, httpFailure, noteLinkHost, networkFailure, toMinor, unavailable } from './provider-utils'
import type { FetchLike, OfferCondition, PriceOffer, PriceProvider, PriceQuery, ProviderResult } from './types'

export const MELI_SEARCH_URL = 'https://api.mercadolibre.com/sites/MLA/search'
const PERMALINK_HOSTS = ['mercadolibre.com.ar'] as const

interface MeliAttribute {
  id?: unknown
  value_name?: unknown
}

function attr(attributes: unknown, ids: readonly string[]): string | undefined {
  if (!Array.isArray(attributes)) return undefined
  const found = (attributes as MeliAttribute[]).find((a) => typeof a?.id === 'string' && ids.includes(a.id))
  return cleanText(found?.value_name, 60) ?? undefined
}

function condition(raw: unknown): OfferCondition {
  return raw === 'new' || raw === 'used' || raw === 'refurbished' ? raw : 'unknown'
}

export function createMercadoLibreProvider(opts: { accessToken: string | undefined; fetch?: FetchLike; timeoutMs?: number; now?: () => Date }): PriceProvider {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  return {
    id: 'mercadolibre',
    async search(query: PriceQuery): Promise<ProviderResult> {
      const startedAt = Date.now()
      if (!opts.accessToken) return { status: 'disabled', offers: [], droppedInvalid: 0, latencyMs: 0 }

      const url = new URL(MELI_SEARCH_URL)
      url.searchParams.set('q', buildProviderQuery(query))
      url.searchParams.set('limit', String(MAX_RESULTS_PER_QUERY))

      let res: Response
      try {
        res = await doFetch(url.toString(), {
          method: 'GET',
          headers: { Authorization: `Bearer ${opts.accessToken}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(opts.timeoutMs ?? PROVIDER_TIMEOUT_MS),
          redirect: 'error',
          cache: 'no-store',
        })
      } catch (e) {
        return unavailable(networkFailure(e), startedAt, emptyDiagnostics())
      }
      const diagnostics = emptyDiagnostics(res.status)
      if (!res.ok) return unavailable(httpFailure(res.status), startedAt, diagnostics)

      let body: { results?: unknown }
      try {
        body = (await res.json()) as { results?: unknown }
      } catch (e) {
        return unavailable(bodyFailure(e), startedAt, diagnostics)
      }
      if (!body || !Array.isArray(body.results)) return unavailable('bad_response', startedAt, diagnostics)
      diagnostics.sourceCounts.results = body.results.length
      diagnostics.rawCount = body.results.length

      const retrievedAt = (opts.now?.() ?? new Date()).toISOString()
      const offers: PriceOffer[] = []
      let dropped = 0
      for (const r of body.results.slice(0, MAX_RESULTS_PER_QUERY) as Array<Record<string, unknown>>) {
        const id = cleanText(r?.id, 40)
        const title = cleanText(r?.title, 300)
        const priceMinor = r?.currency_id === 'ARS' ? toMinor(r?.price) : null
        const permalink = allowedHttpsUrl(r?.permalink, PERMALINK_HOSTS)
        const seller = cleanText((r?.seller as { nickname?: unknown } | undefined)?.nickname, 80)
        if (!id || !title || priceMinor === null || !permalink) {
          dropped++
          countDrop(diagnostics, !id ? 'id_missing' : !title ? 'title_missing' : r?.currency_id !== 'ARS' ? 'price_foreign_currency' : priceMinor === null ? 'price_unparsed' : 'link_host')
          if (!permalink) noteLinkHost(diagnostics, r?.permalink)
          continue
        }
        offers.push({
          provider: 'mercadolibre',
          providerItemId: id,
          title,
          priceMinor,
          currency: 'ARS',
          url: permalink,
          merchant: seller ?? 'Vendedor de Mercado Libre',
          condition: condition(r?.condition),
          retrievedAt,
          brand: attr(r?.attributes, ['BRAND']),
          partNumber: attr(r?.attributes, ['PART_NUMBER', 'OEM', 'MPN']),
        })
      }
      return { status: offers.length ? 'ok' : 'no_results', offers, droppedInvalid: dropped, latencyMs: Date.now() - startedAt, diagnostics }
    },
  }
}
