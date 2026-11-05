import { describe, it, expect } from 'vitest'
import { CaseStateSchema } from './case'

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000'

describe('CaseStateSchema — C-01: contrato central del dominio', () => {
  it('acepta CaseState mínimo con solo caseId', () => {
    const result = CaseStateSchema.safeParse({ caseId: VALID_UUID })
    expect(result.success).toBe(true)
  })

  it('rechaza caseId que no es UUID', () => {
    const result = CaseStateSchema.safeParse({ caseId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rechaza CaseState sin caseId', () => {
    const result = CaseStateSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('acepta CaseState con vehicle completo', () => {
    const result = CaseStateSchema.safeParse({
      caseId: VALID_UUID,
      vehicle: { make: 'Toyota', model: 'Corolla', year: 2018, fuelType: 'gasoline' },
    })
    expect(result.success).toBe(true)
  })

  it('acepta CaseState con budget COMPLETE', () => {
    const result = CaseStateSchema.safeParse({
      caseId: VALID_UUID,
      budget: {
        lines: [{ status: 'confirmed', description: 'Repuesto', amountMinorUnit: 10000, currency: 'ARS' }],
        computedTotalIsPartial: false,
        completenessStatus: 'COMPLETE',
        discrepancy: false,
      },
    })
    expect(result.success).toBe(true)
  })

  it('acepta CaseState con safety bloqueado', () => {
    const result = CaseStateSchema.safeParse({
      caseId: VALID_UUID,
      safety: {
        blocked: true,
        triggeredCategory: 'brakes',
        triggeredSignal: 'perdida de frenos',
        intentClassification: 'diy_intent',
        policyVersion: '1.0.0',
        coverageDisclaimer: 'disclaimer',
      },
    })
    expect(result.success).toBe(true)
  })

  it('acepta CaseState con fallback: true', () => {
    const result = CaseStateSchema.safeParse({ caseId: VALID_UUID, fallback: true })
    expect(result.success).toBe(true)
  })

  it('rechaza intentClassification con valor desconocido', () => {
    const result = CaseStateSchema.safeParse({
      caseId: VALID_UUID,
      safety: {
        blocked: false,
        triggeredCategory: null,
        triggeredSignal: null,
        intentClassification: 'unknown_value',
        policyVersion: '1.0.0',
        coverageDisclaimer: 'disclaimer',
      },
    })
    expect(result.success).toBe(false)
  })

  it('rechaza completenessStatus con valor desconocido', () => {
    const result = CaseStateSchema.safeParse({
      caseId: VALID_UUID,
      budget: {
        lines: [],
        computedTotalIsPartial: false,
        completenessStatus: 'UNKNOWN',
        discrepancy: null,
      },
    })
    expect(result.success).toBe(false)
  })
})
