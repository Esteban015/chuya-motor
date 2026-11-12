/**
 * guarded-llm-adapter.ts — Distributed protection around a REAL LLM adapter (Incremento 6.4D).
 *
 * One instance per user request. Before each provider call, in this order:
 *   1. kill switch (env LLM_KILL_SWITCH, then shared store flags global / per provider)
 *   2. shared provider cooldown (set after a 429 / 5xx from the provider)
 *   3. per-analysis call limit (LLM_MAX_CALLS_PER_ANALYSIS)
 *   4. atomic reservations in the shared store. First call of the analysis only (6.4E): visitor
 *      window (3/hour), visitor day, global daily analyses. Every call: global daily calls, global
 *      daily tokens (estimate = prompt chars / 3 + max output tokens), global concurrency.
 *      A failed reservation releases the ones already taken.
 * After the call: concurrency released; tokens reconciled with the provider's usage when known
 * (kept as reserved when unknown, e.g. timeout); token reservation released when the provider
 * rejected before generating (429 / 401 / 403 / 404 / 5xx), and then also the analysis-level
 * reservations if no call of this analysis generated anything; cooldown set on 429 / 5xx.
 *
 * Fails CLOSED: missing / non-distributed (production) / failing store → no provider call.
 * Never falls back to the stub. Never logs prompts, user text, budgets or credentials: only
 * structural metric counters (usage-metrics.ts).
 */
import type { LLMAdapter, LLMCompletionRequest, LLMError, LLMResult } from '@/agents/llm/llm-adapter'
import type { LlmProtectionConfig } from './protection-config'
import type { QuotaStore } from './quota-store'
import { UsageMetrics, metricField, utcDay } from './usage-metrics'

const DAY_TTL_MS = 48 * 60 * 60 * 1000
const MAX_COOLDOWN_MS = 10 * 60 * 1000

export type GuardRejectionReason =
  | 'visitor_limit'
  | 'analysis_budget'
  | 'kill_switch'
  | 'cooldown'
  | 'call_limit'
  | 'client_quota'
  | 'call_budget'
  | 'token_budget'
  | 'busy'
  | 'store_unavailable'

const REJECTION_CODE: Record<GuardRejectionReason, LLMError['code']> = {
  visitor_limit: 'LLM_CLIENT_LIMIT',
  analysis_budget: 'LLM_BUDGET_EXHAUSTED',
  kill_switch: 'LLM_DISABLED',
  cooldown: 'LLM_PROVIDER_COOLDOWN',
  call_limit: 'LLM_CALL_LIMIT',
  client_quota: 'LLM_CLIENT_LIMIT',
  call_budget: 'LLM_BUDGET_EXHAUSTED',
  token_budget: 'LLM_BUDGET_EXHAUSTED',
  busy: 'LLM_BUSY',
  store_unavailable: 'LLM_GUARD_UNAVAILABLE',
}

/** Provider errors that happen before generation: no tokens consumed → release the token reservation. */
const NO_GENERATION_CODES = new Set<LLMError['code']>([
  'LLM_QUOTA_EXCEEDED',
  'LLM_AUTH_ERROR',
  'LLM_MODEL_UNAVAILABLE',
  'LLM_PROVIDER_UNAVAILABLE',
])

export interface GuardedLLMAdapterDeps {
  /** Shared store, or null when unavailable (→ every call is refused). */
  store: QuotaStore | null
  config: LlmProtectionConfig
  /** Hashed client id (client-identity.ts). */
  clientKey: string
  /** Provider name for keys/metrics (e.g. "groq"). */
  provider: string
  metrics: UsageMetrics
  now?: () => number
}

interface Reservation {
  key: string
  amount: number
}

type Step = [GuardRejectionReason, string, number, number, number, boolean]

export function estimateTokens(req: LLMCompletionRequest, maxOutputTokens: number): number {
  return Math.ceil((req.system.length + req.userContent.length) / 3) + (req.maxTokens ?? maxOutputTokens)
}

export class GuardedLLMAdapter implements LLMAdapter {
  readonly #inner: LLMAdapter
  readonly #deps: GuardedLLMAdapterDeps
  readonly #now: () => number
  #calls = 0
  #generated = 0
  /** Analysis-level reservations (visitor + global analyses), taken on the first call only. */
  #analysisReservations: Reservation[] | null = null

  constructor(inner: LLMAdapter, deps: GuardedLLMAdapterDeps) {
    this.#inner = inner
    this.#deps = deps
    this.#now = deps.now ?? Date.now
  }

  get modelId(): string {
    return this.#inner.modelId
  }

  /** Provider calls actually attempted through this instance. */
  get callsMade(): number {
    return this.#calls
  }

  toJSON(): Record<string, unknown> {
    return { guarded: true, provider: this.#deps.provider, modelId: this.#inner.modelId }
  }

  #keys() {
    const { keyPrefix } = this.#deps.config
    const p = this.#deps.provider
    const day = utcDay(this.#now())
    return {
      killGlobal: `${keyPrefix}:llm:kill`,
      killProvider: `${keyPrefix}:llm:${p}:kill`,
      cooldown: `${keyPrefix}:llm:${p}:cooldown`,
      clientWindow: `${keyPrefix}:llm:${p}:clientw:${this.#deps.clientKey}:${Math.floor(this.#now() / this.#deps.config.clientWindowMs)}`,
      client: `${keyPrefix}:llm:${p}:client:${this.#deps.clientKey}:${day}`,
      analyses: `${keyPrefix}:llm:${p}:analyses:${day}`,
      calls: `${keyPrefix}:llm:${p}:calls:${day}`,
      tokens: `${keyPrefix}:llm:${p}:tokens:${day}`,
      inflight: `${keyPrefix}:llm:${p}:inflight`,
    }
  }

  async #reject(reason: GuardRejectionReason): Promise<LLMResult> {
    await this.#deps.metrics.record(metricField('llm_rejected', reason))
    return { ok: false, error: { code: REJECTION_CODE[reason], message: `LLM call refused by protection layer (${reason}).` } }
  }

