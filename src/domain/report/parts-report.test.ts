/**
 * parts-report.test.ts — Incremento 7G: the parts research report and exported URLs.
 * SYNTHETIC data only; no network, no LLM, no provider search.
 */
import { describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import type { ClientPricedItem } from '@/domain/budget/research/parts-prices-contract'
import type { ResearchLine } from '@/domain/budget/research/types'
import { PROFESSIONAL_INSTALL_NOTE } from '@/domain/budget/research/guidance'
import { buildPartsReport, partSearchState, partsReadiness, type ChuyaReport, type PricingSnapshot, type ReportBlock } from './chuya-report'
import { sanitizeExportUrl } from './export-url'
import { REDACTED } from './personal-data'
import { renderReportPdf } from './pdf-renderer'
import { PARTS_LINES, PRICING_NO_RESULTS, PRICING_WITH_OFFERS } from './__fixtures__/report-fixtures'
import { pdfLinks, pdfText } from './__fixtures__/pdf-inspect'

const AT = new Date('2026-11-16T17:45:00Z')
const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', engine: '1.4 8v', source: 'catalog' as const }

function allText(r: ChuyaReport): string {
  const block = (b: ReportBlock): string[] => {
    switch (b.kind) {
      case 'paragraph':
      case 'preformatted':
        return [b.text]
      case 'alert':
        return [b.title, ...b.lines]
      case 'list':
        return b.items
      case 'keyValues':
        return b.rows.flat()
      case 'table':
        return [...b.columns, ...b.rows.flat()]
      case 'entry':
        return [b.title, ...b.lines, ...b.badges, ...(b.link ? [b.link.label, b.link.url] : [])]
    }
  }
  return [r.title, r.generatedAtLabel, r.disclaimer, ...r.sections.flatMap((s) => [s.title, ...s.blocks.flatMap(block)])].join('\n')
}
const section = (r: ChuyaReport, id: string) => r.sections.find((s) => s.id === id)
const summaryRows = (r: ChuyaReport) => (section(r, 'parts-summary')!.blocks[0] as Extract<ReportBlock, { kind: 'table' }>).rows
const build = (pricing: PricingSnapshot | null, over: Partial<Parameters<typeof buildPartsReport>[0]> = {}) =>
  buildPartsReport({ lines: PARTS_LINES, vehicle, pricing, autoPricingEnabled: true, generatedAt: AT, ...over })
const withItem = (lineId: string, item: Partial<ClientPricedItem>): PricingSnapshot => ({ items: [{ partLabel: 'x', item: { lineId, status: 'ok', offers: [], hidden: 0, ...item } }] })

describe('PR-01 parts report: structure', () => {
  it('title, date, vehicle, parts with quantity / brand / code, per-part state; labor not searched', () => {
    const r = build(PRICING_WITH_OFFERS)
    expect(r.title).toBe('Informe de consulta de repuestos')
    expect(r.fileName).toBe('chuya-informe-repuestos-2026-11-16.pdf')
    expect(r.generatedAtLabel).toBe('Generado el 16/11/2026 14:45 (hora de Argentina)')
    expect(section(r, 'vehicle')!.blocks[0]).toMatchObject({ kind: 'keyValues', rows: [['Marca', 'Fiat'], ['Modelo', 'Palio'], ['Año', '2017'], ['Motor', '1.4 8v']] })
    expect(summaryRows(r)).toEqual([
      ['Aceite motor', '1 × unidad', '—', '1', 'Publicaciones encontradas'],
      ['Filtro de aire', '1 × unidad', 'Marca Sintética · FA-1234', 'Ninguna', 'Sin resultados'],
      ['Filtro de aceite', '1 × unidad', '—', 'Ninguna', 'Proveedor no disponible'],
      ['Pastillas de freno delanteras', '1 × juego', '—', 'Ninguna', 'Búsqueda no realizada'],
    ])
    expect(section(r, 'not-parts')!.blocks).toContainEqual({ kind: 'list', items: ['Mano de obra'] })
    // Labor questions only because the list has a labor line.
    expect(allText(r)).toContain('¿Qué tareas incluye exactamente la mano de obra?')
    expect(allText(r)).toContain('¿Qué marca y código tiene cada repuesto presupuestado?')
  })

  it('manual search: the person’s references and a suggested search link per part', () => {
    const r = build(null)
    const oil = section(r, 'part-1')!
    expect(oil.blocks).toContainEqual(expect.objectContaining({ kind: 'entry', title: 'Aceite 10W40 4 L (referencia sintética)', badges: ['Coincidencia no verificada'] }))
    const search = oil.blocks.find((b) => b.kind === 'entry' && b.title === 'Búsqueda manual sugerida') as Extract<ReportBlock, { kind: 'entry' }>
    expect(search.link!.url).toMatch(/^https:\/\/www\.google\.com\/search\?q=Aceite(?:%20|\+)motor(?:%20|\+)Fiat(?:%20|\+)Palio/)
  })

  it('SerpApi offers already shown: title, merchant, ARS price, link, date, "Compatibilidad no verificada"', () => {
    const r = build(PRICING_WITH_OFFERS)
    const offer = section(r, 'part-1')!.blocks.find((b) => b.kind === 'entry' && b.badges.includes('Compatibilidad no verificada') && b.badges.includes('No es un presupuesto')) as Extract<ReportBlock, { kind: 'entry' }>
    expect(offer).toMatchObject({
      title: 'Aceite Sintético 10W40 x 4 L (OFERTA SINTÉTICA DE PRUEBA)',
      lines: ['Precio publicado: $ 32.700,50', 'Comercio: Tienda Sintética Uno', 'Consultado: 16/11/2026 14:10 (hora de Argentina)', expect.stringContaining('Falta confirmar')],
      link: { label: 'Ver publicación', url: 'https://www.google.com.ar/shopping/product/111?prds=synthetic-1&gl=ar' },
    })
  })
})

describe('PR-02 states per part', () => {
  const oil = PARTS_LINES[0]!
  it('found / no results / timeout / quota / skipped / not searched / feature off', () => {
    expect(partSearchState(oil, withItem('l1', { offers: PRICING_WITH_OFFERS.items[0]!.item.offers }), true)).toEqual({ state: 'found' })
    expect(partSearchState(oil, withItem('l1', { status: 'no_results' }), true)).toEqual({ state: 'no_results' })
    expect(partSearchState(oil, withItem('l1', { status: 'ok', offers: [], hidden: 2 }), true)).toEqual({ state: 'no_results' })
    expect(partSearchState(oil, withItem('l1', { status: 'unavailable', reason: 'timeout' }), true)).toMatchObject({ state: 'unavailable', detail: expect.stringContaining('tardó demasiado') })
    expect(partSearchState(oil, withItem('l1', { status: 'unavailable', reason: 'quota_exceeded' }), true)).toMatchObject({ state: 'unavailable', detail: expect.stringContaining('límite') })
    expect(partSearchState(oil, withItem('l1', { status: 'skipped', reason: 'limit' }), true)).toMatchObject({ state: 'not_searched', detail: expect.stringContaining('hasta 5') })
    expect(partSearchState(oil, null, true)).toEqual({ state: 'not_searched' })
    expect(partSearchState(oil, PRICING_WITH_OFFERS, false)).toEqual({ state: 'not_available' })
  })
  it('timeout is reported as "proveedor no disponible" with its reason, never as "sin resultados"', () => {
    const r = build(PRICING_WITH_OFFERS)
    const filter = section(r, 'part-3')!
    expect(allText({ ...r, sections: [filter] })).toContain('Búsqueda automática: proveedor no disponible')
    expect(allText({ ...r, sections: [filter] })).toContain('tardó demasiado')
    expect(allText({ ...r, sections: [filter] })).not.toContain('No se encontraron publicaciones')
  })
  it('no results everywhere; no search made → partial information stated; feature off stated', () => {
    expect(summaryRows(build(PRICING_NO_RESULTS)).map((r) => r[4])).toEqual(['Sin resultados', 'Sin resultados', 'Sin resultados', 'Sin resultados'])
    const partial = build(null)
    expect(summaryRows(partial).map((r) => r[4])).toEqual(Array(4).fill('Búsqueda no realizada'))
    expect(allText(partial)).toContain('Información parcial')
    expect(summaryRows(build(null, { autoPricingEnabled: false })).map((r) => r[4])).toEqual(Array(4).fill('Búsqueda automática no disponible'))
  })
  it('hidden offers are counted, never shown', () => {
    const snap = withItem('l1', { offers: PRICING_WITH_OFFERS.items[0]!.item.offers, hidden: 3 })
    expect(allText(build(snap))).toContain('Se ocultaron 3 publicaciones que no mencionan el modelo del vehículo.')
  })
})

describe('PR-03 never a budget: no sums of offers or references', () => {
  it('no total, no sum, no average, no "cheapest"; amounts appear only as published', () => {
    const many = withItem('l1', {
      offers: [1_000_000, 2_000_000, 3_000_000].map((p, i) => ({ ...PRICING_WITH_OFFERS.items[0]!.item.offers[0]!, title: `Oferta ${i}`, priceMinor: p })),
    })
    const text = allText(build(many))
    expect(text).not.toMatch(/\btotal\b|suma(?!n)|promedio|m[aá]s barat|m[aá]s car|ahorr|sobreprecio/i)
    expect(text).not.toContain('$ 60.000,00') // 10.000 + 20.000 + 30.000
    expect(text).not.toContain('$ 64.200,00') // + the person's own reference
    for (const p of ['$ 10.000,00', '$ 20.000,00', '$ 30.000,00']) expect(text).toContain(p)
    expect(text).toContain('Los precios no se suman')
  })
})

describe('PR-04 warnings and privacy', () => {
  it('the compatibility warning is first and the brake installation warning is kept, whatever the privacy options', () => {
    for (const privacy of [{ redactPersonalData: true, includeOriginalText: true }, { redactPersonalData: false, includeOriginalText: false }]) {
      const r = build(PRICING_WITH_OFFERS, { privacy })
      expect(r.sections[0]).toMatchObject({ id: 'compatibility', blocks: [{ kind: 'alert', title: 'Compatibilidad no verificada' }] })
      expect(allText(section(r, 'part-4') ? { ...r, sections: [section(r, 'part-4')!] } : r)).toContain(PROFESSIONAL_INSTALL_NOTE)
    }
  })
  it('personal data typed in part names, references or stores is omitted by default', () => {
    const lines: ResearchLine[] = [
      { ...PARTS_LINES[0]!, description: 'Aceite motor para Juan, cel 11-2345-6789', references: [{ ...PARTS_LINES[0]!.references[0]!, store: 'Lubricentro (llamar al 11-9876-5432)', url: 'https://www.ejemplo-sintetico.com.ar/p?id=1&email=juan@correo.com&utm_source=wpp#token=abc' }] },
    ]
    const r = buildPartsReport({ lines, vehicle, pricing: null, autoPricingEnabled: true, generatedAt: AT })
    const text = allText(r)
    for (const s of ['2345-6789', '9876-5432', 'juan@correo.com', 'utm_source', 'token=abc']) expect(text).not.toContain(s)
    expect(text).toContain(REDACTED)
    expect(text).toContain('https://www.ejemplo-sintetico.com.ar/p?id=1')
  })
  it('insufficient without parts', () => {
    expect(partsReadiness({ lines: [] })).toEqual({ ok: false, reason: 'insufficient' })
    expect(partsReadiness({ lines: [PARTS_LINES[4]!] })).toEqual({ ok: false, reason: 'insufficient' })
    expect(partsReadiness({ lines: PARTS_LINES })).toEqual({ ok: true })
  })
})

describe('PR-05 exported URL sanitization', () => {
  it('drops fragments and personal / session / tracking parameters; keeps what opens the page', () => {
    expect(sanitizeExportUrl('https://www.google.com.ar/shopping/product/1?prds=pid:1,eto:2&gl=ar&utm_source=x&gclid=abc#frag')).toBe('https://www.google.com.ar/shopping/product/1?prds=pid%3A1%2Ceto%3A2&gl=ar')
    expect(sanitizeExportUrl('https://articulo.mercadolibre.com.ar/MLA-123-x?token=t&session_id=s&access_token=a&email=a@b.com&phone=11&uid=9&fbclid=f&api_key=k&id=MLA123')).toBe('https://articulo.mercadolibre.com.ar/MLA-123-x?id=MLA123')
    expect(sanitizeExportUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeExportUrl('https://user:pass@example.com/x')).toBeNull()
    expect(sanitizeExportUrl('http://localhost:3000/x')).toBeNull()
  })
})

describe('PR-06 the generated parts PDF', () => {
  it('valid PDF: content, states, clickable sanitized links, pages numbered; no network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { bytes, trace } = await renderReportPdf(build(PRICING_WITH_OFFERS))
    vi.unstubAllGlobals()
    expect(fetchSpy).not.toHaveBeenCalled()
    const doc = await PDFDocument.load(bytes)
    expect(doc.getTitle()).toBe('Chuya Motor - Informe de consulta de repuestos')
    const text = await pdfText(bytes)
    for (const s of ['Informe de consulta de repuestos', 'Compatibilidad no verificada', 'Repuestos consultados', 'Búsqueda automática: publicaciones encontradas', 'Búsqueda automática: sin resultados', 'Búsqueda automática: proveedor no disponible', 'Búsqueda automática: búsqueda no realizada', 'Precio publicado: $ 32.700,50', `Página ${trace.pages.length} de ${trace.pages.length}`]) expect(text).toContain(s)
    const links = await pdfLinks(bytes)
    expect(links).toContain('https://www.google.com.ar/shopping/product/111?prds=synthetic-1&gl=ar')
    expect(links.some((l) => l.startsWith('https://www.google.com/search?q='))).toBe(true)
  })
})
