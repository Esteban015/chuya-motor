import { randomUUID } from 'crypto'
import type { BenchmarkScenario } from '../dataset/types'
import type {
  BenchmarkMode,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkRunConfig,
  BenchmarkSummary,
  DeterministicCheckResult,
} from './types'
import type { AnalyzeOutput } from '@/agents/graph/types'
import type { LLMAdapter } from '@/agents/llm/llm-adapter'
import { DeterministicMockLLMAdapter } from '@/agents/llm/deterministic-mock-adapter'
import { createLLMAdapter } from '@/agents/llm/llm-adapter-factory'
import { analyzeCase } from '@/agents/graph/analyze-graph'
import { checkSafetyCriteria } from './safety'
import { computeLatencyPercentiles, aggregateByCategory } from './metrics'
import { estimateCost } from './cost'

const REAL_MODE_GUARD = 'BENCHMARK_REAL_LLM_AUTHORIZED=true'

export async function runBenchmark(
  scenarios: BenchmarkScenario[],
  config: BenchmarkRunConfig,
): Promise<BenchmarkRun> {
  if (config.mode === 'real') {
    assertRealModeAuthorized()
  }

  const llmAdapter = resolveLLMAdapter(config.mode)
  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  const results: BenchmarkResult[] = []

  const scenariosToRun = config.maxScenariosPerCategory
    ? limitByCategory(scenarios, config.maxScenariosPerCategory)
    : scenarios

  for (const scenario of scenariosToRun) {
    if (results.length > 0 && config.scenarioDelayMs !== undefined && config.scenarioDelayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, config.scenarioDelayMs))
    }
    if (isAdapterQuotaExhausted(llmAdapter)) {
      results.push(makeQuotaExhaustedResult(scenario, config.mode))
      continue
    }
    const result = await runScenario(scenario, config, llmAdapter)
    results.push(result)
  }

  const completedAt = new Date().toISOString()
  const summary = buildSummary(runId, startedAt, completedAt, config.mode, results, llmAdapter.modelId, config.budgetLimitTokens)

  return { config, scenarios: scenariosToRun, results, summary }
}

async function runScenario(
  scenario: BenchmarkScenario,
  config: BenchmarkRunConfig,
  llmAdapter: LLMAdapter,
): Promise<BenchmarkResult> {
  const start = Date.now()
  let output: AnalyzeOutput | null = null
  let error: string | null = null

  try {
    const input = {
      caseId: randomUUID(),
      userText: scenario.input.userText,
      vehicle: scenario.input.vehicle
        ? {
            make: scenario.input.vehicle.make ?? 'Unknown',
            model: scenario.input.vehicle.model ?? 'Unknown',
            year: scenario.input.vehicle.year ?? 2000,
            vehicleType: scenario.input.vehicle.vehicleType ?? 'other' as const,
            fuelType: scenario.input.vehicle.fuelType ?? 'gasoline' as const,
          }
        : undefined,
      experienceLevel: scenario.input.experienceLevel ?? 'unknown' as const,
      dataLabel: 'synthetic_demo' as const,
    }

    const timeoutMs = config.timeoutMs ?? 30_000
    output = await Promise.race([
      analyzeCase(input, { llmAdapter }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ])
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const durationMs = Date.now() - start
  const deterministicChecks = output ? evaluateDeterministic(scenario, output) : []
  const securityCheck = output
    ? checkSafetyCriteria(scenario, output)
    : { passed: false, violations: ['No output produced'] }

  const deterministicPassed = deterministicChecks.every((c) => c.passed)
  const passed = error === null && deterministicPassed && securityCheck.passed

  return {
    scenarioId: scenario.id,
    category: scenario.category,
    severity: scenario.severity,
    mode: config.mode,
    passed,
    durationMs,
    output,
    error,
    llmDiagnosis: extractLlmDiagnosis(output),
    deterministicChecks,
    securityCheck,
    tokensUsed: output?.traces?.reduce((sum: number, t: { tokensUsed?: number }) => sum + (t.tokensUsed ?? 0), 0) ?? 0,
    requiresHumanReview: scenario.evaluation.requiresHumanReview,
    reviewNotes: scenario.evaluation.reviewNotes,
  }
}

/**
 * Extracts the first LLM error from output traces as a structured diagnostic string.
 * Format: "nodeId::LLM_ERROR_CODE"
 * Returns null when no LLM error occurred (success path or non-LLM failure).
 * Safe to log — does not include API keys, prompts, or free-text error messages.
 */
function extractLlmDiagnosis(output: AnalyzeOutput | null): string | null {
  if (!output?.traces) return null
  for (const trace of output.traces as Array<{ errorCode?: string; nodeId?: string }>) {
    if (trace.errorCode) {
      const node = trace.nodeId ?? 'unknown'
      return `${node}::${trace.errorCode}`
    }
  }
  return null
}

function evaluateDeterministic(
  scenario: BenchmarkScenario,
  output: AnalyzeOutput,
): DeterministicCheckResult[] {
  return scenario.evaluation.deterministic.map((assertion) =>
    evaluateAssertion(assertion, output),
  )
}

function evaluateAssertion(assertion: string, output: AnalyzeOutput): DeterministicCheckResult {
  // Format: "field.path=value" or "field.path>value" or "field.path<value"
  const eqMatch = /^(.+?)=(.+)$/.exec(assertion)
  const gtMatch = /^(.+?)>(.+)$/.exec(assertion)
  const ltMatch = /^(.+?)<(.+)$/.exec(assertion)

  if (eqMatch) {
    const [, path, expected] = eqMatch
    const actual = getPath(output, path!)
    const passed = String(actual) === expected
    return { assertion, passed, actual }
  }
  if (gtMatch) {
    const [, path, threshold] = gtMatch
    const actual = getPath(output, path!)
    const passed = Number(actual) > Number(threshold)
    return { assertion, passed, actual }
  }
  if (ltMatch) {
    const [, path, threshold] = ltMatch
    const actual = getPath(output, path!)
    const passed = Number(actual) < Number(threshold)
    return { assertion, passed, actual }
  }

  return { assertion, passed: false, actual: `Unknown assertion format: ${assertion}` }
}

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    const rec = current as Record<string, unknown>
    if (key === 'length' && Array.isArray(current)) return (current as unknown[]).length
    return rec[key]
  }, obj)
}

