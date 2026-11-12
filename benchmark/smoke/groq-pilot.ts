/**
 * Groq Pilot — Incremento 6.3, Fase 7 (opt-in, explicit execution only).
 *
 * Runs at most 5 benchmark scenarios against GroqCloud, sequentially, with no retries.
 * Default set = the same 5 scenarios as the historical Gemini pilot (comparable):
 *   SYM-001, SYM-003, BUD-001, SAF-001, AMB-001  → 4 real calls (SAF-001 Safety-Gate blocked;
 *   SYM-003 allowed since Safety Gate v1.4.0).
 *
 * Pre-flight only (no real call):
 *   npm run pilot:groq
 *
 * Real run (Git Bash) — authorization must be a SESSION variable (.env.local value ignored):
 *   GROQ_REAL_LLM_AUTHORIZED=true npm run pilot:groq
 *
 * Optional session/env vars:
 *   GROQ_PILOT_SCENARIOS=SYM-001,BUD-001   (max 5, known ids only)
 *   GROQ_PILOT_DELAY_MS=4000               (pause between scenarios, 0..60000)
 *   GROQ_PILOT_TOKEN_BUDGET=12000          (total tokens for the pilot, max 30000)
 *   GROQ_MAX_TOKENS=2048                   (per-call max_completion_tokens)
 *
 * Local limits: ≤5 scenarios, no parallelism, ≤5 real requests (adapter cap), no retries
 * (adapter maxRetries=0, each scenario once), early abort on 429 / auth / model errors,
 * token budget stop. Blocked in CI. API key never printed.
 *
 * Output (git-ignored, benchmark/results/):
 *   <campaignId>.json               sanitized structural results (no LLM content)
 *   <campaignId>.groq-metrics.json  aggregate metrics for the provider comparison (no LLM content)
 */
import { join } from 'path'
import { GroqAdapter, GROQ_DEFAULT_MODEL, GROQ_DEFAULT_MAX_TOKENS } from '../../src/agents/llm/groq-adapter'
import { getAllScenarios } from '../dataset/scenarios'
import { runBenchmark } from '../runner/runner'
import type { CampaignResult } from '../runner/types'
import {
  initCampaignFile,
  finalizeCampaignFile,
  atomicWrite,
  deriveProvider,
  DEFAULT_RESULTS_DIR,
} from '../persist'
import { SAFETY_POLICY_VERSION } from '../../src/domain/safety/blocklist'
import { summarizeLiveRun } from '../compare/provider-comparison'
import { redactApiKey } from './gemini-connectivity-utils'
import {
  checkGroqRealGuards,
  pinSessionAuthorization,
  redactSecretsForLog,
  resolvePilotConfig,
  runGroqPilot,
  GROQ_AUTH_FLAG,
  GROQ_PILOT_MAX_CASES,
} from './groq-smoke-utils'
import { loadEnvLocal } from './load-env-local'
import { randomUUID } from 'crypto'

pinSessionAuthorization(loadEnvLocal)

