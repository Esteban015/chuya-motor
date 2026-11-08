/**
 * Evaluation outcomes for benchmark results.
 *
 * Distinguishes structural correctness (can be evaluated automatically)
 * from semantic correctness (requires human review).
 *
 * EvaluationOutcome is not a quality score — it classifies the type of result
 * so the campaign runner can route results correctly and generate accurate reports.
 */

export type EvaluationOutcome =
  | 'PASSED'               // All deterministic checks pass; no human review needed
  | 'PASSED_PENDING_REVIEW'// Structural pass; semantic review required
  | 'FAILED_STRUCTURAL'    // One or more deterministic assertions failed
  | 'FAILED_SAFETY'        // Critical security violation (CF-01..CF-06)
  | 'PROVIDER_ERROR'       // LLM call returned an error code (non-schema)
  | 'SCHEMA_ERROR'         // LLM returned invalid JSON or Zod-rejected structure
  | 'QUOTA_EXHAUSTED'      // Scenario not executed — adapter quota exhausted
  | 'TIMEOUT'              // Scenario execution exceeded timeoutMs
  | 'FALLBACK_ACTIVATED'   // output.fallback=true without a specific error code

/** Minimal fields needed to classify a result. Compatible with BenchmarkResult. */
export interface OutcomeInput {
  passed: boolean
  error: string | null
  llmDiagnosis: string | null
  output: { safetyBlocked: boolean; fallback: boolean } | null
  securityCheck: { passed: boolean; violations: string[] }
  requiresHumanReview: boolean
  deterministicChecks: Array<{ passed: boolean }>
}

export function classifyOutcome(r: OutcomeInput): EvaluationOutcome {
  // Quota exhausted — not executed
  if (r.error?.includes('QUOTA_EXHAUSTED')) return 'QUOTA_EXHAUSTED'

  // Timeout
  if (r.error?.toLowerCase().includes('timeout')) return 'TIMEOUT'

  // Generic execution error (non-quota, non-timeout)
  if (r.error) return 'PROVIDER_ERROR'

  // Fallback activated — dig into cause
  if (r.output?.fallback) {
    if (r.llmDiagnosis?.includes('LLM_SCHEMA_VIOLATION')) return 'SCHEMA_ERROR'
    if (r.llmDiagnosis) return 'PROVIDER_ERROR'
    return 'FALLBACK_ACTIVATED'
  }

  // Critical security violation (CF-01..CF-06)
  if (!r.securityCheck.passed) return 'FAILED_SAFETY'

  // Structural failure — deterministic assertions
  if (!r.passed) return 'FAILED_STRUCTURAL'

  // All checks passed
  return r.requiresHumanReview ? 'PASSED_PENDING_REVIEW' : 'PASSED'
}
