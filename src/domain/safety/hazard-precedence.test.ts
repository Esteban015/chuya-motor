/**
 * hazard-precedence.test.ts — Incremento 6.4D, Fase 1 (P0: precedencia de seguridad)
 *
 * Defect reproduced in 6.4C: "Cuando arranco, la batería tira chispas" was NOT blocked because the
 * permissive temporal-context rule ("cuando/al + verbo de manejo" → symptom_description) was
 * evaluated before any hazard was recognized.
 *
 * Policy v1.5.0: an explicit, non-negated hazard (sparks, battery swelling/leak/heat/gas smell,
 * fire, smoke outside the exhaust, burning smell, fuel/gas smell or leak) is evaluated right after
 * the exact-phrase stage and takes precedence over EVERY permissive classification
 * (symptom_description, informational, professional_context, past_description, budget_structured,
 * and the 6.4C descriptive exemption). Loss of braking capacity keeps the FASE 6 / 6.4B decision:
 * blocked when ambiguous, otherwise analyzed with the CRITICAL banner — never silent.
 * Negated hazards ("no veo chispas ni olor a quemado") are masked; uncertainty ("no sé si…") and
 * resolution ("ya no…") are NOT treated as negation.
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

// Preventive guidance must never tell the user to manipulate the battery, wiring or safety parts.
const MANIPULATION = /\b(desconect[aá]|retir[aá]|quit[aá]|sac[aá]|ajust[aá]|limpi[aá]|hac[eé] (un )?puente|us[aá] (las )?pinzas|neutraliz[aá]|apag[aá] el fuego con)\b/i

it('HZ-00: policy version bumped to 1.5.0', () => {
  expect(SAFETY_POLICY_VERSION).toBe('1.5.0')
})

describe('HZ-01: explicit battery / electrical hazards → blocked + preventive CRITICAL warning', () => {
  it.each([
    'Cuando arranco, la batería tira chispas.', // P0 defect (symptom_description bypass)
    'Al encender el auto salen chispas de la batería.',
    'La batería está hinchada y pierde líquido.',
    'Al arrancar la batería larga olor a huevo podrido.',
    'Cuando manejo un rato la batería se pone muy caliente.',
    'Salen chispas de los cables del tablero.',
    'No veo chispas pero la batería está hinchada.', // negation does not cross "pero"
    'La batería no tira chispas, pero pierde ácido.', // negation does not cross the comma clause
    'No sé si salen chispas de la batería.', // uncertainty is not negation
  ])('%s', (text) => {
    expect(gate(text).blocked).toBe(true)
    const s = severityFor(text)
    expect(s?.level).toBe('critical')
    expect(s?.action).toMatch(/No toques la batería|No manipules/)
    expect(s?.action).toMatch(/asistencia profesional/)
    expect(s?.action).not.toMatch(MANIPULATION)
  })
})

describe('HZ-02: fire / smoke / burning or fuel smell → blocked + preventive CRITICAL warning', () => {
  it.each([
    'Al arrancar huele a quemado.', // symptom_description bypass
    'Cuando acelero sale humo del capot.',
    'Ayer salió fuego del motor.', // past_description bypass
    'Lo llevé al taller y ahora sale humo del tablero.', // professional (persistence) — still blocks
    'Lo llevé al taller y la batería tira chispas.', // professional_context bypass
    '¿Qué significa que la batería tire chispas?', // informational bypass
    'Cuando freno huele a nafta.',
    'Al arrancar se siente olor a gas en la cabina.',
  ])('%s', (text) => {
    expect(gate(text).blocked).toBe(true)
    const s = severityFor(text)
    expect(s?.level).toBe('critical')
    expect(s?.action).toMatch(/asistencia profesional|emergencias/)
    expect(s?.action).not.toMatch(MANIPULATION)
  })
})

describe('HZ-03: loss of braking capacity is never silent (blocked or not → CRITICAL "No conduzcas")', () => {
  // FASE 6 / 6.4B decision kept: a brake-capacity loss described with a temporal context, a question
  // or in the past is analyzed WITH the CRITICAL banner (E2E-F6-11); ambiguous mentions stay blocked.
  it.each([
    ['Cuando freno, el pedal se va al fondo.', false],
    ['Al frenar el auto casi no frena.', false],
    ['¿Qué significa si el auto no frena?', false],
    ['Se me fueron los frenos en la ruta.', false],
    ['Los frenos hacen ruido y el auto casi no frena.', true],
    ['No veo humo y el auto no frena.', true], // negation masking does not hide 'no frena'
  ] as const)('%s', (text, blocked) => {
    expect(gate(text).blocked).toBe(blocked)
    const s = severityFor(text)
    expect(s?.level).toBe('critical')
    expect(s?.action).toMatch(/^No conduzcas/)
  })
})

describe('HZ-04: descriptive low-risk symptoms → analyzed normally (not blocked)', () => {
  it.each([
    ['La batería se descarga durante la noche.', null],
    ['El auto no arranca porque la batería está descargada.', null],
    ['El motor hace un ruido extraño al arrancar en frío.', null],
    ['Cuando acelero se escucha un silbido.', null],
    ['¿Qué significa el humo azul del escape?', null], // exhaust smoke is not a fire hazard
    ['Al arrancar, la bujía no da chispa.', null], // ignition spark (negated) is not an electrical hazard
    ['Falta chispa en la bujía del cilindro 2.', null], // ignition context
    ['Los frenos hacen ruido.', 'high'],
  ] as const)('%s', (text, level) => {
    expect(gate(text).blocked).toBe(false)
    expect(severityFor(text)?.level ?? null).toBe(level)
  })
})

describe('HZ-05: negations are interpreted (masked) only for hazard terms', () => {
  it.each([
    'No veo chispas ni olor a quemado.',
    'El auto no arranca. No veo chispas ni olor a quemado.',
    'La batería se descarga de noche, no hay humo ni chispas.',
    'No sale humo del capot y el motor arranca bien.',
    'No hay olor a nafta en la cabina.',
    'Sin humo ni olor a quemado, pero el motor tironea.',
  ])('%s', (text) => {
    expect(gate(text).blocked).toBe(false)
    expect(severityFor(text)).toBeNull()
  })

  it.each([
    'Ya no sale humo, pero huele a quemado.', // resolution + new hazard
    'No veo humo pero huele a quemado.',
    'No sé si es olor a quemado.', // uncertainty keeps the exact phrase
  ])('%s → still blocked', (text) => {
    expect(gate(text).blocked).toBe(true)
  })
})

describe('HZ-06: explicit dangerous intervention requests → blocked', () => {
  it.each([
    ['¿Cómo hago puente si la batería tira chispas?', 'critical'],
    ['Quiero puentear los cables del tablero porque salen chispas.', 'critical'],
    ['Quiero desconectar la batería de alta tensión del híbrido.', null],
    ['Quiero cambiar las pastillas de freno yo mismo.', null], // E2E-04-C: no invented alert
    ['¿Cómo purgo el circuito de frenos?', null],
  ] as const)('%s', (text, level) => {
    expect(gate(text).blocked).toBe(true)
    expect(severityFor(text)?.level ?? null).toBe(level)
  })
})
