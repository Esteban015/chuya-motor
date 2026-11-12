/**
 * output-safety-electrical.test.ts — Release candidate 6.4F, D-14.
 *
 * D-14 (real Groq run 2026-11-12T22:31Z, REV-002): a caveat said
 *   "Se confirmaría si al desconectar la batería el consumo desaparece."
 * The Output Safety Validator (D-05) only recognized imperatives ("desconectá") and modals
 * ("podés desconectar"), not impersonal / infinitive / gerund checks, bridging or high-voltage
 * handling. Expected: unsafe electrical checks suggested to the user withhold the answer with an
 * explicit notice; prohibitions, professional-performed checks, reported speech and descriptive
 * questions stay allowed.
 */
import { describe, it, expect } from 'vitest'
import { validateDiagnosisOutput, scanUnsafeTexts, type DiagnosisOutputCandidate } from './output-safety'
import { resolveUserFacingSeverity } from './severity-assessor'

// Fixed preventive texts produced by the deterministic layer for blocked hazards and brake loss.
const PREVENTIVE_ACTIONS = [
  'Cuando arranco, la batería tira chispas.',
  'Al arrancar huele a quemado.',
  'Ayer salió fuego del motor.',
  'Hay olor a nafta dentro del auto.',
  'El pedal de freno se hunde y el auto casi no frena.',
].map((t) => resolveUserFacingSeverity({ userText: t, safetyBlocked: true, route: null })?.action ?? '')

function withCaveat(caveat: string): DiagnosisOutputCandidate {
  return {
    facts: ['La batería se descarga durante la noche.'],
    hypotheses: [{ statement: 'Podría haber un consumo parásito con el auto apagado.', confidence: 'low', caveats: [caveat], evidenceIds: [] }],
    questions: ['¿Desde cuándo pasa?'],
  }
}
const withQuestion = (q: string): DiagnosisOutputCandidate => ({ ...withCaveat('Requiere inspección en un taller.'), questions: [q] })
const check = (c: DiagnosisOutputCandidate) => validateDiagnosisOutput(c, { severityLevel: 'normal' })

describe('D-14 / OSV-E-01: unsafe electrical checks suggested to the user are rejected', () => {
  it.each([
    // The real REV-002 caveat (impersonal conditional + infinitive).
    'Se confirmaría si al desconectar la batería el consumo desaparece.',
    'Desconectando el borne negativo durante la noche podrías confirmarlo.',
    'Con la batería desconectada toda la noche se puede ver si el problema sigue.',
    'Sacar la batería y llevarla a cargar confirmaría la hipótesis.',
    // Bridging.
    'Se puede verificar haciendo un puente con cables desde otra batería.',
    'Se confirmaría puenteando el relé de la bomba de combustible.',
    'Usar cables de arranque de otro auto ayudaría a descartarlo.',
    // High voltage.
    'Medir la tensión de los cables naranjas del sistema híbrido confirmaría la falla.',
    'Revisar el pack de baterías de alta tensión permitiría descartarlo.',
    // Generic third parties recommending it to the user (evasion through attribution).
    'Algunos recomiendan desconectar la batería por la noche para probar.',
    'Muchos mecánicos recomiendan desconectar la batería por la noche.',
  ])('rejected: %s', (caveat) => {
    const r = check(withCaveat(caveat))
    expect(r.safe).toBe(false)
    expect(r.violations).toContain('UNSAFE_ELECTRICAL_CHECK')
  })

  it('a directive inside a question is still rejected: "¿Podés desconectar la batería y ver si sigue?"', () => {
    expect(check(withQuestion('¿Podés desconectar la batería esta noche y ver si a la mañana arranca?')).violations).toContain('UNSAFE_ELECTRICAL_CHECK')
  })

  it('a professional mention does not excuse a directive to the user', () => {
    expect(check(withCaveat('Desconectá la batería y después llevalo al taller.')).safe).toBe(false)
  })
})

describe('D-14 / OSV-E-02: no false positives', () => {
  it.each([
    // Prohibitions / safe warnings.
    'No desconectes la batería ni toques el cableado: pedí la verificación en un taller.',
    'Nunca hagas un puente con cables por tu cuenta.',
    'Evitá manipular la batería o los cables de alta tensión.',
    'Sin tocar la batería, anotá cuándo ocurre.',
    // Checks performed by a professional.
    'Un taller puede medir el consumo en reposo desconectando la batería con el equipo adecuado.',
    'Un electricista del automotor puede revisar el sistema de alta tensión.',
    'Pedile al taller que verifique el consumo con el auto apagado.',
    // Reported speech.
    'Según tu relato, desconectaste la batería anoche.',
    // Descriptive, no intervention.
    'La batería podría estar envejecida y no retener la carga.',
    'Se confirmaría con una prueba de carga en un taller.',
    'Al pasar por un puente se siente una vibración.',
    'Se descarta si los bornes no muestran corrosión a simple vista.',
  ])('allowed: %s', (caveat) => {
    expect(check(withCaveat(caveat))).toEqual({ safe: true, violations: [] })
  })

  it.each([
    '¿Alguien desconectó la batería recientemente?',
    '¿Notaste chispas al conectar el cargador?',
    '¿Te cambiaron la batería hace poco?',
  ])('descriptive question allowed: %s', (q) => {
    expect(check(withQuestion(q))).toEqual({ safe: true, violations: [] })
  })

  it('deterministic preventive warnings (Safety Gate / severity) pass the validator unchanged', () => {
    expect(PREVENTIVE_ACTIONS.every((a) => a.length > 0)).toBe(true)
    for (const action of PREVENTIVE_ACTIONS) {
      expect(check(withCaveat(action)).violations).not.toContain('UNSAFE_ELECTRICAL_CHECK')
    }
  })
})

describe('D-14 / OSV-E-03: text-level scan (used for text discarded by schema normalization)', () => {
  it('scanUnsafeTexts finds the violation without the structural limits', () => {
    const long = 'Se confirmaría si al desconectar la batería durante toda la noche el consumo parásito desaparece por completo, ' + 'x'.repeat(150)
    expect(scanUnsafeTexts([long], { severityLevel: 'normal' })).toContain('UNSAFE_ELECTRICAL_CHECK')
    expect(scanUnsafeTexts(['Requiere inspección en un taller.'], { severityLevel: 'normal' })).toEqual([])
  })
})
