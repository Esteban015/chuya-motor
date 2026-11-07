import { z } from 'zod'

export const ScenarioCategorySchema = z.enum(['symptom', 'budget', 'safety', 'ambiguous'])
export type ScenarioCategory = z.infer<typeof ScenarioCategorySchema>

export const ScenarioSeveritySchema = z.enum(['low', 'medium', 'high', 'critical'])
export type ScenarioSeverity = z.infer<typeof ScenarioSeveritySchema>

export const ScenarioInputSchema = z.object({
  userText: z.string().min(10).max(2000),
  vehicle: z
    .object({
      make: z.string().optional(),
      model: z.string().optional(),
      year: z.number().int().min(1900).max(2100).optional(),
      vehicleType: z
        .enum(['sedan', 'hatchback', 'suv', 'pickup', 'van', 'motorcycle', 'other'])
        .optional(),
      fuelType: z
        .enum(['gasoline', 'diesel', 'gnc', 'hybrid', 'electric', 'other'])
        .optional(),
    })
    .optional(),
  experienceLevel: z
    .enum(['novice', 'intermediate', 'experienced', 'unknown'])
    .optional(),
})
export type ScenarioInput = z.infer<typeof ScenarioInputSchema>

export const ScenarioExpectedSchema = z.object({
  safetyBlocked: z.boolean(),
  route: z.enum(['symptom', 'budget', 'clarification']).nullable().optional(),
  fallback: z.boolean().optional(),
  budgetCompleteness: z.enum(['COMPLETE', 'PARTIAL', 'INVALID']).optional(),
  discrepancy: z.boolean().optional(),
})
export type ScenarioExpected = z.infer<typeof ScenarioExpectedSchema>

export const ScenarioEvaluationSchema = z.object({
  deterministic: z.array(z.string()),
  requiresHumanReview: z.boolean(),
  reviewNotes: z.string().optional(),
})
export type ScenarioEvaluation = z.infer<typeof ScenarioEvaluationSchema>

export const ScenarioSecuritySchema = z.object({
  mustNotContain: z.array(z.string()),
  mustNotLeakCredentials: z.boolean(),
  expectsSafetyBlock: z.boolean(),
})
export type ScenarioSecurity = z.infer<typeof ScenarioSecuritySchema>

export const BenchmarkScenarioSchema = z.object({
  id: z.string().regex(/^[A-Z]+-\d{3}$/, 'ID must be like SYM-001'),
  version: z.string(),
  category: ScenarioCategorySchema,
  severity: ScenarioSeveritySchema,
  description: z.string().min(10),
  input: ScenarioInputSchema,
  expected: ScenarioExpectedSchema,
  evaluation: ScenarioEvaluationSchema,
  security: ScenarioSecuritySchema,
  tags: z.array(z.string()),
})
export type BenchmarkScenario = z.infer<typeof BenchmarkScenarioSchema>

export const DATASET_VERSION = '1.0.0'
