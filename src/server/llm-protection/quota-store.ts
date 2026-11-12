/**
 * quota-store.ts — Atomic counter store used by the LLM protection layer (Incremento 6.4D, Fase 3).
 *
 * Every operation is atomic on the backing store:
 *   - UpstashQuotaStore: one Redis Lua script per operation (Redis runs scripts atomically), so
 *     reservations are shared and consistent across Vercel serverless instances and restarts.
 *   - InMemoryQuotaStore: single-process only (tests / local development). JavaScript runs each
 *     operation to completion without awaiting in the middle, so it is atomic WITHIN one process,
 *     but it is NOT distributed: production with a real LLM refuses it (fail closed).
 *
 * Keys never contain user text: only fixed prefixes, UTC day buckets and hashed client ids.
 */

export class QuotaStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuotaStoreError'
  }
}

export interface ReserveResult {
  ok: boolean
  /** Counter value after the operation (unchanged when ok=false). */
  current: number
}

export interface QuotaStore {
  readonly kind: 'memory' | 'upstash'
  /** True only when the counters are shared across instances (required in production). */
  readonly distributed: boolean
  /**
   * Atomically adds `amount` only if `current + amount <= limit`. Sets the TTL when the key has none,
   * or always when `refreshTtl` is true (semaphores: bounds leaks from crashed instances).
   */
  reserve(key: string, amount: number, limit: number, ttlMs: number, refreshTtl?: boolean): Promise<ReserveResult>
  /** Atomically adds `delta` (may be negative); the stored value never goes below 0. */
  adjust(key: string, delta: number, ttlMs: number): Promise<number>
  get(key: string): Promise<number>
  /** Sets a flag; ttlMs=null keeps it until cleared. */
  setFlag(key: string, ttlMs: number | null): Promise<void>
  clearFlag(key: string): Promise<void>
  hasFlag(key: string): Promise<boolean>
  /** Atomically increments an aggregated metric field (hash). */
  incrementMetric(key: string, field: string, by: number, ttlMs: number): Promise<void>
  readMetrics(key: string): Promise<Record<string, number>>
}

// ── In-memory (single process) ───────────────────────────────────────────────

interface Entry {
  value: number
  expiresAt: number | null
}

export class InMemoryQuotaStore implements QuotaStore {
  readonly kind = 'memory' as const
  readonly distributed = false
  readonly #entries = new Map<string, Entry>()
  readonly #hashes = new Map<string, { fields: Map<string, number>; expiresAt: number | null }>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  #live(key: string): Entry | undefined {
    const e = this.#entries.get(key)
    if (e && e.expiresAt !== null && e.expiresAt <= this.#now()) {
      this.#entries.delete(key)
      return undefined
    }
    return e
  }

  async reserve(key: string, amount: number, limit: number, ttlMs: number, refreshTtl = false): Promise<ReserveResult> {
    const e = this.#live(key)
    const current = e?.value ?? 0
    if (current + amount > limit) return { ok: false, current }
    const expiresAt = !e || e.expiresAt === null || refreshTtl ? this.#now() + ttlMs : e.expiresAt
    this.#entries.set(key, { value: current + amount, expiresAt })
    return { ok: true, current: current + amount }
  }

  async adjust(key: string, delta: number, ttlMs: number): Promise<number> {
    const e = this.#live(key)
    const value = Math.max(0, (e?.value ?? 0) + delta)
    this.#entries.set(key, { value, expiresAt: e?.expiresAt ?? this.#now() + ttlMs })
    return value
  }

  async get(key: string): Promise<number> {
    return this.#live(key)?.value ?? 0
  }

  async setFlag(key: string, ttlMs: number | null): Promise<void> {
    this.#entries.set(key, { value: 1, expiresAt: ttlMs === null ? null : this.#now() + ttlMs })
  }

  async clearFlag(key: string): Promise<void> {
    this.#entries.delete(key)
  }

  async hasFlag(key: string): Promise<boolean> {
    return this.#live(key) !== undefined
  }

  async incrementMetric(key: string, field: string, by: number, ttlMs: number): Promise<void> {
    let h = this.#hashes.get(key)
    if (!h || (h.expiresAt !== null && h.expiresAt <= this.#now())) {
      h = { fields: new Map(), expiresAt: this.#now() + ttlMs }
      this.#hashes.set(key, h)
    }
    h.fields.set(field, (h.fields.get(field) ?? 0) + by)
  }

  async readMetrics(key: string): Promise<Record<string, number>> {
    const h = this.#hashes.get(key)
    if (!h || (h.expiresAt !== null && h.expiresAt <= this.#now())) return {}
    return Object.fromEntries(h.fields)
  }
}
