/**
 * Provider comparison report — Incremento 6.3, Fase 6.
 *
 * Makes NO real LLM calls. Builds:
 *   A1. Stub — contemporary, 30 scenarios (two runs → consistency).
 *   A2. Stub — contemporary, same subset as the Groq/Gemini pilots (apples-to-apples).
 *   B.  Gemini — historical, latest completed real campaign persisted in benchmark/results/.
 *   C.  Groq  — latest pilot metrics persisted by `npm run pilot:groq` (if authorized & run).
 *
 *   npm run bench:compare
 *
 * Writes benchmark/results/provider-comparison.md (git-ignored) and prints it.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { getAllScenarios } from '../dataset/scenarios'
import { runBenchmark } from '../runner/runner'
import { loadCampaign, atomicWrite, DEFAULT_RESULTS_DIR } from '../persist'
import type { PersistedCampaign } from '../persist'
import {
  summarizeLiveRun,
  summarizePersistedCampaign,
  computeConsistency,
  toComparisonMarkdown,
  parseMetricsFile,
} from './provider-comparison'
import type { ProviderMetrics } from './provider-comparison'
import { GROQ_PILOT_DEFAULT_SCENARIO_IDS } from '../smoke/groq-smoke-utils'

async function main(): Promise<void> {
  const all = getAllScenarios()
  const now = new Date().toISOString()
  const notes: string[] = []

  // A. Stub — contemporary, two runs for consistency.
  const run1 = await runBenchmark(all, { mode: 'mock' })
  const run2 = await runBenchmark(all, { mode: 'mock' })
  const stubMeta = { provider: 'stub', model: 'deterministic-mock-v1', mode: 'mock' as const, executedAt: now }
  const stubAll = summarizeLiveRun({ ...stubMeta, label: 'A1. Stub (30)' }, run1.results, all)
  stubAll.consistency = computeConsistency(run1.results, run2.results)

  const subset = new Set(GROQ_PILOT_DEFAULT_SCENARIO_IDS)
  const stubSubset = summarizeLiveRun(
    { ...stubMeta, label: 'A2. Stub (piloto)' },
    run1.results.filter((r) => subset.has(r.scenarioId)),
    all,
  )
  stubSubset.consistency = computeConsistency(
    run1.results.filter((r) => subset.has(r.scenarioId)),
    run2.results.filter((r) => subset.has(r.scenarioId)),
  )

  const columns: ProviderMetrics[] = [stubAll, stubSubset]

  // B. Gemini — historical.
  const gemini = latestCampaign((c) => c.provider === 'google' && c.mode === 'real' && c.status === 'completed')
  if (gemini) columns.push(summarizePersistedCampaign('B. Gemini (histórico)', gemini))
  else notes.push('B. Gemini: no hay campañas reales persistidas en benchmark/results/.')

  // C. Groq — latest pilot metrics.
  const groq = latestGroqMetrics()
  if (groq) columns.push({ ...groq, label: 'C. Groq (piloto)' })
  else notes.push('C. Groq: sin piloto real ejecutado (requiere GROQ_REAL_LLM_AUTHORIZED=true y `npm run pilot:groq`).')

  let md = toComparisonMarkdown(columns, now)
  if (notes.length > 0) md += `\n## Columnas no disponibles\n\n${notes.map((n) => `- ${n}`).join('\n')}\n`

  const out = join(DEFAULT_RESULTS_DIR, 'provider-comparison.md')
  atomicWrite(out, md)
  console.log(md)
  console.log(`\nReport → ${out}`)
}

function resultFiles(suffix: string): string[] {
  try {
    return readdirSync(DEFAULT_RESULTS_DIR)
      .filter((f) => f.endsWith(suffix))
      .map((f) => join(DEFAULT_RESULTS_DIR, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  } catch {
    return []
  }
}

function latestCampaign(pred: (c: PersistedCampaign) => boolean): PersistedCampaign | null {
  const candidates: PersistedCampaign[] = []
  for (const f of resultFiles('.json')) {
    if (f.endsWith('.groq-metrics.json')) continue
    try {
      const c = loadCampaign(f)
      if (pred(c)) candidates.push(c)
    } catch {
      /* skip unreadable / incompatible files */
    }
  }
  candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return candidates[0] ?? null
}

function latestGroqMetrics(): ProviderMetrics | null {
  for (const f of resultFiles('.groq-metrics.json')) {
    try {
      return parseMetricsFile(JSON.parse(readFileSync(f, 'utf8')))
    } catch {
      /* skip invalid */
    }
  }
  return null
}

main().catch((err: unknown) => {
  console.error('COMPARISON CRASHED:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
