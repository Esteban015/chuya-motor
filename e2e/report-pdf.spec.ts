/**
 * report-pdf.spec.ts — Incremento 7F: "Chuya Informe" PDF on /demo/falla and /demo/presupuesto.
 *
 * The PDF is generated in the browser from the data already on the page; this spec downloads it
 * and checks the file (valid PDF, content, pages, links), and that NO request is made while
 * exporting (no AI, no SerpApi, no server). Stub LLM on the main server; the AI-down server
 * (port 3003, CI only) covers the report without AI. Offers are simulated with page.route().
 * Screenshots go to the git-ignored reviews-local/screenshots/7f-report-pdf.
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib'

const SHOTS = 'reviews-local/screenshots/7f-report-pdf'
const AI_DOWN_URL = process.env.PLAYWRIGHT_AI_DOWN_BASE_URL ?? (process.env.CI ? 'http://localhost:3003' : '')
const BUDGET = 'Aceite motor: 4500\nFiltro de aire: 1500\nFiltro de aceite: 2000\nMano de obra: 3000\nTotal: 12500'
const winAnsi = new TextDecoder('windows-1252')

let ipSeq = 1
async function ownBucket(page: Page) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.91.${Math.floor(Math.random() * 200)}.${ipSeq++}` })
}

/** Every request made from now on (export must not make any). */
function recordRequests(page: Page) {
  const urls: string[] = []
  page.on('request', (r) => {
    if (!r.url().startsWith('blob:') && !r.url().startsWith('data:')) urls.push(`${r.method()} ${r.url()}`)
  })
  return urls
}

async function pdfInfo(path: string) {
  const bytes = readFileSync(path)
  const doc = await PDFDocument.load(bytes)
  let text = ''
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    let content: string
    try {
      content = inflateSync(Buffer.from(obj.contents)).toString('latin1')
    } catch {
      continue
    }
    for (const m of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) text += winAnsi.decode(Buffer.from(m[1]!, 'hex')) + '\n'
  }
  const links: string[] = []
  for (const p of doc.getPages()) {
    const annots = p.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    for (let i = 0; annots && i < annots.size(); i++) links.push((annots.lookup(i, PDFDict).lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString) as PDFString).decodeText())
  }
  return { header: bytes.subarray(0, 5).toString(), pages: doc.getPageCount(), text, links, title: doc.getTitle() }
}

async function download(page: Page) {
  const panel = page.getByTestId('report-export')
  const [dl] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Descargar informe PDF' }).click()])
  await expect(panel.getByTestId('report-export-status')).toContainText('Descarga lista')
  const path = await dl.path()
  return { name: dl.suggestedFilename(), info: await pdfInfo(path!) }
}

async function analyzeBudget(page: Page, base = '') {
  await page.goto(`${base}/demo/presupuesto`)
  await page.fill('#budgetText', BUDGET)
  await page.fill('#make', 'Fiat')
  await page.fill('#model', 'Palio')
  await page.fill('#year', '2017')
  await page.getByRole('button', { name: 'Analizar presupuesto' }).click()
  await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
}

async function analyzeSymptom(page: Page, symptom: string, occurrence = 'Al frenar') {
  await page.goto('/demo/falla')
  await page.selectOption('#vehicleType', 'sedan')
  await page.click('button:has-text("Siguiente")')
  await page.fill('#symptomText', symptom)
  await page.selectOption('#occurrence', occurrence)
  await page.click('button[type="submit"]')
  await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}

