/**
 * Parts pricing PILOT preflight — Incremento 7C. Read-only configuration check.
 *
 *   npx tsx benchmark/smoke/parts-pricing-preflight.ts                 (no network at all)
 *   npx tsx benchmark/smoke/parts-pricing-preflight.ts --ping-upstash  (one GET of a fixed, empty key + kill switch state)
 *   npx tsx benchmark/smoke/parts-pricing-preflight.ts --check-protection https://<preview>.vercel.app
 *       (two anonymous requests to the deployment; never triggers a search — preview-protection.ts)
 *
 * Never contacts SerpApi. Never prints secret values: only "present" / "missing" and variable
 * NAMES. Reads .env.local without modifying it (process env wins, as in Next.js).
 */
import { loadEnvLocal } from './load-env-local'
import { isPartsPricingEnabled, readPartsPricingConfig } from '../../src/server/parts-pricing/pricing-config'
import { readLlmProtectionConfig } from '../../src/server/llm-protection/protection-config'
import { UpstashPricingCache } from '../../src/server/parts-pricing/shared-cache'
import { PRICING_KILL_SWITCH_KEY } from '../../src/server/parts-pricing/search-budget'
import { checkDeploymentProtection } from './preview-protection'

loadEnvLocal()
const env = process.env
type Level = 'OK' | 'WARN' | 'FAIL' | 'INFO'
const rows: Array<[Level, string]> = []
const add = (level: Level, msg: string) => rows.push([level, msg])
const present = (name: string) => Boolean(env[name] && env[name]!.trim())

