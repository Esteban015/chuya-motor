/**
 * parts-pricing.spec.ts — Incremento 7C: automatic search of published part offers (feature flag).
 *
 * The E2E server runs with PARTS_PRICING_ENABLED=true and PARTS_PRICING_PROVIDER=none (see
 * playwright.config.ts): the UI exists, but the server can NEVER call SerpApi (no provider is
 * selected even if .env.local holds a key). Successful searches and provider failures are
 * simulated with page.route() and SYNTHETIC offers. Nothing external is contacted.
 * Screenshots go to the git-ignored reviews-local/screenshots/7c-parts-pricing.
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const SHOTS = 'reviews-local/screenshots/7c-parts-pricing'
const ENDPOINT = '**/api/budget/parts-prices'
const PARTS = 'Pastillas de freno delanteras\nFiltro de aire'
const JUDGEMENT = /promedio|sobreprecio|cobra de m[aá]s|m[aá]s caro|m[aá]s barato|es compatible/i

const SYNTHETIC_OK = {
  status: 'ok',
  provider: 'serpapi',
  truncated: false,
  items: [
    {
      lineId: 'l1', status: 'ok', hidden: 1,
      offers: [
        { title: 'Pastillas De Freno Delantera Fiat Palio 1997+ - Marca Sintética 0001 (OFERTA SINTÉTICA DE PRUEBA)', merchant: 'Tienda Sintética Uno', priceMinor: 3_270_000, currency: 'ARS', url: 'https://www.google.com.ar/search?ibp=oshop&prds=synthetic-1', retrievedAt: '2026-11-14T17:10:15.187Z', decision: 'candidate', codeMatch: false, missing: ['part_code', 'presentation', 'condition'] },
        { title: 'Pastilla Freno Palio Fase 1-2-3-4 Original (OFERTA SINTÉTICA DE PRUEBA)', merchant: 'Tienda Sintética Dos', priceMinor: 19_029_784, currency: 'ARS', url: 'https://www.google.com.ar/search?ibp=oshop&prds=synthetic-2', retrievedAt: '2026-11-14T17:10:15.187Z', decision: 'needs_review', codeMatch: false, missing: ['part_code', 'presentation', 'condition', 'year'] },
      ],
    },
    { lineId: 'l2', status: 'no_results', offers: [], hidden: 0 },
  ],
}

