/**
 * Gemini Free Tier configuration constants and local guard.
 *
 * DISCLAIMER: These are LOCAL limits only. They do NOT guarantee free-tier billing.
 * Actual quota and costs depend on your Google Cloud/AI Studio project, model, and region.
 *
 * To confirm free-tier usage:
 *  1. Use an API key from Google AI Studio (not a GCP project with billing enabled).
 *  2. Verify the model supports the free tier in your region:
 *     https://ai.google.dev/gemini-api/docs/rate-limits
 *  3. Monitor usage at: https://aistudio.google.com/
 *
 * Privacy notice for free tier (AI Studio key):
 *  Submitted data may be used by Google to improve products.
 *  Only use synthetic or non-personal data for benchmarks.
 *  See: https://ai.google.dev/gemini-api/terms
 */

// Verified via generateContent calls on a new AI Studio project (2026-11-07).
// Free-tier status must be confirmed at https://ai.google.dev/gemini-api/docs/rate-limits.
//
// History:
//   Removed (not accessible for new AI Studio projects):
//     gemini-1.5-flash, gemini-1.5-flash-8b, gemini-2.0-flash,
//     gemini-2.5-flash-preview-04-17, gemini-2.5-flash-lite (HTTP 404 on generateContent)
//   gemini-2.5-flash appears in ai.models.list() but returns HTTP 404 on generateContent
//     for new projects — kept for compatibility with established projects.
export const GEMINI_FREE_TIER_MODELS = [
  'gemini-3.5-flash-lite',  // primary — HTTP 200 on generateContent confirmed for new AI Studio projects
  'gemini-2.5-flash',       // secondary — may work for established projects; HTTP 404 on new ones
] as const satisfies readonly string[]

export const GEMINI_FREE_TIER_MODEL_SET: ReadonlySet<string> = new Set(GEMINI_FREE_TIER_MODELS)

export const FREE_TIER_PRIVACY_NOTICE =
  'Gemini free-tier (AI Studio key) may use submitted data to improve Google products. ' +
  'Only use synthetic data. See: https://ai.google.dev/gemini-api/terms'

export interface GeminiFreeTierLimits {
  /** Local guard against runaway calls. Does NOT guarantee free-tier billing. */
  maxRequestsPerRun: number
  /** Conservative output token limit for free-tier demos. */
  maxOutputTokens: number
}

export const DEFAULT_FREE_TIER_LIMITS: GeminiFreeTierLimits = {
  maxRequestsPerRun: 10,
  maxOutputTokens: 1024,
}

export function assertModelInFreeTierAllowlist(model: string): void {
  if (!GEMINI_FREE_TIER_MODEL_SET.has(model)) {
    throw new Error(
      `Model "${model}" is not in the free-tier allowlist for Chuya Motor demos.\n` +
        `Allowed models: ${GEMINI_FREE_TIER_MODELS.join(', ')}.\n` +
        `Verify current free-tier availability at: https://ai.google.dev/gemini-api/docs/rate-limits\n` +
        `To use a non-allowlisted model, update GEMINI_FREE_TIER_MODELS or disable the allowlist check.`,
    )
  }
}
