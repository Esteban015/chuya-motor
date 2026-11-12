/**
 * fase6.spec.ts — Playwright E2E for FASE 6: Brand Identity + Design System + Landing + Demo UX
 *
 * Covers:
 * - E2E-F6-01: Landing "Probar demo" navigates to /demo
 * - E2E-F6-02: /demo hub shows two CTAs and DemoBadge
 * - E2E-F6-03: /demo/falla step 1 shows #vehicleType; step 2 shows #symptomText + #occurrence
 * - E2E-F6-04: /demo/presupuesto renders budget form (all required IDs)
 * - E2E-F6-05: /falla backward compat — form renders at original path
 * - E2E-F6-06: /presupuesto backward compat — form renders at original path
 * - E2E-F6-07: Keyboard accessibility — CTA links in landing are focusable
 * - E2E-F6-08: Mobile viewport — /demo/falla step 1 renders without overflow at 375px
 * - E2E-F6-09: /demo/falla wizard full flow — step 1 → step 2 → submit → report
 * - E2E-F6-10: /demo/presupuesto full flow — form submission returns report
 */

import { test, expect } from '@playwright/test'

// ── E2E-F6-01: Landing → /demo navigation ────────────────────────────────────

test('E2E-F6-01: landing "Probar demo" CTA navigates to /demo', async ({ page }) => {
  await page.goto('/')

  // Find "Probar demo" in the hero/nav — first occurrence (nav CTA)
  const ctaLink = page.getByRole('link', { name: /Probar demo/i }).first()
  await expect(ctaLink).toBeVisible()

  await ctaLink.click()

  await expect(page).toHaveURL(/\/demo/)
  // /demo should show DemoBadge
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeVisible({ timeout: 5000 })
})

// ── E2E-F6-02: /demo hub ─────────────────────────────────────────────────────

test('E2E-F6-02: /demo hub shows DemoBadge and two CTA cards', async ({ page }) => {
  await page.goto('/demo')

  // DemoBadge
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeVisible()

  // Two CTA cards with correct text
  await expect(page.getByRole('link', { name: /Tengo una falla/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Entender mi presupuesto/i })).toBeVisible()

  // Back link to inicio
  await expect(page.getByRole('link', { name: /Inicio/i })).toBeVisible()
})

// ── E2E-F6-03: /demo/falla — wizard steps contain required IDs ───────────────

