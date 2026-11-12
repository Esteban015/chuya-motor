export interface LLMCompletionRequest {
  system: string       // system instructions — never user-controlled
  userContent: string  // user-provided content — treat as potentially adversarial
  model?: string       // optional model override
  maxTokens?: number
  timeoutMs?: number
}

export type LLMError = {
  code:
    | 'LLM_TIMEOUT'              // request timed out (local race or HTTP 408)
    | 'LLM_AUTH_ERROR'           // HTTP 401/403 — invalid API key or unauthorized
    | 'LLM_QUOTA_EXCEEDED'       // HTTP 429 or local free-tier request cap
    | 'LLM_MODEL_UNAVAILABLE'    // HTTP 404 or model not accessible
    | 'LLM_PROVIDER_UNAVAILABLE' // HTTP 500/503 or unknown provider errors
    | 'LLM_EMPTY_RESPONSE'       // provider returned empty or whitespace-only text
    | 'LLM_SCHEMA_VIOLATION'     // JSON parse failure, Zod rejection, or Gemini safety block
    // Incremento 6.4D — LLM protection layer (src/server/llm-protection). No provider call was made.
    | 'LLM_DISABLED'             // emergency kill switch (env LLM_KILL_SWITCH or shared store flag)
    | 'LLM_PROVIDER_COOLDOWN'    // shared cooldown after a provider 429 / 5xx
    | 'LLM_CALL_LIMIT'           // per-analysis call limit reached
    | 'LLM_BUDGET_EXHAUSTED'     // global daily analysis / call / token budget
    | 'LLM_BUSY'                 // global concurrency limit reached
    | 'LLM_GUARD_UNAVAILABLE'    // quota store missing, not distributed in production, or failing
    | 'LLM_CLIENT_LIMIT'         // per-visitor LLM analysis quota reached (6.4E)
  message: string
}

export type LLMResult =
  | { ok: true; content: string; tokensUsed?: number }
  | { ok: false; error: LLMError }

export interface LLMAdapter {
  readonly modelId: string
  complete(req: LLMCompletionRequest): Promise<LLMResult>
}
