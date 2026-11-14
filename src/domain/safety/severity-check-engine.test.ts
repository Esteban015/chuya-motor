/**
 * severity-check-engine.test.ts — Engine warning light (check engine / MIL) severity.
 *
 * Criterion (sources in docs/reviews/check-engine-severity-7b.md):
 *   1. Confirmed blinking: usually a severe misfire that can damage the catalytic converter → HIGH.
 *      Never "keep driving normally": slow down, stop in a safe place as soon as possible, switch the
 *      engine off and request assistance / tow (Consumer Reports; AAA: pull over and shut off the
 *      engine). Stop immediately with power loss, shaking, smoke or smell.
 *   2. Steady light: not an emergency → no banner.
 *   3. Occasional light (incl. the wizard occurrence "Intermitente") → no banner.
 *   4. Ambiguous description ("intermitente" next to the engine light) → conditional HIGH: the
 *      warning is not reduced for lack of clarity.
 *   5. Concurrent critical symptoms (fire/smoke, fuel, burning smell, loss of braking) keep their
 *      own CRITICAL handling (Safety Gate block or CRITICAL rules) — the blinking light never
 *      downgrades them. A concurrent HIGH symptom does not hide the "stop" instruction.
 * "No conduzcas" (CRITICAL) stays reserved for those critical risks.
 * Production text shape: `${symptomText}. Condición de ocurrencia: ${occurrence}.`
 */
import { describe, it, expect } from 'vitest'
import { assessSeverity, resolveUserFacingSeverity } from './severity-assessor'
import { checkSafetyGate } from './safety-policy'
import { detectEngineLightState } from './engine-light-signals'

const withOccurrence = (s: string, occ = 'Siempre') => `${s}. Condición de ocurrencia: ${occ}.`

/** Same pipeline as POST /api/analyze for the user-facing severity. */
function userFacing(text: string) {
  const gate = checkSafetyGate(text)
  return { blocked: gate.blocked, severity: resolveUserFacingSeverity({ userText: text, safetyBlocked: gate.blocked, route: gate.blocked ? null : 'symptom' }) }
}

/** Never recommends continuing to drive normally / driving to the workshop as usual. */
function expectNoKeepDriving(action: string) {
  expect(action).not.toMatch(/llev[aá] el veh[ií]culo a un taller/i)
  expect(action).not.toMatch(/pod[eé]s (seguir|continuar) (manejando|circulando|conduciendo)/i)
  expect(action).not.toMatch(/segu[ií] (manejando|circulando|conduciendo)/i)
}

describe('CE-01 confirmed blinking → HIGH, stop in a safe place, never CRITICAL', () => {
  it.each([
    'La luz de check engine parpadea',
    'Titila el testigo del motor',
    'El check engine destella cuando acelero',
    'Se prende la luz del motor y parpadea',
    'La luz de check engine estaba fija y ahora parpadea',
  ])('%s', (text) => {
    const r = assessSeverity(withOccurrence(text), 'symptom')
    expect(r?.level).toBe('high')
    expect(r!.title).toBe('Atención: luz de motor que parpadea')
    expect(r!.message).toMatch(/catalizador/)
    expect(r!.action).toMatch(/^No sigas circulando normalmente\./)
    expect(r!.action).toMatch(/detenete en un lugar seguro y apagá el motor/)
    expect(r!.action).toMatch(/Pedí asistencia mecánica o una grúa/)
    expect(r!.action).toMatch(/Si pierde potencia, se sacude o notás humo u olor extraño, detenete de inmediato/)
    expect(r!.action).toMatch(/llamá a emergencias \(911\)/)
    expect(r!.action).not.toMatch(/No conduzcas/)
    expectNoKeepDriving(r!.action)
  })

  it('also when the wizard occurrence is "Intermitente"', () => {
    expect(assessSeverity(withOccurrence('La luz de check engine parpadea', 'Intermitente'), 'symptom')?.level).toBe('high')
  })
})

describe('CE-02 ambiguous description → conditional HIGH', () => {
  it.each(['Se enciende la luz de check engine intermitente', 'El testigo del motor está intermitente'])('%s', (text) => {
    const r = assessSeverity(withOccurrence(text), 'symptom')
    expect(r?.level).toBe('high')
    expect(r!.message).toMatch(/No está claro si la luz de motor parpadea o aparece solo a veces/)
    expect(r!.action).toMatch(/Si la luz parpadea, no sigas circulando normalmente/)
    expect(r!.action).toMatch(/detenete en un lugar seguro en cuanto puedas, apagá el motor y pedí asistencia mecánica o una grúa/)
    expect(r!.action).toMatch(/Si la luz queda fija o aparece solo a veces, programá una revisión pronto/)
    expectNoKeepDriving(r!.action)
  })
})

