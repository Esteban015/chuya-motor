/**
 * ai-status.ts — Which processing produced a 200 response (Incremento 6.4E, server-side).
 *
 * Derived deterministically from the TrackedLLMAdapter snapshot and the final output, never
 * from the LLM. The client renders the badge from this field only:
 *   ai          → a real provider answered and the answer passed every server-side check
 *   simulated   → the stub answered (demo mode)
 *   withheld    → the AI answered but the output safety validator withheld it (D-05)
 *   unavailable → no usable AI answer: visitor limit, daily quota, busy, disabled, provider error
 *                 (7E: also when deterministic budget results are shown without the AI)
 *   none        → no generative step ran
 * Precedence: withheld > unavailable (fallback) > ai / simulated > none. A failed real call is
 * never labeled "simulated": there is no fallback to the stub.
 */
import { OUTPUT_WITHHELD_WARNING } from '@/agents/graph/nodes/output-safety-guard'
import { unavailableReasonFor } from '@/agents/llm/llm-availability'
import type { ProcessingSnapshot } from '@/server/llm-protection/processing-tracker'
import type { AiStatus } from './schema'

export function deriveAiStatus(
  snapshot: ProcessingSnapshot,
  output: { fallback: boolean; warnings: readonly string[]; aiUnavailable?: boolean },
): AiStatus {
  if (output.warnings.includes(OUTPUT_WITHHELD_WARNING)) return { mode: 'withheld' }
  // 7E: aiUnavailable = the AI failed but deterministic results were kept: still "unavailable".
  if (output.fallback || output.aiUnavailable) {
    return { mode: 'unavailable', reason: snapshot.attempts === 0 ? 'provider_error' : unavailableReasonFor(snapshot.lastErrorCode) }
  }
  if (snapshot.succeeded > 0) return { mode: snapshot.kind === 'stub' ? 'simulated' : 'ai' }
  return { mode: 'none' }
}
