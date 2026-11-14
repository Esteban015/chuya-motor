/**
 * research-core.test.ts — Incremento 7B (Presupuestos 2.0): deterministic core.
 * Amounts, line parsing/classification, search URLs, external URLs and references.
 * No LLM, no network.
 */
import { describe, it, expect } from 'vitest'
import { formatArs, parseArsAmount, MAX_ARS_MINOR } from './ars-amount'
import { parseResearchLines } from './line-parser'
import { buildPartSearch, sanitizeSearchTerm } from './part-search'
import { sanitizeExternalUrl } from './external-url'
import { validateReferenceInput } from './reference'

describe('parseArsAmount — integer minor units, Argentine format', () => {
  it.each([
    ['18000', 1_800_000],
    ['18.000', 1_800_000],
    ['$ 18.000', 1_800_000],
    ['$18.000,50', 1_800_050],
    ['18000,5', 1_800_050],
    ['1.234.567,89', 123_456_789],
    ['0,10', 10],
    ['ARS 4.500', 450_000],
  ])('%s → %i', (raw, minor) => {
    expect(parseArsAmount(raw)).toBe(minor)
  })

  it.each(['', 'abc', '18,000.50', '18.00', '1.2345', '-500', '12,345', '1e5', 'NaN', '99999999999999'])('rejects ambiguous / invalid %j', (raw) => {
    expect(parseArsAmount(raw)).toBeNull()
  })

  it('no floating point drift (0,10 + 0,20 = 0,30)', () => {
    expect(parseArsAmount('0,10')! + parseArsAmount('0,20')!).toBe(parseArsAmount('0,30'))
  })

  it('formats with es-AR separators', () => {
    expect(formatArs(1_800_050)).toBe('$ 18.000,50')
    expect(formatArs(0)).toBe('$ 0,00')
    expect(MAX_ARS_MINOR).toBeGreaterThan(1_000_000_000)
  })
})

describe('parseResearchLines', () => {
  it('Mode A: list without prices → parts, no invented amounts', () => {
    const r = parseResearchLines('Manguera de respiración de gases\nFiltro de aceite\nBujías x4', { assumeParts: true })
    expect(r.lines.map((l) => l.description)).toEqual(['Manguera de respiración de gases', 'Filtro de aceite', 'Bujías'])
    expect(r.lines.every((l) => l.category === 'part')).toBe(true)
    expect(r.lines.every((l) => l.workshopPriceMinor === null)).toBe(true)
    expect(r.lines[2]!.quantity).toBe(4)
    expect(r.declaredTotalMinor).toBeNull()
  })

  it('Mode B: parts separated from labor and other concepts; ARS amounts', () => {
    const r = parseResearchLines('Manguera de respiración de gases: 18000\nMano de obra: 12000\nInsumos varios: 1.500,50\nTotal: 31.500,50', { assumeParts: false })
    expect(r.lines.map((l) => [l.description, l.category, l.workshopPriceMinor])).toEqual([
      ['Manguera de respiración de gases', 'part', 1_800_000],
      ['Mano de obra', 'labor', 1_200_000],
      ['Insumos varios', 'other', 150_050],
    ])
    expect(r.declaredTotalMinor).toBe(3_150_050)
  })

  it('quantities and presentation (unit / pair / set / kit / liters)', () => {
    const r = parseResearchLines('2 x Amortiguador trasero: 90.000\nPastillas de freno (juego): 25000\nKit de distribución: 120000\nAceite 10W40 4 litros: 36000\nPar de escobillas: 9000', { assumeParts: false })
    expect(r.lines.map((l) => [l.quantity, l.presentation])).toEqual([
      [2, 'unit'],
      [1, 'set'],
      [1, 'kit'],
      [4, 'liter'],
      [1, 'pair'],
    ])
  })

  it('pending amounts stay without price (never INVALID, never invented)', () => {
    const r = parseResearchLines('Bomba de agua: a confirmar\nMano de obra: pendiente', { assumeParts: false })
    expect(r.lines.map((l) => [l.category, l.workshopPriceMinor, l.pricePending])).toEqual([
      ['part', null, true],
      ['labor', null, true],
    ])
  })

  it('unknown concept in Mode B → unclassified (the person can classify it)', () => {
    const r = parseResearchLines('Trámite especial: 5000', { assumeParts: false })
    expect(r.lines[0]!.category).toBe('unclassified')
  })

  it('engine data in a description is not taken as a price ("1.4 8v")', () => {
    const r = parseResearchLines('Junta de tapa de cilindros 1.4 8v', { assumeParts: true })
    expect(r.lines[0]!.description).toBe('Junta de tapa de cilindros 1.4 8v')
    expect(r.lines[0]!.workshopPriceMinor).toBeNull()
  })

  it('limits: at most 50 lines, 200 chars per description', () => {
    const many = Array.from({ length: 60 }, (_, i) => `Filtro ${i}`).join('\n')
    const r = parseResearchLines(many, { assumeParts: true })
    expect(r.lines).toHaveLength(50)
    expect(r.truncated).toBe(true)
    const long = parseResearchLines('Filtro ' + 'x'.repeat(400), { assumeParts: true })
    expect(long.lines[0]!.description.length).toBeLessThanOrEqual(200)
  })
})

