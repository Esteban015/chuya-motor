import type { BenchmarkScenario } from '../dataset/types'
import type { AnalyzeOutput } from '@/agents/graph/types'
import type { EvaluationOutcome } from './outcome'
import type { LLMAdapter } from '@/agents/llm/llm-adapter'

export type BenchmarkMode = 'mock' | 'simulated' | 'real'

export interface BenchmarkRunConfig {
  mode: BenchmarkMode
  maxScenariosPerCategory?: number
  timeoutMs?: number
  budgetLimitTokens?: number
  /** Minimum wait between consecutive scenarios (ms). Use for rate-limited providers (e.g. Gemini 5 RPM free tier). */
  scenarioDelayMs?: number
  /** Pre-created adapter to use instead of the default for this mode. Used by campaign runner for quota sharing. */
  llmAdapter?: LLMAdapter
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
  /** Classified outcome for routing results in campaign reports. Always set by runner.ts; optional for backward compat with test fixtures. */
  outcome?: EvaluationOutcome
  /** Number of real LLM calls made during this scenario (0 for mock/safety-blocked/quota-exhausted). */
  realRequestsUsed?: number
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

export interface CampaignConfig {
  mode: BenchmarkMode
  /** Max number of real LLM calls for the entire campaign. Shared across all scenarios. */
  maxRealRequestsPerCampaign?: number
  /** Run only these scenario IDs. If combined with categories, union is used. */
  scenarioIds?: string[]
  /** Run only scenarios matching these categories. */
  categories?: string[]
  /** Generate a batch summary after every N scenarios. Default: all. */
  batchSize?: number
  /** Max requests per minute. Applied as a time-based delay between real calls. */
  rpmLimit?: number
  /** Fixed wait between consecutive scenarios (ms), regardless of execution time. */
  scenarioDelayMs?: number
  timeoutMs?: number
  /** Prior results to resume from — completed scenarios are skipped (unless allowRerun=true). */
  resumeFrom?: BenchmarkResult[]
  allowRerun?: boolean
  budgetLimitTokens?: number
  /** Inject a pre-created adapter (for testing or sharing). If omitted, campaign creates its own. */
  llmAdapter?: LLMAdapter
  /** Called after each scenario completes (before the next one starts). Used for incremental persistence. */
  onScenarioComplete?: (result: BenchmarkResult, remainingIds: string[]) => void | Promise<void>
}

export interface CampaignResult {
  campaignId: string
  /** Encoded as `v${scenarioCount}` from the dataset used. */
  datasetVersion: string
  startedAt: string
  completedAt: string
  mode: BenchmarkMode
  model: string
  realRequestsUsed: number
  realRequestsLimit: number
  totalDelayAppliedMs: number
  completed: BenchmarkResult[]
  skipped: BenchmarkResult[]
  /** Scenario IDs that were selected but not reached (campaign stopped early). */
  pendingScenarios: string[]
  batchSummaries: BenchmarkSummary[]
}
