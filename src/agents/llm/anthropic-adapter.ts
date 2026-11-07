// FASE 5A — Integración controlada de LLM real.
// Activado únicamente cuando LLM_PROVIDER=anthropic y LLM_API_KEY están presentes.
// El mock (DeterministicMockLLMAdapter) sigue siendo el default para todos los tests.
import Anthropic from '@anthropic-ai/sdk'
import type { LLMAdapter, LLMCompletionRequest, LLMResult } from './llm-adapter'

export const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_MAX_TOKENS = 1024
const DEFAULT_TIMEOUT_MS = 30_000

export class AnthropicAdapter implements LLMAdapter {
  private readonly client: Anthropic
  private readonly defaultModel: string

  constructor(apiKey: string, model = ANTHROPIC_DEFAULT_MODEL) {
    this.client = new Anthropic({ apiKey, timeout: DEFAULT_TIMEOUT_MS })
    this.defaultModel = model
  }

  get modelId(): string {
    return this.defaultModel
  }

  async complete(req: LLMCompletionRequest): Promise<LLMResult> {
    const model = req.model ?? this.defaultModel
    const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS

    try {
      const message = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.userContent }],
      })

      const textBlock = message.content.find((b) => b.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        return {
          ok: false,
          error: { code: 'LLM_SCHEMA_VIOLATION', message: 'No text block in Anthropic response' },
        }
      }

      const tokensUsed =
        message.usage.input_tokens + message.usage.output_tokens

      return { ok: true, content: textBlock.text, tokensUsed }
    } catch (err) {
      return { ok: false, error: mapAnthropicError(err) }
    }
  }
}

function mapAnthropicError(err: unknown): import('./llm-adapter').LLMError {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 408 || err.message.toLowerCase().includes('timeout')) {
      return { code: 'LLM_TIMEOUT', message: `Anthropic timeout: ${err.message}` }
    }
    if (err.status === 529 || err.status === 503 || err.status === 500) {
      return { code: 'LLM_PROVIDER_UNAVAILABLE', message: `Anthropic error ${err.status}: ${err.message}` }
    }
    return { code: 'LLM_PROVIDER_UNAVAILABLE', message: `Anthropic API error ${err.status}: ${err.message}` }
  }
  const msg = err instanceof Error ? err.message : String(err)
  return { code: 'LLM_PROVIDER_UNAVAILABLE', message: `Unexpected error: ${msg}` }
}
