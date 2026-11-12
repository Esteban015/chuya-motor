/**
 * llm-protection.test.ts — Incremento 6.4D, Fases 3–4: distributed LLM protection.
 * No network: Upstash is replaced by FakeUpstash (atomic per command, like Redis); providers are fakes.
 */
import { describe, it, expect, vi } from 'vitest'
import type { LLMAdapter, LLMCompletionRequest, LLMResult } from '@/agents/llm/llm-adapter'
import { InMemoryQuotaStore, QuotaStoreError, type QuotaStore } from './quota-store'
import { UpstashQuotaStore } from './upstash-quota-store'
import { FakeUpstash } from './fake-upstash'
import { readLlmProtectionConfig, ProtectionConfigError, PILOT_LIMITS, type LlmProtectionConfig } from './protection-config'
import { GuardedLLMAdapter, estimateTokens } from './guarded-llm-adapter'
import { UsageMetrics, utcDay } from './usage-metrics'
import { clientKeyFor, resolveClientIp } from './client-identity'
import { createRequestProtection } from './runtime'
import { TrackedLLMAdapter } from './processing-tracker'

const TOKEN = 'AXsecretUpstashToken_0123456789'
const URL_ = 'https://fake-db.upstash.io'
const REQ: LLMCompletionRequest = { system: 'S'.repeat(300), userContent: 'U'.repeat(300) }

function cfg(over: Partial<LlmProtectionConfig> = {}): LlmProtectionConfig {
  return { ...readLlmProtectionConfig({ NODE_ENV: 'test' }), ...over }
}

class FakeProvider implements LLMAdapter {
  readonly modelId = 'fake-provider'
  calls = 0
  lastRetryAfterMs: number | null = null
  constructor(
    private readonly result: LLMResult = { ok: true, content: '{}', tokensUsed: 500 },
    private readonly delayMs = 0,
  ) {}
  async complete(): Promise<LLMResult> {
    this.calls++
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    return this.result
  }
}

function guard(store: QuotaStore | null, over: Partial<LlmProtectionConfig> = {}, inner: LLMAdapter = new FakeProvider(), clientKey = 'c1') {
  const config = cfg(over)
  const metrics = new UsageMetrics(store, config.keyPrefix)
  return { adapter: new GuardedLLMAdapter(inner, { store, config, clientKey, provider: 'groq', metrics }), inner, metrics, config }
}

const day = utcDay(Date.now())
const k = (s: string) => `chuya:llm:groq:${s}:${day}`

// ── Atomic reservations and concurrency ──────────────────────────────────────

