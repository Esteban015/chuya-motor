/**
 * serpapi-resilience.test.ts — 7C: SerpApi timeouts, observability and no automatic retries.
 * Real SerpApi adapter + real route handler over a FAKE fetch that honors the abort signal.
 * No network, no real searches, no credentials, SYNTHETIC data only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { InMemoryQuotaStore } from '@/server/llm-protection/quota-store'
import { ITEM_REASON_LABEL } from '@/domain/budget/research/parts-prices-contract'
import { handlePartsPricesRequest, resetPartsPricingRuntimeForTests } from './route-handler'
import { createSerpApiProvider, SERPAPI_TIMEOUT_MS } from './serpapi-provider'
import { createPricingService } from './pricing-service'
import { setPricingKillSwitch } from './search-budget'
import { MemoryPricingCache } from './shared-cache'
import { consoleSearchListener, toSafeSearchLog, type PricingSearchEvent } from './search-telemetry'
import type { FetchLike, PriceQuery } from './types'

const KEY = 'SERPAPI_SECRET_RESILIENCE_KEY'
const ON = { PARTS_PRICING_ENABLED: 'true', LLM_QUOTA_STORE: 'memory' }
const TIMEOUT = 60
const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', engine: '' }
const airFilter = { vehicle, lines: [{ id: 'l1', description: 'Filtro de aire' }] }
const query: PriceQuery = { description: 'Filtro de aire', vehicle, presentation: 'unit', quantity: 1 }

const okBody = {
  search_metadata: { status: 'Success' },
  shopping_results: [{ position: 1, product_id: '9', title: 'Filtro De Aire Fiat Palio 2017', price: '$ 9.000,00', extracted_price: 9000, source: 'Tienda Sintética', product_link: 'https://www.google.com.ar/shopping/product/9' }],
}
const emptyBody = { search_metadata: { status: 'Success' }, error: "Google hasn't returned any results for this query." }

/** Rejects with the signal's reason when aborted, like the real fetch (TimeoutError). */
function onAbort(signal: AbortSignal | null | undefined, reject: (e: unknown) => void, cleanup: () => void) {
  signal?.addEventListener('abort', () => {
    cleanup()
    reject(signal.reason)
  })
}

/** Headers after `headersMs`, body after a further `bodyMs`; both phases honor the timeout signal. */
function timedFetch(headersMs: number, body: unknown, bodyMs = 0) {
  const calls: string[] = []
  const fn: FetchLike = (url, init) =>
    new Promise<Response>((resolve, reject) => {
      calls.push(String(url))
      const t = setTimeout(
        () =>
          resolve({
            ok: true,
            status: 200,
            json: () =>
              new Promise((res, rej) => {
                const tb = setTimeout(() => res(body), bodyMs)
                onAbort(init?.signal, rej, () => clearTimeout(tb))
              }),
          } as unknown as Response),
        headersMs,
      )
      onAbort(init?.signal, reject, () => clearTimeout(t))
    })
  return { fn, calls }
}

function failingFetch(e: unknown) {
  const calls: string[] = []
  const fn: FetchLike = async (url) => {
    calls.push(String(url))
    throw e
  }
  return { fn, calls }
}

function bodyFailingFetch(e: unknown) {
  const calls: string[] = []
  const fn: FetchLike = async (url) => {
    calls.push(String(url))
    return { ok: true, status: 200, json: async () => { throw e } } as unknown as Response
  }
  return { fn, calls }
}

const serp = (fetch: FetchLike) => createSerpApiProvider({ apiKey: KEY, fetch, timeoutMs: TIMEOUT })

let ip = 1
function req(body: unknown = airFilter): Request {
  return new Request('http://localhost/api/budget/parts-prices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${ip++}` },
    body: JSON.stringify(body),
  })
}

async function run(fetch: FetchLike, extra: { env?: Record<string, string>; store?: InMemoryQuotaStore; cache?: MemoryPricingCache } = {}) {
  const events: PricingSearchEvent[] = []
  const r = await handlePartsPricesRequest(req(), { env: extra.env ?? ON, provider: serp(fetch), store: extra.store ?? new InMemoryQuotaStore(), cache: extra.cache, onSearch: (e) => events.push(e) })
  return { status: r.status, text: await r.clone().text(), body: await r.json(), events }
}