let ipSeq = 1
async function ownBucket(page: Page) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 200)}.${ipSeq++}` })
}

function watch(page: Page) {
  const pricing: string[] = []
  const external: string[] = []
  const insights: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.pathname === '/api/budget/parts-prices') pricing.push(r.method())
    if (u.pathname.startsWith('/_vercel/insights')) insights.push(r.url() + (r.postData() ?? ''))
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('fonts.googleapis.com') && !u.hostname.endsWith('fonts.gstatic.com')) external.push(r.url())
  })
  return { pricing, external, insights }
}

async function openParts(page: Page) {
  await page.goto('/demo/presupuesto')
  await page.getByRole('tab', { name: /Consultar repuestos/ }).click()
  await page.fill('#partsText', PARTS)
  await page.fill('#make', 'Fiat')
  await page.fill('#model', 'Palio')
  await page.fill('#year', '2017')
  await page.getByRole('button', { name: 'Preparar búsqueda' }).click()
  await expect(page.getByTestId('auto-pricing-panel')).toBeVisible()
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}

test.beforeEach(async ({ page }) => ownBucket(page))

test.describe('PP-E2E-01 panel and explicit search', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('identified parts listed; no request until the click; synthetic offers with labels and missing data; manual search kept', async ({ page }) => {
    const net = watch(page)
    let body: unknown = null
    await page.route(ENDPOINT, async (route: Route) => {
      body = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SYNTHETIC_OK) })
    })
    await openParts(page)
    const panel = page.getByTestId('auto-pricing-panel')
    await expect(panel.getByTestId('auto-parts').getByRole('listitem')).toHaveText(['Pastillas de freno delanteras', 'Filtro de aire'])
    // Re-render triggers (typing a reference form, toggling details) never search.
    await page.getByTestId('part-card').first().getByText('Qué verificar antes de comprar').click()
    expect(net.pricing).toEqual([])

    await panel.getByRole('button', { name: 'Buscar publicaciones' }).click()
    await expect(panel.getByTestId('auto-results')).toBeVisible()
    expect(net.pricing).toEqual(['POST'])
    expect(Object.keys(body as object).sort()).toEqual(['lines', 'vehicle'])

    const offers = panel.getByTestId('auto-offer')
    await expect(offers).toHaveCount(2)
    await expect(offers.first()).toContainText('Compatibilidad no verificada')
    await expect(offers.first()).toContainText('$ 32.700,00')
    await expect(offers.first()).toContainText('Tienda Sintética Uno')
    await expect(offers.first()).toContainText(/Consultado: 14\/11\/(20)?26/)
    await expect(offers.first().getByTestId('auto-offer-missing')).toContainText('Presentación: unidad, par o juego')
    const link = offers.first().getByRole('link', { name: /Ver publicación/ })
    await expect(link).toHaveAttribute('href', 'https://www.google.com.ar/search?ibp=oshop&prds=synthetic-1')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    await expect(panel).toContainText('Ocultamos 1 publicación que no menciona el modelo')
    await expect(panel).toContainText('No encontramos publicaciones')
    await expect(panel).not.toContainText(JUDGEMENT)

    // Same parts → no second search.
    await expect(panel.getByRole('button', { name: 'Búsqueda realizada' })).toBeDisabled()
    expect(net.pricing).toEqual(['POST'])
    // Manual 7B fallback is still there.
    await expect(page.getByTestId('search-link').first()).toBeVisible()
    expect(net.external).toEqual([])
    for (const u of net.insights) expect(decodeURIComponent(u)).not.toMatch(/Pastillas|Palio|32700|Sint[eé]tica/i)
    await page.screenshot({ path: `${SHOTS}/ok-desktop-1280.png`, fullPage: true, animations: 'disabled' })
  })

  test('real E2E server (provider none): the route answers "disabled" and the UI points to the manual search', async ({ page }) => {
    const net = watch(page)
    await openParts(page)
    await page.getByTestId('auto-pricing-panel').getByRole('button', { name: 'Buscar publicaciones' }).click()
    await expect(page.getByTestId('auto-pricing-error')).toContainText('no está disponible')
    expect(net.external).toEqual([])
  })

  for (const [status, payload, msg] of [
    [429, { status: 'rate_limited' }, 'varias búsquedas seguidas'],
    [503, { status: 'error' }, 'no está disponible'],
    [504, { status: 'error' }, 'tardó demasiado'],
  ] as const) {
    test(`mocked failure HTTP ${status} → message, retry possible, 7B intact`, async ({ page }) => {
      await page.route(ENDPOINT, (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) }))
      await openParts(page)
      const panel = page.getByTestId('auto-pricing-panel')
      await panel.getByRole('button', { name: 'Buscar publicaciones' }).click()
      await expect(panel.getByTestId('auto-pricing-error')).toContainText(msg)
      await expect(panel.getByRole('button', { name: 'Buscar publicaciones' })).toBeEnabled()
      await expect(page.getByTestId('part-card')).toHaveCount(2)
    })
  }

  test('provider unavailable / quota per item → explanation per part, no offers invented', async ({ page }) => {
    await page.route(ENDPOINT, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', provider: 'serpapi', truncated: false, items: [{ lineId: 'l1', status: 'unavailable', reason: 'timeout', offers: [], hidden: 0 }, { lineId: 'l2', status: 'unavailable', reason: 'quota_exceeded', offers: [], hidden: 0 }] }) }),
    )
    await openParts(page)
    const panel = page.getByTestId('auto-pricing-panel')
    await panel.getByRole('button', { name: 'Buscar publicaciones' }).click()
    await expect(panel).toContainText('tardó demasiado')
    await expect(panel).toContainText('límite de búsquedas automáticas')
    await expect(panel.getByTestId('auto-offer')).toHaveCount(0)
    await expect(panel).not.toContainText('$')
  })

  test('slow provider, service down and no results are told apart; a failure is never "no results"', async ({ page }) => {
    await page.route(ENDPOINT, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', provider: 'serpapi', truncated: false, items: [{ lineId: 'l1', status: 'unavailable', reason: 'network', offers: [], hidden: 0 }, { lineId: 'l2', status: 'unavailable', reason: 'timeout', offers: [], hidden: 0 }] }) }),
    )
    await openParts(page)
    const panel = page.getByTestId('auto-pricing-panel')
    await panel.getByRole('button', { name: 'Buscar publicaciones' }).click()
    const items = panel.getByTestId('auto-item')
    await expect(items.nth(0)).toContainText('no está disponible en este momento')
    await expect(items.nth(1)).toContainText('tardó demasiado')
    await expect(panel).not.toContainText('No encontramos publicaciones')
    await expect(panel.getByRole('status')).toContainText('No pudimos consultar 2 repuestos')
    await expect(page.getByTestId('part-card')).toHaveCount(2) // manual search kept
  })
})

test.describe('PP-E2E-02 the client cannot enable or steer the provider', () => {
  test('extra keys (flags, provider, URL) → 400; GET → 405; responses never mention keys', async ({ request }) => {
    const base = { vehicle: { make: 'Fiat', model: 'Palio', year: '2017' }, lines: [{ id: 'l1', description: 'Filtro de aire' }] }
    for (const extra of [{ enabled: true }, { provider: 'serpapi' }, { url: 'https://evil.example.com' }]) {
      const r = await request.post('/api/budget/parts-prices', { data: { ...base, ...extra }, headers: { 'x-forwarded-for': `10.66.0.${ipSeq++}` } })
      expect(r.status()).toBe(400)
      expect(await r.text()).not.toMatch(/api_key|SERPAPI|serpapi\.com/i)
    }
    const get = await request.get('/api/budget/parts-prices')
    expect(get.status()).toBe(405)
  })
})

for (const width of [390, 320]) {
  test.describe(`PP-E2E-03 mobile ${width}`, () => {
    test.use({ viewport: { width, height: 800 } })
    test(`results readable, no horizontal scroll, controls inside the viewport (${width}px)`, async ({ page }) => {
      await page.route(ENDPOINT, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SYNTHETIC_OK) }))
      await openParts(page)
      const panel = page.getByTestId('auto-pricing-panel')
      await panel.getByRole('button', { name: 'Buscar publicaciones' }).click()
      await expect(panel.getByTestId('auto-offer')).toHaveCount(2)
      await noHorizontalScroll(page)
      for (const el of [panel.getByRole('button', { name: 'Búsqueda realizada' }), panel.getByRole('link', { name: /Ver publicación/ }).first()]) {
        const b = await el.boundingBox()
        expect(b).not.toBeNull()
        expect(b!.x).toBeGreaterThanOrEqual(0)
        expect(b!.x + b!.width).toBeLessThanOrEqual(width)
      }
      await panel.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${SHOTS}/ok-mobile-${width}.png`, fullPage: true, animations: 'disabled' })
    })
  })
}

