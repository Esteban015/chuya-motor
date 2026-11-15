/**
 * search-budget.ts — Billed-search budget of the automatic parts pricing (7C public pilot). SERVER ONLY.
 *
 * One reservation = ONE atomic store operation (QuotaStore.reserveAll → one Lua script on Upstash)
 * that checks every limit and charges every counter, or charges nothing:
 *   - per client per UTC day        (hashed IP)
 *   - per account per UTC hour      (SerpApi Free throughput: 50/h)
 *   - per account per UTC day
 *   - per account in any rolling 31-day window: the SerpApi quota follows the BILLING CYCLE of the
 *     account (not the calendar month), and every cycle (≤ 31 days) lies inside one such window.
 *
 * Counters are keyed by the provider ACCOUNT (a hash of the API key), with a fixed namespace that
 * does not depend on LLM_QUOTA_KEY_PREFIX: preview, production and authorized probes that share a
 * SerpApi key and an Upstash database share ONE budget. Keys never contain the key or user text.
 *
 * Fail closed: no store, a non-distributed store where one is required, or any store error →
 * the search is refused (no provider call). Nothing is ever refunded: a search that fails at
 * SerpApi is not billed by them, so counting it can only make the budget stricter.
 */
import { createHash } from 'node:crypto'
import type { QuotaStore } from '@/server/llm-protection/quota-store'
import type { PartsPricingConfig } from './pricing-config'
import type { SearchGate } from './pricing-service'

if (typeof window !== 'undefined') throw new Error('parts-pricing is server-only')

export const BUDGET_WINDOW_DAYS = 31
export const BUDGET_NAMESPACE = 'chuya-pp:b'
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** Billing account id for a credential: provider + 16 hex of SHA-256 (never the credential). */
export function budgetAccountFor(provider: string, credential: string): string {
  return `${provider}:${createHash('sha256').update(`${provider}|${credential}`).digest('hex').slice(0, 16)}`
}

export function searchBudgetKeys(account: string, clientKey: string, now: number) {
  const base = `${BUDGET_NAMESPACE}:${account}`
  const day = Math.floor(now / DAY_MS)
  return {
    clientDay: `${base}:cd:${clientKey}:${day}`,
    hour: `${base}:h:${Math.floor(now / HOUR_MS)}`,
    /** Today first, then the 30 previous UTC days. */
    windowDays: Array.from({ length: BUDGET_WINDOW_DAYS }, (_, i) => `${base}:d:${day - i}`),
  }
}

export type SearchBudgetLimits = Pick<PartsPricingConfig, 'clientDailySearches' | 'hourlySearchBudget' | 'dailySearchBudget' | 'monthlySearchBudget'>

export function createSearchGate(opts: {
  store: QuotaStore | null
  limits: SearchBudgetLimits
  clientKey: string
  account: string
  now: () => number
  requireDistributed: boolean
}): SearchGate {
  return async () => {
    const { store, limits } = opts
    if (!store || (opts.requireDistributed && !store.distributed)) return { ok: false, reason: 'store_unavailable' }
    const k = searchBudgetKeys(opts.account, opts.clientKey, opts.now())
    try {
      const r = await store.reserveAll(
        [
          // Kill switch inside the same atomic operation: flag value 1 → 1 + 1 > 1 → refused. A
          // failed pre-check read (route) can never let a search through while the switch is on.
          { keys: [PRICING_KILL_SWITCH_KEY], limit: 1 },
          { keys: [k.clientDay], limit: limits.clientDailySearches },
          { keys: [k.hour], limit: limits.hourlySearchBudget },
          { keys: [k.windowDays[0]!], limit: limits.dailySearchBudget },
          { keys: k.windowDays, limit: limits.monthlySearchBudget },
        ],
        [
          { key: k.clientDay, ttlMs: DAY_MS + HOUR_MS },
          { key: k.hour, ttlMs: 2 * HOUR_MS },
          { key: k.windowDays[0]!, ttlMs: (BUDGET_WINDOW_DAYS + 1) * DAY_MS },
        ],
      )
      if (r.ok) return { ok: true }
      return { ok: false, reason: r.failed === 0 ? 'store_unavailable' : 'quota_exceeded' }
    } catch {
      return { ok: false, reason: 'store_unavailable' }
    }
  }
}

/**
 * Runtime kill switch (no redeploy): while this flag exists in the shared store, the route answers
 * "disabled" and sends no search. Env changes on Vercel need a new deployment; this does not.
 * The route's pre-check reads a store error as "not set" (no false "disabled" answers), but the
 * budget gate re-checks the flag atomically before every billed search and refuses on any error,
 * so a search is never sent while the flag is set. Only holders of the Upstash credentials (server
 * env / operator session) can set or clear it; there is no HTTP endpoint for it.
 */
export const PRICING_KILL_SWITCH_KEY = `${BUDGET_NAMESPACE}:kill`

export async function isPricingKillSwitchOn(store: QuotaStore | null): Promise<boolean> {
  if (!store) return false
  try {
    return await store.hasFlag(PRICING_KILL_SWITCH_KEY)
  } catch {
    return false
  }
}

export async function setPricingKillSwitch(store: QuotaStore, on: boolean): Promise<void> {
  if (on) await store.setFlag(PRICING_KILL_SWITCH_KEY, null)
  else await store.clearFlag(PRICING_KILL_SWITCH_KEY)
}
