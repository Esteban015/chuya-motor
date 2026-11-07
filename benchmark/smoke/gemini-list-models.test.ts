/**
 * Tests for gemini-list-models diagnostic utilities.
 *
 * Tests the pure helper functions exported by the diagnostic script:
 *   - classifyApiError: maps HTTP status codes to safe diagnostic codes
 *   - getShortModelId: extracts short identifier from resource name
 *   - supportsGenerateContent: filters models by action capability
 *
 * These tests use no real API calls and no credentials.
 */
import { describe, it, expect } from 'vitest'
import { ApiError } from '@google/genai'
import { classifyApiError, getShortModelId, supportsGenerateContent } from './gemini-list-models-utils'

// Minimal ApiError stub — uses the real constructor signature (ApiErrorInfo).
function makeApiError(status: number, message = 'test error'): ApiError {
  return new ApiError({ status, message })
}

describe('DIAG-01: classifyApiError — HTTP status to diagnostic code mapping', () => {
  it('DIAG-01-A: HTTP 401 → LLM_AUTH_ERROR', () => {
    const result = classifyApiError(makeApiError(401))
    expect(result.code).toBe('LLM_AUTH_ERROR')
    expect(result.httpStatus).toBe(401)
    expect(result.explanation).toBeTruthy()
  })

  it('DIAG-01-B: HTTP 403 → LLM_AUTH_ERROR', () => {
    const result = classifyApiError(makeApiError(403))
    expect(result.code).toBe('LLM_AUTH_ERROR')
    expect(result.httpStatus).toBe(403)
  })

  it('DIAG-01-C: HTTP 429 → LLM_QUOTA_EXCEEDED', () => {
    const result = classifyApiError(makeApiError(429))
    expect(result.code).toBe('LLM_QUOTA_EXCEEDED')
    expect(result.httpStatus).toBe(429)
  })

  it('DIAG-01-D: HTTP 404 → LLM_MODEL_UNAVAILABLE', () => {
    const result = classifyApiError(makeApiError(404))
    expect(result.code).toBe('LLM_MODEL_UNAVAILABLE')
    expect(result.httpStatus).toBe(404)
  })

  it('DIAG-01-E: HTTP 500 → LLM_PROVIDER_UNAVAILABLE', () => {
    const result = classifyApiError(makeApiError(500))
    expect(result.code).toBe('LLM_PROVIDER_UNAVAILABLE')
    expect(result.httpStatus).toBe(500)
  })

  it('DIAG-01-F: HTTP 503 → LLM_PROVIDER_UNAVAILABLE', () => {
    const result = classifyApiError(makeApiError(503))
    expect(result.code).toBe('LLM_PROVIDER_UNAVAILABLE')
    expect(result.httpStatus).toBe(503)
  })

  it('DIAG-01-G: HTTP 400 (unknown) → LLM_PROVIDER_UNAVAILABLE', () => {
    const result = classifyApiError(makeApiError(400))
    expect(result.code).toBe('LLM_PROVIDER_UNAVAILABLE')
    expect(result.httpStatus).toBe(400)
  })

  it('DIAG-01-H: explanation is non-empty for all mapped codes', () => {
    const statuses = [401, 403, 429, 404, 500, 503, 400]
    for (const status of statuses) {
      const result = classifyApiError(makeApiError(status))
      expect(result.explanation.length).toBeGreaterThan(10)
    }
  })

  it('DIAG-01-I: explanation contains no credential patterns', () => {
    const statuses = [401, 403, 429, 404, 500, 400]
    for (const status of statuses) {
      const result = classifyApiError(makeApiError(status, 'API key: AIzaSy-secret123'))
      // The explanation should not echo back the error message (which may contain credentials).
      // classifyApiError uses fixed strings — the message param is NOT included in explanation.
      expect(result.explanation).not.toContain('AIzaSy')
      expect(result.explanation).not.toContain('secret')
    }
  })
})

describe('DIAG-02: getShortModelId — resource name extraction', () => {
  it('DIAG-02-A: strips "models/" prefix', () => {
    expect(getShortModelId('models/gemini-2.5-flash')).toBe('gemini-2.5-flash')
  })

  it('DIAG-02-B: returns name unchanged when no "models/" prefix', () => {
    expect(getShortModelId('gemini-2.0-flash')).toBe('gemini-2.0-flash')
  })

  it('DIAG-02-C: returns empty string for undefined', () => {
    expect(getShortModelId(undefined)).toBe('')
  })

  it('DIAG-02-D: returns empty string for empty string', () => {
    expect(getShortModelId('')).toBe('')
  })

  it('DIAG-02-E: handles tuned model paths without stripping extra segments', () => {
    // Tuned models have longer paths — only strip the "models/" prefix.
    expect(getShortModelId('models/gemini-1.5-flash-001')).toBe('gemini-1.5-flash-001')
  })
})

describe('DIAG-03: supportsGenerateContent — action filter', () => {
  it('DIAG-03-A: returns true when "generateContent" is in actions', () => {
    expect(supportsGenerateContent(['generateContent', 'countTokens'])).toBe(true)
  })

  it('DIAG-03-B: returns true for case-insensitive match (generatecontent)', () => {
    expect(supportsGenerateContent(['GENERATECONTENT'])).toBe(true)
  })

  it('DIAG-03-C: returns true when action contains "generate" substring', () => {
    expect(supportsGenerateContent(['generateImages'])).toBe(true)
  })

  it('DIAG-03-D: returns false when no generate* action present', () => {
    expect(supportsGenerateContent(['countTokens', 'embedContent'])).toBe(false)
  })

  it('DIAG-03-E: returns false for empty array', () => {
    expect(supportsGenerateContent([])).toBe(false)
  })

  it('DIAG-03-F: returns false for undefined', () => {
    expect(supportsGenerateContent(undefined)).toBe(false)
  })
})
