import type { GraphState, RouteIntent } from '../graph-state'
import { createTrace } from '../trace'

const NODE_ID = 'router'

const BUDGET_KEYWORDS = [
  'presupuesto',
  'costo',
  'precio',
  'importe',
  'cotizacion',
  'cotización',
  'cuánto cuesta',
  'cuanto cuesta',
  'ars',
  'usd',
  'pesos',
  'dolares',
  'dólares',
]

function detectRoute(userText: string): RouteIntent {
  const lower = userText.toLowerCase()

  if (/\$\s*\d/.test(userText)) return 'budget'

  if (BUDGET_KEYWORDS.some((k) => lower.includes(k))) return 'budget'

  // "item: 3+ digit number" OR "item: N.NNN" (es-AR thousands format, DEF-03 fix).
  // Avoids false positives on "v8: 1" (< 3 consecutive digits, no thousands format).
  if (/^.+:\s*\$?\s*(\d{3,}|\d{1,3}(\.\d{3})+)/m.test(userText)) return 'budget'

  return 'symptom'
}

export function routerNode(state: GraphState): Partial<GraphState> {
  const startTime = Date.now()
  const { caseId, dataLabel } = state

  try {
    // GAP-01 resolution: ambiguous intent + safety keyword is blocked by AM-01 in safetyGate.
    // Ambiguous queries without a safety keyword route normally (symptom/budget).
    // No DIY steps are emitted in MVP_01 — diagnosisAgent produces only orientative hypotheses
    // with explicit caveats, so routing ambiguous symptoms through the agent is safe.
    const route = detectRoute(state.userText)

    return {
      route,
      traces: [createTrace(caseId, NODE_ID, startTime, 'success', {
        dataLabel,
        resultType: `route_${route}`,
      })],
    }
  } catch {
    return {
      fallback: true,
      errorCode: 'ROUTER_INTERNAL_ERROR',
      traces: [
        createTrace(caseId, NODE_ID, startTime, 'error', {
          errorCode: 'ROUTER_INTERNAL_ERROR',
          dataLabel,
          fallbackActivated: true,
          resultType: 'route_failed',
        }),
      ],
    }
  }
}
