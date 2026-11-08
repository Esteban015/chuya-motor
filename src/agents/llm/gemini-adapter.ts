// FASE 5C — Integración controlada de Google Gemini.
// Activado únicamente cuando LLM_PROVIDER=gemini y GEMINI_API_KEY están presentes.
// El mock (DeterministicMockLLMAdapter) sigue siendo el default para todos los tests.
import { GoogleGenAI, ApiError, FinishReason } from '@google/genai'
import type { LLMAdapter, LLMCompletionRequest, LLMResult, LLMError } from './llm-adapter'
import type { GeminiFreeTierLimits } from './gemini-free-tier'

// gemini-3.5-flash-lite confirmed HTTP 200 on generateContent for new AI Studio projects (2026-11-07).
// gemini-2.5-flash appears in models.list() but returns HTTP 404 on generateContent for new projects.
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const DEFAULT_MAX_TOKENS = 1024
const DEFAULT_TIMEOUT_MS = 30_000

export interface GeminiAdapterOptions {
  /** When set, enforces local free-tier request and token limits. */
  freeTier?: GeminiFreeTierLimits
}

export class GeminiAdapter implements LLMAdapter {
  private readonly client: GoogleGenAI
  private readonly defaultModel: string
  private readonly freeTierLimits?: GeminiFreeTierLimits
  private requestCount = 0

  constructor(apiKey: string, model = GEMINI_DEFAULT_MODEL, options: GeminiAdapterOptions = {}) {
    this.client = new GoogleGenAI({ apiKey })
    this.defaultModel = model
    this.freeTierLimits = options.freeTier
  }

  get modelId(): string {
    return this.defaultModel
  }

  get isQuotaExhausted(): boolean {
    return (
      this.freeTierLimits !== undefined &&
      this.requestCount >= this.freeTierLimits.maxRequestsPerRun
    )
  }

  /** Number of real generateContent calls made since this adapter was created. */
  get requestsMade(): number {
    return this.requestCount
  }

  async complete(req: LLMCompletionRequest): Promise<LLMResult> {
    // Free-tier guard: enforce local request cap before making any network call.
    if (this.freeTierLimits !== undefined) {
      if (this.requestCount >= this.freeTierLimits.maxRequestsPerRun) {
        return {
          ok: false,
          error: {
            code: 'LLM_QUOTA_EXCEEDED',
            message:
              `Gemini free-tier limit: max ${this.freeTierLimits.maxRequestsPerRun} ` +
              'requests per run exceeded. Increase GEMINI_FREE_TIER=false or raise maxRequestsPerRun.',
          },
        }
      }
      this.requestCount++
    }

    const model = req.model ?? this.defaultModel
    const maxOutputTokens =
      req.maxTokens ?? this.freeTierLimits?.maxOutputTokens ?? DEFAULT_MAX_TOKENS
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS

    // system → config.systemInstruction (never mixed with userContent)
    // userContent → contents (treated as potentially adversarial)
    const generatePromise = this.client.models.generateContent({
      model,
      contents: req.userContent,
      config: {
        systemInstruction: req.system,
        maxOutputTokens,
      },
    })

    let response: Awaited<ReturnType<typeof this.client.models.generateContent>>
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Gemini timeout after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      )
      response = await Promise.race([generatePromise, timeoutPromise])
    } catch (err) {
      return { ok: false, error: mapGeminiError(err) }
    }

    // Safety block: provider rejected content before generating output.
    const candidate = response.candidates?.[0]
    if (candidate?.finishReason === FinishReason.SAFETY) {
      return {
        ok: false,
        error: { code: 'LLM_SCHEMA_VIOLATION', message: 'Response blocked by Gemini safety filters' },
      }
    }

    // Empty/missing text — distinct from schema violation (no JSON to parse).
    const text = response.text
    if (!text || text.trim() === '') {
      return {
        ok: false,
        error: { code: 'LLM_EMPTY_RESPONSE', message: 'Empty or missing text in Gemini response' },
      }
    }

    const promptTokens = response.usageMetadata?.promptTokenCount ?? 0
    const candidateTokens = response.usageMetadata?.candidatesTokenCount ?? 0
    const tokensUsed = promptTokens + candidateTokens

    return {
      ok: true,
      content: text,
      tokensUsed: tokensUsed > 0 ? tokensUsed : undefined,
    }
  }
}

function mapGeminiError(err: unknown): LLMError {
  // Local timeout via Promise.race
  if (err instanceof Error && (err.message.includes('timeout') || err.message.includes('Timeout'))) {
    return { code: 'LLM_TIMEOUT', message: err.message }
  }

  if (err instanceof ApiError) {
    if (err.status === 408) {
      return { code: 'LLM_TIMEOUT', message: `Gemini timeout (408): ${err.message}` }
    }
    if (err.status === 429) {
      return { code: 'LLM_QUOTA_EXCEEDED', message: `Gemini quota/rate limit (429): ${err.message}` }
    }
    if (err.status === 401 || err.status === 403) {
      return { code: 'LLM_AUTH_ERROR', message: `Gemini auth error (${err.status}): ${err.message}` }
    }
    if (err.status === 404) {
      return { code: 'LLM_MODEL_UNAVAILABLE', message: `Gemini model not found (404): ${err.message}` }
    }
    if (err.status === 400 && err.message.toLowerCase().includes('model')) {
      return { code: 'LLM_MODEL_UNAVAILABLE', message: `Gemini invalid model (400): ${err.message}` }
    }
    if (err.status === 500 || err.status === 503) {
      return { code: 'LLM_PROVIDER_UNAVAILABLE', message: `Gemini service error (${err.status}): ${err.message}` }
    }
    return {
      code: 'LLM_PROVIDER_UNAVAILABLE',
      message: `Gemini API error (${err.status ?? 'unknown'}): ${err.message}`,
    }
  }

  const msg = err instanceof Error ? err.message : String(err)
  return { code: 'LLM_PROVIDER_UNAVAILABLE', message: `Unexpected Gemini error: ${msg}` }
}
