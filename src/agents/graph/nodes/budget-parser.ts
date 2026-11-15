import { z } from 'zod'
import type { LLMAdapter, LLMCompletionRequest, LLMError } from '@/agents/llm/llm-adapter'
import { extractJSON } from '@/agents/llm/llm-json-extract'
import { availabilityWarnings, PROTECTION_ERROR_CODES } from '@/agents/llm/llm-availability'
import { BudgetLineSchema } from '@/domain/budget/budget'
import { analysisFromLlmLines, analyzeBudgetText, hasInterpretableItems, toBudgetLines, type BudgetTextAnalysis } from '@/domain/budget/deterministic-budget'
import type { GraphState } from '../graph-state'
import { createTrace } from '../trace'

const NODE_ID = 'budgetParser'

/*
 * 7E — Deterministic first, independent of the AI.
 *   1. The text is always read deterministically (analyzeBudgetText). No LLM involved.
 *   2. The LLM is called ONCE, as before (never retried, never a second call to compensate).
 *   3. Interpretable deterministic lines → they are the result, whatever the LLM says or does:
 *      the LLM can never change an amount. An LLM failure only sets `aiUnavailable`.
 *   4. No interpretable lines → the LLM lines are used, but an amount survives only if that exact
 *      figure is written in the text (analysisFromLlmLines). LLM failure → fallback as before.
 * The Safety Gate ran before this node (graph order); a blocked request never gets here.
 */

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

    let deterministic: BudgetTextAnalysis | null = null
    try {
      deterministic = analyzeBudgetText(state.userText)
    } catch {
      deterministic = null
    }
    const usable = deterministic !== null && hasInterpretableItems(deterministic)

    const fromDeterministic = (extra: Partial<GraphState>, resultType: string, status: 'success' | 'fallback_used', meta: Record<string, unknown>): Partial<GraphState> => ({
      budgetAnalysis: deterministic,
      budgetSource: 'deterministic',
      budgetLines: toBudgetLines(deterministic!),
      declaredTotalMinorUnit: deterministic!.declaredTotalMinorUnit,
      ...extra,
      traces: [createTrace(caseId, NODE_ID, startTime, status, { llmModel: model, dataLabel, resultType, ...meta })],
    })

    /** The AI step failed: keep the deterministic result when there is one, else fall back. */
    const onAiFailure = (errorCode: string, llmCalled: boolean, tokensUsed: number | undefined, failureType: string, status: 'fallback_used' | 'error' = 'fallback_used'): Partial<GraphState> => {
      if (usable) {
        return fromDeterministic(
          { aiUnavailable: true, errorCode },
          'budget_parsed_deterministic_ai_unavailable',
          'fallback_used',
          { llmCalled, errorCode, tokensUsed, fallbackActivated: false },
        )
      }
      return {
        fallback: true,
        errorCode,
        budgetAnalysis: deterministic,
        // 6.4D: fixed notice only when the protection layer refused the call (no provider call).
        warnings: availabilityWarnings(errorCode as LLMError['code']),
        traces: [
          createTrace(caseId, NODE_ID, startTime, status, {
            llmCalled,
            llmModel: model,
            errorCode,
            dataLabel,
            fallbackActivated: true,
            tokensUsed,
            resultType: failureType,
          }),
        ],
      }
    }

    try {
      const req = buildBudgetParseRequest(state)
      const result = await llmAdapter.complete(req)

      if (!result.ok) {
        return onAiFailure(result.error.code, !PROTECTION_ERROR_CODES.has(result.error.code), undefined, 'budget_llm_error')
      }

      let parsed: unknown
      try {
        // extractJSON strips markdown code blocks (Gemini Flash frequently adds them)
        parsed = JSON.parse(extractJSON(result.content))
      } catch {
        return onAiFailure('LLM_SCHEMA_VIOLATION', true, result.tokensUsed, 'budget_schema_error')
      }

      const validated = BudgetParseResponseSchema.safeParse(parsed)
      if (!validated.success) {
        return onAiFailure('LLM_SCHEMA_VIOLATION', true, result.tokensUsed, 'budget_schema_error')
      }

      // The AI answered. Deterministic lines still win: the LLM never alters a computed amount.
      if (usable) {
        return fromDeterministic({}, 'budget_parsed_deterministic', 'success', { llmCalled: true, tokensUsed: result.tokensUsed })
      }

      const analysis = analysisFromLlmLines(state.userText, validated.data.lines, validated.data.declaredTotalMinorUnit)
      return {
        budgetAnalysis: analysis,
        budgetSource: 'llm',
        budgetLines: toBudgetLines(analysis),
        declaredTotalMinorUnit: analysis.declaredTotalMinorUnit,
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
      // Adapter threw (should not happen: adapters return errors). Same rule: keep deterministic.
      return onAiFailure('BUDGET_PARSER_INTERNAL_ERROR', false, undefined, 'budget_parser_failed', 'error')
    }
  }
}