test.describe('7F — budget report PDF', () => {
  test.beforeEach(async ({ page }) => ownBucket(page))

  test('download: valid A4 PDF with the verification; repeated download makes no request at all', async ({ page }) => {
    await analyzeBudget(page)
    const requests = recordRequests(page)
    const first = await download(page)
    expect(first.name).toMatch(/^chuya-informe-presupuesto-\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(first.info.header).toBe('%PDF-')
    expect(first.info.title).toBe('Chuya Motor - Informe de revisión de presupuesto')
    for (const s of ['Informe de revisión de presupuesto', 'Verificación de importes', '$ 11.000,00', '$ 12.500,00', 'Diferencia aritmética: $ 1.500,00', 'Repuestos', '$ 8.000,00', 'Mano de obra', '$ 3.000,00', 'Partidas interpretadas', 'Presupuesto original declarado', `Página 1 de ${first.info.pages}`, 'no está certificado ni revisado por ningún taller']) expect(first.info.text).toContain(s)
    expect(first.info.text).not.toMatch(/sobreprecio|fraude|estafa/i)
    const second = await download(page)
    expect(second.info.pages).toBe(first.info.pages)
    // Only the lazily loaded PDF code may be fetched (same origin, first time); never an API or a third party.
    expect(requests.filter((r) => !/\/_next\/static\//.test(r))).toEqual([])
    await page.screenshot({ path: `${SHOTS}/budget-desktop.png`, fullPage: true })
  })

  test('offers already found by 7C are included with "Compatibilidad no verificada" and clickable URLs; no new search', async ({ page }) => {
    await analyzeBudget(page)
    let searches = 0
    // Ids are generated client-side: answer with the ids the page actually sent.
    await page.route('**/api/budget/parts-prices', async (route) => {
      searches++
      const body = route.request().postDataJSON() as { lines: Array<{ id: string; description: string }> }
      const [first, second, third] = body.lines
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok', provider: 'serpapi', truncated: false,
          items: [
            { lineId: first!.id, status: 'ok', hidden: 0, offers: [{ title: 'Aceite Sintético 10W40 x 4 L (OFERTA SINTÉTICA DE PRUEBA)', merchant: 'Tienda Sintética Uno', priceMinor: 3_270_050, currency: 'ARS', url: 'https://www.google.com.ar/shopping/product/111?prds=synthetic-1', retrievedAt: '2026-11-16T17:10:15.187Z', decision: 'candidate', codeMatch: false, missing: ['part_code'] }] },
            { lineId: second!.id, status: 'no_results', offers: [], hidden: 0 },
            { lineId: third!.id, status: 'unavailable', reason: 'timeout', offers: [], hidden: 0 },
          ],
        }),
      })
    })
    await page.getByTestId('auto-pricing-panel').getByRole('button', { name: 'Buscar publicaciones' }).click()
    await expect(page.getByTestId('auto-offer')).toHaveCount(1)
    expect(searches).toBe(1)
    const { info } = await download(page)
    await download(page)
    expect(searches).toBe(1)
    for (const s of ['Referencias comerciales encontradas automáticamente', 'Aceite Sintético 10W40 x 4 L (OFERTA SINTÉTICA DE PRUEBA)', 'Precio publicado: $ 32.700,50', 'Comercio: Tienda Sintética Uno', 'Compatibilidad no verificada', 'No es un presupuesto', 'No se encontraron publicaciones para este repuesto.', 'tardó demasiado']) expect(info.text).toContain(s)
    expect(info.links).toContain('https://www.google.com.ar/shopping/product/111?prds=synthetic-1')
  })

  test('preview with privacy options; personal data omitted by default', async ({ page }) => {
    await page.goto('/demo/presupuesto')
    await page.fill('#budgetText', `${BUDGET}\nCliente: Juan Pérez, tel 11-2345-6789`)
    await page.getByRole('button', { name: 'Analizar presupuesto' }).click()
    await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
    const panel = page.getByTestId('report-export')
    await expect(panel.getByTestId('report-personal-data')).toContainText('los omitimos')
    await panel.getByRole('button', { name: /Vista previa y privacidad/ }).click()
    const preview = panel.getByTestId('report-preview')
    await expect(preview).toContainText('[dato personal omitido]')
    await expect(preview).not.toContainText('11-2345-6789')
    await expect(preview).not.toContainText('Juan Pérez')
    const { info } = await download(page)
    expect(info.text).not.toContain('2345-6789')
    expect(info.text).not.toContain('Juan Pérez')
    await page.screenshot({ path: `${SHOTS}/budget-preview-desktop.png`, fullPage: true })
  })

  test('print shows only the report', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as unknown as { __prints: number }).__prints = 0
      window.print = () => {
        ;(window as unknown as { __prints: number }).__prints++
      }
    })
    await analyzeBudget(page)
    await page.getByTestId('report-export').getByRole('button', { name: 'Imprimir informe' }).click()
    await expect(page.locator('#chuya-print-root')).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1)
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('#chuya-print-root')).toBeVisible()
    await expect(page.getByTestId('budget-report')).toBeHidden()
    await page.screenshot({ path: `${SHOTS}/budget-print-view.png`, fullPage: true })
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await expect(page.locator('#chuya-print-root')).toHaveCount(0)
  })
})

