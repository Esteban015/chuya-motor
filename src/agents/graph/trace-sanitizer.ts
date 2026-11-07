// Fase 3 — Centralized trace sanitization.
// Allowlist-based: only explicitly listed structural fields pass through.
// Applied BEFORE storage, transport, or logging — never at render time only.
//
// Security invariants:
//   - userText, prompt content, PII, stack traces → never in output
//   - errorCode is a structured code (never free-text from user input)
//   - traceId (=caseId) is a UUID — correlation only, not linked to user identity
//   - tokensUsed is a numeric count — no content
import type { TraceMetadata } from './trace'

export interface SafeTraceData {
  nodeId: string
  status: 'success' | 'fallback_used' | 'blocked' | 'skipped' | 'error'
  durationMs: number
  timestamp: string
  llmCalled: boolean
  llmModel?: string
  retryCount: number
  fallbackActivated: boolean
  errorCode?: string
  policyVersion?: string
  resultType?: string
  tokensUsed?: number
  dataLabel: 'synthetic_demo' | 'user_input' | 'unknown'
}

// Allowlist: explicit set of safe field names on TraceMetadata.
// Any field not listed here is dropped — no dynamic key access.
export function sanitizeTrace(trace: TraceMetadata): SafeTraceData {
  const safe: SafeTraceData = {
    nodeId: trace.nodeId,
    status: trace.status,
    durationMs: trace.durationMs,
    timestamp: trace.timestamp,
    llmCalled: trace.llmCalled,
    retryCount: trace.retryCount,
    fallbackActivated: trace.fallbackActivated,
    dataLabel: trace.dataLabel,
  }

  if (trace.llmModel !== undefined) safe.llmModel = trace.llmModel
  if (trace.errorCode !== undefined) safe.errorCode = trace.errorCode
  if (trace.policyVersion !== undefined) safe.policyVersion = trace.policyVersion
  if (trace.resultType !== undefined) safe.resultType = trace.resultType
  if (trace.tokensUsed !== undefined) safe.tokensUsed = trace.tokensUsed

  return safe
}

export function sanitizeTraces(traces: TraceMetadata[]): SafeTraceData[] {
  return traces.map(sanitizeTrace)
}

// Compute total wall-clock duration from first to last trace (ms).
// Returns 0 when fewer than two traces are available.
export function totalDurationMs(traces: SafeTraceData[]): number {
  if (traces.length < 2) return traces[0]?.durationMs ?? 0
  const sorted = [...traces].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  )
  const first = new Date(sorted[0]!.timestamp).getTime()
  const last = new Date(sorted[sorted.length - 1]!.timestamp).getTime()
  const lastDuration = sorted[sorted.length - 1]!.durationMs
  return last - first + lastDuration
}
