/**
 * chuya-report.test.ts — Incremento 7F: report model, privacy and the generated PDF.
 * SYNTHETIC data only; no network, no LLM, no provider search.
 */
import { describe, expect, it, vi } from 'vitest'
import { inflateSync } from 'node:zlib'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFString } from 'pdf-lib'
import { buildBudgetReport, buildDiagnosisReport, budgetReadiness, diagnosisReadiness, type ChuyaReport, type ReportBlock } from './chuya-report'
import { findPersonalData, personalDataKinds, redactPersonalData, REDACTED } from './personal-data'
import { renderReportPdf } from './pdf-renderer'
import {
  BUDGET_AMBIGUOUS,
  BUDGET_DIFFERENCE,
  BUDGET_EXAMPLE_TEXT,
  BUDGET_MATCH,
  DIAGNOSIS_AI,
  DIAGNOSIS_AI_DOWN,
  DIAGNOSIS_CRITICAL,
  PRICING_WITH_OFFERS,
  RESEARCH_LINES,
  SAMPLE_BUDGET,
  SAMPLE_DIAGNOSIS,
} from './__fixtures__/report-fixtures'

const AT = new Date('2026-11-16T17:45:00Z')
const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', source: 'catalog' as const }

/** Every string in the model, flattened (what can reach the PDF). */
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
  return [r.title, r.subtitle, r.generatedAtLabel, r.disclaimer, r.fileName, ...r.sections.flatMap((s) => [s.title, ...s.blocks.flatMap(block)])].join('\n')
}
const section = (r: ChuyaReport, id: string) => r.sections.find((s) => s.id === id)

const winAnsi = new TextDecoder('windows-1252')

/** Text actually written in the PDF content streams (decoded from the hex strings pdf-lib emits). */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  let out = ''
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    let content: string
    try {
      content = inflateSync(Buffer.from(obj.contents)).toString('latin1')
    } catch {
      content = Buffer.from(obj.contents).toString('latin1')
    }
    // pdf-lib writes standard-font text as hex WinAnsi (windows-1252) strings.
    for (const m of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += winAnsi.decode(Buffer.from(m[1]!, 'hex')) + '\n'
  }
  return out
}

async function pdfLinks(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes)
  const urls: string[] = []
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) continue
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i, PDFDict)
      const action = a.lookup(PDFName.of('A'), PDFDict)
      urls.push((action.lookup(PDFName.of('URI'), PDFString) as PDFString).decodeText())
    }
  }
  return urls
}

describe('PDF-01 personal data: conservative detection, amounts never redacted', () => {
  it('detects e-mail, phones, plates, VIN, ID numbers, names and addresses', () => {
    const text = [
      'Escribime a juan.perez@correo-sintetico.com',
      'Mi celular es 11-2345-6789 y el fijo +54 11 4567 8901',
      'whatsapp 1123456789',
      'Patente AB123CD, dominio ABC123',
      'VIN 9BD17164G5A123456',
      'DNI 12.345.678 · CUIT 20-12345678-3',
      'Me llamo Juan Pérez',
      'Domicilio: Av. Siempreviva 742',
    ].join('\n')
    expect(personalDataKinds([text])).toEqual(['email', 'phone', 'plate', 'vin', 'document', 'name', 'address'])
    const red = redactPersonalData(text)
    for (const s of ['juan.perez', '2345-6789', '4567 8901', '1123456789', 'AB123CD', 'ABC123', '9BD17164G5A123456', '12.345.678', '20-12345678-3', 'Juan Pérez', 'Siempreviva']) expect(red).not.toContain(s)
    expect(red).toContain(REDACTED)
  })
  it('budget amounts, part codes and quantities are left intact', () => {
    const budget = 'Aceite motor: 4500\nTotal: 45000000\nMotor de arranque: 1.234.567,89\nKit distribución Gates 5559\nFiltro Mann W712 x 2\nAmortiguador 2 x 90000'
    expect(findPersonalData(budget)).toEqual([])
    expect(redactPersonalData(budget)).toBe(budget)
  })
})

