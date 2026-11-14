/**
 * parts-pricing.test.ts — Incremento 7C spike. Server-side price providers, matching and the
 * orchestrator, with SYNTHETIC responses (no network, no real prices, no API keys).
 */
import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { meliSearchResponse, serpApiNoResults, serpApiShoppingResponse } from './__fixtures__/synthetic'
import { createMercadoLibreProvider, MELI_SEARCH_URL } from './mercadolibre-provider'
import { createSerpApiProvider, SERPAPI_MAX_RESULTS, SERPAPI_TIMEOUT_MS, SERPAPI_URL } from './serpapi-provider'
import { buildProviderQuery } from './query'
import { evaluateMatch } from './matching'
import { createPricingService, PRICING_LIMITS } from './pricing-service'
import { selectPriceProvider } from './provider-registry'
import type { FetchLike, PriceQuery } from './types'

const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', engine: '1.4 8v' }
const hose: PriceQuery = { description: 'Manguera de respiración de gases', vehicle, presentation: 'unit', quantity: 1 }
const pads: PriceQuery = { description: 'Pastillas de freno delanteras', vehicle: { make: 'Fiat', model: 'Palio', year: '2017' }, presentation: 'set', quantity: 1 }

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn: FetchLike = async (url, init) => {
    calls.push({ url: String(url), init })
    return jsonResponse(status, body)
  }
  return { fn, calls }
}

describe('PC-01 query — only identifying data', () => {
  it('Scenario: hose for Fiat Palio 2017 1.4 8v', () => {
    expect(buildProviderQuery(hose)).toBe('Manguera de respiración de gases Fiat Palio 1.4 8v 2017')
  })
  it('strips prices, plates, e-mails and phones; never sends free text beyond the part', () => {
    expect(buildProviderQuery({ ...hose, description: 'Manguera: $ 18.000 patente AB123CD juan@mail.com 1155667788' })).toBe('Manguera Fiat Palio 1.4 8v 2017')
  })
})