describe('CE-03 steady and occasional light → no banner', () => {
  it.each([
    ['steady', withOccurrence('La luz de check engine está fija')],
    ['steady', withOccurrence('La luz del motor se enciende siempre')],
    ['steady', withOccurrence('La luz de check engine no parpadea, queda fija')],
    ['occasional', withOccurrence('A veces se prende el check engine')],
    ['occasional', withOccurrence('Se prendió el check engine', 'Intermitente')], // wizard occurrence, not blinking
    ['unspecified', withOccurrence('Se prendió la luz de check engine')],
  ] as const)('%s: %s', (state, text) => {
    expect(detectEngineLightState(text)).toBe(state)
    expect(assessSeverity(text, 'symptom')).toBeNull()
  })
})

describe('CE-04 not the engine light', () => {
  it.each([
    withOccurrence('Los intermitentes no funcionan'),
    withOccurrence('La luz de giro titila muy rápido'),
    withOccurrence('Se enciende la luz intermitente'), // which light is unknown → asked to the driver, no banner
    withOccurrence('Las balizas parpadean solas'),
  ])('%s', (text) => {
    expect(assessSeverity(text, 'symptom')).toBeNull()
  })
})

describe('CE-05 concurrent critical symptoms keep CRITICAL', () => {
  it.each([
    ['La luz de check engine parpadea y casi no frena', 'Atención: síntoma crítico de seguridad', /No conduzcas/],
    ['La luz de check engine parpadea y sale humo del motor', 'Atención: posible riesgo de incendio', /911/],
    ['La luz de check engine parpadea y huele a nafta', 'Atención: posible pérdida de combustible o gas', /No arranques ni conduzcas/],
    ['La luz de check engine parpadea y huele a quemado', 'Atención: posible riesgo de incendio', /no sigas conduciendo/],
  ])('%s', (text, title, action) => {
    const { severity } = userFacing(withOccurrence(text))
    expect(severity?.level).toBe('critical')
    expect(severity!.title).toBe(title)
    expect(severity!.action).toMatch(action)
  })

  it('non-blocked loss of braking with a blinking light is still CRITICAL in the assessor', () => {
    expect(assessSeverity(withOccurrence('Parpadea el check engine y casi no frena'), 'symptom')?.level).toBe('critical')
  })

  it('blocked queries keep the previous policy (only hazards / brake loss)', () => {
    expect(resolveUserFacingSeverity({ userText: 'La luz de check engine parpadea', safetyBlocked: true, route: null })).toBeNull()
  })

  it('budget route never gets a symptom banner', () => {
    expect(assessSeverity('La luz de check engine parpadea', 'budget')).toBeNull()
  })
})

describe('CE-06 concurrent HIGH symptoms do not hide the stop instruction', () => {
  it.each([
    'La luz de check engine parpadea y chillan los frenos',
    'La luz de check engine parpadea y gotea aceite',
    'La luz de check engine parpadea y el auto pierde potencia y se sacude',
  ])('%s', (text) => {
    const { blocked, severity } = userFacing(withOccurrence(text))
    expect(blocked).toBe(false)
    expect(severity?.level).toBe('high')
    expect(severity!.title).toBe('Atención: luz de motor que parpadea')
    expect(severity!.action).toMatch(/detenete en un lugar seguro/)
  })

  it('without the engine light, the other HIGH rules are unchanged', () => {
    expect(assessSeverity(withOccurrence('Chillan los frenos al frenar en bajada'), 'symptom')?.message).toMatch(/ruidos al frenar/)
  })
})

describe('detectEngineLightState', () => {
  it.each([
    ['La luz de check engine parpadea', 'blinking'],
    [withOccurrence('Se enciende la luz de check engine intermitente'), 'ambiguous_intermittent'],
    [withOccurrence('La luz de check engine está fija'), 'steady'],
    [withOccurrence('La luz del motor se enciende siempre'), 'steady'],
    [withOccurrence('A veces se prende el check engine'), 'occasional'],
    [withOccurrence('Se prendió el check engine', 'Intermitente'), 'occasional'],
    [withOccurrence('Se prendió la luz de check engine'), 'unspecified'],
    [withOccurrence('Los intermitentes no funcionan'), null],
    [withOccurrence('Hace un ruido metálico al frenar'), null],
  ] as const)('%s → %s', (text, expected) => {
    expect(detectEngineLightState(text)).toBe(expected)
  })
})
