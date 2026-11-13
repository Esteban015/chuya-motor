/**
 * results-redesign.spec.ts — Incremento 6.6: redesigned results of /demo/falla and /demo/presupuesto.
 *
 * Deterministic: POST /api/analyze is intercepted with controlled fixtures (no server analysis,
 * no LLM). Assertions target structure, roles and fixed texts — never variable LLM text.
 * Screenshots are written to reviews-local/screenshots/6.6 (git-ignored) for visual review.
 */
import { test, expect, type Page } from '@playwright/test'

const SHOTS = 'reviews-local/screenshots/6.6'

const BASE = {
  caseId: 'fixture',
  safetyBlocked: false,
  safetyDerivationMessage: null,
  policyVersion: '1.5.0',
  coverageDisclaimer: 'Este análisis automático no reemplaza la inspección de un profesional.',
  route: 'symptom',
  facts: ['Ruido metálico al arrancar en frío', 'Desaparece después de unos minutos'],
  hypotheses: [
    { statement: 'Posible tensor de la correa de accesorios con desgaste', confidence: 'medium', caveats: ['Se confirmaría si el ruido viene de la zona de la correa.'] },
    { statement: 'Posible holgura en el tren de válvulas hasta que llega la presión de aceite', confidence: 'low', caveats: ['Requiere inspección con el motor en frío.', 'Se descarta si el nivel de aceite es correcto.'] },
    { statement: 'Posible protector térmico del escape flojo', confidence: 'low', caveats: [] },
  ],
  questions: ['¿El ruido cambia al acelerar?', '¿Desde cuándo lo notás?', '¿Hiciste algún service reciente?'],
  warnings: [],
  budget: null,
  missingInformation: ['Kilometraje del vehículo'],
  fallback: false,
  fallbackText: null,
  nodeTrace: null,
  severity: null,
  aiStatus: { mode: 'ai' },
}

const CRITICAL = {
  level: 'critical',
  title: 'Atención: síntoma crítico de seguridad',
  message: 'El problema descripto podría comprometer seriamente el sistema de frenos.',
  action: 'No conduzcas el vehículo. Solicitá asistencia profesional antes de volver a utilizarlo.',
}

const FIXTURES = {
  ai: BASE,
  simulated: { ...BASE, aiStatus: { mode: 'simulated' } },
  critical: { ...BASE, severity: CRITICAL },
  withheld: {
    ...BASE,
    facts: [],
    hypotheses: [],
    questions: [],
    fallback: true,
    fallbackText: 'No pudimos completar el análisis automático.',
    warnings: ['La orientación generada automáticamente fue retenida porque no superó la validación de seguridad. Consultá con un taller o mecánico habilitado.'],
    aiStatus: { mode: 'withheld' },
  },
  quota: {
    ...BASE,
    facts: [],
    hypotheses: [],
    questions: [],
    fallback: true,
    fallbackText: 'No pudimos completar el análisis automático.',
    warnings: ['El piloto con IA alcanzó su cupo de consultas por hoy. Probá de nuevo mañana. Las advertencias de seguridad se mantienen; ante dudas, consultá con un taller o mecánico habilitado.'],
    aiStatus: { mode: 'unavailable', reason: 'daily_quota' },
  },
  budget: {
    ...BASE,
    route: 'budget',
    facts: [],
    hypotheses: [],
    questions: ['¿Qué incluye la mano de obra?'],
    missingInformation: ['Marca, modelo y año del vehículo no especificados (hipótesis pueden ser menos precisas).'],
    budget: {
      completenessStatus: 'COMPLETE',
      computedTotalMinorUnit: 1_100_000,
      computedTotalIsPartial: false,
      currency: 'ARS',
      discrepancy: true,
      lineCount: 4,
      missingLineCount: 0,
    },
    aiStatus: { mode: 'simulated' },
  },
} as const

async function mockAnalyze(page: Page, body: unknown) {
  await page.route('**/api/analyze', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }))
}

async function runSymptom(page: Page, fixture: unknown) {
  await mockAnalyze(page, fixture)
  await page.goto('/demo/falla')
  await page.selectOption('#vehicleType', 'hatchback')
  await page.fill('#make', 'Fiat')
  await page.fill('#model', 'Palio')
  await page.fill('#year', '2017')
  await page.click('button:has-text("Siguiente")')
  await page.fill('#symptomText', 'El motor hace un ruido metálico al arrancar en frío y desaparece a los pocos minutos.')
  await page.selectOption('#occurrence', 'Al arrancar')
  await page.click('button[type="submit"]')
  await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
}

