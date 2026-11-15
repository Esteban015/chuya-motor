/**
 * Parts pricing probe — Incremento 7C spike (opt-in, low consumption).
 *
 * Pre-flight only (no network, always safe):
 *   npx tsx benchmark/smoke/parts-pricing-probe.ts
 *
 * Real validation — requires an explicit SESSION flag (a value in .env.local is ignored) and the
 * provider credential in .env.local (server-side only, never printed):
 *   PARTS_PRICING_REAL_AUTHORIZED=true PARTS_PRICING_PROVIDER=mercadolibre npx tsx benchmark/smoke/parts-pricing-probe.ts
 *   PARTS_PRICING_REAL_AUTHORIZED=true PARTS_PRICING_PROVIDER=serpapi npx tsx benchmark/smoke/parts-pricing-probe.ts
 *
 * Single controlled case (1 request): add PARTS_PRICING_PROBE_CASE=B (session only, A–E).
 *
 * Budget (7C public pilot): every real search is charged to the SAME shared budget as the API route
 * (search-budget.ts: per hour / day / rolling 31 days of the SerpApi account) and needs Upstash;
 * without the distributed store, or with the budget exhausted, nothing is sent.
 *
 * Consumption: at most one provider request per case (5 cases, or 1 with PARTS_PRICING_PROBE_CASE), no retries. Mercado Libre: free
 * API calls. SerpApi: 5 searches of the plan quota (Free plan: 250/month). Blocked in CI.
 * Output: status, latency, counts and the offers EXACTLY as returned (title, ARS price, merchant,
 * URL) to reviews-local/parts-pricing/ (git-ignored). Nothing is invented.
 * Audit (local only): title + reason of every discarded and dropped result, "possible false
 * discard" review hints and duplicate titles. Summarize a saved report offline (no network):
 *   npx tsx benchmark/smoke/parts-pricing-audit-report.ts reviews-local/parts-pricing/<file>.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { loadEnvLocal } from './load-env-local'
import { createPricingService } from '../../src/server/parts-pricing/pricing-service'
import { readPartsPricingConfig } from '../../src/server/parts-pricing/pricing-config'
import { createSearchGate } from '../../src/server/parts-pricing/search-budget'
import { readLlmProtectionConfig } from '../../src/server/llm-protection/protection-config'
import { resolveSharedStore } from '../../src/server/llm-protection/runtime'
import { selectPriceProvider } from '../../src/server/parts-pricing/provider-registry'
import { buildProviderQuery } from '../../src/server/parts-pricing/query'

// Capture authorization BEFORE reading .env.local so it can only come from the session.
const AUTHORIZED = process.env['PARTS_PRICING_REAL_AUTHORIZED'] === 'true'
const PROVIDER = process.env['PARTS_PRICING_PROVIDER']
const ONLY_CASE = process.env['PARTS_PRICING_PROBE_CASE']
loadEnvLocal()

export const PROBE_CASES = [
  { id: 'A', description: 'Manguera de respiración de gases', vehicle: { make: 'Fiat', model: 'Palio', year: '2017', engine: '1.4 8v' } },
  { id: 'B', description: 'Pastillas de freno delanteras', vehicle: { make: 'Fiat', model: 'Palio', year: '2017' }, presentation: 'set' as const },
  { id: 'C', description: 'Filtro de aire', vehicle: { make: 'Fiat', model: 'Palio', engine: '1.4' } },
  { id: 'D', description: 'Amortiguador', vehicle: { make: 'Fiat', model: 'Palio' } }, // ambiguous: position / type variants
  { id: 'E', description: 'Junta homocinética lado caja zzqx-sin-coincidencias', vehicle: { make: 'Fiat', model: 'Palio', year: '2017' } },
]

async function main(): Promise<void> {
  console.log('=== Chuya Motor — Parts pricing probe (7C spike) ===')
  if (process.env['CI']) {
    console.log('CI detected: real provider calls are blocked.')
    return
  }
  // Audit mode: dropped / discarded titles are kept in the LOCAL report only (never in the API route).
  const provider = selectPriceProvider({ ...process.env, PARTS_PRICING_PROVIDER: PROVIDER }, { audit: true })
  console.log(`Provider: ${PROVIDER ?? '(none)'} · credential: ${provider ? 'present' : 'missing'} · authorized: ${AUTHORIZED}`)
  if (!AUTHORIZED || !provider) {
    console.log('Pre-flight only. No request sent. Cases that would run:')
    for (const c of PROBE_CASES) console.log(` - ${c.id}: ${c.description}`)
    return
  }

  const cases = ONLY_CASE ? PROBE_CASES.filter((c) => c.id === ONLY_CASE) : PROBE_CASES
  if (cases.length === 0) {
    console.log(`Unknown PARTS_PRICING_PROBE_CASE. No request sent.`)
    return
  }
  // Shared budget: the probe consumes the same SerpApi quota as the public route.
  let store = null
  try {
    const llm = readLlmProtectionConfig(process.env)
    store = llm.store === 'upstash' ? resolveSharedStore(llm) : null
  } catch {
    store = null
  }
  if (!store) {
    console.log('No Upstash store configured: real searches are not counted, so none is sent.')
    return
  }
  const gate = createSearchGate({
    store,
    limits: readPartsPricingConfig(process.env),
    clientKey: 'probe',
    account: provider.budgetAccount ?? provider.id,
    now: Date.now,
    requireDistributed: true,
  })
  const service = createPricingService({ provider })
  const report: unknown[] = []
  for (const c of cases) {
    const started = Date.now()
    const r = await service.research({ lines: [{ id: c.id, description: c.description, category: 'part', presentation: c.presentation }], vehicle: c.vehicle, audit: true, beforeProviderCall: gate })
    const item = r.items[0]
    const d = item?.diagnostics
    // Safe diagnostics only: HTTP/provider codes, counters, drop/discard reasons, masked price
    // shapes and rejected-link hostnames. Never the API key, the request URL or raw provider text.
    console.log(
      `${c.id}: status=${item?.status} reason=${item?.reason ?? '-'} http=${d?.httpStatus ?? '-'} provider=${d?.providerStatus ?? '-'}/${d?.providerError ?? '-'}` +
        ` raw=${d?.rawCount ?? '-'} sources=${JSON.stringify(d?.sourceCounts ?? {})} dropped=${item?.droppedInvalid ?? 0} ${JSON.stringify(d?.dropReasons ?? {})}` +
        ` kept=${item?.offers.length ?? 0} discarded=${item?.discarded ?? 0} ${JSON.stringify(item?.discardReasons ?? {})}` +
        ` priceFormats=${JSON.stringify(d?.priceFormats ?? [])} linkHosts=${JSON.stringify(d?.linkHosts ?? [])} latency=${Date.now() - started}ms`,
    )
    const a = item?.audit
    if (a) {
      const suspects = a.discarded.filter((x) => x.possibleFalseDiscard)
      console.log(`   audit: discarded=${a.discarded.length} possibleFalseDiscards=${suspects.length} dropped=${a.dropped.length} duplicates=${a.duplicates.count}`)
      for (const x of suspects.slice(0, 10)) console.log(`   ? [${x.reviewHint}] ${x.title}`)
    }
    report.push({ case: c, query: buildProviderQuery({ description: c.description, vehicle: c.vehicle, presentation: c.presentation ?? 'unit', quantity: 1 }), elapsedMs: Date.now() - started, item })
  }
  mkdirSync('reviews-local/parts-pricing', { recursive: true })
  const file = `reviews-local/parts-pricing/probe-${PROVIDER}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify(report, null, 2))
  console.log(`Saved: ${file}`)
}

main().catch((e) => {
  console.error('Probe failed:', (e as Error).message)
  process.exitCode = 1
})
