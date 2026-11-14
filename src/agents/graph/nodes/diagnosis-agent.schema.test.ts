/**
 * diagnosis-agent.schema.test.ts — Release candidate 6.4F, D-13.
 *
 * D-13 (real Groq run 2026-11-12T22:31Z, REV-001): the answer was rejected with
 * LLM_SCHEMA_VIOLATION. Evidence: the adapter returned ok (finish_reason=stop, 1 378 tokens were
 * attributed to the trace, which only happens on the parse/Zod branches), so the rejection was
 * in diagnosisAgent's JSON parsing or in the Zod contract — not truncation, not a provider error.
 * Which constraint failed was NOT recorded (traces carried only the generic code).
 *
 * Expected after the fix:
 *   - preventable format violations are recovered by REMOVING the offending item, never by
 *     truncating or rewriting text; a hypothesis that loses a caveat is downgraded to "low";
 *   - the failing constraint is recorded as a structural code (path pattern + Zod code), no content;
 *   - irrecoverable answers (invalid JSON, no usable hypothesis) keep the safe fallback;
 *   - text removed by normalization is still scanned by the output safety validator: unsafe
 *     removed text withholds the whole answer (no "laundering" through normalization).
 */
import { describe, it, expect } from 'vitest'
import type { LLMAdapter, LLMResult } from '@/agents/llm/llm-adapter'
import { createDiagnosisAgentNode } from './diagnosis-agent'
import { OUTPUT_WITHHELD_WARNING } from './output-safety-guard'
import type { GraphState } from '../graph-state'
import { normalizeDiagnosisCandidate } from '@/domain/quality/diagnosis-normalization'

const USER_TEXT = 'Mi auto hace un ruido metálico fuerte al arrancar en frío por la mañana; después de unos minutos desaparece.'

class FixedAdapter implements LLMAdapter {
  readonly modelId = 'fixed'
  constructor(private readonly content: string) {}
  async complete(): Promise<LLMResult> {
    return { ok: true, content: this.content, tokensUsed: 1378 }
  }
}

function state(): GraphState {
  return { caseId: 'c', userText: USER_TEXT, vehicle: null, experienceLevel: 'unknown', dataLabel: 'synthetic_demo', route: 'symptom' } as unknown as GraphState
}

const H = (over: Record<string, unknown> = {}) => ({
  statement: 'Posible tensor de la correa de distribución con desgaste.',
  confidence: 'medium',
  caveats: ['Se confirmaría si el ruido viene de la zona de la correa.'],
  evidenceIds: [],
  ...over,
})
const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ facts: ['Ruido metálico fuerte al arrancar en frío.'], hypotheses: [H()], questions: ['¿Desde cuándo lo notás?'], ...over })

async function run(content: string) {
  return createDiagnosisAgentNode(new FixedAdapter(content))(state())
}

const LONG_CAVEAT =
  'Se confirmaría si al escuchar el motor con el capó abierto el ruido proviene claramente de la parte delantera, donde están la correa y el tensor, y si el sonido cambia de intensidad cuando el motor alcanza la temperatura normal.'

