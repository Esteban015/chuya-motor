/**
 * protection-config.ts — Environment configuration of the LLM protection layer (Incremento 6.4D).
 * Server-side only. NEXT_PUBLIC_* is never read. Secrets (Upstash token) are kept out of toJSON/logs.
 * Invalid values throw ProtectionConfigError; the route then fails CLOSED for real LLM providers.
 */

export class ProtectionConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProtectionConfigError'
  }
}

export type QuotaStoreKind = 'upstash' | 'memory' | 'none'

export interface LlmProtectionConfig {
  isProduction: boolean
  store: QuotaStoreKind
  /** Present only when store === 'upstash'. Never logged. */
  upstash: { url: string; token: string } | null
  keyPrefix: string
  // Per-client request rate (all providers, including the stub).
  rateLimitPerWindow: number
  rateLimitWindowMs: number
  clientIpHeader: string
  trustedProxyHops: number
  clientIdSalt: string
  // Real-LLM budgets (shared across instances when the store is distributed).
  // An "analysis" is one POST /api/analyze that reaches a real provider (6.4E): visitor and global
  // analysis quotas are counted once per analysis; calls and tokens are counted per provider call.
  clientAnalysesPerWindow: number
  clientWindowMs: number
  clientDailyAnalyses: number
  dailyAnalysisBudget: number
  dailyCallBudget: number
  dailyTokenBudget: number
  maxCallsPerAnalysis: number
  maxConcurrent: number
  concurrencyTtlMs: number
  estimatedMaxOutputTokens: number
  // Emergency controls.
  killSwitch: boolean
  cooldownMsOn429: number
  cooldownMsOn5xx: number
  /** Non-production only: lets local evaluation use the in-memory store with a real provider. */
  allowLocalQuotaForRealLlm: boolean
}

type Env = Record<string, string | undefined>

/**
 * Initial limits of the public pilot (Incremento 6.4E). Days are UTC days.
 * dailyCallBudget = dailyAnalysisBudget × maxCallsPerAnalysis, so the analysis budget binds first.
 */
export const PILOT_LIMITS = {
  clientAnalysesPerWindow: 3, // analyses with real AI per visitor…
  clientWindowSeconds: 3600, // …per hour
  clientDailyAnalyses: 10, // per visitor per day: one visitor cannot drain the shared 40
  dailyAnalysisBudget: 40,
  dailyCallBudget: 80,
  dailyTokenBudget: 60_000,
  maxCallsPerAnalysis: 2,
  maxConcurrent: 2,
} as const

function int(env: Env, name: string, def: number, min: number, max: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return def
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ProtectionConfigError(`Invalid ${name}: expected an integer in [${min}, ${max}].`)
  }
  return n
}

function bool(env: Env, name: string, def: boolean): boolean {
  const raw = env[name]
  if (raw === undefined || raw === '') return def
  if (/^(1|true|on|yes)$/i.test(raw)) return true
  if (/^(0|false|off|no)$/i.test(raw)) return false
  throw new ProtectionConfigError(`Invalid ${name}: expected true/false.`)
}

export function readLlmProtectionConfig(env: Env = process.env): LlmProtectionConfig {
  const isProduction = env['NODE_ENV'] === 'production'

  // Upstash: native names or the Vercel Marketplace integration names.
  const url = env['UPSTASH_REDIS_REST_URL'] || env['KV_REST_API_URL'] || ''
  const token = env['UPSTASH_REDIS_REST_TOKEN'] || env['KV_REST_API_TOKEN'] || ''
  const requested = (env['LLM_QUOTA_STORE'] || (url && token ? 'upstash' : 'memory')).toLowerCase()
  if (requested !== 'upstash' && requested !== 'memory' && requested !== 'none') {
    throw new ProtectionConfigError('Invalid LLM_QUOTA_STORE: expected upstash, memory or none.')
  }
  if (requested === 'upstash' && (!url || !token)) {
    throw new ProtectionConfigError('LLM_QUOTA_STORE=upstash requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.')
  }

  const clientIpHeader = (env['CLIENT_IP_HEADER'] || 'x-forwarded-for').toLowerCase()
  if (!/^[a-z0-9-]{1,64}$/.test(clientIpHeader)) throw new ProtectionConfigError('Invalid CLIENT_IP_HEADER.')

  const keyPrefix = env['LLM_QUOTA_KEY_PREFIX'] || 'chuya'
  if (!/^[a-z0-9_-]{1,32}$/i.test(keyPrefix)) throw new ProtectionConfigError('Invalid LLM_QUOTA_KEY_PREFIX.')

  const timeoutMs = int(env, 'GROQ_TIMEOUT_MS', 30_000, 1, 300_000)

  return {
    isProduction,
    store: requested,
    upstash: requested === 'upstash' ? { url, token } : null,
    keyPrefix,
    rateLimitPerWindow: int(env, 'RATE_LIMIT_PER_WINDOW', 10, 1, 10_000),
    rateLimitWindowMs: int(env, 'RATE_LIMIT_WINDOW_SECONDS', 60, 1, 86_400) * 1000,
    clientIpHeader,
    trustedProxyHops: int(env, 'TRUSTED_PROXY_HOPS', 1, 1, 5),
    clientIdSalt: env['CLIENT_ID_SALT'] || '',
    // Pilot defaults (6.4E, PILOT_LIMITS): conservative on purpose; raise only through env vars.
    clientAnalysesPerWindow: int(env, 'LLM_CLIENT_ANALYSES_PER_WINDOW', PILOT_LIMITS.clientAnalysesPerWindow, 0, 10_000),
    clientWindowMs: int(env, 'LLM_CLIENT_WINDOW_SECONDS', PILOT_LIMITS.clientWindowSeconds, 60, 86_400) * 1000,
    clientDailyAnalyses: int(env, 'LLM_CLIENT_DAILY_ANALYSES', PILOT_LIMITS.clientDailyAnalyses, 0, 100_000),
    dailyAnalysisBudget: int(env, 'LLM_DAILY_ANALYSIS_BUDGET', PILOT_LIMITS.dailyAnalysisBudget, 0, 1_000_000),
    dailyCallBudget: int(env, 'LLM_DAILY_CALL_BUDGET', PILOT_LIMITS.dailyCallBudget, 0, 1_000_000),
    dailyTokenBudget: int(env, 'LLM_DAILY_TOKEN_BUDGET', PILOT_LIMITS.dailyTokenBudget, 0, 1_000_000_000),
    maxCallsPerAnalysis: int(env, 'LLM_MAX_CALLS_PER_ANALYSIS', PILOT_LIMITS.maxCallsPerAnalysis, 1, 5),
    maxConcurrent: int(env, 'LLM_MAX_CONCURRENT', PILOT_LIMITS.maxConcurrent, 1, 1_000),
    concurrencyTtlMs: Math.max(2 * timeoutMs, 10_000),
    estimatedMaxOutputTokens: int(env, 'GROQ_MAX_TOKENS', 2048, 1, 8192),
    killSwitch: bool(env, 'LLM_KILL_SWITCH', false),
    cooldownMsOn429: int(env, 'LLM_COOLDOWN_SECONDS_ON_429', 60, 1, 3600) * 1000,
    cooldownMsOn5xx: int(env, 'LLM_COOLDOWN_SECONDS_ON_5XX', 15, 1, 3600) * 1000,
    // Forced off in production: a per-instance counter cannot bound a distributed deployment.
    allowLocalQuotaForRealLlm: !isProduction && bool(env, 'LLM_ALLOW_LOCAL_QUOTA', true),
  }
}
