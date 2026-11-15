/**
 * serpapi-provider.ts — SerpApi Google Shopping (engine=google_shopping, gl=ar). SERVER ONLY.
 *
 * Fixed endpoint https://serpapi.com/search.json; SERPAPI_API_KEY only in server env and never
 * returned or logged (the request URL is never stored in results or diagnostics). SerpApi returns
 * `price` as a display string and `extracted_price` as a float without an explicit currency
 * field: the display string is the only currency evidence (gl=ar → "$" = Argentine peso; "US$",
 * "USD", "U$S", "€", "R$"... are rejected) and the amount must parse exactly to centavos.
 * The product link must be https on a Google Shopping host.
 *
 * Error contract (SerpApi docs, "API Status and Error Codes"): HTTP 200 with
 * search_metadata.status "Success" can still carry a top-level `error` — "Google hasn't returned
 * any results for this query." means a genuinely empty search; status "Error" means the search
 * failed (proxy timeout, internal error) and must NOT be reported as "no results".
 *
 * Contract note: SerpApi obtains Google results itself; Google's own terms do not grant a license
 * for automated querying. Legal review required before production use (spike doc §4).
 */
import { parseArsAmount } from '@/domain/budget/research/ars-amount'
import { buildProviderQuery } from './query'
import {
  allowedHttpsUrl,
  bodyFailure,
  cleanText,
  countDrop,
  emptyDiagnostics,
  httpFailure,
  networkFailure,
  noteLinkHost,
  notePriceFormat,
  toMinor,
  unavailable,
} from './provider-utils'
import { budgetAccountFor } from './search-budget'
import type { DropReason, FetchLike, PriceOffer, PriceProvider, PriceQuery, ProviderDiagnostics, ProviderResult } from './types'

export const SERPAPI_URL = 'https://serpapi.com/search.json'
/**
 * Google Shopping via SerpApi is slower than a JSON API: the first real probe measured 1.5–3 s
 * per non-cached search and one case aborted at the old 4 s limit; in production a search aborted
 * at 10 s. Aborting does NOT cancel the search on SerpApi's side (it is billed when it completes),
 * so a premature abort spends the credit and shows nothing: waiting a little longer costs no
 * extra searches. Parts are searched in parallel, so the request-level wait stays ≈ this value.
 * Kept below the client timeout (auto-pricing-panel, 25 s) and the route's maxDuration (30 s).
 * Never retried automatically.
 */
export const SERPAPI_TIMEOUT_MS = 15_000
/**
 * Google Shopping returns one page (~40 items) per search and SerpApi bills per SEARCH, not per
 * item: evaluate the whole page (first real probe: raw=40 but only the first 10 were examined).
 * The service still presents at most PRICING_LIMITS.maxOffersPerPart.
 */
export const SERPAPI_MAX_RESULTS = 40
const LINK_HOSTS = ['google.com.ar', 'google.com'] as const
/** Flat result arrays SerpApi may use for Google Shopping (classic and inline layouts). */
const RESULT_ARRAYS = ['shopping_results', 'inline_shopping_results'] as const
const EMPTY_RESULTS = /hasn'?t returned any results/i
const FOREIGN_CURRENCY = /US\$|U\$S|USD|€|EUR|R\$|BRL|CLP|UYU|MXN/i

