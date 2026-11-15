import { defineConfig, devices } from '@playwright/test'

// Force deterministic mock adapter for E2E tests.
// process.env takes precedence over .env.local in Next.js, so LLM_PROVIDER=stub
// prevents the server from reading LLM_PROVIDER=gemini from the user's .env.local.
// This ensures E2E tests are deterministic regardless of local LLM configuration.
const E2E_ENV: Record<string, string> = {
  LLM_PROVIDER: 'stub',
  // 6.4E: never touch the real Upstash database from .env.local during E2E; counters stay
  // in memory for this local server only (the stub is never guarded by LLM budgets).
  LLM_QUOTA_STORE: 'memory',
  // 7A: test-only feedback form URL (never a real form; the E2E never contacts Google).
  // NEXT_PUBLIC_* is inlined at build time: CI builds with the same value (ci.yml).
  NEXT_PUBLIC_FEEDBACK_FORM_URL: 'https://docs.google.com/forms/d/e/E2E-TEST-ONLY/viewform',
  // 7C: the automatic parts pricing UI is ON for E2E, but the provider is forced to "none" so the
  // server can never call SerpApi, even if .env.local holds SERPAPI_API_KEY. Successful searches
  // are simulated with page.route() (e2e/parts-pricing.spec.ts).
  PARTS_PRICING_ENABLED: 'true',
  PARTS_PRICING_PROVIDER: 'none',
  // 7D.1/7D.2: the main E2E server runs with the catalog kill switch (free-text forms), whatever
  // .env.local says; the catalog server below runs the default (real catalog ON).
  VEHICLE_CATALOG_ENABLED: 'false',
}

/**
 * 7D.1/7D.2: a SECOND production server (CI only, same build) with the vehicle catalog ON and its
 * default source — the REAL DNRPA-derived catalog shipped in data/vehicle-catalog — so
 * e2e/vehicle-selector.spec.ts exercises the public experience, while every other spec keeps the
 * free-text fields (kill switch VEHICLE_CATALOG_ENABLED=false). Locally, run the spec against your
 * own server with PLAYWRIGHT_CATALOG_BASE_URL, or it is skipped.
 */
const CATALOG_E2E_PORT = 3002

/**
 * 7E: a THIRD production server (CI only, same build) where the AI is unavailable: a real provider
 * selected without a key AND the LLM kill switch on, so no request can ever leave the machine.
 * e2e/budget-deterministic.spec.ts checks that the budget verification survives. Locally, run it
 * against your own server with PLAYWRIGHT_AI_DOWN_BASE_URL, or it is skipped.
 */
const AI_DOWN_E2E_PORT = 3003
const AI_DOWN_ENV: Record<string, string> = { ...E2E_ENV, LLM_PROVIDER: 'groq', GROQ_API_KEY: '', LLM_KILL_SWITCH: 'true' }

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
  webServer: [
    {
      command: process.env.CI ? 'npm run start' : 'npm run dev',
      url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      env: E2E_ENV,
    },
    ...(process.env.CI
      ? [
          {
            command: `npm run start -- -p ${CATALOG_E2E_PORT}`,
            url: `http://localhost:${CATALOG_E2E_PORT}`,
            reuseExistingServer: false,
            env: { ...E2E_ENV, VEHICLE_CATALOG_ENABLED: 'true' },
          },
          {
            command: `npm run start -- -p ${AI_DOWN_E2E_PORT}`,
            url: `http://localhost:${AI_DOWN_E2E_PORT}`,
            reuseExistingServer: false,
            env: AI_DOWN_ENV,
          },
        ]
      : []),
  ],
})
