import { z } from 'zod'
import type { LLMAdapter } from '@/agents/llm/llm-adapter'
import { LLM_MOCK_MODEL } from '@/agents/llm/deterministic-mock-adapter'
import { BudgetLineSchema } from '@/domain/budget/budget'
import type { GraphState } from '../graph-state'
import { createTrace } from '../trace'

const NODE_ID = 'budgetParser'

const BudgetParseResponseSchema = z.object({
  lines: z.array(BudgetLineSchema).max(50),
  declaredTotalMinorUnit: z.number().int().nonnegative().nullable(),
  currency: z.enum(['ARS', 'USD']).nullable(),
})

function buildBudgetParsePrompt(state: GraphState): string {
  // Marker enables deterministic mock routing
  return [`[BUDGET_PARSE_REQUEST]`, state.userText].join('\n')
}

export function createBudgetParserNode(llmAdapter: LLMAdapter) {
  return async function budgetParserNode(state: GraphState): Promise<Partial<GraphState>> {
    const startTime = Date.now()
    const { caseId, dataLabel } = state

    try {
      const prompt = buildBudgetParsePrompt(state)
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

      const validated = BudgetParseResponseSchema.safeParse(parsed)
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
        budgetLines: validated.data.lines,
        declaredTotalMinorUnit: validated.data.declaredTotalMinorUnit,
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
        errorCode: 'BUDGET_PARSER_INTERNAL_ERROR',
        traces: [
          createTrace(caseId, NODE_ID, startTime, 'error', {
            llmCalled: false,
            errorCode: 'BUDGET_PARSER_INTERNAL_ERROR',
            dataLabel,
            fallbackActivated: true,
          }),
        ],
      }
    }
  }
}
