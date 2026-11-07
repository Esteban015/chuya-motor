// TEMPORARY exploratory audit config — do not commit.
// Tests live in scratchpad; this file is the entry point inside the project so
// @playwright/test resolves from node_modules.
import { defineConfig, devices } from '@playwright/test'

const SCRATCHPAD = 'C:\\Users\\Esteban\\AppData\\Local\\Temp\\claude\\C--Users-Esteban-Documents-chuya-motor\\d67bbba1-b6cd-4eb1-864a-545859b5811b\\scratchpad'

export default defineConfig({
  testDir: './explore-audit',
  fullyParallel: false,
  retries: 0,
  timeout: 20000,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `${SCRATCHPAD}/playwright-report` }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'on',
    trace: 'off',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // No webServer — reuse existing localhost:3000
  outputDir: `${SCRATCHPAD}/test-results`,
})