describe('buildPartSearch — Google HTTPS URL, encoded, only identifying data', () => {
  const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', engine: '1.4 8v' }

  it('Scenario A query', () => {
    const s = buildPartSearch({ description: 'Manguera de respiración de gases', vehicle })
    expect(s.query).toBe('Manguera de respiración de gases Fiat Palio 1.4 8v 2017 Argentina')
    expect(s.url).toBe(`https://www.google.com/search?q=${encodeURIComponent(s.query)}&hl=es-419&gl=ar`)
    expect(s.url.startsWith('https://www.google.com/search?')).toBe(true)
  })

  it('includes the part code and brand when given; special characters are encoded', () => {
    const s = buildPartSearch({ description: 'Filtro de aceite & aire #2', partCode: 'W 712/75', partBrand: 'Mann', vehicle })
    expect(s.query).toContain('W 712/75')
    expect(s.query).toContain('Mann')
    expect(s.url).toContain('%26')
    expect(s.url).not.toMatch(/[ #&](?!hl=|gl=)/)
    expect(decodeURIComponent(new URL(s.url).searchParams.get('q')!)).toBe(s.query)
  })

  it('removes prices, plates, e-mails and phone numbers from the query', () => {
    expect(sanitizeSearchTerm('Manguera: $ 18.000 patente AB123CD juan@mail.com 1155667788')).toBe('Manguera')
    expect(sanitizeSearchTerm('Correa poly-v patente ABC123')).toBe('Correa poly-v')
  })

  it('works without vehicle data and caps the query length', () => {
    const s = buildPartSearch({ description: 'Termostato ' + 'y'.repeat(300), vehicle: {} })
    expect(s.query.length).toBeLessThanOrEqual(160)
    expect(s.query.endsWith('Argentina')).toBe(true)
  })
})

describe('sanitizeExternalUrl', () => {
  it.each([
    ['https://articulo.mercadolibre.com.ar/MLA-123-manguera', 'https://articulo.mercadolibre.com.ar/MLA-123-manguera'],
    ['  http://repuestos.example.com.ar/p?id=1  ', 'http://repuestos.example.com.ar/p?id=1'],
  ])('accepts %s', (raw, expected) => {
    expect(sanitizeExternalUrl(raw)).toBe(expected)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.com/x',
    '//evil.example.com',
    'https://user:pass@example.com',
    'https://localhost/x',
    'not a url',
    'https://example.com/' + 'a'.repeat(600),
  ])('rejects %s', (raw) => {
    expect(sanitizeExternalUrl(raw)).toBeNull()
  })
})

describe('validateReferenceInput', () => {
  const today = '2026-11-14'
  const base = { url: 'https://articulo.mercadolibre.com.ar/MLA-1', store: 'Mercado Libre', price: '15.000', consultedOn: '2026-11-10', description: 'Manguera respiradero Palio 1.4', compatibility: 'unverified', quantity: '1', presentation: 'unit' }

  it('valid user reference → integer ARS, labeled as user-provided', () => {
    const r = validateReferenceInput(base, today)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.reference.priceMinor).toBe(1_500_000)
    expect(r.reference.currency).toBe('ARS')
    expect(r.reference.source).toBe('user')
  })

  it('reference without a valid price is rejected with a field error', () => {
    for (const price of ['', 'gratis', '0', '-10', '15,000.00']) {
      const r = validateReferenceInput({ ...base, price }, today)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors.price).toBeTruthy()
    }
  })

  it('malicious URL rejected; URL is optional', () => {
    const bad = validateReferenceInput({ ...base, url: 'javascript:alert(1)' }, today)
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.errors.url).toBeTruthy()
    const none = validateReferenceInput({ ...base, url: '' }, today)
    expect(none.ok && none.reference.url).toBeNull()
  })

  it('store required, date not in the future, quantity 1–999, known enums only', () => {
    const r = validateReferenceInput({ ...base, store: ' ', consultedOn: '2027-01-01', quantity: '0', presentation: 'barrel', compatibility: 'maybe' }, today)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['compatibility', 'consultedOn', 'presentation', 'quantity', 'store'])
  })
})
