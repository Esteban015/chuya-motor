/**
 * Benchmark Smoke Test — 3-scenario fast validation.
 *
 * Purpose: Verify the benchmark infrastructure works end-to-end before a full run.
 * Default: mock LLM. No real API calls by default.
 *
 * Usage — mock mode (safe, no billing):
 *   npx tsx benchmark/smoke/smoke.ts
 *
 * Usage — real mode with Gemini free tier (Git Bash — recommended):
 *   # Option A: set vars in .env.local (loaded automatically by this script):
 *   #   LLM_PROVIDER=gemini
 *   #   GEMINI_API_KEY=<your-ai-studio-key>
 *   #   GEMINI_MODEL=gemini-2.5-flash
 *   # Then run with the authorization flag only (session var takes precedence over .env.local):
 *   BENCHMARK_REAL_LLM_AUTHORIZED=true npx tsx benchmark/smoke/smoke.ts
 *
 *   # Option B: pass all vars inline:
 *   LLM_PROVIDER=gemini GEMINI_API_KEY=<key> BENCHMARK_REAL_LLM_AUTHORIZED=true npx tsx benchmark/smoke/smoke.ts
 *
 * Usage — real mode with Anthropic (billable):
 *   LLM_PROVIDER=anthropic LLM_API_KEY=sk-ant-... BENCHMARK_REAL_LLM_AUTHORIZED=true npx tsx benchmark/smoke/smoke.ts
 *
 * Guards:
 *   - Real mode is blocked when CI env var is set (prevents accidental billing in CI).
 *   - Real mode requires BENCHMARK_REAL_LLM_AUTHORIZED=true.
 *   - Anthropic real mode requires LLM_API_KEY.
 *   - Gemini real mode requires GEMINI_API_KEY; model must be in free-tier allowlist.
 *   - Gemini free tier: 12s delay between scenarios to stay within 5 RPM limit.
 *
 * Privacy (Gemini free tier):
 *   AI Studio keys may submit data to Google for model improvement.
 *   Only use synthetic data. See: https://ai.google.dev/gemini-api/terms
 */

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { BenchmarkMode } from '../runner/types'
import { runBenchmark } from '../runner/runner'
import { scenarios } from '../dataset/scenarios'

// --- .env.local loader -------------------------------------------------------
// Loads .env.local from the project root (process.cwd()) before main() runs.
// Session-level vars (e.g. BENCHMARK_REAL_LLM_AUTHORIZED passed inline) always
// take precedence — this never overwrites already-set vars.
// BENCHMARK_REAL_LLM_AUTHORIZED must be passed at session level, not .env.local,
// so it remains an explicit one-time authorization each run.
function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadEnvLocal()
// -----------------------------------------------------------------------------

const SMOKE_SCENARIO_IDS = ['SYM-001', 'BUD-001', 'SAF-001']

// Gemini AI Studio free tier: 5 RPM = 1 request per 12 seconds.
// Applied as a between-scenario delay when running real Gemini mode.
const GEMINI_RPM_DELAY_MS = 12_000

function resolveMode(): BenchmarkMode {
  const realAuthorized = process.env['BENCHMARK_REAL_LLM_AUTHORIZED'] === 'true'
  if (!realAuthorized) return 'mock'

  if (process.env['CI']) {
    console.error('ERROR: Real mode is disabled in CI environments (CI env var is set).')
    console.error('Real LLM calls must be run locally with explicit authorization.')
    process.exit(1)
  }

  const provider = process.env['LLM_PROVIDER'] ?? 'stub'

  if (provider === 'anthropic') {
    if (!process.env['LLM_API_KEY']) {
      console.error('ERROR: Real mode with Anthropic requires LLM_API_KEY to be set.')
      process.exit(1)
    }
    return 'real'
  }

  if (provider === 'gemini') {
    if (!process.env['GEMINI_API_KEY']) {
      console.error('ERROR: Real mode with Gemini requires GEMINI_API_KEY to be set.')
      console.error('Use an AI Studio key (not a GCP project with billing): https://aistudio.google.com/')
      process.exit(1)
    }
    return 'real'
  }

  console.error(`ERROR: Real mode requires LLM_PROVIDER=anthropic or LLM_PROVIDER=gemini, got "${provider}".`)
  process.exit(1)
}

function printProviderHeader(mode: BenchmarkMode): void {
  const provider = process.env['LLM_PROVIDER'] ?? 'stub'

  if (mode === 'real' && provider === 'anthropic') {
    console.log()
    console.log('⚠️  BILLING WARNING: This run will make real API calls to Anthropic.')
    console.log('⚠️  Costs will be incurred. Proceeding because BENCHMARK_REAL_LLM_AUTHORIZED=true.')
    console.log(`    Model: ${process.env['LLM_MODEL'] ?? 'claude-haiku-4-5-20251001 (default)'}`)
  }

  if (mode === 'real' && provider === 'gemini') {
    console.log()
    console.log('ℹ️  GEMINI FREE TIER: This run uses your GEMINI_API_KEY (AI Studio key).')
    console.log('ℹ️  Free-tier limits apply. Charges may apply if billing is enabled on your project.')
    console.log('ℹ️  Privacy: AI Studio free-tier may use data to improve Google products.')
    console.log('ℹ️  Only use synthetic data. See: https://ai.google.dev/gemini-api/terms')
    console.log(`    Model: ${process.env['GEMINI_MODEL'] ?? 'gemini-3.5-flash-lite (default)'}`)
    console.log(`    Rate limit guard: ${GEMINI_RPM_DELAY_MS / 1000}s delay between scenarios (5 RPM limit).)`)
    console.log('    To list models accessible for your key:')
    console.log('      npx tsx benchmark/smoke/gemini-list-models.ts')
  }
}

