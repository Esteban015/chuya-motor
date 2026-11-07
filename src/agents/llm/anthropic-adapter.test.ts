/**
 * anthropic-adapter.test.ts — FASE 5A
 *
 * Unit tests for AnthropicAdapter using vi.hoisted() + vi.mock() to inject a
 * test double for the Anthropic SDK client. No real API calls are made.
 * Tests cover: success path, token counting, system/user separation, error mapping, modelId.
 *
 * Pattern: vi.hoisted() creates the spy BEFORE vi.mock() runs; static imports at the
 * top of the file pick up the mocked @anthropic-ai/sdk automatically.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMCompletionRequest } from './llm-adapter'
import { AnthropicAdapter, ANTHROPIC_DEFAULT_MODEL } from './anthropic-adapter'

// ── Hoisted spy — must be declared before vi.mock() ──────────────────────────
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => {
  class MockAPIError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  }
  class MockAnthropic {
    messages = { create: mockCreate }
    constructor() {}
    static APIError = MockAPIError
  }
  return { default: MockAnthropic }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSuccessResponse(text: string, inputTokens = 50, outputTokens = 100) {
  return {
    content: [{ type: 'text' as const, text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

function makeEmptyContentResponse() {
  return {
    content: [] as never[],
    usage: { input_tokens: 10, output_tokens: 0 },
  }
}

const REQ: LLMCompletionRequest = {
  system: '[DIAGNOSIS_REQUEST]\nAnalizá síntomas.',
  userContent: 'Vehículo: Toyota Corolla 2015\nSíntoma: ruido en el motor',
}

// ── RANT-01: Success path ─────────────────────────────────────────────────────

describe('RANT-01: AnthropicAdapter success path', () => {
  beforeEach(() => mockCreate.mockReset())

  it('RANT-01-A: returns ok=true with text content from API', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('{"facts":[],"hypotheses":[],"questions":[]}'))

    const adapter = new AnthropicAdapter('sk-ant-test', 'claude-haiku-4-5-20251001')
    const result = await adapter.complete(REQ)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.content).toBe('{"facts":[],"hypotheses":[],"questions":[]}')
    }
  })

  it('RANT-01-B: tokensUsed = input + output tokens from usage', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('{}', 80, 120))

    const adapter = new AnthropicAdapter('sk-ant-test')
    const result = await adapter.complete(REQ)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tokensUsed).toBe(200) // 80 + 120
    }
  })

  it('RANT-01-C: system and userContent passed to API separately', async () => {
    mockCreate.mockResolvedValue(makeSuccessResponse('{}'))

    const adapter = new AnthropicAdapter('sk-ant-test')
    await adapter.complete(REQ)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: REQ.system,
        messages: [{ role: 'user', content: REQ.userContent }],
      }),
    )
  })
})

// ── RANT-02: Error mapping ─────────────────────────────────────────────────────

describe('RANT-02: AnthropicAdapter maps API errors to LLMError', () => {
  beforeEach(() => mockCreate.mockReset())

  it('RANT-02-A: empty content response → LLM_SCHEMA_VIOLATION', async () => {
    mockCreate.mockResolvedValue(makeEmptyContentResponse())

    const adapter = new AnthropicAdapter('sk-ant-test')
    const result = await adapter.complete(REQ)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_SCHEMA_VIOLATION')
    }
  })

  it('RANT-02-B: unexpected response (undefined) → LLM_PROVIDER_UNAVAILABLE', async () => {
    // mockReturnValue(undefined) makes create() return undefined synchronously.
    // await undefined = undefined. Then message.content throws TypeError — caught by adapter.
    mockCreate.mockReturnValue(undefined)

    const adapter = new AnthropicAdapter('sk-ant-test')
    const result = await adapter.complete(REQ)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_PROVIDER_UNAVAILABLE')
    }
  })
})

// ── RANT-03: modelId ─────────────────────────────────────────────────────────

describe('RANT-03: AnthropicAdapter modelId', () => {
  it('RANT-03-A: default modelId is ANTHROPIC_DEFAULT_MODEL', () => {
    const adapter = new AnthropicAdapter('sk-ant-test')
    expect(adapter.modelId).toBe(ANTHROPIC_DEFAULT_MODEL)
  })

  it('RANT-03-B: custom model is reflected in modelId', () => {
    const adapter = new AnthropicAdapter('sk-ant-test', 'claude-haiku-4-5')
    expect(adapter.modelId).toBe('claude-haiku-4-5')
  })
})
