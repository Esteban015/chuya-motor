/**
 * report-share.spec.ts — Incremento 7G: parts research PDF ("Consultar repuestos") and
 * "Compartir informe" on the three report variants.
 *
 * Web Share is SIMULATED with an init script (navigator.share / canShare record the shared file),
 * or removed to exercise the fallback, so the result does not depend on the test browser. The PDF
 * is generated in the page and inspected here. Offers are simulated with page.route(); nothing
 * external is contacted and no API is called while exporting or sharing (no Groq, no SerpApi, no
 * quota). Screenshots go to the git-ignored reviews-local/screenshots/7g-share-reports.
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib'

const SHOTS = 'reviews-local/screenshots/7g-share-reports'
const PARTS = 'Filtro de aire\nPastillas de freno delanteras'
const winAnsi = new TextDecoder('windows-1252')

let ipSeq = 1
async function ownBucket(page: Page) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.92.${Math.floor(Math.random() * 200)}.${ipSeq++}` })
}

async function inspect(bytes: Buffer) {
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

/** Requests from now on, excluding the lazily loaded static JS (same origin). */
function apiRequests(page: Page) {
  const urls: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (u.startsWith('blob:') || u.startsWith('data:') || /\/_next\/static\//.test(u)) return
    urls.push(`${r.method()} ${u}`)
  })
  return urls
}

/** Simulated Web Share API level 2: records each shared file (base64) and the share data. */
async function simulateShare(page: Page, mode: 'ok' | 'cancel' = 'ok') {
  await page.addInitScript((m) => {
    const w = window as unknown as { __shared: Array<{ name: string; type: string; title?: string; text?: string; url?: string; b64: string }> }
    w.__shared = []
    Object.defineProperty(Navigator.prototype, 'canShare', { configurable: true, value: (d: ShareData) => Array.isArray(d?.files) && d.files.every((f) => f.type === 'application/pdf') })
    Object.defineProperty(Navigator.prototype, 'share', {
      configurable: true,
      value: (d: ShareData) => {
        if (!navigator.userActivation?.isActive) return Promise.reject(new DOMException('no user activation', 'NotAllowedError'))
        if (m === 'cancel') return Promise.reject(new DOMException('Share canceled', 'AbortError'))
        const f = d.files![0]!
        return f.arrayBuffer().then((buf) => {
          let s = ''
          new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)))
          w.__shared.push({ name: f.name, type: f.type, title: d.title, text: d.text, url: d.url, b64: btoa(s) })
        })
      },
    })
  }, mode)
}

async function removeShare(page: Page) {
  await page.addInitScript(() => {
    Reflect.deleteProperty(Navigator.prototype, 'share')
    Reflect.deleteProperty(Navigator.prototype, 'canShare')
  })
}

async function shareNow(page: Page) {
  const panel = page.getByTestId('report-export')
  const button = panel.getByRole('button', { name: 'Compartir informe' })
  await expect(button).toBeEnabled()
  // The PDF is prepared ahead (debounced) on share-capable devices.
  await expect(button).toHaveAttribute('data-ready', 'true', { timeout: 10_000 })
  await button.click()
  const status = panel.getByTestId('report-export-status')
  await expect(status).toContainText(/Informe compartido|de nuevo|No se compartió/)
  if (/de nuevo/.test((await status.textContent()) ?? '')) {
    await button.click()
    await expect(status).toContainText(/Informe compartido|No se compartió/)
  }
}

async function sharedFiles(page: Page) {
  const shared = await page.evaluate(() => (window as unknown as { __shared: Array<{ name: string; type: string; title?: string; text?: string; url?: string; b64: string }> }).__shared)
  return Promise.all(shared.map(async (s) => ({ ...s, info: await inspect(Buffer.from(s.b64, 'base64')) })))
}

async function download(page: Page) {
  const panel = page.getByTestId('report-export')
  const [dl] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Descargar informe PDF' }).click()])
  await expect(panel.getByTestId('report-export-status')).toContainText('Descarga lista')
  return { name: dl.suggestedFilename(), info: await inspect(readFileSync((await dl.path())!)) }
}

