import { z } from 'zod'
import type { LLMAdapter, LLMCompletionRequest } from '@/agents/llm/llm-adapter'
import { extractJSON } from '@/agents/llm/llm-json-extract'
import type { GraphState } from '../graph-state'
import { HypothesisSchema } from '../types'
import { createTrace } from '../trace'

const NODE_ID = 'diagnosisAgent'

const DiagnosisResponseSchema = z.object({
  facts: z.array(z.string().max(500)).max(10),
  hypotheses: z.array(HypothesisSchema).max(5),
  questions: z.array(z.string().max(300)).max(5),
})

function buildDiagnosisRequest(state: GraphState): LLMCompletionRequest {
  const vehicleLine = state.vehicle
    ? `${state.vehicle.make ?? ''} ${state.vehicle.model ?? ''} ${state.vehicle.year ?? ''}`.trim()
    : 'No especificado'

  return {
    // [DIAGNOSIS_REQUEST] marker enables deterministic mock routing
    system:
      '[DIAGNOSIS_REQUEST]\nAnalizá los síntomas del vehículo y generá hipótesis de diagnóstico orientativas. ' +
      'Respondé ÚNICAMENTE con JSON válido. Sin bloques Markdown. Sin texto antes ni después del JSON. ' +
      'Estructura exacta: { "facts": string[], "hypotheses": [{ "statement": string, "confidence": "low"|"medium"|"high", "caveats": string[], "evidenceIds": string[] }], "questions": string[] }. ' +
      'IMPORTANTE: confidence DEBE ser exactamente una de estas tres cadenas: "low", "medium" o "high". No usar valores numéricos. ' +
      'Máximo: 10 facts, 5 hypotheses, 5 questions. No afirmes diagnósticos definitivos.',
    userContent: [
      `Vehículo: ${vehicleLine}`,
      `Nivel de experiencia: ${state.experienceLevel}`,
      `Síntoma: ${state.userText ?? ''}`,
    ].join('\n'),
  }
}

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
          traces: [
            createTrace(caseId, NODE_ID, startTime, 'fallback_used', {
              llmCalled: true,
              llmModel: model,
              errorCode: result.error.code,
              dataLabel,
              fallbackActivated: true,
              resultType: 'diagnosis_llm_error',
            }),
          ],
        }
      }

      let parsed: unknown
      try {
        // extractJSON strips markdown code blocks (Gemini Flash frequently adds them)
        parsed = JSON.parse(extractJSON(result.content))
      } catch {
        return {
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
            }),
          ],
        }
      }

      const validated = DiagnosisResponseSchema.safeParse(parsed)
      if (!validated.success) {
        return {
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
            }),
          ],
        }
      }

      return {
        facts: validated.data.facts,
        hypotheses: validated.data.hypotheses,
        questions: validated.data.questions,
        traces: [
          createTrace(caseId, NODE_ID, startTime, 'success', {
            llmCalled: true,
            llmModel: model,
            dataLabel,
            tokensUsed: result.tokensUsed,
            resultType: 'hypotheses_generated',
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
