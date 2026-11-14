/**
 * telemetry-feedback.spec.ts — Incremento 7A: Vercel Web Analytics (page views) + optional feedback.
 *
 * Deterministic and offline: POST /api/analyze is intercepted with fixtures (no LLM) except in the
 * Safety Gate test, which uses the stub server. The feedback URL is the test-only value injected by
 * playwright.config.ts (NEXT_PUBLIC_FEEDBACK_FORM_URL); Google is never contacted — the popup
 * navigation is fulfilled locally. Screenshots go to the git-ignored reviews-local/screenshots/7a.
 */
import { test, expect, type Page, type Request } from '@playwright/test'

const SHOTS = 'reviews-local/screenshots/7a'
const FORM_URL = process.env.E2E_FEEDBACK_FORM_URL ?? 'https://docs.google.com/forms/d/e/E2E-TEST-ONLY/viewform'

const SYMPTOM_TEXT = 'El motor hace un ruido ZZQX metálico al arrancar en frío y desaparece a los pocos minutos.'

const BASE = {
  caseId: 'case-fixture-7a',
  safetyBlocked: false,
  safetyDerivationMessage: null,
  policyVersion: '1.5.0',
  coverageDisclaimer: 'Este análisis automático no reemplaza la inspección de un profesional.',
  route: 'symptom',
  facts: ['Ruido metálico al arrancar en frío'],
  hypotheses: [{ statement: 'Posible tensor de la correa de accesorios con desgaste', confidence: 'medium', caveats: [] }],
  questions: ['¿El ruido cambia al acelerar?'],
  warnings: [],
  budget: null,
  missingInformation: [],
  fallback: false,
  fallbackText: null,
  nodeTrace: null,
  severity: null,
  aiStatus: { mode: 'simulated' },
}

const CRITICAL = {
  ...BASE,
  severity: {
    level: 'critical',
    title: 'Atención: síntoma crítico de seguridad',
    message: 'El problema descripto podría comprometer seriamente el sistema de frenos.',
    action: 'No conduzcas el vehículo. Solicitá asistencia profesional antes de volver a utilizarlo.',
  },
}

const BUDGET = {
  ...BASE,
  route: 'budget',
  facts: [],
  hypotheses: [],
  budget: {
    completenessStatus: 'COMPLETE',
    computedTotalMinorUnit: 1_100_000,
    computedTotalIsPartial: false,
    currency: 'ARS',
    discrepancy: true,
    lineCount: 4,
    missingLineCount: 0,
  },
}

/** Counts /api/analyze calls and every request that leaves localhost (fonts excepted). */
function watchNetwork(page: Page) {
  const analyze: Request[] = []
  const external: string[] = []
  const insights: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.pathname === '/api/analyze') analyze.push(r)
    if (u.pathname.startsWith('/_vercel/insights')) insights.push(r.url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.hostname.endsWith('fonts.googleapis.com') && !u.hostname.endsWith('fonts.gstatic.com')) external.push(r.url())
  })
  return { analyze, external, insights }
}

async function mockAnalyze(page: Page, body: unknown) {
  await page.route('**/api/analyze', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }))
}

async function runSymptom(page: Page, fixture: unknown) {
  await mockAnalyze(page, fixture)
  await page.goto('/demo/falla')
  await page.selectOption('#vehicleType', 'hatchback')
  await page.fill('#make', 'MarcaQX')
  await page.fill('#model', 'ModeloQX')
  await page.fill('#year', '2017')
  await page.click('button:has-text("Siguiente")')
  await page.fill('#symptomText', SYMPTOM_TEXT)
  await page.selectOption('#occurrence', 'Al arrancar')
  await page.click('button[type="submit"]')
  await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
}

async function runBudget(page: Page, fixture: unknown) {
  await mockAnalyze(page, fixture)
  await page.goto('/demo/presupuesto')
  await page.click('button:has-text("Usar ejemplo")')
  await page.fill('#make', 'MarcaQX')
  await page.fill('#model', 'ModeloQX')
  await page.click('button[type="submit"]')
  await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
}

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}

const feedbackLink = (page: Page) => page.getByRole('link', { name: /^Contanos tu experiencia/ })

// ── 1. Analytics ─────────────────────────────────────────────────────────────

test.describe('TF-01 Vercel Web Analytics', () => {
  for (const path of ['/', '/demo', '/demo/falla', '/demo/presupuesto']) {
    test(`${path}: official page-view script once, same origin, layout intact`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      const net = watchNetwork(page)
      await page.goto(path)
      await expect(page.locator('script[src="/_vercel/insights/script.js"]')).toHaveCount(1) // no double counting
      await expect(page.locator('script[src*="va.vercel-scripts.com"]')).toHaveCount(0)
      await expect(page.locator('h1').first()).toBeVisible()
      await noHorizontalScroll(page)
      expect(errors).toEqual([])
      expect(net.external).toEqual([])
      for (const u of net.insights) expect(new URL(u).search).toBe('')
    })
  }
})

// ── 2–8. Feedback after the results ──────────────────────────────────────────

