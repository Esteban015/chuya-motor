/**
 * adversarial.test.ts — Incremento 7B, final security / comparability audit.
 *
 * Parts mode contract: it can only produce a search for something that reads as a PART
 * IDENTIFICATION. It must not become a way around the Safety Gate (tampering, DIY on safety
 * systems, symptom descriptions) nor a generic search tool. The Safety Gate rules are unchanged.
 */
import { describe, it, expect } from 'vitest'
import { localSafetyCheck, screenPartDescription } from './local-safety'
import { compareWithReference } from './price-comparator'
import { parseResearchLines } from './line-parser'
import { checkSafetyGate } from '@/domain/safety/safety-policy'
import type { PartReference, Presentation, ResearchLine } from './types'

describe('ADV-01 legitimate commercial part queries are allowed', () => {
  it.each([
    'Pastillas de freno Fiat Palio 2017',
    'Precio de bomba de nafta Fiat Palio',
    'Bomba de nafta',
    'Batería 12V 65Ah',
    'Extremo de dirección\nRótula',
    'Discos de freno delanteros x2',
    'Kit de embrague',
    'Airbag del conductor',
  ])('%s', (text) => {
    expect(localSafetyCheck(text).blocked).toBe(false)
    for (const line of text.split('\n')) expect(screenPartDescription(line)).toEqual({ ok: true })
  })
})

describe('ADV-02 dangerous intent is blocked (never turned into a search)', () => {
  it.each([
    'Cómo anular el sensor de frenos',
    'Cómo reparar yo mismo una fuga de combustible',
    'Anular sensor ABS',
    'Sensor de frenos anular',
    'Desactivar airbag',
    'Cómo purgar los frenos yo mismo',
    'Manguera de nafta pierde',
    'Pierde nafta la manguera',
    // Part identification mixed with dangerous instructions:
    'Pastillas de freno\nCómo desconectar el ABS para que no frene',
    'Bomba de nafta\npuentear la bomba de nafta',
    'Batería 12V\ncómo hacer puente a la batería',
    'Pastillas de freno Fiat Palio 2017 y cómo anular el testigo de desgaste',
    'Cómo cambio las pastillas de freno',
  ])('%s', (text) => {
    const r = localSafetyCheck(text)
    expect(r.blocked).toBe(true)
    if (r.blocked) expect(r.payload.safetyDerivationMessage).toMatch(/requiere atención profesional/)
  })

  it('the Safety Gate rules themselves are unchanged (the gate still flags these texts)', () => {
    for (const t of ['Cómo anular el sensor de frenos', 'Pastillas de freno Fiat Palio 2017', 'Bomba de nafta']) {
      expect(checkSafetyGate(t).blocked).toBe(true)
    }
  })
})

describe('ADV-03 screenPartDescription — enforced at render time (state manipulation)', () => {
  it.each([
    ['Cómo anular el sensor de frenos', 'unsafe'],
    ['desconectar el ABS', 'unsafe'],
    ['Cómo cambiar la correa de distribución', 'not_a_part'],
    ['¿Dónde queda el taller más cercano?', 'not_a_part'],
    ['Cómo anular el catalizador', 'not_a_part'],
    ['', 'empty'],
    ['   \u0000\u200b  ', 'empty'],
    ['x'.repeat(201), 'too_long'],
  ] as const)('%s → %s', (text, reason) => {
    expect(screenPartDescription(text)).toEqual({ ok: false, reason })
  })

  it('part names with harmless words stay searchable', () => {
    for (const t of ['Regulador de presión de combustible', 'Kit de instalación de escobillas', 'Sensor de ABS delantero', 'Cable de batería', 'Cambio de pastillas delanteras', 'Reemplazo de bomba de agua']) {
      expect(screenPartDescription(t)).toEqual({ ok: true })
    }
  })
})