describe('PC-02 Mercado Libre provider (official API shape, synthetic data)', () => {
  it('fixed host/path, q + limit only, bearer token server-side, timeout signal', async () => {
    const f = fakeFetch(200, meliSearchResponse)
    const p = createMercadoLibreProvider({ accessToken: 'TEST_TOKEN', fetch: f.fn })
    await p.search(hose)
    const url = new URL(f.calls[0]!.url)
    expect(`${url.origin}${url.pathname}`).toBe(MELI_SEARCH_URL)
    expect([...url.searchParams.keys()].sort()).toEqual(['limit', 'q'])
    expect(url.searchParams.get('limit')).toBe('10')
    expect((f.calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer TEST_TOKEN')
    expect(f.calls[0]!.init!.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps offers: integer ARS, validated permalink, condition, brand and part number; drops USD and foreign hosts', async () => {
    const r = await createMercadoLibreProvider({ accessToken: 't', fetch: fakeFetch(200, meliSearchResponse).fn }).search(hose)
    expect(r.status).toBe('ok')
    expect(r.offers.map((o) => o.providerItemId)).toEqual(['MLA0000000001', 'MLA0000000002', 'MLA0000000003'])
    const first = r.offers[0]!
    expect(first).toMatchObject({
      provider: 'mercadolibre',
      priceMinor: 1_500_000,
      currency: 'ARS',
      url: 'https://articulo.mercadolibre.com.ar/MLA-0000000001-synthetic',
      merchant: 'SYNTH_SELLER_A',
      condition: 'new',
      brand: 'MarcaSintetica',
      partNumber: 'SYN-123',
    })
    expect(first.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(r.droppedInvalid).toBe(1)
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [500, 'provider_error'],
  ] as const)('HTTP %i → unavailable (%s), no offers', async (status, reason) => {
    const r = await createMercadoLibreProvider({ accessToken: 't', fetch: fakeFetch(status, {}).fn }).search(hose)
    expect(r).toMatchObject({ status: 'unavailable', reason, offers: [] })
  })

  it('missing token → disabled without any request', async () => {
    const f = fakeFetch(200, meliSearchResponse)
    const r = await createMercadoLibreProvider({ accessToken: '', fetch: f.fn }).search(hose)
    expect(r.status).toBe('disabled')
    expect(f.calls).toHaveLength(0)
  })

  it('timeout / network error → unavailable (timeout)', async () => {
    const fn: FetchLike = async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    }
    expect(await createMercadoLibreProvider({ accessToken: 't', fetch: fn }).search(hose)).toMatchObject({ status: 'unavailable', reason: 'timeout' })
  })

  it('malformed JSON body → unavailable (bad_response), never throws', async () => {
    const r = await createMercadoLibreProvider({ accessToken: 't', fetch: fakeFetch(200, { results: 'nope' }).fn }).search(hose)
    expect(r).toMatchObject({ status: 'unavailable', reason: 'bad_response' })
  })
})

describe('PC-03 SerpApi Google Shopping provider (documented shape, synthetic data)', () => {
  it('fixed endpoint, Argentina locale, key never in logs/offers', async () => {
    const f = fakeFetch(200, serpApiShoppingResponse)
    const r = await createSerpApiProvider({ apiKey: 'SECRET_KEY', fetch: f.fn }).search(pads)
    const url = new URL(f.calls[0]!.url)
    expect(`${url.origin}${url.pathname}`).toBe(SERPAPI_URL)
    expect(url.searchParams.get('engine')).toBe('google_shopping')
    expect(url.searchParams.get('gl')).toBe('ar')
    expect(url.searchParams.get('google_domain')).toBe('google.com.ar')
    expect(JSON.stringify(r)).not.toContain('SECRET_KEY')
  })

  it('parses ARS display prices exactly; rejects US$ and malicious links', async () => {
    const r = await createSerpApiProvider({ apiKey: 'k', fetch: fakeFetch(200, serpApiShoppingResponse).fn }).search(pads)
    expect(r.offers.map((o) => [o.title, o.priceMinor, o.merchant])).toEqual([['Pastillas De Freno Delanteras Fiat Palio 2017 Juego', 2_500_000, 'Tienda Sintética Uno']])
    expect(r.droppedInvalid).toBe(2)
    expect(r.offers[0]!.condition).toBe('unknown')
  })

  it('no results → no_results', async () => {
    expect((await createSerpApiProvider({ apiKey: 'k', fetch: fakeFetch(200, serpApiNoResults).fn }).search(pads)).status).toBe('no_results')
  })
})

describe('PC-04 matching — never claims compatibility without data', () => {
  const offer = (title: string, extra: Partial<Parameters<typeof evaluateMatch>[1]> = {}) => ({
    provider: 'mercadolibre' as const, providerItemId: 'x', title, priceMinor: 1_000_000, currency: 'ARS' as const,
    url: 'https://articulo.mercadolibre.com.ar/x', merchant: 'm', condition: 'new' as const, retrievedAt: '2026-11-14T00:00:00Z',
    ...extra,
  })

  it('same part type, model, engine and year in range → candidate needing confirmation (not "confirmed")', () => {
    const m = evaluateMatch(hose, offer('Manguera Respiradero Gases Fiat Palio Siena 1.4 8v 2010-2017'))
    expect(m.decision).toBe('candidate')
    expect(m.signals).toMatchObject({ partType: 'match', model: 'match', engine: 'match', year: 'match', condition: 'new' })
    expect(m.comparable).toBe(false) // needs the person's confirmation
  })

  it('part number equal to the quoted code → comparable (labeled code match)', () => {
    const m = evaluateMatch({ ...hose, partCode: 'SYN-123' }, offer('Manguera respiradero', { partNumber: 'syn 123' }))
    expect(m.signals.partCode).toBe('match')
    expect(m.comparable).toBe(true)
  })

  it.each([
    ['different part type', 'Manguera Radiador Fiat Palio 1.4', {}, 'part_type_mismatch'],
    ['other engine', 'Manguera Respiradero Gases Fiat Palio 1.8 16v', {}, 'engine_mismatch'],
    ['year out of range', 'Manguera Respiradero Gases Fiat Palio 1.4 2004-2008', {}, 'year_mismatch'],
    ['used', 'Manguera Respiradero Gases Fiat Palio 1.4', { condition: 'used' as const }, 'not_new'],
    ['different part number', 'Manguera Respiradero Gases Fiat Palio', { partNumber: 'ABC-999' }, 'part_code_mismatch'],
  ])('%s → discarded', (_n, title, extra, reason) => {
    const m = evaluateMatch({ ...hose, partCode: reason === 'part_code_mismatch' ? 'SYN-123' : undefined }, offer(title, extra))
    expect(m.decision).toBe('discard')
    expect(m.reasons).toContain(reason)
  })

  it('presentation: a "juego" offer for a unit request is never comparable', () => {
    const m = evaluateMatch(hose, offer('Manguera Respiradero Gases Fiat Palio 1.4 8v Kit x2'))
    expect(m.signals.presentation).toBe('mismatch')
    expect(m.comparable).toBe(false)
    expect(m.decision).toBe('needs_review')
  })

  it('ambiguous part (no model / year / engine in title) → needs_review', () => {
    const m = evaluateMatch(pads, offer('Pastillas De Freno Universales'))
    expect(m.decision).toBe('needs_review')
    expect(m.signals.model).toBe('unknown')
  })
})

describe('PC-05 pricing service — limits, safety, fallback', () => {
  const provider = (impl: Partial<{ search: (q: PriceQuery) => Promise<unknown> }> = {}) => ({
    id: 'mercadolibre' as const,
    search: vi.fn(impl.search ?? (async () => createMercadoLibreProvider({ accessToken: 't', fetch: fakeFetch(200, meliSearchResponse).fn }).search(hose))),
  })

  it('only parts, at most PRICING_LIMITS.maxPartsPerRequest provider calls, labor never searched', async () => {
    const p = provider()
    const svc = createPricingService({ provider: p as never })
    const lines = [
      { id: 'a', description: 'Mano de obra', category: 'labor' as const },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, description: `Filtro de aceite ${i}`, category: 'part' as const })),
    ]
    const r = await svc.research({ lines, vehicle })
    expect(p.search).toHaveBeenCalledTimes(PRICING_LIMITS.maxPartsPerRequest)
    expect(r.items.find((i) => i.lineId === 'a')).toBeUndefined()
    expect(r.truncated).toBe(true)
  })

  it('unsafe descriptions are never sent to a provider', async () => {
    const p = provider()
    const r = await createPricingService({ provider: p as never }).research({
      lines: [{ id: 'x', description: 'Cómo anular el sensor de frenos', category: 'part' }],
      vehicle,
    })
    expect(p.search).not.toHaveBeenCalled()
    expect(r.items[0]).toMatchObject({ status: 'skipped', reason: 'unsafe' })
  })

  it('provider down / disabled → 7B keeps working (status, no offers, no throw)', async () => {
    const down = provider({ search: async () => ({ status: 'unavailable', reason: 'forbidden', offers: [], droppedInvalid: 0, latencyMs: 5 }) })
    const r = await createPricingService({ provider: down as never }).research({ lines: [{ id: 'p', description: 'Filtro de aire', category: 'part' }], vehicle })
    expect(r.items[0]).toMatchObject({ status: 'unavailable', offers: [] })
    const none = await createPricingService({ provider: null }).research({ lines: [{ id: 'p', description: 'Filtro de aire', category: 'part' }], vehicle })
    expect(none.status).toBe('disabled')
  })

  it('a thrown provider error is contained', async () => {
    const boom = provider({ search: async () => { throw new Error('boom') } })
    const r = await createPricingService({ provider: boom as never }).research({ lines: [{ id: 'p', description: 'Filtro de aire', category: 'part' }], vehicle })
    expect(r.items[0]!.status).toBe('unavailable')
  })

  it('identical queries are served from the in-memory cache (no second provider call)', async () => {
    const p = provider()
    const svc = createPricingService({ provider: p as never })
    const req = { lines: [{ id: 'p', description: 'Manguera de respiración de gases', category: 'part' as const }], vehicle }
    await svc.research(req)
    await svc.research(req)
    expect(p.search).toHaveBeenCalledTimes(1)
  })

  it('offers keep provenance and are matched; discarded ones are not presented as references', async () => {
    const r = await createPricingService({ provider: provider() as never }).research({
      lines: [{ id: 'p', description: 'Manguera de respiración de gases', category: 'part' }],
      vehicle,
    })
    const item = r.items[0]!
    expect(item.offers.every((o) => o.offer.url.startsWith('https://') && o.offer.retrievedAt && o.match.decision !== 'discard')).toBe(true)
    expect(item.discarded).toBeGreaterThan(0)
  })
})

