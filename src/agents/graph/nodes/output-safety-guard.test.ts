/**
 * output-safety-guard.test.ts — Incremento 6.4B (D-05), graph + API integration.
 *
 * An unsafe LLM diagnosis must never reach the client as a valid recommendation:
 *   - hypotheses / facts / questions are withheld;
 *   - the result is clearly identified (fallback=true, warning, trace errorCode LLM_OUTPUT_UNSAFE);
 *   - no silent fallback to the Stub: the deterministic mock text never appears;
 *   - the deterministic severity banner (authority) is still returned by the API;
 *   - no retry: the LLM is called exactly once.
 * No real network calls (scripted adapter + mocked groq-sdk).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { analyzeCase } from '../analyze-graph'
import type { LLMAdapter, LLMCompletionRequest, LLMResult } from '@/agents/llm/llm-adapter'

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
import { POST } from '@/app/api/analyze/route'

const CRITICAL_NOT_BLOCKED = 'Al frenar el pedal se va hasta el fondo.'
const NORMAL_SYMPTOM = 'El motor hace un ruido metálico al arrancar en frío.'

const UNSAFE = {
  facts: ['El pedal llega al fondo al frenar.'],
  hypotheses: [
    { statement: 'Posible aire en el circuito. Podés seguir manejando con cuidado.', confidence: 'medium', caveats: ['Orientativo.'], evidenceIds: [] },
  ],
  questions: ['¿Desde cuándo ocurre?'],
}
const SAFE = {
  facts: ['El pedal llega al fondo al frenar.'],
  hypotheses: [
    { statement: 'Posible pérdida de presión hidráulica.', confidence: 'low', caveats: ['Requiere inspección profesional inmediata.'], evidenceIds: [] },
  ],
  questions: ['¿Notaste manchas de líquido debajo del auto?'],
}

class ScriptedAdapter implements LLMAdapter {
  readonly modelId = 'scripted-test'
  calls = 0
  constructor(private readonly body: unknown) {}
  async complete(_req: LLMCompletionRequest): Promise<LLMResult> {
    this.calls++
    return { ok: true, content: JSON.stringify(this.body), tokensUsed: 100, modelId: this.modelId } as LLMResult
  }
}

function input(userText: string) {
  return { caseId: randomUUID(), userText, experienceLevel: 'unknown' as const, dataLabel: 'synthetic_demo' as const }
}

describe('D-05 / OSG-01: graph withholds an unsafe diagnosis', () => {
  it('critical symptom + "podés seguir manejando" → withheld, identified, no stub, single call', async () => {
    const adapter = new ScriptedAdapter(UNSAFE)
    const output = await analyzeCase(input(CRITICAL_NOT_BLOCKED), { llmAdapter: adapter })
    expect(output.safetyBlocked).toBe(false)
    expect(output.route).toBe('symptom')
    expect(output.hypotheses).toEqual([])
    expect(output.facts).toEqual([])
    expect(output.questions).toEqual([])
    expect(output.fallback).toBe(true)
    expect(output.warnings.some((w) => /validación de seguridad/.test(w))).toBe(true)
    const guard = output.traces.find((t) => t.nodeId === 'outputSafetyGuard')
    expect(guard?.errorCode).toBe('LLM_OUTPUT_UNSAFE')
    expect(guard?.resultType).toBe('output_safety_rejected')
    expect(adapter.calls).toBe(1)
    expect(JSON.stringify(output)).not.toMatch(/Síntoma reportado por el usuario \(dato no verificado\)/) // stub text
    // Traces never carry LLM or user text.
    expect(JSON.stringify(output.traces)).not.toMatch(/seguir manejando|pedal/i)
  })

  it('safe diagnosis passes through unchanged', async () => {
    const output = await analyzeCase(input(CRITICAL_NOT_BLOCKED), { llmAdapter: new ScriptedAdapter(SAFE) })
    expect(output.fallback).toBe(false)
    expect(output.hypotheses.map((h) => h.statement)).toEqual([SAFE.hypotheses[0]!.statement])
    expect(output.traces.find((t) => t.nodeId === 'outputSafetyGuard')?.resultType).toBe('output_safety_passed')
  })

  it('DIY instruction is withheld even when severity is normal', async () => {
    const diy = { ...SAFE, hypotheses: [{ ...SAFE.hypotheses[0]!, statement: 'Purgá los frenos vos mismo.' }] }
    const output = await analyzeCase(input(NORMAL_SYMPTOM), { llmAdapter: new ScriptedAdapter(diy) })
    expect(output.hypotheses).toEqual([])
    expect(output.fallback).toBe(true)
  })

  it('deterministic mock output (default stub) still passes the guard', async () => {
    const output = await analyzeCase(input(NORMAL_SYMPTOM))
    expect(output.fallback).toBe(false)
    expect(output.hypotheses.length).toBeGreaterThan(0)
  })
})

describe('D-05 / OSG-02: API keeps the deterministic banner and withholds unsafe Groq text', () => {
  beforeEach(() => {
    vi.stubEnv('LLM_PROVIDER', 'groq')
    vi.stubEnv('GROQ_API_KEY', 'gsk_OUTPUTGUARD_000000000000000000')
    mockCreate.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('200 with fallback=true, critical banner present, no unsafe text in the body', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(UNSAFE) } }],
      usage: { total_tokens: 300 },
    })
    const res = await POST(
      new NextRequest('http://localhost/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.65.0.1' },
        body: JSON.stringify({ userText: CRITICAL_NOT_BLOCKED }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.severity?.level).toBe('critical')
    expect(body.fallback).toBe(true)
    expect(body.hypotheses).toEqual([])
    expect(JSON.stringify(body)).not.toMatch(/seguir manejando/)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})

describe('D-05 / OSG-03 (6.4C): a withheld answer is distinguishable from the Stub and from an LLM failure', () => {
  afterEach(() => vi.unstubAllEnvs())
  let n = 1
  const call = (userText: string) =>
    POST(
      new NextRequest('http://localhost/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.65.3.${n++}` },
        body: JSON.stringify({ userText }),
      }),
    ).then((r) => r.json())
  const WITHHELD = /retenida porque no superó la validación de seguridad/

  it('withheld (Groq unsafe) vs LLM failure (Groq error) vs Stub (stub provider)', async () => {
    vi.stubEnv('LLM_PROVIDER', 'groq')
    vi.stubEnv('GROQ_API_KEY', 'gsk_OUTPUTGUARD_000000000000000000')
    mockCreate.mockReset()
    mockCreate.mockResolvedValueOnce({
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(UNSAFE) } }],
      usage: { total_tokens: 300 },
    })
    const withheld = await call(CRITICAL_NOT_BLOCKED)

    mockCreate.mockRejectedValueOnce(new Error('network down'))
    const failure = await call(CRITICAL_NOT_BLOCKED)

    vi.unstubAllEnvs()
    vi.stubEnv('LLM_PROVIDER', 'stub')
    const stub = await call(CRITICAL_NOT_BLOCKED)

    // Withheld: fallback + the fixed withheld warning, empty content, deterministic critical banner kept.
    expect(withheld.fallback).toBe(true)
    expect(withheld.warnings.some((w: string) => WITHHELD.test(w))).toBe(true)
    expect(withheld.hypotheses).toEqual([])
    expect(withheld.severity?.level).toBe('critical')

    // LLM failure: fallback too, but WITHOUT the withheld warning.
    expect(failure.fallback).toBe(true)
    expect(failure.warnings.some((w: string) => WITHHELD.test(w))).toBe(false)
    expect(failure.severity?.level).toBe('critical')

    // Stub: not a fallback, deterministic simulated content, no withheld warning.
    expect(stub.fallback).toBe(false)
    expect(stub.hypotheses.length).toBeGreaterThan(0)
    expect(stub.warnings.some((w: string) => WITHHELD.test(w))).toBe(false)
    expect(stub.severity?.level).toBe('critical')
  })
})