describe('PDF-02 diagnosis report', () => {
  it('with AI: hypotheses stay hypotheses, with confidence, caveats (uncertainty), missing data and both question lists', () => {
    const r = buildDiagnosisReport({ report: DIAGNOSIS_AI, vehicle, symptomText: 'Chirrido al frenar', occurrence: 'Al frenar', generatedAt: AT })
    expect(r.title).toBe('Informe de diagnóstico orientativo')
    expect(r.generatedAtLabel).toBe('Generado el 16/11/2026 14:45 (hora de Argentina)')
    expect(r.fileName).toBe('chuya-informe-diagnostico-2026-11-16.pdf')
    const hyp = section(r, 'hypotheses')!
    expect(hyp.provenance).toBe('ai')
    expect(allText(r)).toContain('No son diagnósticos confirmados')
    expect(hyp.blocks.filter((b) => b.kind === 'entry').map((b) => (b as { badges: string[] }).badges)).toEqual([
      ['Confianza media', 'Hipótesis a verificar'],
      ['Confianza baja', 'Hipótesis a verificar'],
    ])
    expect(allText(r)).toContain('Incertidumbre: Puede confundirse con discos rayados')
    expect(section(r, 'missing')).toBeTruthy()
    expect(section(r, 'driver-questions')!.blocks[0]).toMatchObject({ kind: 'list', items: ['¿El ruido aparece también con el auto en frío?'] })
    expect(section(r, 'workshop-questions')!.blocks[0]).toMatchObject({ kind: 'list', ordered: true })
    expect(allText(r)).toContain('Procesado con IA (piloto)')
    expect(allText(r)).not.toMatch(/diagn[oó]stico confirmado:|certificado por el taller|es compatible/i)
  })

  it('AI unavailable: still a useful report (symptom, vehicle, AI status), no invented hypotheses', () => {
    const r = buildDiagnosisReport({ report: DIAGNOSIS_AI_DOWN, vehicle, symptomText: 'Pierde aceite', generatedAt: AT })
    expect(diagnosisReadiness({ report: DIAGNOSIS_AI_DOWN, symptomText: 'Pierde aceite' })).toEqual({ ok: true })
    expect(allText(r)).toContain('Servicio con IA temporalmente no disponible')
    expect(allText(r)).toContain('Pierde aceite')
    expect(section(r, 'hypotheses')!.blocks).toEqual([{ kind: 'paragraph', text: expect.stringContaining('no tiene hipótesis'), tone: 'muted' }])
  })

  it('critical severity: first section, cannot be removed by the privacy options', () => {
    for (const privacy of [{ redactPersonalData: true, includeOriginalText: true }, { redactPersonalData: false, includeOriginalText: false }]) {
      const r = buildDiagnosisReport({ report: DIAGNOSIS_CRITICAL, vehicle, symptomText: 'No frena', generatedAt: AT, privacy })
      expect(r.sections[0]).toMatchObject({ id: 'severity', title: 'Advertencia de seguridad crítica' })
      expect(r.sections[0]!.blocks[0]).toMatchObject({ kind: 'alert', level: 'critical', title: 'No conduzcas el vehículo' })
    }
  })

  it('safety-blocked → no report; withheld → no hypotheses exported', () => {
    expect(diagnosisReadiness({ report: { ...DIAGNOSIS_AI, safetyBlocked: true }, symptomText: 'x' })).toEqual({ ok: false, reason: 'safety_blocked' })
    const withheld = buildDiagnosisReport({ report: { ...DIAGNOSIS_AI, aiStatus: { mode: 'withheld' } }, vehicle, symptomText: 'x', generatedAt: AT })
    expect(allText(withheld)).not.toContain('Desgaste de pastillas')
    expect(allText(withheld)).toContain('Respuesta retenida por seguridad')
  })

  it('incomplete / manual vehicle data is labelled as such; none at all says so', () => {
    const manual = buildDiagnosisReport({ report: DIAGNOSIS_AI, vehicle: { make: 'Fiat', source: 'manual' }, symptomText: 'x', generatedAt: AT })
    expect(section(manual, 'vehicle')!.blocks).toEqual([
      { kind: 'keyValues', rows: [['Marca', 'Fiat']] },
      { kind: 'paragraph', text: 'Datos del vehículo incompletos: falta modelo, año.', tone: 'muted' },
      { kind: 'paragraph', text: 'Vehículo ingresado manualmente (no verificado contra un catálogo).', tone: 'muted' },
    ])
    const none = buildDiagnosisReport({ report: DIAGNOSIS_AI, vehicle: {}, symptomText: 'x', generatedAt: AT })
    expect(allText(none)).toContain('No informaste datos del vehículo')
    expect(allText(buildDiagnosisReport({ report: DIAGNOSIS_AI, vehicle, symptomText: 'x', generatedAt: AT }))).toContain('Vehículo elegido del catálogo de Chuya Motor.')
  })

  it('insufficient information: no content and no symptom', () => {
    const empty = { ...DIAGNOSIS_AI_DOWN, fallback: true }
    expect(diagnosisReadiness({ report: empty, symptomText: '  ' })).toEqual({ ok: false, reason: 'insufficient' })
  })
})

