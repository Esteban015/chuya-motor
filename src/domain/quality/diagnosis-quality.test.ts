/**
 * diagnosis-quality.test.ts — Incremento 6.4D, Fase 2 (D-08..D-11, deterministic subset)
 *
 * Fixtures: facts/hypotheses copied from the authorized real Groq review (6.4C, synthetic scenarios,
 * no personal data). No network calls.
 */
import { describe, it, expect } from 'vitest'
import {
  refineDiagnosisOutput,
  groundingRatio,
  hasInsufficientInformation,
  type DiagnosisCandidate,
} from './diagnosis-quality'

type H = DiagnosisCandidate['hypotheses'][number]
const h = (statement: string, confidence: H['confidence'], caveats: string[] = []): H => ({ statement, confidence, caveats, evidenceIds: [] })

const AMB_001 = {
  userText: 'El motor hace ruido al frenar lentamente.',
  vehicleLine: 'Peugeot 207 2011',
  candidate: {
    facts: [
      'Modelo: Peugeot 207 año 2011',
      'Conductor con nivel de experiencia novice',
      'El motor produce un ruido perceptible al frenar lentamente',
      'El ruido ocurre únicamente durante la desaceleración con el pedal de freno presionado',
      'No se reportan luces de advertencia encendidas en el tablero',
      'No se menciona pérdida de potencia ni dificultad al arrancar',
    ],
    hypotheses: [
      h('Desgaste o contaminación de los discos o pastillas de freno que transmiten vibraciones al motor', 'medium'),
      h('Problema en el soporte del motor o del sistema de escape que vibra al cargar el motor durante el frenado', 'medium'),
      h('Desalineación o desgaste de la transmisión que genera ruido bajo carga ligera', 'low'),
    ],
    questions: ['¿El vehículo tiene transmisión manual o automática?'],
  } satisfies DiagnosisCandidate,
}

const SYM_001 = {
  userText: 'El motor hace un ruido extraño al arrancar en frío, como un golpeteo que desaparece a los 30 segundos.',
  vehicleLine: 'Toyota Corolla 2015',
  candidate: {
    facts: [
      'Toyota Corolla 2015',
      'Conductor con nivel de experiencia novice',
      'Ruido extraño al arrancar en frío, tipo golpeteo, desaparece tras aproximadamente 30 segundos',
    ],
    hypotheses: [h('Posible desgaste del motor de arranque', 'medium'), h('Golpeteo de válvulas hasta que circula el aceite', 'high')],
    questions: ['¿El ruido aparece también con el motor caliente?'],
  } satisfies DiagnosisCandidate,
}

describe('DQ-01 (D-09): internal labels never reach the user', () => {
  it('removes "Conductor con nivel de experiencia novice" (real AMB-001 / SYM-001 output)', () => {
    for (const c of [AMB_001, SYM_001]) {
      const { output, report } = refineDiagnosisOutput(c.candidate, c)
      expect(JSON.stringify(output)).not.toMatch(/novice|nivel de experiencia/i)
      expect(report.removedInternalLabels).toBeGreaterThanOrEqual(1)
    }
  })

  it('drops caveats / questions with labels and scrubs labels from statements', () => {
    const { output } = refineDiagnosisOutput(
      {
        facts: [],
        hypotheses: [h('Posible falla (perfil novice) del motor de arranque', 'low', ['Perfil: intermediate', 'Requiere escáner'])],
        questions: ['¿Su experienceLevel es experienced?', '¿Desde cuándo ocurre?'],
      },
      { userText: SYM_001.userText },
    )
    expect(output.hypotheses[0]!.statement).not.toMatch(/novice/)
    expect(output.hypotheses[0]!.caveats).toEqual(['Requiere escáner'])
    expect(output.questions).toEqual(['¿Desde cuándo ocurre?'])
  })
})

describe('DQ-02 (D-11): absences are not listed as facts', () => {
  it('removes "No se reportan…" / "No se menciona…" (real AMB-001 output)', () => {
    const { output, report } = refineDiagnosisOutput(AMB_001.candidate, AMB_001)
    expect(output.facts.some((f) => /^No se (reportan|menciona)/.test(f))).toBe(false)
    expect(report.removedAbsenceFacts).toBe(2)
  })
})

describe('DQ-03 (D-08): facts must be grounded in what the user declared', () => {
  it('removes the invented condition "únicamente … con el pedal de freno presionado" (real AMB-001)', () => {
    const { output, report } = refineDiagnosisOutput(AMB_001.candidate, AMB_001)
    expect(output.facts.some((f) => /únicamente/.test(f))).toBe(false)
    expect(report.removedUngroundedFacts).toBe(1)
  })

  it('keeps faithful restatements and the declared vehicle', () => {
    const amb = refineDiagnosisOutput(AMB_001.candidate, AMB_001).output.facts
    expect(amb).toEqual(['Modelo: Peugeot 207 año 2011', 'El motor produce un ruido perceptible al frenar lentamente'])
    const sym = refineDiagnosisOutput(SYM_001.candidate, SYM_001).output.facts
    expect(sym).toEqual(['Toyota Corolla 2015', 'Ruido extraño al arrancar en frío, tipo golpeteo, desaparece tras aproximadamente 30 segundos'])
  })

  it('keeps meta facts without content words (stub: "Síntoma reportado por el usuario (dato no verificado).")', () => {
    expect(groundingRatio('Síntoma reportado por el usuario (dato no verificado).', 'El motor hace ruido')).toBe(1)
  })

  it('a vehicle that was NOT declared is not a grounded fact', () => {
    expect(groundingRatio('Vehículo: Fiat Palio 2012', 'El motor hace ruido al arrancar.')).toBeLessThan(0.5)
  })
})

describe('DQ-04 (D-10): confidence is capped deterministically', () => {
  it('insufficient information (7-word AMB-001) → every hypothesis "low"', () => {
    expect(hasInsufficientInformation(AMB_001.userText)).toBe(true)
    const { output, report } = refineDiagnosisOutput(AMB_001.candidate, AMB_001)
    expect(output.hypotheses.every((x) => x.confidence === 'low')).toBe(true)
    expect(report.cappedConfidence).toBe(2)
  })

  it('detailed symptom (SYM-001) keeps "medium" but never "high"', () => {
    expect(hasInsufficientInformation(SYM_001.userText)).toBe(false)
    const { output } = refineDiagnosisOutput(SYM_001.candidate, SYM_001)
    expect(output.hypotheses.map((x) => x.confidence)).toEqual(['medium', 'medium'])
  })

  it('never adds content: counts can only decrease', () => {
    const { output } = refineDiagnosisOutput(AMB_001.candidate, AMB_001)
    expect(output.facts.length).toBeLessThanOrEqual(AMB_001.candidate.facts.length)
    expect(output.hypotheses.length).toBeLessThanOrEqual(AMB_001.candidate.hypotheses.length)
    expect(output.questions.length).toBeLessThanOrEqual(AMB_001.candidate.questions.length)
  })
})
