/**
 * Groq Connectivity Test — Incremento 6.3, Fase 7 (opt-in).
 *
 * Makes exactly ONE chat completion with synthetic content ("OK"). No retries, no scenarios.
 *
 * Pre-flight only (no real call, always safe):
 *   npm run smoke:groq
 *
 * Real call (Git Bash) — the authorization flag must be a SESSION variable;
 * a value in .env.local is deliberately ignored:
 *   GROQ_REAL_LLM_AUTHORIZED=true npm run smoke:groq
 *
 * Requires GROQ_API_KEY in .env.local (server-side only). GROQ_MODEL optional.
 * Blocked in CI. The API key is never printed.
 */
import { GroqAdapter, GROQ_DEFAULT_MODEL, assertSupportedModel } from '../../src/agents/llm/groq-adapter'
import { redactApiKey, formatConnectivityResult } from './gemini-connectivity-utils'
import {
  checkGroqRealGuards,
  pinSessionAuthorization,
  redactSecretsForLog,
  GROQ_AUTH_FLAG,
  GROQ_CONNECTIVITY_REQUEST,
} from './groq-smoke-utils'
import { loadEnvLocal } from './load-env-local'

// Capture the authorization flag BEFORE reading .env.local so it can only come from the session.
pinSessionAuthorization(loadEnvLocal)

async function main(): Promise<void> {
  console.log('=== Chuya Motor — Groq Connectivity Test (Incremento 6.3) ===\n')

  const apiKey = process.env['GROQ_API_KEY'] ?? ''
  const model = process.env['GROQ_MODEL'] || GROQ_DEFAULT_MODEL
  console.log(`API key : ${redactApiKey(apiKey)}`)
  console.log(`Model   : ${model}`)

  try {
    assertSupportedModel(model)
  } catch (err) {
    console.error(`Model   : FAIL — ${(err as Error).message}`)
    process.exit(1)
  }

  const guard = checkGroqRealGuards(process.env)
  if (!guard.ok) {
    console.log(`\nReal call NOT executed: ${guard.message}`)
    if (guard.reason === 'NOT_AUTHORIZED') {
      console.log('\nTo run the connectivity test (1 request, no retries):')
      console.log(`  ${GROQ_AUTH_FLAG}=true npm run smoke:groq`)
      process.exit(0)
    }
    process.exit(1)
  }

  console.log(`\nAuthorization : GRANTED (${GROQ_AUTH_FLAG}=true, session)`)
  console.log('Request       : synthetic prompt — "Responde únicamente con la palabra OK."')

  const adapter = new GroqAdapter(apiKey, { model, maxRetries: 0, maxRequestsPerRun: 1 })
  const start = Date.now()
  const result = await adapter.complete(GROQ_CONNECTIVITY_REQUEST)
  const latencyMs = Date.now() - start

  console.log('\n--- Result ---')
  for (const line of formatConnectivityResult({ model, latencyMs, result })) console.log(line)
  if (adapter.lastRetryAfterMs !== null) console.log(`Retry-After : ${adapter.lastRetryAfterMs}ms`)

  if (!result.ok) {
    console.log('\nConnectivity test FAILED. Check GROQ_API_KEY and model access at https://console.groq.com')
    process.exit(1)
  }
  console.log('\nConnectivity test PASSED.')
}

main().catch((err: unknown) => {
  console.error('CONNECTIVITY TEST CRASHED:', redactSecretsForLog(err))
  process.exit(1)
})