describe('D-13 / DSN-01: preventable format violations are recovered without rewriting text', () => {
  it('DSN-01-A: a caveat over 200 characters is removed (not truncated); the hypothesis is kept and downgraded to "low"', async () => {
    expect(LONG_CAVEAT.length).toBeGreaterThan(200)
    const r = await run(answer({ hypotheses: [H({ caveats: [LONG_CAVEAT, 'Requiere inspección.'] })] }))
    expect(r.fallback).toBeUndefined()
    expect(r.hypotheses).toHaveLength(1)
    expect(r.hypotheses![0]!.caveats).toEqual(['Requiere inspección.'])
    expect(r.hypotheses![0]!.confidence).toBe('low')
    expect(r.traces![0]!.resultType).toBe('hypotheses_generated_after_normalization')
    expect(r.traces![0]!.schemaIssues).toEqual(['hypotheses.*.caveats.*:too_big'])
  })

  it('DSN-01-B: more than 5 questions → the first 5 are kept unchanged', async () => {
    const qs = ['¿Uno?', '¿Dos?', '¿Tres?', '¿Cuatro?', '¿Cinco?', '¿Seis?']
    const r = await run(answer({ questions: qs }))
    // Normalization keeps the first 5 unchanged; bugfix 7B then appends the fixed mechanic-directed
    // questions for the topic, so the model items are an unchanged prefix (the 6th never appears).
    const kept = r.questions!.filter((q) => qs.includes(q))
    expect(kept).toEqual(qs.slice(0, kept.length))
    expect(kept.length).toBeGreaterThanOrEqual(2)
    expect(r.questions).not.toContain('¿Seis?')
    expect(r.questions!.length).toBeLessThanOrEqual(5)
    expect(r.traces![0]!.schemaIssues).toEqual(['questions:too_big'])
  })

  it('DSN-01-C: missing evidenceIds / caveats default to empty lists', async () => {
    const r = await run(answer({ hypotheses: [{ statement: 'Posible tensor gastado.', confidence: 'low' }] }))
    expect(r.hypotheses).toEqual([{ statement: 'Posible tensor gastado.', confidence: 'low', caveats: [], evidenceIds: [] }])
  })

  it('DSN-01-D: confidence casing / Spanish synonyms are mapped; an unknown value drops only that hypothesis', async () => {
    const r = await run(answer({ hypotheses: [H({ confidence: 'Baja' }), H({ statement: 'Posible soporte de motor flojo.', confidence: 0.7 })] }))
    expect(r.hypotheses).toHaveLength(1)
    expect(r.hypotheses![0]!.confidence).toBe('low')
  })

  it('DSN-01-E: every kept string is identical to a string of the original answer (no truncation, no rewriting)', () => {
    const raw = { facts: ['A'.repeat(600), 'Ruido al arrancar.'], hypotheses: [H({ statement: 'S'.repeat(501) }), H()], questions: ['Q'.repeat(301), '¿Desde cuándo?'] }
    const res = normalizeDiagnosisCandidate(raw)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const originals = new Set([...raw.facts, ...raw.questions, 'S'.repeat(501), H().statement, ...(H().caveats as string[])])
    const kept = [...res.candidate.facts, ...res.candidate.questions, ...res.candidate.hypotheses.flatMap((h) => [h.statement, ...h.caveats])]
    expect(kept.every((t) => originals.has(t))).toBe(true)
    expect(res.candidate.facts).toEqual(['Ruido al arrancar.'])
    expect(res.candidate.hypotheses).toHaveLength(1)
    expect(res.issues.every((i) => /^[a-zA-Z*.$]+:[a-z_]+$/.test(i))).toBe(true)
  })
})

describe('D-13 / DSN-02: irrecoverable answers keep the safe fallback, with the failed constraint recorded', () => {
  it('DSN-02-A: invalid JSON → fallback, schemaIssues ["$:json_parse"]', async () => {
    const r = await run('{"facts": ["Ruido"], "hypotheses": [ {"statement": "x", ')
    expect(r.fallback).toBe(true)
    expect(r.errorCode).toBe('LLM_SCHEMA_VIOLATION')
    expect(r.traces![0]!.schemaIssues).toEqual(['$:json_parse'])
  })

  it('DSN-02-B: hypotheses missing → fallback (an empty orientation is not a recovered answer)', async () => {
    const r = await run(JSON.stringify({ facts: ['Ruido'], questions: ['¿Desde cuándo?'] }))
    expect(r.fallback).toBe(true)
    expect(r.traces![0]!.schemaIssues).toContain('hypotheses:invalid_type')
  })

  it('DSN-02-C: every hypothesis unusable → fallback', async () => {
    const r = await run(answer({ hypotheses: [H({ statement: 'S'.repeat(600) }), H({ confidence: 'segura' })] }))
    expect(r.fallback).toBe(true)
    expect(r.traces![0]!.schemaIssues).toEqual(expect.arrayContaining(['hypotheses.*.statement:too_big', 'hypotheses.*.confidence:invalid_enum_value']))
  })

  it('DSN-02-D: schemaIssues never contain answer content', async () => {
    const r = await run(answer({ hypotheses: [H({ statement: 'PATENTE ABC123 '.repeat(40) })] }))
    expect(JSON.stringify(r.traces)).not.toMatch(/PATENTE|ABC123/)
  })
})

describe('D-13 × D-14 / DSN-03: normalization never launders unsafe text', () => {
  it('DSN-03-A: an over-length caveat that suggests disconnecting the battery withholds the whole answer', async () => {
    const unsafe = 'Se confirmaría si al desconectar la batería durante toda la noche el consumo parásito desaparece por completo y a la mañana siguiente el auto vuelve a arrancar sin ningún problema ni ruido extraño en el arranque.'
    expect(unsafe.length).toBeGreaterThan(200)
    const r = await run(answer({ hypotheses: [H({ caveats: [unsafe] })] }))
    expect(r.fallback).toBe(true)
    expect(r.hypotheses).toEqual([])
    expect(r.warnings).toContain(OUTPUT_WITHHELD_WARNING)
    expect(r.errorCode).toBe('LLM_OUTPUT_UNSAFE')
  })
})
