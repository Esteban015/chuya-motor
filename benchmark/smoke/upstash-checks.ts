/**
 * upstash-checks.ts — Integration checks of the distributed LLM protection layer (Incremento 6.4E).
 *
 * Library used by upstash-integration.ts (real Upstash, opt-in) and by upstash-checks.test.ts
 * (FakeUpstash, offline). The LLM provider is always a local fake: zero Groq / Gemini calls.
 *
 * Every key uses the caller's unique prefix and a TTL. cleanup() deletes ONLY keys matching
 * that prefix (SCAN MATCH <prefix>:*). Nothing else is read, written or deleted.
 */
import type { LLMAdapter, LLMResult } from '../../src/agents/llm/llm-adapter'
import { UpstashQuotaStore } from '../../src/server/llm-protection/upstash-quota-store'
import { QuotaStoreError } from '../../src/server/llm-protection/quota-store'
import { GuardedLLMAdapter } from '../../src/server/llm-protection/guarded-llm-adapter'
import { readLlmProtectionConfig, type LlmProtectionConfig } from '../../src/server/llm-protection/protection-config'
import { UsageMetrics, utcDay } from '../../src/server/llm-protection/usage-metrics'

const REQ = { system: 'S'.repeat(300), userContent: 'U'.repeat(300) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class FakeProvider implements LLMAdapter {
  readonly modelId = 'fake-provider'
  calls = 0
  constructor(
    private readonly result: LLMResult = { ok: true, content: '{}', tokensUsed: 100 },
    private readonly delayMs = 0,
  ) {}
  async complete(): Promise<LLMResult> {
    this.calls++
    if (this.delayMs) await sleep(this.delayMs)
    return this.result
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message)
}

export interface UpstashCheckOptions {
  url: string
  token: string
  /** Unique per-run key prefix, e.g. it6e-<random>. Must match /^[a-z0-9_-]{1,32}$/i. */
  prefix: string
  /** Injectable for offline tests (FakeUpstash). Defaults to the global fetch. */
  fetchImpl?: typeof fetch
  log?: (line: string) => void
}

export interface UpstashCheckReport {
  results: Array<{ name: string; ok: boolean; detail?: string }>
  passed: number
  failed: number
  deletedKeys: number
  providerCalls: 0
}

export async function runUpstashChecks(opts: UpstashCheckOptions): Promise<UpstashCheckReport> {
  const { url, token, prefix } = opts
  if (!/^[a-z0-9_-]{1,32}$/i.test(prefix)) throw new Error('Invalid prefix.')
  const baseFetch = opts.fetchImpl ?? fetch
  const log = opts.log ?? (() => undefined)

  const store = (over: { token?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}) =>
    new UpstashQuotaStore({ url, token: over.token ?? token, timeoutMs: over.timeoutMs, fetchImpl: over.fetchImpl ?? baseFetch })
  const base: LlmProtectionConfig = { ...readLlmProtectionConfig({ NODE_ENV: 'test' }), keyPrefix: prefix }
  const guard = (over: Partial<LlmProtectionConfig>, inner: LLMAdapter, clientKey: string, s = store()) =>
    new GuardedLLMAdapter(inner, { store: s, config: { ...base, ...over }, clientKey, provider: 'groq', metrics: new UsageMetrics(s, prefix) })
  const day = utcDay(Date.now())
  const key = (s: string) => `${prefix}:llm:groq:${s}:${day}`

  const checks: Array<[string, () => Promise<void>]> = [
    [
      'Atomic reservations: 50 concurrent from 2 instances against limit 10 → exactly 10',
      async () => {
        const a = store()
        const b = store()
        const r = await Promise.all(Array.from({ length: 50 }, (_, i) => (i % 2 ? a : b).reserve(`${prefix}:atomic`, 1, 10, 120_000)))
        assert(r.filter((x) => x.ok).length === 10, `ok=${r.filter((x) => x.ok).length}`)
        assert((await a.get(`${prefix}:atomic`)) === 10, 'counter != 10')
      },
    ],
    [
      'Shared quota: global analysis budget 3 across 5 instances → 3 ok, 2 LLM_BUDGET_EXHAUSTED',
      async () => {
        const r = await Promise.all(
          Array.from({ length: 5 }, (_, i) => guard({ dailyAnalysisBudget: 3, maxConcurrent: 10 }, new FakeProvider(), `c${i}`).complete(REQ)),
        )
        assert(r.filter((x) => x.ok).length === 3, `ok=${r.filter((x) => x.ok).length}`)
        assert(r.filter((x) => !x.ok && x.error.code === 'LLM_BUDGET_EXHAUSTED').length === 2, 'expected 2 exhausted')
        assert((await store().get(key('analyses'))) === 3, 'analyses != 3')
      },
    ],
    [
      'Visitor limit: 3 per window for the same visitor from different instances; the 4th is refused',
      async () => {
        const results: LLMResult[] = []
        for (let i = 0; i < 4; i++) results.push(await guard({}, new FakeProvider(), 'same-visitor').complete(REQ))
        assert(results.slice(0, 3).every((x) => x.ok), 'first 3 should pass')
        const last = results[3]!
        assert(!last.ok && last.error.code === 'LLM_CLIENT_LIMIT', '4th should be LLM_CLIENT_LIMIT')
      },
    ],
    [
      'Concurrency: max 2 in flight (slow provider) → 2 ok, 2 LLM_BUSY, semaphore back to 0',
      async () => {
        const r = await Promise.all(
          Array.from({ length: 4 }, (_, i) =>
            guard({ maxConcurrent: 2 }, new FakeProvider({ ok: true, content: '{}', tokensUsed: 10 }, 1500), `slow${i}`).complete(REQ),
          ),
        )
        assert(r.filter((x) => x.ok).length === 2, `ok=${r.filter((x) => x.ok).length}`)
        assert(r.filter((x) => !x.ok && x.error.code === 'LLM_BUSY').length === 2, 'expected 2 busy')
        assert((await store().get(`${prefix}:llm:groq:inflight`)) === 0, 'inflight != 0')
      },
    ],
    [
      'Token reconciliation: reservation replaced by the real usage after the call',
      async () => {
        const before = await store().get(key('tokens'))
        assert((await guard({}, new FakeProvider({ ok: true, content: '{}', tokensUsed: 777 }), 'tokens').complete(REQ)).ok, 'call')
        assert((await store().get(key('tokens'))) - before === 777, 'token counter not reconciled')
      },
    ],
    [
      'Window expiry: TTL frees a full counter',
      async () => {
        const s = store()
        assert((await s.reserve(`${prefix}:ttl`, 1, 1, 1500)).ok, 'first reserve')
        assert(!(await s.reserve(`${prefix}:ttl`, 1, 1, 1500)).ok, 'second should be refused')
        await sleep(2200)
        assert((await s.reserve(`${prefix}:ttl`, 1, 1, 1500)).ok, 'should pass after expiry')
      },
    ],
    [
      'Release on provider 429: analysis and tokens returned, shared cooldown set and honored',
      async () => {
        const analyses = await store().get(key('analyses'))
        const tokens = await store().get(key('tokens'))
        const r = await guard({}, new FakeProvider({ ok: false, error: { code: 'LLM_QUOTA_EXCEEDED', message: 'rate' } }), 'rate-limited').complete(REQ)
        assert(!r.ok, 'should fail')
        assert((await store().get(key('analyses'))) === analyses, 'analysis not released')
        assert((await store().get(key('tokens'))) === tokens, 'tokens not released')
        assert(await store().hasFlag(`${prefix}:llm:groq:cooldown`), 'cooldown not set')
        const next = new FakeProvider()
        const r2 = await guard({}, next, 'after-cooldown').complete(REQ)
        assert(!r2.ok && r2.error.code === 'LLM_PROVIDER_COOLDOWN' && next.calls === 0, 'cooldown not honored')
        await store().clearFlag(`${prefix}:llm:groq:cooldown`)
      },
    ],
    [
      'Kill switch flag (no redeploy): LLM_DISABLED, provider not called; cleared → works',
      async () => {
        await store().setFlag(`${prefix}:llm:kill`, 120_000)
        const p = new FakeProvider()
        const r = await guard({}, p, 'kill-1').complete(REQ)
        assert(!r.ok && r.error.code === 'LLM_DISABLED' && p.calls === 0, 'kill switch not honored')
        await store().clearFlag(`${prefix}:llm:kill`)
        assert((await guard({}, new FakeProvider(), 'kill-2').complete(REQ)).ok, 'should work after clearing')
      },
    ],
    [
      'Network failure (timeout): redacted QuotaStoreError; guard fails closed (LLM_GUARD_UNAVAILABLE)',
      async () => {
        const slowFetch: typeof fetch = async (u, i) => {
          await sleep(20)
          return baseFetch(u, i)
        }
        const slow = store({ timeoutMs: 1, fetchImpl: slowFetch })
        let threw = false
        try {
          await slow.get(`${prefix}:timeout`)
        } catch (e) {
          threw = e instanceof QuotaStoreError && !(e as Error).message.includes(token)
        }
        assert(threw, 'timeout should throw a redacted QuotaStoreError')
        const p = new FakeProvider()
        const r = await guard({}, p, 'net', slow).complete(REQ)
        assert(!r.ok && r.error.code === 'LLM_GUARD_UNAVAILABLE' && p.calls === 0, 'should fail closed')
      },
    ],
    [
      'Wrong credentials (HTTP 401): fail closed, token not in the result',
      async () => {
        const bad = store({ token: 'invalid-token-for-integration-test' })
        const p = new FakeProvider()
        const r = await guard({}, p, 'badauth', bad).complete(REQ)
        assert(!r.ok && r.error.code === 'LLM_GUARD_UNAVAILABLE' && p.calls === 0, 'should fail closed')
        assert(!JSON.stringify(r).includes(token), 'token leaked')
      },
    ],
  ]

  const results: UpstashCheckReport['results'] = []
  let deletedKeys = 0
  try {
    for (const [name, run] of checks) {
      try {
        await run()
        results.push({ name, ok: true })
        log(`PASS  ${name}`)
      } catch (e) {
        results.push({ name, ok: false, detail: (e as Error).message })
        log(`FAIL  ${name} — ${(e as Error).message}`)
      }
    }
  } finally {
    deletedKeys = await cleanup(url, token, prefix, baseFetch)
  }
  const failed = results.filter((r) => !r.ok).length
  return { results, passed: results.length - failed, failed, deletedKeys, providerCalls: 0 }
}

/** Deletes ONLY keys with this run's unique prefix. Returns the number of deleted keys. */
export async function cleanup(url: string, token: string, prefix: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const exec = async (cmd: Array<string | number>) => {
    const res = await fetchImpl(url.replace(/\/+$/, ''), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    })
    if (!res.ok) throw new Error('cleanup failed')
    return ((await res.json()) as { result?: unknown }).result
  }
  let cursor = '0'
  let deleted = 0
  do {
    const r = (await exec(['SCAN', cursor, 'MATCH', `${prefix}:*`, 'COUNT', 200])) as [string, string[]]
    cursor = String(r[0])
    const keys = r[1].filter((k) => k.startsWith(`${prefix}:`))
    if (keys.length) deleted += Number(await exec(['DEL', ...keys]))
  } while (cursor !== '0')
  return deleted
}
