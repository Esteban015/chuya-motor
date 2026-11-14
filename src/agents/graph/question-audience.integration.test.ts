/**
 * question-audience.integration.test.ts — Bugfix: driver vs. workshop questions through the graph.
 * Deterministic adapters only (no real provider, no network).
 */
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { analyzeCase } from './analyze-graph'
import { DeterministicMockLLMAdapter, MOCK_DIAGNOSIS_RESPONSE } from '@/agents/llm/deterministic-mock-adapter'
import type { LLMAdapter, LLMCompletionRequest, LLMResult } from '@/agents/llm/llm-adapter'
import { DIAGNOSIS_PROMPT_VERSION, DIAGNOSIS_SYSTEM_PROMPT } from './nodes/diagnosis-prompt'
import {
  CLARIFY_ALWAYS_LIGHT,
  CLARIFY_INTERMITTENT_LIGHT,
  CLARIFY_NOISE_MOMENT,
  WB_MISSING_AMOUNTS,
  WB_REVIEW_SUM,
  WS_NOISE_SOURCE,
  WS_OBD_CODES,
  classifyQuestionAudience,
} from '@/domain/questions/question-audience'

/** Wraps an adapter and records every request (to prove no extra LLM calls). */
class Recording implements LLMAdapter {
  readonly modelId: string
  readonly requests: LLMCompletionRequest[] = []
  constructor(private inner: LLMAdapter) {
    this.modelId = inner.modelId
  }
  async complete(req: LLMCompletionRequest): Promise<LLMResult> {
    this.requests.push(req)
    return this.inner.complete(req)
  }
}

class Fixed implements LLMAdapter {
  readonly modelId = 'fixed-test'
  readonly requests: LLMCompletionRequest[] = []
  constructor(private body: unknown) {}
  async complete(req: LLMCompletionRequest): Promise<LLMResult> {
    this.requests.push(req)
    return { ok: true, content: JSON.stringify(this.body) }
  }
}

const run = (userText: string, llmAdapter: LLMAdapter) =>
  analyzeCase({ caseId: randomUUID(), userText, experienceLevel: 'unknown', dataLabel: 'synthetic_demo' }, { llmAdapter })

const OBSERVED = [
  '¿Desde cuándo notás que la luz está intermitente?',
  '¿Aparecen otros síntomas?',
  '¿Te hicieron alguna revisión reciente?',
  '¿Podés llevar el vehículo a un taller?',
  '¿Notaste diferencias al acelerar?',
]
const HYP = { statement: 'Posible falla de encendido en un cilindro', confidence: 'low', caveats: ['Se confirmaría con un escáner.'], evidenceIds: [] }

describe('QA-01 check engine (observed case) with the stub', () => {
  it('workshop questions are mechanic-directed; the ambiguity is asked to the driver; one LLM call', async () => {
    const adapter = new Recording(new DeterministicMockLLMAdapter())
    const out = await run('Se enciende la luz de check engine intermitente', adapter)
    expect(out.fallback).toBe(false)
    expect(out.route).toBe('symptom')
    expect(out.questions).toContain(WS_OBD_CODES)
    for (const q of out.questions) expect(classifyQuestionAudience(q)).toBe('workshop')
    expect(out.driverQuestions?.[0]).toBe(CLARIFY_INTERMITTENT_LIGHT)
    expect(adapter.requests).toHaveLength(1)
  })

  it('"La luz se enciende siempre" → asks steady vs. at a given moment, never assumes', async () => {
    const out = await run('La luz se enciende siempre', new DeterministicMockLLMAdapter())
    expect(out.driverQuestions).toContain(CLARIFY_ALWAYS_LIGHT)
  })
})

describe('QA-02 real-provider-shaped answers', () => {
  it('legacy "questions" with the observed driver questions → moved to driverQuestions, not shown as workshop', async () => {
    const out = await run('Se enciende la luz de check engine intermitente', new Fixed({ facts: [], hypotheses: [HYP], questions: OBSERVED }))
    for (const q of OBSERVED) expect(out.questions).not.toContain(q)
    // Kept for the driver, after the ambiguity clarification, within the 5-item cap.
    expect(out.driverQuestions?.[0]).toBe(CLARIFY_INTERMITTENT_LIGHT)
    expect(out.driverQuestions?.slice(1)).toEqual(OBSERVED.slice(0, 4))
  })

  it('new format { driverQuestions, workshopQuestions } is accepted and specific workshop questions come first', async () => {
    const out = await run(
      'Se enciende la luz de check engine intermitente',
      new Fixed({
        facts: [],
        hypotheses: [HYP],
        driverQuestions: ['¿Notaste tirones al acelerar?'],
        workshopQuestions: ['¿Qué pruebas de compresión y de encendido hicieron en cada cilindro?'],
      }),
    )
    expect(out.questions[0]).toBe('¿Qué pruebas de compresión y de encendido hicieron en cada cilindro?')
    expect(out.driverQuestions).toContain('¿Notaste tirones al acelerar?')
  })

  it('driver questions are also scanned by output safety (unsafe text withholds the answer)', async () => {
    const out = await run(
      'Se enciende la luz de check engine intermitente',
      new Fixed({ facts: [], hypotheses: [HYP], driverQuestions: ['Desconectá la batería y fijate si la luz se apaga.'], workshopQuestions: [] }),
    )
    expect(out.fallback).toBe(true)
    expect(out.questions).toEqual([])
    expect(out.driverQuestions ?? []).toEqual([])
  })
})

