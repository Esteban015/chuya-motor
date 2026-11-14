/**
 * budget-research.spec.ts — Incremento 7B (Presupuestos 2.0): parts research + quote comparison.
 *
 * Stub server only (LLM_PROVIDER=stub). Mode A never calls /api/analyze; Mode B calls it once,
 * exactly like before. Google is never contacted: search links are asserted, not opened.
 * Screenshots go to the git-ignored reviews-local/screenshots/7b-budget.
 */
import { test, expect, type Page } from '@playwright/test'

const SHOTS = 'reviews-local/screenshots/7b-budget'
const PART_A = 'Manguera de respiración de gases'
const EXPECTED_QUERY = 'Manguera de respiración de gases Fiat Palio 1.4 8v 2017 Argentina'
const EXPECTED_SEARCH = `https://www.google.com/search?q=${encodeURIComponent(EXPECTED_QUERY)}&hl=es-419&gl=ar`
const PRICE_JUDGEMENT = /\bcaro\b|barato|precio justo(?! de mercado)|excesiv|razonable|cobra de m[aá]s|sobreprecio/i

let ipSeq = 1
async function ownBucket(page: Page) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.88.${Math.floor(Math.random() * 200)}.${ipSeq++}` })
}

function watch(page: Page) {
  const analyze: string[] = []
  const insights: string[] = []
  const external: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.pathname === '/api/analyze') analyze.push(r.method())
    if (u.pathname.startsWith('/_vercel/insights')) insights.push(r.url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('fonts.googleapis.com') && !u.hostname.endsWith('fonts.gstatic.com')) external.push(r.url())
  })
  return { analyze, insights, external }
}

async function fillVehicle(page: Page) {
  await page.fill('#make', 'Fiat')
  await page.fill('#model', 'Palio')
  await page.fill('#year', '2017')
  await page.fill('#engine', '1.4 8v')
}

async function runPartsA(page: Page) {
  await page.goto('/demo/presupuesto')
  await page.getByRole('tab', { name: /Consultar repuestos/ }).click()
  await page.fill('#partsText', PART_A)
  await fillVehicle(page)
  await page.getByRole('button', { name: 'Preparar búsqueda' }).click()
  await expect(page.getByTestId('parts-results')).toBeVisible()
}

async function runQuoteB(page: Page) {
  await page.goto('/demo/presupuesto')
  await page.fill('#budgetText', `${PART_A}: 18000\nMano de obra: 12000`)
  await fillVehicle(page)
  await page.getByRole('button', { name: 'Analizar presupuesto' }).click()
  await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
}

async function addReference(page: Page, data: { store: string; price: string; compat: RegExp; url?: string; quantity?: string; presentation?: string }) {
  const card = page.getByTestId('part-card').filter({ hasText: PART_A })
  await card.getByRole('button', { name: /Agregar referencia/ }).click()
  const form = card.getByTestId('reference-form')
  await form.getByLabel('Comercio o plataforma *').fill(data.store)
  await form.getByLabel('Precio en pesos *').fill(data.price)
  if (data.quantity) await form.getByLabel('Cantidad que incluye ese precio *').fill(data.quantity)
  if (data.presentation) await form.getByLabel('Presentación *').selectOption(data.presentation)
  if (data.url !== undefined) await form.getByLabel('Enlace (opcional)').fill(data.url)
  await form.getByLabel(data.compat).check()
  await form.getByRole('button', { name: 'Guardar referencia' }).click()
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}

test.describe('BR-01 tabs', () => {
  test('two accessible tabs; quote mode is the default (route unchanged); arrow keys switch', async ({ page }) => {
    await page.goto('/demo/presupuesto')
    const tablist = page.getByRole('tablist', { name: 'Modo de análisis del presupuesto' })
    await expect(tablist.getByRole('tab')).toHaveCount(2)
    const parts = page.getByRole('tab', { name: /Consultar repuestos/ })
    const quote = page.getByRole('tab', { name: /Comparar presupuesto/ })
    await expect(quote).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', await quote.getAttribute('id') as string)
    await expect(page.locator('#budgetText')).toBeVisible()
    await quote.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(parts).toHaveAttribute('aria-selected', 'true')
    await expect(parts).toBeFocused()
    await expect(page.locator('#partsText')).toBeVisible()
    await page.keyboard.press('End')
    await expect(quote).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('BR-02 Scenario A — parts without prices (local, no LLM)', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('part identified, Google search available, no invented prices, no API call, nothing to Analytics', async ({ page }) => {
    const net = watch(page)
    const urlBefore = '/demo/presupuesto'
    await runPartsA(page)
    const card = page.getByTestId('part-card').filter({ hasText: PART_A })
    await expect(card).toHaveCount(1)
    await expect(card.getByTestId('search-link')).toHaveAttribute('href', EXPECTED_SEARCH)
    await expect(card.getByTestId('search-link')).toHaveAttribute('target', '_blank')
    await expect(card.getByTestId('search-link')).toHaveAttribute('rel', /noopener/)
    await expect(card).not.toContainText('$')
    await expect(card).toContainText('Sin referencias')
    await expect(page.getByTestId('parts-results')).toContainText('Chuya Motor no los verificó')
    await card.getByText('Qué verificar antes de comprar').click()
    await expect(card).toContainText(/Diámetro, largo, forma/)

    expect(net.analyze).toEqual([])
    expect(net.external).toEqual([])
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(urlBefore)
    for (const u of net.insights) expect(decodeURIComponent(u)).not.toMatch(/Manguera|Palio|respiraci/i)
    await expect(page.getByTestId('feedback-invite')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/A-desktop-1280.png`, fullPage: true, animations: 'disabled' })
  })

  test('a user reference is labeled as unverified and never compared in parts mode', async ({ page }) => {
    await runPartsA(page)
    await addReference(page, { store: 'Casa de repuestos', price: '15.000', compat: /No lo sé todavía/, url: 'https://articulo.mercadolibre.com.ar/MLA-1' })
    const item = page.getByTestId('reference-item')
    await expect(item).toContainText('$ 15.000,00')
    await expect(item).toContainText('Informada por el usuario, sin verificación independiente')
    await expect(item).toContainText('Coincidencia no verificada')
    await expect(item.getByRole('link', { name: /Ver publicación/ })).toHaveAttribute('href', 'https://articulo.mercadolibre.com.ar/MLA-1')
    await expect(item.locator('[data-comparison]')).toHaveCount(0)
  })

  test('edit the list and come back: text kept, references kept', async ({ page }) => {
    await runPartsA(page)
    await addReference(page, { store: 'Comercio X', price: '9000', compat: /No lo sé todavía/ })
    await page.getByRole('button', { name: '← Editar la lista' }).click()
    await expect(page.locator('#partsText')).toHaveValue(PART_A)
    await expect(page.locator('#engine')).toHaveValue('1.4 8v')
    await page.fill('#partsText', `${PART_A}\nFiltro de aceite`)
    await page.getByRole('button', { name: 'Preparar búsqueda' }).click()
    await expect(page.getByTestId('part-card')).toHaveCount(2)
    await expect(page.getByTestId('reference-item')).toContainText('Comercio X')
  })

  test('DIY intent is blocked by the same Safety Gate (no search links)', async ({ page }) => {
    await page.goto('/demo/presupuesto')
    await page.getByRole('tab', { name: /Consultar repuestos/ }).click()
    await page.fill('#partsText', 'Cómo cambio las pastillas de freno yo mismo')
    await page.getByRole('button', { name: 'Preparar búsqueda' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Consulta bloqueada por seguridad' })).toBeVisible()
    await expect(page.getByTestId('search-link')).toHaveCount(0)
  })

  test('brake parts list is not blocked and recommends professional installation', async ({ page }) => {
    await page.goto('/demo/presupuesto')
    await page.getByRole('tab', { name: /Consultar repuestos/ }).click()
    await page.fill('#partsText', 'Pastillas de freno delanteras')
    await page.getByRole('button', { name: 'Preparar búsqueda' }).click()
    const card = page.getByTestId('part-card')
    await card.getByText('Qué verificar antes de comprar').click()
    await expect(card).toContainText('conviene que la instalación la haga un taller')
  })
})

