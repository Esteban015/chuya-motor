import { describe, it, expect, vi, afterEach } from 'vitest'

// MUST be before vi.mock — hoisted mock fn + ApiError class shared across describe blocks.
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
  FinishReason: {
    FINISH_REASON_UNSPECIFIED: 'FINISH_REASON_UNSPECIFIED',
    STOP: 'STOP',
    MAX_TOKENS: 'MAX_TOKENS',
    SAFETY: 'SAFETY',
    RECITATION: 'RECITATION',
    OTHER: 'OTHER',
  },
  ApiError: MockApiError,
}))

import { GeminiAdapter, GEMINI_DEFAULT_MODEL } from './gemini-adapter'
import { DEFAULT_FREE_TIER_LIMITS } from './gemini-free-tier'

function successResponse(text: string, promptTokens = 10, candidateTokens = 20) {
  return {
    text,
    candidates: [{ finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: promptTokens, candidatesTokenCount: candidateTokens },
  }
}

afterEach(() => {
  mockGenerate.mockReset()
  vi.useRealTimers()
})

// ── GEMI-01: Completion exitosa ──────────────────────────────────────────────

describe('GEMI-01: Successful completion', () => {
  it('GEMI-01-A: returns ok:true with content', async () => {
    mockGenerate.mockResolvedValue(successResponse('{"result":"ok"}'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 'sys', userContent: 'user' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.content).toBe('{"result":"ok"}')
  })

  it('GEMI-01-B: returns tokensUsed = promptTokenCount + candidatesTokenCount', async () => {
    mockGenerate.mockResolvedValue(successResponse('hello', 15, 25))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 'sys', userContent: 'user' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tokensUsed).toBe(40)
  })

  it('GEMI-01-C: tokensUsed is undefined when usageMetadata absent', async () => {
    mockGenerate.mockResolvedValue({ text: 'hello', candidates: [{ finishReason: 'STOP' }], usageMetadata: null })
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 'sys', userContent: 'user' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tokensUsed).toBeUndefined()
  })
})

// ── GEMI-02: Separación system/userContent ───────────────────────────────────

