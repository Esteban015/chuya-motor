// Server-side only — reads env vars to select LLM provider.
// Called exclusively from API route handlers and benchmark runner; never imported from client components.
//
// Supported providers:
//   LLM_PROVIDER=stub      (default) → DeterministicMockLLMAdapter
//   LLM_PROVIDER=anthropic            → AnthropicAdapter (requires LLM_API_KEY)
//   LLM_PROVIDER=gemini               → GeminiAdapter    (requires GEMINI_API_KEY)
//
// Unknown providers throw explicitly — NEVER fall back silently to a paid provider.
import { DeterministicMockLLMAdapter } from './deterministic-mock-adapter'
import { AnthropicAdapter } from './anthropic-adapter'
import { GeminiAdapter, GEMINI_DEFAULT_MODEL } from './gemini-adapter'
import { DEFAULT_FREE_TIER_LIMITS, assertModelInFreeTierAllowlist } from './gemini-free-tier'
import type { LLMAdapter } from './llm-adapter'

export function createLLMAdapter(): LLMAdapter {
  // Use || so empty string '' is treated the same as unset (defaults to 'stub').
  const provider = process.env['LLM_PROVIDER'] || 'stub'

  if (provider === 'anthropic') {
    const apiKey = process.env['LLM_API_KEY']
    if (!apiKey) {
      throw new Error(
        'LLM_PROVIDER=anthropic requires LLM_API_KEY to be set. ' +
          'Set LLM_API_KEY=sk-ant-... in your .env.local file.',
      )
    }
    const model = process.env['LLM_MODEL'] ?? undefined
    return new AnthropicAdapter(apiKey, model)
  }

  if (provider === 'gemini') {
    const apiKey = process.env['GEMINI_API_KEY']
    if (!apiKey) {
      throw new Error(
        'LLM_PROVIDER=gemini requires GEMINI_API_KEY to be set. ' +
          'Set GEMINI_API_KEY=<your-ai-studio-key> in your .env.local file.',
      )
    }
    const model = process.env['GEMINI_MODEL'] ?? GEMINI_DEFAULT_MODEL
    // Free-tier guard is ON by default; set GEMINI_FREE_TIER=false to disable.
    const freeTierEnabled = process.env['GEMINI_FREE_TIER'] !== 'false'
    if (freeTierEnabled) {
      assertModelInFreeTierAllowlist(model)
    }
    const options = freeTierEnabled ? { freeTier: DEFAULT_FREE_TIER_LIMITS } : {}
    return new GeminiAdapter(apiKey, model, options)
  }

  if (provider !== 'stub') {
    throw new Error(
      `Unknown LLM_PROVIDER="${provider}". Supported values: stub, anthropic, gemini. ` +
        'Refusing to fall back to any paid provider silently.',
    )
  }

  return new DeterministicMockLLMAdapter()
}
