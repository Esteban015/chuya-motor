import { validateDiagnosisOutput, type OutputSafetyViolation } from '@/domain/safety/output-safety'
import { resolveUserFacingSeverity } from '@/domain/safety/severity-assessor'
import type { GraphState } from '../graph-state'
import { createTrace } from '../trace'

const NODE_ID = 'outputSafetyGuard'

/** Fixed, deterministic notice shown when the LLM answer is withheld (never LLM-generated). */
export const OUTPUT_WITHHELD_WARNING =
  'La orientación generada automáticamente fue retenida porque no superó la validación de seguridad. Consultá con un taller o mecánico habilitado.'

/**
 * 6.4F (D-14): extra fixed notice when the withheld answer suggested handling the battery, bridging
 * cables or high voltage — tells the user explicitly what NOT to do (never LLM-generated).
 */
export const ELECTRICAL_CHECK_WITHHELD_WARNING =
  'La orientación sugería una comprobación que implica manipular la batería o el sistema eléctrico. No lo hagas por tu cuenta: pedí esa verificación en un taller o a un electricista del automotor.'

/** Fixed warnings for a withheld answer (shared by diagnosisAgent and this node). */
export function withheldWarnings(violations: readonly OutputSafetyViolation[] = []): string[] {
  return violations.includes('UNSAFE_ELECTRICAL_CHECK')
    ? [OUTPUT_WITHHELD_WARNING, ELECTRICAL_CHECK_WITHHELD_WARNING]
    : [OUTPUT_WITHHELD_WARNING]
}

/**
 * Incremento 6.4B (D-05) — server-side output safety layer between diagnosisAgent and evaluator.
 *
 * Unsafe or structurally invalid LLM output is withheld as a whole: facts, hypotheses and
 * questions are cleared, fallback=true (fixed FALLBACK_TEXT) and a fixed warning identify the
 * result. There is no retry and no silent fallback to the Stub. Fails closed on internal errors.
 * Traces carry only structural codes — never user or LLM text.
 */
export async function outputSafetyGuardNode(state: GraphState): Promise<Partial<GraphState>> {
  const startTime = Date.now()
  const { caseId, dataLabel } = state

  if (state.fallback || state.safety?.blocked || state.route !== 'symptom') {
    return { traces: [createTrace(caseId, NODE_ID, startTime, 'skipped', { dataLabel, resultType: 'output_safety_skipped' })] }
  }

  const withhold = (errorCode: string, violations: readonly OutputSafetyViolation[] = []): Partial<GraphState> => ({
    facts: [],
    hypotheses: [],
    questions: [],
    driverQuestions: [],
    fallback: true,
    errorCode,
    warnings: withheldWarnings(violations),
    traces: [
      createTrace(caseId, NODE_ID, startTime, 'fallback_used', {
        dataLabel,
        errorCode,
        fallbackActivated: true,
        resultType: 'output_safety_rejected',
      }),
    ],
  })

  try {
    const severity = resolveUserFacingSeverity({ userText: state.userText, safetyBlocked: false, route: state.route })
    const result = validateDiagnosisOutput(
      { facts: state.facts, hypotheses: state.hypotheses, questions: state.questions, driverQuestions: state.driverQuestions },
      { severityLevel: severity?.level ?? 'normal' },
    )
    if (!result.safe) return withhold('LLM_OUTPUT_UNSAFE', result.violations)
    return {
      traces: [createTrace(caseId, NODE_ID, startTime, 'success', { dataLabel, resultType: 'output_safety_passed' })],
    }
  } catch {
    return withhold('OUTPUT_SAFETY_INTERNAL_ERROR')
  }
}