async function main(): Promise<void> {
  console.log('=== Chuya Motor — parts pricing pilot preflight (no SerpApi call) ===')

  // 1. Feature flag and public production guard.
  const raw = env['PARTS_PRICING_ENABLED']
  if (raw === undefined) add('INFO', 'PARTS_PRICING_ENABLED not set → feature OFF (default).')
  else if (raw !== 'true') add('WARN', 'PARTS_PRICING_ENABLED is set but not exactly "true" → feature OFF.')
  add('INFO', `VERCEL_ENV=${env['VERCEL_ENV'] ?? '(not set: local)'} · NODE_ENV=${env['NODE_ENV'] ?? '(not set)'}`)
  if (env['VERCEL_ENV'] === 'production') {
    add(isPartsPricingEnabled(env) ? 'FAIL' : 'OK', isPartsPricingEnabled(env)
      ? 'PUBLIC PRODUCTION would be ENABLED (PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION=true). Not allowed for the internal pilot.'
      : 'Public production guard active: the flag is ignored on VERCEL_ENV=production.')
  }
  if (present('PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION')) add('WARN', 'PARTS_PRICING_ALLOW_PUBLIC_PRODUCTION is set: remove it for the internal pilot.')
  add(isPartsPricingEnabled(env) ? 'OK' : 'INFO', `Effective feature state: ${isPartsPricingEnabled(env) ? 'ENABLED' : 'disabled'}`)

  // 2. Provider and credential (presence only).
  const provider = env['PARTS_PRICING_PROVIDER']
  if (provider === 'serpapi') add(present('SERPAPI_API_KEY') ? 'OK' : 'FAIL', `Provider serpapi · SERPAPI_API_KEY ${present('SERPAPI_API_KEY') ? 'present' : 'MISSING'}`)
  else if (provider === 'mercadolibre') add(present('MELI_ACCESS_TOKEN') ? 'OK' : 'FAIL', `Provider mercadolibre · MELI_ACCESS_TOKEN ${present('MELI_ACCESS_TOKEN') ? 'present' : 'MISSING'}`)
  else add('WARN', `PARTS_PRICING_PROVIDER=${provider ?? '(not set)'} → no provider: the route answers "disabled".`)
  const exposed = Object.keys(env).filter((k) => k.startsWith('NEXT_PUBLIC_') && /SERP|PRICING|MELI|UPSTASH|KV_REST/i.test(k))
  add(exposed.length ? 'FAIL' : 'OK', exposed.length ? `Variables that would reach the browser bundle: ${exposed.join(', ')}` : 'No pricing/Upstash variable uses the NEXT_PUBLIC_ prefix.')

  // 3. Budgets.
  try {
    const c = readPartsPricingConfig(env)
    add('OK', `Budgets (per SerpApi account, shared by every environment using the same key + Upstash): client ${c.clientRequestsPerHour} req/h, client ${c.clientDailySearches} searches/day, ${c.hourlySearchBudget}/hour, ${c.dailySearchBudget}/day, ${c.monthlySearchBudget} per rolling 31 days`)
    if (c.monthlySearchBudget > 250) add('WARN', 'Rolling 31-day budget above the SerpApi Free plan (250 per billing cycle): confirm the paid plan and the authorization.')
    if (c.hourlySearchBudget > 50) add('WARN', 'Hourly budget above the SerpApi Free plan throughput (50/hour): excess searches would fail at SerpApi.')
    if (c.dailySearchBudget * 31 < c.monthlySearchBudget) add('INFO', 'The daily budget × 31 is below the window budget: the daily cap is the effective limit.')
  } catch (e) {
    add('FAIL', `Invalid budget configuration: ${(e as Error).message}`)
  }

  // 4. Shared store (rate limit, atomic quotas, shared cache).
  let upstash: { url: string; token: string } | null = null
  try {
    const llm = readLlmProtectionConfig(env)
    upstash = llm.upstash
    add(llm.store === 'upstash' ? 'OK' : env['NODE_ENV'] === 'production' ? 'FAIL' : 'WARN',
      llm.store === 'upstash'
        ? 'Shared store: Upstash (atomic quotas + shared cache across instances).'
        : `Shared store: ${llm.store} (single process). ${env['NODE_ENV'] === 'production' ? 'In production every search FAILS CLOSED.' : 'OK only for a local dev pilot.'}`)
    add(present('CLIENT_ID_SALT') ? 'OK' : 'WARN', `CLIENT_ID_SALT ${present('CLIENT_ID_SALT') ? 'present' : 'missing (client hashes are unsalted)'}`)
  } catch (e) {
    add('FAIL', `Store configuration invalid: ${(e as Error).message}`)
  }

  if (process.argv.includes('--ping-upstash')) {
    if (!upstash) add('FAIL', 'Upstash ping requested but Upstash is not configured.')
    else {
      try {
        await new UpstashPricingCache({ ...upstash, timeoutMs: 2000 }).get('chuya:pp:preflight:none')
        add('OK', 'Upstash reachable and token accepted (one GET of an empty key).')
        const kill = await new UpstashPricingCache({ ...upstash, timeoutMs: 2000 }).exists(PRICING_KILL_SWITCH_KEY)
        add(kill ? 'WARN' : 'OK', kill ? 'Kill switch is ON: the route answers "disabled" (parts-pricing-kill-switch.ts off to resume).' : 'Kill switch is off.')
      } catch {
        add('FAIL', 'Upstash not reachable or token rejected (details withheld).')
      }
    }
  } else add('INFO', 'Upstash not contacted (add --ping-upstash to test connectivity).')

  const i = process.argv.indexOf('--check-protection')
  if (i >= 0) {
    const target = process.argv[i + 1]
    try {
      const r = await checkDeploymentProtection(target ?? '')
      add(r.protected ? 'OK' : 'FAIL', r.protected
        ? `Deployment protected for anonymous visitors (page ${r.page.status}, API ${r.api.status}).`
        : `Deployment NOT protected for anonymous visitors (page ${r.page.status} ${r.page.verdict}, API ${r.api.status} ${r.api.verdict}): do not enable the flag there.`)
    } catch {
      add('FAIL', 'Protection check failed (invalid https URL or network error).')
    }
  }

  for (const [level, msg] of rows) console.log(`[${level}] ${msg}`)
  const failed = rows.some(([l]) => l === 'FAIL')
  console.log(failed ? 'RESULT: NOT READY' : 'RESULT: configuration checks passed (no provider was called).')
  process.exitCode = failed ? 1 : 0
}

main().catch(() => {
  console.error('Preflight failed (details withheld).')
  process.exitCode = 1
})
