/**
 * question-audience.test.ts — Bugfix: questions for the driver vs. questions for the workshop.
 * Deterministic, no LLM.
 */
import { describe, it, expect } from 'vitest'
import { scanUnsafeTexts } from '@/domain/safety/output-safety'
import {
  arrangeSymptomQuestions,
  buildBudgetWorkshopQuestions,
  classifyQuestionAudience,
  detectDriverClarifications,
  MAX_QUESTIONS_PER_AUDIENCE,
} from './question-audience'

// Observed in the public demo (check engine), presented as "Preguntas para el taller".
const OBSERVED = [
  '¿Desde cuándo notás que la luz está intermitente?',
  '¿Aparecen otros síntomas?',
  '¿Te hicieron alguna revisión reciente?',
  '¿Podés llevar el vehículo a un taller?',
  '¿Notaste diferencias al acelerar?',
]

const WORKSHOP_OK = [
  '¿Qué códigos de falla registró el escáner OBD-II?',
  '¿Qué pruebas permiten confirmar la causa antes de reemplazar componentes?',
  '¿Es seguro circular con este síntoma?',
  '¿Me podés mostrar la pieza que hay que cambiar?',
  '¿Los repuestos son originales o alternativos, y qué garantía tienen?',
]

describe('classifyQuestionAudience', () => {
  it.each(OBSERVED)('observed driver question → driver: %s', (q) => {
    expect(classifyQuestionAudience(q)).toBe('driver')
  })

  it.each(WORKSHOP_OK)('mechanic-directed question → workshop: %s', (q) => {
    expect(classifyQuestionAudience(q)).toBe('workshop')
  })

  it.each([
    '¿Cuándo empezó el problema?',
    '¿El síntoma es constante o intermitente?',
    '¿El ruido cambia al acelerar?',
    '¿Con qué frecuencia ocurre?',
  ])('questions only the driver can answer → driver: %s', (q) => {
    expect(classifyQuestionAudience(q)).toBe('driver')
  })
})

