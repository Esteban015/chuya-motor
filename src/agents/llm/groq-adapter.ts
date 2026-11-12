// Incremento 6.3 — Integración controlada de GroqCloud (openai/gpt-oss-120b).
// Activado únicamente cuando LLM_PROVIDER=groq y GROQ_API_KEY están presentes (server-side).
// NO es el proveedor de producción: el default sigue siendo el stub determinístico.
//
// Decisiones (ver README § GroqCloud):
//  - SDK oficial groq-sdk (sin dependencias transitivas, tipos para reasoning_effort /
//    include_reasoning / max_completion_tokens). Reintentos automáticos del SDK DESACTIVADOS
//    (maxRetries: 0); la política de reintento es explícita, acotada y testeable acá.
//  - gpt-oss-* son modelos de razonamiento: los reasoning tokens consumen
//    max_completion_tokens. Si el presupuesto se agota, finish_reason='length' y el JSON
//    queda truncado o vacío → se rechaza. Por eso: reasoning_effort='low' y un default de
//    2048 tokens (las respuestas de los nodos rondan 300–600 tokens de salida).
//  - include_reasoning=false: el razonamiento interno nunca vuelve como content.
//  - Sin response_format: el contrato LLMCompletionRequest no transporta un schema.
//    Los nodos siguen validando con extractJSON + Zod. Strict mode queda documentado
//    como mejora para un incremento posterior.
import Groq, { APIError, APIConnectionTimeoutError } from 'groq-sdk'
import type { LLMAdapter, LLMCompletionRequest, LLMError, LLMResult } from './llm-adapter'

export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b'

/** Models validated for this adapter. Both accept reasoning_effort + include_reasoning. */
export const GROQ_SUPPORTED_MODELS: readonly string[] = Object.freeze([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
])

export const GROQ_DEFAULT_MAX_TOKENS = 2048
/** Local ceiling — model allows 65 536 output tokens; we cap far below to bound cost/latency. */
export const GROQ_MAX_TOKENS_CEILING = 8192
export const GROQ_DEFAULT_TIMEOUT_MS = 30_000
export const GROQ_MAX_RETRIES_CAP = 2
/** Retry-After values above this are not waited for — the caller gets LLM_QUOTA_EXCEEDED. */
export const GROQ_DEFAULT_MAX_RETRY_AFTER_MS = 10_000

export type GroqReasoningEffort = 'low' | 'medium' | 'high'

export interface GroqAdapterOptions {
  model?: string
  maxTokens?: number
  timeoutMs?: number
  reasoningEffort?: GroqReasoningEffort
  /** Bounded retries for 429/503 that carry a Retry-After header. 0..2, default 0. */
  maxRetries?: number
  maxRetryAfterMs?: number
  /** Optional hard cap on real SDK calls for this adapter instance (smoke / pilot). */
  maxRequestsPerRun?: number
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}

const RETRYABLE_STATUSES = new Set([429, 503])

interface MappedError {
  error: LLMError
  status: number | undefined
  retryAfterMs: number | null
}

export class GroqAdapter implements LLMAdapter {
  // Private class fields (#) are not enumerable — the client (and its key) never
  // leaks through JSON.stringify / object inspection of the adapter.
  readonly #client: Groq
  readonly #apiKey: string
  readonly #model: string
  readonly #maxTokens: number
  readonly #timeoutMs: number
  readonly #reasoningEffort: GroqReasoningEffort
  readonly #maxRetries: number
  readonly #maxRetryAfterMs: number
  readonly #maxRequestsPerRun: number | undefined
  readonly #sleep: (ms: number) => Promise<void>
  #requestCount = 0
  #lastRetryAfterMs: number | null = null