afterEach(() => {
  resetPartsPricingRuntimeForTests()
  vi.restoreAllMocks()
})

describe('SR-01 timeout configuration', () => {
  it('15 s provider timeout, below the browser timeout (25 s) and the function limit (maxDuration 30 s)', () => {
    expect(SERPAPI_TIMEOUT_MS).toBe(15_000)
    const panel = readFileSync(join(process.cwd(), 'src/components/budget-research/auto-pricing-panel.tsx'), 'utf8')
    const clientMs = Number(/CLIENT_TIMEOUT_MS = ([\d_]+)/.exec(panel)![1]!.replace(/_/g, ''))
    const route = readFileSync(join(process.cwd(), 'src/app/api/budget/parts-prices/route.ts'), 'utf8')
    const maxDurationS = Number(/export const maxDuration = (\d+)/.exec(route)![1])
    expect(SERPAPI_TIMEOUT_MS + 5_000).toBeLessThanOrEqual(clientMs)
    expect(clientMs).toBeLessThan(maxDurationS * 1000)
  })
  it('the default timeout is the one sent on the abort signal', async () => {
    let signal: AbortSignal | undefined
    const fn: FetchLike = async (_u, init) => {
      signal = init?.signal ?? undefined
      return { ok: true, status: 200, json: async () => okBody } as unknown as Response
    }
    await createSerpApiProvider({ apiKey: KEY, fetch: fn }).search(query)
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal!.aborted).toBe(false)
  })
})

describe('SR-02 response before / after the timeout', () => {
  it('response before the timeout → ok with offers, one call', async () => {
    const f = timedFetch(5, okBody)
    const r = await run(f.fn)
    expect(r.body.items[0]).toMatchObject({ status: 'ok' })
    expect(r.body.items[0].offers).toHaveLength(1)
    expect(f.calls).toHaveLength(1)
    expect(r.events).toHaveLength(1)
    expect(toSafeSearchLog(r.events[0]!)).toMatchObject({ cache: 'miss', outcome: 'ok', offers: 1, httpStatus: 200, timeoutMs: TIMEOUT })
  })

  it('no headers before the timeout → unavailable/timeout (phase request), NEVER no_results, one call, nothing cached', async () => {
    const cache = new MemoryPricingCache()
    const f = timedFetch(TIMEOUT * 5, okBody)
    const r = await run(f.fn, { cache })
    expect(r.status).toBe(200)
    expect(r.body.items[0]).toEqual({ lineId: 'l1', status: 'unavailable', reason: 'timeout', offers: [], hidden: 0 })
    expect(f.calls).toHaveLength(1)
    expect(toSafeSearchLog(r.events[0]!)).toMatchObject({ outcome: 'unavailable', reason: 'timeout', phase: 'request', timeoutMs: TIMEOUT })
    expect(r.events[0]!.durationMs).toBeGreaterThanOrEqual(TIMEOUT - 5)
    // The failure was not cached: the next explicit search asks the provider again (never "no results").
    const again = await run(timedFetch(5, okBody).fn, { cache })
    expect(again.body.items[0].status).toBe('ok')
  })

  it('headers in time but the body is slower than the timeout → unavailable/timeout (phase body)', async () => {
    const f = timedFetch(5, okBody, TIMEOUT * 5)
    const r = await run(f.fn)
    expect(r.body.items[0]).toMatchObject({ status: 'unavailable', reason: 'timeout' })
    expect(toSafeSearchLog(r.events[0]!)).toMatchObject({ reason: 'timeout', phase: 'body', httpStatus: 200 })
  })
})

