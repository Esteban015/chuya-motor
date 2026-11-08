/**
 * increment3-dev.spec.ts — Playwright E2E dev-only tests (Increment 3+4)
 *
 * Tests that require a Next.js development server (npm run dev) because they
 * verify functionality intentionally disabled in production:
 *
 *   E2E-09: TraceViewer renders with DEMO notice only when report.nodeTrace !== null.
 *           In production, nodeTrace is null and the component never mounts.
 *           The dev server returns real trace data → component renders → notice visible.
 *
 *   E2E-10-DEV: /api/traces returns 400 for missing caseId in dev mode.
 *               In production, the route returns 404 for ALL requests (security contract).
 *               See E2E-10 in increment3.spec.ts for the production isolation test.
 *
 * Config: playwright.dev.config.ts (uses npm run dev, port 3001, LLM_PROVIDER=stub).
 * Excluded from playwright.config.ts (production tests) via testIgnore.
 */

import { test, expect } from '@playwright/test'

// ── E2E-09: Incremento 4 — trace viewer visible en servidor de desarrollo ─────

test('E2E-09 INC4: trace viewer renders in dev mode — collapsible, shows DEMO notice', async ({
  page,
}) => {
  await page.goto('/falla')

  await page.selectOption('#vehicleType', 'sedan')
  await page.fill('#symptomText', 'El motor hace un ruido extraño al arrancar en frío.')
  await page.selectOption('#occurrence', 'Al arrancar')
  await page.click('button[type="submit"]')

  // Wait for report
  await expect(page.getByText('Hipótesis orientativas')).toBeVisible({ timeout: 15000 })

  // The DEMO notice inside the trace section must be visible (always shown, not collapsible)
  await expect(
    page.getByText('MODO DEMO — Solo datos sintéticos. No ingresar datos reales.').first(),
  ).toBeVisible()

  // The trace section is collapsed by default — the toggle button should be present
  await expect(page.getByRole('button', { name: /Trazas de nodos/i })).toBeVisible()

  // Expand the trace viewer
  await page.click('button:has-text("Trazas de nodos")')

  // After expanding, the table with node names should be visible
  await expect(page.getByRole('table', { name: /Tabla de nodos ejecutados/i })).toBeVisible()

  // The "validator" node should appear in the trace
  await expect(page.getByRole('cell', { name: 'validator', exact: true })).toBeVisible()
})

// ── E2E-10-DEV: Incremento 4 — /api/traces returns 400 in dev mode ───────────

test('E2E-10-DEV INC4: GET /api/traces returns 400 for missing caseId in dev mode', async ({
  page,
}) => {
  const response = await page.request.get('/api/traces')
  expect(response.status()).toBe(400)
  const body = (await response.json()) as { error: string }
  expect(body.error).toBe('MISSING_CASE_ID')
})

// ── E2E-11-DEV: Severity Banner — critical brake symptom (via /falla) ────────
// Moved from increment3.spec.ts: in CI production mode, the in-memory rate limiter
// (RATE_LIMIT=10) is exhausted by prior suite tests before this one runs (11th API call).
// The dev server restarts between file runs, resetting the rate limiter.
// Production coverage for the banner feature is provided by E2E-F6-11 in fase6.spec.ts
// (runs as the 2nd API call in the prod suite, well within the rate limit).

test('E2E-11-DEV: critical brake symptom via /falla — severity banner shown above hypotheses, case not blocked', async ({
  page,
}) => {
  await page.goto('/falla')

  await page.selectOption('#vehicleType', 'sedan')
  await page.fill(
    '#symptomText',
    'Tengo que pisar muy a fondo el pedal para que comience a frenar.',
  )
  await page.selectOption('#occurrence', 'Al frenar')
  await page.click('button[type="submit"]')

  // 1. Case is NOT blocked
  await expect(page.getByText('Hipótesis orientativas')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('Consulta bloqueada por seguridad')).not.toBeVisible()

  // 2. Severity banner visible with critical level
  const banner = page.locator('[data-severity="critical"]')
  await expect(banner).toBeVisible({ timeout: 5000 })

  // 3. Banner has role=alert (accessibility contract)
  await expect(banner).toHaveAttribute('role', 'alert')

  // 4. Banner appears BEFORE hypotheses heading in document order
  const bannerBox = await banner.boundingBox()
  const hypothesesHeading = page.getByRole('heading', { name: 'Hipótesis orientativas' })
  const hypothesesBox = await hypothesesHeading.boundingBox()
  expect(bannerBox).not.toBeNull()
  expect(hypothesesBox).not.toBeNull()
  expect(bannerBox!.y).toBeLessThan(hypothesesBox!.y)
})
