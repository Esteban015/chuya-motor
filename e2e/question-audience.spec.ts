/**
 * question-audience.spec.ts — Bugfix 7B: questions for the driver vs. questions for the workshop.
 *
 * Runs against the stub server (LLM_PROVIDER=stub from playwright.config.ts): no real provider, no
 * fixture for /api/analyze, so the server-side classification is exercised end to end.
 * Screenshots go to the git-ignored reviews-local/screenshots/7b.
 */
import { test, expect, type Page } from '@playwright/test'

const SHOTS = 'reviews-local/screenshots/7b'
const CHECK_ENGINE = 'Se enciende la luz de check engine intermitente'
const OBSERVED_DRIVER = /notás|Notaste|Te hicieron|Podés llevar|Aparecen otros síntomas/

let ipSeq = 1
async function ownBucket(page: Page) {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 200)}.${ipSeq++}` })
}

function countAnalyze(page: Page) {
  const calls: string[] = []
  page.on('request', (r) => {
    if (new URL(r.url()).pathname === '/api/analyze') calls.push(r.method())
  })
  return calls
}

async function runCheckEngine(page: Page) {
  await page.goto('/demo/falla')
  await page.selectOption('#vehicleType', 'sedan')
  await page.click('button:has-text("Siguiente")')
  await page.fill('#symptomText', CHECK_ENGINE)
  await page.selectOption('#occurrence', 'Siempre')
  await page.click('button[type="submit"]')
  await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
}

const workshop = (page: Page) => page.getByRole('region', { name: 'Preguntas para el taller' })
const driver = (page: Page) => page.getByRole('region', { name: 'Para preparar tu consulta' })

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(scroll).toBeLessThanOrEqual(client)
}

test.describe('QA-E2E-01 check engine — desktop 1280', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('two sections; workshop questions are mechanic-directed; ambiguity asked to the driver; one analysis call', async ({ page }) => {
    await ownBucket(page)
    const calls = countAnalyze(page)
    await runCheckEngine(page)

    await expect(driver(page)).toBeVisible()
    await expect(driver(page)).toContainText('Preguntas para vos')
    await expect(driver(page)).toContainText(/parpadea .* queda fija y aparece solo algunas veces/)

    await expect(workshop(page)).toContainText('Para hacerle al mecánico')
    await expect(workshop(page)).toContainText('¿Qué códigos de falla registró el escáner OBD-II y qué indica cada uno?')
    await expect(workshop(page)).toContainText('¿Qué pruebas permiten confirmar la causa antes de reemplazar componentes?')
    await expect(workshop(page)).not.toContainText(OBSERVED_DRIVER)
    await expect(workshop(page)).not.toContainText('¿Cuándo empezó el problema?')

    // Driver section comes first (prepare), workshop after.
    const d = (await driver(page).boundingBox())!
    const w = (await workshop(page).boundingBox())!
    expect(w.y).toBeGreaterThan(d.y)

    expect(calls).toEqual(['POST'])
    await noHorizontalScroll(page)
    await page.screenshot({ path: `${SHOTS}/check-engine-desktop-1280.png`, fullPage: true, animations: 'disabled' })
  })

  test('"Copiar preguntas" copies only the workshop questions', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only here')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await ownBucket(page)
    await runCheckEngine(page)
    await workshop(page).getByRole('button', { name: 'Copiar preguntas' }).click()
    await expect(workshop(page).getByRole('status')).toHaveText('Copiadas')
    const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')
    expect(copied.startsWith('Preguntas para el taller:\n1. ')).toBe(true)
    expect(copied).toContain('OBD-II')
    expect(copied).not.toMatch(/parpadea \(|Preguntas para vos|¿Cuándo empezó el problema\?/)
    await expect(driver(page).getByRole('button')).toHaveCount(0)
  })
})

test.describe('QA-E2E-02 budget', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('example quote with a mismatched total → workshop asks to review the sum; no driver section', async ({ page }) => {
    await ownBucket(page)
    const calls = countAnalyze(page)
    await page.goto('/demo/presupuesto')
    await page.click('button:has-text("Usar ejemplo")')
    await page.click('button[type="submit"]')
    await expect(page.getByTestId('budget-report')).toBeVisible({ timeout: 15000 })
    await expect(workshop(page)).toBeVisible()
    await expect(workshop(page).locator('li').first()).toContainText('¿Pueden revisar la suma del presupuesto?')
    await expect(workshop(page)).toContainText('mano de obra')
    await expect(workshop(page)).not.toContainText(/caro|barato|excesiv|razonable/i)
    await expect(driver(page)).toHaveCount(0)
    expect(calls).toEqual(['POST'])
    await page.screenshot({ path: `${SHOTS}/presupuesto-desktop-1280.png`, fullPage: true, animations: 'disabled' })
  })
})

test.describe('QA-E2E-03 Safety Gate unchanged', () => {
  test('critical brakes: SafetyAlert only, no question sections', async ({ page }) => {
    await ownBucket(page)
    await page.goto('/demo/falla')
    await page.selectOption('#vehicleType', 'sedan')
    await page.click('button:has-text("Siguiente")')
    await page.fill('#symptomText', 'Tengo una pérdida total de frenos y el vehículo no frena.')
    await page.selectOption('#occurrence', 'Siempre')
    await page.click('button[type="submit"]')
    await expect(page.getByRole('alert').filter({ hasText: 'Consulta bloqueada por seguridad' })).toBeVisible({ timeout: 15000 })
    await expect(workshop(page)).toHaveCount(0)
    await expect(driver(page)).toHaveCount(0)
  })
})

for (const width of [390, 320]) {
  test.describe(`QA-E2E-04 mobile ${width}`, () => {
    test.use({ viewport: { width, height: 844 } })

    test('both sections readable, driver before workshop, no horizontal scroll', async ({ page }) => {
      await ownBucket(page)
      await runCheckEngine(page)
      await expect(driver(page)).toBeVisible()
      await expect(workshop(page)).toBeVisible()
      const d = (await driver(page).boundingBox())!
      const w = (await workshop(page).boundingBox())!
      expect(w.y).toBeGreaterThan(d.y + d.height - 1)
      expect(d.width).toBeLessThanOrEqual(width)
      await noHorizontalScroll(page)
      await page.screenshot({ path: `${SHOTS}/check-engine-mobile-${width}.png`, fullPage: true, animations: 'disabled' })
    })
  })
}

// ── Safety review: engine warning light severity (stub server, no fixtures) ──

async function runSymptom(page: Page, text: string, occurrence: string) {
  await page.goto('/demo/falla')
  await page.selectOption('#vehicleType', 'sedan')
  await page.click('button:has-text("Siguiente")')
  await page.fill('#symptomText', text)
  await page.selectOption('#occurrence', occurrence)
  await page.click('button[type="submit"]')
}

test.describe('QA-E2E-05 engine light severity', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('blinking → HIGH banner (reduce speed, stop if power loss), never "No conduzcas", before the hypotheses', async ({ page }) => {
    await ownBucket(page)
    await runSymptom(page, 'La luz de check engine parpadea', 'Siempre')
    await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
    const banner = page.locator('[data-severity="high"]')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('catalizador')
    await expect(banner).toContainText('Atención: luz de motor que parpadea')
    await expect(banner).toContainText('No sigas circulando normalmente.')
    await expect(banner).toContainText('detenete en un lugar seguro y apagá el motor')
    await expect(banner).toContainText('Pedí asistencia mecánica o una grúa')
    await expect(banner).not.toContainText(/llevá el vehículo a un taller/i)
    await expect(page.locator('[data-severity="critical"]')).toHaveCount(0)
    await expect(page.getByText('No conduzcas')).toHaveCount(0)
    const h = await page.getByRole('heading', { name: 'Hipótesis orientativas' }).boundingBox()
    expect((await banner.boundingBox())!.y).toBeLessThan(h!.y)
    await expect(workshop(page)).toContainText('OBD-II')
    await page.screenshot({ path: `${SHOTS}/check-engine-parpadea-1280.png`, fullPage: true, animations: 'disabled' })
  })

  test('"intermitente" next to the engine light → conditional HIGH banner + clarification for the driver', async ({ page }) => {
    await ownBucket(page)
    await runSymptom(page, CHECK_ENGINE, 'Siempre')
    await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
    const banner = page.locator('[data-severity="high"]')
    await expect(banner).toContainText('No está claro si la luz de motor parpadea o aparece solo a veces')
    await expect(driver(page)).toContainText(/parpadea .* queda fija y aparece solo algunas veces/)
  })

  test('steady light → no banner; report and questions intact', async ({ page }) => {
    await ownBucket(page)
    await runSymptom(page, 'La luz de check engine está fija', 'Siempre')
    await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('[data-severity]')).toHaveCount(0)
    await expect(workshop(page)).toContainText('OBD-II')
  })

  test('wizard occurrence "Intermitente" is not a blinking light → no banner, "sometimes" clarification', async ({ page }) => {
    await ownBucket(page)
    await runSymptom(page, 'Se prendió la luz de check engine', 'Intermitente')
    await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('[data-severity]')).toHaveCount(0)
    await expect(driver(page)).toContainText('Cuando aparece, ¿la luz queda fija o parpadea?')
    await expect(driver(page)).not.toContainText('Cuando decís que la luz está intermitente')
  })

  test('concurrent HIGH symptom (brake noise) does not hide the stop instruction', async ({ page }) => {
    await ownBucket(page)
    await runSymptom(page, 'La luz de check engine parpadea y chillan los frenos', 'Siempre')
    await expect(page.getByTestId('symptom-report')).toBeVisible({ timeout: 15000 })
    const banner = page.locator('[data-severity="high"]')
    await expect(banner).toContainText('Atención: luz de motor que parpadea')
    await expect(banner).toContainText('detenete en un lugar seguro')
  })

  test('concurrent smoke: Safety Gate block with the CRITICAL fire warning', async ({ page }) => {
    await ownBucket(page)
    await runSymptom(page, 'La luz de check engine parpadea y sale humo del motor', 'Siempre')
    const alert = page.getByRole('alert').filter({ hasText: 'Consulta bloqueada por seguridad' })
    await expect(alert).toBeVisible({ timeout: 15000 })
    await expect(alert.locator('[data-severity="critical"]')).toContainText('posible riesgo de incendio')
    await expect(page.getByTestId('symptom-report')).toHaveCount(0)
  })

  test('loss of braking capacity keeps priority over a blinking engine light (critical)', async ({ page }) => {
    await ownBucket(page)
    await runSymptom(page, 'Parpadea el check engine y casi no frena', 'Siempre')
    await expect(page.locator('[data-severity="critical"]')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('[data-severity="critical"]')).toContainText('No conduzcas')
  })
})
