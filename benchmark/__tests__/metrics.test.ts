import { describe, it, expect } from 'vitest'
import { computeLatencyPercentiles, aggregateByCategory } from '../runner/metrics'
import type { BenchmarkResult } from '../runner/types'

function makeResult(overrides: Partial<BenchmarkResult>): BenchmarkResult {
  return {
    scenarioId: 'TEST-001',
    category: 'symptom',
    severity: 'low',
    mode: 'mock',
    passed: true,
    durationMs: 100,
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

describe('MET-01: computeLatencyPercentiles', () => {
  it('MET-01-A: empty array returns zeroes with smallSampleWarning=true', () => {
    const result = computeLatencyPercentiles([])
    expect(result.p50).toBe(0)
    expect(result.p95).toBe(0)
    expect(result.max).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.smallSampleWarning).toBe(true)
  })

  it('MET-01-B: single result returns its duration for all percentiles', () => {
    const result = computeLatencyPercentiles([makeResult({ durationMs: 250 })])
    expect(result.p50).toBe(250)
    expect(result.p95).toBe(250)
    expect(result.max).toBe(250)
  })

  it('MET-01-C: smallSampleWarning=true when fewer than 5 results', () => {
    const results = [1, 2, 3, 4].map((n) => makeResult({ durationMs: n * 100 }))
    const r = computeLatencyPercentiles(results)
    expect(r.smallSampleWarning).toBe(true)
  })

  it('MET-01-D: smallSampleWarning=false when 5+ results', () => {
    const results = [1, 2, 3, 4, 5].map((n) => makeResult({ durationMs: n * 100 }))
    const r = computeLatencyPercentiles(results)
    expect(r.smallSampleWarning).toBe(false)
  })

  it('MET-01-E: p50 is the median', () => {
    const durations = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
    const results = durations.map((d) => makeResult({ durationMs: d }))
    const r = computeLatencyPercentiles(results)
    expect(r.p50).toBe(550) // interpolated median of [100..1000]
  })

  it('MET-01-F: p95 is higher than p50', () => {
    const durations = [100, 150, 160, 170, 180, 190, 200, 210, 300, 1000]
    const results = durations.map((d) => makeResult({ durationMs: d }))
    const r = computeLatencyPercentiles(results)
    expect(r.p95).toBeGreaterThan(r.p50)
  })

  it('MET-01-G: max is always the largest value', () => {
    const durations = [100, 200, 999, 50, 1500]
    const results = durations.map((d) => makeResult({ durationMs: d }))
    const r = computeLatencyPercentiles(results)
    expect(r.max).toBe(1500)
  })
})

describe('MET-02: aggregateByCategory', () => {
  it('MET-02-A: empty array returns empty summaries', () => {
    expect(aggregateByCategory([])).toHaveLength(0)
  })

  it('MET-02-B: single category aggregates correctly', () => {
    const results = [
      makeResult({ category: 'symptom', passed: true, durationMs: 100, tokensUsed: 50 }),
      makeResult({ category: 'symptom', passed: false, durationMs: 200, tokensUsed: 60 }),
    ]
    const summaries = aggregateByCategory(results)
    expect(summaries).toHaveLength(1)
    const symptom = summaries[0]!
    expect(symptom.category).toBe('symptom')
    expect(symptom.total).toBe(2)
    expect(symptom.passed).toBe(1)
    expect(symptom.failed).toBe(1)
    expect(symptom.passRate).toBe(0.5)
    expect(symptom.avgDurationMs).toBe(150)
    expect(symptom.totalTokens).toBe(110)
  })

  it('MET-02-C: multiple categories each get their own summary', () => {
    const results = [
      makeResult({ category: 'symptom', passed: true }),
      makeResult({ category: 'budget', passed: false }),
      makeResult({ category: 'safety', passed: true }),
    ]
    const summaries = aggregateByCategory(results)
    expect(summaries).toHaveLength(3)
  })

  it('MET-02-D: summaries are sorted alphabetically by category', () => {
    const results = [
      makeResult({ category: 'symptom' }),
      makeResult({ category: 'ambiguous' }),
      makeResult({ category: 'budget' }),
      makeResult({ category: 'safety' }),
    ]
    const summaries = aggregateByCategory(results)
    const categories = summaries.map((s) => s.category)
    expect(categories).toEqual([...categories].sort())
  })

  it('MET-02-E: passRate is 1.0 when all passed', () => {
    const results = [
      makeResult({ category: 'budget', passed: true }),
      makeResult({ category: 'budget', passed: true }),
    ]
    const summaries = aggregateByCategory(results)
    expect(summaries[0]!.passRate).toBe(1.0)
  })
})
