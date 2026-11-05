import type { DocumentSourcePort } from '@/sources/sources-port'
import type { GraphState } from '../graph-state'
import { createTrace } from '../trace'

const NODE_ID = 'evaluator'

export function createEvaluatorNode(documentSource: DocumentSourcePort) {
  return async function evaluatorNode(state: GraphState): Promise<Partial<GraphState>> {
    const startTime = Date.now()
    const { caseId, dataLabel } = state

    if (state.fallback) {
      return {
        traces: [createTrace(caseId, NODE_ID, startTime, 'skipped', { dataLabel })],
      }
    }

    try {
      const missingInformation: string[] = []
      const evidenceIds: string[] = []

      // Symptom route: check evidence for hypotheses
      if (state.route === 'symptom' && state.hypotheses.length > 0) {
        try {
          const evidences = await documentSource.search(state.route, {
            make: state.vehicle?.make,
            model: state.vehicle?.model,
            year: state.vehicle?.year,
          })
          for (const ev of evidences) {
            evidenceIds.push(ev.sourceId)
          }
        } catch {
          // Document source failure is non-fatal; evidence remains empty
        }
      }

      // Budget route: check for missing lines
      if (state.route === 'budget') {
        if (!state.budgetLines || state.budgetLines.length === 0) {
          missingInformation.push(
            'No se pudieron extraer partidas del presupuesto. Proporcionar lista detallada de ítems con importes.',
          )
        } else {
          const missingCount = state.budgetLines.filter((l) => l.status === 'missing').length
          if (missingCount > 0) {
            missingInformation.push(
              `${missingCount} partida(s) del presupuesto sin importe confirmado.`,
            )
          }
        }
      }

      // No hypotheses generated for symptom route
      if (state.route === 'symptom' && state.hypotheses.length === 0 && !state.fallback) {
        missingInformation.push(
          'No se generaron hipótesis orientativas. Proporcionar más detalles sobre el síntoma.',
        )
      }

      return {
        evidenceIds,
        missingInformation,
        traces: [createTrace(caseId, NODE_ID, startTime, 'success', { dataLabel })],
      }
    } catch {
      return {
        fallback: true,
        errorCode: 'EVALUATOR_INTERNAL_ERROR',
        traces: [
          createTrace(caseId, NODE_ID, startTime, 'error', {
            errorCode: 'EVALUATOR_INTERNAL_ERROR',
            dataLabel,
            fallbackActivated: true,
          }),
        ],
      }
    }
  }
}
