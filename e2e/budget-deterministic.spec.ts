/**
 * budget-deterministic.spec.ts — Incremento 7E: the budget verification does not depend on the AI.
 *
 * - "AI available": default server (stub LLM).
 * - "AI unavailable": CI-only server on port 3003 (playwright.config.ts: Groq selected WITHOUT a
 *   key + LLM kill switch → no request can leave the machine) or PLAYWRIGHT_AI_DOWN_BASE_URL.
 * Automatic pricing (7C) is ON on both servers with provider "none"; successful searches are
 * simulated with page.route(). Nothing external is contacted. No real Groq, no real SerpApi.
 * Screenshots go to the git-ignored reviews-local/screenshots/7e-deterministic-budget.
 */
import { test, expect, type Page } from '@playwright/test'

const SHOTS = 'reviews-local/screenshots/7e-deterministic-budget'
const AI_DOWN_URL = process.env.PLAYWRIGHT_AI_DOWN_BASE_URL ?? (process.env.CI ? 'http://localhost:3003' : '')
const EXAMPLE = 'Aceite motor: 4500\nFiltro de aire: 1500\nFiltro de aceite: 2000\nMano de obra: 3000\nTotal: 12500'
const PRICE_JUDGEMENT = /sobreprecio|fraude|estafa|\bcaro\b|barato|excesiv|cobra de m[aá]s/i

