/**
 * vehicle-selector.spec.ts — Incremento 7D.2: public selector with the REAL catalog derived from
 * the DNRPA valuation table (identification only). Runs against the CI-only catalog server
 * (playwright.config.ts, port 3002, catalog ON by default) or PLAYWRIGHT_CATALOG_BASE_URL.
 * The analysis uses the stub LLM; nothing calls a real LLM, SerpApi or any external catalog.
 * The free-text regression runs on the default server (kill switch).
 */
import { test, expect, type Locator, type Page } from '@playwright/test'

const CATALOG_URL = process.env.PLAYWRIGHT_CATALOG_BASE_URL ?? (process.env.CI ? 'http://localhost:3002' : '')
const SHOTS = 'reviews-local/screenshots/7d3-searchable-select/after'

let ipSeq = 1
async function ownBucket(page: Page) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.88.${Math.floor(Math.random() * 200)}.${ipSeq++}` })
}

/** Captures POST bodies sent to a same-origin path (requests still reach the stub server). */
function capture(page: Page, path: string) {
  const bodies: Array<Record<string, unknown>> = []
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === path && r.method() === 'POST') bodies.push(r.postDataJSON())
  })
  return bodies
}

function externalRequests(page: Page) {
  const external: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('fonts.googleapis.com') && !u.hostname.endsWith('fonts.gstatic.com')) external.push(r.url())
  })
  return external
}

async function noHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}

// 7D.3: Marca, Modelo and Versión are ONE searchable combobox each; Año stays a native select.
const brand = (page: Page) => page.getByRole('combobox', { name: 'Marca', exact: true })
const model = (page: Page) => page.getByRole('combobox', { name: 'Modelo', exact: true })
const year = (page: Page) => page.getByLabel('Año', { exact: true })
const version = (page: Page) => page.getByRole('combobox', { name: 'Versión / motor', exact: true })
const listbox = (page: Page, name: string) => page.getByRole('listbox', { name, exact: true })

/** Opens the combobox, optionally types to filter, and clicks the option (mouse/touch path). */
async function choose(page: Page, combo: Locator, name: string, option: string, search?: string) {
  await expect(combo).toBeEnabled()
  await combo.click()
  if (search !== undefined) await combo.fill(search)
  await listbox(page, name).getByRole('option', { name: option, exact: true }).click()
  await expect(combo).toHaveValue(option)
}

async function pickPalio2017(page: Page) {
  await page.getByRole('radio', { name: 'Auto' }).check()
  await choose(page, brand(page), 'Marca', 'Fiat', 'fiat')
  await choose(page, model(page), 'Modelo', 'Palio (ya no se fabrica)', 'palio')
  await year(page).selectOption('2017')
  await choose(page, version(page), 'Versión / motor', 'FIRE 1.4 8V · Sedan 5 puertas', 'fire 1.4')
}

async function submitSymptom(page: Page) {
  await page.click('button:has-text("Siguiente")')
  await page.fill('#symptomText', 'El motor hace un ruido metálico al arrancar en frío.')
  await page.selectOption('#occurrence', 'Siempre')
  await page.click('button[type="submit"]')
  await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
}

test.describe('VSE-00 kill switch (default E2E server): forms unchanged', () => {
  test('free-text fields, no selector, catalog API 404', async ({ page, request }) => {
    await page.goto('/demo/falla')
    await expect(page.locator('#vehicleType')).toBeVisible()
    await expect(page.locator('#make')).toBeVisible()
    await expect(page.getByTestId('vehicle-selector')).toHaveCount(0)
    await page.goto('/demo/presupuesto')
    await expect(page.locator('#engine')).toBeVisible()
    expect((await request.get('/api/vehicle-catalog?level=types')).status()).toBe(404)
  })
})

test.describe('VSE real catalog (DNRPA, vigencia 01/11/2026)', () => {
  test.skip(!CATALOG_URL, 'Catalog E2E server only in CI or with PLAYWRIGHT_CATALOG_BASE_URL')
  test.use({ baseURL: CATALOG_URL || undefined })
  test.beforeEach(async ({ page }) => ownBucket(page))

  test('VSE-01 /demo/falla: Auto → Fiat → Palio → 2017 → versión; IDs reach /api/analyze; no external calls', async ({ page }) => {
    const analyze = capture(page, '/api/analyze')
    const external = externalRequests(page)
    await page.goto('/demo/falla')
    await expect(page.getByTestId('vehicle-catalog-attribution')).toContainText('DNRPA')
    await expect(page.getByTestId('vehicle-catalog-attribution')).toContainText('no certifica la compatibilidad de repuestos')
    await expect(page.getByTestId('vehicle-catalog-fixture-note')).toHaveCount(0)
    await pickPalio2017(page)
    // The source does not state the fuel of this version: the question stays open, nothing assumed.
    await expect(page.locator('#fuelType')).toBeVisible()
    await submitSymptom(page)
    const v = analyze.at(-1)!['vehicle'] as Record<string, unknown>
    expect(v).toMatchObject({ vehicleType: 'sedan', make: 'Fiat', model: 'Palio', year: 2017 })
    expect(v['catalog']).toMatchObject({ typeId: 't:auto', brandId: 'b:fiat', modelId: 'm:fiat-palio' })
    expect(String((v['catalog'] as Record<string, unknown>)['versionId'])).toMatch(/^v:fiat-palio-/)
    expect(v).not.toHaveProperty('validation')
    expect(external).toEqual([])
  })

  test('VSE-02 Moto → Bajaj → Rouser: motor not informed, "No conozco el motor" does not block', async ({ page }) => {
    const analyze = capture(page, '/api/analyze')
    await page.goto('/demo/falla')
    await page.getByRole('radio', { name: 'Moto' }).check()
    await choose(page, brand(page), 'Marca', 'Bajaj', 'bajaj')
    await choose(page, model(page), 'Modelo', 'Rouser')
    await year(page).selectOption('2019')
    await version(page).click()
    await expect(listbox(page, 'Versión / motor').getByRole('option').first()).toContainText('motor no informado')
    await listbox(page, 'Versión / motor').getByRole('option', { name: 'No conozco el motor ni la versión' }).click()
    await expect(version(page)).toHaveValue('No conozco el motor ni la versión')
    await submitSymptom(page)
    expect(analyze.at(-1)!['vehicle']).toMatchObject({ vehicleType: 'motorcycle', make: 'Bajaj', model: 'Rouser', year: 2019, catalog: { engineUnknown: true } })
  })

  test('VSE-03 Pick-up → Toyota → Hilux: diesel from the version text; SUV → Peugeot → 2008 with 0 km year', async ({ page }) => {
    await page.goto('/demo/falla')
    await page.getByRole('radio', { name: 'Pick-up' }).check()
    await choose(page, brand(page), 'Marca', 'Toyota', 'toyota')
    await choose(page, model(page), 'Modelo', 'Hilux', 'hilux')
    await year(page).selectOption('2020')
    await version(page).click()
    await version(page).fill('2.8 tdi')
    await listbox(page, 'Versión / motor').getByRole('option').first().click()
    await expect(version(page)).toHaveValue(/2\.8 TDI/)
    await expect(page.getByTestId('catalog-fuel')).toContainText('Diésel')

    await page.getByRole('radio', { name: 'SUV' }).check()
    await expect(brand(page)).toHaveValue('')
    await choose(page, brand(page), 'Marca', 'Peugeot', 'peugeot')
    await choose(page, model(page), 'Modelo', '2008', '2008')
    await expect(year(page).locator('option', { hasText: '2026 (0 km)' })).toHaveCount(1)
  })

  test('VSE-04 resets: changing type / brand / model clears dependents (announced)', async ({ page }) => {
    await page.goto('/demo/falla')
    await pickPalio2017(page)
    // Reopen the same field, search and replace the value.
    await choose(page, model(page), 'Modelo', 'Cronos', 'cronos')
    await expect(year(page)).toHaveValue('')
    await expect(version(page)).toHaveValue('')
    await choose(page, brand(page), 'Marca', 'Renault', 'renault')
    await expect(model(page)).toHaveValue('')
    await expect(page.getByTestId('vehicle-selector-live')).toContainText('cambiaste la marca')
    await page.getByRole('radio', { name: 'Moto' }).check()
    await expect(brand(page)).toHaveValue('')
    await expect(page.getByTestId('vehicle-selector-live')).toContainText('cambiaste el tipo de vehículo')
  })

  test('VSE-05 search and choose in the same field (brands, models); no duplicate controls', async ({ page }) => {
    await page.goto('/demo/falla')
    await page.getByRole('radio', { name: 'Moto' }).check()
    const selector = page.getByTestId('vehicle-selector')
    await expect(selector.getByRole('combobox')).toHaveCount(4) // Marca, Modelo, Año (select), Versión
    await expect(selector.locator('select')).toHaveCount(1) // only Año
    await expect(selector.locator('input[type="search"]')).toHaveCount(0)
    await expect(page.getByLabel(/^Buscar (marca|modelo|versión)/)).toHaveCount(0)
    await brand(page).click()
    await expect(listbox(page, 'Marca').getByRole('option')).not.toHaveCount(0)
    await brand(page).fill('BAJA')
    await expect(listbox(page, 'Marca').getByRole('option')).toHaveText(['Bajaj'])
    await brand(page).press('ArrowDown')
    await brand(page).press('Enter')
    await expect(brand(page)).toHaveValue('Bajaj')
    await expect(model(page)).toBeEnabled()
    await model(page).fill('rous')
    await expect(listbox(page, 'Modelo').getByRole('option', { name: 'Rouser' })).not.toHaveCount(0)
    await expect(listbox(page, 'Modelo').getByRole('option', { name: /Dominar/ })).toHaveCount(0)
    await model(page).fill('zzzz')
    await expect(page.getByText('Ningún modelo coincide con lo que escribiste.')).toBeVisible()
  })

  test('VSE-12 keyboard only: Tab in, type, arrows, Enter, Escape, Tab out; clear resets dependents', async ({ page }) => {
    await page.goto('/demo/falla')
    await page.getByRole('radio', { name: 'Pick-up' }).check()
    await expect(brand(page)).toBeEnabled()
    await page.getByRole('radio', { name: 'Pick-up' }).focus()
    await page.keyboard.press('Tab')
    await expect(brand(page)).toBeFocused()
    await expect(brand(page)).toHaveAttribute('aria-expanded', 'false') // focus alone does not open
    await page.keyboard.type('toyo')
    await expect(brand(page)).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(brand(page)).toHaveAttribute('aria-activedescendant', /.+/)
    await page.keyboard.press('Enter')
    await expect(brand(page)).toHaveValue('Toyota')
    await expect(brand(page)).toHaveAttribute('aria-expanded', 'false')
    // Escape restores the chosen label; typed text is never a value.
    await page.keyboard.type('ford')
    await page.keyboard.press('Escape')
    await expect(brand(page)).toHaveValue('Toyota')
    // Model by keyboard, then Tab leaves the field without choosing.
    await model(page).focus()
    await page.keyboard.type('hilux')
    await page.keyboard.press('Enter')
    await expect(model(page)).toHaveValue('Hilux')
    await model(page).focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Tab')
    await expect(model(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(model(page)).toHaveValue('Hilux')
    await year(page).selectOption('2020')
    // Clear (×) on the brand: model, year and version are reset and it is announced.
    await page.getByRole('button', { name: 'Borrar marca' }).click()
    await expect(brand(page)).toHaveValue('')
    await expect(brand(page)).toBeFocused()
    await expect(model(page)).toBeDisabled()
    await expect(year(page)).toBeDisabled()
    await expect(page.getByTestId('vehicle-selector-live')).toContainText('Se borraron la marca, el modelo y el año.')
  })

  test('VSE-06 manual alternative: marked unverified; no catalog IDs sent', async ({ page }) => {
    const analyze = capture(page, '/api/analyze')
    await page.goto('/demo/falla')
    await page.getByRole('radio', { name: 'Utilitario' }).check()
    await page.getByRole('button', { name: 'No encuentro mi vehículo' }).click()
    await expect(page.getByTestId('vehicle-selector-unverified')).toContainText('No se verifican con un catálogo')
    await page.getByLabel('Marca').fill('Marca Escrita')
    await page.getByLabel('Motor (si lo sabés)').fill('1.6 16v')
    await submitSymptom(page)
    const v = analyze.at(-1)!['vehicle'] as Record<string, unknown>
    expect(v).toMatchObject({ vehicleType: 'van', make: 'Marca Escrita', engine: '1.6 16v' })
    expect(v).not.toHaveProperty('catalog')
  })

  test('VSE-07 catalog failure and offline: message + manual entry, form still usable', async ({ page, context }) => {
    await page.route('**/api/vehicle-catalog?level=brands*', (r) => r.fulfill({ status: 503, body: '{"error":"UNAVAILABLE","manualFallback":true}' }))
    await page.goto('/demo/falla')
    await page.getByRole('radio', { name: 'Auto' }).check()
    const alert = page.getByTestId('vehicle-selector-error')
    await expect(alert).toContainText('No pudimos cargar el catálogo')
    await alert.getByRole('button', { name: 'Escribir los datos a mano' }).click()
    await expect(page.getByTestId('vehicle-selector-unverified')).toBeVisible()
    await page.unroute('**/api/vehicle-catalog?level=brands*')
    await page.getByRole('button', { name: 'Volver a elegir de la lista' }).click()
    await context.setOffline(true)
    await page.getByRole('radio', { name: 'Moto' }).check()
    await expect(page.getByTestId('vehicle-selector-error')).toContainText('Sin conexión')
    await context.setOffline(false)
  })

  test('VSE-08 manipulated IDs are not validated; the API refuses malformed ones', async ({ request }) => {
    const headers = { 'x-forwarded-for': `10.89.0.${ipSeq++}` }
    // Moto model under the car type → treated as declared (the UI never builds this).
    const ok = await request.post('/api/analyze', { headers, data: { userText: 'El motor hace ruido al arrancar en frío.', vehicle: { make: 'Bajaj', catalog: { typeId: 't:auto', brandId: 'b:bajaj', modelId: 'm:bajaj-rouser' } } } })
    expect(ok.status()).toBe(200)
    const bad = await request.post('/api/analyze', { headers, data: { userText: 'El motor hace ruido al arrancar en frío.', vehicle: { catalog: { typeId: '../etc', validation: 'identity_full' } } } })
    expect(bad.status()).toBe(400)
    expect((await request.get('/api/vehicle-catalog?level=models&typeId=t:auto&brandId=b:bajaj', { headers })).status()).toBe(404)
    expect((await request.get('/api/vehicle-catalog?level=brands&typeId=t:auto%27', { headers })).status()).toBe(400)
  })

  test('VSE-09 /demo/presupuesto: selected vehicle reaches the 7B search (engine as displacement)', async ({ page }) => {
    const analyze = capture(page, '/api/analyze')
    await page.goto('/demo/presupuesto')
    await page.getByRole('tab', { name: /Consultar repuestos/ }).click()
    await page.fill('#partsText', 'Bomba de agua')
    await pickPalio2017(page)
    await page.getByRole('button', { name: 'Preparar búsqueda' }).click()
    const href = await page.getByTestId('search-link').first().getAttribute('href')
    const q = new URL(href!).searchParams.get('q')!
    expect(q).toContain('Fiat Palio')
    expect(q).toContain('1.4')
    expect(q).toContain('2017')
    expect(q).not.toContain('PALIO FIRE')
    // Quote mode: the vehicle IDs reach /api/analyze too.
    await page.getByRole('tab', { name: /Comparar presupuesto/ }).click()
    await page.fill('#budgetText', 'Bomba de agua: $ 40.000\nMano de obra: $ 25.000\nTotal: $ 65.000')
    await page.getByRole('button', { name: 'Analizar presupuesto' }).click()
    await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
    expect(analyze.at(-1)!['vehicle']).toMatchObject({ make: 'Fiat', model: 'Palio', year: 2017, catalog: { modelId: 'm:fiat-palio' } })
  })

  for (const width of [390, 320]) {
    test(`VSE-10 mobile ${width}: no overflow, 44px targets, dropdown inside the field width, touch`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/demo/falla')
      await page.getByRole('radio', { name: 'Auto' }).focus()
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('radio', { name: 'Moto' })).toBeChecked()
      // Open list: as wide as the field, inside the viewport, 44 px rows; screenshot it open.
      await brand(page).click()
      const field = (await brand(page).boundingBox())!
      const popup = (await listbox(page, 'Marca').locator('xpath=..').boundingBox())!
      expect(popup.x).toBeGreaterThanOrEqual(field.x - 1)
      expect(popup.x + popup.width).toBeLessThanOrEqual(field.x + field.width + 1)
      expect(popup.x + popup.width).toBeLessThanOrEqual(width)
      expect((await listbox(page, 'Marca').getByRole('option').first().boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await noHorizontalOverflow(page)
      await page.screenshot({ path: `${SHOTS}/falla-marca-abierta-${width}.png`, fullPage: false, animations: 'disabled' })
      await brand(page).fill('baj')
      await listbox(page, 'Marca').getByRole('option', { name: 'Bajaj' }).click()
      await expect(brand(page)).toHaveValue('Bajaj')
      await choose(page, model(page), 'Modelo', 'Rouser')
      await year(page).selectOption('2019')
      await noHorizontalOverflow(page)
      for (const control of [brand(page), model(page), year(page), version(page)]) {
        const box = await control.boundingBox()
        expect(box!.height).toBeGreaterThanOrEqual(44)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
      }
      const clear = (await page.getByRole('button', { name: 'Borrar marca' }).boundingBox())!
      expect(clear.height).toBeGreaterThanOrEqual(44)
      expect(clear.width).toBeGreaterThanOrEqual(44)
      await page.screenshot({ path: `${SHOTS}/falla-moto-${width}.png`, fullPage: true, animations: 'disabled' })
      await page.goto('/demo/presupuesto')
      await page.getByRole('tab', { name: /Consultar repuestos/ }).click()
      await pickPalio2017(page)
      await noHorizontalOverflow(page)
      await page.screenshot({ path: `${SHOTS}/presupuesto-palio-${width}.png`, fullPage: true, animations: 'disabled' })
    })
  }

  test('VSE-11 desktop screenshots', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/demo/falla')
    await pickPalio2017(page)
    await noHorizontalOverflow(page)
    await page.screenshot({ path: `${SHOTS}/falla-palio-1280.png`, fullPage: true, animations: 'disabled' })
    await page.goto('/demo/presupuesto')
    await page.getByRole('radio', { name: 'Pick-up' }).check()
    await choose(page, brand(page), 'Marca', 'Toyota', 'toyota')
    await choose(page, model(page), 'Modelo', 'Hilux', 'hilux')
    await page.screenshot({ path: `${SHOTS}/presupuesto-hilux-1280.png`, fullPage: true, animations: 'disabled' })
    await year(page).selectOption('2020')
    await version(page).click()
    await version(page).fill('2.8')
    await expect(listbox(page, 'Versión / motor').getByRole('option').first()).toBeVisible()
    // The form card has overflow-hidden: the open list must not be clipped by it.
    const notClipped = await listbox(page, 'Versión / motor').evaluate((ul) => {
      const popup = ul.parentElement!
      const r = popup.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 3)
      return r.bottom <= window.innerHeight && r.top >= 0 && !!hit && popup.contains(hit)
    })
    expect(notClipped).toBe(true)
    await noHorizontalOverflow(page)
    await page.screenshot({ path: `${SHOTS}/presupuesto-version-abierta-1280.png`, fullPage: true, animations: 'disabled' })
  })
})
