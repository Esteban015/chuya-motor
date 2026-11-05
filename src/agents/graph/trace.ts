// Ajuste C (DECISIONS.md): TraceMetadata — structural fields only.
// NEVER include: user text, prompt content, PII, free-text error messages, excerpts.
export interface TraceMetadata {
  traceId: string           // = caseId (correlation only, not persisted cross-request)
  nodeId: string
  timestamp: string         // ISO 8601 UTC
  durationMs: number
  status: 'success' | 'fallback_used' | 'blocked' | 'skipped' | 'error'
  llmCalled: boolean
  llmModel?: string         // present only when llmCalled === true
  retryCount: number
  policyVersion?: string    // present only in safetyGate node
  dataLabel: 'synthetic_demo' | 'user_input' | 'unknown'
  errorCode?: string        // structured code only; never free-text message
  fallbackActivated: boolean
}

export interface CreateTraceOptions {
  llmCalled?: boolean
  llmModel?: string
  retryCount?: number
  policyVersion?: string
  dataLabel?: TraceMetadata['dataLabel']
  errorCode?: string
  fallbackActivated?: boolean
}

export function createTrace(
  traceId: string,
  nodeId: string,
  startTime: number,
  status: TraceMetadata['status'],
  options: CreateTraceOptions = {},
): TraceMetadata {
  const trace: TraceMetadata = {
    traceId,
    nodeId,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    status,
    llmCalled: options.llmCalled ?? false,
    retryCount: options.retryCount ?? 0,
    dataLabel: options.dataLabel ?? 'unknown',
    fallbackActivated: options.fallbackActivated ?? false,
  }

  if (options.llmModel !== undefined) trace.llmModel = options.llmModel
  if (options.policyVersion !== undefined) trace.policyVersion = options.policyVersion
  if (options.errorCode !== undefined) trace.errorCode = options.errorCode

  // TRACE_VERBOSE: strict conjunction — only when explicitly enabled AND not production (Ajuste C)
  if (process.env['TRACE_VERBOSE'] === 'true' && process.env['NODE_ENV'] !== 'production') {
    console.debug('[TRACE]', JSON.stringify({ nodeId: trace.nodeId, status: trace.status, durationMs: trace.durationMs }))
  }

  return trace
}
