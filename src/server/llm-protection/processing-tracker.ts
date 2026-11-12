/**
 * processing-tracker.ts — Records what actually processed one request (Incremento 6.4E).
 *
 * Wraps the adapter handed to the graph (stub, guarded real adapter or unavailable adapter) and
 * keeps structural facts only: kind of adapter, attempts, successes and the last error code. No
 * prompt, user text or provider content is retained. The route derives aiStatus from it, so the
 * badge shown to the user always matches the provider that processed the request.
 */
import type { LLMAdapter, LLMCompletionRequest, LLMError, LLMResult } from '@/agents/llm/llm-adapter'

export type ProcessingKind = 'stub' | 'real'

export interface ProcessingSnapshot {
  kind: ProcessingKind
  attempts: number
  succeeded: number
  lastErrorCode: LLMError['code'] | null
}

export class TrackedLLMAdapter implements LLMAdapter {
  readonly #inner: LLMAdapter
  readonly #kind: ProcessingKind
  #attempts = 0
  #succeeded = 0
  #lastErrorCode: LLMError['code'] | null = null

  constructor(inner: LLMAdapter, kind: ProcessingKind) {
    this.#inner = inner
    this.#kind = kind
  }

  get modelId(): string {
    return this.#inner.modelId
  }

  toJSON(): Record<string, unknown> {
    return { tracked: true, kind: this.#kind }
  }

  async complete(req: LLMCompletionRequest): Promise<LLMResult> {
    this.#attempts++
    const result = await this.#inner.complete(req)
    if (result.ok) this.#succeeded++
    else this.#lastErrorCode = result.error.code
    return result
  }

  snapshot(): ProcessingSnapshot {
    return { kind: this.#kind, attempts: this.#attempts, succeeded: this.#succeeded, lastErrorCode: this.#lastErrorCode }
  }
}