describe('PC-06 registry and isolation', () => {
  it('no provider unless explicitly enabled with a key (default off)', () => {
    expect(selectPriceProvider({})).toBeNull()
    expect(selectPriceProvider({ PARTS_PRICING_PROVIDER: 'mercadolibre' })).toBeNull() // no token
    expect(selectPriceProvider({ PARTS_PRICING_PROVIDER: 'mercadolibre', MELI_ACCESS_TOKEN: 't' })?.id).toBe('mercadolibre')
    expect(selectPriceProvider({ PARTS_PRICING_PROVIDER: 'serpapi', SERPAPI_API_KEY: 'k' })?.id).toBe('serpapi')
    expect(selectPriceProvider({ PARTS_PRICING_PROVIDER: 'https://evil.example.com' })).toBeNull()
  })

  it('client code never imports the server pricing module; no NEXT_PUBLIC keys', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))
    const clientFiles = [...walk(join(process.cwd(), 'src/components')), ...walk(join(process.cwd(), 'src/app'))].filter((f) => /\.tsx?$/.test(f))
    for (const f of clientFiles) {
      const code = readFileSync(f, 'utf8')
      if (code.includes("'use client'")) expect(code, f).not.toMatch(/server\/parts-pricing/)
    }
    const serverCode = walk(join(process.cwd(), 'src/server/parts-pricing'))
      .filter((f) => !f.endsWith('.test.ts'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(serverCode).not.toMatch(/process.env.NEXT_PUBLIC_|env.NEXT_PUBLIC_/)
  })
})

