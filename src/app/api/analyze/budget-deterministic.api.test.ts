/**
 * budget-deterministic.api.test.ts — Incremento 7E (RED → GREEN): the budget verification must not
 * depend on the AI. Reproduces the reported defect: with the AI unavailable the result showed
 * "Partidas: 0" and "No se pudo verificar la suma" for a perfectly readable budget.
 * groq-sdk is mocked: no real network calls, no real Groq.
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
import type { ClientAnalyzeOutput } from './schema'

let ip = 1
const post = (userText: string, fixedIp?: string) =>
  POST(
    new NextRequest('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': fixedIp ?? `10.77.0.${ip++}` },
      body: JSON.stringify({ userText }),
    }),
  )
const groqJson = (obj: unknown) => ({
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(obj) } }],
  usage: { total_tokens: 300 },
})

/** The reported example. */
const EXAMPLE = 'Aceite motor: 4500\nFiltro de aire: 1500\nFiltro de aceite: 2000\nMano de obra: 3000\nTotal: 12500'

/** What the person must see for EXAMPLE, with or without the AI. */
function expectExampleVerified(body: ClientAnalyzeOutput) {
  expect(body.route).toBe('budget')
  expect(body.fallback).toBe(false)
  expect(body.budget).toMatchObject({
    completenessStatus: 'COMPLETE',
    computedTotalMinorUnit: 1_100_000,
    computedTotalIsPartial: false,
    declaredTotalMinorUnit: 1_250_000,
    differenceMinorUnit: 150_000,
    discrepancy: true,
    lineCount: 4,
    missingLineCount: 0,
    breakdown: { partMinorUnit: 800_000, laborMinorUnit: 300_000, otherMinorUnit: 0, unclassifiedMinorUnit: 0 },
    source: 'deterministic',
  })
  expect(body.budget?.items?.map((i) => [i.description, i.category, i.amountMinorUnit])).toEqual([
    ['Aceite motor', 'part', 450_000],
    ['Filtro de aire', 'part', 150_000],
    ['Filtro de aceite', 'part', 200_000],
    ['Mano de obra', 'labor', 300_000],
  ])
  // Never a commercial verdict.
  expect(JSON.stringify(body)).not.toMatch(/sobreprecio|fraude|estafa|caro|barato/i)
}

