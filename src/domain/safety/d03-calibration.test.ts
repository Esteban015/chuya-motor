/**
 * d03-calibration.test.ts — Incremento 6.4C (D-03, Safety Gate policy v1.4.0)
 *
 * Context-based calibration of the AM-01 conservative block for two categories only:
 *   - conventional 12 V battery described as a symptom        → allowed (no banner invented)
 *   - brake NOISE / vibration described as a symptom           → allowed + HIGH banner ("Consultá con un taller")
 * Everything else keeps the previous policy:
 *   - loss of braking capacity                                 → blocked + CRITICAL "No conduzcas" (D-02)
 *   - DIY / intervention requests on brakes or batteries       → blocked
 *   - high-voltage (hybrid/EV) context or battery hazards      → blocked
 *   - ambiguous mentions without a symptom descriptor          → blocked ("Ambiguo → BLOQUEAR")
 * Safety Gate (blocking) and Severity Assessor (banner) remain separate deterministic components;
 * they only share the brake-capacity-loss signal catalog.
 */
import { describe, it, expect } from 'vitest'
import { checkSafetyGate } from './safety-policy'
import { resolveUserFacingSeverity } from './severity-assessor'
import { SAFETY_POLICY_VERSION } from './blocklist'

const gate = (t: string) => checkSafetyGate(t)
const severityFor = (t: string) => {
  const g = gate(t)
  return resolveUserFacingSeverity({ userText: t, safetyBlocked: g.blocked, route: g.blocked ? null : 'symptom' })
}

// 6.4D: policy 1.5.0 keeps every 1.4.0 calibration below; it only adds explicit-hazard precedence.
it('CAL-00: policy version is 1.5.0 (1.4.0 calibration preserved)', () => {
  expect(SAFETY_POLICY_VERSION).toBe('1.5.0')
})

describe('CAL-BAT-ALLOW: descriptive 12 V battery symptoms → allowed, no banner', () => {
  it.each([
    'La batería se descarga durante la noche y a la mañana el auto no arranca.', // REV-002
    'La batería de mi auto amanece descargada casi todos los días. Tengo que llamar a alguien para arrancar.', // SYM-003
    'Se me descarga la batería si dejo el auto parado dos días.',
    'La batería está muerta, no da arranque.', // rioplatense
    'La batería quedó tirada y el auto no prende.', // rioplatense
    '¿Por qué se descarga la batería del auto?',
    'Se prende la luz de la batería en el tablero.',
    'La batería de 12 V dura muy poco, se agota en dos días.',
    'La batería no se descarga pero el auto no arranca a la mañana.', // negation
  ])('%s', (text) => {
    const g = gate(text)
    expect(g.blocked).toBe(false)
    expect(g.intentClassification).toBe('symptom_description')
    expect(severityFor(text)).toBeNull()
  })
})

describe('CAL-BAT-BLOCK: battery interventions, high-voltage context or hazards → blocked', () => {
  it.each([
    'Quiero cambiar la batería yo mismo.', // DIY
    '¿Cómo hago puente con la batería de otro auto?', // DIY (hag)
    'La batería se descarga, ¿cómo la desconecto de noche?', // intervention
    'Se descarga la batería, voy a conectar los cables de otro auto.', // intervention
    'Quiero desconectar la batería de alta tensión del híbrido.', // phrase
    'La batería del híbrido se descarga rápido.', // high-voltage context
    'La batería de mi auto eléctrico no carga.', // high-voltage keyword
    'No es la batería de alta tensión, es la de 12 V que se descarga.', // conservative: exact HV phrase wins
  ])('%s', (text) => {
    expect(gate(text).blocked).toBe(true)
    expect(severityFor(text)).toBeNull()
  })
})

// 6.4D (P0): explicit hazards now also carry a fixed preventive CRITICAL warning (hazard-signals.ts).
// Supersedes the 6.4C expectation of "no banner" for these three cases: the hazard is explicit, not invented.
describe('CAL-BAT-HAZARD: battery hazards / smoke → blocked + preventive CRITICAL warning (6.4D)', () => {
  it.each([
    'La batería está hinchada y se descarga.',
    'La batería tira chispas y huele a huevo podrido.',
    'La batería se descarga y sale humo del capot.',
  ])('%s', (text) => {
    expect(gate(text).blocked).toBe(true)
    expect(severityFor(text)?.level).toBe('critical')
  })
})

describe('CAL-BRK-ALLOW: descriptive brake noise/vibration → allowed with prudent HIGH banner', () => {
  it.each([
    'Los frenos hacen ruido.',
    'Me hacen ruido los frenos.', // rioplatense word order
    'Chillan los frenos cuando paro en un semáforo.',
    'Los frenos chirrían un poco.', // must NOT be critical ("un poco" ≠ "frena poco")
    'Suenan las pastillas de freno, como un chirrido metálico.',
    'Hay un ruido raro en los frenos traseros.',
    '¿Es normal que los frenos rechinen?',
    'Los frenos vibran un poco en bajada.', // 'un poco' must not read as 'frena poco'
  ])('%s', (text) => {
    const g = gate(text)
    expect(g.blocked).toBe(false)
    const s = severityFor(text)
    expect(s?.level).toBe('high')
    expect(s?.action).toMatch(/Consultá con un taller/)
  })
})

describe('CAL-BRK-CRIT: loss of braking capacity → blocked + CRITICAL "No conduzcas" (unchanged precedence)', () => {
  it.each([
    'Los frenos hacen ruido y el auto casi no frena.',
    'Los frenos chillan y el pedal se hunde.',
    'Los frenos no hacen ruido pero no frenan.', // negated noise, real loss
    'Me hacen ruido los frenos y no me frenan bien.', // rioplatense "no me frenan"
    'Hacen ruido los frenos y se va el pedal al fondo.',
  ])('%s', (text) => {
    expect(gate(text).blocked).toBe(true)
    const s = severityFor(text)
    expect(s?.level).toBe('critical')
    expect(s?.action).toMatch(/^No conduzcas/)
  })
})

describe('CAL-BRK-BLOCK: risky brake interventions or other hazards → blocked, no invented alert', () => {
  it.each([
    'Hacen ruido los frenos, ¿cómo cambio las pastillas yo mismo?',
    'Los frenos hacen ruido, voy a purgar el circuito.',
    'Pierde líquido de frenos y hace ruido.',
    'Los frenos hacen ruido y huele a quemado.',
    'Los discos hacen ruido.', // could be the clutch disc: no brake/pastilla token → stays ambiguous
  ])('%s', (text) => {
    expect(gate(text).blocked).toBe(true)
  })
})

describe('CAL-AMB: ambiguous mentions without a symptom descriptor → conservative block', () => {
  it.each([
    'Frenos.',
    'Los frenos andan raro.',
    'Algo pasa con los frenos.',
    'El freno está duro.',
    'Problema con la batería del auto',
    'La batería.',
    'El pedal de freno vibra.', // pedal feel → stays blocked (AM-01-BLK-01)
    'Antes funcionaban bien pero ahora los frenos suenan raro.', // persistence → FP-02 conservative
    'Los frenos siguen haciendo ruido.', // persistence → conservative (documented residual FP)
  ])('%s', (text) => {
    expect(gate(text).blocked).toBe(true)
  })
})
