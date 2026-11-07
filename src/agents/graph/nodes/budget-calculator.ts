import { determineBudgetState, type BudgetLineConfirmed } from '@/domain/budget/budget'
import type { GraphState } from '../graph-state'
import { createTrace } from '../trace'

const NODE_ID = 'budgetCalculator'

export async function budgetCalculatorNode(state: GraphState): Promise<Partial<GraphState>> {
  const startTime = Date.now()
  const { caseId, dataLabel } = state

  if (state.fallback || !state.budgetLines) {
    return {
      traces: [createTrace(caseId, NODE_ID, startTime, 'skipped', { dataLabel, resultType: 'budget_skipped' })],
    }
  }

  try {
    // D-3: deterministic integer arithmetic — never LLM for totals (Ajuste A)
    // Extract currency from confirmed lines; pass to determineBudgetState for the state record
    const confirmedLines = state.budgetLines.filter(
      (l): l is BudgetLineConfirmed => l.status === 'confirmed',
    )
    const currencySet = new Set(confirmedLines.map((l) => l.currency))
    const currency = currencySet.size === 1 ? ([...currencySet][0] as BudgetLineConfirmed['currency']) : null

    const budgetState = determineBudgetState(state.budgetLines, state.declaredTotalMinorUnit ?? null, currency)

    const warnings: string[] = []
    if (budgetState.completenessStatus === 'PARTIAL') {
      warnings.push('El presupuesto está incompleto: algunas partidas no tienen importe confirmado.')
    } else if (budgetState.completenessStatus === 'INVALID') {
      warnings.push('No se pudieron extraer partidas válidas del presupuesto.')
    }

    return {
      budgetState,
      warnings,
      traces: [createTrace(caseId, NODE_ID, startTime, 'success', {
        dataLabel,
        resultType: `budget_${budgetState.completenessStatus.toLowerCase()}`,
      })],
    }
  } catch {
    return {
      fallback: true,
      errorCode: 'BUDGET_CALC_INTERNAL_ERROR',
      traces: [
        createTrace(caseId, NODE_ID, startTime, 'error', {
          errorCode: 'BUDGET_CALC_INTERNAL_ERROR',
          dataLabel,
          fallbackActivated: true,
          resultType: 'budget_failed',
        }),
      ],
    }
  }
}