beforeEach(() => {
  resetLlmProtectionRuntimeForTests()
  vi.stubEnv('LLM_PROVIDER', 'groq')
  vi.stubEnv('GROQ_API_KEY', 'gsk_BUDGET7E_TEST_0000000000000')
  mockCreate.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('BD-01 AI available: usual analysis + deterministic result; the LLM cannot alter amounts', () => {
  it('Groq answers with WRONG amounts → the response keeps the amounts written in the text', async () => {
    mockCreate.mockResolvedValue(
      groqJson({
        lines: [
          { status: 'confirmed', description: 'Aceite motor', amountMinorUnit: 999_900, currency: 'ARS' },
          { status: 'confirmed', description: 'Mano de obra', amountMinorUnit: 1, currency: 'ARS' },
        ],
        declaredTotalMinorUnit: 1_000_000,
        currency: 'ARS',
      }),
    )
    const res = await post(EXAMPLE)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ClientAnalyzeOutput
    expectExampleVerified(body)
    expect(body.aiStatus).toEqual({ mode: 'ai' })
    expect(body.aiUnavailable).toBe(false)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('stub provider (demo): same deterministic numbers', async () => {
    vi.stubEnv('LLM_PROVIDER', 'stub')
    const body = (await (await post(EXAMPLE)).json()) as ClientAnalyzeOutput
    expectExampleVerified(body)
    expect(body.aiStatus).toEqual({ mode: 'simulated' })
  })
})

describe('BD-02 AI unavailable: the verification is kept (reported defect)', () => {
  it('LLM disabled (kill switch) → 4 items, $11.000 vs $12.500, AI status separate; no provider call', async () => {
    vi.stubEnv('LLM_KILL_SWITCH', 'true')
    const body = (await (await post(EXAMPLE)).json()) as ClientAnalyzeOutput
    expectExampleVerified(body)
    expect(body.aiUnavailable).toBe(true)
    expect(body.aiStatus).toEqual({ mode: 'unavailable', reason: 'disabled' })
    expect(body.fallbackText).toBeNull()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('Groq provider error (500) → results kept; exactly ONE provider call (no compensating call)', async () => {
    const { APIError } = (await import('groq-sdk')) as unknown as { APIError: new (m: string) => Error & { status?: number } }
    const e = new APIError('server error')
    e.status = 500
    mockCreate.mockRejectedValue(e)
    const body = (await (await post(EXAMPLE)).json()) as ClientAnalyzeOutput
    expectExampleVerified(body)
    expect(body.aiStatus).toEqual({ mode: 'unavailable', reason: 'provider_error' })
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('Groq timeout → results kept, one call', async () => {
    const { APIConnectionTimeoutError } = (await import('groq-sdk')) as unknown as { APIConnectionTimeoutError: new (m: string) => Error }
    mockCreate.mockRejectedValue(new APIConnectionTimeoutError('timeout'))
    const body = (await (await post(EXAMPLE)).json()) as ClientAnalyzeOutput
    expectExampleVerified(body)
    expect(body.aiStatus?.mode).toBe('unavailable')
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('shared LLM quota exhausted → results kept with the daily_quota status', async () => {
    vi.stubEnv('LLM_DAILY_ANALYSIS_BUDGET', '1')
    mockCreate.mockResolvedValue(groqJson({ lines: [], declaredTotalMinorUnit: null, currency: null }))
    await post(EXAMPLE)
    const body = (await (await post(EXAMPLE)).json()) as ClientAnalyzeOutput
    expectExampleVerified(body)
    expect(body.aiStatus).toEqual({ mode: 'unavailable', reason: 'daily_quota' })
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('LLM not configured (no API key) → results kept, AI unavailable', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    const body = (await (await post(EXAMPLE)).json()) as ClientAnalyzeOutput
    expectExampleVerified(body)
    expect(body.aiStatus?.mode).toBe('unavailable')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('BD-03 no false verification when the text cannot be read without the AI', () => {
  it('free prose with the AI down → fallback, INVALID, no computed sum', async () => {
    vi.stubEnv('LLM_KILL_SWITCH', 'true')
    const body = (await (await post('El taller me pasó un presupuesto de 45000 por cambiar el aceite')).json()) as ClientAnalyzeOutput
    expect(body.fallback).toBe(true)
    expect(body.budget).toMatchObject({ completenessStatus: 'INVALID', computedTotalMinorUnit: null, discrepancy: null })
  })

  it('foreign currency with the AI down → the ARS-only reader declines (no ARS assumption)', async () => {
    vi.stubEnv('LLM_KILL_SWITCH', 'true')
    const body = (await (await post('Repuesto importado: 4500\nMano de obra: USD 100')).json()) as ClientAnalyzeOutput
    expect(body.fallback).toBe(true)
    expect(body.budget?.computedTotalMinorUnit).toBeNull()
  })

  it('prose read by the AI: an amount the AI reports that is not written in the text is never summed', async () => {
    mockCreate.mockResolvedValue(
      groqJson({
        lines: [
          { status: 'confirmed', description: 'Aceite', amountMinorUnit: 4_500_000, currency: 'ARS' },
          { status: 'confirmed', description: 'Mano de obra', amountMinorUnit: 9_999_900, currency: 'ARS' },
        ],
        declaredTotalMinorUnit: null,
        currency: 'ARS',
      }),
    )
    const body = (await (await post('El taller me cobra 45000 de aceite y la mano de obra aparte, presupuesto')).json()) as ClientAnalyzeOutput
    expect(body.budget?.source).toBe('llm')
    expect(body.budget?.items?.find((i) => i.description === 'Mano de obra')).toMatchObject({ status: 'ambiguous', issue: 'unverified_amount', amountMinorUnit: null })
    expect(body.budget).toMatchObject({ completenessStatus: 'PARTIAL', computedTotalMinorUnit: 4_500_000, computedTotalIsPartial: true, differenceMinorUnit: null })
  })
})

describe('BD-04 Safety Gate, validation and rate limit are never turned into silent successes', () => {
  it('a budget with a blocked safety request → 422, no budget, no AI call', async () => {
    vi.stubEnv('LLM_KILL_SWITCH', 'true')
    const res = await post('Pastillas de freno: 18000\nMano de obra: 3000\nNoto una perdida de frenos total.')
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.error).toBe('SAFETY_BLOCKED')
    expect(body.budget).toBeUndefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('validation errors stay 400 (empty / too short / malformed JSON)', async () => {
    expect((await post('')).status).toBe(400)
    expect((await post('Total: 1')).status).toBe(400)
    const malformed = await POST(new NextRequest('http://localhost/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.77.9.9' }, body: '{"userText":' }))
    expect(malformed.status).toBe(400)
  })

  it('rate limit still answers 429 for deterministic budgets (AI down)', async () => {
    vi.stubEnv('LLM_KILL_SWITCH', 'true')
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) statuses.push((await post(EXAMPLE, '10.77.5.5')).status)
    expect(statuses).toContain(429)
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
  })
})