test('E2E-F6-03: /demo/falla step 1 has #vehicleType; step 2 has #symptomText and #occurrence', async ({
  page,
}) => {
  await page.goto('/demo/falla')

  // Step 1 — vehicleType is visible, symptomText is NOT (different step)
  await expect(page.locator('#vehicleType')).toBeVisible()
  await expect(page.locator('#symptomText')).not.toBeVisible()

  // DemoBadge in header
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeVisible()

  // Advance to step 2
  await page.selectOption('#vehicleType', 'sedan')
  await page.click('button:has-text("Siguiente")')

  // Step 2 — symptomText and occurrence are now visible
  await expect(page.locator('#symptomText')).toBeVisible()
  await expect(page.locator('#occurrence')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

// ── E2E-F6-04: /demo/presupuesto — form IDs present ─────────────────────────

test('E2E-F6-04: /demo/presupuesto renders budget form with all required field IDs', async ({
  page,
}) => {
  await page.goto('/demo/presupuesto')

  // Required form fields
  await expect(page.locator('#budgetText')).toBeVisible()

  // Submit button
  await expect(page.locator('button[type="submit"]')).toBeVisible()

  // "Usar ejemplo" button preserved
  await expect(page.locator('button:has-text("Usar ejemplo")')).toBeVisible()

  // DemoBadge shown
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeVisible()
})

// ── E2E-F6-05: /falla backward compat ────────────────────────────────────────

test('E2E-F6-05: /falla original path still renders analysis form', async ({ page }) => {
  await page.goto('/falla')

  await expect(page.locator('#vehicleType')).toBeVisible()
  await expect(page.locator('#symptomText')).toBeVisible()
  await expect(page.locator('#occurrence')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

// ── E2E-F6-06: /presupuesto backward compat ──────────────────────────────────

test('E2E-F6-06: /presupuesto original path still renders budget form', async ({ page }) => {
  await page.goto('/presupuesto')

  await expect(page.locator('#budgetText')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
  await expect(page.locator('button:has-text("Usar ejemplo")')).toBeVisible()
})

// ── E2E-F6-07: Keyboard accessibility — landing CTAs focusable ───────────────

test('E2E-F6-07: landing CTA links are keyboard-focusable', async ({ page }) => {
  await page.goto('/')

  // Tab through the page until we find a "Probar demo" link focused
  // We test focus reachability, not exact tab order (order may change with design)
  const ctaLinks = page.getByRole('link', { name: /Probar demo/i })
  const count = await ctaLinks.count()
  expect(count).toBeGreaterThan(0)

  // Each CTA link must be focusable (not disabled/hidden)
  for (let i = 0; i < count; i++) {
    const link = ctaLinks.nth(i)
    await expect(link).toBeVisible()
    await link.focus()
    await expect(link).toBeFocused()
  }
})

// ── E2E-F6-08: Mobile viewport (375px) — step 1 renders without overflow ─────

test('E2E-F6-08: mobile viewport 375px — /demo/falla step 1 renders without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/demo/falla')

  // Step 1 essential elements visible at mobile width
  await expect(page.locator('#vehicleType')).toBeVisible()
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeVisible()

  // No horizontal overflow: body scroll width should not exceed viewport
  const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth)
  expect(bodyScrollWidth).toBeLessThanOrEqual(375 + 2) // +2px for rounding tolerance
})

// ── E2E-F6-09: /demo/falla wizard full flow ───────────────────────────────────

test('E2E-F6-09: /demo/falla wizard — step 1 → step 2 → submit → hypothesis report', async ({
  page,
}) => {
  await page.goto('/demo/falla')

  // Step 1: select vehicle type, advance
  await page.selectOption('#vehicleType', 'sedan')
  await page.click('button:has-text("Siguiente")')

  // Step 2: fill symptom and occurrence, submit
  await page.fill('#symptomText', 'El motor hace un ruido extraño al arrancar en frío.')
  await page.selectOption('#occurrence', 'Al arrancar')
  await page.click('button[type="submit"]')

  await expect(page.getByRole('heading', { name: 'Hipótesis orientativas' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS').first()).toBeVisible()
  await expect(page.getByText('Consulta bloqueada por seguridad')).not.toBeVisible()
})

// ── E2E-F6-11: /demo/falla wizard — CRITICAL brake symptom shows SeverityBanner ─

test('E2E-F6-11: /demo/falla wizard — critical brake symptom shows SeverityBanner', async ({
  page,
}) => {
  await page.goto('/demo/falla')

  // Step 1: select vehicle type, advance
  await page.selectOption('#vehicleType', 'sedan')
  await page.click('button:has-text("Siguiente")')

  // Step 2: submit a symptom that triggers CRITICAL severity (barely braking)
  await page.fill('#symptomText', 'El vehículo apenas frena cuando piso el pedal.')
  await page.selectOption('#occurrence', 'Al frenar')
  await page.click('button[type="submit"]')

  // Wait for hypotheses to appear (indicates non-blocked success state)
  await expect(page.getByRole('heading', { name: 'Hipótesis orientativas' })).toBeVisible({ timeout: 15000 })

  // SeverityBanner with data-severity="critical" must appear ABOVE hypotheses
  const banner = page.locator('[data-severity="critical"]')
  await expect(banner).toBeVisible()
  await expect(banner).toHaveAttribute('role', 'alert')

  // Banner is positioned before hypotheses in DOM order
  const bannerIndex = await banner.evaluate((el) => {
    const all = Array.from(document.querySelectorAll('[data-severity], [data-testid="hypotheses"]'))
    return all.indexOf(el)
  })
  const hypothesesIndex = await page.locator('[data-testid="hypotheses"]').evaluate((el) => {
    const all = Array.from(document.querySelectorAll('[data-severity], [data-testid="hypotheses"]'))
    return all.indexOf(el)
  })
  expect(bannerIndex).toBeLessThan(hypothesesIndex)
})

// ── E2E-F6-10: /demo/presupuesto full flow ────────────────────────────────────

test('E2E-F6-10: /demo/presupuesto full flow — "Usar ejemplo" → submit → COMPLETE', async ({
  page,
}) => {
  await page.goto('/demo/presupuesto')

  await page.click('button:has-text("Usar ejemplo")')
  await page.click('button[type="submit"]')

  await expect(page.getByText('COMPLETE')).toBeVisible({ timeout: 15000 })
  await expect(page.getByText('MODO DEMO · RESPUESTAS SIMULADAS').first()).toBeVisible()
  await expect(page.getByText('Consulta bloqueada por seguridad')).not.toBeVisible()
})