async function runBudget(page: Page, fixture: unknown) {
  await mockAnalyze(page, fixture)
  await page.goto('/demo/presupuesto')
  await page.click('button:has-text("Usar ejemplo")')
  await page.click('button[type="submit"]')
  await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}

// ── 1, 4, 8: symptom report, real-AI badge, desktop layout ──────────────────

test.describe('RR-01 symptom report — desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('renders header, single real-AI badge, hypotheses with qualitative confidence, two-column layout', async ({ page }) => {
    await runSymptom(page, FIXTURES.ai)
    await expect(page.getByRole('heading', { level: 1, name: 'Tu análisis está listo' })).toBeVisible()
    await expect(page.getByText('PILOTO CON IA · RESPUESTAS ORIENTATIVAS')).toHaveCount(1)
    await expect(page.getByText(/No es un diagnóstico definitivo/)).toBeVisible()
    await expect(page.getByText('Fiat Palio 2017')).toBeVisible()

    const hyps = page.getByTestId('hypotheses')
    await expect(hyps.getByRole('heading', { level: 3 })).toHaveCount(3)
    await expect(hyps.locator('[data-confidence="medium"]')).toHaveText('Confianza media')
    await expect(hyps).not.toContainText('%')

    // Aside (vehicle, facts, questions) on the left, hypotheses on the right; wide container.
    const aside = await page.getByRole('complementary', { name: 'Datos de la consulta' }).boundingBox()
    const main = await hyps.boundingBox()
    expect(aside!.x).toBeLessThan(main!.x)
    expect(main!.width).toBeGreaterThan(aside!.width)
    const report = await page.getByTestId('symptom-report').boundingBox()
    expect(report!.width).toBeGreaterThan(1100)
    await noHorizontalScroll(page)
    await page.screenshot({ path: `${SHOTS}/sintomas-desktop-1440.png`, fullPage: true, animations: 'disabled' })
  })
})

// ── 9: mobile ────────────────────────────────────────────────────────────────

test.describe('RR-02 symptom report — mobile 390', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('single column, hypotheses before the context cards, no horizontal scroll', async ({ page }) => {
    await runSymptom(page, FIXTURES.ai)
    const hyps = await page.getByTestId('hypotheses').boundingBox()
    const aside = await page.getByRole('complementary', { name: 'Datos de la consulta' }).boundingBox()
    expect(hyps!.y).toBeLessThan(aside!.y)
    expect(Math.abs(hyps!.x - aside!.x)).toBeLessThan(2)
    await noHorizontalScroll(page)
    await page.screenshot({ path: `${SHOTS}/sintomas-mobile-390.png`, fullPage: true, animations: 'disabled' })
  })
})

// ── 3: CRITICAL alert, desktop and mobile ────────────────────────────────────

for (const vp of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`RR-03 critical alert — ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('critical banner: role=alert, full width, before the hypotheses, visible', async ({ page }) => {
      await runSymptom(page, FIXTURES.critical)
      const banner = page.locator('[data-severity="critical"]')
      await expect(banner).toBeVisible()
      await expect(banner).toHaveAttribute('role', 'alert')
      await expect(banner).toContainText('No conduzcas el vehículo')
      const b = await banner.boundingBox()
      const h = await page.getByTestId('hypotheses').boundingBox()
      expect(b!.y).toBeLessThan(h!.y)
      const report = await page.getByTestId('symptom-report').boundingBox()
      expect(b!.width).toBeGreaterThan(report!.width - 2) // spans the whole report width
      await noHorizontalScroll(page)
      await page.screenshot({ path: `${SHOTS}/alerta-critica-${vp.name}-${vp.width}.png`, fullPage: true, animations: 'disabled' })
    })
  })
}

// ── 5, 6, 7: stub, withheld, quota ───────────────────────────────────────────

test.describe('RR-04 provider states', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('stub → "MODO DEMO · RESPUESTAS SIMULADAS" once, never the AI pilot badge', async ({ page }) => {
    await runSymptom(page, FIXTURES.simulated)
    await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toHaveCount(1)
    await expect(page.getByText('PILOTO CON IA · RESPUESTAS ORIENTATIVAS')).toHaveCount(0)
  })

  test('withheld answer is not presented as a normal report', async ({ page }) => {
    await runSymptom(page, FIXTURES.withheld)
    await expect(page.getByRole('heading', { level: 1, name: 'Resultado de tu consulta' })).toBeVisible()
    await expect(page.getByText('RESPUESTA RETENIDA POR SEGURIDAD', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Respuesta retenida por seguridad' })).toBeVisible()
    await expect(page.getByTestId('hypotheses')).toHaveCount(0)
    await expect(page.getByText(/fue retenida porque no superó la validación de seguridad/)).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/respuesta-retenida-desktop-1440.png`, fullPage: true, animations: 'disabled' })
  })

  test('daily quota exhausted → explicit unavailable notice, no hypotheses', async ({ page }) => {
    await runSymptom(page, FIXTURES.quota)
    await expect(page.getByText('IA TEMPORALMENTE NO DISPONIBLE', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Servicio con IA temporalmente no disponible' })).toBeVisible()
    await expect(page.getByText(/alcanzó su cupo de consultas por hoy/)).toBeVisible()
    await expect(page.getByTestId('hypotheses')).toHaveCount(0)
  })
})