describe('QA-03 critical brakes', () => {
  it('blocked by the Safety Gate: no questions of any kind, LLM never called', async () => {
    const adapter = new Recording(new DeterministicMockLLMAdapter())
    const out = await run('Noto una perdida de frenos total cuando freno en la autopista.', adapter)
    expect(out.safetyBlocked).toBe(true)
    expect(out.questions).toEqual([])
    expect(out.driverQuestions ?? []).toEqual([])
    expect(adapter.requests).toHaveLength(0)
  })
})

describe('QA-04 ambiguous mechanical noise', () => {
  it('asks the driver when it appears and the workshop where it comes from', async () => {
    const out = await run('El auto hace un ruido extraño', new DeterministicMockLLMAdapter())
    expect(out.driverQuestions?.[0]).toBe(CLARIFY_NOISE_MOMENT)
    expect(out.questions).toContain(WS_NOISE_SOURCE)
  })
})

describe('QA-05 budget', () => {
  it('mismatched total → workshop asks to review the sum; no driver questions; no diagnosis call', async () => {
    const adapter = new Recording(new DeterministicMockLLMAdapter())
    const out = await run('Aceite motor: 4500\nFiltro aire: 1500\nTotal: 7000', adapter)
    expect(out.route).toBe('budget')
    expect(out.budget?.discrepancy).toBe(true)
    expect(out.questions[0]).toBe(WB_REVIEW_SUM)
    for (const q of out.questions) expect(classifyQuestionAudience(q)).toBe('workshop')
    expect(out.driverQuestions ?? []).toEqual([])
    expect(adapter.requests.every((r) => !r.system.includes('[DIAGNOSIS_REQUEST]'))).toBe(true)
  })

  it('lines without amount → asks for them', async () => {
    const out = await run('Aceite motor: 4500\nFiltro aire: pendiente', new DeterministicMockLLMAdapter())
    expect(out.questions).toContain(WB_MISSING_AMOUNTS)
  })
})

describe('QA-06 prompt ↔ stub consistency', () => {
  it('prompt v2.2.0 asks for two separate lists with explicit audiences', () => {
    expect(DIAGNOSIS_PROMPT_VERSION).toBe('2.2.0')
    expect(DIAGNOSIS_SYSTEM_PROMPT).toMatch(/"driverQuestions": string\[\], "workshopQuestions": string\[\]/)
    expect(DIAGNOSIS_SYSTEM_PROMPT).toMatch(/"driverQuestions": preguntas para la persona que consulta/)
    expect(DIAGNOSIS_SYSTEM_PROMPT).toMatch(/"workshopQuestions": preguntas que la persona le puede hacer al mecánico/)
    expect(DIAGNOSIS_SYSTEM_PROMPT).toMatch(/No asumas que una hipótesis está confirmada/)
    expect(DIAGNOSIS_SYSTEM_PROMPT).toMatch(/no le pidas al mecánico datos que solo conoce quien maneja/)
    expect(DIAGNOSIS_SYSTEM_PROMPT).toMatch(/luz "intermitente"/)
    expect(DIAGNOSIS_SYSTEM_PROMPT).not.toMatch(/útiles para el taller \(cuándo ocurre, desde cuándo/)
  })

  it('the stub answers with exactly the keys the prompt requests, each audience correctly placed', () => {
    expect(Object.keys(MOCK_DIAGNOSIS_RESPONSE).sort()).toEqual(['driverQuestions', 'facts', 'hypotheses', 'workshopQuestions'])
    for (const q of MOCK_DIAGNOSIS_RESPONSE.driverQuestions) expect(classifyQuestionAudience(q)).toBe('driver')
    for (const q of MOCK_DIAGNOSIS_RESPONSE.workshopQuestions) expect(classifyQuestionAudience(q)).toBe('workshop')
  })
})
