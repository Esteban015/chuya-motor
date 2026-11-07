/**
 * increment3.spec.ts — Playwright E2E for Increment 3 (Web UI + API)
 *
 * Production-compatible tests: run against `npm run start` in CI.
 * Dev-only tests (TraceViewer, /api/traces 400 path) live in
 * increment3-dev.spec.ts and use playwright.dev.config.ts.
 *
 * Safety texts used come directly from safety-policy.ts / blocklist.ts phrases:
 *   "perdida de frenos" — exact phrase in blocklist, Stage 2 block.
 *
 * Notes:
 * - Next.js injects a route announcer with role="alert". To avoid false positives
 *   we target the safety alert by its content, not by role alone.
 * - The DEMO_BUDGET on the presupuesto page ("Usar ejemplo") uses "Filtro de aceite" (safe)
 *   instead of any safety-flagged keywords. E2E-03 tests the "Usar ejemplo" button directly.
 */

import { test, expect } from '@playwright/test'

// ── E2E-01: Landing page ─────────────────────────────────────────────────────

test('E2E-01: landing page shows title, demo badge, two CTA cards, privacy notice', async ({
  page,
}) => {
  await page.goto('/')

  // Page title
  await expect(page).toHaveTitle(/Chuya Motor/)

  // DEMO badge — exact text from demo-badge.tsx
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeVisible()

  // CTA card: falla flow
  await expect(page.getByRole('link', { name: /Tengo una falla/i })).toBeVisible()

  // CTA card: presupuesto flow
  await expect(page.getByRole('link', { name: /Entender mi presupuesto/i })).toBeVisible()

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

  // No safety block message should be shown — check for absence of the safety heading
  // (we avoid checking `role="alert"` directly because Next.js route announcer also uses that role)
  await expect(page.getByText('Consulta bloqueada por seguridad')).not.toBeVisible()
})

// ── E2E-03: Presupuesto flow — "Usar ejemplo" button, discrepancy ─────────────
// DEMO_BUDGET: Aceite motor:4500 + Filtro de aire:1500 + Filtro de aceite:2000 + Mano de obra:3000 = 11000
// Declared total: 12500 → discrepancy = true

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

  // Discrepancy warning — from report-view.tsx: "El total declarado no coincide"
  await expect(
    page.getByText('El total declarado no coincide con la suma calculada'),
  ).toBeVisible({ timeout: 15000 })

  // DEMO badge visible in report
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS').first()).toBeVisible()
})

// ── E2E-04: Safety block ──────────────────────────────────────────────────────
// "perdida de frenos" is an exact phrase in the blocklist — Stage 2 block.

test('E2E-04: safety block — submitting dangerous text shows SafetyAlert', async ({ page }) => {
  await page.goto('/falla')

  // Select vehicle type
  await page.selectOption('#vehicleType', 'sedan')

  // Safety-triggering text: contains the exact phrase "pérdida total de frenos"
  // which normalizes to "perdida total de frenos" — contains "perdida de frenos"
  await page.fill(
    '#symptomText',
    'Tengo una pérdida total de frenos y el vehículo no frena.',
  )

  // Select occurrence
  await page.selectOption('#occurrence', 'Siempre')

  // Submit
  await page.click('button[type="submit"]')

  // Wait for the safety alert heading — rendered inside <div role="alert"> by SafetyAlert component
  // Using the heading text to target the specific safety alert (not the Next.js route announcer)
  await expect(
    page.getByText('Consulta bloqueada por seguridad'),
  ).toBeVisible({ timeout: 15000 })

  // The SafetyAlert renders with role="alert" — confirm the whole block is present
  await expect(page.getByRole('alert').filter({ hasText: 'Consulta bloqueada por seguridad' })).toBeVisible()

  // No hypothesis section heading should be rendered (the report section heading uses exact case)
  // Use the aria-labeled heading to avoid matching the page intro text which also contains
  // "hipótesis orientativas" in lowercase
  await expect(page.getByRole('heading', { name: 'Hipótesis orientativas' })).not.toBeVisible()
})

// ── E2E-05: Budget — manual input, correct total → no discrepancy message ────

test('E2E-05: budget manual input, correct total → no discrepancy message', async ({
  page,
}) => {
  await page.goto('/presupuesto')

  // Fill budget text directly (correct sum: 4500 + 1500 = 6000)
  await page.fill('#budgetText', 'Aceite motor: 4500\nFiltro de aire: 1500\nTotal: 6000')

  // Submit
  await page.click('button[type="submit"]')

  // Wait for COMPLETE status
  await expect(page.getByText('COMPLETE')).toBeVisible({ timeout: 15000 })

  // "coincide" text — from report-view.tsx: "El total declarado coincide"
  await expect(page.getByText('El total declarado coincide')).toBeVisible({ timeout: 15000 })

  // No discrepancy message should be shown
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

  // Should show COMPLETE budget analysis — NOT a safety block
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

  // Should show hypothesis report — NOT a safety block
  await expect(page.getByText('Hipótesis orientativas')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Consulta bloqueada por seguridad')).not.toBeVisible()
})

// ── E2E-08: DEF-03 regression — formato argentino punto-de-miles ─────────────

test('E2E-08 DEF-03: importes argentinos "15.000" → reporte COMPLETE con totales correctos', async ({
  page,
}) => {
  await page.goto('/presupuesto')

  // 15.000 + 3.500 = 18.500. Declared = 18.500 → discrepancy = false
  await page.fill(
    '#budgetText',
    'Válvula EGR: 15.000\nFiltro de habitáculo: 3.500\nTotal: 18.500',
  )
  await page.click('button[type="submit"]')

  await expect(page.getByText('COMPLETE')).toBeVisible({ timeout: 15000 })
  // Should NOT route as symptom
  await expect(page.getByText('El total declarado coincide')).toBeVisible({ timeout: 15000 })
})

// ── E2E-10: Incremento 4 — /api/traces aislado en producción ─────────────────
// Security contract: the route returns 404 for ALL requests in production.
// The dev-mode 400/MISSING_CASE_ID path is tested in increment3-dev.spec.ts.

test('E2E-10 INC4: GET /api/traces returns 404 in production — trace route isolation', async ({
  page,
}) => {
  const response = await page.request.get('/api/traces')
  expect(response.status()).toBe(404)
})
