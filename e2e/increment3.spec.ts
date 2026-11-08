/**
 * increment3.spec.ts — Playwright E2E for Increment 3+ (Web UI + API)
 *
 * Production-compatible tests: run against `npm run start` in CI.
 * Dev-only tests live in increment3-dev.spec.ts (playwright.dev.config.ts).
 *
 * Notes:
 * - E2E-01 updated for FASE 6 landing redesign: the marketing landing no longer shows
 *   DemoBadge directly; it links to /demo where the badge appears. CTA cards for the
 *   two main flows are present in the demo-preview section of the landing.
 * - Safety texts used come from safety-policy.ts / blocklist.ts phrases.
 * - Next.js injects a route announcer with role="alert". To avoid false positives
 *   we target the safety alert by its content, not by role alone.
 */

import { test, expect } from '@playwright/test'

// ── E2E-01: Landing page ─────────────────────────────────────────────────────

test('E2E-01: landing page — headline, CTAs, demo links, and privacy notice', async ({
  page,
}) => {
  await page.goto('/')

  // Page title
  await expect(page).toHaveTitle(/Chuya Motor/)

  // Hero H1 — new headline (FASE 6.1)
  await expect(page.getByRole('heading', { level: 1, name: /Tu auto hace/i })).toBeVisible()

  // "Probar demo" CTA in nav
  await expect(page.getByRole('link', { name: /Probar demo/i }).first()).toBeVisible()

  // Landing has CTA links to both main demo flows (via href, since button text is shared)
  await expect(page.locator('a[href="/demo/falla"]').first()).toBeVisible()
  await expect(page.locator('a[href="/demo/presupuesto"]').first()).toBeVisible()

  // Privacy notice — text from privacy-notice.tsx
  await expect(page.getByText('Chuya Motor está en desarrollo')).toBeVisible()
})

// ── E2E-02: Falla flow ────────────────────────────────────────────────────────

test('E2E-02: falla flow — fill form, submit, see report with DEMO badge', async ({ page }) => {
  await page.goto('/falla')

  // Select vehicle type (required)
  await page.selectOption('#vehicleType', 'sedan')

  // Fill symptom text — no safety keywords, clearly > 10 chars
  await page.fill(
    '#symptomText',
    'El motor hace un ruido extraño al arrancar en frío.',
  )

  // Select occurrence (required)
  await page.selectOption('#occurrence', 'Al arrancar')

  // Submit
  await page.click('button[type="submit"]')

  // Wait for the report to appear — Hipótesis orientativas section
  await expect(page.getByText('Hipótesis orientativas')).toBeVisible({ timeout: 15000 })

  // DEMO badge must be visible in the report
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS').first()).toBeVisible()

  // No safety block message should be shown
  await expect(page.getByText('Consulta bloqueada por seguridad')).not.toBeVisible()
})

// ── E2E-03: Presupuesto flow — "Usar ejemplo" button, discrepancy ─────────────

test('E2E-03: presupuesto flow — "Usar ejemplo" → submit → see COMPLETE status with discrepancy', async ({
  page,
}) => {
  await page.goto('/presupuesto')

  // Click "Usar ejemplo" to fill the demo budget
  await page.click('button:has-text("Usar ejemplo")')

  // Submit
  await page.click('button[type="submit"]')

  // Wait for the status indicator to appear
  await expect(page.getByText('COMPLETE')).toBeVisible({ timeout: 15000 })

  // Discrepancy warning
  await expect(
    page.getByText('El total declarado no coincide con la suma calculada'),
  ).toBeVisible({ timeout: 15000 })

  // DEMO badge visible in report
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS').first()).toBeVisible()
})

// ── E2E-04: Safety block ──────────────────────────────────────────────────────

test('E2E-04: safety block — submitting dangerous text shows SafetyAlert', async ({ page }) => {
  await page.goto('/falla')

  await page.selectOption('#vehicleType', 'sedan')
  await page.fill(
    '#symptomText',
    'Tengo una pérdida total de frenos y el vehículo no frena.',
  )
  await page.selectOption('#occurrence', 'Siempre')
  await page.click('button[type="submit"]')

  await expect(
    page.getByText('Consulta bloqueada por seguridad'),
  ).toBeVisible({ timeout: 15000 })

  await expect(page.getByRole('alert').filter({ hasText: 'Consulta bloqueada por seguridad' })).toBeVisible()

  await expect(page.getByRole('heading', { name: 'Hipótesis orientativas' })).not.toBeVisible()
})

// ── E2E-05: Budget — manual input, correct total → no discrepancy message ────

test('E2E-05: budget manual input, correct total → no discrepancy message', async ({
  page,
}) => {
  await page.goto('/presupuesto')

  await page.fill('#budgetText', 'Aceite motor: 4500\nFiltro de aire: 1500\nTotal: 6000')
  await page.click('button[type="submit"]')

  await expect(page.getByText('COMPLETE')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('El total declarado coincide')).toBeVisible({ timeout: 15000 })
  await expect(
    page.getByText('El total declarado no coincide con la suma calculada'),
  ).not.toBeVisible()
})

// ── E2E-06: DEF-01 regression — "Filtro de combustible" en presupuesto NO bloquea ──

test('E2E-06 DEF-01: "Filtro de combustible" como repuesto → reporte COMPLETE, sin safety block', async ({
  page,
}) => {
  await page.goto('/presupuesto')

  await page.fill(
    '#budgetText',
    'Aceite motor: 4500\nFiltro de combustible: 2000\nTotal: 6500',
  )
  await page.click('button[type="submit"]')

  await expect(page.getByText('COMPLETE')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Consulta bloqueada por seguridad')).not.toBeVisible()
})

// ── E2E-07: DEF-02 regression — consulta educativa "funcionan" NO bloquea ────

test('E2E-07 DEF-02: "¿Cómo funcionan los frenos?" → reporte symptom, sin safety block', async ({
  page,
}) => {
  await page.goto('/falla')

  await page.selectOption('#vehicleType', 'sedan')
  await page.fill('#symptomText', '¿Cómo funcionan los frenos de mi auto?')
  await page.selectOption('#occurrence', 'Siempre')
  await page.click('button[type="submit"]')

  await expect(page.getByText('Hipótesis orientativas')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Consulta bloqueada por seguridad')).not.toBeVisible()
})

// ── E2E-08: DEF-03 regression — formato argentino punto-de-miles ─────────────

test('E2E-08 DEF-03: importes argentinos "15.000" → reporte COMPLETE con totales correctos', async ({
  page,
}) => {
  await page.goto('/presupuesto')

  await page.fill(
    '#budgetText',
    'Válvula EGR: 15.000\nFiltro de habitáculo: 3.500\nTotal: 18.500',
  )
  await page.click('button[type="submit"]')

  await expect(page.getByText('COMPLETE')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('El total declarado coincide')).toBeVisible({ timeout: 15000 })
})

// ── E2E-10: Incremento 4 — /api/traces aislado en producción ─────────────────

test('E2E-10 INC4: GET /api/traces returns 404 in production — trace route isolation', async ({
  page,
}) => {
  const response = await page.request.get('/api/traces')
  expect(response.status()).toBe(404)
})

