import { z } from 'zod'
import type { LLMAdapter } from '@/agents/llm/llm-adapter'
import { LLM_MOCK_MODEL } from '@/agents/llm/deterministic-mock-adapter'
import type { GraphState } from '../graph-state'
import { HypothesisSchema } from '../types'
import { createTrace } from '../trace'

const NODE_ID = 'diagnosisAgent'

const DiagnosisResponseSchema = z.object({
  facts: z.array(z.string().max(500)).max(10),
  hypotheses: z.array(HypothesisSchema).max(5),
  questions: z.array(z.string().max(300)).max(5),
})

function buildDiagnosisPrompt(state: GraphState): string {
  const vehicleLine = state.vehicle
    ? `${state.vehicle.make ?? ''} ${state.vehicle.model ?? ''} ${state.vehicle.year ?? ''}`.trim()
    : 'No especificado'

  // Prompt marker enables deterministic mock routing (never exposes real user text in traces)
  return [
    '[DIAGNOSIS_REQUEST]',
    `Vehículo: ${vehicleLine}`,
    `Nivel de experiencia: ${state.experienceLevel}`,
  ].join('\n')
}

export function createDiagnosisAgentNode(llmAdapter: LLMAdapter) {
  return async function diagnosisAgentNode(state: GraphState): Promise<Partial<GraphState>> {
    const startTime = Date.now()
    const { caseId, dataLabel } = state

    try {
      const prompt = buildDiagnosisPrompt(state)
      const result = await llmAdapter.complete(prompt)

      if (!result.ok) {
        return {
          fallback: true,
          errorCode: result.error.code,
          traces: [
            createTrace(caseId, NODE_ID, startTime, 'fallback_used', {
              llmCalled: true,
              llmModel: LLM_MOCK_MODEL,
              errorCode: result.error.code,
              dataLabel,
              fallbackActivated: true,
            }),
          ],
        }
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(result.content)
      } catch {
        return {
          fallback: true,
          errorCode: 'LLM_SCHEMA_VIOLATION',
          traces: [
            createTrace(caseId, NODE_ID, startTime, 'fallback_used', {
              llmCalled: true,
              llmModel: LLM_MOCK_MODEL,
              errorCode: 'LLM_SCHEMA_VIOLATION',
              dataLabel,
              fallbackActivated: true,
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
              llmModel: LLM_MOCK_MODEL,
              errorCode: 'LLM_SCHEMA_VIOLATION',
              dataLabel,
              fallbackActivated: true,
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
            llmModel: LLM_MOCK_MODEL,
            dataLabel,
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
          }),
        ],
      }
    }
  }
}