test.describe('BR-03 Scenario B — compare a quote', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('part separated from labor, sum verified once, search, no opinion on labor', async ({ page }) => {
    await ownBucket(page)
    const net = watch(page)
    await runQuoteB(page)
    expect(net.analyze).toEqual(['POST'])
    await expect(page.getByTestId('budget-totals')).toContainText('$ 30.000,00')

    const ws = page.getByTestId('research-workspace')
    const card = ws.getByTestId('part-card')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText(PART_A)
    await expect(card.getByTestId('workshop-price')).toContainText('$ 18.000,00')
    await expect(card.getByTestId('search-link')).toHaveAttribute('href', EXPECTED_SEARCH)

    const labor = ws.getByTestId('labor-lines')
    await expect(labor).toContainText('Mano de obra')
    await expect(labor).toContainText('$ 12.000,00')
    await expect(ws).toContainText('no se compara con referencias externas')
    await expect(page.getByTestId('budget-report')).not.toContainText(PRICE_JUDGEMENT)
    await expect(ws.getByTestId('list-sum')).toContainText('$ 30.000,00')
    await page.screenshot({ path: `${SHOTS}/B-desktop-1280.png`, fullPage: true, animations: 'disabled' })
  })

  test('difference shown only for a confirmed equivalent reference; unverified and set-vs-unit are not compared', async ({ page }) => {
    await ownBucket(page)
    await runQuoteB(page)
    await addReference(page, { store: 'Tienda A', price: '15.000', compat: /No lo sé todavía/ })
    await expect(page.locator('[data-comparison="not_comparable"][data-reason="unverified"]')).toContainText('Coincidencia no verificada')

    await addReference(page, { store: 'Tienda B', price: '15.000', compat: /Sí, confirmé que es la misma/ })
    const compared = page.locator('[data-comparison="compared"]')
    await expect(compared).toHaveCount(1)
    await expect(compared).toContainText('Diferencia con esta referencia: $ 3.000,00 (+20,0 %)')
    await expect(compared).toContainText('No indica que el taller cobre de más')

    await addReference(page, { store: 'Tienda C', price: '40.000', compat: /Sí, confirmé que es la misma/, presentation: 'set' })
    await expect(page.locator('[data-reason="presentation_mismatch"]')).toContainText('unidad contra juego')
    await expect(page.getByTestId('budget-report')).not.toContainText(PRICE_JUDGEMENT)
    await expect(page.getByTestId('budget-report')).not.toContainText(/promedio|precio mínimo/i)
    await page.screenshot({ path: `${SHOTS}/B-references-1280.png`, fullPage: true, animations: 'disabled' })
  })

  test('malicious reference URL is rejected and never rendered as a link', async ({ page }) => {
    await ownBucket(page)
    await runQuoteB(page)
    const card = page.getByTestId('part-card')
    await card.getByRole('button', { name: /Agregar referencia/ }).click()
    const form = card.getByTestId('reference-form')
    await form.getByLabel('Comercio o plataforma *').fill('X')
    await form.getByLabel('Precio en pesos *').fill('1000')
    await form.getByLabel('Enlace (opcional)').fill('javascript:alert(1)')
    await form.getByRole('button', { name: 'Guardar referencia' }).click()
    await expect(form.getByRole('alert')).toContainText('https://')
    await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0)
    await expect(page.getByTestId('reference-item')).toHaveCount(0)
  })

  test('"Corregir el presupuesto" keeps the text; feedback stays last', async ({ page }) => {
    await ownBucket(page)
    await runQuoteB(page)
    // Feedback after the research section and the actions (the dev-only trace viewer may follow).
    const ws = (await page.getByTestId('research-workspace').boundingBox())!
    const actions = (await page.getByRole('navigation', { name: 'Acciones del informe' }).boundingBox())!
    const feedback = (await page.getByTestId('feedback-invite').boundingBox())!
    expect(actions.y).toBeGreaterThan(ws.y + ws.height - 1)
    expect(feedback.y).toBeGreaterThan(actions.y)
    await page.getByRole('button', { name: '← Corregir el presupuesto' }).click()
    await expect(page.locator('#budgetText')).toHaveValue(`${PART_A}: 18000\nMano de obra: 12000`)
    await expect(page.locator('#engine')).toHaveValue('1.4 8v')
  })
})

