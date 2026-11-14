/**
 * pricing-config.ts — Feature flag and budgets of automatic parts pricing (Incremento 7C). SERVER ONLY.
 *
 * Disabled by default. The route and the UI exist only when PARTS_PRICING_ENABLED=true is set on the
 * SERVER; nothing the client sends can enable it (no query/body/header flag is read). Even when
 * enabled, a provider call needs PARTS_PRICING_PROVIDER + its credential (provider-registry.ts).
 *
 * Budgets count PROVIDER SEARCHES (cache misses), not requests: one search = one SerpApi credit.
 * Defaults are deliberately small (internal pilot) and stay below the SerpApi Free plan (250/month).
 * Days and months are UTC.
 */
if (typeof window !== 'undefined') throw new Error('parts-pricing is server-only')

export class PricingConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PricingConfigError'
  }
}

export const PRICING_BUDGET_DEFAULTS = Object.freeze({
  /** Requests (button presses) per client per hour. */
  clientRequestsPerHour: 5,
  /** Provider searches per client per UTC day. */
  clientDailySearches: 10,
  /** Provider searches per UTC day for the whole deployment. */
  dailySearchBudget: 20,
  /** Provider searches per UTC month for the whole deployment (SerpApi Free = 250). */
  monthlySearchBudget: 200,
})

export interface PartsPricingConfig {
  enabled: boolean
  clientRequestsPerHour: number
  clientDailySearches: number
  dailySearchBudget: number
  monthlySearchBudget: number
  /** Production refuses provider calls without a distributed (shared) counter store. */
  requireDistributedStore: boolean
}

type Env = Record<string, string | undefined>

function int(env: Env, name: string, def: number, min: number, max: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return def
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new PricingConfigError(`Invalid ${name}: expected an integer in [${min}, ${max}].`)
  return n
}

/**
 * Strict: only the literal "true" enables the feature (no "1", "yes", typos).
 * Public production guard: on the Vercel PRODUCTION environment (the public domain) the flag is
 * ignored unless PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION=true is ALSO set — a separate, explicit
 * decision that the internal pilot never takes. Local runs and protected previews are unaffected.
 */
export function isPartsPricingEnabled(env: Env = process.env): boolean {
  if (env['PARTS_PRICING_ENABLED'] !== 'true') return false
  if (env['VERCEL_ENV'] === 'production' && env['PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION'] !== 'true') return false
  return true
}

export function readPartsPricingConfig(env: Env = process.env): PartsPricingConfig {
  return {
    enabled: isPartsPricingEnabled(env),
    clientRequestsPerHour: int(env, 'PARTS_PRICING_CLIENT_REQUESTS_PER_HOUR', PRICING_BUDGET_DEFAULTS.clientRequestsPerHour, 1, 1000),
    clientDailySearches: int(env, 'PARTS_PRICING_CLIENT_DAILY_SEARCHES', PRICING_BUDGET_DEFAULTS.clientDailySearches, 0, 10_000),
    dailySearchBudget: int(env, 'PARTS_PRICING_DAILY_SEARCH_BUDGET', PRICING_BUDGET_DEFAULTS.dailySearchBudget, 0, 100_000),
    monthlySearchBudget: int(env, 'PARTS_PRICING_MONTHLY_SEARCH_BUDGET', PRICING_BUDGET_DEFAULTS.monthlySearchBudget, 0, 1_000_000),
    requireDistributedStore: env['NODE_ENV'] === 'production',
  }
}
