import { describe, it, expect } from 'vitest'
import { mergeLines, sumWorkshopPrices } from './merge'
import { parseResearchLines } from './line-parser'
import type { PartReference } from './types'

const ref: PartReference = {
  id: 'r1', url: null, store: 'Comercio', priceMinor: 100_000, currency: 'ARS', consultedOn: '2026-11-10',
  description: '', compatibility: 'unverified', quantity: 1, presentation: 'unit', source: 'user',
}

describe('mergeLines', () => {
  it('keeps references, brand and code of lines with the same description after re-parsing', () => {
    const prev = parseResearchLines('Manguera de respiración de gases\nFiltro de aceite', { assumeParts: true }).lines
    prev[0] = { ...prev[0]!, references: [ref], partBrand: 'Marca X', partCode: 'ABC-1' }
    const next = parseResearchLines('Filtro de aceite\nmanguera de respiracion de gases\nBujías x4', { assumeParts: true }).lines
    const merged = mergeLines(prev, next)
    const hose = merged.find((l) => /manguera/i.test(l.description))!
    expect(hose.references).toEqual([ref])
    expect(hose.partBrand).toBe('Marca X')
    expect(hose.partCode).toBe('ABC-1')
    expect(merged.find((l) => /buj/i.test(l.description))!.references).toEqual([])
  })
})

describe('sumWorkshopPrices', () => {
  it('integer sum of quoted line prices; pending lines counted apart', () => {
    const lines = parseResearchLines('Manguera: 18000\nMano de obra: 12000\nBomba: a confirmar', { assumeParts: false }).lines
    expect(sumWorkshopPrices(lines)).toEqual({ totalMinor: 3_000_000, pricedLines: 2, missingLines: 1 })
  })
})
