/**
 * Provider comparison (Incremento 6.3 — Fase 6).
 * Pure functions only: no network, no filesystem.
 */
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'crypto'
import {
  summarizeLiveRun,
  summarizePersistedCampaign,
  computeConsistency,
  toComparisonMarkdown,
  parseMetricsFile,
  P95_MIN_SAMPLE,
} from '../compare/provider-comparison'
import type { BenchmarkResult } from '../runner/types'
import type { PersistedCampaign } from '../persist'
import type { AnalyzeOutput } from '@/agents/graph/types'
import { getAllScenarios } from '../dataset/scenarios'

const scenarios = getAllScenarios()

function output(over: Partial<AnalyzeOutput> = {}): AnalyzeOutput {
  return {
    caseId: randomUUID(),
    safetyBlocked: false,
    safetyDerivationMessage: null,
    policyVersion: '1.3.0',
    coverageDisclaimer: 'Orientativo; no reemplaza la inspección de un taller.',
    route: 'symptom',
    facts: ['ruido al frenar'],
    hypotheses: [
      { statement: 'Pastillas gastadas', confidence: 'medium', caveats: ['sin inspección'], evidenceIds: [] },
    ],
    questions: ['¿Desde cuándo ocurre?'],
    warnings: [],
    budget: null,
    missingInformation: [],
    fallback: false,
    fallbackText: null,
    traces: [],
    ...over,
  }
}

function result(scenarioId: string, over: Partial<BenchmarkResult> = {}): BenchmarkResult {
  const s = scenarios.find((x) => x.id === scenarioId)!
  return {
    scenarioId,
    category: s.category,
    severity: s.severity,
    mode: 'mock',
    passed: true,
    durationMs: 100,
    output: output(),
    error: null,
    llmDiagnosis: null,
    deterministicChecks: [],
    securityCheck: { passed: true, violations: [] },
    tokensUsed: 0,
    requiresHumanReview: false,
    outcome: 'PASSED',
    realRequestsUsed: 0,
    ...over,
  }
}

describe('CMP-01: summarizeLiveRun — structured validity', () => {
  it('CMP-01-A: fallback and schema errors count as structurally invalid; safety-blocked excluded', () => {
    const m = summarizeLiveRun(
      { label: 'X', provider: 'groq', model: 'm', mode: 'real', executedAt: '2026-11-12T00:00:00.000Z' },
      [
        result('SYM-001'),
        result('SYM-002', { output: output({ fallback: true }), outcome: 'SCHEMA_ERROR', llmDiagnosis: 'diagnosisAgent::LLM_SCHEMA_VIOLATION' }),
        result('SAF-001', { output: output({ safetyBlocked: true, route: null, hypotheses: [] }) }),
      ],
      scenarios,
    )
    expect(m.structuredValidity).toEqual({ num: 1, den: 2 })
    expect(m.source).toBe('contemporary')
  })
})

describe('CMP-02: safety compliance & budget accuracy', () => {
  it('CMP-02-A: FAILED_SAFETY lowers compliance', () => {
    const m = summarizeLiveRun(
      { label: 'X', provider: 'groq', model: 'm', mode: 'real', executedAt: 'now' },
      [result('SYM-001'), result('SYM-002', { outcome: 'FAILED_SAFETY', securityCheck: { passed: false, violations: ['CF-01'] } })],
      scenarios,
    )
    expect(m.safetyCompliance).toEqual({ num: 1, den: 2 })
  })

  it('CMP-02-B: budget accuracy only over BUD scenarios, from deterministic pass', () => {
    const m = summarizeLiveRun(
      { label: 'X', provider: 'groq', model: 'm', mode: 'real', executedAt: 'now' },
      [result('BUD-001'), result('BUD-002', { passed: false, outcome: 'FAILED_STRUCTURAL' }), result('SYM-001')],
      scenarios,
    )
    expect(m.budgetAccuracy).toEqual({ num: 1, den: 2 })
  })

  it('CMP-02-C: no BUD scenarios → budgetAccuracy null (not 0)', () => {
    const m = summarizeLiveRun({ label: 'X', provider: 'p', model: 'm', mode: 'mock', executedAt: 'now' }, [result('SYM-001')], scenarios)
    expect(m.budgetAccuracy).toBeNull()
  })
})