describe('PDF-03 budget report', () => {
  it('difference: sum, declared, parts/labor, arithmetic difference — never a price judgement', () => {
    const r = buildBudgetReport({ report: BUDGET_DIFFERENCE, vehicle, budgetText: BUDGET_EXAMPLE_TEXT, generatedAt: AT })
    const v = section(r, 'verification')!
    expect(v.provenance).toBe('calculated')
    expect(v.blocks[0]).toMatchObject({
      kind: 'keyValues',
      rows: [['Estado', 'Completo'], ['Suma de partidas', '$ 11.000,00'], ['Total declarado', '$ 12.500,00'], ['Repuestos', '$ 8.000,00'], ['Mano de obra', '$ 3.000,00'], ['Partidas', '4']],
    })
    expect(v.blocks[1]).toMatchObject({ kind: 'alert', title: 'Diferencia aritmética: $ 1.500,00' })
    expect(allText(r)).toContain('El total declarado es mayor')
    expect(allText(r)).not.toMatch(/sobreprecio|fraude|estafa|\bcaro\b|barato|excesiv|cobra de m[aá]s/i)
    expect(section(r, 'items')!.blocks[0]).toMatchObject({ kind: 'table', rows: [['Aceite motor', 'Repuesto', '$ 4.500,00', 'Sumada'], ['Filtro de aire', 'Repuesto', '$ 1.500,00', 'Sumada'], ['Filtro de aceite', 'Repuesto', '$ 2.000,00', 'Sumada'], ['Mano de obra', 'Mano de obra', '$ 3.000,00', 'Sumada']] })
    expect(section(r, 'original')!.blocks[0]).toEqual({ kind: 'preformatted', text: BUDGET_EXAMPLE_TEXT })
    // AI down: the status is reported, the verification is still valid.
    expect(allText(r)).toContain('La verificación de importes no usa IA')
  })

  it('correct sum → match message, no difference', () => {
    const r = buildBudgetReport({ report: BUDGET_MATCH, vehicle, budgetText: BUDGET_EXAMPLE_TEXT, generatedAt: AT })
    expect(allText(r)).toContain('El total declarado coincide con la suma de las partidas.')
    expect(allText(r)).not.toContain('Diferencia aritmética')
  })

  it('ambiguous / missing amounts: partial sum, never compared, every unclear line listed', () => {
    const r = buildBudgetReport({ report: BUDGET_AMBIGUOUS, vehicle, budgetText: 'x', generatedAt: AT })
    expect(allText(r)).toContain('Suma parcial de partidas')
    expect(allText(r)).toContain('la suma es parcial y no se compara')
    expect(section(r, 'unclear')!.blocks[0]).toMatchObject({
      kind: 'list',
      items: ['Discos de freno: A confirmar', 'Correa: Importe no legible', 'Algunas líneas no parecen partidas (títulos o comentarios) y no se tuvieron en cuenta.'],
    })
    expect(allText(r)).toContain('Discos de freno (x2)')
  })

  it('offers already shown: title, price, merchant, date, URL, "Compatibilidad no verificada"; none / failed parts stated', () => {
    const r = buildBudgetReport({ ...SAMPLE_BUDGET, generatedAt: AT })
    const offers = section(r, 'offers')!
    expect(offers.provenance).toBe('external')
    const entry = offers.blocks.find((b) => b.kind === 'entry') as Extract<ReportBlock, { kind: 'entry' }>
    expect(entry).toMatchObject({
      title: 'Aceite Sintético 10W40 x 4 L (OFERTA SINTÉTICA DE PRUEBA)',
      badges: ['Compatibilidad no verificada', 'No es un presupuesto'],
      lines: ['Precio publicado: $ 32.700,50', 'Comercio: Tienda Sintética Uno', 'Consultado: 16/11/2026 14:10 (hora de Argentina)', expect.stringContaining('Falta confirmar')],
      link: { label: 'Ver publicación', url: 'https://www.google.com.ar/shopping/product/111?prds=synthetic-1&gl=ar' },
    })
    expect(allText(r)).toContain('No se encontraron publicaciones para este repuesto.')
    expect(allText(r)).toContain('tardó demasiado')
    expect(allText(r)).toContain('No son presupuestos')
    // The person's own references are separate and labelled as theirs.
    expect(section(r, 'user-references')!.provenance).toBe('declared')
  })

  it('no search made → no offers section; offer links outside Google Shopping are not linked', () => {
    expect(section(buildBudgetReport({ report: BUDGET_DIFFERENCE, vehicle, budgetText: 'x', lines: RESEARCH_LINES, pricing: null, generatedAt: AT }), 'offers')).toBeUndefined()
    const evil = { items: [{ partLabel: 'Aceite', item: { ...PRICING_WITH_OFFERS.items[0]!.item, offers: [{ ...PRICING_WITH_OFFERS.items[0]!.item.offers[0]!, url: 'javascript:alert(1)' }, { ...PRICING_WITH_OFFERS.items[0]!.item.offers[0]!, url: 'https://evil.example.com/x' }] } }] }
    const r = buildBudgetReport({ report: BUDGET_DIFFERENCE, vehicle, budgetText: 'x', pricing: evil, generatedAt: AT })
    expect(section(r, 'offers')!.blocks.filter((b) => b.kind === 'entry').every((b) => !(b as { link?: unknown }).link)).toBe(true)
  })

  it('clarification route without a budget → insufficient; with questions → ok', () => {
    expect(budgetReadiness({ report: { ...BUDGET_DIFFERENCE, route: 'clarification', budget: null, questions: [] } })).toEqual({ ok: false, reason: 'insufficient' })
    expect(budgetReadiness({ report: BUDGET_DIFFERENCE })).toEqual({ ok: true })
  })
})

