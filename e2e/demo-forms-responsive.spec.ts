/**
 * demo-forms-responsive.spec.ts — Incremento 6.7: wide, responsive forms of /demo/falla (steps 1–2)
 * and /demo/presupuesto. Layout and behavior only; POST /api/analyze is intercepted with a fixture
 * (no LLM) and the request body is asserted to be unchanged. Screenshots go to the git-ignored
 * reviews-local/screenshots/6.7.
 */
import { test, expect, type Page } from '@playwright/test'

const SHOTS = 'reviews-local/screenshots/6.7'
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true, animations: 'disabled' })

const FIXTURE = {
  caseId: 'fixture',
  safetyBlocked: false,
  safetyDerivationMessage: null,
  policyVersion: '1.5.0',
  coverageDisclaimer: 'Este análisis automático no reemplaza la inspección de un profesional.',
  route: 'symptom',
  facts: ['Ruido al arrancar'],
  hypotheses: [{ statement: 'Posible tensor gastado', confidence: 'low', caveats: [] }],
  questions: ['¿Desde cuándo?'],
  warnings: [],
  budget: null,
  missingInformation: [],
  fallback: false,
  fallbackText: null,
  nodeTrace: null,
  severity: null,
  aiStatus: { mode: 'simulated' },
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!

// ── Desktop 1440 ─────────────────────────────────────────────────────────────

test.describe('FR-01 symptom wizard — desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('step 1: wide container, form + context side by side, live summary, step indicator state', async ({ page }) => {
    await page.goto('/demo/falla')
    await expect(page.getByRole('navigation', { name: 'Pasos del asistente' }).locator('[aria-current="step"]')).toContainText('Paso actual: Mi vehículo')

    const form = await box(page, 'div:has(> div > h1:text("Mi vehículo"))')
    const aside = await box(page, '[data-testid="form-context"]')
    expect(aside.x).toBeGreaterThan(form.x + form.width - 1) // to the right
    expect(form.width / (form.width + aside.width)).toBeGreaterThan(0.6)
    expect(form.width + aside.width).toBeGreaterThan(1000) // ≈ 1100–1200 px container

    const summary = page.getByRole('complementary', { name: 'Ayuda del paso: Mi vehículo' })
    await expect(summary).toContainText('Falta elegir')
    await page.selectOption('#vehicleType', 'hatchback')
    await page.fill('#make', 'Fiat')
    await page.fill('#year', '2017')
    await expect(summary).toContainText('Hatchback')
    await expect(summary).toContainText('Fiat')
    await expect(summary).toContainText('2017')
    await noHorizontalScroll(page)
    await shot(page, 'paso1-desktop-1440')
  })

  test('step 1 validation error is visible and announced', async ({ page }) => {
    await page.goto('/demo/falla')
    await page.click('button:has-text("Siguiente")')
    await expect(page.getByRole('alert').filter({ hasText: 'Seleccioná el tipo de vehículo.' })).toBeVisible()
    await shot(page, 'paso1-error-desktop-1440')
  })

  test('step 2: context tips + privacy in the side column; state kept across steps; unchanged request body', async ({ page }) => {
    let body: unknown = null
    await page.route('**/api/analyze', async (route) => {
      body = route.request().postDataJSON()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FIXTURE) })
    })
    await page.goto('/demo/falla')
    await page.selectOption('#vehicleType', 'sedan')
    await page.fill('#make', 'Toyota')
    await page.fill('#model', 'Corolla')
    await page.click('button:has-text("Siguiente")')

    const tips = page.getByRole('complementary', { name: 'Ayuda del paso: El síntoma' })
    await expect(tips).toContainText('Cómo describirlo mejor')
    await expect(tips.getByRole('note')).toContainText('No ingreses información personal, patentes')
    await expect(page.locator('form').getByRole('note')).toBeHidden() // privacy shown once (side column)
    const form = await box(page, 'form')
    const aside = await box(page, '[data-testid="form-context"]')
    expect(aside.x).toBeGreaterThan(form.x + form.width - 1)

    // Errors on submit with empty fields.
    await page.click('button[type="submit"]')
    await expect(page.getByRole('alert').filter({ hasText: 'Describí el síntoma con al menos 10 caracteres.' })).toBeVisible()
    await shot(page, 'paso2-desktop-1440')

    // Back and forth keeps the values.
    await page.fill('#symptomText', 'Hace un ruido metálico al arrancar en frío.')
    await page.click('button:has-text("← Volver")')
    await expect(page.locator('#make')).toHaveValue('Toyota')
    await page.click('button:has-text("Siguiente")')
    await expect(page.locator('#symptomText')).toHaveValue('Hace un ruido metálico al arrancar en frío.')
    await page.selectOption('#occurrence', 'Al arrancar')
    await page.selectOption('#experienceLevel', 'novice')
    await page.click('button[type="submit"]')
    await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
    expect(body).toEqual({
      userText: 'Hace un ruido metálico al arrancar en frío.. Condición de ocurrencia: Al arrancar.',
      vehicle: { vehicleType: 'sedan', make: 'Toyota', model: 'Corolla' },
      experienceLevel: 'novice',
    })
  })
})

