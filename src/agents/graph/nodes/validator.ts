import type { GraphState } from '../graph-state'
import { createTrace } from '../trace'

const NODE_ID = 'validator'

export async function validatorNode(state: GraphState): Promise<Partial<GraphState>> {
  const startTime = Date.now()
  const { caseId, dataLabel } = state

  try {
    const missingInformation: string[] = []

    if (!state.userText || state.userText.trim().length < 10) {
      return {
        fallback: true,
        errorCode: 'VALIDATION_TEXT_TOO_SHORT',
        missingInformation: ['Texto de consulta requerido (mínimo 10 caracteres).'],
        traces: [
          createTrace(caseId, NODE_ID, startTime, 'error', {
            errorCode: 'VALIDATION_TEXT_TOO_SHORT',
            dataLabel,
            fallbackActivated: true,
          }),
        ],
      }
    }

    if (!state.vehicle?.make || !state.vehicle?.model || !state.vehicle?.year) {
      missingInformation.push(
        'Marca, modelo y año del vehículo no especificados (hipótesis pueden ser menos precisas).',
      )
    }

    return {
      missingInformation,
      traces: [createTrace(caseId, NODE_ID, startTime, 'success', { dataLabel })],
    }
  } catch {
    return {
      fallback: true,
      errorCode: 'VALIDATOR_INTERNAL_ERROR',
      traces: [
        createTrace(caseId, NODE_ID, startTime, 'error', {
          errorCode: 'VALIDATOR_INTERNAL_ERROR',
          dataLabel,
          fallbackActivated: true,
        }),
      ],
    }
  }
}