describe('SR-03 network, HTTP and body failures are distinguished', () => {
  it('network error before the response → unavailable/network (phase request)', async () => {
    const r = await run(failingFetch(new TypeError('fetch failed')).fn)
    expect(r.body.items[0]).toMatchObject({ status: 'unavailable', reason: 'network' })
    expect(toSafeSearchLog(r.events[0]!)).toMatchObject({ reason: 'network', phase: 'request' })
  })
  it('abort while reading the body (stream terminated) → network, not "malformed" and not "no results"', async () => {
    const r = await run(bodyFailingFetch(new TypeError('terminated')).fn)
    expect(r.body.items[0]).toMatchObject({ status: 'unavailable', reason: 'network' })
    expect(toSafeSearchLog(r.events[0]!)).toMatchObject({ reason: 'network', phase: 'body' })
  })
  it('explicit AbortError during the body → timeout; invalid JSON → bad_response', async () => {
    expect((await serp(bodyFailingFetch(Object.assign(new Error('aborted'), { name: 'AbortError' })).fn).search(query)).reason).toBe('timeout')
    expect((await serp(bodyFailingFetch(new SyntaxError('Unexpected token <')).fn).search(query)).reason).toBe('bad_response')
  })
  it('HTTP errors from the provider → unavailable with the status in diagnostics', async () => {
    for (const [status, reason] of [[500, 'provider_error'], [503, 'provider_error'], [429, 'rate_limited'], [401, 'unauthorized']] as const) {
      const fn: FetchLike = async () => ({ ok: false, status, json: async () => ({}) }) as unknown as Response
      const r = await run(fn)
      expect(r.body.items[0]).toMatchObject({ status: 'unavailable', reason })
      expect(toSafeSearchLog(r.events[0]!)).toMatchObject({ reason, httpStatus: status })
    }
  })
})

describe('SR-04 quota, cache, kill switch, no results, success', () => {
  it('search budget exhausted → quota_exceeded, provider NOT called', async () => {
    const f = timedFetch(1, okBody)
    const r = await run(f.fn, { env: { ...ON, PARTS_PRICING_CLIENT_DAILY_SEARCHES: '0' } })
    expect(r.body.items[0]).toMatchObject({ status: 'unavailable', reason: 'quota_exceeded' })
    expect(f.calls).toHaveLength(0)
    expect(toSafeSearchLog(r.events[0]!)).toMatchObject({ cache: 'miss', reason: 'quota_exceeded' })
    const store = new InMemoryQuotaStore()
    const env = { ...ON, PARTS_PRICING_DAILY_SEARCH_BUDGET: '1' }
    expect((await run(timedFetch(1, okBody).fn, { env, store })).body.items[0].status).toBe('ok')
    const g = timedFetch(1, okBody)
    const second = await handlePartsPricesRequest(req({ vehicle, lines: [{ id: 'l2', description: 'Filtro de aceite' }] }), { env, provider: serp(g.fn), store })
    expect((await second.json()).items[0]).toMatchObject({ status: 'unavailable', reason: 'quota_exceeded' })
    expect(g.calls).toHaveLength(0)
  })

  it('cache hit → no provider call; reported as shared_hit / memory_hit', async () => {
    const cache = new MemoryPricingCache()
    const f = timedFetch(1, okBody)
    await run(f.fn, { cache })
    const r = await run(f.fn, { cache })
    expect(f.calls).toHaveLength(1)
    expect(r.body.items[0].status).toBe('ok')
    expect(toSafeSearchLog(r.events[0]!)).toMatchObject({ cache: 'shared_hit', outcome: 'ok' })
    expect(toSafeSearchLog(r.events[0]!)).not.toHaveProperty('providerMs')

    const events: PricingSearchEvent[] = []
    const service = createPricingService({ provider: serp(f.fn), onSearch: (e) => events.push(e) })
    const line = { id: 'x', description: 'Filtro de aire', category: 'part' as const }
    await service.research({ lines: [line], vehicle })
    await service.research({ lines: [line], vehicle })
    expect(events.map((e) => e.cache)).toEqual(['miss', 'memory_hit'])
  })

  it('kill switch on → disabled, provider not called, nothing logged as a search', async () => {
    const store = new InMemoryQuotaStore()
    await setPricingKillSwitch(store, true)
    const f = timedFetch(1, okBody)
    const r = await run(f.fn, { store })
    expect(r.body).toEqual({ status: 'disabled' })
    expect(f.calls).toHaveLength(0)
    expect(r.events).toHaveLength(0)
  })

  it('genuinely empty search → no_results (distinct from a timeout)', async () => {
    const r = await run(timedFetch(1, emptyBody).fn)
    expect(r.body.items[0]).toMatchObject({ status: 'no_results' })
    expect(r.body.items[0].reason).toBeUndefined()
    expect(toSafeSearchLog(r.events[0]!)).toMatchObject({ outcome: 'no_results', providerError: 'empty_results' })
  })

  it('successful response → offers, key never in the response or the log line', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const r = await run(timedFetch(1, okBody).fn)
    consoleSearchListener({ NODE_ENV: 'production' })(r.events[0]!)
    expect(r.text).not.toContain(KEY)
    expect(info).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(info.mock.calls)).not.toContain(KEY)
  })
})

