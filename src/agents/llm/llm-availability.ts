/**
 * llm-availability.ts — Fixed user-facing notices when the LLM protection layer refuses a call
 * (Incremento 6.4D; reasons split in 6.4E). Deterministic text, never LLM-generated. Distinguishable from:
 *   - OUTPUT_WITHHELD_WARNING (the answer existed but failed output safety validation);
 *   - a plain provider failure (fallback without these notices);
 *   - the stub (not a fallback).
 * Deterministic Safety Gate / severity warnings are produced independently and always kept.
 */
import type { LLMError } from './llm-adapter'
import type { AiUnavailableReason } from '@/app/api/analyze/schema'

/** Kill switch, missing / failing quota store, invalid configuration. */
export const LLM_UNAVAILABLE_WARNING =
  'El análisis automático no está disponible en este momento. Las advertencias de seguridad se mantienen; consultá con un taller o mecánico habilitado.'

/** Per-visitor quota (6.4E). */
export const LLM_VISITOR_LIMIT_WARNING =
  'Alcanzaste el límite de consultas con IA del piloto para este período. Probá de nuevo más tarde. Las advertencias de seguridad se mantienen; ante dudas, consultá con un taller o mecánico habilitado.'

/** Shared daily analysis / call / token budget of the pilot (6.4E). */
export const LLM_DAILY_QUOTA_WARNING =
  'El piloto con IA alcanzó su cupo de consultas por hoy. Probá de nuevo mañana. Las advertencias de seguridad se mantienen; ante dudas, consultá con un taller o mecánico habilitado.'

/** Concurrency limit or shared provider cooldown (6.4E). */
export const LLM_BUSY_WARNING =
  'El servicio de IA está ocupado en este momento. Probá de nuevo en unos minutos. Las advertencias de seguridad se mantienen.'

export const PROTECTION_ERROR_CODES: ReadonlySet<LLMError['code']> = new Set<LLMError['code']>([
  'LLM_DISABLED',
  'LLM_PROVIDER_COOLDOWN',
  'LLM_CALL_LIMIT',
  'LLM_BUDGET_EXHAUSTED',
  'LLM_BUSY',
  'LLM_GUARD_UNAVAILABLE',
  'LLM_CLIENT_LIMIT',
])

/** Why the service is unavailable, as shown to the user (aiStatus.reason). */
export type { AiUnavailableReason }

export function unavailableReasonFor(code: string | null | undefined): AiUnavailableReason {
  switch (code) {
    case 'LLM_CLIENT_LIMIT':
      return 'visitor_limit'
    case 'LLM_BUDGET_EXHAUSTED':
      return 'daily_quota'
    case 'LLM_BUSY':
    case 'LLM_PROVIDER_COOLDOWN':
    case 'LLM_CALL_LIMIT':
      return 'busy'
    case 'LLM_DISABLED':
    case 'LLM_GUARD_UNAVAILABLE':
      return 'disabled'
    default:
      return 'provider_error'
  }
}

const WARNING_BY_REASON: Record<Exclude<AiUnavailableReason, 'provider_error'>, string> = {
  visitor_limit: LLM_VISITOR_LIMIT_WARNING,
  daily_quota: LLM_DAILY_QUOTA_WARNING,
  busy: LLM_BUSY_WARNING,
  disabled: LLM_UNAVAILABLE_WARNING,
}

/** Fixed notice for a protection-layer refusal; [] for provider errors (FallbackAlert covers them). */
export function availabilityWarnings(code: LLMError['code']): string[] {
  if (!PROTECTION_ERROR_CODES.has(code)) return []
  const reason = unavailableReasonFor(code)
  return reason === 'provider_error' ? [] : [WARNING_BY_REASON[reason]]
}
