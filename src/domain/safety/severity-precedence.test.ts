/**
 * severity-precedence.test.ts — Incremento 6.4B (D-02)
 *
 * D-02: when the Safety Gate blocks a query that describes loss (or possible absence) of braking
 * capacity, the user only saw a generic "intervención" message — no "No conduzcas".
 *
 * Precedence contract under test:
 *   1. Safety Gate decides whether the pipeline continues (block). Severity never unblocks.
 *   2. The deterministic severity layer decides the user-facing risk warning:
 *      - not blocked → assessSeverity(userText, route) (unchanged behavior);
 *      - blocked     → ONLY the brake-capacity-loss detector (critical). Generic brake mentions,
 *                      DIY requests and HIGH-level symptoms do not produce a critical alert.
 */
import { describe, it, expect } from 'vitest'
import {
  assessSeverity,
  detectsBrakeCapacityLoss,
  resolveUserFacingSeverity,
} from './severity-assessor'
import { checkSafetyGate } from './safety-policy'

const BRAKE_LOSS_TEXTS = [
  'El pedal de freno se hunde cada vez más y el auto casi no frena.', // REV-003
  'Los frenos no se accionan al apretar el pedal al fondo.', // mandatory case
  'Tengo una pérdida total de frenos y el vehículo no frena.', // E2E-04
  'Los frenos no responden.',
  'El pedal va al piso y el auto no frena.',
  'El auto no frena.',
  'Casi no frena el auto.',
  'Tengo pérdida de frenado desde ayer.',
  'Siento el pedal blando al frenar.',
  'El auto frena poco.',
  'Me quedé sin frenos en la ruta.',
  'Se me fueron los frenos bajando la sierra.',
  'El pedal del freno llega hasta el fondo.',
  'Apenas frena aunque pise fuerte.',
] as const

const NOT_BRAKE_LOSS_TEXTS = [
  'Quiero cambiar las pastillas de freno yo mismo.',
  'Cómo purgo el líquido de frenos en casa?',
  'Voy a cambiar los discos de freno.',
  'Los frenos hacen ruido.',
  'Los frenos chirrían un poco.',
  'Siento olor a líquido de frenos.',
  'El freno de mano no sostiene en pendiente.',
  'Frenos.',
  'Hace ruido al frenar.',
  'El auto vibra al frenar.',
  'El pedal no se hunde y el auto frena bien.',
  'Apenas freno escucho un chirrido.', // rioplatense "apenas" = "as soon as"
  'Me recomendaron no frenar bruscamente con lluvia.',
  'Tengo un auto sin frenos ABS.',
] as const

describe('D-02 / BCL-01: brake-capacity-loss detector — positives', () => {
  it.each(BRAKE_LOSS_TEXTS)('detects loss of braking capacity: %s', (text) => {
    expect(detectsBrakeCapacityLoss(text)).toBe(true)
  })
})

describe('D-02 / BCL-02: brake-capacity-loss detector — must not flag generic brake mentions', () => {
  it.each(NOT_BRAKE_LOSS_TEXTS)('does not flag: %s', (text) => {
    expect(detectsBrakeCapacityLoss(text)).toBe(false)
  })
})

describe('D-02 / PREC-01: blocked + brake-capacity loss → explicit critical warning', () => {
  it.each(BRAKE_LOSS_TEXTS.filter((t) => checkSafetyGate(t).blocked))('critical, "No conduzcas": %s', (text) => {
    const s = resolveUserFacingSeverity({ userText: text, safetyBlocked: true, route: null })
    expect(s?.level).toBe('critical')
    expect(s?.action).toMatch(/^No conduzcas el vehículo\./)
    expect(s?.action).toMatch(/asistencia profesional/)
  })

  it('PREC-01-REV003: REV-003 is still blocked by the Safety Gate (block is preserved)', () => {
    expect(checkSafetyGate(BRAKE_LOSS_TEXTS[0]).blocked).toBe(true)
  })
})

describe('D-02 / PREC-02: blocked without brake-capacity loss → no critical alert', () => {
  it.each(NOT_BRAKE_LOSS_TEXTS.filter((t) => checkSafetyGate(t).blocked))('no severity: %s', (text) => {
    expect(resolveUserFacingSeverity({ userText: text, safetyBlocked: true, route: null })).toBeNull()
  })

  it('PREC-02-B: blocked battery / airbag DIY → no severity', () => {
    for (const t of ['Quiero cambiar la batería yo mismo.', 'Cómo desconecto el airbag del volante?']) {
      expect(checkSafetyGate(t).blocked).toBe(true)
      expect(resolveUserFacingSeverity({ userText: t, safetyBlocked: true, route: null })).toBeNull()
    }
  })
})

describe('D-02 / PREC-03: not blocked → same result as assessSeverity (unchanged contract)', () => {
  const texts = [
    'Hace ruido al frenar.',
    'El auto vibra al frenar.',
    'Al frenar el pedal se va hasta el fondo.',
    'El motor hace ruido al arrancar en frío.',
    'La dirección está muy dura al estacionar.',
  ]
  it.each(texts)('%s', (text) => {
    for (const route of ['symptom', 'budget', 'clarification', null] as const) {
      expect(resolveUserFacingSeverity({ userText: text, safetyBlocked: false, route })).toEqual(
        assessSeverity(text, route),
      )
    }
  })
})

describe('D-02 / PREC-04: brake-capacity loss that passes the gate also gets the critical banner', () => {
  it('PREC-04-A: "Me quedé sin frenos en la ruta" (past_description, not blocked) → critical', () => {
    const text = 'Me quedé sin frenos en la ruta.'
    expect(checkSafetyGate(text).blocked).toBe(false)
    expect(assessSeverity(text, 'symptom')?.level).toBe('critical')
  })

  it('PREC-04-B: brake-loss rule never applies outside route=symptom when not blocked', () => {
    expect(assessSeverity('Me quedé sin frenos en la ruta.', 'budget')).toBeNull()
  })
})
