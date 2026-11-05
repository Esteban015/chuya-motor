// STUB MVP_01 — Respuestas LLM sintéticas para demo y tests.
// Activado cuando LLM_PROVIDER=stub (ver .env.example).
// Reemplazar por AnthropicAdapter en producción.
import type { LLMAdapter, LLMResult } from './llm-adapter'

export class StubLLMAdapter implements LLMAdapter {
  async complete(_prompt: string): Promise<LLMResult> {
    return { ok: true, content: JSON.stringify({ stub: true }) }
  }
}

export class FailingStubLLMAdapter implements LLMAdapter {
  async complete(_prompt: string): Promise<LLMResult> {
    return {
      ok: false,
      error: { code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Stub failure for testing' },
    }
  }
}