async function runParts(page: Page) {
  await page.goto('/demo/presupuesto')
  await page.getByRole('tab', { name: /Consultar repuestos/ }).click()
  await page.fill('#partsText', PARTS)
  await page.fill('#make', 'Fiat')
  await page.fill('#model', 'Palio')
  await page.fill('#year', '2017')
  await page.fill('#engine', '1.4 8v')
  await page.getByRole('button', { name: 'Preparar búsqueda' }).click()
  await expect(page.getByTestId('parts-results')).toBeVisible()
}

async function addReference(page: Page) {
  const card = page.getByTestId('part-card').filter({ hasText: 'Filtro de aire' })
  await card.getByRole('button', { name: /Agregar referencia/ }).click()
  const form = card.getByTestId('reference-form')
  await form.getByLabel('Comercio o plataforma *').fill('Repuestera Sintética')
  await form.getByLabel('Precio en pesos *').fill('9500')
  await form.getByLabel('Enlace (opcional)').fill('https://www.ejemplo-sintetico.com.ar/filtro?id=7&utm_source=wpp&email=yo@correo.com#token=abc')
  await form.getByLabel(/No lo sé todavía/).check()
  await form.getByRole('button', { name: 'Guardar referencia' }).click()
}

/** Simulated 7C answer using the ids the page actually sent: offer / no results. */
async function mockPricing(page: Page) {
  let calls = 0
  await page.route('**/api/budget/parts-prices', async (route) => {
    calls++
    const { lines } = route.request().postDataJSON() as { lines: Array<{ id: string }> }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok', provider: 'serpapi', truncated: false,
        items: [
          { lineId: lines[0]!.id, status: 'ok', hidden: 0, offers: [{ title: 'Filtro De Aire Fiat Palio 1.4 (OFERTA SINTÉTICA DE PRUEBA)', merchant: 'Tienda Sintética Uno', priceMinor: 1_250_000, currency: 'ARS', url: 'https://www.google.com.ar/shopping/product/222?prds=synthetic-2&utm_campaign=x', retrievedAt: '2026-11-16T17:10:15.187Z', decision: 'candidate', codeMatch: false, missing: ['part_code'] }] },
          { lineId: lines[1]!.id, status: 'unavailable', reason: 'timeout', offers: [], hidden: 0 },
        ],
      }),
    })
  })
  return () => calls
}

