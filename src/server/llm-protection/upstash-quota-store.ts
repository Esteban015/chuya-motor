/**
 * upstash-quota-store.ts — Distributed QuotaStore over the Upstash Redis REST API (Incremento 6.4D).
 *
 * - No SDK dependency: plain fetch to the documented REST endpoint (POST <url> with a JSON command
 *   array, "Authorization: Bearer <token>"). Works in Vercel Node and Edge runtimes.
 * - Atomicity: each multi-step operation is ONE Lua script (EVAL); Redis executes scripts
 *   atomically, so concurrent reservations from many serverless instances cannot overshoot a limit.
 * - Fail closed: any network error, timeout, non-2xx or {error} body throws QuotaStoreError. The
 *   caller (LLM guard) then refuses real LLM calls. Error messages never include the token or URL.
 *
 * Activation is pending: no Upstash database was created in 6.4D (no paid resources / approval).
 */
import { QuotaStoreError, type QuotaCheck, type QuotaIncrement, type QuotaStore, type ReserveAllResult, type ReserveResult } from './quota-store'

export const RESERVE_SCRIPT = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local amount = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
if cur + amount > limit then return {0, cur} end
local n = redis.call('INCRBY', KEYS[1], amount)
if ARGV[4] == '1' or redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
return {1, n}
`.trim()

/**
 * Multi-limit reservation (7C public pilot). ARGV layout: nChecks, then per check: nKeys, limit,
 * key indexes (into KEYS); then nIncrements, then per increment: key index, ttlMs.
 * All checks are evaluated before any write: either every counter is incremented or none.
 */
export const RESERVE_ALL_SCRIPT = `
local p = 1
local nchecks = tonumber(ARGV[p]) p = p + 1
for c = 1, nchecks do
  local n = tonumber(ARGV[p]) local limit = tonumber(ARGV[p + 1]) p = p + 2
  local sum = 0
  for i = 1, n do
    sum = sum + tonumber(redis.call('GET', KEYS[tonumber(ARGV[p])]) or '0') p = p + 1
  end
  if sum + 1 > limit then return {0, c - 1} end
end
local ninc = tonumber(ARGV[p]) p = p + 1
for i = 1, ninc do
  local k = KEYS[tonumber(ARGV[p])] local ttl = ARGV[p + 1] p = p + 2
  redis.call('INCR', k)
  if redis.call('PTTL', k) < 0 then redis.call('PEXPIRE', k, ttl) end
end
return {1, -1}
`.trim()

/** Encodes checks + increments for RESERVE_ALL_SCRIPT: [numkeys, ...keys, ...argv]. */
export function encodeReserveAll(checks: QuotaCheck[], increments: QuotaIncrement[]): Array<string | number> {
  const keys: string[] = []
  const index = (k: string) => {
    let i = keys.indexOf(k)
    if (i < 0) i = keys.push(k) - 1
    return i + 1
  }
  const argv: Array<string | number> = [checks.length]
  for (const c of checks) argv.push(c.keys.length, c.limit, ...c.keys.map(index))
  argv.push(increments.length)
  for (const inc of increments) argv.push(index(inc.key), inc.ttlMs)
  return [keys.length, ...keys, ...argv]
}

export const ADJUST_SCRIPT = `
local n = redis.call('INCRBY', KEYS[1], ARGV[1])
if n < 0 then redis.call('SET', KEYS[1], 0, 'KEEPTTL') n = 0 end
if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[2]) end
return n
`.trim()

export const METRIC_SCRIPT = `
redis.call('HINCRBY', KEYS[1], ARGV[1], ARGV[2])
if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
return 1
`.trim()

export interface UpstashQuotaStoreOptions {
  url: string
  token: string
  /** Per-command timeout. Default 1500 ms: the store must never dominate request latency. */
  timeoutMs?: number
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

type Command = Array<string | number>

export class UpstashQuotaStore implements QuotaStore {
  readonly kind = 'upstash' as const
  readonly distributed = true
  readonly #url: string
  readonly #token: string
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  constructor(opts: UpstashQuotaStoreOptions) {
    if (!opts.url || !/^https:\/\//.test(opts.url)) throw new QuotaStoreError('Upstash REST URL must be an https:// URL.')
    if (!opts.token) throw new QuotaStoreError('Upstash REST token is missing.')
    this.#url = opts.url.replace(/\/+$/, '')
    this.#token = opts.token
    this.#timeoutMs = opts.timeoutMs ?? 1500
    this.#fetch = opts.fetchImpl ?? fetch
  }

  toJSON(): Record<string, unknown> {
    return { kind: this.kind }
  }

  async #exec(command: Command): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs)
    let res: Response
    try {
      res = await this.#fetch(this.#url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        signal: controller.signal,
        cache: 'no-store',
      })
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError'
      throw new QuotaStoreError(aborted ? 'Quota store timeout.' : 'Quota store unreachable.')
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new QuotaStoreError(`Quota store HTTP ${res.status}.`)
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new QuotaStoreError('Quota store returned an invalid body.')
    }
    if (!body || typeof body !== 'object') throw new QuotaStoreError('Quota store returned an invalid body.')
    if ('error' in body) throw new QuotaStoreError('Quota store command error.')
    return (body as { result?: unknown }).result
  }

  async reserve(key: string, amount: number, limit: number, ttlMs: number, refreshTtl = false): Promise<ReserveResult> {
    const r = await this.#exec(['EVAL', RESERVE_SCRIPT, 1, key, amount, limit, ttlMs, refreshTtl ? '1' : '0'])
    if (!Array.isArray(r) || r.length !== 2) throw new QuotaStoreError('Unexpected reserve result.')
    return { ok: Number(r[0]) === 1, current: Number(r[1]) }
  }

  async reserveAll(checks: QuotaCheck[], increments: QuotaIncrement[]): Promise<ReserveAllResult> {
    const r = await this.#exec(['EVAL', RESERVE_ALL_SCRIPT, ...encodeReserveAll(checks, increments)])
    if (!Array.isArray(r) || r.length !== 2) throw new QuotaStoreError('Unexpected reserve result.')
    return Number(r[0]) === 1 ? { ok: true } : { ok: false, failed: Number(r[1]) }
  }

  async adjust(key: string, delta: number, ttlMs: number): Promise<number> {
    return Number(await this.#exec(['EVAL', ADJUST_SCRIPT, 1, key, Math.trunc(delta), ttlMs]))
  }

  async get(key: string): Promise<number> {
    const r = await this.#exec(['GET', key])
    return r === null || r === undefined ? 0 : Number(r)
  }

  async setFlag(key: string, ttlMs: number | null): Promise<void> {
    await this.#exec(ttlMs === null ? ['SET', key, '1'] : ['SET', key, '1', 'PX', ttlMs])
  }

  async clearFlag(key: string): Promise<void> {
    await this.#exec(['DEL', key])
  }

  async hasFlag(key: string): Promise<boolean> {
    return Number(await this.#exec(['EXISTS', key])) > 0
  }

  async incrementMetric(key: string, field: string, by: number, ttlMs: number): Promise<void> {
    await this.#exec(['EVAL', METRIC_SCRIPT, 1, key, field, by, ttlMs])
  }

  async readMetrics(key: string): Promise<Record<string, number>> {
    const r = await this.#exec(['HGETALL', key])
    const out: Record<string, number> = {}
    if (Array.isArray(r)) for (let i = 0; i + 1 < r.length; i += 2) out[String(r[i])] = Number(r[i + 1])
    else if (r && typeof r === 'object') for (const [k, v] of Object.entries(r)) out[k] = Number(v)
    return out
  }
}
