/**
 * search-budget.test.ts — Public pilot hardening of the SerpApi search budget (7C public pilot).
 * In-repo Upstash REST double (FakeUpstash): NO network, NO real Upstash, NO SerpApi.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeUpstash } from '@/server/llm-protection/fake-upstash'
import { InMemoryQuotaStore, type QuotaStore } from '@/server/llm-protection/quota-store'
import { UpstashQuotaStore } from '@/server/llm-protection/upstash-quota-store'
import { PRICING_BUDGET_DEFAULTS, readPartsPricingConfig } from './pricing-config'
import { handlePartsPricesRequest, resetPartsPricingRuntimeForTests } from './route-handler'
import { BUDGET_WINDOW_DAYS, PRICING_KILL_SWITCH_KEY, budgetAccountFor, createSearchGate, isPricingKillSwitchOn, searchBudgetKeys, setPricingKillSwitch } from './search-budget'
import { createSerpApiProvider } from './serpapi-provider'
import type { PriceOffer, PriceProvider } from './types'

const HOUR = 3_600_000
const DAY = 86_400_000
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0)
const upstash = (fake: FakeUpstash) => new UpstashQuotaStore({ url: 'https://fake.upstash.io', token: 't', fetchImpl: fake.fetch })
const limits = (o: Partial<{ client: number; hour: number; day: number; window: number }> = {}) => ({
  clientDailySearches: o.client ?? 100,
  hourlySearchBudget: o.hour ?? 100,
  dailySearchBudget: o.day ?? 100,
  monthlySearchBudget: o.window ?? 100,
})
const gate = (store: QuotaStore | null, now: () => number, o: Parameters<typeof limits>[0] = {}, client = 'c1', account = 'serpapi:acct') =>
  createSearchGate({ store, limits: limits(o), clientKey: client, account, now, requireDistributed: false })

beforeEach(() => resetPartsPricingRuntimeForTests())

describe('SB-01 reserveAll: every limit checked and charged in ONE atomic operation', () => {
  for (const [name, make] of [
    ['memory', () => new InMemoryQuotaStore(() => T0)],
    ['upstash', () => upstash(new FakeUpstash(() => T0))],
  ] as const) {
    it(`${name}: all checks pass → every increment applied; one fails → nothing applied`, async () => {
      const s: QuotaStore = make()
      const checks = [{ keys: ['a'], limit: 2 }, { keys: ['b', 'old'], limit: 3 }]
      const incs = [{ key: 'a', ttlMs: DAY }, { key: 'b', ttlMs: DAY }]
      expect(await s.reserveAll(checks, incs)).toEqual({ ok: true })
      expect(await s.reserveAll(checks, incs)).toEqual({ ok: true })
      expect(await s.reserveAll(checks, incs)).toEqual({ ok: false, failed: 0 })
      expect([await s.get('a'), await s.get('b')]).toEqual([2, 2])
      await s.adjust('old', 1, DAY)
      expect(await s.reserveAll([{ keys: ['c'], limit: 5 }, { keys: ['b', 'old'], limit: 3 }], [{ key: 'c', ttlMs: DAY }])).toEqual({ ok: false, failed: 1 })
      expect(await s.get('c')).toBe(0)
    })
  }

  it('upstash: one EVAL per reservation (no multi-step sequence that could leak under failure)', async () => {
    const fake = new FakeUpstash(() => T0)
    await gate(upstash(fake), () => T0)()
    expect(fake.commands.filter((c) => c[0] === 'EVAL')).toHaveLength(1)
    expect(fake.commands).toHaveLength(1)
  })
})

describe('SB-02 rolling 31-day window instead of the UTC calendar month', () => {
  it('a full budget at the end of a month still blocks the first days of the next month', async () => {
    const fake = new FakeUpstash(() => now)
    const s = upstash(fake)
    let now = Date.UTC(2026, 0, 31, 10)
    for (let i = 0; i < 5; i++) expect((await gate(s, () => now, { window: 5 }, `c${i}`)()).ok).toBe(true)
    now = Date.UTC(2026, 1, 1, 10) // new calendar month: the old monthly key would have reset
    expect(await gate(s, () => now, { window: 5 }, 'other')()).toEqual({ ok: false, reason: 'quota_exceeded' })
    now = Date.UTC(2026, 0, 31, 10) + (BUDGET_WINDOW_DAYS - 1) * DAY
    expect((await gate(s, () => now, { window: 5 }, 'other')()).ok).toBe(false)
    now = Date.UTC(2026, 0, 31, 10) + BUDGET_WINDOW_DAYS * DAY
    expect((await gate(s, () => now, { window: 5 }, 'other')()).ok).toBe(true)
  })

  it('so any SerpApi billing cycle (≤ 31 days) can never see more than the window budget', async () => {
    let now = Date.UTC(2026, 2, 10)
    const s = new InMemoryQuotaStore(() => now)
    const grantedOnDay: number[] = []
    for (let d = 0; d < 93; d++) {
      now = Date.UTC(2026, 2, 10) + d * DAY
      let n = 0
      for (let i = 0; i < 20; i++) if ((await gate(s, () => now, { window: 50, day: 20 }, `c${d}-${i}`)()).ok) n++
      grantedOnDay.push(n)
    }
    // Any 31 consecutive days (= any billing cycle) stays within the budget …
    for (let start = 0; start + BUDGET_WINDOW_DAYS <= grantedOnDay.length; start++) {
      expect(grantedOnDay.slice(start, start + BUDGET_WINDOW_DAYS).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(50)
    }
    // … and the budget is usable again once old days leave the window.
    expect(grantedOnDay.reduce((a, b) => a + b, 0)).toBeGreaterThan(100)
  })
})

describe('SB-03 hourly cap (SerpApi Free throughput 50/h), daily and per client', () => {
  it('global hour cap: the third search of the hour is refused, the next hour is allowed again', async () => {
    let now = T0
    const s = new InMemoryQuotaStore(() => now)
    const g = (client: string) => gate(s, () => now, { hour: 2 }, client)()
    expect([(await g('a')).ok, (await g('b')).ok, (await g('c')).ok]).toEqual([true, true, false])
    now += HOUR
    expect((await g('c')).ok).toBe(true)
  })

  it('global day cap and per-client day cap; both reset the next UTC day', async () => {
    let now = T0
    const s = new InMemoryQuotaStore(() => now)
    const g = (client: string, o = { day: 3, client: 2 }) => gate(s, () => now, o, client)()
    expect([(await g('a')).ok, (await g('a')).ok, (await g('a')).ok]).toEqual([true, true, false]) // client cap 2
    expect([(await g('b')).ok, (await g('c')).ok]).toEqual([true, false]) // day cap 3
    now += DAY
    expect((await g('a')).ok).toBe(true)
  })

  it('defaults: hourly 40 (below the Free plan 50/h), daily 20, window 200 (below 250)', () => {
    expect(PRICING_BUDGET_DEFAULTS).toMatchObject({ hourlySearchBudget: 40, dailySearchBudget: 20, monthlySearchBudget: 200 })
    expect(readPartsPricingConfig({}).hourlySearchBudget).toBe(40)
    expect(readPartsPricingConfig({ PARTS_PRICING_HOURLY_SEARCH_BUDGET: '10' }).hourlySearchBudget).toBe(10)
    expect(() => readPartsPricingConfig({ PARTS_PRICING_HOURLY_SEARCH_BUDGET: '-1' })).toThrow()
  })
})

describe('SB-04 counters belong to the SerpApi ACCOUNT, not to the deployment prefix', () => {
  it('account id is a short hash of the key: stable, distinct per key, never contains the key', () => {
    const a = budgetAccountFor('serpapi', 'SECRET-KEY-ONE')
    expect(a).toBe(budgetAccountFor('serpapi', 'SECRET-KEY-ONE'))
    expect(a).not.toBe(budgetAccountFor('serpapi', 'SECRET-KEY-TWO'))
    expect(a).not.toContain('SECRET')
    expect(a).toMatch(/^serpapi:[0-9a-f]{16}$/)
    expect(createSerpApiProvider({ apiKey: 'SECRET-KEY-ONE' }).budgetAccount).toBe(a)
    const keys = searchBudgetKeys('serpapi:acct', 'c1', T0)
    expect(keys.windowDays).toHaveLength(BUDGET_WINDOW_DAYS)
    for (const k of [keys.clientDay, keys.hour, ...keys.windowDays]) expect(k.startsWith('chuya-pp:b:serpapi:acct:')).toBe(true)
  })

  it('preview and production with different LLM_QUOTA_KEY_PREFIX but the same SerpApi key share ONE budget', async () => {
    const fake = new FakeUpstash()
    const p = fakeProvider('serpapi:shared')
    const base = { PARTS_PRICING_ENABLED: 'true', NODE_ENV: 'production', LLM_QUOTA_STORE: 'memory', PARTS_PRICING_MONTHLY_SEARCH_BUDGET: '3' }
    const statuses: string[] = []
    for (let i = 0; i < 5; i++) {
      const env = { ...base, LLM_QUOTA_KEY_PREFIX: i % 2 ? 'preview' : 'prod' }
      const body = await (await handlePartsPricesRequest(req([`Filtro de aire ${i}`], `198.51.100.${i + 1}`), { env, provider: p, store: upstash(fake) })).json()
      statuses.push(body.items[0].reason ?? body.items[0].status)
    }
    expect(p.search).toHaveBeenCalledTimes(3)
    expect(statuses.filter((s) => s === 'quota_exceeded')).toHaveLength(2)
  })
})

describe('SB-05 concurrency across serverless instances and multi-part requests', () => {
  it('40 concurrent requests × 5 parts from 4 instances, window budget 7 → exactly 7 billed searches', async () => {
    const fake = new FakeUpstash()
    const instances = [upstash(fake), upstash(fake), upstash(fake), upstash(fake)]
    const p = fakeProvider('serpapi:acct')
    const env = { PARTS_PRICING_ENABLED: 'true', NODE_ENV: 'production', LLM_QUOTA_STORE: 'memory', PARTS_PRICING_MONTHLY_SEARCH_BUDGET: '7', PARTS_PRICING_CLIENT_REQUESTS_PER_HOUR: '1000' }
    const runs = Array.from({ length: 40 }, (_, i) =>
      handlePartsPricesRequest(req([1, 2, 3, 4, 5].map((n) => `Repuesto ${i}-${n} filtro`), `198.51.${i}.1`), { env, provider: p, store: instances[i % 4]! }),
    )
    await Promise.all(runs)
    expect(p.search).toHaveBeenCalledTimes(7)
  })

  it('a request with budget for 2 of its 4 parts searches exactly 2; labor is never searched nor charged', async () => {
    const p = fakeProvider('serpapi:acct')
    const env = { PARTS_PRICING_ENABLED: 'true', LLM_QUOTA_STORE: 'memory', PARTS_PRICING_CLIENT_DAILY_SEARCHES: '2' }
    const body = await (await handlePartsPricesRequest(req(['Filtro de aire', 'Filtro de aceite', 'Mano de obra', 'Bujías', 'Correa de distribución'], '203.0.113.9'), { env, provider: p, store: new InMemoryQuotaStore() })).json()
    expect(p.search).toHaveBeenCalledTimes(2)
    expect(body.items.find((i: { lineId: string }) => i.lineId === 'l2')).toMatchObject({ status: 'skipped', reason: 'not_a_part' })
    expect(body.items.filter((i: { reason?: string }) => i.reason === 'quota_exceeded')).toHaveLength(2)
  })

  it('Upstash failure during the reservation → no search and no partial charge', async () => {
    const fake = new FakeUpstash()
    const s = upstash(fake)
    fake.failNext = 'timeout'
    expect(await gate(s, Date.now)()).toEqual({ ok: false, reason: 'store_unavailable' })
    expect(fake.data.size).toBe(0)
    expect(await gate(null, Date.now)()).toEqual({ ok: false, reason: 'store_unavailable' })
    expect(await createSearchGate({ store: new InMemoryQuotaStore(), limits: limits(), clientKey: 'c', account: 'a', now: Date.now, requireDistributed: true })()).toEqual({ ok: false, reason: 'store_unavailable' })
  })
})

// ── helpers ──────────────────────────────────────────────────────────────────

function offer(title: string): PriceOffer {
  return { provider: 'serpapi', providerItemId: title, title, priceMinor: 1_000_000, currency: 'ARS', url: 'https://www.google.com.ar/shopping/product/1', merchant: 'Tienda Sintética', condition: 'unknown', retrievedAt: '2026-11-15T00:00:00.000Z' }
}
function fakeProvider(account: string): PriceProvider & { search: ReturnType<typeof vi.fn> } {
  return { id: 'serpapi', budgetAccount: account, search: vi.fn(async () => ({ status: 'ok' as const, offers: [offer('Filtro de aire Fiat Palio')], droppedInvalid: 0, latencyMs: 1 })) }
}
function req(parts: string[], ip: string): Request {
  return new Request('http://localhost/api/budget/parts-prices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ vehicle: { make: 'Fiat', model: 'Palio', year: '2017' }, lines: parts.map((d, i) => ({ id: `l${i}`, description: d })) }),
  })
}

describe('SB-06 immediate kill switch (no redeploy) and the probe shares the budget', () => {
  it('kill flag in the shared store → "disabled" without any provider call; cleared → searches again', async () => {
    const fake = new FakeUpstash()
    const store = upstash(fake)
    const p = fakeProvider('serpapi:acct')
    const env = { PARTS_PRICING_ENABLED: 'true', NODE_ENV: 'production', LLM_QUOTA_STORE: 'memory' }
    await setPricingKillSwitch(store, true)
    const off = await (await handlePartsPricesRequest(req(['Filtro de aire'], '198.51.100.40'), { env, provider: p, store })).json()
    expect(off).toEqual({ status: 'disabled' })
    expect(p.search).not.toHaveBeenCalled()
    expect(await isPricingKillSwitchOn(store)).toBe(true)
    await setPricingKillSwitch(store, false)
    const on = await (await handlePartsPricesRequest(req(['Filtro de aire'], '198.51.100.41'), { env, provider: p, store })).json()
    expect(on.status).toBe('ok')
    expect(p.search).toHaveBeenCalledTimes(1)
  })

  it('default off; the gate re-checks the flag atomically (pre-check read failure cannot bypass it); namespace isolated from LLM prefix', async () => {
    const fake = new FakeUpstash()
    const store = upstash(fake)
    expect(await isPricingKillSwitchOn(store)).toBe(false) // absent key = off
    const gate = createSearchGate({ store, limits: { clientDailySearches: 10, hourlySearchBudget: 10, dailySearchBudget: 10, monthlySearchBudget: 10 }, clientKey: 'c', account: 'serpapi:acct', now: () => Date.UTC(2026, 10, 15), requireDistributed: true })
    expect(await gate()).toEqual({ ok: true })
    await setPricingKillSwitch(store, true)
    expect(await gate()).toEqual({ ok: false, reason: 'store_unavailable' })
    // Simulate the route pre-check failing (EXISTS errors) while the flag is on: the gate still refuses.
    const flaky = new Proxy(store, {
      get: (t, prop) => (prop === 'hasFlag' ? async () => { throw new Error('timeout') } : typeof Reflect.get(t, prop) === 'function' ? (Reflect.get(t, prop) as (...a: unknown[]) => unknown).bind(t) : Reflect.get(t, prop)),
    }) as typeof store
    const flakyGate = createSearchGate({ store: flaky, limits: { clientDailySearches: 10, hourlySearchBudget: 10, dailySearchBudget: 10, monthlySearchBudget: 10 }, clientKey: 'c2', account: 'serpapi:acct', now: () => Date.UTC(2026, 10, 15), requireDistributed: true })
    expect(await flakyGate()).toEqual({ ok: false, reason: 'store_unavailable' }) // refused by the kill check in reserveAll
    await setPricingKillSwitch(store, false)
    expect(await flakyGate()).toEqual({ ok: true }) // same wrapper works once the flag is cleared → refusal above was the flag
    await setPricingKillSwitch(store, true)
    expect(await isPricingKillSwitchOn(flaky)).toBe(false)
    const p = fakeProvider('serpapi:acct')
    const env = { PARTS_PRICING_ENABLED: 'true', NODE_ENV: 'production', LLM_QUOTA_STORE: 'memory' }
    const res = await (await handlePartsPricesRequest(req(['Filtro de aire'], '198.51.100.42'), { env, provider: p, store: flaky })).json()
    expect(p.search).not.toHaveBeenCalled()
    expect(JSON.stringify(res)).not.toContain('"status":"ok","offers":[{')
    // Fixed namespace: never derived from LLM_QUOTA_KEY_PREFIX, and distinct from the LLM kill switch.
    expect(PRICING_KILL_SWITCH_KEY).toBe('chuya-pp:b:kill')
    expect(PRICING_KILL_SWITCH_KEY).not.toMatch(/:llm:kill$/)
  })

  it('the real-search probe charges the same budget and requires the distributed store', () => {
    const src = readFileSync(join(process.cwd(), 'benchmark/smoke/parts-pricing-probe.ts'), 'utf8')
    expect(src).toContain('beforeProviderCall: gate')
    expect(src).toContain('requireDistributed: true')
  })
})