let ipSeq = 1
async function ownBucket(page: Page) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.89.${Math.floor(Math.random() * 200)}.${ipSeq++}` })
}

function watch(page: Page) {
  const pricing: Array<Record<string, unknown>> = []
  const external: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.pathname === '/api/budget/parts-prices' && r.method() === 'POST') pricing.push(r.postDataJSON())
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('fonts.googleapis.com') && !u.hostname.endsWith('fonts.gstatic.com')) external.push(r.url())
  })
  return { pricing, external }
}

async function analyze(page: Page, base: string, text: string) {
  await page.goto(`${base}/demo/presupuesto`)
  await page.fill('#budgetText', text)
  await page.fill('#make', 'Fiat')
  await page.fill('#model', 'Palio')
  await page.fill('#year', '2017')
  await page.getByRole('button', { name: 'Analizar presupuesto' }).click()
  await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}

/** The verification the person must see for EXAMPLE, with or without the AI. */
async function expectExampleVerified(page: Page) {
  const totals = page.getByTestId('budget-totals')
  await expect(totals.getByTestId('budget-computed')).toHaveText('$ 11.000,00')
  await expect(totals.getByTestId('budget-declared')).toHaveText('$ 12.500,00')
  await expect(totals.getByTestId('budget-difference')).toContainText('$ 1.500,00')
  await expect(totals.getByTestId('budget-difference')).toContainText('el total declarado es mayor')
  const breakdown = totals.getByTestId('budget-breakdown')
  await expect(breakdown).toContainText('Repuestos')
  await expect(breakdown).toContainText('$ 8.000,00')
  await expect(breakdown).toContainText('Mano de obra')
  await expect(breakdown).toContainText('$ 3.000,00')
  await expect(totals).toContainText('Partidas: 4')
  await expect(page.getByTestId('budget-items').getByRole('listitem')).toHaveCount(4)
  await expect(page.getByTestId('budget-items').locator('[data-category="labor"]')).toContainText('Mano de obra')
  await expect(page.getByTestId('budget-report')).not.toContainText(PRICE_JUDGEMENT)
  await expect(page.getByTestId('budget-report')).not.toContainText('Partidas: 0')
}

/** 7C after a deterministic result: labor never searched, one request per click, none before. */
async function expectPricingFlow(page: Page, w: ReturnType<typeof watch>) {
  const panel = page.getByTestId('auto-pricing-panel')
  await expect(panel.getByTestId('auto-parts').getByRole('listitem')).toHaveText(['Aceite motor', 'Filtro de aire', 'Filtro de aceite'])
  expect(w.pricing).toHaveLength(0) // no automatic search without a click
  await page.route('**/api/budget/parts-prices', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', provider: 'serpapi', truncated: false, items: [] }) }),
  )
  const button = panel.getByRole('button', { name: 'Buscar publicaciones' })
  await button.click()
  await expect(panel.getByRole('button', { name: 'Búsqueda realizada' })).toBeDisabled()
  await panel.getByRole('button', { name: 'Búsqueda realizada' }).click({ force: true })
  expect(w.pricing).toHaveLength(1) // no duplicate request
  const lines = (w.pricing[0]!['lines'] as Array<{ description: string }>).map((l) => l.description)
  expect(lines).toEqual(['Aceite motor', 'Filtro de aire', 'Filtro de aceite'])
  expect(lines.join(' ')).not.toMatch(/mano de obra/i)
}

test.describe('7E — AI available (stub)', () => {
  test.beforeEach(async ({ page }) => ownBucket(page))

  test('example: 4 items, parts/labor, $11.000 vs $12.500, difference $1.500; research and 7C after one click', async ({ page }) => {
    const w = watch(page)
    await analyze(page, '', EXAMPLE)
    await expectExampleVerified(page)
    await expect(page.getByTestId('ai-unavailable-notice')).toHaveCount(0)
    await expect(page.getByRole('alert').filter({ hasText: 'No pudimos completar' })).toHaveCount(0)
    await expect(page.getByTestId('research-workspace')).toBeVisible()
    await expect(page.getByTestId('labor-lines')).toContainText('Mano de obra')
    await page.screenshot({ path: `${SHOTS}/ai-available-desktop.png`, fullPage: true })
    await expectPricingFlow(page, w)
    expect(w.external).toEqual([])
  })

  test('partial budget: no positive verification, missing and ambiguous amounts listed', async ({ page }) => {
    await analyze(page, '', 'Pastillas de freno: 18000\nDiscos de freno: a confirmar\nCorrea: 1,500.50\nMano de obra: 7000\nTotal: 40000')
    const totals = page.getByTestId('budget-totals')
    await expect(totals.locator('[data-status]').first()).toHaveAttribute('data-status', 'PARTIAL')
    await expect(totals.getByTestId('budget-comparison')).toHaveAttribute('data-comparison', 'partial')
    await expect(totals).not.toContainText('coincide con la suma')
    await expect(page.getByTestId('budget-limitations')).toContainText('2 partidas no tienen un importe que podamos sumar')
    await expect(page.getByTestId('budget-items')).toContainText('A confirmar')
    await expect(page.getByTestId('budget-items')).toContainText('Importe no legible')
  })
})

test.describe('7E — AI unavailable (real server, no provider configured, kill switch)', () => {
  test.skip(!AI_DOWN_URL, 'AI-down server runs in CI only (or set PLAYWRIGHT_AI_DOWN_BASE_URL)')
  test.beforeEach(async ({ page }) => ownBucket(page))

  test('the verification is kept, the AI status is separate, research and 7C keep working', async ({ page }) => {
    const w = watch(page)
    await analyze(page, AI_DOWN_URL, EXAMPLE)
    await expectExampleVerified(page)
    await expect(page.getByText('IA TEMPORALMENTE NO DISPONIBLE', { exact: true })).toBeVisible()
    const notice = page.getByTestId('ai-unavailable-notice')
    await expect(notice).toContainText('La verificación de importes no usa IA')
    // No contradictory generic failure next to valid results.
    await expect(page.getByRole('alert').filter({ hasText: 'No pudimos completar' })).toHaveCount(0)
    await expect(page.getByTestId('budget-totals').locator('[data-status]').first()).toHaveAttribute('data-status', 'COMPLETE')
    await expect(page.getByTestId('research-workspace')).toBeVisible()
    await expect(page.getByTestId('part-card')).toHaveCount(3)
    await page.screenshot({ path: `${SHOTS}/ai-unavailable-desktop.png`, fullPage: true })
    await expectPricingFlow(page, w)
    expect(w.external).toEqual([])
  })

  test('unreadable free prose with the AI down: honest "could not verify", never a positive check', async ({ page }) => {
    await analyze(page, AI_DOWN_URL, 'El taller me pasó un presupuesto de 45000 por cambiar el aceite')
    const totals = page.getByTestId('budget-totals')
    await expect(totals.locator('[data-status]').first()).toHaveAttribute('data-status', 'INVALID')
    await expect(totals).toContainText('No pudimos verificar la suma')
    await expect(totals).not.toContainText('coincide con la suma')
  })

  for (const width of [320, 390]) {
    test(`mobile ${width}px: verification first, readable, no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await analyze(page, AI_DOWN_URL, EXAMPLE)
      await expectExampleVerified(page)
      const totalsBox = await page.getByTestId('budget-totals').boundingBox()
      const itemsBox = await page.getByTestId('budget-items').boundingBox()
      expect(totalsBox!.y).toBeLessThan(itemsBox!.y)
      await noHorizontalScroll(page)
      await page.screenshot({ path: `${SHOTS}/ai-unavailable-${width}.png`, fullPage: true })
    })
  }
})

test.describe('7E — mobile with the AI available', () => {
  test.beforeEach(async ({ page }) => ownBucket(page))
  for (const width of [320, 390]) {
    test(`${width}px: no horizontal scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await analyze(page, '', EXAMPLE)
      await expectExampleVerified(page)
      await noHorizontalScroll(page)
      await page.screenshot({ path: `${SHOTS}/ai-available-${width}.png`, fullPage: true })
    })
  }
})