describe('PDF-04 privacy and internal data', () => {
  it('personal data redacted by default everywhere it can appear; original text can be omitted', () => {
    const report = { ...DIAGNOSIS_AI, facts: ['El conductor dejó su teléfono 11-2345-6789'] }
    const r = buildDiagnosisReport({ ...SAMPLE_DIAGNOSIS, report, generatedAt: AT })
    expect(allText(r)).not.toContain('2345-6789')
    expect(allText(r)).toContain(REDACTED)
    const raw = buildDiagnosisReport({ ...SAMPLE_DIAGNOSIS, report, generatedAt: AT, privacy: { redactPersonalData: false, includeOriginalText: true } })
    expect(allText(raw)).toContain('11-2345-6789')
    const omitted = buildDiagnosisReport({ ...SAMPLE_DIAGNOSIS, generatedAt: AT, privacy: { redactPersonalData: true, includeOriginalText: false } })
    expect(allText(omitted)).not.toContain('chirrido')
    expect(allText(omitted)).toContain('Elegiste no incluir el texto original')
  })
  it('never exports internal ids, policy version or trace', () => {
    const r = buildBudgetReport({ ...SAMPLE_BUDGET, report: { ...BUDGET_DIFFERENCE, nodeTrace: [{ nodeId: 'budgetParser', status: 'success', durationMs: 1, timestamp: 't', llmCalled: true, retryCount: 0, fallbackActivated: false, dataLabel: 'user_input' }] }, generatedAt: AT })
    expect(allText(r)).not.toMatch(/case-internal-123|policy-internal-v9|budgetParser|caseId/)
  })
})

