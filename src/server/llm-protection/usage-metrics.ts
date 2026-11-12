/**
 * usage-metrics.ts — Aggregated, content-free usage metrics (Incremento 6.4D).
 *
 * Only counters per UTC day: request totals, rate-limit rejections, LLM calls by outcome code,
 * guard rejections by reason, tokens used/reserved. Never prompts, symptoms, budgets, IPs or keys.
 * Recording is best-effort and never fails a request; store failures are counted locally.
 */
import type { QuotaStore } from './quota-store'

export const METRICS_TTL_MS = 8 * 24 * 60 * 60 * 1000 // keep one week of daily buckets

const FIELD = /^[a-z0-9_]{1,64}$/

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export class UsageMetrics {
  readonly #store: QuotaStore | null
  readonly #prefix: string
  readonly #now: () => number
  readonly #local = new Map<string, number>()

  constructor(store: QuotaStore | null, prefix: string, now: () => number = Date.now) {
    this.#store = store
    this.#prefix = prefix
    this.#now = now
  }

  #key(): string {
    return `${this.#prefix}:metrics:${utcDay(this.#now())}`
  }

  #bumpLocal(field: string, by: number): void {
    this.#local.set(field, (this.#local.get(field) ?? 0) + by)
  }

  /** Never throws. Unknown/invalid field names are recorded as "invalid_field". */
  async record(field: string, by = 1): Promise<void> {
    const f = FIELD.test(field) ? field : 'invalid_field'
    this.#bumpLocal(f, by)
    if (!this.#store) return
    try {
      await this.#store.incrementMetric(this.#key(), f, by, METRICS_TTL_MS)
    } catch {
      this.#bumpLocal('metrics_store_errors', 1)
    }
  }

  /** Process-local counters (this instance only) and the shared daily counters when available. */
  async snapshot(): Promise<{ day: string; shared: Record<string, number> | null; local: Record<string, number> }> {
    let shared: Record<string, number> | null = null
    if (this.#store) {
      try {
        shared = await this.#store.readMetrics(this.#key())
      } catch {
        shared = null
      }
    }
    return { day: utcDay(this.#now()), shared, local: Object.fromEntries(this.#local) }
  }
}

/** Lower-case, metric-safe version of an error/reason code. */
export function metricField(prefix: string, code: string): string {
  return `${prefix}_${code.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`.slice(0, 64)
}
