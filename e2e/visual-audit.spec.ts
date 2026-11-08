/**
 * visual-audit.spec.ts — Screenshots para auditoría visual FASE 6.1
 * Correr una sola vez con: npx playwright test e2e/visual-audit.spec.ts --config=playwright.config.ts
 * No es parte del suite de regresión continua.
 */
import { test } from '@playwright/test'

test('screenshot: hero desktop 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: 'screenshots/hero-desktop-1440.png', fullPage: false })
})

test('screenshot: sintomas desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('#sintomas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'screenshots/sintomas-desktop.png', fullPage: false })
})

test('screenshot: presupuestos desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('#presupuestos').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'screenshots/presupuestos-desktop.png', fullPage: false })
})

test('screenshot: seguridad desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('#seguridad').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'screenshots/seguridad-desktop.png', fullPage: false })
})

test('screenshot: hero mobile 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: 'screenshots/hero-mobile-390.png', fullPage: false })
})

test('screenshot: landing completa', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: 'screenshots/landing-full.png', fullPage: true })
})

test('screenshot: landing mobile completa', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: 'screenshots/landing-mobile-full.png', fullPage: true })
})