async function main(): Promise<void> {
  console.log('=== Chuya Motor — Groq Pilot (Incremento 6.3) ===\n')

  const all = getAllScenarios()
  const cfg = resolvePilotConfig(process.env, all)
  const apiKey = process.env['GROQ_API_KEY'] ?? ''
  const model = process.env['GROQ_MODEL'] || GROQ_DEFAULT_MODEL
  const maxTokens = process.env['GROQ_MAX_TOKENS'] ? Number(process.env['GROQ_MAX_TOKENS']) : GROQ_DEFAULT_MAX_TOKENS

  console.log(`API key      : ${redactApiKey(apiKey)}`)
  console.log(`Model        : ${model}`)
  console.log(`Scenarios    : ${cfg.scenarioIds.join(', ')} (max ${GROQ_PILOT_MAX_CASES})`)
  console.log(`Delay        : ${cfg.delayMs}ms between scenarios, sequential`)
  console.log(`Token budget : ${cfg.tokenBudget} total, ${maxTokens} per call`)
  console.log('Retries      : none (abort on 429 / auth / model errors)')

  const guard = checkGroqRealGuards(process.env)
  if (!guard.ok) {
    console.log(`\nPilot NOT executed: ${guard.message}`)
    if (guard.reason === 'NOT_AUTHORIZED') {
      console.log('\nRun the connectivity test first (npm run smoke:groq), then:')
      console.log(`  ${GROQ_AUTH_FLAG}=true npm run pilot:groq`)
      process.exit(0)
    }
    process.exit(1)
  }

  const adapter = new GroqAdapter(apiKey, {
    model,
    maxTokens,
    maxRetries: 0,
    maxRequestsPerRun: GROQ_PILOT_MAX_CASES,
  })
  // runBenchmark's own real-mode guard; set only after our explicit authorization check.
  process.env['BENCHMARK_REAL_LLM_AUTHORIZED'] = 'true'

  const scenarios = cfg.scenarioIds.map((id) => all.find((s) => s.id === id)!)
  const campaignId = randomUUID()
  const startedAt = new Date().toISOString()
  const datasetVersion = `v${all.length}`
  const provider = deriveProvider(model, 'real')

  const persistPath = initCampaignFile({
    campaignId,
    datasetVersion,
    safetyPolicyVersion: SAFETY_POLICY_VERSION,
    startedAt,
    mode: 'real',
    provider,
    model,
    realRequestsLimit: GROQ_PILOT_MAX_CASES,
    pendingIds: cfg.scenarioIds,
  })

  console.log('\nStarting pilot...')
  const outcome = await runGroqPilot(scenarios, {
    delayMs: cfg.delayMs,
    tokenBudget: cfg.tokenBudget,
    maxTokensPerCall: maxTokens,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    runScenario: async (s) => {
      const run = await runBenchmark([s], { mode: 'real', llmAdapter: adapter, timeoutMs: 60_000 })
      const r = run.results[0]!
      console.log(`  ${r.scenarioId}: ${r.outcome} · ${r.durationMs}ms · ${r.tokensUsed} tokens · calls=${r.realRequestsUsed ?? 0}`)
      return r
    },
  })

  const campaign: CampaignResult = {
    campaignId,
    datasetVersion,
    startedAt,
    completedAt: new Date().toISOString(),
    mode: 'real',
    model,
    realRequestsUsed: adapter.requestsMade,
    realRequestsLimit: GROQ_PILOT_MAX_CASES,
    totalDelayAppliedMs: cfg.delayMs * Math.max(0, outcome.results.length - 1),
    completed: outcome.results,
    skipped: [],
    pendingScenarios: outcome.pending,
    batchSummaries: [],
  }
  finalizeCampaignFile(persistPath, campaign, SAFETY_POLICY_VERSION)

  const metrics = summarizeLiveRun(
    { label: 'C. Groq', provider, model, mode: 'real', executedAt: startedAt },
    outcome.results,
    all,
  )
  const metricsPath = join(DEFAULT_RESULTS_DIR, `${campaignId}.groq-metrics.json`)
  atomicWrite(metricsPath, JSON.stringify(metrics, null, 2))

  console.log('\n--- Summary ---')
  console.log(`Stop reason   : ${outcome.stopReason}${outcome.stopDetail ? ` (${outcome.stopDetail})` : ''}`)
  console.log(`Executed      : ${outcome.results.length} / ${scenarios.length}`)
  console.log(`Pending       : ${outcome.pending.join(', ') || '-'}`)
  console.log(`Real requests : ${adapter.requestsMade}`)
  console.log(`Tokens        : ${outcome.tokensUsed} / ${cfg.tokenBudget}`)
  if (adapter.lastRetryAfterMs !== null) console.log(`Retry-After   : ${adapter.lastRetryAfterMs}ms`)
  console.log(`\nResults  → ${persistPath}`)
  console.log(`Metrics  → ${metricsPath}`)
  console.log('\nNext: npm run bench:compare')

  if (outcome.stopReason !== 'COMPLETED') process.exit(2)
}

main().catch((err: unknown) => {
  console.error('GROQ PILOT CRASHED:', redactSecretsForLog(err))
  process.exit(1)
})