test.describe('7G — parts research report', () => {
  test.beforeEach(async ({ page }) => ownBucket(page))

  test('PDF with vehicle, parts, own reference, offers and states; sanitized links; no sums; no API call', async ({ page }) => {
    await removeShare(page)
    await runParts(page)
    await addReference(page)
    const pricingCalls = await mockPricing(page)
    await page.getByTestId('auto-pricing-panel').getByRole('button', { name: 'Buscar publicaciones' }).click()
    await expect(page.getByTestId('auto-offer')).toHaveCount(1)
    expect(pricingCalls()).toBe(1)

    const requests = apiRequests(page)
    const { name, info } = await download(page)
    await download(page)
    expect(name).toMatch(/^chuya-informe-repuestos-\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(info.header).toBe('%PDF-')
    expect(info.title).toBe('Chuya Motor - Informe de consulta de repuestos')
    for (const s of [
      'Informe de consulta de repuestos', 'Compatibilidad no verificada', 'Los precios no se suman', 'Fiat', 'Palio', '1.4 8v', 'Repuestos consultados',
      'Repuesto: Filtro de aire', 'Repuesto: Pastillas de freno delanteras', 'Repuestera Sintética', 'Precio: $ 9.500,00',
      'Filtro De Aire Fiat Palio 1.4 (OFERTA SINTÉTICA DE PRUEBA)', 'Precio publicado: $ 12.500,00', 'Comercio: Tienda Sintética Uno',
      'Búsqueda automática: publicaciones encontradas', 'Búsqueda automática: proveedor no disponible', 'tardó demasiado', 'Preguntas para el taller',
      'conviene que la instalación la haga un taller',
    ]) expect(info.text).toContain(s)
    expect(info.text).not.toMatch(/\$ 22\.000,00|promedio|sobreprecio/) // 9.500 + 12.500 never added up
    expect(info.links).toContain('https://www.ejemplo-sintetico.com.ar/filtro?id=7')
    expect(info.links).toContain('https://www.google.com.ar/shopping/product/222?prds=synthetic-2')
    expect(info.links.join(' ')).not.toMatch(/utm_|email=|token=/)
    expect(requests).toEqual([])
    expect(pricingCalls()).toBe(1)
    await expect(page.getByTestId('report-share-unsupported')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/parts-fallback-desktop.png`, fullPage: true })
  })

  test('without any search: partial information is explicit', async ({ page }) => {
    await runParts(page)
    const { info } = await download(page)
    expect(info.text).toContain('Información parcial')
    expect(info.text).toContain('Búsqueda automática: búsqueda no realizada')
  })
})

test.describe('7G — share (simulated Web Share API with files)', () => {
  test.beforeEach(async ({ page }) => ownBucket(page))

  test('parts: shares the PDF file itself (no URL, generic text), within the click; no API call', async ({ page }) => {
    await simulateShare(page)
    await runParts(page)
    const requests = apiRequests(page)
    await expect(page.getByTestId('report-share-note')).toContainText('bajo sus propias condiciones')
    await shareNow(page)
    const [shared] = await sharedFiles(page)
    expect(shared!.name).toMatch(/^chuya-informe-repuestos-\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(shared!.type).toBe('application/pdf')
    expect(shared!.title).toBe('Informe de consulta de repuestos')
    expect(shared!.text).toBe('Informe de Chuya Motor para el taller (PDF).')
    expect(shared!.url).toBeUndefined()
    expect(shared!.info.header).toBe('%PDF-')
    expect(shared!.info.text).toContain('Repuesto: Pastillas de freno delanteras')
    expect(requests).toEqual([])
  })

  test('budget and diagnosis can be shared too; their downloads still work', async ({ page }) => {
    await simulateShare(page)
    await page.goto('/demo/presupuesto')
    await page.fill('#budgetText', 'Aceite motor: 4500\nFiltro de aire: 1500\nFiltro de aceite: 2000\nMano de obra: 3000\nTotal: 12500')
    await page.getByRole('button', { name: 'Analizar presupuesto' }).click()
    await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
    await shareNow(page)
    expect((await download(page)).info.text).toContain('$ 11.000,00')

    await page.goto('/demo/falla')
    await page.selectOption('#vehicleType', 'sedan')
    await page.click('button:has-text("Siguiente")')
    await page.fill('#symptomText', 'El vehículo apenas frena cuando piso el pedal.')
    await page.selectOption('#occurrence', 'Al frenar')
    await page.click('button[type="submit"]')
    await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
    await shareNow(page)
    const shared = await sharedFiles(page)
    expect(shared.map((s) => s.name.replace(/-\d{4}-\d{2}-\d{2}\.pdf$/, ''))).toEqual(['chuya-informe-diagnostico'])
    // Safety warnings are never left out of a shared report.
    expect(shared[0]!.info.text).toContain('Advertencia de seguridad crítica')
    expect((await download(page)).info.text).toContain('Informe de diagnóstico orientativo')
  })

  test('cancelling the share sheet is not an error', async ({ page }) => {
    await simulateShare(page, 'cancel')
    await runParts(page)
    await shareNow(page)
    const status = page.getByTestId('report-export').getByTestId('report-export-status')
    await expect(status).toContainText('No se compartió el informe')
    await expect(status.locator('.text-red-700')).toHaveCount(0)
  })
})

test.describe('7G — mobile', () => {
  test.beforeEach(async ({ page }) => ownBucket(page))
  for (const width of [320, 390]) {
    test(`${width}px parts tab: three actions reachable (44px), no horizontal scroll, share works`, async ({ page }) => {
      await simulateShare(page)
      await page.setViewportSize({ width, height: 900 })
      await runParts(page)
      const panel = page.getByTestId('report-export')
      for (const name of ['Descargar informe PDF', 'Compartir informe', 'Imprimir informe']) {
        const box = await panel.getByRole('button', { name }).boundingBox()
        expect(box!.height).toBeGreaterThanOrEqual(44)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      }
      await panel.getByRole('button', { name: /Vista previa y privacidad/ }).click()
      await expect(panel.getByTestId('report-preview')).toContainText('Informe de consulta de repuestos')
      await noHorizontalScroll(page)
      await panel.screenshot({ path: `${SHOTS}/parts-share-${width}.png`, animations: 'disabled' })
      await shareNow(page)
      expect(await sharedFiles(page)).toHaveLength(1)
      await panel.getByTestId('report-export-status').screenshot({ path: `${SHOTS}/parts-share-status-${width}.png`, animations: 'disabled' })
    })
  }
})

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}