for (const width of [390, 320]) {
  test.describe(`BR-04 mobile ${width}`, () => {
    test.use({ viewport: { width, height: 844 } })

    test('both modes: one column, readable, no horizontal scroll', async ({ page }) => {
      await page.goto('/demo/presupuesto')
      await noHorizontalScroll(page)
      await runPartsA(page)
      await noHorizontalScroll(page)
      await page.screenshot({ path: `${SHOTS}/A-mobile-${width}.png`, fullPage: true, animations: 'disabled' })

      await ownBucket(page)
      await runQuoteB(page)
      await addReference(page, { store: 'Tienda B', price: '15.000', compat: /Sí, confirmé que es la misma/ })
      await expect(page.locator('[data-comparison="compared"]')).toBeVisible()
      await noHorizontalScroll(page)
      const card = (await page.getByTestId('part-card').boundingBox())!
      expect(card.x + card.width).toBeLessThanOrEqual(width)
      await page.screenshot({ path: `${SHOTS}/B-mobile-${width}.png`, fullPage: true, animations: 'disabled' })
    })
  })
}

// ── Final audit: adversarial inputs (parts mode is local, no API) ────────────

test.describe('BR-05 adversarial — parts mode', () => {
  async function submitParts(page: Page, text: string) {
    await page.goto('/demo/presupuesto')
    await page.getByRole('tab', { name: /Consultar repuestos/ }).click()
    await page.fill('#partsText', text)
    await page.getByRole('button', { name: 'Preparar búsqueda' }).click()
  }

  for (const text of ['Cómo anular el sensor de frenos', 'Pastillas de freno\nCómo desconectar el ABS para que no frene', 'Cómo reparar yo mismo una fuga de combustible']) {
    test(`blocked, no search link: ${text.replace(/\n/g, ' / ')}`, async ({ page }) => {
      const net = watch(page)
      await submitParts(page, text)
      await expect(page.getByRole('alert').filter({ hasText: 'Consulta bloqueada por seguridad' })).toBeVisible()
      await expect(page.getByTestId('search-link')).toHaveCount(0)
      expect(net.analyze).toEqual([])
    })
  }

  for (const text of ['Pastillas de freno Fiat Palio 2017', 'Precio de bomba de nafta Fiat Palio']) {
    test(`legitimate commercial query allowed: ${text}`, async ({ page }) => {
      await submitParts(page, text)
      await expect(page.getByTestId('search-link')).toHaveCount(1)
    })
  }

  test('a line that is not a part is a form error (no search built)', async ({ page }) => {
    await submitParts(page, 'Filtro de aceite\n¿Dónde queda el taller más cercano?')
    await expect(page.getByRole('alert').filter({ hasText: 'no parecen nombres de repuestos' })).toBeVisible()
    await expect(page.getByTestId('parts-results')).toHaveCount(0)
    await expect(page.locator('#partsText')).toHaveValue('Filtro de aceite\n¿Dónde queda el taller más cercano?')
  })

  test('adding or editing a part after the check is screened again', async ({ page }) => {
    await submitParts(page, 'Filtro de aceite')
    await page.getByLabel('Nombre del repuesto a agregar').fill('Cómo desconectar el ABS')
    await page.getByRole('button', { name: 'Agregar repuesto' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'no generamos búsquedas' })).toBeVisible()
    await expect(page.getByTestId('part-card')).toHaveCount(1)

    const card = page.getByTestId('part-card')
    await card.getByRole('button', { name: /^Editar/ }).click()
    await card.getByLabel('Descripción').fill('Cómo anular el sensor de frenos')
    await expect(card.getByTestId('search-link')).toHaveCount(0)
    await expect(card.getByTestId('search-unavailable')).toHaveAttribute('data-reason', 'unsafe')
  })
})