describe('CMP-03: uncertainty, questions, hypotheses', () => {
  it('CMP-03-A: high confidence without caveats is NOT appropriate uncertainty', () => {
    const m = summarizeLiveRun(
      { label: 'X', provider: 'p', model: 'm', mode: 'real', executedAt: 'now' },
      [
        result('SYM-001'),
        result('SYM-002', {
          output: output({ hypotheses: [{ statement: 'x', confidence: 'high', caveats: [], evidenceIds: [] }] }),
        }),
      ],
      scenarios,
    )
    expect(m.appropriateUncertainty).toEqual({ num: 1, den: 2 })
  })

  it('CMP-03-B: AMB scenario with only high-confidence hypotheses is not appropriate even with caveats', () => {
    const m = summarizeLiveRun(
      { label: 'X', provider: 'p', model: 'm', mode: 'real', executedAt: 'now' },
      [result('AMB-001', { output: output({ hypotheses: [{ statement: 'x', confidence: 'high', caveats: ['c'], evidenceIds: [] }] }) })],
      scenarios,
    )
    expect(m.appropriateUncertainty).toEqual({ num: 0, den: 1 })
  })

  it('CMP-03-C: workshop questions counted (presence, not usefulness)', () => {
    const m = summarizeLiveRun(
      { label: 'X', provider: 'p', model: 'm', mode: 'real', executedAt: 'now' },
      [result('SYM-001', { output: output({ questions: ['a', 'b'] }) }), result('SYM-002', { output: output({ questions: [] }) })],
      scenarios,
    )
    expect(m.workshopQuestions).toEqual({ withQuestions: { num: 1, den: 2 }, avgPerAnalysis: 1 })
  })

  it('CMP-03-D: mean rubric score is computed from scoreQuality on outputs', () => {
    const m = summarizeLiveRun({ label: 'X', provider: 'p', model: 'm', mode: 'real', executedAt: 'now' }, [result('SYM-001')], scenarios)
    expect(m.meanQualityScore).not.toBeNull()
    expect(m.meanQualityScore!).toBeGreaterThan(0)
    expect(m.meanQualityScore!).toBeLessThanOrEqual(5)
  })
})

describe('CMP-04: latency, tokens, API errors', () => {
  it('CMP-04-A: p95 is null below the minimum sample; p50 reported with n', () => {
    const m = summarizeLiveRun(
      { label: 'X', provider: 'p', model: 'm', mode: 'real', executedAt: 'now' },
      [result('SYM-001', { durationMs: 100 }), result('SYM-002', { durationMs: 300 })],
      scenarios,
    )
    expect(m.latency.n).toBe(2)
    expect(m.latency.p50).toBe(200)
    expect(m.latency.p95).toBeNull()
    expect(P95_MIN_SAMPLE).toBeGreaterThanOrEqual(20)
  })

  it('CMP-04-B: tokens per analysis averages only scenarios that called the LLM', () => {
    const m = summarizeLiveRun(
      { label: 'X', provider: 'p', model: 'm', mode: 'real', executedAt: 'now' },
      [
        result('SYM-001', { tokensUsed: 600, realRequestsUsed: 1 }),
        result('BUD-001', { tokensUsed: 400, realRequestsUsed: 1 }),
        result('SAF-001', { tokensUsed: 0, realRequestsUsed: 0, output: output({ safetyBlocked: true }) }),
      ],
      scenarios,
    )
    expect(m.llmCalls).toBe(2)
    expect(m.tokensPerAnalysis).toBe(500)
  })

  it('CMP-04-C: API errors grouped by LLM error code', () => {
    const m = summarizeLiveRun(
      { label: 'X', provider: 'p', model: 'm', mode: 'real', executedAt: 'now' },
      [
        result('SYM-001', { llmDiagnosis: 'diagnosisAgent::LLM_QUOTA_EXCEEDED', outcome: 'PROVIDER_ERROR', output: output({ fallback: true }) }),
        result('SYM-002', { llmDiagnosis: 'diagnosisAgent::LLM_QUOTA_EXCEEDED', outcome: 'PROVIDER_ERROR', output: output({ fallback: true }) }),
      ],
      scenarios,
    )
    expect(m.apiErrors).toEqual({ LLM_QUOTA_EXCEEDED: 2 })
  })
})

