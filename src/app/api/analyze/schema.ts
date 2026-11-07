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
}

// ── Response: errors ──────────────────────────────────────────────────────

export interface SafetyBlockPayload {
  error: 'SAFETY_BLOCKED'
  safetyBlocked: true
  safetyDerivationMessage: string
  policyVersion: string
  coverageDisclaimer: string
}

export type AnalyzeApiError =
  | { error: 'VALIDATION_ERROR'; message: string }
  | SafetyBlockPayload
  | { error: 'RATE_LIMIT'; message: string }
  | { error: 'INTERNAL_ERROR'; message: string }
