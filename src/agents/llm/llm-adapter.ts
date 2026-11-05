export type LLMError = {
  code: 'LLM_TIMEOUT' | 'LLM_PROVIDER_UNAVAILABLE' | 'LLM_SCHEMA_VIOLATION'
  message: string
}

export type LLMResult =
  | { ok: true; content: string }
  | { ok: false; error: LLMError }

export interface LLMAdapter {
  complete(prompt: string): Promise<LLMResult>
}
