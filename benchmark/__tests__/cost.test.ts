import { describe, it, expect } from 'vitest'
import { estimateCost, getKnownModelIds, COST_DISCLAIMER } from '../runner/cost'

describe('COST-01: Mock adapter has zero cost', () => {
  it('COST-01-A: deterministic-mock-v1 costs $0', () => {
    const result = estimateCost(10_000, 'deterministic-mock-v1')
    expect(result.estimatedUsd).toBe(0)
    expect(result.unknownModel).toBe(false)
  })

  it('COST-01-B: stub-v1 costs $0', () => {
    const result = estimateCost(5_000, 'stub-v1')
    expect(result.estimatedUsd).toBe(0)
  })
})

describe('COST-02: Real model cost estimation', () => {
  it('COST-02-A: haiku cost is positive for 1000 tokens', () => {
    const result = estimateCost(1_000, 'claude-haiku-4-5-20251001')
    expect(result.estimatedUsd).toBeGreaterThan(0)
    expect(result.unknownModel).toBe(false)
  })

  it('COST-02-B: opus costs more than haiku per token', () => {
    const tokens = 10_000
    const haikuCost = estimateCost(tokens, 'claude-haiku-4-5-20251001').estimatedUsd!
    const opusCost = estimateCost(tokens, 'claude-opus-4-8').estimatedUsd!
    expect(opusCost).toBeGreaterThan(haikuCost)
  })

  it('COST-02-C: cost scales linearly with tokens', () => {
    const cost1k = estimateCost(1_000, 'claude-haiku-4-5-20251001').estimatedUsd!
    const cost10k = estimateCost(10_000, 'claude-haiku-4-5-20251001').estimatedUsd!
    expect(cost10k).toBeCloseTo(cost1k * 10, 6)
  })
})

describe('COST-03: Unknown model handling', () => {
  it('COST-03-A: unknown model returns null estimatedUsd', () => {
    const result = estimateCost(1_000, 'claude-unknown-9999')
    expect(result.estimatedUsd).toBeNull()
    expect(result.unknownModel).toBe(true)
  })

  it('COST-03-B: unknown model still returns totalTokens', () => {
    const result = estimateCost(5_000, 'claude-unknown-9999')
    expect(result.totalTokens).toBe(5_000)
  })
})

describe('COST-04: Budget limit guard', () => {
  it('COST-04-A: budgetExceeded=false when under limit', () => {
    const result = estimateCost(1_000, 'deterministic-mock-v1', 10_000)
    expect(result.budgetExceeded).toBe(false)
  })

  it('COST-04-B: budgetExceeded=true when over limit', () => {
    const result = estimateCost(15_000, 'deterministic-mock-v1', 10_000)
    expect(result.budgetExceeded).toBe(true)
  })

  it('COST-04-C: budgetExceeded=false when no limit set', () => {
    const result = estimateCost(1_000_000, 'deterministic-mock-v1')
    expect(result.budgetExceeded).toBe(false)
  })
})

describe('COST-05: Disclaimer', () => {
  it('COST-05-A: all estimates include pricing disclaimer', () => {
    const result = estimateCost(1_000, 'claude-haiku-4-5-20251001')
    expect(result.pricingDisclaimer).toBe(COST_DISCLAIMER)
    expect(result.pricingDisclaimer.length).toBeGreaterThan(20)
  })

  it('COST-05-B: COST_DISCLAIMER is a non-empty string', () => {
    expect(typeof COST_DISCLAIMER).toBe('string')
    expect(COST_DISCLAIMER.length).toBeGreaterThan(20)
  })
})

describe('COST-06: getKnownModelIds', () => {
  it('COST-06-A: includes deterministic-mock-v1', () => {
    expect(getKnownModelIds()).toContain('deterministic-mock-v1')
  })

  it('COST-06-B: includes claude-haiku-4-5-20251001', () => {
    expect(getKnownModelIds()).toContain('claude-haiku-4-5-20251001')
  })

  it('COST-06-C: includes gemini-2.5-flash', () => {
    expect(getKnownModelIds()).toContain('gemini-2.5-flash')
  })
})

describe('COST-07: Gemini free-tier pricing', () => {
  it('COST-07-A: gemini-2.5-flash costs $0 (free-tier placeholder)', () => {
    const result = estimateCost(10_000, 'gemini-2.5-flash')
    expect(result.estimatedUsd).toBe(0)
    expect(result.unknownModel).toBe(false)
  })

  it('COST-07-B: gemini-1.5-flash costs $0 (free-tier placeholder)', () => {
    const result = estimateCost(5_000, 'gemini-1.5-flash')
    expect(result.estimatedUsd).toBe(0)
  })

  it('COST-07-C: unknown Gemini model returns null (safe default)', () => {
    const result = estimateCost(1_000, 'gemini-ultra-99-unknown')
    expect(result.estimatedUsd).toBeNull()
    expect(result.unknownModel).toBe(true)
  })
})

describe('COST-07: Groq gpt-oss pricing (Incremento 6.3)', () => {
  it('COST-07-A: openai/gpt-oss-120b is a known, non-zero priced model', () => {
    const r = estimateCost(1_000_000, 'openai/gpt-oss-120b')
    expect(r.unknownModel).toBe(false)
    // 50/50 split at $0.15 in / $0.60 out per 1M → $0.375
    expect(r.estimatedUsd).toBeCloseTo(0.375, 6)
  })

  it('COST-07-B: openai/gpt-oss-20b is known', () => {
    expect(getKnownModelIds()).toContain('openai/gpt-oss-20b')
  })
})
