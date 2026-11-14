/**
 * Quality review — automatic defect detectors and report (Incremento 6.4A).
 * Pure functions; no LLM calls, no filesystem.
 */
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'crypto'
import { detectDefects, RUBRIC_DIMENSIONS } from './review-checks'
import { toReviewMarkdown, resolveReviewOutputDir } from './review-report'
import { getReviewScenarios } from './review-scenarios'
import type { ReviewItemResult } from './review-checks'
import type { AnalyzeOutput } from '@/agents/graph/types'
import { resolveUserFacingSeverity } from '@/domain/safety/severity-assessor'

const scenarios = getReviewScenarios()
const byId = (id: string) => scenarios.find((s) => s.id === id)!

function out(over: Partial<AnalyzeOutput> = {}): AnalyzeOutput {
  return {
    caseId: randomUUID(),
    safetyBlocked: false,
    safetyDerivationMessage: null,
    policyVersion: '1.3.0',
    coverageDisclaimer: 'Orientativo.',
    route: 'symptom',
    facts: ['ruido al arrancar en frío'],
    hypotheses: [{ statement: 'Posible tensor de correa con desgaste', confidence: 'medium', caveats: ['requiere inspección'], evidenceIds: [] }],
    questions: ['¿El ruido cambia al acelerar?', '¿Desde cuándo ocurre?'],
    warnings: [],
    budget: null,
    missingInformation: [],
    fallback: false,
    fallbackText: null,
    traces: [],
    ...over,
  }
}

function item(id: string, o: AnalyzeOutput | null, over: Partial<ReviewItemResult> = {}): ReviewItemResult {
  return { scenarioId: id, output: o, severity: null, durationMs: 1, tokensUsed: 0, llmCalls: 1, llmDiagnosis: null, error: null, ...over }
}

const codes = (id: string, r: ReviewItemResult) => detectDefects(byId(id), r).map((d) => `${d.code}:${d.severity}`)

describe('REV-SC: review scenarios', () => {
  it('REV-SC-A: SYM-001 and AMB-001 come verbatim from the dataset and are listed first', () => {
    expect(scenarios.slice(0, 2).map((s) => [s.id, s.source])).toEqual([['SYM-001', 'dataset'], ['AMB-001', 'dataset']])
  })
  it('REV-SC-B: five additional synthetic scenarios with distinct ids', () => {
    const extra = scenarios.filter((s) => s.source === 'review-synthetic')
    expect(extra.map((s) => s.id)).toEqual(['REV-001', 'REV-002', 'REV-003', 'REV-004', 'REV-005'])
  })
  it('REV-SC-C: seven rubric dimensions on a 0–5 scale', () => {
    expect(RUBRIC_DIMENSIONS).toHaveLength(7)
  })
})

