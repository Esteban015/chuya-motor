/**
 * ai-status.api.test.ts — Incremento 6.4E: the status shown to the user matches the provider that
 * really processed the request. groq-sdk is mocked: no real network calls.
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
import { GET as STATUS } from '../status/route'
import { deriveAiStatus } from './ai-status'
import { resetLlmProtectionRuntimeForTests } from '@/server/llm-protection/runtime'
import {
  LLM_BUSY_WARNING,
  LLM_DAILY_QUOTA_WARNING,
  LLM_UNAVAILABLE_WARNING,
  LLM_VISITOR_LIMIT_WARNING,
  availabilityWarnings,
} from '@/agents/llm/llm-availability'
import { ELECTRICAL_CHECK_WITHHELD_WARNING, OUTPUT_WITHHELD_WARNING } from '@/agents/graph/nodes/output-safety-guard'

let ip = 1
const post = (userText: string, fixedIp?: string) =>
  POST(
    new NextRequest('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': fixedIp ?? `10.69.0.${ip++}` },
      body: JSON.stringify({ userText }),
    }),
  )

const groqJson = (obj: unknown) => ({
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(obj) } }],
  usage: { total_tokens: 400 },
})
const SAFE = groqJson({
  facts: ['Ruido metálico al arrancar en frío'],
  hypotheses: [{ statement: 'Posible tensor de correa gastado', confidence: 'low', caveats: ['Requiere inspección'], evidenceIds: [] }],
  questions: ['¿Desde cuándo lo notás?'],
})
const NORMAL = 'El motor hace un ruido metálico al arrancar en frío y desaparece a los pocos minutos.'

beforeEach(() => {
  resetLlmProtectionRuntimeForTests()
  vi.stubEnv('LLM_PROVIDER', 'groq')
  vi.stubEnv('GROQ_API_KEY', 'gsk_AISTATUSAPI_000000000000000')
  mockCreate.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('AIS-01: aiStatus reflects what processed the request', () => {
  it('AIS-01-A: Groq answered and passed every check → mode "ai"', async () => {
    mockCreate.mockResolvedValue(SAFE)
    const body = await (await post(NORMAL)).json()
    expect(body.aiStatus).toEqual({ mode: 'ai' })
    expect(body.fallback).toBe(false)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('AIS-01-B: stub provider → mode "simulated"', async () => {
    vi.stubEnv('LLM_PROVIDER', 'stub')
    const body = await (await post(NORMAL)).json()
    expect(body.aiStatus).toEqual({ mode: 'simulated' })
  })

  it('AIS-01-C: Groq provider error → "unavailable/provider_error", never "simulated", no stub text', async () => {
    const { APIError } = (await import('groq-sdk')) as unknown as { APIError: new (m: string) => Error & { status?: number } }
    const e = new APIError('server error')
    e.status = 500
    mockCreate.mockRejectedValueOnce(e)
    const body = await (await post(NORMAL)).json()
    expect(body.aiStatus).toEqual({ mode: 'unavailable', reason: 'provider_error' })
    expect(body.hypotheses).toEqual([])
    expect(JSON.stringify(body)).not.toMatch(/Síntoma reportado por el usuario \(dato no verificado\)/)
  })

  it('AIS-01-D: unsafe AI answer withheld by the output validator → mode "withheld"', async () => {
    mockCreate.mockResolvedValue(
      groqJson({
        facts: [],
        hypotheses: [{ statement: 'Podés seguir conduciendo con cuidado hasta el taller.', confidence: 'low', caveats: [], evidenceIds: [] }],
        questions: [],
      }),
    )
    const body = await (await post('Se me fueron los frenos en la ruta.')).json()
    expect(body.aiStatus).toEqual({ mode: 'withheld' })
    expect(body.warnings).toContain(OUTPUT_WITHHELD_WARNING)
    expect(body.severity?.level).toBe('critical')
  })

  it('AIS-01-F (6.4F, D-14): the real REV-002 caveat "al desconectar la batería" → withheld + explicit electrical notice', async () => {
    mockCreate.mockResolvedValue(
      groqJson({
        facts: ['La batería se descarga durante la noche y a la mañana el auto no arranca.'],
        hypotheses: [
          {
            statement: 'Podría haber una fuga de corriente (consumo parasitario) cuando el auto está apagado.',
            confidence: 'low',
            caveats: ['Se confirmaría si al desconectar la batería el consumo desaparece.'],
            evidenceIds: [],
          },
          { statement: 'La batería podría estar envejecida o dañada.', confidence: 'low', caveats: ['Se confirma con una prueba de carga de la batería.'], evidenceIds: [] },
        ],
        questions: ['¿Desde cuándo notás que la batería se descarga cada noche?'],
      }),
    )
    const body = await (await post('La batería se descarga durante la noche y a la mañana el auto no arranca.')).json()
    expect(body.aiStatus).toEqual({ mode: 'withheld' })
    expect(body.hypotheses).toEqual([])
    expect(body.warnings).toEqual(expect.arrayContaining([OUTPUT_WITHHELD_WARNING, ELECTRICAL_CHECK_WITHHELD_WARNING]))
    expect(JSON.stringify(body)).not.toMatch(/desconectar la batería el consumo/)
  })

  it('AIS-01-G (6.4F, D-13): an over-length caveat is recovered → mode "ai", hypothesis kept as "low"', async () => {
    mockCreate.mockResolvedValue(
      groqJson({
        facts: ['Ruido metálico al arrancar en frío.'],
        hypotheses: [
          {
            statement: 'Posible tensor de correa gastado.',
            confidence: 'medium',
            caveats: ['Se confirmaría si al escuchar el motor con el capó abierto el ruido proviene claramente de la parte delantera, donde están la correa y el tensor, y si el sonido cambia de intensidad cuando el motor alcanza la temperatura normal.'],
            evidenceIds: [],
          },
        ],
        questions: ['¿Desde cuándo lo notás?'],
      }),
    )
    const body = await (await post(NORMAL)).json()
    expect(body.aiStatus).toEqual({ mode: 'ai' })
    expect(body.hypotheses).toEqual([{ statement: 'Posible tensor de correa gastado.', confidence: 'low', caveats: [] }])
  })

  it('AIS-01-E: kill switch → "unavailable/disabled" with the fixed notice', async () => {
    vi.stubEnv('LLM_KILL_SWITCH', 'true')
    const body = await (await post(NORMAL)).json()
    expect(body.aiStatus).toEqual({ mode: 'unavailable', reason: 'disabled' })
    expect(body.warnings).toContain(LLM_UNAVAILABLE_WARNING)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('AIS-02: pilot limits seen by the visitor', () => {
  it('AIS-02-A: the 4th analysis of the same visitor within the hour → visitor_limit notice, no provider call', async () => {
    mockCreate.mockResolvedValue(SAFE)
    for (let i = 0; i < 3; i++) expect((await (await post(NORMAL, '10.70.0.1')).json()).aiStatus).toEqual({ mode: 'ai' })
    const fourth = await post(NORMAL, '10.70.0.1')
    expect(fourth.status).toBe(200)
    const body = await fourth.json()
    expect(body.aiStatus).toEqual({ mode: 'unavailable', reason: 'visitor_limit' })
    expect(body.warnings).toContain(LLM_VISITOR_LIMIT_WARNING)
    expect(mockCreate).toHaveBeenCalledTimes(3)
    // Another visitor still gets the AI.
    expect((await (await post(NORMAL, '10.70.0.2')).json()).aiStatus).toEqual({ mode: 'ai' })
  })

  it('AIS-02-B: safety-blocked queries do not consume the visitor AI quota', async () => {
    mockCreate.mockResolvedValue(SAFE)
    for (let i = 0; i < 3; i++) expect((await post('Cuando arranco, la batería tira chispas.', '10.70.0.3')).status).toBe(422)
    expect((await (await post(NORMAL, '10.70.0.3')).json()).aiStatus).toEqual({ mode: 'ai' })
  })

  it('AIS-02-C: shared daily quota exhausted → daily_quota notice', async () => {
    vi.stubEnv('LLM_DAILY_ANALYSIS_BUDGET', '1')
    mockCreate.mockResolvedValue(SAFE)
    await post(NORMAL)
    const body = await (await post(NORMAL)).json()
    expect(body.aiStatus).toEqual({ mode: 'unavailable', reason: 'daily_quota' })
    expect(body.warnings).toContain(LLM_DAILY_QUOTA_WARNING)
  })
})

describe('AIS-03: deterministic helpers and public mode', () => {
  const snap = (over = {}) => ({ kind: 'real' as const, attempts: 1, succeeded: 1, lastErrorCode: null, ...over })

  it('AIS-03-A: precedence withheld > unavailable > ai/simulated > none', () => {
    expect(deriveAiStatus(snap(), { fallback: true, warnings: [OUTPUT_WITHHELD_WARNING] })).toEqual({ mode: 'withheld' })
    expect(deriveAiStatus(snap({ succeeded: 0, lastErrorCode: 'LLM_BUSY' }), { fallback: true, warnings: [] })).toEqual({ mode: 'unavailable', reason: 'busy' })
    expect(deriveAiStatus(snap({ kind: 'stub' }), { fallback: true, warnings: [] })).toEqual({ mode: 'unavailable', reason: 'provider_error' })
    expect(deriveAiStatus(snap({ kind: 'stub' }), { fallback: false, warnings: [] })).toEqual({ mode: 'simulated' })
    expect(deriveAiStatus(snap({ attempts: 0, succeeded: 0 }), { fallback: false, warnings: [] })).toEqual({ mode: 'none' })
  })

  it('AIS-03-B: each protection code maps to one fixed notice; provider errors add none', () => {
    expect(availabilityWarnings('LLM_CLIENT_LIMIT')).toEqual([LLM_VISITOR_LIMIT_WARNING])
    expect(availabilityWarnings('LLM_BUDGET_EXHAUSTED')).toEqual([LLM_DAILY_QUOTA_WARNING])
    expect(availabilityWarnings('LLM_BUSY')).toEqual([LLM_BUSY_WARNING])
    expect(availabilityWarnings('LLM_PROVIDER_COOLDOWN')).toEqual([LLM_BUSY_WARNING])
    expect(availabilityWarnings('LLM_DISABLED')).toEqual([LLM_UNAVAILABLE_WARNING])
    expect(availabilityWarnings('LLM_GUARD_UNAVAILABLE')).toEqual([LLM_UNAVAILABLE_WARNING])
    expect(availabilityWarnings('LLM_TIMEOUT')).toEqual([])
  })

  it('AIS-03-C: GET /api/status exposes only the mode, read at request time', async () => {
    vi.stubEnv('LLM_PROVIDER', 'groq')
    const pilot = await STATUS().json()
    expect(pilot).toEqual({ mode: 'pilot' })
    vi.stubEnv('LLM_PROVIDER', 'stub')
    expect(await STATUS().json()).toEqual({ mode: 'demo' })
    expect(JSON.stringify(pilot)).not.toMatch(/gsk_|upstash|token/i)
  })
})
