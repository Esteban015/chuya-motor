import { z } from 'zod'
import { VehicleSchema } from '../vehicle/vehicle'
import { MoneySchema } from '../budget/money'
import { BudgetLineSchema } from '../budget/budget'

const BudgetCompletenessStatusSchema = z.enum(['COMPLETE', 'PARTIAL', 'INVALID'])

const IntentClassificationSchema = z.enum([
  'professional_context',
  'diy_intent',
  'past_description',
  'informational',
  'ambiguous',
])

export const CaseStateSchema = z.object({
  caseId: z.string().uuid(),
  vehicle: VehicleSchema.optional(),
  budget: z
    .object({
      lines: z.array(BudgetLineSchema),
      declaredTotal: MoneySchema.optional(),
      computedTotal: MoneySchema.optional(),
      computedTotalIsPartial: z.boolean(),
      completenessStatus: BudgetCompletenessStatusSchema,
      discrepancy: z.boolean().nullable(),
    })
    .optional(),
  safety: z
    .object({
      blocked: z.boolean(),
      triggeredCategory: z.string().nullable(),
      triggeredSignal: z.string().nullable(),
      intentClassification: IntentClassificationSchema,
      policyVersion: z.string(),
      coverageDisclaimer: z.string(),
    })
    .optional(),
  fallback: z.boolean().optional(),
})

export type CaseState = z.infer<typeof CaseStateSchema>
