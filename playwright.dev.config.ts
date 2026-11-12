import { defineConfig, devices } from '@playwright/test'

const DEV_BASE_URL = process.env.PLAYWRIGHT_DEV_BASE_URL ?? 'http://localhost:3001'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/increment3-dev.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: DEV_BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-dev',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: DEV_BASE_URL,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
    env: {
      LLM_PROVIDER: 'stub',
      // 6.4E: never touch the real Upstash database from .env.local during E2E; counters stay
      // in memory for this local server only (the stub is never guarded by LLM budgets).
      LLM_QUOTA_STORE: 'memory',
      PORT: '3001',
    },
  },
})