// ── 2: budget report, desktop and mobile ─────────────────────────────────────

test.describe('RR-05 budget report — desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('two columns: items left, totals right; ARS format; highlighted difference; no price judgement', async ({ page }) => {
    await runBudget(page, FIXTURES.budget)
    const totals = page.getByTestId('budget-totals')
    await expect(totals.locator('[data-status]')).toHaveAttribute('data-status', 'COMPLETE')
    await expect(totals).toContainText('$ 11.000,00') // computed by the server (fixture)
    await expect(totals).toContainText('$ 12.500,00') // declared, read from the user's own text
    const cmp = page.getByTestId('budget-comparison')
    await expect(cmp).toHaveAttribute('data-comparison', 'mismatch')
    await expect(cmp).toContainText('El total declarado no coincide con la suma calculada')
    await expect(cmp).toContainText('$ 1.500,00')
    await expect(page.getByTestId('budget-report')).not.toContainText(/caro|barato|excesiv|razonable/i)

    const items = await page.getByRole('region', { name: 'Partidas que enviaste' }).boundingBox()
    const t = await totals.boundingBox()
    expect(items!.x).toBeLessThan(t!.x)
    await noHorizontalScroll(page)
    await page.screenshot({ path: `${SHOTS}/presupuesto-desktop-1440.png`, fullPage: true, animations: 'disabled' })
  })
})

test.describe('RR-06 budget report — mobile 390', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('single column, verdict first, no horizontal scroll', async ({ page }) => {
    await runBudget(page, FIXTURES.budget)
    const t = await page.getByTestId('budget-totals').boundingBox()
    const items = await page.getByRole('region', { name: 'Partidas que enviaste' }).boundingBox()
    expect(t!.y).toBeLessThan(items!.y)
    await noHorizontalScroll(page)
    await page.screenshot({ path: `${SHOTS}/presupuesto-mobile-390.png`, fullPage: true, animations: 'disabled' })
  })
})

// ── 10: navigation and buttons ───────────────────────────────────────────────

test.describe('RR-07 actions', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('copy questions copies only the visible questions; new query and back to demo work', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only here')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await runSymptom(page, FIXTURES.ai)

    await page.getByRole('button', { name: 'Copiar preguntas' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Copiadas' })).toBeVisible()
    // The OS clipboard may convert line endings (Windows: CRLF); the copied content is what matters.
    const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')
    expect(copied).toBe('Preguntas para el taller:\n1. ¿El ruido cambia al acelerar?\n2. ¿Desde cuándo lo notás?\n3. ¿Hiciste algún service reciente?')
    expect(copied).not.toMatch(/Fiat|Palio|ruido metálico al arrancar/)

    await page.getByRole('button', { name: 'Realizar otra consulta' }).click()
    await expect(page.locator('#vehicleType')).toBeVisible()

    await runSymptom(page, FIXTURES.ai)
    await page.getByRole('navigation', { name: 'Acciones del informe' }).getByRole('link', { name: 'Volver a la demo' }).click()
    await expect(page).toHaveURL(/\/demo$/)
  })

  test('budget: "Analizar otro presupuesto" returns to the form', async ({ page }) => {
    await runBudget(page, FIXTURES.budget)
    await page.getByRole('button', { name: 'Analizar otro presupuesto' }).click()
    await expect(page.locator('#budgetText')).toBeVisible()
  })
})