// Safe diagnostic hints — no credentials or prompt content; only actionable steps.
const LLM_DIAGNOSIS_HINTS: Record<string, string> = {
  LLM_AUTH_ERROR: 'Check GEMINI_API_KEY in .env.local — key may be invalid or expired.',
  LLM_QUOTA_EXCEEDED: 'Rate limit or daily quota exceeded. Wait and retry, or check aistudio.google.com.',
  LLM_MODEL_UNAVAILABLE:
    'Model not accessible for your API key. Run: npx tsx benchmark/smoke/gemini-list-models.ts' +
    ' to see available models. For new AI Studio projects, try GEMINI_MODEL=gemini-3.5-flash-lite.',
  LLM_EMPTY_RESPONSE: 'Gemini returned empty text. May be a safety filter or model truncation issue.',
  LLM_TIMEOUT: 'Request timed out. Check network connectivity or increase timeoutMs.',
  LLM_PROVIDER_UNAVAILABLE: 'Gemini service error. Check status.cloud.google.com.',
  LLM_SCHEMA_VIOLATION: 'Gemini safety block or unexpected response format.',
}

async function main(): Promise<void> {
  const mode = resolveMode()
  const provider = process.env['LLM_PROVIDER'] ?? 'stub'

  console.log('=== Chuya Motor Benchmark Smoke Test ===')
  console.log(`Mode: ${mode === 'mock' ? 'mock (no real API calls)' : `real [provider=${provider}]`}`)

  printProviderHeader(mode)
  console.log()

  const smokeScenarios = scenarios.filter((s) => SMOKE_SCENARIO_IDS.includes(s.id))

  if (smokeScenarios.length !== SMOKE_SCENARIO_IDS.length) {
    const missing = SMOKE_SCENARIO_IDS.filter((id) => !smokeScenarios.some((s) => s.id === id))
    console.error(`ERROR: Missing scenarios: ${missing.join(', ')}`)
    process.exit(1)
  }

  // Gemini free tier: enforce 5 RPM limit via minimum inter-scenario delay.
  const scenarioDelayMs = mode === 'real' && provider === 'gemini' ? GEMINI_RPM_DELAY_MS : undefined

  const run = await runBenchmark(smokeScenarios, {
    mode,
    timeoutMs: mode === 'real' ? 30_000 : 15_000,
    scenarioDelayMs,
  })

  if (!run.summary) {
    console.error('ERROR: No summary produced')
    process.exit(1)
  }

  const { summary } = run

  console.log(`Total: ${summary.total}`)
  console.log(`Passed: ${summary.passed}`)
  console.log(`Failed: ${summary.failed}`)
  console.log(`Errors: ${summary.errors}`)
  console.log(`Pass rate: ${(summary.passRate * 100).toFixed(0)}%`)

  if (mode === 'real') {
    console.log(`Tokens used: ${summary.totalTokensUsed}`)
    if (summary.estimatedCostUsd !== null) {
      console.log(`Estimated cost: $${summary.estimatedCostUsd.toFixed(6)} USD (approximate)`)
    } else {
      console.log('Estimated cost: N/A (unknown model pricing)')
    }
  }

  console.log()

  for (const result of run.results) {
    const icon = result.passed ? '✅' : '❌'
    console.log(`  ${icon} ${result.scenarioId} — ${result.durationMs}ms`)
    if (!result.passed) {
      if (result.error) console.log(`     Error: ${result.error}`)
      if (result.llmDiagnosis) {
        console.log(`     LLM: ${result.llmDiagnosis}`)
        const hint = LLM_DIAGNOSIS_HINTS[result.llmDiagnosis.split('::')[1] ?? '']
        if (hint) console.log(`     Hint: ${hint}`)
      }
      for (const check of result.deterministicChecks.filter((c) => !c.passed)) {
        console.log(`     Failed: ${check.assertion} (actual: ${check.actual})`)
      }
      for (const violation of result.securityCheck.violations) {
        console.log(`     Security: ${violation}`)
      }
    }
  }

  if (summary.errors > 0 || summary.failed > 0) {
    console.log()
    console.error('SMOKE TEST FAILED')
    process.exit(1)
  }

  console.log()
  console.log('SMOKE TEST PASSED')
  process.exit(0)
}

main().catch((err: unknown) => {
  console.error('SMOKE TEST CRASHED:', err)
  process.exit(1)
})
