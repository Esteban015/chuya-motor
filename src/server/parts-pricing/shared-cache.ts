/**
 * shared-cache.ts — Result cache shared across serverless instances (Incremento 7C). SERVER ONLY.
 *
 * - UpstashPricingCache: plain REST (GET / SET PX) to the same Upstash database used by the LLM
 *   protection layer. Keys contain only a fixed prefix and a SHA-256 of provider + query (never the
 *   part text itself). Values are the validated provider result (no diagnostics, no API key).
 * - MemoryPricingCache: single process (tests / local development).
 * - Any cache error is swallowed by the caller: the cache can never block or break a request; it
 *   only avoids repeated (billed) searches.
 */
import { createHash } from 'node:crypto'
import type { ProviderResult } from './types'

if (typeof window !== 'undefined') throw new Error('parts-pricing is server-only')

export interface PricingCache {
  readonly distributed: boolean
  get(key: string): Promise<ProviderResult | null>
  set(key: string, value: ProviderResult, ttlMs: number): Promise<void>
}

export function pricingCacheKey(prefix: string, provider: string, query: string): string {
  const h = createHash('sha256').update(`${provider}|${query.toLowerCase()}`).digest('hex').slice(0, 40)
  return `${prefix}:pp:cache:${h}`
}

/** Only fields that are safe and needed are cached (diagnostics are dropped). */
function cacheable(r: ProviderResult): ProviderResult {
  return { status: r.status, offers: r.offers, droppedInvalid: r.droppedInvalid, latencyMs: r.latencyMs }
}

function parseCached(raw: unknown): ProviderResult | null {
  if (typeof raw !== 'string') return null
  try {
    const v = JSON.parse(raw) as ProviderResult
    return v && (v.status === 'ok' || v.status === 'no_results') && Array.isArray(v.offers) ? v : null
  } catch {
    return null
  }
}

export class MemoryPricingCache implements PricingCache {
  readonly distributed = false
  readonly #entries = new Map<string, { value: string; expiresAt: number }>()
  readonly #now: () => number
  readonly #max: number

  constructor(now: () => number = Date.now, max = 500) {
    this.#now = now
    this.#max = max
  }

  async get(key: string): Promise<ProviderResult | null> {
    const e = this.#entries.get(key)
    if (!e) return null
    if (e.expiresAt <= this.#now()) {
      this.#entries.delete(key)
      return null
    }
    return parseCached(e.value)
  }

  async set(key: string, value: ProviderResult, ttlMs: number): Promise<void> {
    if (this.#entries.size >= this.#max) this.#entries.delete(this.#entries.keys().next().value as string)
    this.#entries.set(key, { value: JSON.stringify(cacheable(value)), expiresAt: this.#now() + ttlMs })
  }
}

export class UpstashPricingCache implements PricingCache {
  readonly distributed = true
  readonly #url: string
  readonly #token: string
  readonly #fetch: typeof fetch
  readonly #timeoutMs: number

  constructor(opts: { url: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
    if (!/^https:\/\//.test(opts.url) || !opts.token) throw new Error('Invalid Upstash configuration.')
    this.#url = opts.url.replace(/\/+$/, '')
    this.#token = opts.token
    this.#fetch = opts.fetchImpl ?? fetch
    this.#timeoutMs = opts.timeoutMs ?? 1000
  }

  toJSON(): Record<string, unknown> {
    return { kind: 'upstash-pricing-cache' }
  }

  async #exec(command: Array<string | number>): Promise<unknown> {
    const res = await this.#fetch(this.#url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(this.#timeoutMs),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`cache HTTP ${res.status}`)
    const body = (await res.json()) as { result?: unknown; error?: unknown }
    if (!body || typeof body !== 'object' || 'error' in body) throw new Error('cache command error')
    return body.result
  }

  async get(key: string): Promise<ProviderResult | null> {
    return parseCached(await this.#exec(['GET', key]))
  }

  async set(key: string, value: ProviderResult, ttlMs: number): Promise<void> {
    await this.#exec(['SET', key, JSON.stringify(cacheable(value)), 'PX', ttlMs])
  }
}
