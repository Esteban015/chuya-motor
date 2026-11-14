import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/increment3-dev.spec.ts', '**/visual-audit.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Force deterministic mock adapter for E2E tests.
    // process.env takes precedence over .env.local in Next.js, so LLM_PROVIDER=stub
    // prevents the server from reading LLM_PROVIDER=gemini from the user's .env.local.
    // This ensures E2E tests are deterministic regardless of local LLM configuration.
    env: {
      LLM_PROVIDER: 'stub',
      // 6.4E: never touch the real Upstash database from .env.local during E2E; counters stay
      // in memory for this local server only (the stub is never guarded by LLM budgets).
      LLM_QUOTA_STORE: 'memory',
      // 7A: test-only feedback form URL (never a real form; the E2E never contacts Google).
      // NEXT_PUBLIC_* is inlined at build time: CI builds with the same value (ci.yml).
      NEXT_PUBLIC_FEEDBACK_FORM_URL: 'https://docs.google.com/forms/d/e/E2E-TEST-ONLY/viewform',
    },
  },
})
