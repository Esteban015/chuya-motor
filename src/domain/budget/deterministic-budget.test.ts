/**
 * deterministic-budget.test.ts — Incremento 7E: budget reading without any LLM.
 * Integer minor units only; never invents amounts, quantities or categories.
 */
import { describe, expect, it } from 'vitest'
import { determineBudgetState } from './budget'
import { amountsWrittenIn, analysisFromLlmLines, analyzeBudgetText, breakdownByCategory, hasInterpretableItems, toBudgetLines } from './deterministic-budget'

const state = (text: string) => {
  const a = analyzeBudgetText(text)
  return { a, s: determineBudgetState(toBudgetLines(a), a.declaredTotalMinorUnit, 'ARS') }
}
const rows = (text: string) => analyzeBudgetText(text).items.map((i) => [i.description, i.category, i.status, i.amountMinorUnit])

describe('DB-01 reported example', () => {
  it('4 items, parts $8.000, labor $3.000, sum $11.000, declared $12.500, difference $1.500', () => {
    const { a, s } = state('Aceite motor: 4500\nFiltro de aire: 1500\nFiltro de aceite: 2000\nMano de obra: 3000\nTotal: 12500')
    expect(a.items).toHaveLength(4)
    expect(breakdownByCategory(a.items)).toEqual({ partMinorUnit: 800_000, laborMinorUnit: 300_000, otherMinorUnit: 0, unclassifiedMinorUnit: 0 })
    expect(s).toMatchObject({ completenessStatus: 'COMPLETE', computedTotal: 1_100_000, declaredTotalMinorUnit: 1_250_000, discrepancy: true })
    expect(hasInterpretableItems(a)).toBe(true)
  })
})

describe('DB-02 sums and totals', () => {
  it('correct sum → no discrepancy', () => {
    expect(state('Pastillas de freno: 18000\nMano de obra: 7000\nTotal: 25000').s).toMatchObject({ computedTotal: 2_500_000, discrepancy: false })
  })
  it('without declared total → sum only, discrepancy null', () => {
    const { a, s } = state('Pastillas de freno: 18000\nMano de obra: 7000')
    expect(a.declaredTotalMinorUnit).toBeNull()
    expect(s).toMatchObject({ completenessStatus: 'COMPLETE', computedTotal: 2_500_000, discrepancy: null })
  })
  it('two different "Total" lines → no declared total (conflict reported); Subtotal is never an item', () => {
    const { a } = state('Filtro de aire: 1500\nSubtotal: 1500\nTotal: 1500\nTotal: 1800')
    expect(a.items).toHaveLength(1)
    expect(a.declaredTotalMinorUnit).toBeNull()
    expect(a.notes).toContain('declared_total_conflict')
  })
  it('unreadable total → no declared total, reported', () => {
    const { a } = state('Filtro de aire: 1500\nTotal: 1,500.00')
    expect(a.declaredTotalMinorUnit).toBeNull()
    expect(a.notes).toContain('declared_total_unreadable')
  })
  it('no floating point drift: 0,10 + 0,20 = 0,30 exactly; large amounts are exact', () => {
    expect(state('Arandela: 0,10\nTornillo: 0,20\nTotal: 0,30').s).toMatchObject({ computedTotal: 30, discrepancy: false })
    expect(state('Motor de arranque: 1.234.567,89\nMano de obra: 0,11\nTotal: 1.234.568').s).toMatchObject({ computedTotal: 123_456_800, discrepancy: false })
  })
})

describe('DB-03 Argentine formats', () => {
  it('$1.500, 1500, 1.500,50, "$ 1.500", "= 1500" and "ARS"', () => {
    expect(rows('Filtro de aire: $1.500\nFiltro de aceite: 1500\nAceite: 1.500,50\nBujías $ 1.500\nCorrea = 1500 ARS').map((r) => r[3])).toEqual([150_000, 150_000, 150_050, 150_000, 150_000])
  })
  it('US / dot-decimal / 3-decimal formats are ambiguous: shown, never summed', () => {
    const { a, s } = state('Filtro de aire: 1,500.50\nFiltro de aceite: 15.00\nCorrea: 12,345')
    expect(a.items.every((i) => i.status === 'ambiguous' && i.issue === 'unreadable_amount' && i.amountMinorUnit === null)).toBe(true)
    expect(s.completenessStatus).toBe('PARTIAL')
  })
})

