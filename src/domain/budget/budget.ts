import { z } from 'zod'
import { MoneySchema, MAX_AMOUNT_MINOR_UNIT } from './money'

// A-01: BudgetLine discriminated union — Confirmed vs Missing
export const BudgetLineConfirmedSchema = z.object({
  status: z.literal('confirmed'),
  description: z.string().min(1).max(200),
  amountMinorUnit: z.number().int().nonnegative().max(MAX_AMOUNT_MINOR_UNIT),
  currency: MoneySchema.shape.currency,
})
export type BudgetLineConfirmed = z.infer<typeof BudgetLineConfirmedSchema>

export const BudgetLineMissingSchema = z.object({
  status: z.literal('missing'),
  description: z.string().min(1).max(200),
})
export type BudgetLineMissing = z.infer<typeof BudgetLineMissingSchema>

export const BudgetLineSchema = z.discriminatedUnion('status', [
  BudgetLineConfirmedSchema,
  BudgetLineMissingSchema,
])
export type BudgetLine = z.infer<typeof BudgetLineSchema>

// A-02: Budget parse completeness states
export type BudgetCompletenessStatus = 'COMPLETE' | 'PARTIAL' | 'INVALID'

export interface BudgetParseState {
  lines: BudgetLine[]
  declaredTotalMinorUnit: number | null
  currency: BudgetLineConfirmed['currency'] | null
  computedTotal: number | null
  computedTotalIsPartial: boolean
  completenessStatus: BudgetCompletenessStatus
  discrepancy: boolean | null
}

// D-3: Totalization uses integer reduce only — no floats
export function computeTotal(lines: BudgetLine[]): {
  total: number
  isPartial: boolean
} {
  const confirmed = lines.filter((l): l is BudgetLineConfirmed => l.status === 'confirmed')
  const isPartial = confirmed.length < lines.length
  const total = confirmed.reduce((acc, line) => acc + line.amountMinorUnit, 0)
  return { total, isPartial }
}

// A-01/A-02: Determine COMPLETE/PARTIAL/INVALID
// NEVER compare partial subtotal against declaredTotal
export function determineBudgetState(
  lines: BudgetLine[],
  declaredTotalMinorUnit: number | null,
  currency: BudgetLineConfirmed['currency'] | null,
): BudgetParseState {
  if (lines.length === 0) {
    return {
      lines,
      declaredTotalMinorUnit,
      currency,
      computedTotal: null,
      computedTotalIsPartial: false,
      completenessStatus: 'INVALID',
      discrepancy: null,
    }
  }

  // Arch-Q5: Mixed currencies across confirmed lines produce a meaningless total.
  const confirmedForCurrencyCheck = lines.filter((l): l is BudgetLineConfirmed => l.status === 'confirmed')
  const currencySet = new Set(confirmedForCurrencyCheck.map((l) => l.currency))
  if (currencySet.size > 1) {
    return {
      lines,
      declaredTotalMinorUnit,
      currency,
      computedTotal: null,
      computedTotalIsPartial: false,
      completenessStatus: 'INVALID',
      discrepancy: null,
    }
  }

  const { total, isPartial } = computeTotal(lines)

  if (isPartial) {
    // A-01: PARTIAL — do NOT compare with declaredTotal
    return {
      lines,
      declaredTotalMinorUnit,
      currency,
      computedTotal: total,
      computedTotalIsPartial: true,
      completenessStatus: 'PARTIAL',
      discrepancy: null,
    }
  }

  // All lines confirmed → COMPLETE
  const discrepancy =
    declaredTotalMinorUnit !== null ? total !== declaredTotalMinorUnit : null

  return {
    lines,
    declaredTotalMinorUnit,
    currency,
    computedTotal: total,
    computedTotalIsPartial: false,
    completenessStatus: 'COMPLETE',
    discrepancy,
  }
}