// ── PP-E2E-04 Pilot walkthrough (Fase 3) ────────────────────────────────────────────────────────
// Fiat Palio 2017 1.4 8v Evo · hose, air filter, front brake pads + labor. The route is mocked with
// SYNTHETIC offers echoed per requested line (no SerpApi, no real prices).
const PILOT_QUOTE = [
  'Manguera de respiración de gases: 18000',
  'Filtro de aire: 9000',
  'Pastillas de freno delanteras: 40000',
  'Mano de obra: 30000',
].join('\n')

function syntheticFor(description: string) {
  const base = { currency: 'ARS', retrievedAt: '2026-11-14T18:00:00.000Z', codeMatch: false }
  const url = (n: number) => `https://www.google.com.ar/search?ibp=oshop&prds=synthetic-${n}`
  if (/manguera/i.test(description)) return [
    { ...base, title: 'Manguera Descarga Gases Palio 1.4 Fire (SINTÉTICA)', merchant: 'Comercio Sintético A', priceMinor: 1_100_000, url: url(1), decision: 'candidate', missing: ['part_code', 'presentation', 'condition', 'year'] },
    { ...base, title: 'Manguera Gases Fiat Palio Siena (SINTÉTICA)', merchant: 'Comercio Sintético B', priceMinor: 450_000, url: url(2), decision: 'needs_review', missing: ['part_code', 'presentation', 'condition', 'year', 'engine'] },
  ]
  if (/filtro/i.test(description)) return [
    { ...base, title: 'Filtro De Aire Fiat Palio 1.4 8v Evo (SINTÉTICA)', merchant: 'Comercio Sintético C', priceMinor: 1_238_733, url: url(3), decision: 'candidate', missing: ['part_code', 'presentation', 'condition', 'year'] },
  ]
  return [
    { ...base, title: 'Pastillas De Freno Delantera Fiat Palio 1997+ (SINTÉTICA)', merchant: 'Comercio Sintético D', priceMinor: 3_270_000, url: url(4), decision: 'candidate', missing: ['part_code', 'presentation', 'condition', 'engine'] },
    { ...base, title: 'Pastillas Freno Del. Peugeot 208 / C3 Palio Nuevo (SINTÉTICA)', merchant: 'Comercio Sintético E', priceMinor: 4_220_000, url: url(5), decision: 'needs_review', missing: ['part_code', 'presentation', 'condition', 'year', 'engine', 'multi_vehicle'] },
  ]
}