describe('PC-07 controlled cases (synthetic offers)', () => {
  const air: PriceQuery = { description: 'Filtro de aire', vehicle: { make: 'Fiat', model: 'Palio', engine: '1.4' }, presentation: 'unit', quantity: 1 }
  const o = (title: string) => ({
    provider: 'serpapi' as const, providerItemId: title, title, priceMinor: 1_000_000, currency: 'ARS' as const,
    url: 'https://www.google.com.ar/shopping/product/1', merchant: 'm', condition: 'unknown' as const, retrievedAt: '2026-11-14T00:00:00Z',
  })

  it('air filter: multi-engine listing including 1.4 → candidate; oil filter → discarded; universal → review', () => {
    expect(evaluateMatch(air, o('Filtro De Aire Fiat Palio Siena 1.4 1.6 1.8')).decision).toBe('candidate')
    expect(evaluateMatch(air, o('Filtro De Aceite Fiat Palio 1.4')).reasons).toContain('part_type_mismatch')
    expect(evaluateMatch(air, o('Filtro De Aire Universal Cónico')).decision).toBe('needs_review')
  })

  it('ambiguous part with many variants: none is comparable without a part code', () => {
    const variants = ['Pastillas Freno Delanteras Fiat Palio 2017 Juego', 'Pastillas Freno Delanteras Fiat Palio Ventiladas', 'Pastillas Freno Delanteras Fiat Palio Sin Sensor']
    const results = variants.map((t) => evaluateMatch(pads, o(t)))
    expect(results.every((r) => !r.comparable)).toBe(true)
    expect(results.every((r) => r.reasons.includes('condition_unknown'))).toBe(true)
  })
})