test.describe('FR-02 budget form — desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('form ≈ 2/3 and help ≈ 1/3, all controls kept', async ({ page }) => {
    await page.goto('/demo/presupuesto')
    const form = await box(page, 'form')
    const aside = await box(page, '[data-testid="form-context"]')
    expect(aside.x).toBeGreaterThan(form.x + form.width - 1)
    const ratio = form.width / (form.width + aside.width)
    expect(ratio).toBeGreaterThan(0.6)
    expect(ratio).toBeLessThan(0.75)
    for (const id of ['#budgetText', '#make', '#model', '#year', '#vehicleType']) await expect(page.locator(id)).toBeVisible()
    await page.click('button:has-text("Usar ejemplo")')
    await expect(page.getByText(/^\d+\/2000$/)).toHaveText(/^(?!0\/)/)
    await expect(page.getByRole('button', { name: 'Analizar presupuesto' })).toBeVisible()
    await noHorizontalScroll(page)
    await shot(page, 'presupuesto-desktop-1440')
  })
})

// ── Mobile 390 ───────────────────────────────────────────────────────────────

test.describe('FR-03 mobile 390', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('step 1 and 2: one column, form first, context below, buttons visible, no horizontal scroll', async ({ page }) => {
    await page.goto('/demo/falla')
    let form = await box(page, 'div:has(> div > h1:text("Mi vehículo"))')
    let aside = await box(page, '[data-testid="form-context"]')
    expect(aside.y).toBeGreaterThan(form.y + form.height - 1)
    expect(Math.abs(aside.x - form.x)).toBeLessThan(2)
    await expect(page.getByRole('button', { name: 'Siguiente →' })).toBeVisible()
    await noHorizontalScroll(page)
    await shot(page, 'paso1-mobile-390')

    await page.selectOption('#vehicleType', 'sedan')
    await page.click('button:has-text("Siguiente")')
    form = await box(page, 'form')
    aside = await box(page, '[data-testid="form-context"]')
    expect(aside.y).toBeGreaterThan(form.y + form.height - 1)
    // Privacy notice inside the form, before the button (side column copy is hidden on mobile).
    await expect(page.locator('form').getByRole('note')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Analizar síntoma' })).toBeVisible()
    await noHorizontalScroll(page)
    await shot(page, 'paso2-mobile-390')
  })

  test('budget: textarea and CTA full width, help visible below the form, not sticky', async ({ page }) => {
    await page.goto('/demo/presupuesto')
    const form = await box(page, 'form')
    const textarea = await box(page, '#budgetText')
    const cta = await box(page, 'button[type="submit"]')
    expect(textarea.width).toBeGreaterThan(form.width - 60)
    expect(cta.width).toBeGreaterThan(form.width - 60)
    const help = page.getByRole('complementary', { name: 'Ayuda: análisis del presupuesto' })
    await expect(help).toBeVisible()
    const helpBox = (await help.boundingBox())!
    expect(helpBox.y).toBeGreaterThan(form.y + form.height - 1)
    const position = await page.locator('[data-testid="form-context"] > div').evaluate((el) => getComputedStyle(el).position)
    expect(position).not.toBe('sticky')
    await noHorizontalScroll(page)
    await shot(page, 'presupuesto-mobile-390')
  })
})
