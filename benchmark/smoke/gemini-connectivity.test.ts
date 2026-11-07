/**
 * Tests for the Gemini connectivity test utilities.
 *
 * Tests the pure helper functions in gemini-connectivity-utils.ts
 * and the GeminiAdapter behavior with a mocked @google/genai SDK.
 * No real API calls are made and no credentials are required.
 *
 * CONN-01: isAuthorized — exact "true" string required
 * CONN-02: redactApiKey — API key never reconstructible from output
 * CONN-03: CONNECTIVITY_REQUEST — conservative token and timeout constants
 * CONN-04: formatConnectivityResult — ok=true paths
 * CONN-05: formatConnectivityResult — ok=false paths
 * CONN-06: GeminiAdapter with mocked SDK — exercises the full call path
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock @google/genai before importing GeminiAdapter.
// Same pattern as gemini-adapter.test.ts so the mock is consistent.
const { mockGenerate, MockApiError } = vi.hoisted(() => {
  const MockApiError = class extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
      this.name = 'ApiError'
    }
  }
  return { mockGenerate: vi.fn(), MockApiError }
})

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models = { generateContent: mockGenerate }
    constructor(_opts: unknown) {}
  },
  FinishReason: { STOP: 'STOP', SAFETY: 'SAFETY' },
  ApiError: MockApiError,
}))

import { GeminiAdapter } from '../../src/agents/llm/gemini-adapter'
import {
  isAuthorized,
  redactApiKey,
  CONNECTIVITY_REQUEST,
  formatConnectivityResult,
} from './gemini-connectivity-utils'

afterEach(() => {
  mockGenerate.mockReset()
})

// ── CONN-01: isAuthorized ──────────────────────────────────────────────────────

describe('CONN-01: isAuthorized', () => {
  it('CONN-01-A: GEMINI_CONNECTIVITY_AUTHORIZED=true → authorized', () => {
    expect(isAuthorized({ GEMINI_CONNECTIVITY_AUTHORIZED: 'true' })).toBe(true)
  })

  it('CONN-01-B: variable not set → not authorized', () => {
    expect(isAuthorized({})).toBe(false)
  })

  it('CONN-01-C: GEMINI_CONNECTIVITY_AUTHORIZED=false → not authorized', () => {
    expect(isAuthorized({ GEMINI_CONNECTIVITY_AUTHORIZED: 'false' })).toBe(false)
  })

  it('CONN-01-D: GEMINI_CONNECTIVITY_AUTHORIZED=1 → not authorized (must be exact string "true")', () => {
    expect(isAuthorized({ GEMINI_CONNECTIVITY_AUTHORIZED: '1' })).toBe(false)
  })
})

// ── CONN-02: redactApiKey ──────────────────────────────────────────────────────

describe('CONN-02: redactApiKey', () => {
  it('CONN-02-A: shows only last 4 chars of a full API key', () => {
    expect(redactApiKey('AIzaSyAbCdEfGhIjKlMn1234')).toBe('...1234')
  })

  it('CONN-02-B: key shorter than or equal to 4 chars → fully redacted', () => {
    expect(redactApiKey('ABCD')).toBe('****')
    expect(redactApiKey('XY')).toBe('****')
  })

  it('CONN-02-C: empty key → "(not set)"', () => {
    expect(redactApiKey('')).toBe('(not set)')
  })

  it('CONN-02-D: does not reveal more than last 4 chars of a 32-char key', () => {
    const key = 'A'.repeat(32)
    const result = redactApiKey(key)
    expect(result).not.toContain('A'.repeat(5))
    expect(result.endsWith('AAAA')).toBe(true)
  })
})

// ── CONN-03: CONNECTIVITY_REQUEST constants ────────────────────────────────────

describe('CONN-03: CONNECTIVITY_REQUEST', () => {
  it('CONN-03-A: maxTokens is defined and ≤ 64 (conservative limit)', () => {
    expect(CONNECTIVITY_REQUEST.maxTokens).toBeDefined()
    expect(CONNECTIVITY_REQUEST.maxTokens!).toBeLessThanOrEqual(64)
  })

  it('CONN-03-B: timeoutMs is defined and ≥ 10 000ms (enough for a real call)', () => {
    expect(CONNECTIVITY_REQUEST.timeoutMs).toBeDefined()
    expect(CONNECTIVITY_REQUEST.timeoutMs!).toBeGreaterThanOrEqual(10_000)
  })

  it('CONN-03-C: system and userContent are non-empty synthetic strings', () => {
    expect(CONNECTIVITY_REQUEST.system.length).toBeGreaterThan(0)
    expect(CONNECTIVITY_REQUEST.userContent.length).toBeGreaterThan(0)
  })

  it('CONN-03-D: no model override — adapter default is used', () => {
    expect(CONNECTIVITY_REQUEST.model).toBeUndefined()
  })
})

// ── CONN-04: formatConnectivityResult — ok = true ─────────────────────────────

describe('CONN-04: formatConnectivityResult — success path', () => {
  const baseResult = { ok: true as const, content: 'OK' }

  it('CONN-04-A: contains STATUS OK on first line', () => {
    const lines = formatConnectivityResult({ model: 'gemini-3.5-flash-lite', latencyMs: 500, result: baseResult })
    expect(lines[0]).toContain('OK')
    expect(lines[0]).toContain('STATUS')
  })

  it('CONN-04-B: contains model identifier', () => {
    const lines = formatConnectivityResult({ model: 'gemini-3.5-flash-lite', latencyMs: 500, result: baseResult })
    expect(lines.some((l) => l.includes('gemini-3.5-flash-lite'))).toBe(true)
  })

  it('CONN-04-C: contains latency in ms', () => {
    const lines = formatConnectivityResult({ model: 'gemini-3.5-flash-lite', latencyMs: 742, result: baseResult })
    expect(lines.some((l) => l.includes('742'))).toBe(true)
  })

  it('CONN-04-D: Tokens line present when tokensUsed is defined', () => {
    const result = { ...baseResult, tokensUsed: 18 }
    const lines = formatConnectivityResult({ model: 'gemini-3.5-flash-lite', latencyMs: 100, result })
    expect(lines.some((l) => l.includes('18'))).toBe(true)
  })
})

// ── CONN-05: formatConnectivityResult — ok = false ────────────────────────────

describe('CONN-05: formatConnectivityResult — failure path', () => {
  const failResult = {
    ok: false as const,
    error: { code: 'LLM_MODEL_UNAVAILABLE' as const, message: 'HTTP 404' },
  }

  it('CONN-05-A: contains STATUS FAILED on first line', () => {
    const lines = formatConnectivityResult({ model: 'gemini-3.5-flash-lite', latencyMs: 300, result: failResult })
    expect(lines[0]).toContain('FAILED')
  })

  it('CONN-05-B: contains the error code', () => {
    const lines = formatConnectivityResult({ model: 'gemini-3.5-flash-lite', latencyMs: 300, result: failResult })
    expect(lines.some((l) => l.includes('LLM_MODEL_UNAVAILABLE'))).toBe(true)
  })

  it('CONN-05-C: contains the error message detail', () => {
    const lines = formatConnectivityResult({ model: 'gemini-3.5-flash-lite', latencyMs: 300, result: failResult })
    expect(lines.some((l) => l.includes('HTTP 404'))).toBe(true)
  })

  it('CONN-05-D: contains latency even on failure', () => {
    const lines = formatConnectivityResult({ model: 'gemini-3.5-flash-lite', latencyMs: 1250, result: failResult })
    expect(lines.some((l) => l.includes('1250'))).toBe(true)
  })
})

// ── CONN-06: GeminiAdapter integration with mocked SDK ────────────────────────

describe('CONN-06: GeminiAdapter integration with mocked @google/genai SDK', () => {
  function successResponse(text: string, promptTokens = 5, candidateTokens = 3) {
    return {
      text,
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: candidateTokens },
    }
  }

  it('CONN-06-A: successful call returns ok:true with content and tokens', async () => {
    mockGenerate.mockResolvedValue(successResponse('OK', 5, 1))
    const adapter = new GeminiAdapter('test-key', 'gemini-3.5-flash-lite', {
      freeTier: { maxRequestsPerRun: 1, maxOutputTokens: 32 },
    })
    const result = await adapter.complete(CONNECTIVITY_REQUEST)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe('OK')
      expect(result.tokensUsed).toBe(6)
    }
  })

  it('CONN-06-B: HTTP 404 from SDK → LLM_MODEL_UNAVAILABLE', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(404, 'model not found'))
    const adapter = new GeminiAdapter('test-key', 'gemini-3.5-flash-lite')
    const result = await adapter.complete(CONNECTIVITY_REQUEST)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LLM_MODEL_UNAVAILABLE')
  })

  it('CONN-06-C: HTTP 429 from SDK → LLM_QUOTA_EXCEEDED', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(429, 'rate limit exceeded'))
    const adapter = new GeminiAdapter('test-key', 'gemini-3.5-flash-lite')
    const result = await adapter.complete(CONNECTIVITY_REQUEST)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LLM_QUOTA_EXCEEDED')
  })

  it('CONN-06-D: maxRequestsPerRun=1 — second call blocked locally without network request', async () => {
    mockGenerate.mockResolvedValue(successResponse('OK'))
    const adapter = new GeminiAdapter('test-key', 'gemini-3.5-flash-lite', {
      freeTier: { maxRequestsPerRun: 1, maxOutputTokens: 32 },
    })
    // First call succeeds (consumes the 1-request quota)
    const first = await adapter.complete(CONNECTIVITY_REQUEST)
    expect(first.ok).toBe(true)
    // Second call is blocked by the local free-tier guard — no SDK call is made
    const second = await adapter.complete(CONNECTIVITY_REQUEST)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.code).toBe('LLM_QUOTA_EXCEEDED')
    // mockGenerate was called only once — the second call never reached the network
    expect(mockGenerate).toHaveBeenCalledTimes(1)
  })
})
