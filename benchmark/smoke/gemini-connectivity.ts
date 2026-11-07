/**
 * Gemini Connectivity Test
 *
 * Verifies that the configured GEMINI_API_KEY and GEMINI_MODEL can reach the
 * Gemini API and receive a valid response.
 *
 * Makes exactly ONE generateContent call with synthetic content ("OK").
 * Maximum output: 32 tokens. No retries. No benchmark scenarios executed.
 *
 * Usage — pre-flight check only (no real call, always safe):
 *   npx tsx benchmark/smoke/gemini-connectivity.ts
 *
 * Usage — authorize the real generateContent call (Git Bash):
 *   GEMINI_CONNECTIVITY_AUTHORIZED=true npx tsx benchmark/smoke/gemini-connectivity.ts
 *
 * Requirements for the real call:
 *   GEMINI_API_KEY=<your-ai-studio-key>  in .env.local
 *   GEMINI_MODEL=gemini-3.5-flash-lite   in .env.local (or unset → uses default)
 *   GEMINI_CONNECTIVITY_AUTHORIZED=true  as a session variable (not from .env.local)
 *
 * Guards:
 *   - Blocked in CI environments.
 *   - Model must be in the free-tier allowlist.
 *   - At most 1 generateContent call per process (freeTier.maxRequestsPerRun = 1).
 *   - API key is never printed.
 */

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { GeminiAdapter, GEMINI_DEFAULT_MODEL } from '../../src/agents/llm/gemini-adapter'
import {
  assertModelInFreeTierAllowlist,
  DEFAULT_FREE_TIER_LIMITS,
} from '../../src/agents/llm/gemini-free-tier'
import {
  isAuthorized,
  redactApiKey,
  CONNECTIVITY_REQUEST,
  formatConnectivityResult,
} from './gemini-connectivity-utils'

// --- .env.local loader (same logic as smoke.ts) --------------------------------
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

// --- Main --------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('=== Chuya Motor — Gemini Connectivity Test ===')
  console.log()

  // CI guard: real calls must never happen in automated pipelines.
  if (process.env['CI']) {
    console.error('ERROR: Real LLM calls are blocked in CI environments.')
    console.error('Run this script locally only.')
    process.exit(1)
  }

  const apiKey = process.env['GEMINI_API_KEY'] ?? ''
  const model = process.env['GEMINI_MODEL'] ?? GEMINI_DEFAULT_MODEL

  console.log(`API key    : ${redactApiKey(apiKey)}`)
  console.log(`Model      : ${model}`)
  console.log()

  // Allowlist check — fast, no network.
  try {
    assertModelInFreeTierAllowlist(model)
    console.log(`Allowlist  : PASS (${model} is in the free-tier allowlist)`)
  } catch (err) {
    console.error(`Allowlist  : FAIL`)
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // API key check.
  if (!apiKey) {
    console.error()
    console.error('ERROR: GEMINI_API_KEY is not set.')
    console.error('Add it to .env.local:')
    console.error('  GEMINI_API_KEY=AIza...')
    process.exit(1)
  }

  // Authorization check — if not authorized, print instructions and exit cleanly.
  if (!isAuthorized(process.env)) {
    console.log()
    console.log('Pre-flight checks passed. Real call NOT executed.')
    console.log('To run the connectivity test, authorize it explicitly:')
    console.log()
    console.log(
      '  GEMINI_CONNECTIVITY_AUTHORIZED=true npx tsx benchmark/smoke/gemini-connectivity.ts',
    )
    console.log()
    console.log('Constraints:')
    console.log('  - Exactly 1 generateContent call')
    console.log(`  - Max output: ${CONNECTIVITY_REQUEST.maxTokens} tokens`)
    console.log('  - No retries')
    process.exit(0)
  }

  // --- Real call ---
  console.log()
  console.log('Authorization : GRANTED (GEMINI_CONNECTIVITY_AUTHORIZED=true)')
  console.log('Request       : synthetic prompt — "Responde únicamente con la palabra OK."')
  console.log('Calling generateContent...')

  // freeTier.maxRequestsPerRun = 1 ensures the adapter hard-blocks any second call locally.
  const adapter = new GeminiAdapter(apiKey, model, {
    freeTier: { ...DEFAULT_FREE_TIER_LIMITS, maxRequestsPerRun: 1 },
  })

  const start = Date.now()
  const result = await adapter.complete(CONNECTIVITY_REQUEST)
  const latencyMs = Date.now() - start

  console.log()
  console.log('--- Result ---')
  for (const line of formatConnectivityResult({ model, latencyMs, result })) {
    console.log(line)
  }

  if (!result.ok) {
    console.log()
    console.log('Connectivity test FAILED.')
    console.log('Check GEMINI_API_KEY validity and confirm model availability at:')
    console.log('  https://ai.google.dev/gemini-api/docs/rate-limits')
    process.exit(1)
  }

  console.log()
  console.log('Connectivity test PASSED.')
}

main().catch((err: unknown) => {
  console.error('CONNECTIVITY TEST CRASHED:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