/** es-419 / US display format ("$25,000.00", "25000.00"): only used when confirmed by extracted_price. */
function parseDotDecimalAmount(raw: string): number | null {
  const s = raw.replace(/\$|ars|pesos?|\s/gi, '')
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(s)) return null
  const [intPart, decPart = ''] = s.split('.')
  const minor = Number(intPart!.replace(/,/g, '')) * 100 + Number(decPart.padEnd(2, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}

/**
 * ARS price from the display string. Digits may be formatted es-AR ("25.000,00") or es-419/US
 * ("25,000.00") depending on the language Google applies; when `extracted_price` is present the
 * parsed amount must agree with it EXACTLY — never guessed. Without it, only es-AR is accepted.
 */
function arsPrice(rawDisplay: unknown, extracted: unknown): { minor: number } | { drop: DropReason } {
  if (typeof rawDisplay !== 'string' || !rawDisplay.trim()) return { drop: 'price_missing' }
  if (FOREIGN_CURRENCY.test(rawDisplay)) return { drop: 'price_foreign_currency' }
  let display = rawDisplay
  // Promotional current price as shown by Google Shopping AR: "$ 32.700,00 ahora". Only the
  // trailing word is removed; the amount must still agree with extracted_price (below).
  const promo = /\s+ahora\s*$/i.test(display)
  if (promo) {
    if (toMinor(extracted) === null) return { drop: 'price_unparsed' }
    display = display.replace(/\s+ahora\s*$/i, '')
  }
  const ar = parseArsAmount(display)
  const extractedMinor = toMinor(extracted)
  if (extractedMinor === null) return ar !== null && ar > 0 ? { minor: ar } : { drop: 'price_unparsed' }
  const candidates = [ar, parseDotDecimalAmount(display)].filter((v): v is number => v !== null)
  if (candidates.length === 0) return { drop: 'price_unparsed' }
  return candidates.includes(extractedMinor) ? { minor: extractedMinor } : { drop: 'price_mismatch' }
}

function classifyError(text: string): NonNullable<ProviderDiagnostics['providerError']> {
  if (EMPTY_RESULTS.test(text)) return 'empty_results'
  if (/api[ _]?key/i.test(text)) return 'invalid_key'
  if (/run out|searches left|limit|plan/i.test(text)) return 'quota'
  return 'other'
}

function metaStatus(body: Record<string, unknown>): NonNullable<ProviderDiagnostics['providerStatus']> {
  const s = (body.search_metadata as { status?: unknown } | undefined)?.status
  if (s === 'Success') return 'success'
  if (s === 'Error') return 'error'
  if (s === 'Processing' || s === 'Queued') return 'processing'
  return 'unknown'
}

/** All result items, de-duplicated by product_id, with raw counts per array. null → malformed. */
function collectResults(body: Record<string, unknown>, d: ProviderDiagnostics): unknown[] | null {
  const all: unknown[] = []
  const add = (name: string, arr: unknown[]) => {
    d.sourceCounts[name] = (d.sourceCounts[name] ?? 0) + arr.length
    all.push(...arr)
  }
  const categorized = body.categorized_shopping_results
  if (categorized !== undefined) {
    if (!Array.isArray(categorized)) return null
    for (const group of categorized) {
      const arr = (group as { shopping_results?: unknown } | null)?.shopping_results
      if (Array.isArray(arr)) add('categorized_shopping_results', arr)
    }
  }
  for (const name of RESULT_ARRAYS) {
    const arr = body[name]
    if (arr === undefined) continue
    if (!Array.isArray(arr)) return null
    add(name, arr)
  }
  const seen = new Set<string>()
  return all.filter((r) => {
    const id = (r as { product_id?: unknown } | null)?.product_id
    if (typeof id !== 'string' && typeof id !== 'number') return true
    const key = String(id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function createSerpApiProvider(opts: { apiKey: string | undefined; fetch?: FetchLike; timeoutMs?: number; now?: () => Date; /** Probe only: keep dropped titles. */ audit?: boolean }): PriceProvider {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  return {
    id: 'serpapi',
    budgetAccount: budgetAccountFor('serpapi', opts.apiKey ?? ''),
    async search(query: PriceQuery): Promise<ProviderResult> {
      const startedAt = Date.now()
      if (!opts.apiKey) return { status: 'disabled', offers: [], droppedInvalid: 0, latencyMs: 0 }

      const url = new URL(SERPAPI_URL)
      url.searchParams.set('engine', 'google_shopping')
      url.searchParams.set('q', buildProviderQuery(query))
      url.searchParams.set('gl', 'ar')
      url.searchParams.set('hl', 'es')
      url.searchParams.set('google_domain', 'google.com.ar')
      // Country-level location (canonical SerpApi name). Without it SerpApi may use its proxy's
      // location. Never the user's location: no personal data leaves the server.
      url.searchParams.set('location', 'Argentina')
      url.searchParams.set('api_key', opts.apiKey)

      const timeoutMs = opts.timeoutMs ?? SERPAPI_TIMEOUT_MS
      let res: Response
      try {
        // One attempt only: a paid search is never retried automatically.
        res = await doFetch(url.toString(), { method: 'GET', signal: AbortSignal.timeout(timeoutMs), redirect: 'error', cache: 'no-store' })
      } catch (e) {
        return unavailable(networkFailure(e), startedAt, { ...emptyDiagnostics(), failurePhase: 'request', timeoutMs })
      }
      const diagnostics: ProviderDiagnostics = { ...emptyDiagnostics(res.status), timeoutMs }
      if (!res.ok) {
        diagnostics.providerError = res.status === 401 ? 'invalid_key' : res.status === 429 ? 'quota' : 'other'
        return unavailable(httpFailure(res.status), startedAt, diagnostics)
      }

      let body: unknown
      try {
        body = await res.json()
      } catch (e) {
        diagnostics.failurePhase = 'body'
        return unavailable(bodyFailure(e), startedAt, diagnostics)
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return unavailable('bad_response', startedAt, diagnostics)
      const b = body as Record<string, unknown>

      diagnostics.providerStatus = metaStatus(b)
      // The provider's raw error text is never stored: it may echo request details.
      const errorCode = typeof b.error === 'string' ? classifyError(b.error) : undefined
      if (errorCode) diagnostics.providerError = errorCode
      if (diagnostics.providerStatus === 'error' || diagnostics.providerStatus === 'processing' || (errorCode && errorCode !== 'empty_results')) {
        diagnostics.providerError ??= 'other'
        return unavailable('provider_error', startedAt, diagnostics)
      }

      const results = collectResults(b, diagnostics)
      if (results === null) return unavailable('bad_response', startedAt, diagnostics)
      diagnostics.rawCount = results.length

      const retrievedAt = (opts.now?.() ?? new Date()).toISOString()
      const offers: PriceOffer[] = []
      const auditDropped: Array<{ title: string; reason: DropReason }> = []
      let dropped = 0
      let currentTitle = ''
      const drop = (reason: DropReason) => {
        dropped++
        countDrop(diagnostics, reason)
        if (opts.audit) auditDropped.push({ title: currentTitle || '(sin título)', reason })
      }
      for (const raw of results.slice(0, SERPAPI_MAX_RESULTS)) {
        if (!raw || typeof raw !== 'object') {
          drop('not_object')
          continue
        }
        const r = raw as Record<string, unknown>
        notePriceFormat(diagnostics, r.price)
        const id = cleanText(typeof r.product_id === 'number' ? String(r.product_id) : r.product_id, 40) ?? cleanText(String(r.position ?? ''), 10)
        const title = cleanText(r.title, 300)
        currentTitle = title ?? ''
        if (!id) {
          drop('id_missing')
          continue
        }
        if (!title) {
          drop('title_missing')
          continue
        }
        const price = arsPrice(r.price, r.extracted_price)
        if ('drop' in price) {
          drop(price.drop)
          continue
        }
        const link = allowedHttpsUrl(r.product_link, LINK_HOSTS)
        if (!link) {
          if (typeof r.product_link === 'string' && r.product_link) {
            noteLinkHost(diagnostics, r.product_link)
            drop('link_host')
          } else drop('link_missing')
          continue
        }
        const merchant = cleanText(r.source, 80)
        if (!merchant) {
          drop('merchant_missing')
          continue
        }
        offers.push({
          provider: 'serpapi',
          providerItemId: id,
          title,
          priceMinor: price.minor,
          currency: 'ARS',
          url: link,
          merchant,
          condition: typeof r.second_hand_condition === 'string' ? 'used' : 'unknown',
          retrievedAt,
        })
      }
      return { status: offers.length ? 'ok' : 'no_results', offers, droppedInvalid: dropped, latencyMs: Date.now() - startedAt, diagnostics, ...(opts.audit ? { auditDropped } : {}) }
    },
  }
}
