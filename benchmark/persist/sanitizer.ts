import type { BenchmarkResult } from '../runner/types'
import type { PersistedScenarioResult } from './types'

// Safe error codes — the only information surfaced from raw error/llmDiagnosis strings.
// Raw error messages are never stored (they may contain sensitive context or user input).
const KNOWN_REASON_CODES: readonly string[] = [
  'QUOTA_EXHAUSTED',
  'TIMEOUT',
  'LLM_AUTH_ERROR',
  'LLM_SCHEMA_VIOLATION',
  'PROVIDER_ERROR',
  'SCHEMA_ERROR',
  'FALLBACK_ACTIVATED',
  'SAFETY_BLOCKED',
  'MISSING_CASE_ID',
  'INVALID_CASE_ID',
]

function extractReasonCode(error: string | null, llmDiagnosis: string | null): string | null {
  if (!error && !llmDiagnosis) return null
  const haystack = `${error ?? ''} ${llmDiagnosis ?? ''}`
  for (const code of KNOWN_REASON_CODES) {
    if (haystack.includes(code)) return code
  }
  if (error) return 'UNKNOWN_ERROR'
  return null
}

/**
 * Extracts only the safe allowlist fields from a BenchmarkResult.
 * Never includes: LLM-generated content (facts, hypotheses, questions, warnings),
 * raw error messages, internal prompts, trace data, or credentials.
 */
export function sanitizeForPersistence(result: BenchmarkResult): PersistedScenarioResult {
  return {
    scenarioId: result.scenarioId,
    caseId: result.output?.caseId ?? null,
    outcome: result.outcome ?? 'FAILED_STRUCTURAL',
    passed: result.passed,
    durationMs: result.durationMs,
    realRequestsUsed: result.realRequestsUsed ?? 0,
    tokensUsed: result.tokensUsed,
    safetyBlocked: result.output?.safetyBlocked ?? false,
    fallback: result.output?.fallback ?? false,
    humanReviewRequired: result.requiresHumanReview,
    reasonCode: extractReasonCode(result.error, result.llmDiagnosis),
  }
}

/** Derives a safe provider name from the model ID or run mode. Never exposes API keys. */
export function deriveProvider(modelId: string, mode: 'mock' | 'simulated' | 'real'): string {
  if (mode !== 'real') return 'mock'
  if (modelId.startsWith('gemini')) return 'google'
  if (modelId.startsWith('claude')) return 'anthropic'
  return process.env['LLM_PROVIDER'] ?? 'unknown'
}
