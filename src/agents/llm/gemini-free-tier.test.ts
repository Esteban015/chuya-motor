import { describe, it, expect } from 'vitest'
import {
  GEMINI_FREE_TIER_MODELS,
  GEMINI_FREE_TIER_MODEL_SET,
  DEFAULT_FREE_TIER_LIMITS,
  FREE_TIER_PRIVACY_NOTICE,
  assertModelInFreeTierAllowlist,
} from './gemini-free-tier'

describe('FREE-01: Free-tier model allowlist', () => {
  it('FREE-01-A: gemini-3.5-flash-lite is in allowlist (primary — HTTP 200 on generateContent confirmed)', () => {
    expect(GEMINI_FREE_TIER_MODEL_SET.has('gemini-3.5-flash-lite')).toBe(true)
  })

  it('FREE-01-B: gemini-2.5-flash is in allowlist (secondary — may work for established projects)', () => {
    expect(GEMINI_FREE_TIER_MODEL_SET.has('gemini-2.5-flash')).toBe(true)
  })

  it('FREE-01-C: allowlist is non-empty', () => {
    expect(GEMINI_FREE_TIER_MODELS.length).toBeGreaterThan(0)
  })

  it('FREE-01-D: GEMINI_FREE_TIER_MODEL_SET matches GEMINI_FREE_TIER_MODELS', () => {
    for (const model of GEMINI_FREE_TIER_MODELS) {
      expect(GEMINI_FREE_TIER_MODEL_SET.has(model)).toBe(true)
    }
    expect(GEMINI_FREE_TIER_MODEL_SET.size).toBe(GEMINI_FREE_TIER_MODELS.length)
  })

  it('FREE-01-E: rejected models are not in allowlist (HTTP 404 on generateContent for new AI Studio projects)', () => {
    // Removed: not accessible for new AI Studio projects via generateContent.
    expect(GEMINI_FREE_TIER_MODEL_SET.has('gemini-1.5-flash')).toBe(false)
    expect(GEMINI_FREE_TIER_MODEL_SET.has('gemini-1.5-flash-8b')).toBe(false)
    expect(GEMINI_FREE_TIER_MODEL_SET.has('gemini-2.0-flash')).toBe(false)
    expect(GEMINI_FREE_TIER_MODEL_SET.has('gemini-2.5-flash-preview-04-17')).toBe(false)
    // Removed: HTTP 404 on generateContent confirmed (appeared in models.list() but not for generation).
    expect(GEMINI_FREE_TIER_MODEL_SET.has('gemini-2.5-flash-lite')).toBe(false)
  })
})

describe('FREE-02: assertModelInFreeTierAllowlist', () => {
  it('FREE-02-A: allowlisted model does not throw', () => {
    expect(() => assertModelInFreeTierAllowlist('gemini-2.5-flash')).not.toThrow()
  })

  it('FREE-02-B: non-allowlisted model throws with model name in message', () => {
    expect(() => assertModelInFreeTierAllowlist('gemini-ultra-99')).toThrow(/gemini-ultra-99/)
  })

  it('FREE-02-C: error message mentions allowlist', () => {
    expect(() => assertModelInFreeTierAllowlist('some-paid-model')).toThrow(/allowlist/)
  })

  it('FREE-02-D: error message mentions verification URL', () => {
    expect(() => assertModelInFreeTierAllowlist('some-paid-model')).toThrow(/ai\.google\.dev/)
  })
})

describe('FREE-03: Default free-tier limits', () => {
  it('FREE-03-A: maxRequestsPerRun is 10', () => {
    expect(DEFAULT_FREE_TIER_LIMITS.maxRequestsPerRun).toBe(10)
  })

  it('FREE-03-B: maxOutputTokens is 1024 (increased from 512 to handle diagnosis responses with 5 hypotheses + caveats)', () => {
    expect(DEFAULT_FREE_TIER_LIMITS.maxOutputTokens).toBe(1024)
  })
})

describe('FREE-04: Privacy notice', () => {
  it('FREE-04-A: privacy notice is a non-empty string', () => {
    expect(typeof FREE_TIER_PRIVACY_NOTICE).toBe('string')
    expect(FREE_TIER_PRIVACY_NOTICE.length).toBeGreaterThan(20)
  })

  it('FREE-04-B: privacy notice mentions synthetic data', () => {
    expect(FREE_TIER_PRIVACY_NOTICE.toLowerCase()).toContain('synthetic')
  })
})