  constructor(apiKey: string, options: GroqAdapterOptions = {}) {
    if (!apiKey) {
      throw new Error('GroqAdapter requires GROQ_API_KEY (server-side env var).')
    }
    const model = options.model ?? GROQ_DEFAULT_MODEL
    assertSupportedModel(model)

    const maxTokens = options.maxTokens ?? GROQ_DEFAULT_MAX_TOKENS
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > GROQ_MAX_TOKENS_CEILING) {
      throw new Error(`GroqAdapter maxTokens must be an integer in [1, ${GROQ_MAX_TOKENS_CEILING}].`)
    }
    const maxRetries = options.maxRetries ?? 0
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > GROQ_MAX_RETRIES_CAP) {
      throw new Error(`GroqAdapter maxRetries must be an integer in [0, ${GROQ_MAX_RETRIES_CAP}].`)
    }

    this.#apiKey = apiKey
    this.#model = model
    this.#maxTokens = maxTokens
    this.#timeoutMs = options.timeoutMs ?? GROQ_DEFAULT_TIMEOUT_MS
    this.#reasoningEffort = options.reasoningEffort ?? 'low'
    this.#maxRetries = maxRetries
    this.#maxRetryAfterMs = options.maxRetryAfterMs ?? GROQ_DEFAULT_MAX_RETRY_AFTER_MS
    this.#maxRequestsPerRun = options.maxRequestsPerRun
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.#client = new Groq({ apiKey, maxRetries: 0, timeout: this.#timeoutMs })
  }

  get modelId(): string {
    return this.#model
  }

  /** Real SDK calls made by this instance (retries included). Read by the benchmark runner. */
  get requestsMade(): number {
    return this.#requestCount
  }

  get isQuotaExhausted(): boolean {
    return this.#maxRequestsPerRun !== undefined && this.#requestCount >= this.#maxRequestsPerRun
  }

  /** Retry-After (ms) from the last 429/503, or null. Lets callers abort early. */
  get lastRetryAfterMs(): number | null {
    return this.#lastRetryAfterMs
  }

  toString(): string {
    return `GroqAdapter(${this.#model})`
  }

  toJSON(): Record<string, unknown> {
    return { provider: 'groq', modelId: this.#model }
  }

  async complete(req: LLMCompletionRequest): Promise<LLMResult> {
    const model = req.model ?? this.#model
    if (!GROQ_SUPPORTED_MODELS.includes(model)) {
      return fail('LLM_MODEL_UNAVAILABLE', `Groq model "${model}" is not in the supported list.`)
    }
    const maxTokens = Math.min(Math.max(1, req.maxTokens ?? this.#maxTokens), GROQ_MAX_TOKENS_CEILING)
    const timeoutMs = req.timeoutMs ?? this.#timeoutMs

    for (let attempt = 0; ; attempt++) {
      if (this.isQuotaExhausted) {
        return fail(
          'LLM_QUOTA_EXCEEDED',
          `Groq local request cap reached (${this.#maxRequestsPerRun} per run).`,
        )
      }
      this.#requestCount++

      const outcome = await this.#callOnce(model, req, maxTokens, timeoutMs)
      if (outcome.kind === 'result') return outcome.result

      const { error, status, retryAfterMs } = outcome
      this.#lastRetryAfterMs = retryAfterMs
      const canRetry =
        attempt < this.#maxRetries &&
        status !== undefined &&
        RETRYABLE_STATUSES.has(status) &&
        retryAfterMs !== null &&
        retryAfterMs <= this.#maxRetryAfterMs
      if (!canRetry) return { ok: false, error }
      await this.#sleep(retryAfterMs ?? 0)
    }
  }

  async #callOnce(
    model: string,
    req: LLMCompletionRequest,
    maxTokens: number,
    timeoutMs: number,
  ): Promise<
    | { kind: 'result'; result: LLMResult }
    | ({ kind: 'error' } & MappedError)
  > {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new LocalTimeoutError(timeoutMs))
      }, timeoutMs)
    })

    let completion: Groq.Chat.ChatCompletion
    try {
      const call = this.#client.chat.completions.create(
        {
          model,
          // system → dedicated system message; userContent → separate user message.
          // Never concatenated: userContent is treated as potentially adversarial.
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.userContent },
          ],
          max_completion_tokens: maxTokens,
          reasoning_effort: this.#reasoningEffort,
          include_reasoning: false,
          stream: false,
        },
        { timeout: timeoutMs, maxRetries: 0, signal: controller.signal },
      )
      completion = await Promise.race([call, timeout])
    } catch (err) {
      return { kind: 'error', ...this.#mapError(err) }
    } finally {
      clearTimeout(timer)
    }

    return { kind: 'result', result: interpretCompletion(completion) }
  }

  #mapError(err: unknown): MappedError {
    const redact = (msg: string) => redactSecrets(msg, this.#apiKey)

    if (err instanceof LocalTimeoutError || err instanceof APIConnectionTimeoutError) {
      return { error: { code: 'LLM_TIMEOUT', message: redact(err.message) }, status: undefined, retryAfterMs: null }
    }

    if (err instanceof APIError) {
      const status = err.status
      const msg = redact(err.message)
      const providerCode = extractProviderCode(err.error)
      const retryAfterMs = parseRetryAfter(err.headers)
      const retrySuffix = retryAfterMs !== null ? ` (retry-after=${retryAfterMs}ms)` : ''
      const mk = (code: LLMError['code'], label: string): MappedError => ({
        error: { code, message: `Groq ${label} (${status ?? 'n/a'}): ${msg}${retrySuffix}` },
        status,
        retryAfterMs,
      })

      if (status === 408) return mk('LLM_TIMEOUT', 'timeout')
      if (status === 429) return mk('LLM_QUOTA_EXCEEDED', 'rate limit/quota')
      if (status === 401 || status === 403) return mk('LLM_AUTH_ERROR', 'auth error')
      if (status === 404) return mk('LLM_MODEL_UNAVAILABLE', 'model not found')
      if (providerCode === 'model_not_found' || providerCode === 'model_decommissioned') {
        return mk('LLM_MODEL_UNAVAILABLE', 'model unavailable')
      }
      if (providerCode === 'json_validate_failed') return mk('LLM_SCHEMA_VIOLATION', 'invalid JSON output')
      return mk('LLM_PROVIDER_UNAVAILABLE', 'API error')
    }

    const msg = err instanceof Error ? err.message : String(err)
    return {
      error: { code: 'LLM_PROVIDER_UNAVAILABLE', message: `Unexpected Groq error: ${redact(msg)}` },
      status: undefined,
      retryAfterMs: null,
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

class LocalTimeoutError extends Error {
  constructor(ms: number) {
    super(`Groq timeout after ${ms}ms`)
    this.name = 'LocalTimeoutError'
  }
}

function fail(code: LLMError['code'], message: string): LLMResult {
  return { ok: false, error: { code, message } }
}

export function assertSupportedModel(model: string): void {
  if (!GROQ_SUPPORTED_MODELS.includes(model)) {
    throw new Error(
      `Groq model "${model}" is not supported. Supported: ${GROQ_SUPPORTED_MODELS.join(', ')}.`,
    )
  }
}

function interpretCompletion(completion: Groq.Chat.ChatCompletion): LLMResult {
  const choice = completion.choices?.[0]
  const content = choice?.message?.content ?? ''
  const finish = choice?.finish_reason

  if (finish === 'length') {
    return fail(
      'LLM_SCHEMA_VIOLATION',
      content.trim() === ''
        ? 'Groq response truncated with empty content (finish_reason=length): reasoning consumed the token budget.'
        : 'Groq response truncated (finish_reason=length): output is incomplete.',
    )
  }

  if (!choice || content.trim() === '') {
    return fail('LLM_EMPTY_RESPONSE', 'Empty or missing content in Groq response')
  }

  if (finish !== 'stop') {
    return fail('LLM_SCHEMA_VIOLATION', `Unexpected Groq finish_reason=${String(finish)}`)
  }

  const total = completion.usage?.total_tokens
  return {
    ok: true,
    content,
    tokensUsed: typeof total === 'number' && total > 0 ? total : undefined,
  }
}

function extractProviderCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const b = body as { code?: unknown; error?: { code?: unknown } }
  const code = b.error?.code ?? b.code
  return typeof code === 'string' ? code : undefined
}

function parseRetryAfter(headers: unknown): number | null {
  const get = (headers as { get?: (n: string) => string | null } | undefined)?.get
  if (typeof get !== 'function') return null
  const ms = get.call(headers, 'retry-after-ms')
  if (ms) {
    const v = Number.parseFloat(ms)
    if (Number.isFinite(v) && v >= 0) return Math.round(v)
  }
  const s = get.call(headers, 'retry-after')
  if (s) {
    const v = Number.parseFloat(s)
    if (Number.isFinite(v) && v >= 0) return Math.round(v * 1000)
    const date = Date.parse(s)
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  }
  return null
}

/** Removes the configured key and any gsk_-prefixed token; caps length. */
function redactSecrets(message: string, apiKey: string): string {
  let out = apiKey ? message.split(apiKey).join('[REDACTED]') : message
  out = out.replace(/gsk_[A-Za-z0-9_-]{6,}/g, '[REDACTED]')
  return out.length > 300 ? `${out.slice(0, 300)}…` : out
}