describe('PC-08 diagnóstico de la primera prueba real (SerpApi) — defectos confirmados, datos SINTÉTICOS', () => {
  const KEY = 'SECRET_KEY_DO_NOT_LOG'
  const serpProvider = (body: unknown, status = 200) => createSerpApiProvider({ apiKey: KEY, fetch: fakeFetch(status, body).fn })
  const serp = (body: unknown, status = 200) => serpProvider(body, status).search(pads)
  const item = (over: Record<string, unknown>) => ({
    position: 1, title: 'Pastillas De Freno Delanteras Fiat Palio 2017', price: '$ 25.000,00', extracted_price: 25000,
    source: 'Tienda Sintética', product_link: 'https://www.google.com.ar/shopping/product/111', product_id: '111', ...over,
  })
  const timeoutDuringBody: FetchLike = async () =>
    ({ ok: true, status: 200, json: async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }) } }) as unknown as Response

  it('D1 caso D: timeout mientras se lee el cuerpo → unavailable/timeout (no bad_response) — SerpApi y Mercado Libre', async () => {
    expect(await createSerpApiProvider({ apiKey: 'k', fetch: timeoutDuringBody }).search(pads)).toMatchObject({ status: 'unavailable', reason: 'timeout' })
    expect(await createMercadoLibreProvider({ accessToken: 't', fetch: timeoutDuringBody }).search(hose)).toMatchObject({ status: 'unavailable', reason: 'timeout' })
  })

  it('D2 timeout de SerpApi suficiente para Google Shopping (latencias reales observadas 1,5–4 s)', () => {
    expect(SERPAPI_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
  })

  it('D3 HTTP 200 con search_metadata.status=Error → unavailable/provider_error, no "sin resultados"', async () => {
    const r = await serp({ search_metadata: { status: 'Error' }, error: 'Proxy timeout' })
    expect(r).toMatchObject({ status: 'unavailable', reason: 'provider_error' })
    expect(r.diagnostics).toMatchObject({ providerStatus: 'error', providerError: 'other', httpStatus: 200 })
  })

  it('D4 Success + "Google hasn\'t returned any results" → no_results con motivo empty_results', async () => {
    const r = await serp({ search_metadata: { status: 'Success' }, error: "Google hasn't returned any results for this query." })
    expect(r.status).toBe('no_results')
    expect(r.diagnostics).toMatchObject({ providerStatus: 'success', providerError: 'empty_results', rawCount: 0 })
  })

  it('D5 precios con formato "$25,000.00" (locale es-419) se aceptan solo si coinciden con extracted_price', async () => {
    const r = await serp({
      search_metadata: { status: 'Success' },
      shopping_results: [
        item({ product_id: 'a', price: '$25,000.00', extracted_price: 25000 }),
        item({ product_id: 'b', price: '$ 25.000,00', extracted_price: 25000 }),
        item({ product_id: 'c', price: 'ARS 1.234,50', extracted_price: 1234.5 }),
        item({ product_id: 'd', price: '$25.000', extracted_price: 26000 }),
        item({ product_id: 'e', price: 'US$ 30.00', extracted_price: 30 }),
        item({ product_id: 'f', price: undefined, extracted_price: 25000 }),
      ],
    })
    expect(r.offers.map((o) => [o.providerItemId, o.priceMinor])).toEqual([['a', 2_500_000], ['b', 2_500_000], ['c', 123_450]])
    expect(r.diagnostics?.dropReasons).toEqual({ price_mismatch: 1, price_foreign_currency: 1, price_missing: 1 })
  })

  it('D6 parámetros: engine, q, gl=ar, hl=es, google_domain y location=Argentina (país, sin datos personales)', async () => {
    const f = fakeFetch(200, { search_metadata: { status: 'Success' }, shopping_results: [] })
    await createSerpApiProvider({ apiKey: 'k', fetch: f.fn }).search(pads)
    const p = new URL(f.calls[0]!.url).searchParams
    expect(Object.fromEntries([...p.entries()].filter(([k]) => k !== 'api_key'))).toEqual({
      engine: 'google_shopping', q: 'Pastillas de freno delanteras Fiat Palio 2017', gl: 'ar', hl: 'es', google_domain: 'google.com.ar', location: 'Argentina',
    })
  })

  it('D7 lee shopping_results, inline_shopping_results y categorized_shopping_results sin duplicar', async () => {
    const r = await serp({
      search_metadata: { status: 'Success' },
      categorized_shopping_results: [{ title: 'Más populares', shopping_results: [item({ product_id: 'x1' }), item({ product_id: 'x2' })] }],
      inline_shopping_results: [item({ product_id: 'x2' }), item({ product_id: 'x3' })],
    })
    expect(r.offers.map((o) => o.providerItemId)).toEqual(['x1', 'x2', 'x3'])
    expect(r.diagnostics?.sourceCounts).toEqual({ categorized_shopping_results: 2, inline_shopping_results: 2 })
    expect(r.diagnostics?.rawCount).toBe(3)
  })

  it('D8 todo descartado por el adaptador → diagnóstico con contadores y motivos, formatos enmascarados y hosts', async () => {
    const r = await serp({
      search_metadata: { status: 'Success' },
      shopping_results: [item({ product_id: 'l1', product_link: undefined }), item({ product_id: 'l2', product_link: 'https://shop.example.com/p?id=1' }), item({ product_id: 'l3', source: '' })],
    })
    expect(r.status).toBe('no_results')
    expect(r.droppedInvalid).toBe(3)
    expect(r.diagnostics).toMatchObject({ rawCount: 3, dropReasons: { link_missing: 1, link_host: 1, merchant_missing: 1 }, linkHosts: ['shop.example.com'] })
    expect(r.diagnostics?.priceFormats).toEqual(['$ 99.999,99'])
  })

  it('D9 el diagnóstico nunca contiene la API key ni URLs de la solicitud', async () => {
    for (const body of [{ search_metadata: { status: 'Error' }, error: `Invalid api_key ${KEY}` }, serpApiShoppingResponse, { nope: true }]) {
      const out = JSON.stringify(await serp(body))
      expect(out).not.toContain(KEY)
      expect(out).not.toContain('api_key')
      expect(out).not.toContain('serpapi.com/search')
    }
    const err = JSON.stringify(await serp({ error: 'Invalid API key.' }, 401))
    expect(err).not.toContain(KEY)
    expect(JSON.parse(err).diagnostics).toMatchObject({ httpStatus: 401 })
  })

  it('D10 un año único distinto en el título es "sin verificar" (revisión), no incompatible; un rango que excluye sí descarta', () => {
    const o = (title: string) => ({
      provider: 'serpapi' as const, providerItemId: 'y', title, priceMinor: 1, currency: 'ARS' as const,
      url: 'https://www.google.com.ar/shopping/product/1', merchant: 'm', condition: 'unknown' as const, retrievedAt: '2026-11-14T00:00:00Z',
    })
    const single = evaluateMatch(pads, o('Pastillas Freno Delanteras Fiat Palio 2012'))
    expect(single.decision).toBe('needs_review')
    expect(single.signals.year).toBe('unknown')
    expect(single.reasons).toContain('year_unverified')
    expect(evaluateMatch(pads, o('Pastillas Freno Delanteras Fiat Palio 2004-2008')).reasons).toContain('year_mismatch')
  })

  it('D11 el servicio conserva diagnóstico, descartes del adaptador y motivos de descarte por compatibilidad', async () => {
    const provider = createSerpApiProvider({
      apiKey: KEY,
      fetch: fakeFetch(200, {
        search_metadata: { status: 'Success' },
        shopping_results: [item({ product_id: 'ok' }), item({ product_id: 'rear', title: 'Pastillas Freno Traseras Fiat Palio' }), item({ product_id: 'usd', price: 'US$ 9' })],
      }).fn,
    })
    const r = await createPricingService({ provider }).research({ lines: [{ id: 'B', description: 'Pastillas de freno delanteras', category: 'part', presentation: 'set' }], vehicle: pads.vehicle })
    const it0 = r.items[0]!
    expect(it0).toMatchObject({ status: 'ok', discarded: 1, droppedInvalid: 1, discardReasons: { position_mismatch: 1 } })
    expect(it0.diagnostics).toMatchObject({ rawCount: 3, dropReasons: { price_foreign_currency: 1 } })
    expect(JSON.stringify(r)).not.toContain(KEY)
  })

  it('D13 precio promocional "$ 32.700,00 ahora" se acepta solo si coincide con extracted_price', async () => {
    const r = await serp({
      search_metadata: { status: 'Success' },
      shopping_results: [item({ product_id: 'p1', price: '$ 32.700,00 ahora', extracted_price: 32700 }), item({ product_id: 'p2', price: '$ 32.700,00 ahora', extracted_price: 30000 })],
    })
    expect(r.offers.map((o) => [o.providerItemId, o.priceMinor])).toEqual([['p1', 3_270_000]])
    expect(r.diagnostics?.dropReasons).toEqual({ price_mismatch: 1 })
  })

  it('D14 evalúa todos los resultados de la página (40), no solo los 10 primeros: el costo es por búsqueda', async () => {
    const many = Array.from({ length: 40 }, (_, i) => item({ product_id: `m${i}` }))
    const r = await serp({ search_metadata: { status: 'Success' }, shopping_results: many })
    expect(r.offers).toHaveLength(SERPAPI_MAX_RESULTS)
    expect(SERPAPI_MAX_RESULTS).toBe(40)
  })

  it('D12 un proveedor no disponible conserva el diagnóstico en el ítem', async () => {
    const r = await createPricingService({ provider: serpProvider({ search_metadata: { status: 'Error' }, error: 'x' }) }).research({ lines: [{ id: 'D', description: 'Amortiguador', category: 'part' }], vehicle })
    expect(r.items[0]).toMatchObject({ status: 'unavailable', reason: 'provider_error', diagnostics: { providerStatus: 'error' } })
  })
})

