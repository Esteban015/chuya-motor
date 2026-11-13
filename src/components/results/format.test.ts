/**
 * format.test.ts — Incremento 6.6: presentation helpers of the redesigned result views.
 */
import { describe, it, expect } from 'vitest'
import { budgetComparison, declaredTotalFromText, formatMoney, parseArgentineAmount } from './format'
import type { ClientBudgetOutput } from '@/app/api/analyze/schema'

const budget = (over: Partial<ClientBudgetOutput> = {}): ClientBudgetOutput => ({
  completenessStatus: 'COMPLETE',
  computedTotalMinorUnit: 1_100_000,
  computedTotalIsPartial: false,
  currency: 'ARS',
  discrepancy: true,
  lineCount: 4,
  missingLineCount: 0,
  ...over,
})

describe('FMT-01: Argentine money format', () => {
  it('formats minor units with thousands dot and decimal comma', () => {
    expect(formatMoney(1_250_000, 'ARS')).toBe('$ 12.500,00')
    expect(formatMoney(1_850_050, 'USD')).toBe('US$ 18.500,50')
    expect(formatMoney(99, null)).toBe('0,99')
  })
})

describe('FMT-02: amounts typed by the person', () => {
  it.each([
    ['12.500', 1_250_000],
    ['12500', 1_250_000],
    ['$ 12.500,50', 1_250_050],
    ['1.234.567', 123_456_700],
    ['12,5', 1250],
  ])('%s → %d', (raw, minor) => expect(parseArgentineAmount(raw)).toBe(minor))

  it.each(['12.50.0', 'doce mil', '12.5000', ''])('ambiguous %s → null', (raw) => expect(parseArgentineAmount(raw)).toBeNull())

  it('declared total only when exactly one "Total" line is present', () => {
    expect(declaredTotalFromText('Aceite: 4500\nTotal: 12.500')).toBe(1_250_000)
    expect(declaredTotalFromText('Aceite: 4500\nTotal general = $ 12500')).toBe(1_250_000)
    expect(declaredTotalFromText('Aceite: 4500')).toBeNull()
    expect(declaredTotalFromText('Total: 100\nTotal: 200')).toBeNull()
  })
})

describe('FMT-03: comparison never contradicts the server', () => {
  const TEXT = 'Aceite motor: 4500\nFiltro: 1500\nFiltro aceite: 2000\nMano de obra: 3000\nTotal: 12500'

  it('server mismatch + consistent declared total → declared and difference shown', () => {
    expect(budgetComparison(budget(), TEXT)).toEqual({ kind: 'mismatch', declared: 1_250_000, difference: 150_000 })
  })

  it('server mismatch but the text total equals the computed total → amounts hidden, verdict kept', () => {
    expect(budgetComparison(budget(), 'Total: 11000')).toEqual({ kind: 'mismatch', declared: null, difference: null })
  })

  it('server match → match (declared shown only if consistent)', () => {
    expect(budgetComparison(budget({ discrepancy: false, computedTotalMinorUnit: 1_250_000 }), TEXT)).toEqual({ kind: 'match', declared: 1_250_000 })
    expect(budgetComparison(budget({ discrepancy: false }), TEXT)).toEqual({ kind: 'match', declared: null })
  })

  it('no total declared / nothing computed', () => {
    expect(budgetComparison(budget({ discrepancy: null }), 'Aceite: 4500')).toEqual({ kind: 'no_declared_total' })
    expect(budgetComparison(budget({ discrepancy: null, computedTotalMinorUnit: null }), '')).toEqual({ kind: 'unknown' })
  })
})