describe('DB-04 quantities, units, categories', () => {
  it('quantities are informative: the written amount is the line amount, never multiplied', () => {
    const a = analyzeBudgetText('Aceite 4 litros: 18000\n2 x Amortiguador delantero: 90000\nBujías x4: 8000')
    expect(a.items.map((i) => [i.quantity, i.amountMinorUnit])).toEqual([[4, 1_800_000], [2, 9_000_000], [4, 800_000]])
  })
  it('labor, other concepts and unknown concepts (never assumed to be parts)', () => {
    expect(rows('Mano de obra: 3000\nM.O.: 1000\nIVA: 2100\nInsumos: 500\nVarilla especial: 700').map((r) => r[1])).toEqual(['labor', 'labor', 'other', 'other', 'unclassified'])
    const b = breakdownByCategory(analyzeBudgetText('Filtro: 1000\nMano de obra: 3000\nIVA: 2100\nVarilla especial: 700').items)
    expect(b).toEqual({ partMinorUnit: 100_000, laborMinorUnit: 300_000, otherMinorUnit: 210_000, unclassifiedMinorUnit: 70_000 })
  })
  it('legitimate duplicate lines are both counted', () => {
    const { a, s } = state('Filtro de aire: 1500\nFiltro de aire: 1500\nTotal: 3000')
    expect(a.items).toHaveLength(2)
    expect(s).toMatchObject({ computedTotal: 300_000, discrepancy: false })
  })
})

describe('DB-05 missing and ambiguous amounts', () => {
  it('pending and recognizable items without price → partial sum, never compared with the total', () => {
    const { a, s } = state('Pastillas de freno: 18000\nDiscos de freno: a confirmar\nRectificación de discos\nTotal: 30000')
    expect(a.items.map((i) => i.status)).toEqual(['priced', 'pending', 'missing'])
    expect(s).toMatchObject({ completenessStatus: 'PARTIAL', computedTotal: 1_800_000, computedTotalIsPartial: true, discrepancy: null })
  })
  it('bare trailing number without separator is ambiguous (could be a part code)', () => {
    expect(analyzeBudgetText('Kit distribución Gates 5559\nMano de obra: 3000').items[0]).toMatchObject({ status: 'ambiguous', issue: 'amount_without_separator', amountMinorUnit: null })
  })
  it('discounts: sign unknown (maybe already applied) → shown with its amount, not summed', () => {
    const { a, s } = state('Filtro de aire: 1500\nDescuento: 500\nTotal: 1000')
    expect(a.items[1]).toMatchObject({ status: 'ambiguous', issue: 'discount_sign', amountMinorUnit: 50_000 })
    expect(s.completenessStatus).toBe('PARTIAL')
  })
  it('headers and comments without amount are notes, not items (a complete budget stays complete)', () => {
    const { a, s } = state('Presupuesto del taller:\nHola, te paso el detalle\nFiltro de aire: 1500\nTotal: 1500')
    expect(a.items).toHaveLength(1)
    expect(a.ignoredLineCount).toBe(2)
    expect(a.notes).toContain('text_not_interpreted')
    expect(s).toMatchObject({ completenessStatus: 'COMPLETE', discrepancy: false })
  })
})

describe('DB-06 empty, malformed, other currencies', () => {
  it('empty / whitespace / only a total / invisible characters → nothing interpretable', () => {
    for (const t of ['', '   \n\n ', 'Total: 1500', '​‮']) expect(hasInterpretableItems(analyzeBudgetText(t))).toBe(false)
  })
  it('control characters are stripped and the line is still read', () => {
    expect(rows('Filtro\u0007 de aire: 1500')).toEqual([['Filtro de aire', 'part', 'priced', 150_000]])
  })
  it('foreign currency markers → declines (ARS only), even if some lines look like pesos', () => {
    expect(hasInterpretableItems(analyzeBudgetText('Repuesto: 4500\nMano de obra: USD 100'))).toBe(false)
    expect(hasInterpretableItems(analyzeBudgetText('Turbo: U$S 900'))).toBe(false)
  })
  it('only items without amount → not interpretable without the AI', () => {
    expect(hasInterpretableItems(analyzeBudgetText('Pastillas de freno\nDiscos de freno'))).toBe(false)
  })
})

describe('DB-07 LLM-read lines: amounts must be written in the text', () => {
  it('keeps written amounts, marks invented ones ambiguous, drops an unwritten declared total; categories are deterministic', () => {
    const text = 'Me cobran 45.000 el aceite y 12000 la mano de obra'
    expect(amountsWrittenIn(text)).toEqual(new Set([4_500_000, 1_200_000]))
    const a = analysisFromLlmLines(
      text,
      [
        { status: 'confirmed', description: 'Aceite', amountMinorUnit: 4_500_000, currency: 'ARS' },
        { status: 'confirmed', description: 'Mano de obra', amountMinorUnit: 1_300_000, currency: 'ARS' },
        { status: 'missing', description: 'Filtro' },
      ],
      9_900_000,
    )
    expect(a.items.map((i) => [i.category, i.status, i.amountMinorUnit])).toEqual([
      ['part', 'priced', 4_500_000],
      ['labor', 'ambiguous', null],
      ['part', 'missing', null],
    ])
    expect(a.declaredTotalMinorUnit).toBeNull()
  })
})
