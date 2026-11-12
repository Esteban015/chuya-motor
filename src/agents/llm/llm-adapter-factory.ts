// Server-side only — reads env vars to select LLM provider.
// Called exclusively from API route handlers and benchmark runner; never imported from client components.
//
// Supported providers:
//   LLM_PROVIDER=stub      (default) → DeterministicMockLLMAdapter
//   LLM_PROVIDER=anthropic            → AnthropicAdapter (requires LLM_API_KEY)
//   LLM_PROVIDER=gemini               → GeminiAdapter    (requires GEMINI_API_KEY)
//   LLM_PROVIDER=groq                 → GroqAdapter      (requires GROQ_API_KEY) — evaluation only,
//                                       NOT enabled in production (Incremento 6.3)
//
// Unknown providers throw explicitly — NEVER fall back silently to a paid provider.
import { DeterministicMockLLMAdapter } from './deterministic-mock-adapter'
import { AnthropicAdapter } from './anthropic-adapter'
import { GeminiAdapter, GEMINI_DEFAULT_MODEL } from './gemini-adapter'
import { DEFAULT_FREE_TIER_LIMITS, assertModelInFreeTierAllowlist } from './gemini-free-tier'
import { GroqAdapter, GROQ_DEFAULT_MODEL, assertSupportedModel } from './groq-adapter'
import type { GroqReasoningEffort } from './groq-adapter'
import type { LLMAdapter } from './llm-adapter'

type Env = Record<string, string | undefined>

// 6.4D: env is injectable so the request protection layer builds the adapter from the SAME
// configuration it guards (no accidental stub when the provider is real).
export function createLLMAdapter(env: Env = process.env): LLMAdapter {
  // Use || so empty string '' is treated the same as unset (defaults to 'stub').
  const provider = env['LLM_PROVIDER'] || 'stub'

  if (provider === 'anthropic') {
    const apiKey = env['LLM_API_KEY']
    if (!apiKey) {
      throw new Error(
        'LLM_PROVIDER=anthropic requires LLM_API_KEY to be set. ' +
          'Set LLM_API_KEY=sk-ant-... in your .env.local file.',
      )
    }
    const model = env['LLM_MODEL'] ?? undefined
    return new AnthropicAdapter(apiKey, model)
  }

  if (provider === 'gemini') {
    const apiKey = env['GEMINI_API_KEY']
    if (!apiKey) {
      throw new Error(
        'LLM_PROVIDER=gemini requires GEMINI_API_KEY to be set. ' +
          'Set GEMINI_API_KEY=<your-ai-studio-key> in your .env.local file.',
      )
    }
    const model = env['GEMINI_MODEL'] ?? GEMINI_DEFAULT_MODEL
    // Free-tier guard is ON by default; set GEMINI_FREE_TIER=false to disable.
    const freeTierEnabled = env['GEMINI_FREE_TIER'] !== 'false'
    if (freeTierEnabled) {
      assertModelInFreeTierAllowlist(model)
    }
    const options = freeTierEnabled ? { freeTier: DEFAULT_FREE_TIER_LIMITS } : {}
    return new GeminiAdapter(apiKey, model, options)
  }

  if (provider === 'groq') {
    return createGroqAdapterFromEnv(env)
  }

  if (provider !== 'stub') {
    throw new Error(
      `Unknown LLM_PROVIDER="${provider}". Supported values: stub, anthropic, gemini, groq. ` +
        'Refusing to fall back to any paid provider silently.',
    )
  }

  return new DeterministicMockLLMAdapter()
}

// ── Groq ────────────────────────────────────────────────────────────────────
// Server-only env vars. NEXT_PUBLIC_* is never read: it would be inlined into the client bundle.
function createGroqAdapterFromEnv(env: Env): GroqAdapter {
  const apiKey = env['GROQ_API_KEY']
  if (!apiKey) {
    const publicHint = env['NEXT_PUBLIC_GROQ_API_KEY']
      ? ' NEXT_PUBLIC_GROQ_API_KEY is ignored on purpose (it would be exposed to the browser) — remove it.'
      : ''
    throw new Error(
      'LLM_PROVIDER=groq requires GROQ_API_KEY to be set (server-side only). ' +
        'Set GROQ_API_KEY=gsk_... in your .env.local file.' +
        publicHint,
    )
  }

  const model = env['GROQ_MODEL'] || GROQ_DEFAULT_MODEL
  assertSupportedModel(model)

  const reasoning = env['GROQ_REASONING_EFFORT'] || 'low'
  if (reasoning !== 'low' && reasoning !== 'medium' && reasoning !== 'high') {
    throw new Error(`Invalid GROQ_REASONING_EFFORT="${reasoning}". Use low, medium or high.`)
  }

  return new GroqAdapter(apiKey, {
    model,
    timeoutMs: readPositiveIntEnv(env, 'GROQ_TIMEOUT_MS'),
    maxTokens: readPositiveIntEnv(env, 'GROQ_MAX_TOKENS'),
    maxRetries: readIntEnv(env, 'GROQ_MAX_RETRIES', 0, 2),
    reasoningEffort: reasoning as GroqReasoningEffort,
  })
}

function readPositiveIntEnv(env: Env, name: string): number | undefined {
  return readIntEnv(env, name, 1, Number.MAX_SAFE_INTEGER)
}

function readIntEnv(env: Env, name: string, min: number, max: number): number | undefined {
  const raw = env[name]
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${name}="${raw}". Expected an integer in [${min}, ${max}].`)
  }
  return n
}