async function mockEcho(page: Page) {
  const seen: Array<{ vehicle: Record<string, string>; lines: Array<{ id: string; description: string }> }> = []
  await page.route(ENDPOINT, async (route) => {
    const sent = route.request().postDataJSON() as (typeof seen)[number]
    seen.push(sent)
    const items = sent.lines.map((l) => ({ lineId: l.id, status: 'ok', hidden: 0, offers: syntheticFor(l.description) }))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', provider: 'serpapi', truncated: false, items }) })
  })
  return seen
}

async function openPilotQuote(page: Page) {
  await page.goto('/demo/presupuesto')
  await page.fill('#budgetText', PILOT_QUOTE)
  await page.fill('#make', 'Fiat')
  await page.fill('#model', 'Palio')
  await page.fill('#year', '2017')
  await page.fill('#engine', '1.4 8v Evo')
  await page.getByRole('button', { name: 'Analizar presupuesto' }).click()
  await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
  await expect(page.getByTestId('auto-pricing-panel')).toBeVisible()
}

test.describe('PP-E2E-04 pilot walkthrough — Fiat Palio 2017 1.4 8v Evo', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('1–7, 9–10: query from the UI, labeled results, no comparisons/averages/labor verdicts, no repeats, nothing to Analytics', async ({ page }) => {
    const net = watch(page)
    const seen = await mockEcho(page)
    await openPilotQuote(page)
    const panel = page.getByTestId('auto-pricing-panel')
    // Identified parts only (labor is not offered for search).
    await expect(panel.getByTestId('auto-parts').getByRole('listitem')).toHaveText(['Manguera de respiración de gases', 'Filtro de aire', 'Pastillas de freno delanteras'])
    expect(net.pricing).toEqual([])

    await panel.getByRole('button', { name: 'Buscar publicaciones' }).click()
    await expect(panel.getByTestId('auto-results')).toBeVisible()
    expect(net.pricing).toEqual(['POST'])
    const sent = seen[0]!
    expect(sent.vehicle).toEqual({ make: 'Fiat', model: 'Palio', year: '2017', engine: '1.4 8v Evo' })
    expect(sent.lines.map((l) => l.description)).toEqual(['Manguera de respiración de gases', 'Filtro de aire', 'Pastillas de freno delanteras'])
    expect(JSON.stringify(sent)).not.toMatch(/18000|9000|40000|30000|Mano de obra/) // workshop prices and labor never sent

    // 2–3: merchant, ARS price, date, link and the unverified label on every result.
    const offers = panel.getByTestId('auto-offer')
    await expect(offers).toHaveCount(5)
    for (let i = 0; i < 5; i++) {
      const o = offers.nth(i)
      await expect(o).toContainText('Compatibilidad no verificada')
      await expect(o).toContainText(/\$ \d{1,3}(\.\d{3})*,\d{2}/)
      await expect(o).toContainText(/Comercio: Comercio Sintético [A-E]/)
      await expect(o).toContainText(/Consultado: 14\/11\/(20)?26/)
      await expect(o.getByRole('link', { name: /Ver publicación/ })).toHaveAttribute('href', /^https:\/\/www\.google\.com\.ar\//)
    }
    await expect(panel).toContainText('La publicación menciona varios vehículos')

    // 4–6: no comparison, average or verdict in the panel; labor shown without opinion.
    const report = page.getByTestId('budget-report')
    // "calcular la diferencia" in the footer is an instruction for the manual 7B reference flow, not a comparison.
    await expect(panel).not.toContainText(/promedio|diferencia (de|con)|sobreprecio|m[aá]s caro|m[aá]s barato|precio justo|razonable|excesiv/i)
    await expect(panel.locator('[data-comparison]')).toHaveCount(0)
    await expect(report).not.toContainText(/sobreprecio|cobra de m[aá]s|excesiv|precio justo(?! de mercado)/i)
    await expect(page.getByTestId('labor-lines')).toContainText('Mano de obra')
    await expect(report).toContainText('no se compara con referencias externas')

    // 9: no repeated search.
    await expect(panel.getByRole('button', { name: 'Búsqueda realizada' })).toBeDisabled()
    await page.getByTestId('part-card').first().getByText('Qué verificar antes de comprar').click()
    expect(net.pricing).toEqual(['POST'])

    // 10: nothing about parts or prices reaches Analytics; no external request.
    expect(net.external).toEqual([])
    for (const u of net.insights) expect(decodeURIComponent(u)).not.toMatch(/Manguera|Filtro|Pastillas|Palio|Sint[eé]tic|32700/i)
    await page.screenshot({ path: `${SHOTS}/pilot-desktop-1280.png`, fullPage: true, animations: 'disabled' })
    await panel.screenshot({ path: `${SHOTS}/pilot-panel-1280.png`, animations: 'disabled' })
  })

  test('7: provider unavailable → clear fallback, manual search still works', async ({ page }) => {
    await page.route(ENDPOINT, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 'error' }) }))
    await openPilotQuote(page)
    const panel = page.getByTestId('auto-pricing-panel')
    await panel.getByRole('button', { name: 'Buscar publicaciones' }).click()
    await expect(panel.getByTestId('auto-pricing-error')).toContainText('Usá la búsqueda manual')
    await expect(page.getByTestId('search-link')).toHaveCount(3)
    await expect(panel.getByTestId('auto-offer')).toHaveCount(0)
  })
})

