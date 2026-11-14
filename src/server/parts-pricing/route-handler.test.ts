/**
 * route-handler.test.ts — POST /api/budget/parts-prices (Incremento 7C). Integration tests with a
 * fake provider / fake fetch: NO real SerpApi call, no network, SYNTHETIC offers only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryQuotaStore } from '@/server/llm-protection/quota-store'
import { handlePartsPricesRequest, MAX_BODY_BYTES, resetPartsPricingRuntimeForTests } from './route-handler'
import { createSerpApiProvider } from './serpapi-provider'
import { createPricingService } from './pricing-service'
import { MemoryPricingCache } from './shared-cache'
import type { FetchLike, PriceOffer, PriceProvider, ProviderResult } from './types'

const KEY = 'SERPAPI_SECRET_TEST_KEY'
const ON = { PARTS_PRICING_ENABLED: 'true', LLM_QUOTA_STORE: 'memory' }
const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', engine: '' }

function offer(id: string, title: string): PriceOffer {
  return {
    provider: 'serpapi', providerItemId: id, title, priceMinor: 1_000_000, currency: 'ARS',
    url: `https://www.google.com.ar/shopping/product/${id}`, merchant: 'Tienda Sintética', condition: 'unknown', retrievedAt: '2026-11-14T00:00:00.000Z',
  }
}

function fakeProvider(result?: Partial<ProviderResult>): PriceProvider & { search: ReturnType<typeof vi.fn> } {
  const search = vi.fn(async () => ({
    status: 'ok' as const,
    offers: [
      offer('1', 'Pastillas De Freno Delantera Fiat Palio 1997+ - Marca 12068a'),
      offer('2', 'Pastillas Freno Delanteras Fiat Grand Siena 2012+'),
      offer('3', 'Pastillas De Freno Delanteras Bosch Peugeot 208 2013/'),
    ],
    droppedInvalid: 0,
    latencyMs: 5,
    diagnostics: { httpStatus: 200, sourceCounts: {}, rawCount: 3, dropReasons: {}, priceFormats: [], linkHosts: [] },
    ...result,
  }))
  return { id: 'serpapi', search }
}

function req(body: unknown, init: { headers?: Record<string, string>; raw?: string } = {}): Request {
  return new Request('http://localhost/api/budget/parts-prices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...init.headers },
    body: init.raw ?? JSON.stringify(body),
  })
}

const pads = { vehicle, lines: [{ id: 'l1', description: 'Pastillas de freno delanteras', presentation: 'set' as const }] }

beforeEach(() => resetPartsPricingRuntimeForTests())

describe('PP-01 feature flag — disabled by default, never enabled by the client', () => {
  it('no flag → 404 and the provider is never called', async () => {
    const p = fakeProvider()
    const r = await handlePartsPricesRequest(req(pads), { env: {}, provider: p, store: new InMemoryQuotaStore() })
    expect(r.status).toBe(404)
    expect(p.search).not.toHaveBeenCalled()
  })

  it.each(['1', 'TRUE', 'yes', 'on', ' true'])('PARTS_PRICING_ENABLED=%j is not "true" → 404', async (v) => {
    const r = await handlePartsPricesRequest(req(pads), { env: { PARTS_PRICING_ENABLED: v }, provider: fakeProvider() })
    expect(r.status).toBe(404)
  })

  it('client-sent flags, providers, keys or URLs are rejected (strict schema) and never enable anything', async () => {
    const p = fakeProvider()
    for (const extra of [{ enabled: true }, { provider: 'serpapi' }, { apiKey: 'x' }, { url: 'https://evil.example.com' }]) {
      expect((await handlePartsPricesRequest(req({ ...pads, ...extra }), { env: {}, provider: p })).status).toBe(404)
      expect((await handlePartsPricesRequest(req({ ...pads, ...extra }), { env: ON, provider: p, store: new InMemoryQuotaStore() })).status).toBe(400)
    }
    const qs = new Request('http://localhost/api/budget/parts-prices?enabled=true&provider=serpapi', { method: 'POST', headers: { 'content-type': 'application/json', 'x-parts-pricing-enabled': 'true' }, body: JSON.stringify(pads) })
    expect((await handlePartsPricesRequest(qs, { env: {}, provider: p })).status).toBe(404)
    expect(p.search).not.toHaveBeenCalled()
  })

  it('flag on but no provider credential → "disabled" (manual 7B flow only)', async () => {
    const r = await handlePartsPricesRequest(req(pads), { env: { ...ON, PARTS_PRICING_PROVIDER: 'serpapi' }, store: new InMemoryQuotaStore() })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'disabled' })
  })
})

describe('PP-02 strict validation', () => {
  const run = (r: Request) => handlePartsPricesRequest(r, { env: ON, provider: fakeProvider(), store: new InMemoryQuotaStore() })
  it('content type, size, JSON and schema', async () => {
    expect((await run(req(pads, { headers: { 'content-type': 'text/plain' } }))).status).toBe(415)
    expect((await run(req(null, { raw: `{"x":"${'a'.repeat(MAX_BODY_BYTES)}"}` }))).status).toBe(413)
    expect((await run(req(null, { raw: '{nope' }))).status).toBe(400)
    expect((await run(req({ ...pads, lines: Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, description: 'Filtro de aire' })) }))).status).toBe(400)
    expect((await run(req({ ...pads, vehicle: { year: '17' } }))).status).toBe(400)
    expect((await run(req({ ...pads, lines: [{ id: '../x', description: 'Filtro' }] }))).status).toBe(400)
    expect((await run(req({ ...pads, lines: [] }))).status).toBe(400)
  })
  it('error bodies never echo the input', async () => {
    const r = await run(req({ ...pads, vehicle: { make: 'x'.repeat(41) } }))
    expect(await r.text()).not.toContain('xxxx')
  })
})

describe('PP-03 successful search (fake provider)', () => {
  it('returns up to 5 validated offers per part, only titles naming the model, never compatibility verdicts', async () => {
    const p = fakeProvider()
    const r = await handlePartsPricesRequest(req(pads), { env: ON, provider: p, store: new InMemoryQuotaStore() })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    const body = await r.json()
    expect(body.status).toBe('ok')
    const item = body.items[0]
    expect(item.offers).toHaveLength(1) // Grand Siena hidden (no model), Peugeot discarded (other vehicle)
    expect(item.hidden).toBe(1)
    expect(item.offers[0]).toEqual({
      title: 'Pastillas De Freno Delantera Fiat Palio 1997+ - Marca 12068a', merchant: 'Tienda Sintética', priceMinor: 1_000_000, currency: 'ARS',
      url: 'https://www.google.com.ar/shopping/product/1', retrievedAt: '2026-11-14T00:00:00.000Z', decision: 'candidate', codeMatch: false,
      missing: ['part_code', 'presentation', 'condition'],
    })
    const text = JSON.stringify(body)
    for (const forbidden of ['diagnostics', 'comparable', 'average', 'promedio', 'sobreprecio', 'difference', 'compatible"']) expect(text).not.toContain(forbidden)
  })

  it('labor / other concepts are never searched; unsafe text is never sent to the provider', async () => {
    const p = fakeProvider()
    const r = await handlePartsPricesRequest(
      req({ vehicle, lines: [{ id: 'a', description: 'Mano de obra' }, { id: 'b', description: 'Cómo anular el sensor de frenos' }, { id: 'c', description: 'Envío' }] }),
      { env: ON, provider: p, store: new InMemoryQuotaStore() },
    )
    const body = await r.json()
    expect(p.search).not.toHaveBeenCalled()
    expect(body.items.map((i: { lineId: string; status: string; reason: string }) => [i.lineId, i.status, i.reason])).toEqual([
      ['a', 'skipped', 'not_a_part'],
      ['b', 'skipped', 'unsafe'],
      ['c', 'skipped', 'not_a_part'],
    ])
  })

  it('end to end with the real SerpApi adapter over a FAKE fetch: key only in the outbound URL, never in the response', async () => {
    const calls: string[] = []
    const fetchFake: FetchLike = async (url) => {
      calls.push(String(url))
      return { ok: true, status: 200, json: async () => ({ search_metadata: { status: 'Success' }, shopping_results: [{ position: 1, product_id: '9', title: 'Pastillas De Freno Delanteras Fiat Palio 2017 Juego', price: '$ 25.000,00', extracted_price: 25000, source: 'Tienda Sintética', product_link: 'https://www.google.com.ar/shopping/product/9' }] }) } as unknown as Response
    }
    const provider = createSerpApiProvider({ apiKey: KEY, fetch: fetchFake })
    const r = await handlePartsPricesRequest(req(pads), { env: ON, provider, store: new InMemoryQuotaStore() })
    const text = await r.text()
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0]!).origin).toBe('https://serpapi.com')
    expect(text).not.toContain(KEY)
    expect(text).not.toContain('serpapi.com')
    expect(JSON.parse(text).items[0].offers[0]).toMatchObject({ priceMinor: 2_500_000, decision: 'candidate', missing: ['part_code', 'condition'] })
  })
})

describe('PP-03b missing data from real cases (A, C, D)', () => {
  it('a shock absorber request without position lists "position" as missing for a front/rear listing', async () => {
    const p = fakeProvider({ offers: [offer('r', 'Amortiguador Trasera Monroe - Fiat Palio')] })
    const r = await handlePartsPricesRequest(req({ vehicle: { make: 'Fiat', model: 'Palio' }, lines: [{ id: 'd', description: 'Amortiguador' }] }), { env: ON, provider: p, store: new InMemoryQuotaStore() })
    expect((await r.json()).items[0].offers[0].missing).toContain('position')
  })
  it('a body variant (Weekend) is listed as missing confirmation', async () => {
    const p = fakeProvider({ offers: [offer('w', 'Amortiguador Delantero Fiat Palio Weekend Cofap')] })
    const r = await handlePartsPricesRequest(req({ vehicle: { make: 'Fiat', model: 'Palio' }, lines: [{ id: 'd', description: 'Amortiguador' }] }), { env: ON, provider: p, store: new InMemoryQuotaStore() })
    const o = (await r.json()).items[0].offers[0]
    expect(o.decision).toBe('needs_review')
    expect(o.missing).toContain('model_variant')
  })
})

describe('PP-04 failures are safe (7B keeps working)', () => {
  it.each(['timeout', 'forbidden', 'rate_limited', 'provider_error'] as const)('provider %s → 200 with item unavailable', async (reason) => {
    const p = fakeProvider({ status: 'unavailable', reason, offers: [] })
    const r = await handlePartsPricesRequest(req(pads), { env: ON, provider: p, store: new InMemoryQuotaStore() })
    expect(r.status).toBe(200)
    expect((await r.json()).items[0]).toMatchObject({ status: 'unavailable', reason, offers: [] })
  })

  it('a provider that throws is contained', async () => {
    const p = fakeProvider()
    p.search.mockRejectedValueOnce(new Error(`boom ${KEY}`))
    const r = await handlePartsPricesRequest(req(pads), { env: ON, provider: p, store: new InMemoryQuotaStore() })
    const text = await r.text()
    expect(r.status).toBe(200)
    expect(text).not.toContain(KEY)
    expect(JSON.parse(text).items[0]).toMatchObject({ status: 'unavailable', reason: 'provider_error' })
  })
})

describe('PP-05 rate limit, budgets and cache', () => {
  it('per-client request rate → 429 without calling the provider', async () => {
    const p = fakeProvider()
    const store = new InMemoryQuotaStore()
    const env = { ...ON, PARTS_PRICING_CLIENT_REQUESTS_PER_HOUR: '2' }
    const cache = new MemoryPricingCache()
    expect((await handlePartsPricesRequest(req(pads), { env, provider: p, store, cache })).status).toBe(200)
    expect((await handlePartsPricesRequest(req(pads), { env, provider: p, store, cache })).status).toBe(200)
    const third = await handlePartsPricesRequest(req(pads), { env, provider: p, store, cache })
    expect(third.status).toBe(429)
    expect(await third.json()).toEqual({ status: 'rate_limited' })
    // Another client is not affected.
    expect((await handlePartsPricesRequest(req(pads, { headers: { 'x-forwarded-for': '198.51.100.9' } }), { env, provider: p, store, cache })).status).toBe(200)
  })

  it('global daily budget: billed searches stop at the limit (quota_exceeded), no provider call beyond it', async () => {
    const p = fakeProvider()
    const env = { ...ON, PARTS_PRICING_DAILY_SEARCH_BUDGET: '1' }
    const r = await handlePartsPricesRequest(
      req({ vehicle, lines: [{ id: 'a', description: 'Filtro de aire' }, { id: 'b', description: 'Filtro de aceite' }] }),
      { env, provider: p, store: new InMemoryQuotaStore() },
    )
    const body = await r.json()
    expect(p.search).toHaveBeenCalledTimes(1)
    expect(body.items.map((i: { reason?: string }) => i.reason ?? 'searched').sort()).toEqual(['quota_exceeded', 'searched'])
  })

  it('monthly budget exhausted → refused, and the daily counters taken are refunded', async () => {
    const store = new InMemoryQuotaStore()
    const p = fakeProvider()
    const now = () => Date.UTC(2026, 10, 14, 12)
    const r = await handlePartsPricesRequest(req(pads), { env: { ...ON, PARTS_PRICING_MONTHLY_SEARCH_BUDGET: '0' }, provider: p, store, now })
    expect((await r.json()).items[0]).toMatchObject({ status: 'unavailable', reason: 'quota_exceeded' })
    expect(p.search).not.toHaveBeenCalled()
    const day = Math.floor(now() / 86_400_000)
    expect(await store.get(`chuya:pp:d:${day}`)).toBe(0)
  })

  it('per-client daily searches', async () => {
    const p = fakeProvider()
    const store = new InMemoryQuotaStore()
    const env = { ...ON, PARTS_PRICING_CLIENT_DAILY_SEARCHES: '1' }
    await handlePartsPricesRequest(req({ vehicle, lines: [{ id: 'a', description: 'Filtro de aire' }] }), { env, provider: p, store })
    const r = await handlePartsPricesRequest(req({ vehicle, lines: [{ id: 'b', description: 'Filtro de aceite' }] }), { env, provider: p, store })
    expect((await r.json()).items[0]).toMatchObject({ reason: 'quota_exceeded' })
    expect(p.search).toHaveBeenCalledTimes(1)
  })

  it('shared cache: a repeated query (other instance / rerender / other visitor) costs no new search and no budget', async () => {
    const p = fakeProvider()
    const store = new InMemoryQuotaStore()
    const cache = new MemoryPricingCache()
    const env = { ...ON, PARTS_PRICING_DAILY_SEARCH_BUDGET: '1' }
    await handlePartsPricesRequest(req(pads), { env, provider: p, store, cache })
    const second = await handlePartsPricesRequest(req(pads, { headers: { 'x-forwarded-for': '198.51.100.9' } }), { env, provider: p, store, cache })
    expect(p.search).toHaveBeenCalledTimes(1)
    expect((await second.json()).items[0].status).toBe('ok')
  })

  it('identical concurrent searches in one instance share a single provider call', async () => {
    let release!: () => void
    const gateP = new Promise<void>((r) => (release = r))
    const p = fakeProvider()
    p.search.mockImplementation(async () => {
      await gateP
      return { status: 'ok', offers: [offer('1', 'Pastillas Freno Delanteras Fiat Palio')], droppedInvalid: 0, latencyMs: 1 }
    })
    const svc = createPricingService({ provider: p })
    const input = { lines: [{ id: 'l', description: 'Pastillas de freno delanteras', category: 'part' as const }], vehicle }
    const both = Promise.all([svc.research(input), svc.research(input)])
    release()
    await both
    expect(p.search).toHaveBeenCalledTimes(1)
  })

  it('production without a distributed store → fail closed (no provider call)', async () => {
    const p = fakeProvider()
    const r = await handlePartsPricesRequest(req(pads), { env: { ...ON, NODE_ENV: 'production' }, provider: p, store: new InMemoryQuotaStore() })
    expect((await r.json()).items[0]).toMatchObject({ status: 'unavailable', reason: 'store_unavailable' })
    expect(p.search).not.toHaveBeenCalled()
  })

  it('invalid budget configuration → 503 without calling anything', async () => {
    const p = fakeProvider()
    const r = await handlePartsPricesRequest(req(pads), { env: { ...ON, PARTS_PRICING_DAILY_SEARCH_BUDGET: '-1' }, provider: p })
    expect(r.status).toBe(503)
    expect(p.search).not.toHaveBeenCalled()
  })
})