test.describe('TF-02 feedback — desktop 1280', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('symptom: shown after the result, exact configured URL, no consultation data, no extra analysis call', async ({ page, context }) => {
    const net = watchNetwork(page)
    await runSymptom(page, BASE)
    const invite = page.getByTestId('feedback-invite')
    await expect(invite).toBeVisible()
    await expect(invite.getByRole('heading', { name: '¿Te resultó útil Chuya Motor?' })).toBeVisible()
    await expect(invite).toContainText('Estamos mejorando la herramienta con la ayuda de quienes la prueban. Tu opinión nos sirve para hacerla más clara y útil.')
    await expect(invite).toContainText('Es voluntario')

    const link = feedbackLink(page)
    await expect(link).toHaveAttribute('href', FORM_URL)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await expect(link).toHaveAttribute('rel', /noreferrer/)

    // Below the result and its actions.
    const actions = await page.getByRole('navigation', { name: 'Acciones del informe' }).boundingBox()
    const box = await invite.boundingBox()
    expect(box!.y).toBeGreaterThan(actions!.y + actions!.height - 1)

    // Clicking opens exactly the configured form: nothing appended (fulfilled locally, never sent to Google).
    await context.route('https://docs.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>form</title>' }))
    const [popup] = await Promise.all([context.waitForEvent('page'), link.click()])
    const opened = popup.url()
    expect(opened).toBe(FORM_URL)
    for (const secret of ['ZZQX', 'MarcaQX', 'ModeloQX', '2017', 'case-fixture-7a', 'tensor']) expect(opened).not.toContain(secret)
    await popup.close()

    expect(net.analyze).toHaveLength(1)
    expect(net.external.filter((u) => !u.startsWith(FORM_URL))).toEqual([])
    await page.screenshot({ path: `${SHOTS}/falla-desktop-1280.png`, fullPage: true, animations: 'disabled' })
  })

  test('budget: shown after the result; the link never carries the budget or vehicle', async ({ page }) => {
    const net = watchNetwork(page)
    await runBudget(page, BUDGET)
    const budgetText = await page.locator('pre').first().innerText()
    const link = feedbackLink(page)
    await expect(link).toBeVisible()
    const href = (await link.getAttribute('href'))!
    expect(href).toBe(FORM_URL)
    for (const secret of ['MarcaQX', 'ModeloQX', 'case-fixture-7a', ...budgetText.split(/\s+/).filter((w) => w.length > 4)]) expect(href).not.toContain(secret)
    const totals = await page.getByTestId('budget-totals').boundingBox()
    expect((await page.getByTestId('feedback-invite').boundingBox())!.y).toBeGreaterThan(totals!.y)
    expect(net.analyze).toHaveLength(1)
    await page.screenshot({ path: `${SHOTS}/presupuesto-desktop-1280.png`, fullPage: true, animations: 'disabled' })
  })

  test('CTA is keyboard-reachable with a descriptive name and visible focus', async ({ page }) => {
    await runSymptom(page, BASE)
    await page.getByRole('link', { name: 'Volver a la demo' }).focus()
    // Tab forward until the feedback link (it is after the actions and the disclaimer).
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab')
      if (await feedbackLink(page).evaluate((el) => el === document.activeElement)) break
    }
    await expect(feedbackLink(page)).toBeFocused()
    await expect(page.getByRole('link', { name: 'Contanos tu experiencia (formulario externo y opcional; se abre en una pestaña nueva)' })).toBeVisible()
    const ring = await feedbackLink(page).evaluate((el) => getComputedStyle(el).boxShadow)
    expect(ring).not.toBe('none')
  })

  test('critical severity: banner first and on screen; the invitation is last and not an alert', async ({ page }) => {
    await runSymptom(page, CRITICAL)
    const banner = page.locator('[data-severity="critical"]')
    await expect(banner).toBeVisible()
    await expect(banner).toBeInViewport()
    const invite = page.getByTestId('feedback-invite')
    await expect(invite).not.toBeInViewport()
    expect((await invite.boundingBox())!.y).toBeGreaterThan((await banner.boundingBox())!.y + (await banner.boundingBox())!.height)
    await expect(invite.getByRole('alert')).toHaveCount(0)
    const bannerWidth = (await banner.boundingBox())!.width
    expect(bannerWidth).toBeGreaterThanOrEqual((await invite.boundingBox())!.width - 1) // never narrowed by the invite
  })
})

test.describe('TF-03 Safety Gate unchanged', () => {
  test('blocked query: SafetyAlert only, no results and no feedback invitation', async ({ page }) => {
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': '10.99.7.1' }) // own rate-limit bucket
    await page.goto('/demo/falla')
    await page.selectOption('#vehicleType', 'sedan')
    await page.click('button:has-text("Siguiente")')
    await page.fill('#symptomText', 'Tengo una pérdida total de frenos y el vehículo no frena.')
    await page.selectOption('#occurrence', 'Siempre')
    await page.click('button[type="submit"]')
    await expect(page.getByRole('alert').filter({ hasText: 'Consulta bloqueada por seguridad' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('symptom-report')).toHaveCount(0)
    await expect(page.getByTestId('feedback-invite')).toHaveCount(0)
  })
})

// ── 9. Mobile ────────────────────────────────────────────────────────────────

for (const width of [390, 320]) {
  test.describe(`TF-04 feedback — mobile ${width}`, () => {
    test.use({ viewport: { width, height: 844 } })

    test('both routes: full-width CTA inside the viewport, single-line label, no horizontal scroll', async ({ page }) => {
      for (const run of [() => runSymptom(page, BASE), () => runBudget(page, BUDGET)]) {
        await run()
        const invite = page.getByTestId('feedback-invite')
        await invite.scrollIntoViewIfNeeded()
        const box = (await invite.boundingBox())!
        const cta = (await feedbackLink(page).boundingBox())!
        expect(cta.x).toBeGreaterThanOrEqual(box.x)
        expect(cta.x + cta.width).toBeLessThanOrEqual(box.x + box.width + 0.5)
        expect(cta.width).toBeGreaterThan(box.width - 60)
        expect(cta.height).toBeLessThan(56) // one line + padding
        await noHorizontalScroll(page)
        await page.screenshot({ path: `${SHOTS}/${page.url().includes('presupuesto') ? 'presupuesto' : 'falla'}-mobile-${width}.png`, fullPage: true, animations: 'disabled' })
      }
    })
  })
}