for (const width of [390, 320]) {
  test.describe(`PP-E2E-05 pilot walkthrough mobile ${width}`, () => {
    test.use({ viewport: { width, height: 800 } })
    test(`8: three parts with results, readable and inside the viewport (${width}px)`, async ({ page }) => {
      await mockEcho(page)
      await openPilotQuote(page)
      const panel = page.getByTestId('auto-pricing-panel')
      await panel.getByRole('button', { name: 'Buscar publicaciones' }).click()
      await expect(panel.getByTestId('auto-offer')).toHaveCount(5)
      await noHorizontalScroll(page)
      const links = panel.getByRole('link', { name: /Ver publicación/ })
      for (let i = 0; i < 5; i++) {
        const b = await links.nth(i).boundingBox()
        expect(b!.x).toBeGreaterThanOrEqual(0)
        expect(b!.x + b!.width).toBeLessThanOrEqual(width)
        expect(b!.height).toBeGreaterThanOrEqual(40)
      }
      // Compact layout: summary per part; missing data collapsed, expandable with keyboard, inside the viewport.
      await expect(panel.getByTestId('auto-item-summary')).toHaveCount(3)
      const details = panel.getByTestId('auto-offer-details').first()
      await expect(details).not.toHaveAttribute('open', '')
      await expect(details.getByTestId('auto-offer-missing')).toBeHidden()
      await details.locator('summary').focus()
      await page.keyboard.press('Enter')
      await expect(details.getByTestId('auto-offer-missing')).toBeVisible()
      const s = await details.locator('summary').boundingBox()
      expect(s!.height).toBeGreaterThanOrEqual(40)
      expect(s!.x + s!.width).toBeLessThanOrEqual(width)
      await noHorizontalScroll(page)
      await expect(panel).not.toContainText(/mejor precio|mejor compra|m[aá]s conveniente|promedio/i)
      await page.screenshot({ path: `${SHOTS}/pilot-mobile-${width}.png`, fullPage: true, animations: 'disabled' })
      await panel.screenshot({ path: `${SHOTS}/pilot-panel-${width}.png`, animations: 'disabled' })
    })
  })
}
