/**
 * pilot-readiness.test.ts — Incremento 7C internal pilot: environment guards, distributed store
 * (atomic quotas, shared cache across instances) and safe degradation. Uses the in-repo Upstash
 * REST test double (FakeUpstash): NO network, NO real Upstash, NO SerpApi. Synthetic offers only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeUpstash } from '@/server/llm-protection/fake-upstash'
import { UpstashQuotaStore } from '@/server/llm-protection/upstash-quota-store'
import { isPartsPricingEnabled } from './pricing-config'
import { handlePartsPricesRequest, resetPartsPricingRuntimeForTests } from './route-handler'
import { UpstashPricingCache } from './shared-cache'
import { createPricingService } from './pricing-service'
import { buildDiscardAudit } from './discard-audit'
import { evaluateMatch } from './matching'
import { createSerpApiProvider } from './serpapi-provider'
import type { FetchLike, PriceOffer, PriceProvider, PriceQuery } from './types'

const PROD = { PARTS_PRICING_ENABLED: 'true', NODE_ENV: 'production', LLM_QUOTA_STORE: 'memory' }
const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', engine: '1.4 8v Evo' }

function offer(id: string, title: string): PriceOffer {
  return { provider: 'serpapi', providerItemId: id, title, priceMinor: 1_000_000, currency: 'ARS', url: `https://www.google.com.ar/shopping/product/${id}`, merchant: 'Tienda Sintética', condition: 'unknown', retrievedAt: '2026-11-14T00:00:00.000Z' }
}
function provider(): PriceProvider & { search: ReturnType<typeof vi.fn> } {
  return { id: 'serpapi', search: vi.fn(async () => ({ status: 'ok' as const, offers: [offer('1', 'Filtro De Aire Fiat Palio 1.4 8v')], droppedInvalid: 0, latencyMs: 1 })) }
}
function req(description: string, ip: string): Request {
  return new Request('http://localhost/api/budget/parts-prices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ vehicle: { make: 'Fiat', model: 'Palio', year: '2017' }, lines: [{ id: 'l1', description }] }),
  })
}
const upstash = (fake: FakeUpstash) => new UpstashQuotaStore({ url: 'https://fake.upstash.io', token: 't', fetchImpl: fake.fetch })
const cacheOn = (fake: FakeUpstash) => new UpstashPricingCache({ url: 'https://fake.upstash.io', token: 't', fetchImpl: fake.fetch })

beforeEach(() => resetPartsPricingRuntimeForTests())

describe('PR-01 public production domain is never enabled by the flag alone', () => {
  it.each([
    [{ PARTS_PRICING_ENABLED: 'true' }, true], // local
    [{ PARTS_PRICING_ENABLED: 'true', VERCEL_ENV: 'preview' }, true],
    [{ PARTS_PRICING_ENABLED: 'true', VERCEL_ENV: 'development' }, true],
    [{ PARTS_PRICING_ENABLED: 'true', VERCEL_ENV: 'production' }, false],
    [{ PARTS_PRICING_ENABLED: 'true', VERCEL_ENV: 'production', PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION: 'yes' }, false],
    [{ PARTS_PRICING_ENABLED: 'true', VERCEL_ENV: 'production', PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION: 'true' }, true],
    [{ VERCEL_ENV: 'preview' }, false],
  ])('%j → %s', (env, expected) => {
    expect(isPartsPricingEnabled(env)).toBe(expected)
  })

  it('the route answers 404 on Vercel production even with flag + key + provider', async () => {
    const p = provider()
    const r = await handlePartsPricesRequest(req('Filtro de aire', '203.0.113.1'), { env: { ...PROD, VERCEL_ENV: 'production', PARTS_PRICING_PROVIDER: 'serpapi', SERPAPI_API_KEY: 'k' }, provider: p })
    expect(r.status).toBe(404)
    expect(p.search).not.toHaveBeenCalled()
  })
})

describe('PR-02 distributed store (Upstash REST double): atomic quotas across instances', () => {
  it('10 concurrent requests from 2 instances, daily budget 5 → exactly 5 provider searches', async () => {
    const fake = new FakeUpstash()
    const instA = upstash(fake)
    const instB = upstash(fake)
    const p = provider()
    const env = { ...PROD, PARTS_PRICING_DAILY_SEARCH_BUDGET: '5', PARTS_PRICING_CLIENT_DAILY_SEARCHES: '100' }
    const runs = Array.from({ length: 10 }, (_, i) =>
      handlePartsPricesRequest(req(`Filtro de aire variante ${i}`, `198.51.100.${i + 1}`), { env, provider: p, store: i % 2 ? instA : instB, cache: cacheOn(fake) }),
    )
    const bodies = await Promise.all(runs.map(async (r) => (await r).json()))
    expect(p.search).toHaveBeenCalledTimes(5)
    expect(bodies.filter((b) => b.items[0].reason === 'quota_exceeded')).toHaveLength(5)
    const day = Math.floor(Date.now() / 86_400_000)
    expect(await instA.get(`chuya:pp:d:${day}`)).toBe(5)
  })

  it('shared cache: a search done by instance A is reused by instance B (new process memory) — no new search, no budget', async () => {
    const fake = new FakeUpstash()
    const p = provider()
    const env = { ...PROD, PARTS_PRICING_DAILY_SEARCH_BUDGET: '1' }
    await handlePartsPricesRequest(req('Filtro de aire', '198.51.100.1'), { env, provider: p, store: upstash(fake), cache: cacheOn(fake) })
    resetPartsPricingRuntimeForTests()
    const second = await handlePartsPricesRequest(req('Filtro de aire', '198.51.100.2'), { env, provider: p, store: upstash(fake), cache: cacheOn(fake) })
    expect(p.search).toHaveBeenCalledTimes(1)
    expect((await second.json()).items[0].status).toBe('ok')
  })

  it('cache keys are hashed and cached values carry no diagnostics, keys or request URLs', async () => {
    const fake = new FakeUpstash()
    const KEY = 'SERPAPI_SECRET_FOR_TEST'
    const fetchFake: FetchLike = async () =>
      ({ ok: true, status: 200, json: async () => ({ search_metadata: { status: 'Success' }, shopping_results: [{ position: 1, product_id: '9', title: 'Filtro De Aire Fiat Palio 1.4', price: '$ 9.000,00', extracted_price: 9000, source: 'Tienda Sintética', product_link: 'https://www.google.com.ar/shopping/product/9' }] }) }) as unknown as Response
    await handlePartsPricesRequest(req('Filtro de aire', '198.51.100.3'), { env: PROD, provider: createSerpApiProvider({ apiKey: KEY, fetch: fetchFake }), store: upstash(fake), cache: cacheOn(fake) })
    const keys = [...fake.data.keys()]
    expect(keys.some((k) => k.includes(':pp:cache:'))).toBe(true)
    const dump = JSON.stringify([...fake.data.entries()].map(([k, v]) => [k, typeof v.v === 'string' ? v.v : 'hash']))
    // Keys never contain the query text (values legitimately hold the public listing titles).
    expect(keys.join(' ')).not.toMatch(/filtro|palio|aire/i)
    expect(dump).not.toContain(KEY)
    expect(dump).not.toContain('diagnostics')
    expect(dump).not.toContain('serpapi.com')
  })
})

describe('PR-03 safe degradation of the distributed store', () => {
  it('Upstash unreachable / wrong token in production → rate limit degrades locally, searches fail closed (no provider call)', async () => {
    const fake = new FakeUpstash()
    fake.expectedToken = 'the-real-token' // our store uses another token → every command gets 401
    const p = provider()
    const r = await handlePartsPricesRequest(req('Filtro de aire', '198.51.100.4'), { env: PROD, provider: p, store: upstash(fake), cache: cacheOn(fake) })
    expect(r.status).toBe(200)
    expect((await r.json()).items[0]).toMatchObject({ status: 'unavailable', reason: 'store_unavailable' })
    expect(p.search).not.toHaveBeenCalled()
  })

  it('cache errors never block a search (budget still enforced by the store)', async () => {
    const quotaFake = new FakeUpstash()
    const brokenCache = new FakeUpstash()
    brokenCache.expectedToken = 'other'
    const p = provider()
    const r = await handlePartsPricesRequest(req('Filtro de aire', '198.51.100.5'), { env: PROD, provider: p, store: upstash(quotaFake), cache: cacheOn(brokenCache) })
    expect((await r.json()).items[0].status).toBe('ok')
    expect(p.search).toHaveBeenCalledTimes(1)
  })
})

describe('PR-04 no secrets in logs, responses or client code', () => {
  const serverDir = join(process.cwd(), 'src/server/parts-pricing')
  const serverSrc = readdirSync(serverDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => readFileSync(join(serverDir, f), 'utf8'))

  it('the pricing server code never logs (no console.*) — nothing can leak a key or a query to logs', () => {
    for (const src of serverSrc) expect(src).not.toMatch(/console\.(log|info|warn|error|debug)/)
  })

  it('the route never returns provider diagnostics or audit data', async () => {
    const p: PriceProvider = {
      id: 'serpapi',
      search: async () => ({ status: 'ok', offers: [offer('1', 'Filtro De Aire Fiat Palio 1.4')], droppedInvalid: 1, latencyMs: 1, diagnostics: { httpStatus: 200, sourceCounts: {}, rawCount: 2, dropReasons: { price_unparsed: 1 }, priceFormats: [], linkHosts: [] }, auditDropped: [{ title: 'Título descartado', reason: 'price_unparsed' }] }),
    }
    const r = await handlePartsPricesRequest(req('Filtro de aire', '198.51.100.6'), { env: { ...PROD, NODE_ENV: 'test' }, provider: p, store: upstash(new FakeUpstash()) })
    const text = await r.text()
    for (const forbidden of ['diagnostics', 'auditDropped', 'audit', 'Título descartado', 'dropReasons']) expect(text).not.toContain(forbidden)
  })
})

describe('PR-05 discard audit (probe only)', () => {
  const hose: PriceQuery = { description: 'Manguera de respiración de gases', vehicle, presentation: 'unit', quantity: 1 }

  it('records title + concrete reasons, flags possible false discards and counts duplicates', () => {
    const offers = [
      offer('1', 'Manguera Descarga Venteo Fiat Palio 1.4 8v'), // same head noun, different wording → review hint
      offer('2', 'Filtro De Aceite Fiat Palio 1.4'), // other part → plain discard
      offer('3', 'Manguera Respiradero Gases Fiat Palio 1.6 16v'), // engine only → review hint
      offer('4', 'Manguera Respiradero Gases Fiat Palio 1.4 8v'),
      offer('5', 'Manguera  respiradero gases FIAT Palio 1.4 8v'), // duplicate title (normalized)
    ]
    const evaluated = offers.map((o) => ({ offer: o, match: evaluateMatch(hose, o) }))
    const a = buildDiscardAudit(hose, evaluated, [{ title: 'Manguera X', reason: 'price_unparsed' }])
    const byTitle = Object.fromEntries(a.discarded.map((d) => [d.title, d]))
    expect(byTitle['Manguera Descarga Venteo Fiat Palio 1.4 8v']).toMatchObject({ reasons: ['part_type_mismatch'], possibleFalseDiscard: true, reviewHint: 'qualifier_wording' })
    expect(byTitle['Filtro De Aceite Fiat Palio 1.4']).toMatchObject({ possibleFalseDiscard: false })
    expect(byTitle['Manguera Respiradero Gases Fiat Palio 1.6 16v']).toMatchObject({ reasons: ['engine_mismatch'], reviewHint: 'engine_only' })
    expect(a.dropped).toEqual([{ title: 'Manguera X', reason: 'price_unparsed' }])
    expect(a.duplicates).toEqual({ count: 1, titles: ['Manguera Respiradero Gases Fiat Palio 1.4 8v'] })
  })

  it('the service attaches the audit only when asked; the SerpApi adapter keeps dropped titles only in audit mode', async () => {
    const body = { search_metadata: { status: 'Success' }, shopping_results: [{ position: 1, product_id: '1', title: 'Manguera Gases Fiat Palio', price: 'US$ 9', extracted_price: 9, source: 's', product_link: 'https://www.google.com.ar/shopping/product/1' }] }
    const f: FetchLike = async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response
    const normal = await createSerpApiProvider({ apiKey: 'k', fetch: f }).search(hose)
    expect(normal.auditDropped).toBeUndefined()
    const audited = await createSerpApiProvider({ apiKey: 'k', fetch: f, audit: true }).search(hose)
    expect(audited.auditDropped).toEqual([{ title: 'Manguera Gases Fiat Palio', reason: 'price_foreign_currency' }])

    const svc = createPricingService({ provider: createSerpApiProvider({ apiKey: 'k', fetch: f, audit: true }) })
    const line = { id: 'a', description: hose.description, category: 'part' as const }
    expect((await svc.research({ lines: [line], vehicle })).items[0]!.audit).toBeUndefined()
    const svc2 = createPricingService({ provider: createSerpApiProvider({ apiKey: 'k', fetch: f, audit: true }) })
    expect((await svc2.research({ lines: [line], vehicle, audit: true })).items[0]!.audit?.dropped).toHaveLength(1)
  })
})
