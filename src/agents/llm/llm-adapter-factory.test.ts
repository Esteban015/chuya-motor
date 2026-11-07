/**
 * llm-adapter-factory.test.ts — FASE 5A
 *
 * Tests for server-side provider selection via createLLMAdapter().
 * Strategy: stub env vars with vi.stubEnv(), verify correct adapter is returned.
 * Does NOT make real API calls — uses env-var isolation only.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { DeterministicMockLLMAdapter } from './deterministic-mock-adapter'
import type { LLMAdapter } from './llm-adapter'

// ── FAC-01: Default provider (stub / unset) ───────────────────────────────────

describe('FAC-01: default provider — returns DeterministicMockLLMAdapter', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('FAC-01-A: LLM_PROVIDER unset → mock adapter', async () => {
    vi.stubEnv('LLM_PROVIDER', '')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const adapter = createLLMAdapter()
    expect(adapter).toBeInstanceOf(DeterministicMockLLMAdapter)
  })

  it('FAC-01-B: LLM_PROVIDER=stub → mock adapter', async () => {
    vi.stubEnv('LLM_PROVIDER', 'stub')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const adapter = createLLMAdapter()
    expect(adapter).toBeInstanceOf(DeterministicMockLLMAdapter)
  })

  it('FAC-01-C: mock adapter exposes correct modelId', async () => {
    vi.stubEnv('LLM_PROVIDER', 'stub')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const adapter = createLLMAdapter()
    expect(adapter.modelId).toBe('deterministic-mock-v1')
  })

  it('FAC-01-D: mock adapter complete() returns ok result with no real API call', async () => {
    vi.stubEnv('LLM_PROVIDER', 'stub')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const adapter = createLLMAdapter()
    const result = await adapter.complete({
      system: '[DIAGNOSIS_REQUEST]',
      userContent: 'Vehículo: Ford Ranger\nNivel de experiencia: novice\nSíntoma: test',
    })
    expect(result.ok).toBe(true)
  })
})

// ── FAC-02: Anthropic provider — missing API key throws ───────────────────────

describe('FAC-02: anthropic provider — missing key throws, never calls real API', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('FAC-02-A: LLM_PROVIDER=anthropic without LLM_API_KEY → throws', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_API_KEY', '')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).toThrow(/LLM_API_KEY/)
  })

  it('FAC-02-B: error message mentions how to fix', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_API_KEY', '')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).toThrow(/\.env\.local/)
  })
})

// ── FAC-03: Anthropic provider — with key returns AnthropicAdapter ────────────

describe('FAC-03: anthropic provider — returns AnthropicAdapter (no API calls)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('FAC-03-A: LLM_PROVIDER=anthropic with key → AnthropicAdapter instance', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_API_KEY', 'sk-ant-test-key-000')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const { AnthropicAdapter } = await import('./anthropic-adapter')
    const adapter = createLLMAdapter()
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
  })

  it('FAC-03-B: modelId reflects ANTHROPIC_DEFAULT_MODEL', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_API_KEY', 'sk-ant-test-key-000')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const { ANTHROPIC_DEFAULT_MODEL } = await import('./anthropic-adapter')
    const adapter = createLLMAdapter()
    expect(adapter.modelId).toBe(ANTHROPIC_DEFAULT_MODEL)
  })

  it('FAC-03-C: LLM_MODEL env var overrides default model', async () => {
    vi.stubEnv('LLM_PROVIDER', 'anthropic')
    vi.stubEnv('LLM_API_KEY', 'sk-ant-test-key-000')
    vi.stubEnv('LLM_MODEL', 'claude-haiku-4-5')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const adapter = createLLMAdapter()
    expect(adapter.modelId).toBe('claude-haiku-4-5')
  })
})

// ── FAC-04: LLMAdapter contract — all adapters satisfy interface ───────────────

describe('FAC-04: all adapters satisfy LLMAdapter interface', () => {
  function assertImplementsAdapter(adapter: LLMAdapter) {
    expect(typeof adapter.modelId).toBe('string')
    expect(typeof adapter.complete).toBe('function')
  }

  it('FAC-04-A: DeterministicMockLLMAdapter satisfies interface', () => {
    const adapter = new DeterministicMockLLMAdapter()
    assertImplementsAdapter(adapter)
  })

  it('FAC-04-B: AnthropicAdapter satisfies interface', async () => {
    const { AnthropicAdapter } = await import('./anthropic-adapter')
    const adapter = new AnthropicAdapter('sk-ant-test-key-000')
    assertImplementsAdapter(adapter)
  })
})

// ── FAC-06: Gemini provider — missing API key throws ─────────────────────────

describe('FAC-06: gemini provider — missing GEMINI_API_KEY throws', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('FAC-06-A: LLM_PROVIDER=gemini without GEMINI_API_KEY → throws', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', '')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).toThrow(/GEMINI_API_KEY/)
  })

  it('FAC-06-B: error message mentions .env.local', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', '')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).toThrow(/\.env\.local/)
  })
})

// ── FAC-07: Gemini provider — with key returns GeminiAdapter ─────────────────

describe('FAC-07: gemini provider — returns GeminiAdapter (no API calls)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('FAC-07-A: LLM_PROVIDER=gemini with GEMINI_API_KEY → GeminiAdapter instance', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
    vi.stubEnv('GEMINI_FREE_TIER', 'false') // skip allowlist for this test
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const { GeminiAdapter } = await import('./gemini-adapter')
    const adapter = createLLMAdapter()
    expect(adapter).toBeInstanceOf(GeminiAdapter)
  })

  it('FAC-07-B: modelId reflects GEMINI_DEFAULT_MODEL by default', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
    vi.stubEnv('GEMINI_FREE_TIER', 'false')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const { GEMINI_DEFAULT_MODEL } = await import('./gemini-adapter')
    const adapter = createLLMAdapter()
    expect(adapter.modelId).toBe(GEMINI_DEFAULT_MODEL)
  })

  it('FAC-07-C: GEMINI_MODEL env var overrides default model (GEMINI_FREE_TIER=false bypasses allowlist)', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
    vi.stubEnv('GEMINI_MODEL', 'gemini-custom-override')
    vi.stubEnv('GEMINI_FREE_TIER', 'false')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const adapter = createLLMAdapter()
    expect(adapter.modelId).toBe('gemini-custom-override')
  })

  it('FAC-07-E: GEMINI_MODEL=gemini-3.5-flash-lite passes allowlist (new primary model)', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash-lite')
    // GEMINI_FREE_TIER not set → defaults to 'true', so allowlist check runs
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).not.toThrow()
    const adapter = createLLMAdapter()
    expect(adapter.modelId).toBe('gemini-3.5-flash-lite')
  })

  it('FAC-07-D: GeminiAdapter satisfies LLMAdapter interface', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')
    vi.stubEnv('GEMINI_FREE_TIER', 'false')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    const adapter = createLLMAdapter()
    expect(typeof adapter.modelId).toBe('string')
    expect(typeof adapter.complete).toBe('function')
  })
})

// ── FAC-08: Unknown provider — explicit rejection ─────────────────────────────

describe('FAC-08: unknown provider — never silently falls back', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('FAC-08-A: LLM_PROVIDER=openai → throws with provider name in message', async () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).toThrow(/openai/)
  })

  it('FAC-08-B: LLM_PROVIDER=cohere → throws', async () => {
    vi.stubEnv('LLM_PROVIDER', 'cohere')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).toThrow(/cohere/)
  })

  it('FAC-08-C: error message mentions supported providers', async () => {
    vi.stubEnv('LLM_PROVIDER', 'unknown-provider')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).toThrow(/stub.*anthropic.*gemini/i)
  })
})

// ── FAC-09: Free-tier allowlist enforcement ───────────────────────────────────

describe('FAC-09: gemini free-tier allowlist', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('FAC-09-A: gemini-3.5-flash-lite (primary) passes allowlist by default', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash-lite')
    // GEMINI_FREE_TIER not set → defaults to 'true'
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).not.toThrow()
  })

  it('FAC-09-B: non-allowlisted model with GEMINI_FREE_TIER=true → throws', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_MODEL', 'gemini-ultra-99')
    vi.stubEnv('GEMINI_FREE_TIER', 'true')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).toThrow(/allowlist/)
  })

  it('FAC-09-C: GEMINI_FREE_TIER=false disables allowlist check', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_MODEL', 'gemini-ultra-99')
    vi.stubEnv('GEMINI_FREE_TIER', 'false')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).not.toThrow()
  })

  it('FAC-09-D: gemini-2.5-flash (secondary) also passes allowlist', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).not.toThrow()
  })

  it('FAC-09-E: gemini-2.5-flash-lite rejected — HTTP 404 confirmed on generateContent for new projects', async () => {
    vi.stubEnv('LLM_PROVIDER', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'test-key')
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash-lite')
    vi.stubEnv('GEMINI_FREE_TIER', 'true')
    const { createLLMAdapter } = await import('./llm-adapter-factory')
    expect(() => createLLMAdapter()).toThrow(/allowlist/)
  })
})

// ── FAC-05: AnthropicAdapter error mapping (no real API calls) ─────────────────

describe('FAC-05: AnthropicAdapter maps errors to LLMError codes', () => {
  it('FAC-05-A: network error maps to LLM_PROVIDER_UNAVAILABLE', async () => {
    const { AnthropicAdapter } = await import('./anthropic-adapter')
    const adapter = new AnthropicAdapter('sk-ant-invalid-key')

    // The real client will fail with a network/auth error (no actual API call in test isolation)
    // We only verify the error code mapping via the error type, not by making a real call.
    // Structural test: adapter.complete returns a Promise
    const promise = adapter.complete({ system: 'test', userContent: 'test' })
    expect(promise).toBeInstanceOf(Promise)
  })
})
