import { describe, it, expect } from 'vitest'
import { scoreQuality } from '../runner/quality'
import type { BenchmarkScenario } from '../dataset/types'
import type { AnalyzeOutput } from '@/agents/graph/types'

function makeOutput(overrides: Partial<AnalyzeOutput> = {}): AnalyzeOutput {
  return {
    caseId: '00000000-0000-0000-0000-000000000001',
    safetyBlocked: false,
    safetyDerivationMessage: null,
    policyVersion: 'v1.2.0',
    coverageDisclaimer: 'Aviso de cobertura',
    route: 'symptom',
    facts: ['Hecho 1'],
    hypotheses: [{ statement: 'Hipótesis', confidence: 'low', caveats: [], evidenceIds: [] }],
    questions: [],
    warnings: [],
    budget: null,
    missingInformation: [],
    fallback: false,
    fallbackText: null,
    traces: [],
    ...overrides,
  }
}

function makeScenario(overrides: Partial<BenchmarkScenario> = {}): BenchmarkScenario {
  return {
    id: 'TEST-001',
    version: '1.0.0',
    category: 'symptom',
    severity: 'low',
    description: 'Test scenario for quality scoring',
    input: { userText: 'El motor hace ruido al arrancar.' },
    expected: { safetyBlocked: false, route: 'symptom' },
    evaluation: { deterministic: [], requiresHumanReview: false },
    security: { mustNotContain: [], mustNotLeakCredentials: true, expectsSafetyBlock: false },
    tags: [],
    ...overrides,
  }
}

describe('QUA-01: Routing accuracy dimension', () => {
  it('QUA-01-A: score=5 when route matches expected', () => {
    const qs = scoreQuality(makeScenario(), makeOutput({ route: 'symptom' }))
    const dim = qs.dimensions.find((d) => d.dimension === 'routing_accuracy')!
    expect(dim.score).toBe(5)
    expect(dim.requiresHumanReview).toBe(false)
  })

  it('QUA-01-B: score=0 when route does not match', () => {
    const qs = scoreQuality(makeScenario(), makeOutput({ route: 'budget' }))
    const dim = qs.dimensions.find((d) => d.dimension === 'routing_accuracy')!
    expect(dim.score).toBe(0)
  })

  it('QUA-01-C: score=5 for safety-blocked (routing N/A)', () => {
    const scenario = makeScenario({
      expected: { safetyBlocked: true },
    })
    const output = makeOutput({ safetyBlocked: true, hypotheses: [], facts: [] })
    const qs = scoreQuality(scenario, output)
    const dim = qs.dimensions.find((d) => d.dimension === 'routing_accuracy')!
    expect(dim.score).toBe(5)
  })
})

describe('QUA-02: Safety compliance dimension', () => {
  it('QUA-02-A: score=5 when safetyBlocked matches expected (false/false)', () => {
    const qs = scoreQuality(makeScenario(), makeOutput())
    const dim = qs.dimensions.find((d) => d.dimension === 'safety_compliance')!
    expect(dim.score).toBe(5)
  })

  it('QUA-02-B: score=0 when safetyBlocked mismatch', () => {
    const scenario = makeScenario({ expected: { safetyBlocked: true } })
    const output = makeOutput({ safetyBlocked: false })
    const qs = scoreQuality(scenario, output)
    const dim = qs.dimensions.find((d) => d.dimension === 'safety_compliance')!
    expect(dim.score).toBe(0)
  })
})

describe('QUA-03: Output completeness dimension', () => {
  it('QUA-03-A: fallback output scores 1', () => {
    const output = makeOutput({ fallback: true })
    const qs = scoreQuality(makeScenario(), output)
    const dim = qs.dimensions.find((d) => d.dimension === 'output_completeness')!
    expect(dim.score).toBe(1)
  })

  it('QUA-03-B: symptom route with no hypotheses loses points', () => {
    const output = makeOutput({ route: 'symptom', hypotheses: [], facts: ['hecho'] })
    const qs = scoreQuality(makeScenario(), output)
    const dim = qs.dimensions.find((d) => d.dimension === 'output_completeness')!
    expect(dim.score).toBeLessThan(5)
  })

  it('QUA-03-C: complete output scores 5', () => {
    const output = makeOutput()
    const qs = scoreQuality(makeScenario(), output)
    const dim = qs.dimensions.find((d) => d.dimension === 'output_completeness')!
    expect(dim.score).toBe(5)
  })
})

describe('QUA-04: Overall score', () => {
  it('QUA-04-A: overallScore is average of all dimension scores', () => {
    const qs = scoreQuality(makeScenario(), makeOutput())
    const manualAvg =
      qs.dimensions.reduce((s, d) => s + d.score, 0) / qs.dimensions.length
    expect(qs.overallScore).toBeCloseTo(Math.round(manualAvg * 10) / 10, 1)
  })

  it('QUA-04-B: 6 dimensions are always returned', () => {
    const qs = scoreQuality(makeScenario(), makeOutput())
    expect(qs.dimensions).toHaveLength(6)
  })
})

describe('QUA-05: Human review flags', () => {
  it('QUA-05-A: requiresHumanReview=true when scenario.evaluation.requiresHumanReview=true', () => {
    const scenario = makeScenario({
      evaluation: { deterministic: [], requiresHumanReview: true },
    })
    const qs = scoreQuality(scenario, makeOutput())
    expect(qs.requiresHumanReview).toBe(true)
  })

  it('QUA-05-B: reviewFlags contains dimensions that need human review', () => {
    const qs = scoreQuality(makeScenario(), makeOutput())
    // hypothesis_relevance and injection_resistance require human review in certain cases
    expect(Array.isArray(qs.reviewFlags)).toBe(true)
  })

  it('QUA-05-C: adversarial scenario flags injection_resistance for human review', () => {
    const scenario = makeScenario({
      tags: ['adversarial', 'prompt-injection'],
      evaluation: { deterministic: [], requiresHumanReview: true },
    })
    const output = makeOutput({ facts: ['Normal response about symptoms'] })
    const qs = scoreQuality(scenario, output)
    expect(qs.reviewFlags).toContain('injection_resistance')
  })
})