describe('PC-09 calidad de ofertas reales (títulos observados en la prueba real del caso B, 14/11/2026; precios ficticios)', () => {
  const o = (title: string) => ({
    provider: 'serpapi' as const, providerItemId: 't', title, priceMinor: 1_000_000, currency: 'ARS' as const,
    url: 'https://www.google.com.ar/search?ibp=oshop', merchant: 'm', condition: 'unknown' as const, retrievedAt: '2026-11-14T17:10:15.187Z',
  })

  it('R1 rangos abiertos de año ("1997+", "2012+", "2013/", "en adelante", "desde") se interpretan como desde ese año', () => {
    expect(evaluateMatch(pads, o('Pastillas De Freno Delantera Fiat Palio 1997+ - Durbloc 12068a')).signals.year).toBe('match')
    expect(evaluateMatch(pads, o('Pastillas Freno Delanteras Fiat Palio 2013/')).signals.year).toBe('match')
    expect(evaluateMatch(pads, o('Pastillas Freno Delanteras Fiat Palio 2012 en adelante')).signals.year).toBe('match')
    expect(evaluateMatch(pads, o('Pastillas Freno Delanteras Fiat Palio desde 2018')).reasons).toContain('year_mismatch')
  })

  it('R2 título de otro vehículo (otra marca, sin el modelo pedido) → no comparable (vehicle_mismatch)', () => {
    const m = evaluateMatch(pads, o('Pastillas De Freno Delanteras Bosch Peugeot 208 1.5 8v 2013/'))
    expect(m.decision).toBe('discard')
    expect(m.reasons).toContain('vehicle_mismatch')
  })

  it('R3 publicación multivehículo (otra marca + el modelo pedido) → requiere confirmación, nunca "candidata"', () => {
    const m = evaluateMatch(pads, o('Pastillas de Freno Del. Peugeot 208 / C3 Palio Nuevo'))
    expect(m.decision).toBe('needs_review')
    expect(m.reasons).toContain('multi_vehicle_listing')
  })

  it('R4 mismo fabricante, otro modelo (Grand Siena) sin mencionar Palio → revisión, no candidata ni comparable', () => {
    const m = evaluateMatch(pads, o('Pastillas De Freno Delantera Fiat Grand Siena 1.6 16v / 1.4 8v Evo 2012+ - Fras-le Pd/494'))
    expect(m.decision).toBe('needs_review')
    expect(m.reasons).toContain('model_not_stated')
    expect(m.comparable).toBe(false)
  })

  it('R5 Palio + rango abierto + marca/código en el título → candidata, pero NUNCA comparable sin código confirmado', () => {
    const m = evaluateMatch(pads, o('Pastillas De Freno Delantera Fiat Palio 1997+ - Durbloc 12068a'))
    expect(m.decision).toBe('candidate')
    expect(m.comparable).toBe(false)
    expect(evaluateMatch({ ...pads, partCode: '12068A' }, { ...o('Pastillas De Freno Delantera Fiat Palio 1997+ - Durbloc 12068a'), condition: 'new' }).comparable).toBe(true)
  })
})

