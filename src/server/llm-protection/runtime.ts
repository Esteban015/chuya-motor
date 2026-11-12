/**
 * runtime.ts — Per-process wiring of the LLM protection layer for POST /api/analyze (6.4D).
 *
 * - Configuration is read on every request (cheap; follows env changes in tests/dev).
 * - Store instances are memoized per process. The in-memory store keeps counters for this
 *   instance only; a separate local store is the degraded fallback for the request rate limit.
 * - Stub provider: never guarded and never blocked by the LLM kill switch or budgets (no cost);
 *   it stays operational when Groq is disabled.
 * - Real provider (groq, gemini, anthropic): ALWAYS wrapped in GuardedLLMAdapter. In production the
 *   store must be distributed (Upstash); otherwise every real call is refused (fail closed).
 */
import { createLLMAdapter } from '@/agents/llm/llm-adapter-factory'
import type { LLMAdapter } from '@/agents/llm/llm-adapter'
import { InMemoryQuotaStore, type QuotaStore } from './quota-store'
import { UpstashQuotaStore } from './upstash-quota-store'
import { readLlmProtectionConfig, type LlmProtectionConfig } from './protection-config'
import { GuardedLLMAdapter, UnavailableLLMAdapter } from './guarded-llm-adapter'
import { UsageMetrics } from './usage-metrics'
import { clientKeyFor, resolveClientIp } from './client-identity'
import { TrackedLLMAdapter, type ProcessingSnapshot } from './processing-tracker'

let memoryStore: InMemoryQuotaStore | null = null
let localFallbackStore: InMemoryQuotaStore | null = null
let upstash: { signature: string; store: UpstashQuotaStore } | null = null

/** Test helper: drop memoized stores (counters) between test files or scenarios. */
export function resetLlmProtectionRuntimeForTests(): void {
  memoryStore = null
  localFallbackStore = null
  upstash = null
}

function memory(): InMemoryQuotaStore {
  memoryStore ??= new InMemoryQuotaStore()
  return memoryStore
}

function localFallback(): InMemoryQuotaStore {
  localFallbackStore ??= new InMemoryQuotaStore()
  return localFallbackStore
}

/** Store for counters shared by all requests of this deployment, or null when none is configured. */
export function resolveSharedStore(config: LlmProtectionConfig): QuotaStore | null {
  if (config.store === 'none') return null
  if (config.store === 'memory') return memory()
  const { url, token } = config.upstash!
  const signature = `${url}|${token.length}|${token.slice(-4)}`
  if (!upstash || upstash.signature !== signature) upstash = { signature, store: new UpstashQuotaStore({ url, token }) }
  return upstash.store
}

export interface RequestProtection {
  config: LlmProtectionConfig | null
  clientKey: string
  metrics: UsageMetrics
  /** Request-rate decision for this client (all providers). */
  checkRequestRate(): Promise<{ allowed: boolean; degraded: boolean }>
  /** Adapter for this request: stub, guarded real adapter, or an explicit unavailable adapter. */
  createAdapter(): LLMAdapter
  /** What actually processed this request (6.4E) — structural facts only. */
  processing(): ProcessingSnapshot
}


export function createRequestProtection(headers: Headers, env: Record<string, string | undefined> = process.env): RequestProtection {
  let config: LlmProtectionConfig | null = null
  try {
    config = readLlmProtectionConfig(env)
  } catch {
    config = null // invalid configuration → stub keeps working, real providers fail closed
  }

  const store = config ? safeResolve(config) : null
  const metrics = new UsageMetrics(store, config?.keyPrefix ?? 'chuya')
  const ip = config ? resolveClientIp(headers, config.clientIpHeader, config.trustedProxyHops) : null
  const clientKey = clientKeyFor(ip, config?.clientIdSalt ?? '')
  const provider = env['LLM_PROVIDER'] || 'stub'
  let tracked: TrackedLLMAdapter | null = null

  return {
    config,
    clientKey,
    metrics,

    async checkRequestRate() {
      const limit = config?.rateLimitPerWindow ?? 10
      const windowMs = config?.rateLimitWindowMs ?? 60_000
      const bucket = Math.floor(Date.now() / windowMs)
      const key = `${config?.keyPrefix ?? 'chuya'}:rl:${clientKey}:${bucket}`
      await metrics.record('requests_total')
      try {
        if (!store) throw new Error('no shared store')
        const r = await store.reserve(key, 1, limit, windowMs)
        if (!r.ok) await metrics.record('requests_rate_limited')
        return { allowed: r.ok, degraded: false }
      } catch {
        // Degraded: per-instance limit only. Real LLM calls are still refused by the guard.
        await metrics.record('rate_limit_degraded')
        const r = await localFallback().reserve(key, 1, limit, windowMs)
        if (!r.ok) await metrics.record('requests_rate_limited')
        return { allowed: r.ok, degraded: true }
      }
    },

    createAdapter() {
      tracked = new TrackedLLMAdapter(buildAdapter(), provider === 'stub' ? 'stub' : 'real')
      return tracked
    },

    processing() {
      return tracked?.snapshot() ?? { kind: provider === 'stub' ? 'stub' : 'real', attempts: 0, succeeded: 0, lastErrorCode: null }
    },
  }

  function buildAdapter(): LLMAdapter {
    if (provider === 'stub') return createLLMAdapter(env)

    let inner: LLMAdapter
    try {
      // Provider-level automatic retries are disabled under the guard: each retry would be a real,
      // un-budgeted call. Retry policy = shared cooldown + user resubmission.
      inner = createLLMAdapter({ ...env, GROQ_MAX_RETRIES: '0' })
    } catch {
      // Missing key / invalid provider: explicit failure, never the stub, never a 500 that would
      // hide the deterministic Safety Gate result.
      inner = new UnavailableLLMAdapter('LLM_PROVIDER_UNAVAILABLE')
    }
    if (!config) return new UnavailableLLMAdapter('LLM_GUARD_UNAVAILABLE')

    const usable = store && (store.distributed || config.allowLocalQuotaForRealLlm) ? store : null
    return new GuardedLLMAdapter(inner, { store: usable, config, clientKey, provider, metrics })
  }
}

function safeResolve(config: LlmProtectionConfig): QuotaStore | null {
  try {
    return resolveSharedStore(config)
  } catch {
    return null
  }
}
