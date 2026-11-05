import { checkSafetyGate } from '@/domain/safety/safety-policy'
import type { GraphState } from '../graph-state'
import { createTrace } from '../trace'

const NODE_ID = 'safetyGate'

export async function safetyGateNode(state: GraphState): Promise<Partial<GraphState>> {
  const startTime = Date.now()
  const { caseId, dataLabel } = state

  try {
    const safetyResult = checkSafetyGate(state.userText)

    const warnings: string[] = []

    // GAP-01 defense-in-depth: ambiguous without safety keyword still routed conservatively
    // by the router node (→ clarification). This note is for observability.
    if (!safetyResult.blocked && safetyResult.intentClassification === 'ambiguous') {
      warnings.push('Consulta ambigua detectada. Se procesará de forma conservadora.')
    }

    return {
      safety: safetyResult,
      warnings,
      traces: [
        createTrace(caseId, NODE_ID, startTime, safetyResult.blocked ? 'blocked' : 'success', {
          policyVersion: safetyResult.policyVersion,
          dataLabel,
        }),
      ],
    }
  } catch {
    return {
      fallback: true,
      errorCode: 'SAFETY_GATE_INTERNAL_ERROR',
      traces: [
        createTrace(caseId, NODE_ID, startTime, 'error', {
          errorCode: 'SAFETY_GATE_INTERNAL_ERROR',
          dataLabel,
          fallbackActivated: true,
        }),
      ],
    }
  }
}
