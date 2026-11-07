import type { BenchmarkScenario } from '../dataset/types'
import type { AnalyzeOutput } from '@/agents/graph/types'

export type BenchmarkMode = 'mock' | 'simulated' | 'real'

export interface BenchmarkRunConfig {
  mode: BenchmarkMode
  maxScenariosPerCategory?: number
  timeoutMs?: number
  budgetLimitTokens?: number
  /** Minimum wait between consecutive scenarios (ms). Use for rate-limited providers (e.g. Gemini 5 RPM free tier). */
  scenarioDelayMs?: number
}

export interface DeterministicCheckResult {
  assertion: string
  passed: boolean
  actual: unknown
}

export interface SecurityCheckResult {
  passed: boolean
  violations: string[]
}

export interface BenchmarkResult {
  scenarioId: string
  category: BenchmarkScenario['category']
  severity: BenchmarkScenario['severity']
  mode: BenchmarkMode
  passed: boolean
  durationMs: number
  output: AnalyzeOutput | null
  error: string | null
  /** Structured LLM error code extracted from traces (e.g. "diagnosisAgent::LLM_AUTH_ERROR").
   * Null when no LLM error occurred. Used to surface hidden failures that don't reach result.error. */
  llmDiagnosis: string | null
  deterministicChecks: DeterministicCheckResult[]
  securityCheck: SecurityCheckResult
  tokensUsed: number
  requiresHumanReview: boolean
  reviewNotes?: string
}

export interface BenchmarkCategorySummary {
  category: string
  total: number
  passed: number
  failed: number
  passRate: number
  avgDurationMs: number
  totalTokens: number
}

export interface BenchmarkSummary {
  runId: string
  startedAt: string
  completedAt: string
  mode: BenchmarkMode
  total: number
  passed: number
  failed: number
  errors: number
  passRate: number
  byCategory: BenchmarkCategorySummary[]
  latencyMs: { p50: number; p95: number; max: number }
  totalTokensUsed: number
  estimatedCostUsd: number | null
  humanReviewRequired: number
  results: BenchmarkResult[]
}

export interface BenchmarkRun {
  config: BenchmarkRunConfig
  scenarios: BenchmarkScenario[]
  results: BenchmarkResult[]
  summary: BenchmarkSummary | null
}
