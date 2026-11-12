/**
 * d03-false-positives.test.ts — Incremento 6.4B (D-03)
 *
 * Investigation of Safety Gate over-blocking for descriptive battery/brake mentions.
 *
 * DEMONSTRATED DEFECT (fixed, policy v1.3.1):
 *   SAFETY.md lists "se me fueron los frenos en la ruta" as the canonical example of a past
 *   description that must NOT be blocked. v1.3.0 blocked it: PAST_MARKERS had "fue" but not its
 *   plural "fueron", so the input fell to 'ambiguous' + keyword "frenos" → AM-01 block.
 *   Minimal fix: add "fueron" to PAST_MARKERS. Since 6.4B the non-blocked case surfaces the
 *   critical "No conduzcas" banner (brake-capacity loss) and the LLM output is guarded.
 *
 * 6.4C (policy v1.4.0) — the two items left pending in 6.4B were decided and calibrated:
 *   - descriptive 12 V battery symptoms (REV-002, SYM-003) are allowed (DEF-01 superseded);
 *   - descriptive brake noise ("los frenos hacen ruido") is allowed with a HIGH banner.
 *   See d03-calibration.test.ts and docs/SAFETY.md (v0.4).
 */
import { describe, it, expect } from 'vitest'
import { checkSafetyGate } from './safety-policy'
import { resolveUserFacingSeverity, assessSeverity } from './severity-assessor'

describe('D-03 / FP-01: descriptive symptoms that must be allowed', () => {
  it('FP-01-RED: "Se me fueron los frenos en la ruta" (SAFETY.md example) → NOT blocked, past_description', () => {
    const r = checkSafetyGate('Se me fueron los frenos en la ruta.')
    expect(r.blocked).toBe(false)
    expect(r.intentClassification).toBe('past_description')
  })

  it('FP-01-B: once allowed, it surfaces the critical "No conduzcas" banner', () => {
    const s = assessSeverity('Se me fueron los frenos en la ruta.', 'symptom')
    expect(s?.level).toBe('critical')
    expect(s?.action).toMatch(/^No conduzcas/)
  })

  it.each([
    'Hace ruido al frenar.',
    'El auto vibra al frenar.',
    'Hay un olor extraño cuando freno.',
    'El mecánico cambió la batería la semana pasada.',
    '¿Qué causa que la batería se descargue de noche?',
    '¿Cómo funcionan los frenos ABS?',
  ])('FP-01-C stays allowed: %s', (text) => {
    expect(checkSafetyGate(text).blocked).toBe(false)
  })
})

describe('D-03 / FP-02: dangerous intervention requests must stay blocked', () => {
  it.each([
    'Quiero cambiar las pastillas de freno yo mismo.',
    'Cómo purgo los frenos en casa?',
    'Voy a sangrar el circuito de frenos.',
    'Quiero desconectar la batería de alta tensión del híbrido.',
    'Quiero cambiar la batería yo mismo.',
    'Cómo desconecto el airbag del volante?',
    'Los frenos fueron cambiados y quiero purgarlos yo mismo.', // "fueron" must not unlock DIY
    'Ayer se me fueron los frenos y ahora sigo sin frenos.', // persistence overrides past
  ])('%s', (text) => {
    expect(checkSafetyGate(text).blocked).toBe(true)
  })
})

describe('D-03 / FP-03: ambiguous mentions → conservative block, no invented critical alert', () => {
  it.each([
    'Frenos.',
    'Problema con la batería del auto',
    // 6.4C: 'Los frenos hacen ruido.', REV-002 and SYM-003 moved to d03-calibration.test.ts (allowed).
  ])('%s', (text) => {
    expect(checkSafetyGate(text).blocked).toBe(true)
    expect(resolveUserFacingSeverity({ userText: text, safetyBlocked: true, route: null })).toBeNull()
  })
})