describe('PC-11 motorización: diésel y cilindrada pegada a letras (piloto real 14/11/2026, precios ficticios)', () => {
  const o = (title: string) => ({
    provider: 'serpapi' as const, providerItemId: 't', title, priceMinor: 1_000_000, currency: 'ARS' as const,
    url: 'https://www.google.com.ar/search?ibp=oshop', merchant: 'm', condition: 'unknown' as const, retrievedAt: '2026-11-14T18:00:00.000Z',
  })
  const evo: PriceQuery = { description: 'Manguera de respiración de gases', vehicle: { make: 'Fiat', model: 'Palio', year: '2017', engine: '1.4 8v Evo' }, presentation: 'unit', quantity: 1 }

  it('E1 caso real "1.7td" para un 1.4 8v Evo → incompatibilidad confirmada (engine_mismatch), no "sin datos"', () => {
    const m = evaluateMatch(evo, o('Manguera Descarga Gases 1.7td Palio/siena/str'))
    expect(m.signals.engine).toBe('mismatch')
    expect(m.decision).toBe('discard')
    expect(m.reasons).toContain('engine_mismatch')
  })

  it('E2 cilindrada con sufijo ("1.4fire", "1,4evo") se reconoce como la pedida', () => {
    expect(evaluateMatch(evo, o('Manguera Respiradero Gases Palio 1.4fire')).signals.engine).toBe('match')
    expect(evaluateMatch(evo, o('Manguera Respiradero Gases Palio 1,4evo')).signals.engine).toBe('match')
  })

  it('E3 diésel sin cilindrada (JTD / TD / Diesel / Multijet) para un motor nafta declarado → fuel_mismatch', () => {
    for (const t of ['Manguera Respiradero Gases Palio JTD', 'Manguera Respiradero Gases Palio Diesel', 'Manguera Respiradero Gases Palio Multijet', 'Manguera Respiradero Gases Palio Td']) {
      const m = evaluateMatch(evo, o(t))
      expect(m.decision, t).toBe('discard')
      expect(m.reasons, t).toContain('fuel_mismatch')
    }
  })

  it('E4 multi-motor que incluye el pedido y un diésel ("1.4 Fire / 1.3 JTD") → revisión fuel_unverified, no descarte', () => {
    const m = evaluateMatch(evo, o('Manguera Respiradero Gases Palio 1.4 Fire / 1.3 JTD'))
    expect(m.decision).toBe('needs_review')
    expect(m.reasons).toContain('fuel_unverified')
  })

  it('E5 información insuficiente sigue siendo revisión, no incompatibilidad: sin motor declarado o título sin motor', () => {
    const noEngine = { ...evo, vehicle: { make: 'Fiat', model: 'Palio', year: '2017' } }
    expect(evaluateMatch(noEngine, o('Manguera Descarga Gases 1.7td Palio/siena/str')).decision).not.toBe('discard')
    expect(evaluateMatch(evo, o('Manguera Respiradero Gases Fiat Palio')).signals.engine).toBe('unknown')
    // A diesel vehicle is not penalised by diesel titles.
    const jtd = { ...evo, vehicle: { make: 'Fiat', model: 'Palio', engine: '1.3 JTD' } }
    expect(evaluateMatch(jtd, o('Manguera Respiradero Gases Palio 1.3 JTD')).decision).toBe('candidate')
  })
})