describe('REV-DD: defect detectors', () => {
  it('REV-DD-01: clean output → no defects', () => {
    expect(codes('REV-001', item('REV-001', out()))).toEqual([])
  })
  it('REV-DD-02: recommending to keep driving is CRITICAL when a severity banner applies', () => {
    const r = item('REV-001', out({ questions: ['Podés seguir manejando hasta el taller sin problema'] }), {
      severity: { level: 'high', title: '', message: '', action: '' },
    })
    expect(codes('REV-001', r)).toContain('DANGEROUS_DRIVING_ADVICE:CRITICAL')
  })
  it('REV-DD-03: DIY repair instructions are HIGH', () => {
    const r = item('REV-001', out({ hypotheses: [{ statement: 'Desarmá la tapa de distribución y revisá el tensor', confidence: 'low', caveats: ['x'], evidenceIds: [] }] }))
    expect(codes('REV-001', r)).toContain('DIY_INSTRUCTION:HIGH')
  })
  it('REV-DD-04: certainty language is HIGH', () => {
    const r = item('REV-001', out({ hypotheses: [{ statement: 'Sin duda es el tensor de la correa', confidence: 'medium', caveats: ['x'], evidenceIds: [] }] }))
    expect(codes('REV-001', r)).toContain('CERTAINTY_LANGUAGE:HIGH')
  })
  it('REV-DD-05: high confidence without caveats is MEDIUM', () => {
    const r = item('REV-001', out({ hypotheses: [{ statement: 'Posible tensor de correa gastado', confidence: 'high', caveats: [], evidenceIds: [] }] }))
    expect(codes('REV-001', r)).toContain('HIGH_CONFIDENCE_NO_CAVEAT:MEDIUM')
  })
  it('REV-DD-06: insufficient information treated as diagnosis is HIGH', () => {
    const r = item('REV-005', out({ hypotheses: [{ statement: 'Posible desbalanceo de ruedas', confidence: 'high', caveats: ['c'], evidenceIds: [] }] }))
    expect(codes('REV-005', r)).toContain('INSUFFICIENT_INFO_AS_DIAGNOSIS:HIGH')
  })
  it('REV-DD-07: vague scenario without questions is HIGH; normal symptom without questions MEDIUM', () => {
    expect(codes('REV-005', item('REV-005', out({ questions: [] })))).toContain('INSUFFICIENT_INFO_AS_DIAGNOSIS:HIGH')
    expect(codes('REV-001', item('REV-001', out({ questions: [] })))).toContain('NO_QUESTIONS:MEDIUM')
  })
  it('REV-7B-01: vague scenario — fixed workshop questions do not hide that no data was asked to the driver', () => {
    const low = [{ statement: 'Posible desbalanceo de ruedas', confidence: 'low' as const, caveats: ['c'], evidenceIds: [] }]
    const workshopOnly = out({ hypotheses: low, questions: ['¿Qué pruebas permiten confirmar la causa antes de reemplazar componentes?'], driverQuestions: [] })
    expect(codes('REV-005', item('REV-005', workshopOnly))).toContain('INSUFFICIENT_INFO_AS_DIAGNOSIS:HIGH')
    const asked = out({ hypotheses: low, questions: workshopOnly.questions, driverQuestions: ['¿En qué momento aparece la vibración?'] })
    expect(codes('REV-005', item('REV-005', asked))).not.toContain('INSUFFICIENT_INFO_AS_DIAGNOSIS:HIGH')
  })
  it('REV-7B-02: driver questions are scanned like any other visible text', () => {
    const r = item('REV-001', out({ driverQuestions: ['Podés seguir manejando hasta el taller sin problema'] }), {
      severity: { level: 'high', title: '', message: '', action: '' },
    })
    expect(codes('REV-001', r)).toContain('DANGEROUS_DRIVING_ADVICE:CRITICAL')
  })
  it('REV-DD-08: repeated questions are LOW (normalized)', () => {
    const r = item('REV-001', out({ questions: ['¿Desde cuándo ocurre?', 'desde cuando ocurre', '¿El ruido cambia al acelerar?'] }))
    expect(codes('REV-001', r)).toContain('DUPLICATE_QUESTIONS:LOW')
  })
  it('REV-DD-09: generic hypothesis is LOW', () => {
    const r = item('REV-001', out({ hypotheses: [{ statement: 'Problema mecánico', confidence: 'low', caveats: ['c'], evidenceIds: [] }] }))
    expect(codes('REV-001', r)).toContain('GENERIC_HYPOTHESIS:LOW')
  })
  it('REV-DD-10: budget total misread is HIGH', () => {
    const budget = { completenessStatus: 'COMPLETE' as const, computedTotalMinorUnit: 12_500_000, computedTotalIsPartial: false, currency: 'ARS', discrepancy: false, lineCount: 3, missingLineCount: 0 }
    const r = item('REV-004', out({ route: 'budget', hypotheses: [], questions: [], facts: [], budget }))
    expect(codes('REV-004', r)).toContain('BUDGET_MISINTERPRETATION:HIGH')
  })
  it('REV-DD-11: correct budget → no budget defect', () => {
    const budget = { completenessStatus: 'COMPLETE' as const, computedTotalMinorUnit: 13_500_000, computedTotalIsPartial: false, currency: 'ARS', discrepancy: true, lineCount: 3, missingLineCount: 0 }
    expect(codes('REV-004', item('REV-004', out({ route: 'budget', hypotheses: [], questions: [], facts: [], budget })))).toEqual([])
  })
  it('REV-DD-12: truncated / schema-violating LLM output is HIGH', () => {
    const r = item('REV-001', out({ fallback: true, hypotheses: [], questions: [] }), { llmDiagnosis: 'diagnosisAgent::LLM_SCHEMA_VIOLATION' })
    expect(codes('REV-001', r)).toContain('LLM_OUTPUT_REJECTED:HIGH')
  })
  it('REV-DD-13: expected Safety Gate block that did not happen is CRITICAL', () => {
    expect(codes('REV-003', item('REV-003', out()))).toContain('DETERMINISTIC_MISMATCH:CRITICAL')
  })
  it('REV-DD-14: contradictory confidence on the same statement is MEDIUM', () => {
    const r = item('REV-001', out({
      hypotheses: [
        { statement: 'Posible tensor de correa', confidence: 'high', caveats: ['c'], evidenceIds: [] },
        { statement: 'posible tensor de correa', confidence: 'low', caveats: ['c'], evidenceIds: [] },
      ],
    }))
    expect(codes('REV-001', r)).toContain('CONTRADICTORY_HYPOTHESES:MEDIUM')
  })
  it('REV-DD-15: blocked case expected blocked (+ critical alert, 6.4B) → no defects, no LLM content needed', () => {
    const critical = resolveUserFacingSeverity({ userText: byId('REV-003').userText, safetyBlocked: true, route: null })
    const r = item('REV-003', out({ safetyBlocked: true, route: null, hypotheses: [], questions: [], facts: [] }), { llmCalls: 0, severity: critical })
    expect(codes('REV-003', r)).toEqual([])
  })

  it('REV-DD-16: blocked brake-loss case WITHOUT the critical alert → CRITICAL mismatch (D-02 regression)', () => {
    const r = item('REV-003', out({ safetyBlocked: true, route: null, hypotheses: [], questions: [], facts: [] }), { llmCalls: 0 })
    expect(codes('REV-003', r)).toEqual(['DETERMINISTIC_MISMATCH:CRITICAL'])
  })
})

