import { test, expect } from '@playwright/test'

test('la página principal carga y muestra el título', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Chuya Motor/)
})

test('la página principal muestra el aviso de privacidad', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByText('Chuya Motor está en desarrollo')
  ).toBeVisible()
})
