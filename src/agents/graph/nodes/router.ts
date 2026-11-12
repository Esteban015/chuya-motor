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

  // D-01 (Incremento 6.4A): whole-word match (plural allowed). Raw substrings made "ars" match
  // every "-arse" infinitive (frenarse, apagarse…) and "precio" match "aprecio", sending
  // symptom reports to the budget parser and suppressing the severity banner.
  if (BUDGET_KEYWORD_PATTERNS.some((re) => re.test(lower))) return 'budget'

  // "item: 3+ digit number" OR "item: N.NNN" (es-AR thousands format, DEF-03 fix).
  // Avoids false positives on "v8: 1" (< 3 consecutive digits, no thousands format).
  if (/^.+:\s*\$?\s*(\d{3,}|\d{1,3}(\.\d{3})+)/m.test(userText)) return 'budget'

  // D-07 (Incremento 6.4A): an itemised list whose amounts are all pending
  // ("Pastillas: a confirmar\nMano de obra: pendiente") is a budget, not a symptom.
  // Requires ≥2 such lines so a single "Síntoma: pendiente" stays a symptom.
  if ((userText.match(PENDING_LINE_PATTERN) ?? []).length >= 2) return 'budget'

  return 'symptom'
}

const BUDGET_KEYWORD_PATTERNS: readonly RegExp[] = BUDGET_KEYWORDS.map(
  (k) => new RegExp(`(?<![\\p{L}\\p{N}])${k}(?:s|es)?(?![\\p{L}\\p{N}])`, 'u'),
)

const PENDING_LINE_PATTERN =
  /^[^\n:]{2,80}:\s*(pendiente|a confirmar|por confirmar|a consultar|por consultar|sin precio|a cotizar)\s*\.?\s*$/gimu

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
