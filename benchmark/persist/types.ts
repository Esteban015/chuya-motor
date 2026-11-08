import { z } from 'zod'

export const PERSIST_SCHEMA_VERSION = '1.0.0'
export const MAX_RESULTS_FILE_BYTES = 1_048_576  // 1 MB hard ceiling

const EvaluationOutcomeSchema = z.enum([
  'PASSED',
  'PASSED_PENDING_REVIEW',
  'FAILED_STRUCTURAL',
  'FAILED_SAFETY',
  'PROVIDER_ERROR',
  'SCHEMA_ERROR',
  'QUOTA_EXHAUSTED',
  'TIMEOUT',
  'FALLBACK_ACTIVATED',
])

const BenchmarkModeSchema = z.enum(['mock', 'simulated', 'real'])

// Safe allowlist — no LLM-generated content, no credentials, no personal data.
// All fields are structural metrics derived from deterministic evaluation.
export const PersistedScenarioResultSchema = z.object({
  scenarioId: z.string().max(64),
  caseId: z.string().uuid().nullable(),
  outcome: EvaluationOutcomeSchema,
  passed: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  realRequestsUsed: z.number().int().nonnegative(),
  tokensUsed: z.number().int().nonnegative(),
  safetyBlocked: z.boolean(),
  fallback: z.boolean(),
  humanReviewRequired: z.boolean(),
  // reasonCode: safe enumerated error code extracted from error/llmDiagnosis — never raw message
  reasonCode: z.string().max(64).nullable(),
})
export type PersistedScenarioResult = z.infer<typeof PersistedScenarioResultSchema>

export const PersistedCampaignSchema = z.object({
  schemaVersion: z.literal(PERSIST_SCHEMA_VERSION),
  campaignId: z.string().uuid(),
  datasetVersion: z.string().max(64),
  safetyPolicyVersion: z.string().max(64),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  mode: BenchmarkModeSchema,
  provider: z.string().max(64),
  model: z.string().max(128),
  realRequestsUsed: z.number().int().nonnegative(),
  realRequestsLimit: z.number().int().nonnegative(),
  totalTokensUsed: z.number().int().nonnegative(),
  completed: z.array(PersistedScenarioResultSchema),
  skipped: z.array(PersistedScenarioResultSchema),
  pending: z.array(z.string().max(64)),
  status: z.enum(['running', 'completed', 'interrupted']),
})
export type PersistedCampaign = z.infer<typeof PersistedCampaignSchema>