function resolveLLMAdapter(mode: BenchmarkMode): LLMAdapter {
  if (mode === 'real') {
    return createLLMAdapter()
  }
  return new DeterministicMockLLMAdapter()
}

function assertRealModeAuthorized(): void {
  const authorized = process.env['BENCHMARK_REAL_LLM_AUTHORIZED'] === 'true'
  if (!authorized) {
    throw new Error(
      `Real mode requires explicit authorization. Set env var: ${REAL_MODE_GUARD}\n` +
        'WARNING: This will make real API calls and incur costs.',
    )
  }
  if (process.env['CI']) {
    throw new Error(
      'Real mode is disabled in CI environments (CI env var is set).\n' +
        'Real LLM calls must be run locally with explicit authorization.',
    )
  }
}

/** Returns true when adapter signals its per-run quota is exhausted (duck-typed, not interface-bound). */
export function isAdapterQuotaExhausted(adapter: LLMAdapter): boolean {
  return (
    'isQuotaExhausted' in adapter &&
    (adapter as { isQuotaExhausted: boolean }).isQuotaExhausted === true
  )
}

function makeQuotaExhaustedResult(scenario: BenchmarkScenario, mode: BenchmarkMode): BenchmarkResult {
  return {
    scenarioId: scenario.id,
    category: scenario.category,
    severity: scenario.severity,
    mode,
    passed: false,
    durationMs: 0,
    output: null,
    error: 'QUOTA_EXHAUSTED: scenario not executed (free-tier request limit reached)',
    llmDiagnosis: null,
    deterministicChecks: [],
    securityCheck: { passed: false, violations: ['Scenario not executed: free-tier quota exhausted'] },
    tokensUsed: 0,
    requiresHumanReview: false,
  }
}

function limitByCategory(
  scenarios: BenchmarkScenario[],
  max: number,
): BenchmarkScenario[] {
  const counts = new Map<string, number>()
  return scenarios.filter((s) => {
    const count = counts.get(s.category) ?? 0
    if (count >= max) return false
    counts.set(s.category, count + 1)
    return true
  })
}

function buildSummary(
  runId: string,
  startedAt: string,
  completedAt: string,
  mode: BenchmarkMode,
  results: BenchmarkResult[],
  modelId: string,
  budgetLimitTokens?: number,
): BenchmarkSummary {
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
    startedAt,
    completedAt,
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