test.describe('7F — diagnosis report PDF', () => {
  test.beforeEach(async ({ page }) => ownBucket(page))

  test('download with the (stub) AI: hypotheses as orientative, questions, AI status', async ({ page }) => {
    await analyzeSymptom(page, 'El motor hace un ruido extraño al arrancar en frío.', 'Al arrancar')
    const requests = recordRequests(page)
    const { name, info } = await download(page)
    expect(name).toMatch(/^chuya-informe-diagnostico-\d{4}-\d{2}-\d{2}\.pdf$/)
    for (const s of ['Informe de diagnóstico orientativo', 'Síntomas informados', 'El motor hace un ruido extraño al arrancar en frío.', 'Hipótesis orientativas', 'No son diagnósticos confirmados', 'Estado del análisis', 'Respuesta de demostración']) expect(info.text).toContain(s)
    expect(requests.filter((r) => !/\/_next\/static\//.test(r))).toEqual([])
    await page.screenshot({ path: `${SHOTS}/diagnosis-desktop.png`, fullPage: true })
  })

  test('critical severity is the first section of the PDF', async ({ page }) => {
    await analyzeSymptom(page, 'El vehículo apenas frena cuando piso el pedal.')
    await expect(page.locator('[data-severity="critical"]')).toBeVisible()
    const { info } = await download(page)
    expect(info.text).toContain('Advertencia de seguridad crítica')
    expect(info.text.indexOf('Advertencia de seguridad crítica')).toBeLessThan(info.text.indexOf('Estado del análisis'))
  })

  test('safety-blocked consultation: no report actions', async ({ page }) => {
    await page.goto('/demo/falla')
    await page.selectOption('#vehicleType', 'sedan')
    await page.click('button:has-text("Siguiente")')
    await page.fill('#symptomText', 'El pedal de freno se hunde cada vez más y el auto casi no frena.')
    await page.selectOption('#occurrence', 'Siempre')
    await page.click('button[type="submit"]')
    await expect(page.getByRole('alert').filter({ hasText: 'Consulta bloqueada por seguridad' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('report-export')).toHaveCount(0)
  })
})

test.describe('7F — mobile', () => {
  test.beforeEach(async ({ page }) => ownBucket(page))
  for (const width of [320, 390]) {
    test(`${width}px: actions reachable (44px), preview without horizontal scroll, PDF downloads`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await analyzeBudget(page)
      const panel = page.getByTestId('report-export')
      for (const name of ['Descargar informe PDF', 'Imprimir informe']) {
        const box = await panel.getByRole('button', { name }).boundingBox()
        expect(box!.height).toBeGreaterThanOrEqual(44)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      }
      await panel.getByRole('button', { name: /Vista previa y privacidad/ }).click()
      await expect(panel.getByTestId('report-preview')).toBeVisible()
      await noHorizontalScroll(page)
      await panel.screenshot({ path: `${SHOTS}/budget-export-${width}.png`, animations: 'disabled' })
      const { info } = await download(page)
      expect(info.text).toContain('$ 11.000,00')
    })
  }
})

test.describe('7F — AI unavailable (real server, CI only)', () => {
  test.skip(!AI_DOWN_URL, 'AI-down server runs in CI only (or set PLAYWRIGHT_AI_DOWN_BASE_URL)')
  test.beforeEach(async ({ page }) => ownBucket(page))

  test('budget report downloads with the verification and the AI status', async ({ page }) => {
    await analyzeBudget(page, AI_DOWN_URL)
    const { info } = await download(page)
    for (const s of ['$ 11.000,00', 'Diferencia aritmética: $ 1.500,00', 'La verificación de importes no usa IA']) expect(info.text).toContain(s)
    await page.screenshot({ path: `${SHOTS}/budget-ai-down-desktop.png`, fullPage: true })
  })
})
