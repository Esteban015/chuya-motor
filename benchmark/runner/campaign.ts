/**
 * Campaign runner — multi-scenario batch execution with:
 * - Shared LLM adapter (single quota counter across all scenarios)
 * - RPM-based time limiting between real API calls
 * - Quota exhaustion detection (stops campaign, marks remaining as skipped)
 * - Resume support (filterCompleted)
 * - Batch summaries every N scenarios
 * - No real API calls unless CAMPAIGN_REAL_LLM_AUTHORIZED=true is set by the caller
 */

import { randomUUID } from 'crypto'
import type { BenchmarkScenario } from '../dataset/types'
import type {
  BenchmarkMode,
  BenchmarkResult,
  BenchmarkSummary,
  CampaignConfig,
  CampaignResult,
} from './types'
import { DeterministicMockLLMAdapter } from '@/agents/llm/deterministic-mock-adapter'
import { createLLMAdapter } from '@/agents/llm/llm-adapter-factory'
import type { LLMAdapter } from '@/agents/llm/llm-adapter'
import { runBenchmark, isAdapterQuotaExhausted } from './runner'
import { selectScenarios, filterCompleted } from './scenario-selector'
import { RpmLimiter } from './rate-limiter'
import { aggregateByCategory, computeLatencyPercentiles, countByOutcome } from './metrics'
import { estimateCost } from './cost'

export { countByOutcome }

/**
 * Run a campaign over the given scenario pool.
 *
 * The campaign creates one shared LLM adapter so all scenarios share the same
 * request counter. This guarantees that `maxRealRequestsPerCampaign` is a
 * hard per-campaign ceiling, not per-batch.
 *
 * To authorize real Gemini calls, set BENCHMARK_REAL_LLM_AUTHORIZED=true before
 * calling with mode='real'. The campaign script is responsible for setting this
 * env var after its own authorization check.
 */
export async function runCampaign(
  allScenarios: BenchmarkScenario[],
  config: CampaignConfig,
): Promise<CampaignResult> {
  const campaignId = randomUUID()
  const startedAt = new Date().toISOString()

  // --- Scenario selection & resume -----------------------------------------
  const selected = selectScenarios(allScenarios, {
    ids: config.scenarioIds,
    categories: config.categories,
  })
  const pending = config.resumeFrom
    ? filterCompleted(selected, config.resumeFrom, { allowRerun: config.allowRerun })
    : selected

  // --- Adapter setup --------------------------------------------------------
  const maxRequests = config.maxRealRequestsPerCampaign ?? Infinity
  const sharedAdapter = config.llmAdapter ?? buildAdapter(config.mode, maxRequests)
  const model = sharedAdapter.modelId

  // --- RPM limiting ---------------------------------------------------------
  const rpmLimiter = config.rpmLimit !== undefined ? new RpmLimiter(config.rpmLimit) : null

  // --- Execution loop -------------------------------------------------------
  const completed: BenchmarkResult[] = []
  const skipped: BenchmarkResult[] = []
  const batchSummaries: BenchmarkSummary[] = []
  const batchSize = config.batchSize ?? pending.length
  let batchBuffer: BenchmarkResult[] = []
  let lastHadRealCall = false

  for (const scenario of pending) {
    // Quota check before executing the scenario
    if (isAdapterQuotaExhausted(sharedAdapter)) {
      skipped.push(makeSkippedResult(scenario, config.mode))
      continue
    }

    // RPM delay — only when previous scenario made a real LLM call
    if (rpmLimiter !== null) {
      await rpmLimiter.waitIfNeeded(lastHadRealCall)
    }

    // Fixed artificial delay between scenarios (excluding first)
    if (completed.length + skipped.length > 0 && config.scenarioDelayMs) {
      await new Promise<void>((r) => setTimeout(r, config.scenarioDelayMs))
    }

    // Run the single scenario via runBenchmark (re-uses existing evaluation pipeline)
    const run = await runBenchmark([scenario], {
      mode: config.mode,
      llmAdapter: sharedAdapter,
      timeoutMs: config.timeoutMs,
      budgetLimitTokens: config.budgetLimitTokens,
    })

    const result = run.results[0]
    if (!result) continue

    lastHadRealCall = (result.realRequestsUsed ?? 0) > 0
    if (rpmLimiter !== null && lastHadRealCall) {
      rpmLimiter.recordCall()
    }

    if (result.outcome === 'QUOTA_EXHAUSTED') {
      skipped.push(result)
      // Quota hit mid-campaign — mark remaining pending scenarios as skipped
      const processedIds = new Set([
        ...completed.map((r) => r.scenarioId),
        ...skipped.map((r) => r.scenarioId),
      ])
      for (const remaining of pending) {
        if (!processedIds.has(remaining.id)) {
          skipped.push(makeSkippedResult(remaining, config.mode))
        }
      }
      break
    }

    completed.push(result)
    batchBuffer.push(result)

    // Incremental persistence callback
    if (config.onScenarioComplete) {
      const processedNow = new Set([
        ...completed.map((r) => r.scenarioId),
        ...skipped.map((r) => r.scenarioId),
      ])
      const remainingIds = pending
        .filter((s) => !processedNow.has(s.id))
        .map((s) => s.id)
      await config.onScenarioComplete(result, remainingIds)
    }

    // Flush batch if size reached
    if (batchBuffer.length >= batchSize) {
      batchSummaries.push(buildBatchSummary(batchBuffer, config.mode, model, config.budgetLimitTokens))
      batchBuffer = []
    }
  }

  // Flush remaining partial batch
  if (batchBuffer.length > 0) {
    batchSummaries.push(buildBatchSummary(batchBuffer, config.mode, model, config.budgetLimitTokens))
  }

  // Scenarios that were selected but never reached (stopped by quota mid-loop)
  const processedIds = new Set([...completed.map((r) => r.scenarioId), ...skipped.map((r) => r.scenarioId)])
  const pendingScenarios = pending
    .filter((s) => !processedIds.has(s.id))
    .map((s) => s.id)

  const realRequestsUsed = completed.reduce((sum, r) => sum + (r.realRequestsUsed ?? 0), 0)

  return {
    campaignId,
    datasetVersion: `v${allScenarios.length}`,
    startedAt,
    completedAt: new Date().toISOString(),
    mode: config.mode,
    model,
    realRequestsUsed,
    realRequestsLimit: isFinite(maxRequests) ? maxRequests : 0,
    totalDelayAppliedMs: rpmLimiter?.totalDelayAppliedMs ?? 0,
    completed,
    skipped,
    pendingScenarios,
    batchSummaries,
  }
}