describe('PROT-01: atomic reservations under concurrency', () => {
  it('PROT-01-A: in-memory — 50 concurrent reservations against limit 10 → exactly 10 succeed', async () => {
    const s = new InMemoryQuotaStore()
    const results = await Promise.all(Array.from({ length: 50 }, () => s.reserve('k', 1, 10, 60_000)))
    expect(results.filter((r) => r.ok)).toHaveLength(10)
    expect(await s.get('k')).toBe(10)
  })

  it('PROT-01-B: Upstash — two serverless instances share one limit (no overshoot, interleaved network)', async () => {
    const backend = new FakeUpstash()
    const a = new UpstashQuotaStore({ url: URL_, token: TOKEN, fetchImpl: backend.fetch })
    const b = new UpstashQuotaStore({ url: URL_, token: TOKEN, fetchImpl: backend.fetch })
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).reserve('shared', 1, 7, 60_000)))
    expect(results.filter((r) => r.ok)).toHaveLength(7)
    expect(await a.get('shared')).toBe(7)
    // One atomic script per reservation: no read-then-write across round trips.
    expect(backend.commands.filter((c) => c[0] === 'EVAL')).toHaveLength(40)
  })

  it('PROT-01-C: token budget — concurrent guarded calls never exceed the shared daily token budget', async () => {
    const backend = new FakeUpstash()
    const est = estimateTokens(REQ, 2048)
    const budget = est * 3 + 10 // room for exactly 3 reservations
    const instances = Array.from({ length: 12 }, (_, i) =>
      guard(new UpstashQuotaStore({ url: URL_, token: TOKEN, fetchImpl: backend.fetch }), { dailyTokenBudget: budget, maxConcurrent: 100 }, new FakeProvider({ ok: true, content: '{}' }), `c${i}`),
    )
    const results = await Promise.all(instances.map((g) => g.adapter.complete(REQ)))
    expect(results.filter((r) => r.ok)).toHaveLength(3)
    expect(results.filter((r) => !r.ok && r.error.code === 'LLM_BUDGET_EXHAUSTED')).toHaveLength(9)
    expect(Number(backend.execute(['GET', k('tokens')]))).toBeLessThanOrEqual(budget)
  })

  it('PROT-01-D: global concurrency — slow calls beyond LLM_MAX_CONCURRENT are refused (LLM_BUSY), slot released after', async () => {
    const s = new InMemoryQuotaStore()
    const slow = () => guard(s, { maxConcurrent: 2 }, new FakeProvider({ ok: true, content: '{}', tokensUsed: 10 }, 30))
    const results = await Promise.all([slow(), slow(), slow()].map((g) => g.adapter.complete(REQ)))
    expect(results.filter((r) => r.ok)).toHaveLength(2)
    expect(results.filter((r) => !r.ok && r.error.code === 'LLM_BUSY')).toHaveLength(1)
    expect(await s.get('chuya:llm:groq:inflight')).toBe(0)
  })
})

// ── Quotas, reconciliation, restart ──────────────────────────────────────────

describe('PROT-02: quota exhaustion, release and reconciliation', () => {
  it('PROT-02-A: daily call budget exhausted → LLM_BUDGET_EXHAUSTED, provider not called', async () => {
    const s = new InMemoryQuotaStore()
    expect((await guard(s, { dailyCallBudget: 1 }).adapter.complete(REQ)).ok).toBe(true)
    const g = guard(s, { dailyCallBudget: 1 })
    const r = await g.adapter.complete(REQ)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error.code).toBe('LLM_BUDGET_EXHAUSTED')
    expect((g.inner as FakeProvider).calls).toBe(0)
  })

  it('PROT-02-B: a refused reservation releases the ones already taken (client + calls)', async () => {
    const s = new InMemoryQuotaStore()
    const r = await guard(s, { dailyTokenBudget: 10 }).adapter.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_BUDGET_EXHAUSTED')
    expect(await s.get(k('calls'))).toBe(0)
    expect(await s.get(`chuya:llm:groq:client:c1:${day}`)).toBe(0)
  })

  it('PROT-02-C: tokens reconciled with provider usage after the call', async () => {
    const s = new InMemoryQuotaStore()
    await guard(s, {}, new FakeProvider({ ok: true, content: '{}', tokensUsed: 321 })).adapter.complete(REQ)
    expect(await s.get(k('tokens'))).toBe(321)
  })

  it('PROT-02-D: unknown usage (timeout) keeps the conservative reservation', async () => {
    const s = new InMemoryQuotaStore()
    await guard(s, {}, new FakeProvider({ ok: false, error: { code: 'LLM_TIMEOUT', message: 't' } })).adapter.complete(REQ)
    expect(await s.get(k('tokens'))).toBe(estimateTokens(REQ, 2048))
  })

  it('PROT-02-E: per-client daily quota is shared by instances; other clients unaffected', async () => {
    const s = new InMemoryQuotaStore()
    const lim = { clientDailyAnalyses: 2, clientAnalysesPerWindow: 100 }
    for (let i = 0; i < 2; i++) expect((await guard(s, lim, undefined, 'same').adapter.complete(REQ)).ok).toBe(true)
    const third = await guard(s, lim, undefined, 'same').adapter.complete(REQ)
    expect(!third.ok && third.error.code).toBe('LLM_CLIENT_LIMIT')
    expect((await guard(s, lim, undefined, 'other').adapter.complete(REQ)).ok).toBe(true)
  })

  it('PROT-02-F: instance restart — a new Upstash store instance sees the shared counters', async () => {
    const backend = new FakeUpstash()
    const first = new UpstashQuotaStore({ url: URL_, token: TOKEN, fetchImpl: backend.fetch })
    await guard(first, { dailyCallBudget: 1 }).adapter.complete(REQ)
    const afterRestart = new UpstashQuotaStore({ url: URL_, token: TOKEN, fetchImpl: backend.fetch })
    const r = await guard(afterRestart, { dailyCallBudget: 1 }).adapter.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_BUDGET_EXHAUSTED')
  })

  it('PROT-02-G: instance restart with the in-memory store LOSES counters (why production refuses it)', async () => {
    const before = new InMemoryQuotaStore()
    await guard(before, { dailyCallBudget: 1 }).adapter.complete(REQ)
    const restarted = new InMemoryQuotaStore()
    expect((await guard(restarted, { dailyCallBudget: 1 }).adapter.complete(REQ)).ok).toBe(true)
  })

  it('PROT-02-H: TTL expiry frees daily counters (fake clock)', async () => {
    let now = 0
    const s = new InMemoryQuotaStore(() => now)
    await s.reserve('x', 1, 1, 1000)
    expect((await s.reserve('x', 1, 1, 1000)).ok).toBe(false)
    now = 1001
    expect((await s.reserve('x', 1, 1, 1000)).ok).toBe(true)
  })
})

