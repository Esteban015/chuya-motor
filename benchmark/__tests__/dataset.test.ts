import { describe, it, expect } from 'vitest'
import { BenchmarkScenarioSchema, DATASET_VERSION } from '../dataset/types'
import { scenarios, TOTAL_SCENARIOS, getScenariosByCategory, getScenarioById } from '../dataset/scenarios'

describe('Dataset — schema validation', () => {
  it('DS-01: all scenarios pass BenchmarkScenarioSchema', () => {
    for (const scenario of scenarios) {
      const result = BenchmarkScenarioSchema.safeParse(scenario)
      expect(result.success, `${scenario.id}: ${!result.success ? JSON.stringify(result.error.issues) : ''}`).toBe(true)
    }
  })

  it('DS-02: TOTAL_SCENARIOS matches actual array length', () => {
    expect(TOTAL_SCENARIOS).toBe(scenarios.length)
  })

  it('DS-03: all IDs are unique', () => {
    const ids = scenarios.map((s) => s.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('DS-04: all IDs match regex pattern [A-Z]+-\\d{3}', () => {
    for (const scenario of scenarios) {
      expect(scenario.id).toMatch(/^[A-Z]+-\d{3}$/)
    }
  })

  it('DS-05: all scenarios reference DATASET_VERSION', () => {
    for (const scenario of scenarios) {
      expect(scenario.version).toBe(DATASET_VERSION)
    }
  })
})

describe('Dataset — distribution', () => {
  it('DS-06: at least 8 symptom scenarios', () => {
    const symptom = getScenariosByCategory('symptom')
    expect(symptom.length).toBeGreaterThanOrEqual(8)
  })

  it('DS-07: at least 6 budget scenarios', () => {
    const budget = getScenariosByCategory('budget')
    expect(budget.length).toBeGreaterThanOrEqual(6)
  })

  it('DS-08: at least 5 safety scenarios', () => {
    const safety = getScenariosByCategory('safety')
    expect(safety.length).toBeGreaterThanOrEqual(5)
  })

  it('DS-09: at least 4 ambiguous scenarios', () => {
    const ambiguous = getScenariosByCategory('ambiguous')
    expect(ambiguous.length).toBeGreaterThanOrEqual(4)
  })

  it('DS-10: total scenarios is 30', () => {
    expect(scenarios.length).toBe(30)
  })
})

describe('Dataset — safety scenarios', () => {
  it('DS-11: all safety scenarios have expectsSafetyBlock=true (except injection)', () => {
    const safetyScenarios = getScenariosByCategory('safety')
    const safetyBlockRequired = safetyScenarios.filter(
      (s) => !s.tags.includes('prompt-injection'),
    )
    for (const s of safetyBlockRequired) {
      expect(s.security.expectsSafetyBlock, `${s.id} should block`).toBe(true)
      expect(s.expected.safetyBlocked, `${s.id} expected.safetyBlocked`).toBe(true)
    }
  })

  it('DS-12: injection scenario SAF-006 does NOT expect safetyBlocked', () => {
    const injection = getScenarioById('SAF-006')
    expect(injection).toBeDefined()
    expect(injection?.security.expectsSafetyBlock).toBe(false)
    expect(injection?.expected.safetyBlocked).toBe(false)
  })
})

describe('Dataset — budget scenarios', () => {
  it('DS-13: all budget scenarios have route=budget', () => {
    const budget = getScenariosByCategory('budget')
    for (const s of budget) {
      expect(s.expected.route, `${s.id} should have route=budget`).toBe('budget')
    }
  })

  it('DS-14: BUD-001 is COMPLETE with no discrepancy', () => {
    const s = getScenarioById('BUD-001')
    expect(s?.expected.budgetCompleteness).toBe('COMPLETE')
    expect(s?.expected.discrepancy).toBe(false)
  })

  it('DS-15: BUD-002 is COMPLETE with discrepancy', () => {
    const s = getScenarioById('BUD-002')
    expect(s?.expected.budgetCompleteness).toBe('COMPLETE')
    expect(s?.expected.discrepancy).toBe(true)
  })
})

describe('Dataset — utility functions', () => {
  it('DS-16: getScenarioById returns correct scenario', () => {
    const s = getScenarioById('SYM-001')
    expect(s).toBeDefined()
    expect(s?.id).toBe('SYM-001')
  })

  it('DS-17: getScenarioById returns undefined for unknown ID', () => {
    expect(getScenarioById('UNKNOWN-999')).toBeUndefined()
  })

  it('DS-18: getScenariosByCategory returns only matching scenarios', () => {
    const symptom = getScenariosByCategory('symptom')
    expect(symptom.every((s) => s.category === 'symptom')).toBe(true)
  })
})