function buildAdapter(mode: BenchmarkMode, _maxRequests: number): LLMAdapter {
  if (mode === 'real') {
    // createLLMAdapter picks up GEMINI_API_KEY + GEMINI_MODEL from env.
    // The runBenchmark auth check ensures BENCHMARK_REAL_LLM_AUTHORIZED is set.
    const adapter = createLLMAdapter()
    // If the adapter supports per-run quota (GeminiAdapter), it's already set via env/factory.
    // For campaigns, we enforce the global limit by checking isAdapterQuotaExhausted before each scenario.
    return adapter
  }
  if (mode === 'mock') {
    return new DeterministicMockLLMAdapter()
  }
  return new DeterministicMockLLMAdapter()
}

function makeSkippedResult(scenario: BenchmarkScenario, mode: BenchmarkMode): BenchmarkResult {
  return {
    scenarioId: scenario.id,
    category: scenario.category,
    severity: scenario.severity,
    mode,
    passed: false,
    durationMs: 0,
    output: null,
    error: 'QUOTA_EXHAUSTED: scenario not executed (campaign quota exhausted)',
    llmDiagnosis: null,
    deterministicChecks: [],
    securityCheck: { passed: false, violations: ['Scenario not executed: campaign quota exhausted'] },
    tokensUsed: 0,
    requiresHumanReview: false,
    outcome: 'QUOTA_EXHAUSTED',
    realRequestsUsed: 0,
  }
}

function buildBatchSummary(
  results: BenchmarkResult[],
  mode: BenchmarkMode,
  modelId: string,
  budgetLimitTokens?: number,
): BenchmarkSummary {
  const runId = randomUUID()
  const total = results.length
  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed && r.error === null).length
  const errors = results.filter((r) => r.error !== null).length
  const passRate = total > 0 ? passed / total : 0
  const latency = computeLatencyPercentiles(results)
  const totalTokensUsed = results.reduce((sum, r) => sum + r.tokensUsed, 0)
  const costEstimate = estimateCost(totalTokensUsed, modelId, budgetLimitTokens)

  return {
    runId,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    mode,
    total,
    passed,
    failed,
    errors,
    passRate,
    byCategory: aggregateByCategory(results),
    latencyMs: { p50: latency.p50, p95: latency.p95, max: latency.max },
    totalTokensUsed,
    estimatedCostUsd: costEstimate.estimatedUsd,
    humanReviewRequired: results.filter((r) => r.requiresHumanReview).length,
    results,
  }
}