// ── Per-analysis limit, kill switch, cooldown ────────────────────────────────

describe('PROT-03: per-analysis limit, kill switch and provider errors', () => {
  it('PROT-03-A: LLM_MAX_CALLS_PER_ANALYSIS=1 → the second call of the same analysis is refused', async () => {
    const g = guard(new InMemoryQuotaStore(), { maxCallsPerAnalysis: 1 })
    expect((await g.adapter.complete(REQ)).ok).toBe(true)
    const r = await g.adapter.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_CALL_LIMIT')
    expect((g.inner as FakeProvider).calls).toBe(1)
    expect(g.adapter.callsMade).toBe(1)
  })

  it('PROT-03-B: env kill switch → LLM_DISABLED without touching the store or the provider', async () => {
    const s = new InMemoryQuotaStore()
    const spy = vi.spyOn(s, 'reserve')
    const g = guard(s, { killSwitch: true })
    const r = await g.adapter.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_DISABLED')
    expect((g.inner as FakeProvider).calls).toBe(0)
    expect(spy).not.toHaveBeenCalled()
  })

  it('PROT-03-C: shared kill-switch flag (no redeploy) disables every instance; clearing it re-enables', async () => {
    const backend = new FakeUpstash()
    const store = () => new UpstashQuotaStore({ url: URL_, token: TOKEN, fetchImpl: backend.fetch })
    await store().setFlag('chuya:llm:groq:kill', null)
    const r = await guard(store()).adapter.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_DISABLED')
    await store().clearFlag('chuya:llm:groq:kill')
    expect((await guard(store()).adapter.complete(REQ)).ok).toBe(true)
  })

  it('PROT-03-D: provider 429 → token reservation released, shared cooldown honors Retry-After', async () => {
    const s = new InMemoryQuotaStore()
    const p429 = new FakeProvider({ ok: false, error: { code: 'LLM_QUOTA_EXCEEDED', message: 'rate' } })
    p429.lastRetryAfterMs = 5000
    await guard(s, {}, p429).adapter.complete(REQ)
    expect(await s.get(k('tokens'))).toBe(0)
    const next = guard(s)
    const r = await next.adapter.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_PROVIDER_COOLDOWN')
    expect((next.inner as FakeProvider).calls).toBe(0)
  })

  it('PROT-03-E: provider 503 → cooldown; timeout → no cooldown', async () => {
    const s1 = new InMemoryQuotaStore()
    await guard(s1, {}, new FakeProvider({ ok: false, error: { code: 'LLM_PROVIDER_UNAVAILABLE', message: '503' } })).adapter.complete(REQ)
    expect(await s1.hasFlag('chuya:llm:groq:cooldown')).toBe(true)
    const s2 = new InMemoryQuotaStore()
    await guard(s2, {}, new FakeProvider({ ok: false, error: { code: 'LLM_TIMEOUT', message: 't' } })).adapter.complete(REQ)
    expect(await s2.hasFlag('chuya:llm:groq:cooldown')).toBe(false)
  })

  it('PROT-03-F: provider error result is returned unchanged (no silent stub fallback)', async () => {
    const r = await guard(new InMemoryQuotaStore(), {}, new FakeProvider({ ok: false, error: { code: 'LLM_TIMEOUT', message: 't' } })).adapter.complete(REQ)
    expect(r).toEqual({ ok: false, error: { code: 'LLM_TIMEOUT', message: 't' } })
  })
})

