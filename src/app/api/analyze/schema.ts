// Shared types for POST /api/analyze — no domain internals exposed to client.
// Import this file from both the route handler and client components.

// ── Request ───────────────────────────────────────────────────────────────

export interface ApiVehicleInput {
  make?: string
  model?: string
  year?: number
  vehicleType?: 'sedan' | 'hatchback' | 'suv' | 'pickup' | 'van' | 'motorcycle' | 'other'
  fuelType?: 'gasoline' | 'diesel' | 'gnc' | 'hybrid' | 'electric' | 'other'
}

export interface AnalyzeRequest {
  userText: string
  vehicle?: ApiVehicleInput
  experienceLevel?: 'novice' | 'intermediate' | 'experienced' | 'unknown'
}

// ── Severity assessment ───────────────────────────────────────────────────
// Computed server-side from userText after safetyBlocked=false.
// null means severity is 'normal' — no banner should be shown.

export interface SeverityAssessmentResult {
  level: 'normal' | 'high' | 'critical'
  title: string
  message: string
  action: string
}

// ── AI processing status (6.4E) ───────────────────────────────────────────
// Which processing produced the response — derived server-side (ai-status.ts), never by the LLM.
// The badge shown to the user is rendered from this field only.

export type AiUnavailableReason = 'visitor_limit' | 'daily_quota' | 'busy' | 'disabled' | 'provider_error'

export type AiStatus =
  | { mode: 'ai' }
  | { mode: 'simulated' }
  | { mode: 'withheld' }
  | { mode: 'unavailable'; reason: AiUnavailableReason }
  | { mode: 'none' }

// ── Response: success (200) ────────────────────────────────────────────────

export interface NodeTraceSummary {
  nodeId: string
  status: 'success' | 'fallback_used' | 'blocked' | 'skipped' | 'error'
  durationMs: number
  timestamp: string
  llmCalled: boolean
  retryCount: number
  fallbackActivated: boolean
  errorCode?: string
  policyVersion?: string
  resultType?: string
  tokensUsed?: number
  schemaIssues?: string[]
  dataLabel: 'synthetic_demo' | 'user_input' | 'unknown'
}

export interface ClientHypothesis {
  statement: string
  confidence: 'low' | 'medium' | 'high'
  caveats: string[]
}

export interface ClientBudgetOutput {
  completenessStatus: 'COMPLETE' | 'PARTIAL' | 'INVALID'
  computedTotalMinorUnit: number | null
  computedTotalIsPartial: boolean
  currency: string | null
  discrepancy: boolean | null
  lineCount: number
  missingLineCount: number
}

export interface ClientAnalyzeOutput {
  caseId: string
  safetyBlocked: boolean
  safetyDerivationMessage: string | null
  policyVersion: string
  coverageDisclaimer: string
  route: 'symptom' | 'budget' | 'clarification' | null
  facts: string[]
  hypotheses: ClientHypothesis[]
  questions: string[]
  warnings: string[]
  budget: ClientBudgetOutput | null
  missingInformation: string[]
  fallback: boolean
  fallbackText: string | null
  // Simplified trace for DEV mode only; null in production
  nodeTrace: NodeTraceSummary[] | null
  // Severity assessment — null means normal (no banner). Computed server-side, never from LLM.
  severity: SeverityAssessmentResult | null
  /**
   * 6.4E — additive field. What actually processed this request (real AI, stub, withheld,
   * unavailable). Optional in the type so clients tolerate servers that predate it.
   */
  aiStatus?: AiStatus
}

// ── Response: errors ──────────────────────────────────────────────────────

export interface SafetyBlockPayload {
  error: 'SAFETY_BLOCKED'
  safetyBlocked: true
  safetyDerivationMessage: string
  policyVersion: string
  coverageDisclaimer: string
  /**
   * 6.4B (D-02) — additive, backward-compatible field. Deterministic critical warning when the
   * blocked query describes loss of braking capacity ("No conduzcas el vehículo…"); null otherwise.
   * Optional in the type so clients tolerate servers that predate it.
   */
  severity?: SeverityAssessmentResult | null
}

export type AnalyzeApiError =
  | { error: 'VALIDATION_ERROR'; message: string }
  | SafetyBlockPayload
  | { error: 'RATE_LIMIT'; message: string }
  | { error: 'INTERNAL_ERROR'; message: string }