describe('GEMI-02: system/userContent separation', () => {
  it('GEMI-02-A: system goes to config.systemInstruction, userContent to contents', async () => {
    mockGenerate.mockResolvedValue(successResponse('ok'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    await adapter.complete({ system: 'SYSTEM_INSTRUCTIONS', userContent: 'USER_CONTENT' })

    const callArg = mockGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    const config = callArg['config'] as Record<string, unknown>
    expect(config['systemInstruction']).toBe('SYSTEM_INSTRUCTIONS')
    expect(callArg['contents']).toBe('USER_CONTENT')
  })

  it('GEMI-02-B: systemInstruction does not contain userContent', async () => {
    mockGenerate.mockResolvedValue(successResponse('ok'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    await adapter.complete({ system: 'SAFE_SYSTEM', userContent: 'INJECTED_USER_DATA' })

    const callArg = mockGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    const config = callArg['config'] as Record<string, unknown>
    expect(String(config['systemInstruction'])).not.toContain('INJECTED_USER_DATA')
  })

  it('GEMI-02-C: contents does not contain system instructions', async () => {
    mockGenerate.mockResolvedValue(successResponse('ok'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    await adapter.complete({ system: 'SECRET_SYSTEM_PROMPT', userContent: 'user text' })

    const callArg = mockGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(String(callArg['contents'])).not.toContain('SECRET_SYSTEM_PROMPT')
  })
})

// ── GEMI-03: modelId ─────────────────────────────────────────────────────────

describe('GEMI-03: modelId', () => {
  it('GEMI-03-A: default modelId is GEMINI_DEFAULT_MODEL', () => {
    const adapter = new GeminiAdapter('key')
    expect(adapter.modelId).toBe(GEMINI_DEFAULT_MODEL)
  })

  it('GEMI-03-B: custom model passed to constructor is reflected in modelId', () => {
    const adapter = new GeminiAdapter('key', 'gemini-2.5-flash')
    expect(adapter.modelId).toBe('gemini-2.5-flash')
  })

  it('GEMI-03-C: req.model override is used in API call, not in modelId', async () => {
    mockGenerate.mockResolvedValue(successResponse('ok'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    await adapter.complete({ system: 's', userContent: 'u', model: 'gemini-2.5-flash' })

    const callArg = mockGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    expect(callArg['model']).toBe('gemini-2.5-flash')
    expect(adapter.modelId).toBe(GEMINI_DEFAULT_MODEL) // unchanged by req.model
  })

  it('GEMI-03-D: GEMINI_DEFAULT_MODEL is gemini-3.5-flash-lite (confirmed HTTP 200 for new AI Studio projects)', () => {
    expect(GEMINI_DEFAULT_MODEL).toBe('gemini-3.5-flash-lite')
  })
})

// ── GEMI-04: Respuesta vacía → LLM_SCHEMA_VIOLATION ─────────────────────────

describe('GEMI-04: Empty response', () => {
  it('GEMI-04-A: undefined text → LLM_EMPTY_RESPONSE', async () => {
    mockGenerate.mockResolvedValue({ text: undefined, candidates: [{ finishReason: 'STOP' }], usageMetadata: null })
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LLM_EMPTY_RESPONSE')
  })

  it('GEMI-04-B: whitespace-only text → LLM_EMPTY_RESPONSE', async () => {
    mockGenerate.mockResolvedValue({ text: '   ', candidates: [{ finishReason: 'STOP' }], usageMetadata: null })
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LLM_EMPTY_RESPONSE')
  })
})

// ── GEMI-05: Safety block ────────────────────────────────────────────────────

describe('GEMI-05: Safety block', () => {
  it('GEMI-05-A: finishReason=SAFETY → LLM_SCHEMA_VIOLATION', async () => {
    mockGenerate.mockResolvedValue({
      text: undefined,
      candidates: [{ finishReason: 'SAFETY' }],
      usageMetadata: null,
    })
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_SCHEMA_VIOLATION')
      expect(result.error.message).toContain('safety')
    }
  })
})

// ── GEMI-06: Timeout ─────────────────────────────────────────────────────────

describe('GEMI-06: Timeout', () => {
  it('GEMI-06-A: local Promise.race timeout → LLM_TIMEOUT', async () => {
    vi.useFakeTimers()
    mockGenerate.mockReturnValue(new Promise(() => {})) // never resolves

    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const resultPromise = adapter.complete({ system: 's', userContent: 'u', timeoutMs: 1000 })

    await vi.runAllTimersAsync()
    const result = await resultPromise

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LLM_TIMEOUT')
  })

  it('GEMI-06-B: HTTP 408 → LLM_TIMEOUT', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(408, 'Request timeout'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LLM_TIMEOUT')
  })
})

// ── GEMI-07: HTTP 401/403 — Auth errors ──────────────────────────────────────

describe('GEMI-07: Auth errors', () => {
  it('GEMI-07-A: HTTP 401 → LLM_AUTH_ERROR', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(401, 'API key not valid'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_AUTH_ERROR')
      expect(result.error.message).toContain('401')
    }
  })

  it('GEMI-07-B: HTTP 403 → LLM_AUTH_ERROR', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(403, 'Permission denied'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_AUTH_ERROR')
      expect(result.error.message).toContain('403')
    }
  })
})

// ── GEMI-08: HTTP 429 — Quota / rate limit ───────────────────────────────────

describe('GEMI-08: Quota / rate limit', () => {
  it('GEMI-08-A: HTTP 429 → LLM_QUOTA_EXCEEDED (no auto-retry to paid provider)', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(429, 'Resource exhausted'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_QUOTA_EXCEEDED')
      expect(result.error.message).toContain('429')
    }
  })
})

// ── GEMI-09: HTTP 500/503 — Service errors ───────────────────────────────────

describe('GEMI-09: Service errors', () => {
  it('GEMI-09-A: HTTP 500 → LLM_PROVIDER_UNAVAILABLE', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(500, 'Internal server error'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LLM_PROVIDER_UNAVAILABLE')
  })

  it('GEMI-09-B: HTTP 503 → LLM_PROVIDER_UNAVAILABLE', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(503, 'Service unavailable'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LLM_PROVIDER_UNAVAILABLE')
  })

  it('GEMI-09-C: unexpected error → LLM_PROVIDER_UNAVAILABLE', async () => {
    mockGenerate.mockRejectedValue(new Error('Network failure'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('LLM_PROVIDER_UNAVAILABLE')
  })
})

// ── GEMI-10: Free-tier request limit ─────────────────────────────────────────

describe('GEMI-10: Free-tier request limit', () => {
  it('GEMI-10-A: requests within limit succeed', async () => {
    mockGenerate.mockResolvedValue(successResponse('ok'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL, {
      freeTier: { maxRequestsPerRun: 3, maxOutputTokens: 512 },
    })
    for (let i = 0; i < 3; i++) {
      const result = await adapter.complete({ system: 's', userContent: 'u' })
      expect(result.ok).toBe(true)
    }
  })

  it('GEMI-10-B: request exceeding limit returns LLM_QUOTA_EXCEEDED without calling API', async () => {
    mockGenerate.mockResolvedValue(successResponse('ok'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL, {
      freeTier: { maxRequestsPerRun: 2, maxOutputTokens: 512 },
    })
    await adapter.complete({ system: 's', userContent: 'u' })
    await adapter.complete({ system: 's', userContent: 'u' })

    const result = await adapter.complete({ system: 's', userContent: 'u' }) // 3rd — over limit
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_QUOTA_EXCEEDED')
      expect(result.error.message).toContain('free-tier limit')
    }
    // API was NOT called for the 3rd request
    expect(mockGenerate).toHaveBeenCalledTimes(2)
  })

  it('GEMI-10-C: without freeTier option, no limit is enforced', async () => {
    mockGenerate.mockResolvedValue(successResponse('ok'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL) // no freeTier
    for (let i = 0; i < 15; i++) {
      const result = await adapter.complete({ system: 's', userContent: 'u' })
      expect(result.ok).toBe(true)
    }
    expect(mockGenerate).toHaveBeenCalledTimes(15)
  })

  it('GEMI-10-D: isQuotaExhausted starts false and becomes true after limit is reached', async () => {
    mockGenerate.mockResolvedValue(successResponse('ok'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL, {
      freeTier: { maxRequestsPerRun: 2, maxOutputTokens: 512 },
    })
    expect(adapter.isQuotaExhausted).toBe(false)
    await adapter.complete({ system: 's', userContent: 'u' })
    expect(adapter.isQuotaExhausted).toBe(false)
    await adapter.complete({ system: 's', userContent: 'u' })
    expect(adapter.isQuotaExhausted).toBe(true)
  })

  it('GEMI-10-E: isQuotaExhausted is false when freeTier is not set', () => {
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL) // no freeTier
    expect(adapter.isQuotaExhausted).toBe(false)
  })
})

// ── GEMI-12: Model unavailable ────────────────────────────────────────────────

describe('GEMI-12: Model unavailable', () => {
  it('GEMI-12-A: HTTP 404 → LLM_MODEL_UNAVAILABLE', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(404, 'models/gemini-99 is not found'))
    const adapter = new GeminiAdapter('key', 'gemini-99')
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_MODEL_UNAVAILABLE')
      expect(result.error.message).toContain('404')
    }
  })

  it('GEMI-12-B: HTTP 400 with "model" in message → LLM_MODEL_UNAVAILABLE', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(400, 'Invalid model: gemini-99 is not supported'))
    const adapter = new GeminiAdapter('key', 'gemini-99')
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_MODEL_UNAVAILABLE')
    }
  })

  it('GEMI-12-C: HTTP 400 without "model" in message → LLM_PROVIDER_UNAVAILABLE', async () => {
    mockGenerate.mockRejectedValue(new MockApiError(400, 'Invalid request parameter'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL)
    const result = await adapter.complete({ system: 's', userContent: 'u' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_PROVIDER_UNAVAILABLE')
    }
  })
})

// ── GEMI-11: maxOutputTokens forwarded to API ─────────────────────────────────

describe('GEMI-11: maxOutputTokens', () => {
  it('GEMI-11-A: freeTier maxOutputTokens is forwarded when req.maxTokens absent', async () => {
    mockGenerate.mockResolvedValue(successResponse('ok'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL, {
      freeTier: DEFAULT_FREE_TIER_LIMITS,
    })
    await adapter.complete({ system: 's', userContent: 'u' })
    const callArg = mockGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    const config = callArg['config'] as Record<string, unknown>
    expect(config['maxOutputTokens']).toBe(DEFAULT_FREE_TIER_LIMITS.maxOutputTokens)
  })

  it('GEMI-11-B: req.maxTokens takes precedence over freeTier limit', async () => {
    mockGenerate.mockResolvedValue(successResponse('ok'))
    const adapter = new GeminiAdapter('key', GEMINI_DEFAULT_MODEL, {
      freeTier: { maxRequestsPerRun: 10, maxOutputTokens: 512 },
    })
    await adapter.complete({ system: 's', userContent: 'u', maxTokens: 2048 })
    const callArg = mockGenerate.mock.calls[0]?.[0] as Record<string, unknown>
    const config = callArg['config'] as Record<string, unknown>
    expect(config['maxOutputTokens']).toBe(2048)
  })
})
