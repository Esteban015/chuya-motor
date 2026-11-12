/**
 * critical-block.test.ts — Incremento 6.4B (D-02)
 *
 * POST /api/analyze for blocked queries that describe loss of braking capacity:
 *   - stays 422 SAFETY_BLOCKED (block preserved, LLM never called);
 *   - adds an additive `severity` field with an explicit critical "No conduzcas" warning;
 *   - legacy 422 fields are unchanged (backward compatible);
 *   - no hypotheses / facts / questions are exposed.
 * The groq-sdk is mocked: no real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('groq-sdk', () => {
  class MockAPIError extends Error {
    status?: number
  }
  class MockGroq {
    chat = { completions: { create: mockCreate } }
  }
  return { default: MockGroq, Groq: MockGroq, APIError: MockAPIError, APIConnectionTimeoutError: class extends MockAPIError {} }
})

import { POST } from './route'

let ip = 1
function post(userText: string): Promise<Response> {
  return POST(
    new NextRequest('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.64.2.${ip++}` },
      body: JSON.stringify({ userText }),
    }),
  )
}

const LEGACY_DERIVATION =
  'Por seguridad, este tipo de intervención requiere atención profesional. Contactá un taller o mecánico habilitado.'

beforeEach(() => {
  vi.stubEnv('LLM_PROVIDER', 'groq')
  vi.stubEnv('GROQ_API_KEY', 'gsk_CRITICALBLOCK_0000000000000000')
  mockCreate.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('D-02 / API-CB-01: blocked brake-capacity loss → 422 + explicit critical warning', () => {
  const cases = [
    'El pedal de freno se hunde cada vez más y el auto casi no frena.',
    'Los frenos no se accionan al apretar el pedal al fondo.',
    'Tengo una pérdida total de frenos y el vehículo no frena.',
  ]
  it.each(cases)('%s', async (text) => {
    const res = await post(text)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('SAFETY_BLOCKED')
    expect(body.severity?.level).toBe('critical')
    expect(body.severity?.action).toMatch(/^No conduzcas el vehículo\./)
    expect(body.severity?.action).toMatch(/asistencia profesional/)
    expect(body).not.toHaveProperty('hypotheses')
    expect(body).not.toHaveProperty('facts')
    expect(body).not.toHaveProperty('questions')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('D-03 / API-CB-04 (6.4C): descriptive brake noise → 200, HIGH banner, guarded LLM output', () => {
  it('Los frenos hacen ruido. → not blocked, severity high, one mocked LLM call', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        facts: ['Ruido en los frenos.'],
        hypotheses: [{ statement: 'Posible desgaste de pastillas.', confidence: 'low', caveats: ['Requiere inspección en taller.'], evidenceIds: [] }],
        questions: ['¿El ruido aparece siempre al frenar?'],
      }) } }],
      usage: { total_tokens: 200 },
    })
    const res = await post('Los frenos hacen ruido.')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.safetyBlocked).toBe(false)
    expect(body.policyVersion).toBe('1.5.0')
    expect(body.severity?.level).toBe('high')
    expect(body.severity?.action).toMatch(/Consultá con un taller/)
    expect(body.fallback).toBe(false)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('12 V battery symptom (REV-002) → 200, no banner invented', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        facts: ['La batería se descarga de noche.'],
        hypotheses: [{ statement: 'Posible consumo parásito o batería agotada.', confidence: 'low', caveats: ['Requiere medición en taller.'], evidenceIds: [] }],
        questions: ['¿Qué antigüedad tiene la batería?'],
      }) } }],
      usage: { total_tokens: 200 },
    })
    const res = await post('La batería se descarga durante la noche y a la mañana el auto no arranca.')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.safetyBlocked).toBe(false)
    expect(body.severity ?? null).toBeNull()
  })
})

describe('D-02 / API-CB-02: blocked without brake-capacity loss → severity null', () => {
  // 6.4C: 'Los frenos hacen ruido.' is no longer blocked (D-03) → replaced by another ambiguous mention.
  it.each(['Quiero cambiar las pastillas de freno yo mismo.', 'Los frenos andan raro.', 'Cómo purgo el líquido de frenos en casa?'])(
    '%s',
    async (text) => {
      const res = await post(text)
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.severity).toBeNull()
      expect(mockCreate).not.toHaveBeenCalled()
    },
  )
})

describe('D-02 / API-CB-03: 422 contract is backward compatible (additive field only)', () => {
  it('legacy fields keep their exact names, types and values', async () => {
    const res = await post('El pedal de freno se hunde cada vez más y el auto casi no frena.')
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(
      ['coverageDisclaimer', 'error', 'policyVersion', 'safetyBlocked', 'safetyDerivationMessage', 'severity'].sort(),
    )
    expect(body.safetyBlocked).toBe(true)
    expect(body.safetyDerivationMessage).toBe(LEGACY_DERIVATION)
    expect(typeof body.policyVersion).toBe('string')
    expect(typeof body.coverageDisclaimer).toBe('string')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