test.describe('BR-06 mobile 320 — interactions', () => {
  test.use({ viewport: { width: 320, height: 740 } })

  test('switch tabs, edit and delete parts, add a reference, compare; no horizontal scroll at any step', async ({ page }) => {
    await ownBucket(page)
    await page.goto('/demo/presupuesto')
    await page.getByRole('tab', { name: /Consultar repuestos/ }).click()
    await expect(page.locator('#partsText')).toBeVisible()
    await page.getByRole('tab', { name: /Comparar presupuesto/ }).click()
    await expect(page.locator('#budgetText')).toBeVisible()
    await noHorizontalScroll(page)

    await page.fill('#budgetText', `${PART_A}: 18000\nFiltro de aceite: 6000\nMano de obra: 12000`)
    await fillVehicle(page)
    await page.getByRole('button', { name: 'Analizar presupuesto' }).click()
    await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('part-card')).toHaveCount(2)

    // Edit quantity/presentation, then delete a part.
    const filter = page.getByTestId('part-card').filter({ hasText: 'Filtro de aceite' })
    await filter.getByRole('button', { name: /^Editar/ }).click()
    await filter.getByLabel('Cantidad', { exact: true }).fill('2')
    await noHorizontalScroll(page)
    await filter.getByRole('button', { name: /^Listo/ }).click()
    await expect(filter).toContainText('2 × unidad')
    await filter.getByRole('button', { name: /^Eliminar Filtro/ }).click()
    await expect(page.getByTestId('part-card')).toHaveCount(1)

    await addReference(page, { store: 'Tienda con un nombre bastante largo para probar', price: '15.000', compat: /Sí, confirmé que es la misma/, url: 'https://articulo.mercadolibre.com.ar/MLA-123456789-manguera-respiracion-fiat-palio' })
    await expect(page.locator('[data-comparison="compared"]')).toBeVisible()
    await expect(page.getByTestId('reference-item')).toContainText('Informada por el usuario, sin verificación independiente')
    await noHorizontalScroll(page)
    for (const el of await page.locator('[data-testid="reference-item"], [data-comparison]').all()) {
      const b = (await el.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(320)
    }
    await page.screenshot({ path: `${SHOTS}/audit-mobile-320.png`, fullPage: true, animations: 'disabled' })
  })
})