describe('PDF-05 the generated PDF', () => {
  it('valid A4 PDF; content, money, dates, footer "Página X de Y"; generic metadata', async () => {
    const { bytes, trace } = await renderReportPdf(buildBudgetReport({ ...SAMPLE_BUDGET, generatedAt: AT }))
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-')
    expect(Buffer.from(bytes.slice(-6)).toString()).toContain('%%EOF')
    const doc = await PDFDocument.load(bytes)
    const pages = doc.getPages()
    expect(pages.length).toBe(trace.pages.length)
    expect(pages.every((p) => Math.round(p.getWidth()) === 595 && Math.round(p.getHeight()) === 842)).toBe(true)
    const text = await pdfText(bytes)
    for (const s of ['Informe de revisión de presupuesto', 'Generado el 16/11/2026 14:45 (hora de Argentina)', '$ 11.000,00', '$ 12.500,00', 'Diferencia aritmética: $ 1.500,00', 'Compatibilidad no verificada', `Página 1 de ${pages.length}`, `Página ${pages.length} de ${pages.length}`]) expect(text).toContain(s)
    expect(doc.getTitle()).toBe('Chuya Motor - Informe de revisión de presupuesto')
    expect(doc.getAuthor()).toBe('Chuya Motor')
    expect(text).not.toMatch(/case-internal-123|policy-internal-v9/)
  })

  it('URLs are clickable link annotations and printed in full', async () => {
    const { bytes, trace } = await renderReportPdf(buildBudgetReport({ ...SAMPLE_BUDGET, generatedAt: AT }))
    const links = await pdfLinks(bytes)
    expect(links).toEqual(expect.arrayContaining(['https://www.google.com.ar/shopping/product/111?prds=synthetic-1&gl=ar', 'https://www.ejemplo-sintetico.com.ar/aceite?id=1']))
    expect(trace.pages.flat().join(' ')).toContain('https://www.google.com.ar/shopping/product/111?prds=synthetic-1&gl=ar')
  })

  it('Spanish characters are kept; unsupported characters never break the file', async () => {
    const special = 'Ñandú ¿Cuánto? ¡Atención! 1º 2ª € «comillas» “curvas” — guion · ü → ≥ 😀 汉字 ﬁ'
    const r = buildDiagnosisReport({ report: { ...DIAGNOSIS_AI, facts: [special] }, vehicle, symptomText: special, generatedAt: AT })
    const { bytes } = await renderReportPdf(r)
    const text = await pdfText(bytes)
    for (const s of ['Ñandú', '¿Cuánto?', '¡Atención!', '1º 2ª €', '«comillas»', '“curvas”', '—', 'ü -> >=']) expect(text).toContain(s)
    expect(text).not.toContain('😀')
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0)
  })

  it('long texts paginate: many pages, every page numbered, table header repeated, nothing lost', async () => {
    const longText = Array.from({ length: 120 }, (_, i) => `Línea ${i + 1}: descripción extensa del ruido con muchas palabras para forzar el ajuste de línea en la página`).join('\n')
    const items = Array.from({ length: 50 }, (_, i) => ({ description: `Repuesto número ${i + 1} con una descripción bastante larga para ocupar dos líneas en la tabla`, category: 'part' as const, quantity: 1, amountMinorUnit: 100_000 + i, status: 'priced' as const }))
    const report = { ...BUDGET_DIFFERENCE, budget: { ...BUDGET_DIFFERENCE.budget!, items, lineCount: 50 } }
    const { bytes, trace } = await renderReportPdf(buildBudgetReport({ report, vehicle, budgetText: longText, generatedAt: AT }))
    const n = (await PDFDocument.load(bytes)).getPageCount()
    expect(n).toBeGreaterThanOrEqual(5)
    trace.pages.forEach((lines, i) => expect(lines).toContain(`Página ${i + 1} de ${n}`))
    const all = trace.pages.flat().join('\n')
    for (let i = 1; i <= 50; i++) expect(all).toContain(`Repuesto número ${i} `)
    expect(all).toContain('Línea 120:')
    expect(trace.pages.filter((p) => p.includes('Concepto')).length).toBeGreaterThan(1)
  })

  it('generation makes no network request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await renderReportPdf(buildDiagnosisReport({ ...SAMPLE_DIAGNOSIS, generatedAt: AT }))
    await renderReportPdf(buildBudgetReport({ ...SAMPLE_BUDGET, generatedAt: AT }))
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
