import { z } from 'zod'
import type { LLMAdapter, LLMCompletionRequest } from '@/agents/llm/llm-adapter'
import { extractJSON } from '@/agents/llm/llm-json-extract'
import { availabilityWarnings, PROTECTION_ERROR_CODES } from '@/agents/llm/llm-availability'
import { BudgetLineSchema } from '@/domain/budget/budget'
import type { GraphState } from '../graph-state'
import { createTrace } from '../trace'

const NODE_ID = 'budgetParser'

const BudgetParseResponseSchema = z.object({
  lines: z.array(BudgetLineSchema).max(50),
  declaredTotalMinorUnit: z.number().int().nonnegative().nullable(),
  currency: z.enum(['ARS', 'USD']).nullable(),
})

function buildBudgetParseRequest(state: GraphState): LLMCompletionRequest {
  return {
    // [BUDGET_PARSE_REQUEST] marker enables deterministic mock routing
    system:
      '[BUDGET_PARSE_REQUEST]\nExtrae las líneas de presupuesto del texto del usuario. ' +
      'Respondé ÚNICAMENTE con JSON válido. Sin bloques Markdown. Sin texto antes ni después del JSON. ' +
      'Estructura exacta: { "lines": [{ "status": "confirmed"|"missing", "description": string, "amountMinorUnit": integer, "currency": "ARS"|"USD" }], "declaredTotalMinorUnit": integer|null, "currency": "ARS"|"USD"|null }. ' +
      'Reglas: líneas con importe → status="confirmed", amountMinorUnit=importe*100 (entero, sin decimales), currency="ARS" o "USD". ' +
      'Líneas sin importe → { "status": "missing", "description": string } (omitir amountMinorUnit y currency). ' +
      'Si hay línea de Total: declaredTotalMinorUnit=total*100. ' +
      'Ejemplo: "Aceite: 4500" → { "status": "confirmed", "description": "Aceite", "amountMinorUnit": 450000, "currency": "ARS" }. ' +
      'Máximo 50 líneas. No inventar precios faltantes.',
    userContent: state.userText,  // user content isolated — never mixed with instructions
  }
}

export function createBudgetParserNode(llmAdapter: LLMAdapter) {
  return async function budgetParserNode(state: GraphState): Promise<Partial<GraphState>> {
    const startTime = Date.now()
    const { caseId, dataLabel } = state
    const model = llmAdapter.modelId

    try {
      const req = buildBudgetParseRequest(state)
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
              resultType: 'budget_llm_error',
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
              resultType: 'budget_schema_error',
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
              llmModel: model,
              errorCode: 'LLM_SCHEMA_VIOLATION',
              dataLabel,
              fallbackActivated: true,
              tokensUsed: result.tokensUsed,
              resultType: 'budget_schema_error',
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
            llmModel: model,
            dataLabel,
            tokensUsed: result.tokensUsed,
            resultType: 'budget_parsed',
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
            resultType: 'budget_parser_failed',
          }),
        ],
      }
    }
  }
}