// ── Store errors and missing configuration: fail closed ──────────────────────

describe('PROT-04: Redis errors and missing configuration fail closed', () => {
  it.each(['network', 'http500', 'error-body', 'timeout'] as const)('PROT-04-A: store %s → QuotaStoreError without secrets', async (mode) => {
    const backend = new FakeUpstash()
    const s = new UpstashQuotaStore({ url: URL_, token: TOKEN, fetchImpl: backend.fetch })
    backend.failNext = mode
    const err = await s.reserve('k', 1, 1, 1000).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(QuotaStoreError)
    expect(String((err as Error).message)).not.toContain(TOKEN)
    expect(String((err as Error).message)).not.toContain('fake-db')
  })

  it('PROT-04-B: store failure during reservation → LLM_GUARD_UNAVAILABLE, provider not called', async () => {
    const backend = new FakeUpstash()
    const s = new UpstashQuotaStore({ url: URL_, token: TOKEN, fetchImpl: backend.fetch })
    backend.failNext = 'network'
    const g = guard(s)
    const r = await g.adapter.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_GUARD_UNAVAILABLE')
    expect((g.inner as FakeProvider).calls).toBe(0)
  })

  it('PROT-04-C: no store → LLM_GUARD_UNAVAILABLE', async () => {
    const g = guard(null)
    const r = await g.adapter.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_GUARD_UNAVAILABLE')
  })

  it('PROT-04-D: invalid / incomplete configuration is rejected explicitly', () => {
    expect(() => readLlmProtectionConfig({ LLM_QUOTA_STORE: 'upstash' })).toThrow(ProtectionConfigError)
    expect(() => readLlmProtectionConfig({ LLM_QUOTA_STORE: 'mysql' })).toThrow(ProtectionConfigError)
    expect(() => readLlmProtectionConfig({ LLM_DAILY_CALL_BUDGET: '-1' })).toThrow(ProtectionConfigError)
    expect(() => readLlmProtectionConfig({ LLM_KILL_SWITCH: 'maybe' })).toThrow(ProtectionConfigError)
    expect(readLlmProtectionConfig({ KV_REST_API_URL: URL_, KV_REST_API_TOKEN: TOKEN }).store).toBe('upstash')
  })

  it('PROT-04-E: production refuses the in-memory store for real providers (no local override)', () => {
    const c = readLlmProtectionConfig({ NODE_ENV: 'production', LLM_ALLOW_LOCAL_QUOTA: 'true' })
    expect(c.store).toBe('memory')
    expect(c.allowLocalQuotaForRealLlm).toBe(false)
  })

  it('PROT-04-F: production + groq without Upstash → guarded adapter refuses; stub keeps working', async () => {
    const headers = new Headers({ 'x-forwarded-for': '10.1.1.1' })
    const groq = createRequestProtection(headers, { NODE_ENV: 'production', LLM_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_TEST_000000000000' })
    const r = await groq.createAdapter().complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_GUARD_UNAVAILABLE')
    const stub = createRequestProtection(headers, { NODE_ENV: 'production', LLM_PROVIDER: 'stub', LLM_KILL_SWITCH: 'true' })
    expect((await stub.createAdapter().complete({ system: '[DIAGNOSIS_REQUEST]', userContent: 'x' })).ok).toBe(true)
  })

  it('PROT-04-G: groq without GROQ_API_KEY → explicit unavailable adapter, never the stub', async () => {
    const p = createRequestProtection(new Headers(), { NODE_ENV: 'test', LLM_PROVIDER: 'groq' })
    const a = p.createAdapter()
    expect(a.modelId).toBe('unavailable')
    const r = await a.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_PROVIDER_UNAVAILABLE')
  })

  it('PROT-04-H: request rate limit degrades to a per-instance limit when the shared store fails', async () => {
    const env = { NODE_ENV: 'test', LLM_QUOTA_STORE: 'none', RATE_LIMIT_PER_WINDOW: '2' }
    const headers = new Headers({ 'x-forwarded-for': '10.7.7.7' })
    const results = []
    for (let i = 0; i < 3; i++) results.push(await createRequestProtection(headers, env).checkRequestRate())
    expect(results.map((r) => r.allowed)).toEqual([true, true, false])
    expect(results.every((r) => r.degraded)).toBe(true)
  })
})

// ── Client identity and secrets ──────────────────────────────────────────────

describe('PROT-05: client identity and no secret / content exposure', () => {
  it('PROT-05-A: trusted hops pick the proxy-appended address, not the spoofable left-most one', () => {
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })
    expect(resolveClientIp(h, 'x-forwarded-for', 1)).toBe('203.0.113.9')
    expect(resolveClientIp(h, 'x-forwarded-for', 2)).toBe('1.2.3.4')
    expect(resolveClientIp(new Headers({ 'x-forwarded-for': 'not an ip' }), 'x-forwarded-for', 1)).toBeNull()
    expect(resolveClientIp(new Headers(), 'x-forwarded-for', 1)).toBeNull()
  })

  it('PROT-05-B: client keys are salted hashes; missing address → shared "anon" bucket', () => {
    const key = clientKeyFor('203.0.113.9', 'salt')
    expect(key).toMatch(/^[0-9a-f]{32}$/)
    expect(key).not.toContain('203')
    expect(clientKeyFor('203.0.113.9', 'other')).not.toBe(key)
    expect(clientKeyFor(null, 'salt')).toBe('anon')
  })

  it('PROT-05-C: store, adapter and keys never expose the token, prompt or user text', async () => {
    const backend = new FakeUpstash()
    const s = new UpstashQuotaStore({ url: URL_, token: TOKEN, fetchImpl: backend.fetch })
    expect(JSON.stringify(s)).not.toContain(TOKEN)
    const secretReq = { system: 'SYSTEM-PROMPT-XYZ', userContent: 'Mi patente ABC123 y el síntoma' }
    const g = guard(s, { maxCallsPerAnalysis: 1 })
    await g.adapter.complete(secretReq)
    await g.adapter.complete(secretReq) // refused: call_limit metric
    expect(JSON.stringify(g.adapter)).not.toContain(TOKEN)
    const everything = JSON.stringify([...backend.data.entries()].map(([key, v]) => [key, v.v instanceof Map ? [...v.v] : v.v]))
    expect(everything).not.toMatch(/SYSTEM-PROMPT|patente|ABC123|síntoma|10\.\d+\.\d+\.\d+/)
    const snap = await g.metrics.snapshot()
    expect(snap.shared).toMatchObject({ llm_calls_ok: 1, llm_rejected_call_limit: 1, llm_tokens_used: 500 })
    expect(Object.keys(snap.shared ?? {}).every((f) => /^[a-z0-9_]+$/.test(f))).toBe(true)
  })
})

