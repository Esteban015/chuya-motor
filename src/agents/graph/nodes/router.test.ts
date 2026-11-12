/**
 * Router — deterministic route detection.
 * Incremento 6.4A, defect D-01: budget keywords were matched as raw substrings, so the currency
 * code "ars" matched every Spanish reflexive infinitive ending in "-arse" (frenarse, apagarse,
 * descargarse…) and "precio" matched "aprecio". Symptom reports were routed to the budget parser
 * and, because severity is only assessed for route='symptom', the safety banner was suppressed.
 */
import { describe, it, expect } from 'vitest'
import { routerNode } from './router'
import { assessSeverity } from '@/domain/safety/severity-assessor'
import { getAllScenarios } from '../../../../benchmark/dataset/scenarios'

function routeOf(userText: string): string | null | undefined {
  return routerNode({ caseId: '00000000-0000-4000-8000-000000000000', userText, dataLabel: 'synthetic_demo' } as never).route
}

describe('RTR-01 (D-01): symptom texts are not misrouted to budget by substrings', () => {
  it.each([
    'El auto tarda en frenarse y hace ruido al frenar.',
    'El motor tiende a apagarse cuando freno en un semáforo.',
    'El auto empezó a calentarse mucho en la ruta.',
    'El volante tiende a trabarse al girar.',
    'La batería parece descargarse durante la noche.',
    'Aprecio la ayuda: el auto hace un ruido raro al doblar.',
    'El motor hace un ruido costoso de ignorar al acelerar.',
  ])('RTR-01: "%s" → symptom', (text) => {
    expect(routeOf(text)).toBe('symptom')
  })

  it('RTR-01-S: severity banner is restored for a misroutable brake symptom', () => {
    const text = 'El auto tarda en frenarse y hace ruido al frenar.'
    expect(assessSeverity(text, routeOf(text) ?? null)?.level).toBe('high')
  })
})

describe('RTR-02: budget detection is preserved', () => {
  it.each([
    'Me pasaron un presupuesto para cambiar las pastillas.',
    '¿Cuánto cuesta cambiar el embrague?',
    'Los precios del taller me parecen altos.',
    'Los costos de mano de obra son muy altos.',
    'Me cotizaron 300 dólares por el compresor.',
    'Compresor de AC: 350 USD',
    'Mano de obra 15000 ARS',
    'Me cobran 50 mil pesos.',
    'Me piden $ 4500 por el filtro.',
    'Aceite motor: 4500\nTotal: 10200',
    'Quiero una cotización del service.',
  ])('RTR-02: "%s" → budget', (text) => {
    expect(routeOf(text)).toBe('budget')
  })
})

describe('RTR-04 (D-07): itemised budget with only pending amounts', () => {
  it('RTR-04-A: ≥2 pending lines → budget', () => {
    expect(routeOf('Pastillas de freno: a confirmar\nMano de obra: pendiente')).toBe('budget')
  })
  it('RTR-04-B: a single "label: pendiente" line stays a symptom', () => {
    expect(routeOf('Revisión del ruido al frenar: pendiente')).toBe('symptom')
  })
})

describe('RTR-03: dataset routes unchanged (regression guard)', () => {
  const routed = getAllScenarios().filter((s) => !s.expected.safetyBlocked && s.expected.route)
  it.each(routed.map((s) => [s.id, s.expected.route, s.input.userText] as const))(
    'RTR-03: %s → %s',
    (_id, expected, text) => {
      expect(routeOf(text)).toBe(expected)
    },
  )
})