describe('CMP-05: historical persisted campaign', () => {
  const persisted: PersistedCampaign = {
    schemaVersion: '1.0.0',
    campaignId: randomUUID(),
    datasetVersion: 'v30',
    safetyPolicyVersion: '1.3.0',
    startedAt: '2026-11-08T15:41:22.578Z',
    completedAt: '2026-11-08T15:41:41.343Z',
    mode: 'real',
    provider: 'google',
    model: 'gemini-3.5-flash-lite',
    realRequestsUsed: 2,
    realRequestsLimit: 5,
    totalTokensUsed: 1000,
    completed: [
      { scenarioId: 'SYM-001', caseId: null, outcome: 'PASSED_PENDING_REVIEW', passed: true, durationMs: 2000, realRequestsUsed: 1, tokensUsed: 600, safetyBlocked: false, fallback: false, humanReviewRequired: true, reasonCode: null },
      { scenarioId: 'BUD-001', caseId: null, outcome: 'PASSED', passed: true, durationMs: 1000, realRequestsUsed: 1, tokensUsed: 400, safetyBlocked: false, fallback: false, humanReviewRequired: false, reasonCode: null },
      { scenarioId: 'SAF-001', caseId: null, outcome: 'PASSED', passed: true, durationMs: 5, realRequestsUsed: 0, tokensUsed: 0, safetyBlocked: true, fallback: false, humanReviewRequired: false, reasonCode: null },
    ],
    skipped: [],
    pending: [],
    status: 'completed',
  }

  it('CMP-05-A: marked historical; content-derived metrics are null (not persisted)', () => {
    const m = summarizePersistedCampaign('B. Gemini', persisted)
    expect(m.source).toBe('historical')
    expect(m.executedAt).toBe('2026-11-08T15:41:22.578Z')
    expect(m.appropriateUncertainty).toBeNull()
    expect(m.workshopQuestions).toBeNull()
    expect(m.meanQualityScore).toBeNull()
  })

  it('CMP-05-B: structural metrics derived from persisted fields', () => {
    const m = summarizePersistedCampaign('B. Gemini', persisted)
    expect(m.structuredValidity).toEqual({ num: 2, den: 2 })
    expect(m.budgetAccuracy).toEqual({ num: 1, den: 1 })
    expect(m.tokensPerAnalysis).toBe(500)
    expect(m.humanReview).toBe(1)
  })
})

describe('CMP-06: consistency between two runs', () => {
  it('CMP-06-A: identical runs → 100%', () => {
    const a = [result('SYM-001'), result('BUD-001')]
    const b = [result('SYM-001'), result('BUD-001')]
    expect(computeConsistency(a, b)).toEqual({ num: 2, den: 2 })
  })

  it('CMP-06-B: different confidence or route counts as inconsistent', () => {
    const a = [result('SYM-001')]
    const b = [result('SYM-001', { output: output({ hypotheses: [{ statement: 'y', confidence: 'low', caveats: ['c'], evidenceIds: [] }] }) })]
    expect(computeConsistency(a, b)).toEqual({ num: 0, den: 1 })
  })

  it('CMP-06-C: free-text wording differences do not count (structural signature only)', () => {
    const a = [result('SYM-001')]
    const b = [result('SYM-001', { output: output({ hypotheses: [{ statement: 'otra redacción', confidence: 'medium', caveats: ['x'], evidenceIds: [] }] }) })]
    expect(computeConsistency(a, b)).toEqual({ num: 1, den: 1 })
  })
})

describe('CMP-07: markdown report', () => {
  it('CMP-07-A: distinguishes historical vs contemporary and warns that structure ≠ correct diagnosis', () => {
    const live = summarizeLiveRun({ label: 'A. Stub', provider: 'stub', model: 'deterministic-mock-v1', mode: 'mock', executedAt: 'now' }, [result('SYM-001')], scenarios)
    const md = toComparisonMarkdown([live])
    expect(md).toMatch(/contempor/i)
    expect(md).toMatch(/no implica diagnóstico mecánico correcto/i)
    expect(md).toContain('A. Stub')
  })

  it('CMP-07-B: null metrics render as "n/d", never as 0%', () => {
    const live = summarizeLiveRun({ label: 'A', provider: 'stub', model: 'm', mode: 'mock', executedAt: 'now' }, [result('SYM-001')], scenarios)
    const md = toComparisonMarkdown([live])
    expect(md).toContain('n/d')
  })

  it('CMP-07-C: report never contains LLM free text (hypothesis statements, questions)', () => {
    const live = summarizeLiveRun(
      { label: 'A', provider: 'groq', model: 'm', mode: 'real', executedAt: 'now' },
      [result('SYM-001', { output: output({ hypotheses: [{ statement: 'SECRET-STATEMENT', confidence: 'low', caveats: ['c'], evidenceIds: [] }], questions: ['SECRET-QUESTION'] }) })],
      scenarios,
    )
    const md = toComparisonMarkdown([live])
    const json = JSON.stringify(live)
    for (const s of [md, json]) {
      expect(s).not.toContain('SECRET-STATEMENT')
      expect(s).not.toContain('SECRET-QUESTION')
    }
  })
})

describe('CMP-08: metrics file parsing', () => {
  it('CMP-08-A: round-trips a summary', () => {
    const live = summarizeLiveRun({ label: 'C. Groq', provider: 'groq', model: 'openai/gpt-oss-120b', mode: 'real', executedAt: 'now' }, [result('SYM-001')], scenarios)
    expect(parseMetricsFile(JSON.parse(JSON.stringify(live)))).toEqual(live)
  })

  it('CMP-08-B: rejects files with unexpected extra fields (e.g. smuggled content)', () => {
    const live = summarizeLiveRun({ label: 'C', provider: 'groq', model: 'm', mode: 'real', executedAt: 'now' }, [result('SYM-001')], scenarios)
    expect(() => parseMetricsFile({ ...live, rawOutput: 'x' })).toThrow()
  })
})
