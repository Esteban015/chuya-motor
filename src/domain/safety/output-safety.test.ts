/**
 * output-safety.test.ts — Incremento 6.4B (D-05)
 *
 * D-05: there was no server-side safety validation of LLM-generated text before the report reached
 * the frontend. A hypothesis saying "podés seguir manejando" on a critical brake symptom would be
 * shown verbatim under the critical banner.
 *
 * The validator is deterministic, LLM-independent and never asks the LLM to judge itself.
 */
import { describe, it, expect } from 'vitest'
import { validateDiagnosisOutput, type DiagnosisOutputCandidate } from './output-safety'

function out(partial: Partial<DiagnosisOutputCandidate> = {}): DiagnosisOutputCandidate {
  return {
    facts: ['El usuario reporta un síntoma (dato no verificado).'],
    hypotheses: [
      { statement: 'Posible desgaste de pastillas.', confidence: 'low', caveats: ['Requiere inspección profesional.'], evidenceIds: [] },
    ],
    questions: ['¿Desde cuándo ocurre?'],
    ...partial,
  }
}
function hyp(statement: string, caveats: string[] = ['Requiere inspección.']) {
  return { statement, confidence: 'medium' as const, caveats, evidenceIds: [] }
}

describe('D-05 / OSV-01: safe output passes', () => {
  it.each(['critical', 'high', 'normal'] as const)('baseline output is safe (%s)', (severityLevel) => {
    expect(validateDiagnosisOutput(out(), { severityLevel })).toEqual({ safe: true, violations: [] })
  })
})

describe('D-05 / OSV-02: driving encouraged while a critical/high risk is recognized → unsafe', () => {
  const unsafe = [
    'Podés seguir manejando con precaución hasta el próximo service.',
    'Puedes seguir conduciendo normalmente.',
    'Es seguro seguir circulando unos días.',
    'Seguí usándolo con normalidad.',
    'No hay riesgo en seguir manejando.',
    'No es necesario dejar de usar el vehículo.',
  ]
  it.each(unsafe)('critical: %s', (s) => {
    const r = validateDiagnosisOutput(out({ hypotheses: [hyp(s)] }), { severityLevel: 'critical' })
    expect(r.safe).toBe(false)
    expect(r.violations).toContain('DRIVING_ENCOURAGED_UNDER_RISK')
  })

  it('detected in caveats and facts too, not only in statements', () => {
    expect(validateDiagnosisOutput(out({ hypotheses: [hyp('Desgaste.', ['Podés seguir manejando.'])] }), { severityLevel: 'high' }).safe).toBe(false)
    expect(validateDiagnosisOutput(out({ facts: ['Podés seguir conduciendo sin problema.'] }), { severityLevel: 'high' }).safe).toBe(false)
  })

  it('with normal severity, routine "podés seguir usándolo" is not flagged (no recognized critical risk)', () => {
    const r = validateDiagnosisOutput(out({ hypotheses: [hyp('Ruido de correa en frío. Podés seguir usándolo y consultarlo en el próximo service.')] }), {
      severityLevel: 'normal',
    })
    expect(r.safe).toBe(true)
  })
})

describe('D-05 / OSV-03: risk minimization / professional discouraged under recognized risk → unsafe', () => {
  it.each(['No es grave, es algo común.', 'No te preocupes por esto.', 'No hay ningún peligro.'])('minimization: %s', (s) => {
    const r = validateDiagnosisOutput(out({ hypotheses: [hyp(s)] }), { severityLevel: 'critical' })
    expect(r.violations).toContain('RISK_MINIMIZED_UNDER_RISK')
  })
  it.each(['No hace falta llevarlo al taller.', 'No es necesario ir al mecánico por ahora.'])('discouraged: %s', (s) => {
    const r = validateDiagnosisOutput(out({ hypotheses: [hyp(s)] }), { severityLevel: 'high' })
    expect(r.violations).toContain('PROFESSIONAL_DISCOURAGED_UNDER_RISK')
  })
})

describe('D-05 / OSV-04: DIY instructions on safety-critical systems → unsafe at ANY severity', () => {
  const unsafe = [
    'Purgá el circuito de frenos vos mismo con una manguera.',
    'Podés cambiar las pastillas de freno vos mismo.',
    'Tenés que desconectar el airbag antes de revisar el volante.',
    'Aflojá la línea de combustible para liberar presión.',
    'Desconecte la batería de alta tensión del híbrido.',
    'Abrí la tapa del radiador para ver el nivel de refrigerante.',
  ]
  it.each(unsafe)('%s', (s) => {
    const r = validateDiagnosisOutput(out({ hypotheses: [hyp(s)] }), { severityLevel: 'normal' })
    expect(r.safe).toBe(false)
    expect(r.violations).toContain('DIY_INSTRUCTION_SAFETY_SYSTEM')
  })
})

describe('D-05 / OSV-05: no false positives for negations, quotes, reported speech or questions', () => {
  const safeUnderCritical = [
    'No sigas manejando hasta que lo revise un profesional.',
    'No es seguro seguir manejando en estas condiciones.',
    'No podés seguir manejando con este síntoma.',
    'Evitá seguir circulando.',
    'Nunca intentes purgar los frenos sin asistencia profesional.',
    'Un mecánico puede purgar el circuito de frenos si hace falta.',
    'Revisá con el taller el nivel de líquido de frenos.',
    'Según tu relato, te dijeron que podías seguir manejando; no lo recomendamos.',
    'El usuario indica que le dijeron "podés seguir manejando".',
    'Mencionaste que un conocido te dijo que no es grave.',
    'No se puede descartar que sea grave.',
  ]
  it.each(safeUnderCritical)('statement: %s', (s) => {
    expect(validateDiagnosisOutput(out({ hypotheses: [hyp(s)] }), { severityLevel: 'critical' })).toEqual({ safe: true, violations: [] })
  })

  it.each(['¿Podés seguir manejando sin notar el ruido?', '¿Te dijeron que no es grave?', '¿Notaste si podés seguir conduciendo con normalidad?'])(
    'question to the user: %s',
    (q) => {
      expect(validateDiagnosisOutput(out({ questions: [q] }), { severityLevel: 'critical' }).safe).toBe(true)
    },
  )
})

describe('D-05 / OSV-06: structural validation of the report', () => {
  it('rejects empty statements, invalid confidence and oversize lists', () => {
    const bad: unknown[] = [
      out({ hypotheses: [hyp('   ')] }),
      out({ hypotheses: [{ ...hyp('x'), confidence: 'certain' as never }] }),
      out({ questions: Array.from({ length: 6 }, (_, i) => `¿Pregunta ${i}?`) }),
      out({ hypotheses: Array.from({ length: 6 }, (_, i) => hyp(`H${i}`)) }),
      { facts: 'not-an-array', hypotheses: [], questions: [] },
    ]
    for (const b of bad) {
      const r = validateDiagnosisOutput(b as DiagnosisOutputCandidate, { severityLevel: 'normal' })
      expect(r.safe).toBe(false)
      expect(r.violations).toContain('STRUCTURE_INVALID')
    }
  })

  it('never throws on hostile input', () => {
    for (const b of [null, undefined, 42, 'x', { hypotheses: [null] }]) {
      expect(() => validateDiagnosisOutput(b as never, { severityLevel: 'critical' })).not.toThrow()
      expect(validateDiagnosisOutput(b as never, { severityLevel: 'critical' }).safe).toBe(false)
    }
  })
})