describe('arrangeSymptomQuestions — check engine (observed case)', () => {
  const userText = 'Se enciende la luz de check engine intermitente'
  const out = arrangeSymptomQuestions({ userText, workshopQuestions: OBSERVED, driverQuestions: [] })

  it('moves every driver-directed question out of the workshop list (never drops them)', () => {
    for (const q of OBSERVED) {
      expect(out.workshopQuestions).not.toContain(q)
    }
    expect(out.driverQuestions.length).toBeGreaterThan(0)
    expect(out.driverQuestions.length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_AUDIENCE)
  })

  it('workshop list is directed to the mechanic and includes the OBD-II codes question', () => {
    expect(out.workshopQuestions.length).toBeGreaterThanOrEqual(3)
    expect(out.workshopQuestions.length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_AUDIENCE)
    for (const q of out.workshopQuestions) expect(classifyQuestionAudience(q)).toBe('workshop')
    expect(out.workshopQuestions.some((q) => /OBD-II/.test(q) && /c[oó]digos/i.test(q))).toBe(true)
    expect(out.workshopQuestions.some((q) => /confirmar la causa antes de reemplazar/i.test(q))).toBe(true)
    expect(out.workshopQuestions.some((q) => /seguro circular/i.test(q))).toBe(true)
  })

  it('asks the driver to disambiguate "intermitente" (blinking vs. appears sometimes) instead of assuming', () => {
    const clar = out.driverQuestions[0]
    expect(clar).toMatch(/parpadea/i)
    expect(clar).toMatch(/fija/i)
    expect(clar).toMatch(/algunas veces/i)
  })

  it('never repeats a question across or within lists', () => {
    const all = [...out.driverQuestions, ...out.workshopQuestions].map((q) => q.toLowerCase())
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('detectDriverClarifications — light state ambiguity', () => {
  it('"intermitente" → blinking vs. appears sometimes', () => {
    expect(detectDriverClarifications('Se enciende la luz intermitente')[0]).toMatch(/parpadea.*fija.*algunas veces/i)
  })

  it('"se enciende siempre" → steady all the time vs. always at a given moment', () => {
    const [q] = detectDriverClarifications('La luz se enciende siempre')
    expect(q).toMatch(/fija todo el tiempo/i)
    expect(q).toMatch(/al arrancar/i)
  })

  it('"a veces" → steady or blinking when it appears', () => {
    expect(detectDriverClarifications('A veces se prende la luz del motor')[0]).toMatch(/queda fija o parpadea/i)
  })

  it('explicit blinking ("parpadea") is not re-asked as ambiguous', () => {
    expect(detectDriverClarifications('La luz del motor parpadea').some((q) => /parpadea \(/i.test(q))).toBe(false)
  })

  it('vague noise → asks when it appears; a precise noise does not', () => {
    expect(detectDriverClarifications('El auto hace un ruido raro')[0]).toMatch(/en qué momento aparece el ruido/i)
    expect(detectDriverClarifications('Hace un ruido metálico al frenar en bajada')).toEqual([])
  })

  it('no light / no noise → no clarification', () => {
    expect(detectDriverClarifications('El auto tarda en arrancar en invierno')).toEqual([])
  })
})

describe('arrangeSymptomQuestions — other topics', () => {
  it('brakes (non-blocked): workshop asks for measured state of the braking system, not a repair', () => {
    const out = arrangeSymptomQuestions({ userText: 'Chillan los frenos al frenar en bajada', workshopQuestions: [], driverQuestions: [] })
    expect(out.workshopQuestions.some((q) => /pastillas|discos|líquido de frenos/i.test(q))).toBe(true)
    expect(out.workshopQuestions.join(' ')).not.toMatch(/cambi(á|a)[r]? (las|los) /i)
  })

  it('ambiguous mechanical noise: driver clarification + workshop asks where it comes from', () => {
    const out = arrangeSymptomQuestions({ userText: 'Hace un ruido extraño', workshopQuestions: [], driverQuestions: [] })
    expect(out.driverQuestions[0]).toMatch(/en qué momento aparece el ruido/i)
    expect(out.workshopQuestions.some((q) => /de qué zona proviene el ruido/i.test(q))).toBe(true)
  })

  it('keeps specific LLM workshop questions first and misplaced mechanic questions move to the workshop list', () => {
    const out = arrangeSymptomQuestions({
      userText: 'Ruido al arrancar en frío',
      workshopQuestions: ['¿Qué revisaron en la correa de accesorios y cómo lo verificaron?'],
      driverQuestions: ['¿Qué códigos de falla registró el escáner OBD-II?', '¿El ruido dura más de un minuto?'],
    })
    expect(out.workshopQuestions[0]).toBe('¿Qué revisaron en la correa de accesorios y cómo lo verificaron?')
    expect(out.workshopQuestions).toContain('¿Qué códigos de falla registró el escáner OBD-II?')
    expect(out.driverQuestions).toContain('¿El ruido dura más de un minuto?')
  })

  it('caps both lists', () => {
    const many = Array.from({ length: 9 }, (_, i) => `¿Qué prueba ${i} hicieron para confirmar la causa?`)
    const out = arrangeSymptomQuestions({ userText: 'luz intermitente', workshopQuestions: many, driverQuestions: OBSERVED })
    expect(out.workshopQuestions.length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_AUDIENCE)
    expect(out.driverQuestions.length).toBeLessThanOrEqual(MAX_QUESTIONS_PER_AUDIENCE)
  })
})

describe('buildBudgetWorkshopQuestions', () => {
  const base = { completenessStatus: 'COMPLETE' as const, computedTotalMinorUnit: 1_100_000, computedTotalIsPartial: false, currency: 'ARS', discrepancy: false, lineCount: 4, missingLineCount: 0 }

  it('mechanic-directed questions about the quote, no price judgement', () => {
    const qs = buildBudgetWorkshopQuestions(base)
    expect(qs.length).toBeGreaterThanOrEqual(3)
    for (const q of qs) expect(classifyQuestionAudience(q)).toBe('workshop')
    expect(qs.join(' ')).not.toMatch(/caro|barato|excesiv|razonable/i)
  })

  it('discrepancy → asks to review the sum first', () => {
    expect(buildBudgetWorkshopQuestions({ ...base, discrepancy: true })[0]).toMatch(/suma/i)
  })

  it('lines without amount → asks for those amounts', () => {
    expect(buildBudgetWorkshopQuestions({ ...base, missingLineCount: 2 }).some((q) => /sin precio|sin importe/i.test(q))).toBe(true)
  })
})

describe('deterministic questions are safe under any severity', () => {
  const texts = [
    ...arrangeSymptomQuestions({ userText: 'Se enciende la luz de check engine intermitente', workshopQuestions: [], driverQuestions: [] }).workshopQuestions,
    ...arrangeSymptomQuestions({ userText: 'Chillan los frenos y la luz se enciende siempre', workshopQuestions: [], driverQuestions: [] }).workshopQuestions,
    ...arrangeSymptomQuestions({ userText: 'Hace un ruido raro', workshopQuestions: [], driverQuestions: [] }).driverQuestions,
    ...detectDriverClarifications('La luz se enciende siempre'),
    ...buildBudgetWorkshopQuestions({ completenessStatus: 'PARTIAL', discrepancy: true, missingLineCount: 1 }),
    ...buildBudgetWorkshopQuestions({ completenessStatus: 'INVALID', discrepancy: null, missingLineCount: 0 }),
  ]
  it.each(['normal', 'high', 'critical'] as const)('no output-safety violation at severity %s', (severityLevel) => {
    expect(scanUnsafeTexts(texts, { severityLevel })).toEqual([])
  })
  it('every question fits the 300-character contract', () => {
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(300)
  })
})

describe('wizard occurrence suffix ("Condición de ocurrencia: …")', () => {
  it('occurrence "Intermitente" means "sometimes", not a blinking light', () => {
    const qs = detectDriverClarifications('Se prendió la luz de check engine. Condición de ocurrencia: Intermitente.')
    expect(qs[0]).toMatch(/queda fija o parpadea/i)
    expect(qs.join(' ')).not.toMatch(/Cuando decís que la luz está intermitente/)
  })

  it('occurrence "Siempre" does not turn an unspecified light into "se enciende siempre"', () => {
    const qs = detectDriverClarifications('Se prendió la luz de check engine. Condición de ocurrencia: Siempre.')
    expect(qs[0]).toMatch(/queda fija, parpadea o aparece solo algunas veces/i)
  })

  it('the observed text keeps the blinking-vs-sometimes clarification', () => {
    expect(detectDriverClarifications('Se enciende la luz de check engine intermitente. Condición de ocurrencia: Siempre.')[0]).toMatch(/parpadea.*fija.*algunas veces/i)
  })

  it('an occurrence qualifies a vague noise ("Al frenar")', () => {
    expect(detectDriverClarifications('Hace un ruido raro. Condición de ocurrencia: Al frenar.')).toEqual([])
  })
})
