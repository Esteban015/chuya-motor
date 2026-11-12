/**
 * llm-protection.api.test.ts — Incremento 6.4D: POST /api/analyze with the LLM protection layer.
 * groq-sdk is mocked: no real network calls.
 *
 *  - P0 hazards are blocked before any LLM call and carry the preventive CRITICAL warning.
 *  - Kill switch / missing distributed store: no provider call, explicit notice, deterministic
 *    severity warnings preserved, never a silent stub answer.
 *  - Stub stays operational while Groq is disabled.
 *  - Per-analysis limit: one provider call per request.
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
import { resetLlmProtectionRuntimeForTests } from '@/server/llm-protection/runtime'
import { LLM_BUSY_WARNING, LLM_DAILY_QUOTA_WARNING, LLM_UNAVAILABLE_WARNING } from '@/agents/llm/llm-availability'
import { OUTPUT_WITHHELD_WARNING } from '@/agents/graph/nodes/output-safety-guard'

let ip = 1
const post = (userText: string) =>
  POST(
    new NextRequest('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.68.0.${ip++}` },
      body: JSON.stringify({ userText }),
    }),
  )

const SAFE_DIAGNOSIS = {
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content: JSON.stringify({
          facts: ['Ruido metálico al arrancar en frío'],
          hypotheses: [{ statement: 'Posible tensor de correa gastado', confidence: 'low', caveats: ['Requiere inspección'], evidenceIds: [] }],
          questions: ['¿Desde cuándo lo notás?'],
        }),
      },
    },
  ],
  usage: { total_tokens: 400 },
}

const NORMAL = 'El motor hace un ruido metálico al arrancar en frío y desaparece a los pocos minutos.'
const PAST_BRAKE_LOSS = 'Se me fueron los frenos en la ruta.' // not blocked (past) → CRITICAL banner

beforeEach(() => {
  resetLlmProtectionRuntimeForTests()
  vi.stubEnv('LLM_PROVIDER', 'groq')
  vi.stubEnv('GROQ_API_KEY', 'gsk_PROTECTIONAPI_00000000000000')
  mockCreate.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('API-P0: explicit hazards are blocked before any LLM call, with preventive guidance', () => {
  it.each([
    ['Cuando arranco, la batería tira chispas.', /No toques la batería/],
    ['Al arrancar huele a quemado.', /Detené el vehículo/],
    ['Ayer salió fuego del motor.', /llamá a emergencias/],
  ])('%s', async (text, action) => {
    const res = await post(text)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.policyVersion).toBe('1.5.0')
    expect(body.severity?.level).toBe('critical')
    expect(body.severity?.action).toMatch(action)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('negated hazard is analyzed normally: "No veo chispas ni olor a quemado" → 200, one call', async () => {
    mockCreate.mockResolvedValue(SAFE_DIAGNOSIS)
    const res = await post('El auto no arranca a la mañana. No veo chispas ni olor a quemado.')
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})

describe('API-KILL: emergency kill switch', () => {
  it('LLM_KILL_SWITCH=true → 200 fallback with fixed notice, no provider call, CRITICAL banner kept', async () => {
    vi.stubEnv('LLM_KILL_SWITCH', 'true')
    const body = await (await post(PAST_BRAKE_LOSS)).json()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(body.fallback).toBe(true)
    expect(body.hypotheses).toEqual([])
    expect(body.warnings).toContain(LLM_UNAVAILABLE_WARNING)
    expect(body.warnings).not.toContain(OUTPUT_WITHHELD_WARNING)
    expect(body.severity?.level).toBe('critical')
    expect(body.severity?.action).toMatch(/^No conduzcas/)
    expect(JSON.stringify(body)).not.toMatch(/Síntoma reportado por el usuario \(dato no verificado\)/) // no stub text
  })

  it('kill switch does not affect blocked queries: 422 + CRITICAL warning', async () => {
    vi.stubEnv('LLM_KILL_SWITCH', 'true')
    const res = await post('Los frenos hacen ruido y el auto casi no frena.')
    expect(res.status).toBe(422)
    expect((await res.json()).severity?.level).toBe('critical')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('stub provider stays operational with the kill switch on', async () => {
    vi.stubEnv('LLM_PROVIDER', 'stub')
    vi.stubEnv('LLM_KILL_SWITCH', 'true')
    const body = await (await post(NORMAL)).json()
    expect(body.fallback).toBe(false)
    expect(body.hypotheses.length).toBeGreaterThan(0)
    expect(body.warnings).not.toContain(LLM_UNAVAILABLE_WARNING)
  })
})

describe('API-PROD: production without a distributed quota store fails closed for Groq', () => {
  it('NODE_ENV=production, no Upstash → no provider call, explicit notice, banner kept', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const body = await (await post(PAST_BRAKE_LOSS)).json()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(body.fallback).toBe(true)
    expect(body.warnings).toContain(LLM_UNAVAILABLE_WARNING)
    expect(body.severity?.level).toBe('critical')
  })

  it('missing GROQ_API_KEY → 200 explicit fallback (not 500, not stub); blocked queries still 422', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    const ok = await post(NORMAL)
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.fallback).toBe(true)
    expect(body.hypotheses).toEqual([])
    expect((await post('Cuando arranco, la batería tira chispas.')).status).toBe(422)
  })
})

describe('API-BUDGET: shared budgets and per-analysis limit', () => {
  it('exactly one provider call per analysis', async () => {
    mockCreate.mockResolvedValue(SAFE_DIAGNOSIS)
    const res = await post(NORMAL)
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('daily call budget exhausted → explicit notice, no provider call', async () => {
    vi.stubEnv('LLM_DAILY_CALL_BUDGET', '1')
    mockCreate.mockResolvedValue(SAFE_DIAGNOSIS)
    expect((await (await post(NORMAL)).json()).fallback).toBe(false)
    const second = await (await post(NORMAL)).json()
    expect(second.fallback).toBe(true)
    expect(second.warnings).toContain(LLM_DAILY_QUOTA_WARNING)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('provider 429 → explicit fallback; next request hits the shared cooldown without calling Groq', async () => {
    const { APIError } = (await import('groq-sdk')) as unknown as { APIError: new (m: string) => Error & { status?: number; headers?: unknown } }
    const e = new APIError('rate limited')
    e.status = 429
    mockCreate.mockRejectedValueOnce(e)
    const first = await (await post(NORMAL)).json()
    expect(first.fallback).toBe(true)
    const second = await (await post(NORMAL)).json()
    expect(second.fallback).toBe(true)
    expect(second.warnings).toContain(LLM_BUSY_WARNING)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})
