/**
 * Parts pricing runtime kill switch — 7C public pilot. Operates the Upstash flag read by the route
 * on every request (search-budget.ts): takes effect immediately, no redeploy.
 *
 *   npx tsx benchmark/smoke/parts-pricing-kill-switch.ts status
 *   npx tsx benchmark/smoke/parts-pricing-kill-switch.ts on  --confirm   (stop all automatic searches)
 *   npx tsx benchmark/smoke/parts-pricing-kill-switch.ts off --confirm   (resume)
 *
 * Uses the Upstash credentials of the TARGET environment (session env wins over .env.local; run it
 * with the same UPSTASH_* / KV_REST_* values as the deployment). Never calls SerpApi. Never prints
 * secret values. Blocked in CI.
 */
import { loadEnvLocal } from './load-env-local'
import { readLlmProtectionConfig } from '../../src/server/llm-protection/protection-config'
import { UpstashQuotaStore } from '../../src/server/llm-protection/upstash-quota-store'
import { isPricingKillSwitchOn, setPricingKillSwitch } from '../../src/server/parts-pricing/search-budget'

async function main(): Promise<void> {
  if (process.env['CI']) {
    console.log('CI detected: the kill switch is not operated from CI.')
    return
  }
  loadEnvLocal()
  const action = process.argv[2]
  if (action !== 'status' && action !== 'on' && action !== 'off') {
    console.log('Usage: parts-pricing-kill-switch.ts status | on --confirm | off --confirm')
    process.exitCode = 1
    return
  }
  const llm = readLlmProtectionConfig(process.env)
  if (llm.store !== 'upstash' || !llm.upstash) {
    console.log('Upstash is not configured in this environment: nothing to operate.')
    process.exitCode = 1
    return
  }
  const store = new UpstashQuotaStore({ ...llm.upstash, timeoutMs: 3000 })
  if (action !== 'status') {
    if (!process.argv.includes('--confirm')) {
      console.log(`Add --confirm to turn the kill switch ${action.toUpperCase()}. Nothing changed.`)
      return
    }
    await setPricingKillSwitch(store, action === 'on')
  }
  console.log(`Kill switch: ${(await isPricingKillSwitchOn(store)) ? 'ON (automatic searches stopped)' : 'off (searches allowed by flag and budget)'}`)
}

main().catch(() => {
  console.error('Kill switch operation failed (details withheld). Nothing is assumed changed.')
  process.exitCode = 1
})