describe('PC-10 calidad de ofertas reales A, C y D (títulos observados 14/11/2026; precios ficticios)', () => {
  const o = (title: string) => ({
    provider: 'serpapi' as const, providerItemId: 't', title, priceMinor: 1_000_000, currency: 'ARS' as const,
    url: 'https://www.google.com.ar/search?ibp=oshop', merchant: 'm', condition: 'unknown' as const, retrievedAt: '2026-11-14T17:47:24.349Z',
  })
  const air: PriceQuery = { description: 'Filtro de aire', vehicle: { make: 'Fiat', model: 'Palio', engine: '1.4' }, presentation: 'unit', quantity: 1 }
  const shock: PriceQuery = { description: 'Amortiguador', vehicle: { make: 'Fiat', model: 'Palio' }, presentation: 'unit', quantity: 1 }

  it('T1 "GM Corsa ... Fiat Palio" es multivehículo: GM cuenta como otra marca → revisión, no candidata', () => {
    const m = evaluateMatch(hose, o('Manguera Descarga Gases Venteo Gm Corsa Fun Fiat Palio Siena'))
    expect(m.decision).toBe('needs_review')
    expect(m.reasons).toContain('multi_vehicle_listing')
  })

  it('T2 variante de carrocería (Palio Weekend / W.end) para un Palio → revisión "model_variant", nunca candidata', () => {
    for (const [q, t] of [
      [shock, 'Amortiguador Delantero Fiat Palio Weekend Cofap'],
      [shock, 'Amortiguador Delante. Fiat Palio W.end (97/00) Cartucho 4746'],
      [pads, 'Pastilla Freno PALIO WE STRADA FASE1-2-3-4'],
    ] as const) {
      const m = evaluateMatch(q, o(t))
      expect(m.decision, t).toBe('needs_review')
      expect(m.reasons, t).toContain('model_variant')
    }
    // If the person's vehicle IS the Weekend, the same title is a candidate.
    expect(evaluateMatch({ ...shock, vehicle: { make: 'Fiat', model: 'Palio Weekend' } }, o('Amortiguador Delantero Fiat Palio Weekend Cofap')).decision).toBe('candidate')
  })

  it('T3 carcasa / tapa / soporte de la pieza no es la pieza → no comparable (accessory_not_part), salvo que se pida', () => {
    const m = evaluateMatch(air, o('Carcaza Filtro De Aire PALIO 326 UNO NOVO 1.4 ORIGINAL'))
    expect(m.decision).toBe('discard')
    expect(m.reasons).toContain('accessory_not_part')
    expect(evaluateMatch({ ...air, description: 'Carcasa del filtro de aire' }, o('Carcaza Filtro De Aire PALIO 326 UNO NOVO 1.4 ORIGINAL')).decision).not.toBe('discard')
    expect(evaluateMatch(air, o('Filtro De Aire Para Fiat Uno Novo/palio/grand Siena 1.4 8v E')).decision).toBe('candidate')
  })

  it('T4 pedido sin posición y publicación delantera/trasera → la posición queda como dato faltante', () => {
    const m = evaluateMatch(shock, o('Amortiguador Trasera Monroe - Fiat Palio'))
    expect(m.signals.position).toBe('unverified')
    expect(evaluateMatch(pads, o('Pastillas De Freno Delantera Fiat Palio 1997+')).signals.position).toBe('match')
    expect(evaluateMatch(shock, o('Amortiguador Fiat Palio')).signals.position).toBe('unknown')
  })
})
