import { describe, it, expect } from 'vitest'
import { toJSON, toMarkdown } from '../runner/report'
import type { BenchmarkSummary, BenchmarkResult } from '../runner/types'

function makeResult(overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    scenarioId: 'SYM-001',
    category: 'symptom',
    severity: 'low',
    mode: 'mock',
    passed: true,
    durationMs: 120,
    output: null,
    error: null,
    llmDiagnosis: null,
    deterministicChecks: [],
    securityCheck: { passed: true, violations: [] },
    tokensUsed: 0,
    requiresHumanReview: false,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<BenchmarkSummary> = {}): BenchmarkSummary {
  return {
    runId: '11111111-1111-1111-1111-111111111111',
    startedAt: '2026-11-06T10:00:00.000Z',
    completedAt: '2026-11-06T10:01:00.000Z',
    mode: 'mock',
    total: 2,
    passed: 2,
    failed: 0,
    errors: 0,
    passRate: 1.0,
    byCategory: [{ category: 'symptom', total: 2, passed: 2, failed: 0, passRate: 1.0, avgDurationMs: 120, totalTokens: 0 }],
    latencyMs: { p50: 100, p95: 150, max: 200 },
    totalTokensUsed: 0,
    estimatedCostUsd: 0,
    humanReviewRequired: 0,
    results: [makeResult()],
    ...overrides,
  }
}

describe('REP-01: JSON output', () => {
  it('REP-01-A: toJSON returns parseable JSON', () => {
    const json = toJSON(makeSummary())
    expect(() => JSON.parse(json)).not.toThrow()
  })

  it('REP-01-B: JSON contains runId and mode', () => {
    const json = toJSON(makeSummary())
    const parsed = JSON.parse(json) as { runId: string; mode: string }
    expect(parsed.runId).toBe('11111111-1111-1111-1111-111111111111')
    expect(parsed.mode).toBe('mock')
  })

  it('REP-01-C: results array is empty by default (includeResultDetails=false)', () => {
    const json = toJSON(makeSummary())
    const parsed = JSON.parse(json) as { results: unknown[] }
    expect(parsed.results).toHaveLength(0)
  })

  it('REP-01-D: results array populated when includeResultDetails=true', () => {
    const json = toJSON(makeSummary(), { includeResultDetails: true })
    const parsed = JSON.parse(json) as { results: unknown[] }
    expect(parsed.results.length).toBeGreaterThan(0)
  })
})

describe('REP-02: Markdown output', () => {
  it('REP-02-A: toMarkdown returns a string', () => {
    const md = toMarkdown(makeSummary())
    expect(typeof md).toBe('string')
    expect(md.length).toBeGreaterThan(100)
  })

  it('REP-02-B: Markdown contains a heading with the runId', () => {
    const md = toMarkdown(makeSummary())
    expect(md).toContain('# Benchmark Report')
    expect(md).toContain('11111111-1111-1111-1111-111111111111')
  })

  it('REP-02-C: Markdown includes cost disclaimer', () => {
    const md = toMarkdown(makeSummary())
    expect(md).toContain('Cost estimate is approximate')
  })

  it('REP-02-D: Markdown includes latency section', () => {
    const md = toMarkdown(makeSummary())
    expect(md).toContain('p50')
    expect(md).toContain('p95')
  })

  it('REP-02-E: Markdown shows "Unknown model" when estimatedCostUsd is null', () => {
    const md = toMarkdown(makeSummary({ estimatedCostUsd: null }))
    expect(md).toContain('Unknown model')
  })
})

describe('REP-03: No credentials in output', () => {
  it('REP-03-A: JSON redacts sk-ant- patterns', () => {
    const summary = makeSummary({
      results: [makeResult({ error: 'Request failed with sk-ant-api03-secret-key-abc' })],
    })
    const json = toJSON(summary, { includeResultDetails: true })
    expect(json).not.toContain('sk-ant-api03')
    expect(json).toContain('[REDACTED]')
  })

  it('REP-03-B: JSON redacts Bearer patterns', () => {
    const summary = makeSummary({
      results: [makeResult({ error: 'Auth failed: Bearer eyJhbGc...' })],
    })
    const json = toJSON(summary, { includeResultDetails: true })
    expect(json).not.toContain('Bearer eyJ')
    expect(json).toContain('[REDACTED]')
  })

  it('REP-03-C: JSON redacts Google API key (AIza...) patterns', () => {
    const fakeKey = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVW'
    const summary = makeSummary({
      results: [makeResult({ error: `Gemini call failed with key=${fakeKey}` })],
    })
    const json = toJSON(summary, { includeResultDetails: true })
    expect(json).not.toContain(fakeKey)
    expect(json).toContain('[REDACTED]')
  })

  it('REP-03-D: JSON redacts GEMINI_API_KEY literal', () => {
    const summary = makeSummary({
      results: [makeResult({ error: 'Leaked env: GEMINI_API_KEY=secret' })],
    })
    const json = toJSON(summary, { includeResultDetails: true })
    expect(json).not.toContain('GEMINI_API_KEY=secret')
    expect(json).toContain('[REDACTED]')
  })

  it('REP-03-E: JSON redacts all occurrences (not just first)', () => {
    const summary = makeSummary({
      results: [
        makeResult({ error: 'key sk-ant-abc123 and sk-ant-xyz789 both failed' }),
      ],
    })
    const json = toJSON(summary, { includeResultDetails: true })
    expect(json).not.toContain('sk-ant-abc123')
    expect(json).not.toContain('sk-ant-xyz789')
  })
})

describe('REP-04: omitTraces option', () => {
  it('REP-04-A: traces are included by default', () => {
    const result = makeResult({
      output: {
        caseId: '00000000-0000-0000-0000-000000000001',
        safetyBlocked: false,
        safetyDerivationMessage: null,
        policyVersion: 'v1.2.0',
        coverageDisclaimer: 'dc',
        route: 'symptom',
        facts: [],
        hypotheses: [],
        questions: [],
        warnings: [],
        budget: null,
        missingInformation: [],
        fallback: false,
        fallbackText: null,
        traces: [{ node: 'validator', durationMs: 5 }],
      },
    })
    const json = toJSON(makeSummary({ results: [result] }), { includeResultDetails: true })
    const parsed = JSON.parse(json) as { results: Array<{ output: { traces: unknown[] } }> }
    expect(parsed.results[0]?.output?.traces.length).toBeGreaterThan(0)
  })

  it('REP-04-B: traces are removed when omitTraces=true', () => {
    const result = makeResult({
      output: {
        caseId: '00000000-0000-0000-0000-000000000001',
        safetyBlocked: false,
        safetyDerivationMessage: null,
        policyVersion: 'v1.2.0',
        coverageDisclaimer: 'dc',
        route: 'symptom',
        facts: [],
        hypotheses: [],
        questions: [],
        warnings: [],
        budget: null,
        missingInformation: [],
        fallback: false,
        fallbackText: null,
        traces: [{ node: 'validator', durationMs: 5 }],
      },
    })
    const json = toJSON(makeSummary({ results: [result] }), { includeResultDetails: true, omitTraces: true })
    const parsed = JSON.parse(json) as { results: Array<{ output: { traces: unknown[] } }> }
    expect(parsed.results[0]?.output?.traces).toHaveLength(0)
  })
})