// ── Incremento 6.4E: initial pilot limits ────────────────────────────────────

function clocked(store: QuotaStore, now: () => number, clientKey: string, over: Partial<LlmProtectionConfig> = {}, inner: LLMAdapter = new FakeProvider()) {
  const config = cfg(over)
  const metrics = new UsageMetrics(store, config.keyPrefix)
  return { adapter: new GuardedLLMAdapter(inner, { store, config, clientKey, provider: 'groq', metrics, now }), inner }
}

describe('PROT-06: pilot limits (6.4E)', () => {
  it('PROT-06-A: defaults are the pilot values — 3/visitor/hour, 40 analyses, 80 calls, 60k tokens, 2 per analysis, 2 concurrent', () => {
    const c = readLlmProtectionConfig({ NODE_ENV: 'production' })
    expect(c).toMatchObject({
      clientAnalysesPerWindow: 3,
      clientWindowMs: 3_600_000,
      clientDailyAnalyses: 10,
      dailyAnalysisBudget: 40,
      dailyCallBudget: 80,
      dailyTokenBudget: 60_000,
      maxCallsPerAnalysis: 2,
      maxConcurrent: 2,
    })
    expect(PILOT_LIMITS.dailyCallBudget).toBe(PILOT_LIMITS.dailyAnalysisBudget * PILOT_LIMITS.maxCallsPerAnalysis)
    expect(readLlmProtectionConfig({ LLM_CLIENT_ANALYSES_PER_WINDOW: '5', LLM_CLIENT_WINDOW_SECONDS: '600' })).toMatchObject({
      clientAnalysesPerWindow: 5,
      clientWindowMs: 600_000,
    })
    expect(() => readLlmProtectionConfig({ LLM_CLIENT_WINDOW_SECONDS: '10' })).toThrow(ProtectionConfigError)
  })

  it('PROT-06-B: 3 analyses per visitor per hour across instances; the 4th is refused (LLM_CLIENT_LIMIT) without a provider call', async () => {
    let now = Date.UTC(2026, 10, 13, 10, 0, 0)
    const s = new InMemoryQuotaStore(() => now)
    for (let i = 0; i < 3; i++) expect((await clocked(s, () => now, 'visitor').adapter.complete(REQ)).ok).toBe(true)
    const fourth = clocked(s, () => now, 'visitor')
    const r = await fourth.adapter.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_CLIENT_LIMIT')
    expect((fourth.inner as FakeProvider).calls).toBe(0)
    // Another visitor is unaffected; the same visitor is allowed again in the next hour.
    expect((await clocked(s, () => now, 'someone-else').adapter.complete(REQ)).ok).toBe(true)
    now += 3_600_000
    expect((await clocked(s, () => now, 'visitor').adapter.complete(REQ)).ok).toBe(true)
  })

  it('PROT-06-C: a single visitor cannot drain the shared budget — daily cap of 10 even across hours', async () => {
    let now = Date.UTC(2026, 10, 13, 0, 0, 0)
    const s = new InMemoryQuotaStore(() => now)
    let ok = 0
    for (let hour = 0; hour < 6; hour++, now += 3_600_000) {
      for (let i = 0; i < 3; i++) if ((await clocked(s, () => now, 'heavy').adapter.complete(REQ)).ok) ok++
    }
    expect(ok).toBe(10)
    expect(await s.get(`chuya:llm:groq:analyses:${utcDay(now)}`)).toBe(10)
  })

  it('PROT-06-D: 40 analyses per day globally; the 41st (new visitor) gets LLM_BUDGET_EXHAUSTED', async () => {
    const s = new InMemoryQuotaStore()
    const results: LLMResult[] = []
    for (let i = 0; i < 41; i++) {
      results.push(await guard(s, {}, new FakeProvider({ ok: true, content: '{}', tokensUsed: 100 }), `v${i}`).adapter.complete(REQ))
    }
    expect(results.slice(0, 40).every((r) => r.ok)).toBe(true)
    const last = results[40]!
    expect(!last.ok && last.error.code).toBe('LLM_BUDGET_EXHAUSTED')
    expect(await s.get(k('analyses'))).toBe(40)
  })

  it('PROT-06-E: two calls of one analysis count 1 analysis / 1 visitor unit and 2 calls; a 3rd call is refused', async () => {
    const s = new InMemoryQuotaStore()
    const g = guard(s, {}, new FakeProvider({ ok: true, content: '{}', tokensUsed: 200 }), 'two-step')
    expect((await g.adapter.complete(REQ)).ok).toBe(true)
    expect((await g.adapter.complete(REQ)).ok).toBe(true)
    const third = await g.adapter.complete(REQ)
    expect(!third.ok && third.error.code).toBe('LLM_CALL_LIMIT')
    expect(await s.get(k('analyses'))).toBe(1)
    expect(await s.get(`chuya:llm:groq:client:two-step:${day}`)).toBe(1)
    expect(await s.get(k('calls'))).toBe(2)
    expect(await s.get(k('tokens'))).toBe(400) // reconciled with real usage, not the reservation
  })

  it('PROT-06-F: provider 429 before generating returns the visitor and analysis units (call stays counted)', async () => {
    const s = new InMemoryQuotaStore()
    await guard(s, {}, new FakeProvider({ ok: false, error: { code: 'LLM_QUOTA_EXCEEDED', message: 'rate' } }), 'unlucky').adapter.complete(REQ)
    expect(await s.get(k('analyses'))).toBe(0)
    expect(await s.get(`chuya:llm:groq:client:unlucky:${day}`)).toBe(0)
    expect(await s.get(k('calls'))).toBe(1)
    expect(await s.get(k('tokens'))).toBe(0)
  })

  it('PROT-06-G: refusal by concurrency (busy) does not consume the visitor quota', async () => {
    const s = new InMemoryQuotaStore()
    const slow = (c: string) => guard(s, {}, new FakeProvider({ ok: true, content: '{}', tokensUsed: 10 }, 30), c)
    const results = await Promise.all(['a', 'b', 'c'].map((c) => slow(c).adapter.complete(REQ)))
    expect(results.filter((r) => !r.ok && r.error.code === 'LLM_BUSY')).toHaveLength(1)
    expect(await s.get(k('analyses'))).toBe(2)
    expect(await s.get(k('calls'))).toBe(2)
  })

  it('PROT-06-H: 60k token budget — reservations bound usage, reconciliation reflects real usage', async () => {
    const s = new InMemoryQuotaStore()
    const est = estimateTokens(REQ, 2048)
    // Real usage close to the 6.4C observation (~850 tokens per call).
    for (let i = 0; i < 20; i++) await guard(s, {}, new FakeProvider({ ok: true, content: '{}', tokensUsed: 850 }), `t${i}`).adapter.complete(REQ)
    expect(await s.get(k('tokens'))).toBe(20 * 850)
    // Fill the remaining budget so that one more reservation does not fit.
    await s.adjust(k('tokens'), 60_000 - 20 * 850 - est + 1, 60_000)
    const g = guard(s, {}, new FakeProvider(), 'late')
    const r = await g.adapter.complete(REQ)
    expect(!r.ok && r.error.code).toBe('LLM_BUDGET_EXHAUSTED')
    expect((g.inner as FakeProvider).calls).toBe(0)
    expect(await s.get(k('analyses'))).toBe(20) // the refused analysis was released
  })

  it('PROT-06-I: TrackedLLMAdapter records attempts/successes/last error and exposes no content', async () => {
    const t = new TrackedLLMAdapter(new FakeProvider({ ok: false, error: { code: 'LLM_TIMEOUT', message: 't' } }), 'real')
    await t.complete({ system: 'SYSTEM-PROMPT', userContent: 'texto del usuario' })
    expect(t.snapshot()).toEqual({ kind: 'real', attempts: 1, succeeded: 0, lastErrorCode: 'LLM_TIMEOUT' })
    expect(JSON.stringify(t)).not.toMatch(/SYSTEM-PROMPT|texto del usuario/)
  })
})