describe('ADV-04 malformed input', () => {
  it('control characters, zero-width and RTL marks never break parsing', () => {
    const r = parseResearchLines('Filtro\u0000 de aceite\u200b\n\u202eManguera\u202c: 1.000\n\n\t\n:::\n$$$', { assumeParts: false })
    expect(r.lines.map((l) => l.description)).toEqual(['Filtro de aceite', 'Manguera'])
    expect(r.lines[1]!.workshopPriceMinor).toBe(100_000)
    for (const l of r.lines) expect(l.description).not.toMatch(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e]/)
  })

  it('huge numbers and many lines are bounded', () => {
    const r = parseResearchLines('Filtro: 999999999999999999\n' + 'Bujía\n'.repeat(500), { assumeParts: true })
    expect(r.lines[0]!.workshopPriceMinor).toBeNull()
    expect(r.unreadableAmountLines).toEqual([1])
    expect(r.lines.length).toBeLessThanOrEqual(50)
  })
})

// ── Comparability ────────────────────────────────────────────────────────────

const line = (over: Partial<ResearchLine> = {}): ResearchLine => ({
  id: 'l', description: 'Pieza', category: 'part', quantity: 1, presentation: 'unit', partBrand: '', partCode: '',
  workshopPriceMinor: 1_000_000, pricePending: false, references: [], ...over,
})
const ref = (over: Partial<PartReference> = {}): PartReference => ({
  id: 'r', url: null, store: 'Comercio', priceMinor: 800_000, currency: 'ARS', consultedOn: '2026-11-10', description: '',
  compatibility: 'confirmed_equivalent', quantity: 1, presentation: 'unit', source: 'user', ...over,
})

describe('ADV-05 comparability matrix', () => {
  it.each([
    ['unit', 'unit'],
    ['pair', 'pair'],
    ['set', 'set'],
    ['kit', 'kit'],
  ] as const)('%s vs %s → compared', (a, b) => {
    const c = compareWithReference(line({ presentation: a }), ref({ presentation: b }))
    expect(c.kind).toBe('compared')
    if (c.kind === 'compared') expect(c.differenceMinor).toBe(200_000)
  })

  it.each([
    ['unit', 'pair'],
    ['unit', 'set'],
    ['pair', 'set'],
    ['set', 'kit'],
    ['liter', 'unit'],
  ] as const)('%s vs %s → never compared', (a, b) => {
    expect(compareWithReference(line({ presentation: a as Presentation }), ref({ presentation: b as Presentation }))).toEqual({ kind: 'not_comparable', reason: 'presentation_mismatch' })
  })

  it('two units quoted vs a per-unit reference → reference × 2', () => {
    const c = compareWithReference(line({ quantity: 2, workshopPriceMinor: 2_000_000 }), ref({ priceMinor: 900_000 }))
    expect(c.kind === 'compared' && [c.referenceTotalMinor, c.differenceMinor, c.workshopUnitMinor]).toEqual([1_800_000, 200_000, 1_000_000])
  })

  it('unknown brand / code does not block the arithmetic once the person confirmed equivalence', () => {
    expect(compareWithReference(line({ partBrand: '', partCode: '' }), ref()).kind).toBe('compared')
  })

  it('looks similar but incompatible → not compared; unconfirmed → "Coincidencia no verificada"', () => {
    expect(compareWithReference(line(), ref({ compatibility: 'not_equivalent' }))).toEqual({ kind: 'not_comparable', reason: 'not_equivalent' })
    expect(compareWithReference(line(), ref({ compatibility: 'unverified' }))).toEqual({ kind: 'not_comparable', reason: 'unverified' })
  })

  it('tampered state (NaN, decimals, negatives, unknown enums) never throws and is never compared', () => {
    const cases: Array<[Partial<ResearchLine>, Partial<PartReference>]> = [
      [{ workshopPriceMinor: Number.NaN }, {}],
      [{ workshopPriceMinor: 1000.5 }, {}],
      [{}, { priceMinor: Number.NaN }],
      [{}, { priceMinor: -5 }],
      [{}, { priceMinor: 1.25 }],
      [{ quantity: 1.5 }, {}],
      [{}, { quantity: 0 }],
      [{ quantity: Number.POSITIVE_INFINITY }, {}],
      [{}, { compatibility: 'yes' as never }],
      [{ category: 'PART' as never }, {}],
    ]
    for (const [l, r] of cases) {
      expect(() => compareWithReference(line(l), ref(r))).not.toThrow()
      expect(compareWithReference(line(l), ref(r)).kind).toBe('not_comparable')
    }
  })
})
