import { describe, it, expect } from 'vitest'
import { determineBudgetState, computeTotal, BudgetLineConfirmedSchema } from './budget'
import { MoneySchema, MAX_AMOUNT_MINOR_UNIT } from './money'
import type { BudgetLine } from './budget'

const confirmedLine = (description: string, amountMinorUnit: number): BudgetLine => ({
  status: 'confirmed',
  description,
  amountMinorUnit,
  currency: 'ARS',
})

const missingLine = (description: string): BudgetLine => ({
  status: 'missing',
  description,
})

describe('computeTotal', () => {
  it('suma solo líneas confirmadas con enteros', () => {
    const lines: BudgetLine[] = [
      confirmedLine('Mano de obra', 10000_00),
      confirmedLine('Repuesto', 5000_00),
    ]
    const { total, isPartial } = computeTotal(lines)
    expect(total).toBe(15000_00)
    expect(isPartial).toBe(false)
  })

  it('marca isPartial cuando hay líneas faltantes', () => {
    const lines: BudgetLine[] = [confirmedLine('Mano de obra', 10000_00), missingLine('Repuesto')]
    const { isPartial } = computeTotal(lines)
    expect(isPartial).toBe(true)
  })

  it('retorna 0 sin líneas confirmadas', () => {
    const { total } = computeTotal([missingLine('Diagnóstico')])
    expect(total).toBe(0)
  })
})

describe('determineBudgetState — U-01-B-COMPLETE', () => {
  it('COMPLETE sin discrepancia cuando total coincide', () => {
    const lines: BudgetLine[] = [
      confirmedLine('Mano de obra', 10000_00),
      confirmedLine('Repuesto', 5000_00),
    ]
    const state = determineBudgetState(lines, 15000_00, 'ARS')
    expect(state.completenessStatus).toBe('COMPLETE')
    expect(state.computedTotal).toBe(15000_00)
    expect(state.computedTotalIsPartial).toBe(false)
    expect(state.discrepancy).toBe(false)
  })

  it('COMPLETE con discrepancia cuando totales no coinciden (I-04-E)', () => {
    const lines: BudgetLine[] = [
      confirmedLine('Mano de obra', 10000_00),
      confirmedLine('Repuesto', 5000_00),
    ]
    const state = determineBudgetState(lines, 20000_00, 'ARS')
    expect(state.completenessStatus).toBe('COMPLETE')
    expect(state.discrepancy).toBe(true)
  })

  it('COMPLETE con discrepancy null cuando no hay total declarado', () => {
    const lines: BudgetLine[] = [confirmedLine('Repuesto', 5000_00)]
    const state = determineBudgetState(lines, null, 'ARS')
    expect(state.completenessStatus).toBe('COMPLETE')
    expect(state.discrepancy).toBeNull()
  })
})

describe('determineBudgetState — U-01-B-PARTIAL', () => {
  it('PARTIAL cuando hay líneas faltantes — NO compara contra declaredTotal', () => {
    const lines: BudgetLine[] = [
      confirmedLine('Mano de obra', 10000_00),
      missingLine('Repuesto desconocido'),
    ]
    const state = determineBudgetState(lines, 20000_00, 'ARS')
    expect(state.completenessStatus).toBe('PARTIAL')
    expect(state.computedTotalIsPartial).toBe(true)
    // A-01: discrepancy must be null for PARTIAL — never compare partial subtotal to declaredTotal
    expect(state.discrepancy).toBeNull()
    expect(state.computedTotal).toBe(10000_00)
  })
})

describe('determineBudgetState — U-01-B-INVALID', () => {
  it('INVALID cuando no hay líneas', () => {
    const state = determineBudgetState([], null, null)
    expect(state.completenessStatus).toBe('INVALID')
    expect(state.computedTotal).toBeNull()
    expect(state.discrepancy).toBeNull()
  })

  it('INVALID cuando hay líneas confirmadas con monedas mixtas (Arch-Q5)', () => {
    const lines: BudgetLine[] = [
      confirmedLine('Mano de obra ARS', 10000_00),
      { status: 'confirmed', description: 'Repuesto USD', amountMinorUnit: 200_00, currency: 'USD' },
    ]
    const state = determineBudgetState(lines, null, 'ARS')
    expect(state.completenessStatus).toBe('INVALID')
    expect(state.computedTotal).toBeNull()
  })
})

describe('Budget — límites y casos borde (B-01, B-04, B-05, B-06, B-07)', () => {
  it('B-01: amountMinorUnit = 0 es válido y confirmado', () => {
    const result = BudgetLineConfirmedSchema.safeParse({
      status: 'confirmed',
      description: 'Diagnóstico',
      amountMinorUnit: 0,
      currency: 'ARS',
    })
    expect(result.success).toBe(true)
  })

  it('B-04: amountMinorUnit en límite exacto MAX_AMOUNT_MINOR_UNIT es válido', () => {
    const result = BudgetLineConfirmedSchema.safeParse({
      status: 'confirmed',
      description: 'Item límite',
      amountMinorUnit: MAX_AMOUNT_MINOR_UNIT,
      currency: 'ARS',
    })
    expect(result.success).toBe(true)
  })

  it('B-04: amountMinorUnit superior a MAX_AMOUNT_MINOR_UNIT es rechazado', () => {
    const result = BudgetLineConfirmedSchema.safeParse({
      status: 'confirmed',
      description: 'Item excesivo',
      amountMinorUnit: MAX_AMOUNT_MINOR_UNIT + 1,
      currency: 'ARS',
    })
    expect(result.success).toBe(false)
  })

  it('B-05: float es rechazado por .int()', () => {
    const result = BudgetLineConfirmedSchema.safeParse({
      status: 'confirmed',
      description: 'Float inválido',
      amountMinorUnit: 10.5,
      currency: 'ARS',
    })
    expect(result.success).toBe(false)
  })

  it('B-06: amountMinorUnit negativo es rechazado', () => {
    const result = BudgetLineConfirmedSchema.safeParse({
      status: 'confirmed',
      description: 'Negativo inválido',
      amountMinorUnit: -1,
      currency: 'ARS',
    })
    expect(result.success).toBe(false)
  })

  it('B-02: moneda no soportada es rechazada', () => {
    const result = MoneySchema.safeParse({ amountMinorUnit: 100, currency: 'EUR' })
    expect(result.success).toBe(false)
  })

  it('B-07: solo líneas missing → PARTIAL (no INVALID)', () => {
    const lines: BudgetLine[] = [missingLine('Repuesto A'), missingLine('Repuesto B')]
    const state = determineBudgetState(lines, null, null)
    expect(state.completenessStatus).toBe('PARTIAL')
    expect(state.computedTotalIsPartial).toBe(true)
    expect(state.computedTotal).toBe(0)
  })
})
