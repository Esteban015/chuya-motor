import { z } from 'zod'
import { VehicleSchema } from '@/domain/vehicle/vehicle'

export const AnalyzeInputSchema = z.object({
  caseId: z.string().uuid('caseId must be a valid UUID'),
  userText: z
    .string()
    .min(10, 'userText must be at least 10 characters')
    .max(2000, 'userText must be at most 2000 characters'),
  vehicle: VehicleSchema.optional(),
  experienceLevel: z
    .enum(['novice', 'intermediate', 'experienced', 'unknown'])
    .default('unknown'),
  dataLabel: z.enum(['synthetic_demo', 'user_input']),
})
export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>

export const HypothesisSchema = z.object({
  statement: z.string().min(1).max(500),
  confidence: z.enum(['low', 'medium', 'high']),
  caveats: z.array(z.string().max(200)).max(10),
  evidenceIds: z.array(z.string().max(100)).max(20),
})
export type Hypothesis = z.infer<typeof HypothesisSchema>

export const BudgetOutputSchema = z.object({
  completenessStatus: z.enum(['COMPLETE', 'PARTIAL', 'INVALID']),
  computedTotalMinorUnit: z.number().int().nonnegative().nullable(),
  computedTotalIsPartial: z.boolean(),
  currency: z.string().nullable(),
  discrepancy: z.boolean().nullable(),
  lineCount: z.number().int().nonnegative(),
  missingLineCount: z.number().int().nonnegative(),
})
export type BudgetOutput = z.infer<typeof BudgetOutputSchema>

export const AnalyzeOutputSchema = z.object({
  caseId: z.string().uuid(),
  safetyBlocked: z.boolean(),
  safetyDerivationMessage: z.string().nullable(),
  policyVersion: z.string(),
  coverageDisclaimer: z.string(),
  route: z.enum(['symptom', 'budget', 'clarification']).nullable(),
  facts: z.array(z.string().max(500)),
  hypotheses: z.array(HypothesisSchema),
  /** Questions the person can ask the workshop (mechanic-directed). */
  questions: z.array(z.string().max(300)),
  /** Bugfix 7B — additive: clarifying questions for the driver (to prepare the consultation). */
  driverQuestions: z.array(z.string().max(300)).optional(),
  warnings: z.array(z.string().max(300)),
  budget: BudgetOutputSchema.nullable(),
  missingInformation: z.array(z.string().max(300)),
  fallback: z.boolean(),
  fallbackText: z.string().nullable(),
  traces: z.array(z.any()),
})
export type AnalyzeOutput = z.infer<typeof AnalyzeOutputSchema>