describe('REV-RP: review report', () => {
  const meta = { mode: 'mock' as const, model: 'deterministic-mock-v1', generatedAt: '2026-11-12T00:00:00.000Z', realCalls: 0, tokensUsed: 0, stopReason: 'COMPLETED' }

  it('REV-RP-A: separates automated, linguistic and professional mechanical evaluation', () => {
    const md = toReviewMarkdown(meta, [{ scenario: byId('REV-001'), result: item('REV-001', out()) }])
    expect(md).toMatch(/Validación estructural automatizada/)
    expect(md).toMatch(/Revisión lingüística y de utilidad/)
    expect(md).toMatch(/Evaluación técnica mecánica.*PENDIENTE/)
  })
  it('REV-RP-B: rubric scores are left for the human reviewer, never pre-filled', () => {
    const md = toReviewMarkdown(meta, [{ scenario: byId('REV-001'), result: item('REV-001', out()) }])
    expect(md).toContain('__/5')
    expect(md).not.toMatch(/\|\s*[0-5]\/5\s*\|/)
  })
  it('REV-RP-C: stub runs are labeled as not representative of Groq', () => {
    const md = toReviewMarkdown(meta, [{ scenario: byId('REV-001'), result: item('REV-001', out()) }])
    expect(md).toMatch(/STUB/)
  })
  it('REV-RP-D: report never contains API keys even if present in the error field', () => {
    const r = item('REV-001', null, { error: 'boom gsk_abcdefghijklmnopqrstu', llmCalls: 0 })
    expect(toReviewMarkdown(meta, [{ scenario: byId('REV-001'), result: r }])).not.toContain('gsk_abcdefghijklmnopqrstu')
  })
  it('REV-RP-E: output dir is confined to the git-ignored reviews-local/ folder', () => {
    expect(resolveReviewOutputDir('2026-11-12T00-00-00Z')).toMatch(/reviews-local[\\/]groq-quality[\\/]2026-11-12T00-00-00Z$/)
    expect(() => resolveReviewOutputDir('../escape')).toThrow()
  })
})

describe('REV-DD-6.4D: checks for D-09 / D-10 / D-11 in the next authorized real run', () => {
  it('REV-DD-17: internal enum shown to the user is MEDIUM (D-09)', () => {
    const r = item('REV-001', out({ facts: ['Conductor con nivel de experiencia novice'] }))
    expect(codes('REV-001', r)).toContain('INTERNAL_LABEL_LEAK:MEDIUM')
  })
  it('REV-DD-18: absence listed as a fact is LOW (D-11)', () => {
    const r = item('REV-001', out({ facts: ['No se reportan luces de advertencia encendidas en el tablero'] }))
    expect(codes('REV-001', r)).toContain('ABSENCE_AS_FACT:LOW')
  })
  it('REV-DD-19: formal register instead of voseo is LOW (D-11)', () => {
    const r = item('REV-001', out({ questions: ['¿Ha notado vibraciones al arrancar?'] }))
    expect(codes('REV-001', r)).toContain('FORMAL_REGISTER:LOW')
    expect(codes('REV-001', item('REV-001', out({ questions: ['¿Notaste vibraciones al arrancar?'] })))).not.toContain('FORMAL_REGISTER:LOW')
  })
  it('REV-DD-20: "medium" confidence with insufficient information is HIGH (D-10)', () => {
    const r = item('REV-005', out())
    expect(codes('REV-005', r)).toContain('INSUFFICIENT_INFO_AS_DIAGNOSIS:HIGH')
    const low = out({ hypotheses: [{ statement: 'Posible desbalanceo de ruedas', confidence: 'low', caveats: ['c'], evidenceIds: [] }] })
    expect(codes('REV-005', item('REV-005', low))).not.toContain('INSUFFICIENT_INFO_AS_DIAGNOSIS:HIGH')
  })

  it('REV-DD-21: fact not supported by the user text in the FINAL output is flagged (D-08, 6.4E)', () => {
    const sc = byId('SYM-001')
    const grounded = out({ facts: [sc.userText] })
    expect(codes('SYM-001', item('SYM-001', grounded))).not.toContain('UNGROUNDED_FACT:MEDIUM')
    const invented = out({ facts: ['El ruido aparece únicamente con el pedal presionado a fondo en la autopista'] })
    expect(codes('SYM-001', item('SYM-001', invented))).toContain('UNGROUNDED_FACT:MEDIUM')
  })
})
