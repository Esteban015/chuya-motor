/**
 * Upstash integration check — Incremento 6.4E, Fase 1 (opt-in, real Redis).
 *
 * Runs upstash-checks.ts against the REAL Upstash database configured in .env.local
 * (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). The LLM provider is a local fake:
 * NO Groq / Gemini call is ever made.
 *
 * Pre-flight only (no network, always safe):
 *   npm run verify:upstash
 *
 * Real run (Git Bash) — the authorization flag must be a SESSION variable; a value in .env.local
 * is deliberately ignored:
 *   UPSTASH_INTEGRATION_AUTHORIZED=true npm run verify:upstash
 *
 * Safety: unique per-run prefix (it6e-<random>) + TTL on every key; cleanup deletes only that
 * prefix. ≈ 300 Redis commands. Blocked in CI. URL and token are never printed.
 */
import { randomBytes } from 'crypto'
import { runUpstashChecks } from './upstash-checks'
import { loadEnvLocal } from './load-env-local'

export const UPSTASH_AUTH_FLAG = 'UPSTASH_INTEGRATION_AUTHORIZED'

// Captured BEFORE reading .env.local: the authorization can only come from the session.
const authorized = process.env[UPSTASH_AUTH_FLAG] === 'true'
loadEnvLocal()

async function main(): Promise<void> {
  console.log('=== Chuya Motor — Upstash integration check (Incremento 6.4E) ===\n')
  const url = process.env['UPSTASH_REDIS_REST_URL'] || process.env['KV_REST_API_URL'] || ''
  const token = process.env['UPSTASH_REDIS_REST_TOKEN'] || process.env['KV_REST_API_TOKEN'] || ''
  console.log(`Upstash URL   : ${url ? `configured (https: ${/^https:\/\//.test(url)})` : 'MISSING'}`)
  console.log(`Upstash token : ${token ? 'configured' : 'MISSING'}`)

  if (process.env['CI']) {
    console.log('\nNot executed: blocked in CI.')
    process.exit(1)
  }
  if (!url || !token) {
    console.log('\nNot executed: Upstash credentials missing.')
    process.exit(1)
  }
  if (!authorized) {
    console.log('\nReal Redis run NOT executed (pre-flight only). To run it (≈300 commands, unique prefix + TTL):')
    console.log(`  ${UPSTASH_AUTH_FLAG}=true npm run verify:upstash`)
    process.exit(0)
  }

  const prefix = `it6e-${randomBytes(4).toString('hex')}`
  console.log(`\nAuthorization : GRANTED (${UPSTASH_AUTH_FLAG}=true, session)`)
  console.log(`Key prefix    : ${prefix} (only these keys are touched)\n`)

  let report
  try {
    report = await runUpstashChecks({ url, token, prefix, log: (l) => console.log(l) })
  } catch {
    console.log('\nCleanup or run aborted; remaining test keys expire by TTL (≤ 48 h).')
    process.exit(1)
  }
  console.log(`\nCleanup: ${report.deletedKeys} test keys deleted (prefix ${prefix} only).`)
  console.log(`Result: ${report.passed}/${report.results.length} checks passed. LLM provider calls: ${report.providerCalls}.`)
  process.exit(report.failed ? 1 : 0)
}

main().catch(() => {
  console.error('Unexpected error (details omitted to avoid leaking configuration).')
  process.exit(1)
})