describe('SR-05 no automatic retries of paid searches', () => {
  it.each([
    ['timeout', () => timedFetch(TIMEOUT * 5, okBody)],
    ['network', () => failingFetch(new TypeError('fetch failed'))],
    ['body abort', () => bodyFailingFetch(new TypeError('terminated'))],
  ])('%s → exactly one provider call in the request', async (_n, make) => {
    const f = make()
    await run(f.fn)
    expect(f.calls).toHaveLength(1)
  })
  it('HTTP 503 → exactly one call; two identical concurrent searches share it', async () => {
    let calls = 0
    const fn: FetchLike = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 10))
      return { ok: false, status: 503, json: async () => ({}) } as unknown as Response
    }
    const service = createPricingService({ provider: serp(fn) })
    const line = { id: 'x', description: 'Filtro de aire', category: 'part' as const }
    await Promise.all([service.research({ lines: [line], vehicle }), service.research({ lines: [line], vehicle })])
    expect(calls).toBe(1)
  })
})

describe('SR-06 safe diagnostics: allow-listed codes and counters only', () => {
  it('never contains the key, URL, query, description, vehicle, titles, prices, IP or raw provider text', async () => {
    const r = await run(timedFetch(1, okBody).fn)
    const hostile: PricingSearchEvent = {
      ...r.events[0]!,
      result: {
        ...r.events[0]!.result,
        reason: `boom ${KEY}` as never,
        diagnostics: { ...r.events[0]!.result.diagnostics!, providerStatus: 'https://serpapi.com/search.json?api_key=x' as never, priceFormats: ['$ 99.999,99'], linkHosts: ['evil.example'] },
      },
    }
    for (const e of [r.events[0]!, hostile]) {
      const line = JSON.stringify(toSafeSearchLog(e))
      for (const forbidden of [KEY, 'serpapi.com', 'api_key', 'Filtro', 'Palio', 'Fiat', '2017', '9.000', 'Tienda', 'google', '203.0.113', 'evil', '99.999']) expect(line).not.toContain(forbidden)
      expect(Object.keys(toSafeSearchLog(e)).every((k) => ['event', 'provider', 'cache', 'outcome', 'reason', 'phase', 'durationMs', 'providerMs', 'timeoutMs', 'httpStatus', 'providerStatus', 'providerError', 'rawCount', 'offers'].includes(k))).toBe(true)
    }
  })
  it('silent under tests by default; a throwing listener never breaks the search', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    consoleSearchListener({ NODE_ENV: 'test' })(({} as unknown) as PricingSearchEvent)
    expect(info).not.toHaveBeenCalled()
    const r = await handlePartsPricesRequest(req(), { env: ON, provider: serp(timedFetch(1, okBody).fn), store: new InMemoryQuotaStore(), onSearch: () => { throw new Error('sink down') } })
    expect((await r.json()).items[0].status).toBe('ok')
  })
})

describe('SR-07 four distinct messages; a failure is never worded as "no results"', () => {
  it('slow provider, temporarily unavailable and limit reached are different texts', () => {
    const slow = ITEM_REASON_LABEL.timeout!
    const unavailable = ITEM_REASON_LABEL.provider_error!
    const limit = ITEM_REASON_LABEL.quota_exceeded!
    expect(new Set([slow, unavailable, limit]).size).toBe(3)
    expect(slow).toMatch(/tardó demasiado/)
    expect(limit).toMatch(/límite/)
    for (const r of ['network', 'bad_response', 'unauthorized', 'forbidden', 'rate_limited', 'store_unavailable']) expect(ITEM_REASON_LABEL[r]).toBe(unavailable)
    for (const r of ['timeout', 'network', 'provider_error', 'bad_response', 'rate_limited', 'store_unavailable']) {
      expect(ITEM_REASON_LABEL[r]).not.toMatch(/no encontramos/i)
      expect(ITEM_REASON_LABEL[r]).toMatch(/búsqueda manual/)
    }
  })
})
