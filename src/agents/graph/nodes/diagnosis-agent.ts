import { z } from 'zod'
import type { LLMAdapter } from '@/agents/llm/llm-adapter'
import { refineDiagnosisOutput } from '@/domain/quality/diagnosis-quality'
import { buildDiagnosisRequest, vehicleLineOf } from './diagnosis-prompt'
import { extractJSON } from '@/agents/llm/llm-json-extract'
import { availabilityWarnings, PROTECTION_ERROR_CODES } from '@/agents/llm/llm-availability'
import { describeZodIssues, normalizeDiagnosisCandidate } from '@/domain/quality/diagnosis-normalization'
import { scanUnsafeTexts } from '@/domain/safety/output-safety'
import { resolveUserFacingSeverity } from '@/domain/safety/severity-assessor'
import { withheldWarnings } from './output-safety-guard'
import type { GraphState } from '../graph-state'
import { HypothesisSchema } from '../types'
import { createTrace } from '../trace'

const NODE_ID = 'diagnosisAgent'

// Prompt: diagnosis-prompt.ts (v2.0.0, 6.4D) — shared by every provider.

const DiagnosisResponseSchema = z.object({
  facts: z.array(z.string().max(500)).max(10),
  hypotheses: z.array(HypothesisSchema).max(5),
  questions: z.array(z.string().max(300)).max(5),
})

export function createDiagnosisAgentNode(llmAdapter: LLMAdapter) {
  return async function diagnosisAgentNode(state: GraphState): Promise<Partial<GraphState>> {
    const startTime = Date.now()
    const { caseId, dataLabel } = state
    const model = llmAdapter.modelId

    try {
      const req = buildDiagnosisRequest(state)
      const result = await llmAdapter.complete(req)

      if (!result.ok) {
        return {
          fallback: true,
          errorCode: result.error.code,
          // 6.4D: fixed notice only when the protection layer refused the call (no provider call).
          warnings: availabilityWarnings(result.error.code),
          traces: [
            createTrace(caseId, NODE_ID, startTime, 'fallback_used', {
              llmCalled: !PROTECTION_ERROR_CODES.has(result.error.code),
              llmModel: model,
              errorCode: result.error.code,
              dataLabel,
              fallbackActivated: true,
              resultType: 'diagnosis_llm_error',
            }),
          ],
        }
      }

      // 6.4F (D-13): the failed / recovered constraint is recorded as a structural code only.
      const schemaFailure = (schemaIssues: string[]): Partial<GraphState> => ({
        fallback: true,
        errorCode: 'LLM_SCHEMA_VIOLATION',
        traces: [
          createTrace(caseId, NODE_ID, startTime, 'fallback_used', {
            llmCalled: true,
            llmModel: model,
            errorCode: 'LLM_SCHEMA_VIOLATION',
            dataLabel,
            fallbackActivated: true,
            tokensUsed: result.tokensUsed,
            resultType: 'diagnosis_schema_error',
            schemaIssues,
          }),
        ],
      })

      let parsed: unknown
      try {
        // extractJSON strips markdown code blocks (Gemini Flash frequently adds them)
        parsed = JSON.parse(extractJSON(result.content))
      } catch {
        return schemaFailure(['$:json_parse'])
      }

      // 6.4F (D-13): recover preventable format violations by REMOVING items (never truncating or
      // rewriting). Irrecoverable answers keep the safe fallback.
      const normalized = normalizeDiagnosisCandidate(parsed)
      if (!normalized.ok) return schemaFailure(normalized.issues)

      // Removed text is still scanned: normalization must never hide an unsafe recommendation.
      if (normalized.droppedTexts.length > 0) {
        const severity = resolveUserFacingSeverity({ userText: state.userText, safetyBlocked: false, route: state.route })
        const violations = scanUnsafeTexts(normalized.droppedTexts, { severityLevel: severity?.level ?? 'normal' })
        if (violations.length > 0) {
          return {
            facts: [],
            hypotheses: [],
            questions: [],
            fallback: true,
            errorCode: 'LLM_OUTPUT_UNSAFE',
            warnings: withheldWarnings(violations),
            traces: [
              createTrace(caseId, NODE_ID, startTime, 'fallback_used', {
                llmCalled: true,
                llmModel: model,
                errorCode: 'LLM_OUTPUT_UNSAFE',
                dataLabel,
                fallbackActivated: true,
                tokensUsed: result.tokensUsed,
                resultType: 'output_safety_rejected_in_removed_text',
                schemaIssues: normalized.issues,
              }),
            ],
          }
        }
      }

      // The Zod contract is unchanged and still authoritative.
      const validated = DiagnosisResponseSchema.safeParse(normalized.candidate)
      if (!validated.success) return schemaFailure(describeZodIssues(validated.error))

      // 6.4D (D-08..D-10): deterministic quality layer — removes internal labels, absences listed as
      // facts and ungrounded facts; caps confidence. It only removes or downgrades, never adds.
      const { output: refined } = refineDiagnosisOutput(validated.data, {
        userText: state.userText ?? '',
        vehicleLine: vehicleLineOf(state),
      })

      return {
        facts: refined.facts,
        hypotheses: refined.hypotheses,
        questions: refined.questions,
        traces: [
          createTrace(caseId, NODE_ID, startTime, 'success', {
            llmCalled: true,
            llmModel: model,
            dataLabel,
            tokensUsed: result.tokensUsed,
            resultType: normalized.issues.length > 0 ? 'hypotheses_generated_after_normalization' : 'hypotheses_generated',
            schemaIssues: normalized.issues,
          }),
        ],
      }
    } catch {
      return {
        fallback: true,
        errorCode: 'DIAGNOSIS_INTERNAL_ERROR',
        traces: [
          createTrace(caseId, NODE_ID, startTime, 'error', {
            llmCalled: false,
            errorCode: 'DIAGNOSIS_INTERNAL_ERROR',
            dataLabel,
            fallbackActivated: true,
            resultType: 'diagnosis_failed',
          }),
        ],
      }
    }
  }
}