  async #release(store: QuotaStore, taken: Reservation[]): Promise<void> {
    for (const r of [...taken].reverse()) {
      try {
        await store.adjust(r.key, -r.amount, DAY_TTL_MS)
      } catch {
        await this.#deps.metrics.record('guard_release_errors')
      }
    }
  }

  async complete(req: LLMCompletionRequest): Promise<LLMResult> {
    const { config, store, metrics } = this.#deps
    if (config.killSwitch) return this.#reject('kill_switch')
    if (!store) return this.#reject('store_unavailable')

    const k = this.#keys()
    const estimate = estimateTokens(req, config.estimatedMaxOutputTokens)
    const taken: Reservation[] = []

    try {
      if ((await store.hasFlag(k.killGlobal)) || (await store.hasFlag(k.killProvider))) return this.#reject('kill_switch')
      if (await store.hasFlag(k.cooldown)) return this.#reject('cooldown')
      if (this.#calls >= config.maxCallsPerAnalysis) return this.#reject('call_limit')

      const firstOfAnalysis = this.#analysisReservations === null
      const analysisSteps: Step[] = firstOfAnalysis
        ? [
            ['visitor_limit', k.clientWindow, 1, config.clientAnalysesPerWindow, config.clientWindowMs, false],
            ['client_quota', k.client, 1, config.clientDailyAnalyses, DAY_TTL_MS, false],
            ['analysis_budget', k.analyses, 1, config.dailyAnalysisBudget, DAY_TTL_MS, false],
          ]
        : []
      const steps: Step[] = [
        ...analysisSteps,
        ['call_budget', k.calls, 1, config.dailyCallBudget, DAY_TTL_MS, false],
        ['token_budget', k.tokens, estimate, config.dailyTokenBudget, DAY_TTL_MS, false],
        ['busy', k.inflight, 1, config.maxConcurrent, config.concurrencyTtlMs, true],
      ]
      for (const [reason, key, amount, limit, ttl, refresh] of steps) {
        const r = await store.reserve(key, amount, limit, ttl, refresh)
        if (!r.ok) {
          await this.#release(store, taken)
          return this.#reject(reason)
        }
        taken.push({ key, amount })
      }
      if (firstOfAnalysis) this.#analysisReservations = taken.slice(0, analysisSteps.length)
    } catch {
      await this.#release(store, taken).catch(() => undefined)
      return this.#reject('store_unavailable')
    }

    this.#calls++
    let result: LLMResult
    try {
      result = await this.#inner.complete(req)
    } catch {
      result = { ok: false, error: { code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Unexpected provider adapter error.' } }
    }

    // Post-call bookkeeping is best-effort: the call already happened, never mask its result.
    await this.#safe(() => store.adjust(k.inflight, -1, config.concurrencyTtlMs))
    if (result.ok) {
      this.#generated++
      await metrics.record('llm_calls_ok')
      if (result.tokensUsed !== undefined) {
        await this.#safe(() => store.adjust(k.tokens, result.tokensUsed! - estimate, DAY_TTL_MS))
        await metrics.record('llm_tokens_used', result.tokensUsed)
      } else {
        await metrics.record('llm_tokens_unreconciled', estimate)
      }
      return result
    }

    const code = result.error.code
    await metrics.record(metricField('llm_error', code))
    if (NO_GENERATION_CODES.has(code)) {
      await this.#safe(() => store.adjust(k.tokens, -estimate, DAY_TTL_MS))
      // Nothing was generated for this analysis: give the visitor and the shared analysis budget
      // their unit back (the provider call itself stays counted in the daily call budget).
      if (this.#generated === 0 && this.#analysisReservations) {
        const analysis = this.#analysisReservations
        this.#analysisReservations = null
        await this.#safe(() => this.#release(store, analysis))
      }
    } else await metrics.record('llm_tokens_unreconciled', estimate)

    const cooldown = this.#cooldownFor(code)
    if (cooldown !== null) await this.#safe(() => store.setFlag(k.cooldown, cooldown))
    return result
  }

  #cooldownFor(code: LLMError['code']): number | null {
    const { config } = this.#deps
    if (code === 'LLM_QUOTA_EXCEEDED') {
      const hinted = (this.#inner as { lastRetryAfterMs?: number | null }).lastRetryAfterMs
      const ms = typeof hinted === 'number' && hinted > 0 ? hinted : config.cooldownMsOn429
      return Math.min(Math.max(ms, 1000), MAX_COOLDOWN_MS)
    }
    if (code === 'LLM_PROVIDER_UNAVAILABLE') return config.cooldownMsOn5xx
    return null
  }

  async #safe(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch {
      await this.#deps.metrics.record('guard_bookkeeping_errors')
    }
  }
}

/** Explicit "provider unavailable" adapter (misconfiguration). Never substitutes the stub. */
export class UnavailableLLMAdapter implements LLMAdapter {
  readonly modelId = 'unavailable'
  constructor(private readonly code: LLMError['code'] = 'LLM_PROVIDER_UNAVAILABLE') {}
  async complete(): Promise<LLMResult> {
    return { ok: false, error: { code: this.code, message: 'LLM provider is not available (configuration).' } }
  }
}
