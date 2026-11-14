/**
 * price-comparator.test.ts — Incremento 7B: deterministic comparison between the workshop price
 * and a user-provided reference. Never concludes overpricing; never compares labor.
 */
import { describe, it, expect } from 'vitest'
import { compareWithReference, COMPARISON_DISCLAIMER } from './price-comparator'
import type { PartReference, ResearchLine } from './types'

const line = (over: Partial<ResearchLine> = {}): ResearchLine => ({
  id: 'l1',
  description: 'Manguera de respiración de gases',
  category: 'part',
  quantity: 1,
  presentation: 'unit',
  partBrand: '',
  partCode: '',
  workshopPriceMinor: 1_800_000,
  pricePending: false,
  references: [],
  ...over,
})

const ref = (over: Partial<PartReference> = {}): PartReference => ({
  id: 'r1',
  url: 'https://articulo.mercadolibre.com.ar/MLA-1',
  store: 'Mercado Libre',
  priceMinor: 1_500_000,
  currency: 'ARS',
  consultedOn: '2026-11-10',
  description: '',
  compatibility: 'confirmed_equivalent',
  quantity: 1,
  presentation: 'unit',
  source: 'user',
  ...over,
})

describe('compareWithReference', () => {
  it('confirmed equivalent: absolute and percentage difference, integer minor units', () => {
    const c = compareWithReference(line(), ref())
    expect(c).toEqual({
      kind: 'compared',
      workshopTotalMinor: 1_800_000,
      referenceTotalMinor: 1_500_000,
      differenceMinor: 300_000,
      differencePercentTenths: 200, // +20,0 %
      workshopUnitMinor: 1_800_000,
      referenceUnitMinor: 1_500_000,
    })
  })

  it('negative difference when the reference is higher', () => {
    const c = compareWithReference(line({ workshopPriceMinor: 1_200_000 }), ref())
    expect(c.kind === 'compared' && c.differenceMinor).toBe(-300_000)
    expect(c.kind === 'compared' && c.differencePercentTenths).toBe(-200)
  })

  it('quantities: workshop 4 units vs reference price per unit → compares 4 × reference', () => {
    const c = compareWithReference(line({ quantity: 4, workshopPriceMinor: 2_000_000 }), ref({ priceMinor: 450_000, quantity: 1 }))
    expect(c.kind).toBe('compared')
    if (c.kind !== 'compared') return
    expect(c.referenceTotalMinor).toBe(1_800_000)
    expect(c.differenceMinor).toBe(200_000)
    expect(c.workshopUnitMinor).toBe(500_000)
    expect(c.referenceUnitMinor).toBe(450_000)
  })

  it('reference pack of 2 vs workshop 1 unit → normalized per unit (rounded to the centavo)', () => {
    const c = compareWithReference(line({ workshopPriceMinor: 1_000_001 }), ref({ priceMinor: 1_500_001, quantity: 2 }))
    expect(c.kind).toBe('compared')
    if (c.kind !== 'compared') return
    expect(c.referenceTotalMinor).toBe(750_001) // 750 000,5 → half away from zero
    expect(c.differenceMinor).toBe(1_000_001 - 750_001)
  })

  it('set vs unit is never compared without normalizing the presentation', () => {
    expect(compareWithReference(line({ presentation: 'set' }), ref({ presentation: 'unit' }))).toEqual({ kind: 'not_comparable', reason: 'presentation_mismatch' })
  })

  it('unverified compatibility → "Coincidencia no verificada", no numbers', () => {
    expect(compareWithReference(line(), ref({ compatibility: 'unverified' }))).toEqual({ kind: 'not_comparable', reason: 'unverified' })
  })

  it('looks similar but not equivalent → not compared', () => {
    expect(compareWithReference(line(), ref({ compatibility: 'not_equivalent' }))).toEqual({ kind: 'not_comparable', reason: 'not_equivalent' })
  })

  it('missing workshop price or invalid reference price → not compared', () => {
    expect(compareWithReference(line({ workshopPriceMinor: null }), ref())).toEqual({ kind: 'not_comparable', reason: 'no_workshop_price' })
    expect(compareWithReference(line(), ref({ priceMinor: null }))).toEqual({ kind: 'not_comparable', reason: 'no_reference_price' })
    expect(compareWithReference(line(), ref({ priceMinor: 0 }))).toEqual({ kind: 'not_comparable', reason: 'no_reference_price' })
  })

  it('labor and other concepts are never compared', () => {
    expect(compareWithReference(line({ category: 'labor' }), ref())).toEqual({ kind: 'not_comparable', reason: 'not_a_part' })
    expect(compareWithReference(line({ category: 'other' }), ref())).toEqual({ kind: 'not_comparable', reason: 'not_a_part' })
    expect(compareWithReference(line({ category: 'unclassified' }), ref())).toEqual({ kind: 'not_comparable', reason: 'not_a_part' })
  })

  it('large values stay exact (no float overflow in the percentage)', () => {
    const c = compareWithReference(line({ quantity: 999, workshopPriceMinor: 99_999_999_999 }), ref({ priceMinor: 33_333_333_333, quantity: 1 }))
    expect(c.kind).toBe('not_comparable') // reference total would exceed the supported maximum
  })

  it('disclaimer never concludes overpricing and never names a fair price', () => {
    expect(COMPARISON_DISCLAIMER).toMatch(/[Nn]o indica que el taller cobre de más/)
    expect(COMPARISON_DISCLAIMER).not.toMatch(/precio justo(?! de mercado)|caro|barato|sobreprecio(?! ni)/i)
  })
})
