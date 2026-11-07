/**
 * Pure utility functions for the Gemini connectivity test.
 * Exported separately so tests can import them without triggering the
 * script's top-level side effects (loadEnvLocal, real API call, process.exit).
 */

import type { LLMCompletionRequest, LLMResult } from '../../src/agents/llm/llm-adapter'

/** Returns true when GEMINI_CONNECTIVITY_AUTHORIZED=true in the given env map. */
export function isAuthorized(env: Partial<Record<string, string | undefined>>): boolean {
  return env['GEMINI_CONNECTIVITY_AUTHORIZED'] === 'true'
}

/**
 * Redacts an API key so it cannot be reconstructed from logs.
 * Shows only the last 4 characters.
 */
export function redactApiKey(key: string): string {
  if (!key) return '(not set)'
  if (key.length <= 4) return '****'
  return `...${key.slice(-4)}`
}

/**
 * The fixed synthetic request used for connectivity validation.
 * One request, minimal output, no real user data.
 *
 * maxTokens: 32 — enough for a single-word response, well below free-tier token cap.
 * timeoutMs: 15 000 — 15 s ceiling to surface connectivity issues quickly.
 * No model override — uses the adapter's configured model.
 */
export const CONNECTIVITY_REQUEST: LLMCompletionRequest = Object.freeze({
  system: 'Responde únicamente con la palabra OK.',
  userContent: 'OK',
  maxTokens: 32,
  timeoutMs: 15_000,
})

export interface ConnectivityResultSummary {
  model: string
  latencyMs: number
  result: LLMResult
}

/** Formats a connectivity result into printable lines. No I/O side effects. */
export function formatConnectivityResult(summary: ConnectivityResultSummary): string[] {
  const { model, latencyMs, result } = summary
  if (result.ok) {
    const lines = [
      `STATUS  : OK`,
      `Model   : ${model}`,
      `Latency : ${latencyMs}ms`,
    ]
    if (result.tokensUsed !== undefined) {
      lines.push(`Tokens  : ${result.tokensUsed}`)
    }
    return lines
  }
  return [
    `STATUS  : FAILED`,
    `Model   : ${model}`,
    `Error   : ${result.error.code}`,
    `Detail  : ${result.error.message}`,
    `Latency : ${latencyMs}ms`,
  ]
}
