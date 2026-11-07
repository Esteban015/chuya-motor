/**
 * Gemini Model Availability Diagnostic
 *
 * Lists models accessible for the configured GEMINI_API_KEY and filters
 * those that support generateContent (i.e., text generation).
 *
 * Purpose: Identify which models are actually available for a given API key
 * before attempting a real smoke run. Use this when smoke fails with
 * LLM_MODEL_UNAVAILABLE to find a valid model identifier.
 *
 * Usage (Git Bash from project root):
 *   GEMINI_API_KEY=<your-key> npx tsx benchmark/smoke/gemini-list-models.ts
 *
 *   Or, if GEMINI_API_KEY is already in .env.local:
 *   npx tsx benchmark/smoke/gemini-list-models.ts
 *
 * What this script does NOT do:
 *   - Does NOT call generateContent (no generation, no billing risk).
 *   - Does NOT print the API key or any credentials.
 *   - Does NOT modify any configuration files.
 *
 * Note on free-tier availability:
 *   A model appearing in this list means your API key can access its metadata.
 *   It does NOT guarantee free-tier billing. Confirm free-tier status at:
 *   https://ai.google.dev/gemini-api/docs/rate-limits
 */

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { GoogleGenAI, ApiError } from '@google/genai'
import type { Model } from '@google/genai'
import { classifyApiError, getShortModelId, supportsGenerateContent } from './gemini-list-models-utils'

// --- .env.local loader -------------------------------------------------------
// Same logic as smoke.ts: session vars take precedence over .env.local.
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

// --- Free-tier allowlist (kept in sync with gemini-free-tier.ts manually
//     to avoid importing production modules with side effects) ----------------
const CHUYA_FREE_TIER_ALLOWLIST = new Set([
  'gemini-3.5-flash-lite', // primary — HTTP 200 on generateContent for new AI Studio projects
  'gemini-2.5-flash',      // secondary — may work for established projects
])

// --- Main --------------------------------------------------------------------
async function main(): Promise<void> {
  console.log('=== Chuya Motor — Gemini Model Availability Diagnostic ===')
  console.log('No generateContent calls will be made. No billing risk.')
  console.log()

  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    console.error('ERROR: GEMINI_API_KEY is not set.')
    console.error('Pass it as a session variable or add it to .env.local:')
    console.error('  GEMINI_API_KEY=<your-ai-studio-key> npx tsx benchmark/smoke/gemini-list-models.ts')
    process.exit(1)
  }

  // Redact key in display: show only last 4 chars.
  const keyDisplay = `...${apiKey.slice(-4)}`
  console.log(`API key loaded (last 4 chars): ${keyDisplay}`)
  console.log()

  const ai = new GoogleGenAI({ apiKey })

  let allModels: Model[] = []

  try {
    console.log('Fetching model list from Gemini API...')
    const pager = await ai.models.list()
    for await (const model of pager) {
      allModels.push(model)
    }
  } catch (err) {
    if (err instanceof ApiError) {
      const { code, httpStatus, explanation } = classifyApiError(err)
      console.error(`\nDIAGNOSTIC FAILED`)
      console.error(`  Error code : ${code}`)
      console.error(`  HTTP status: ${httpStatus}`)
      console.error(`  Explanation: ${explanation}`)
      console.error()
      console.error('Troubleshooting:')
      console.error('  1. Verify GEMINI_API_KEY in .env.local is current.')
      console.error('  2. Confirm the key was created at https://aistudio.google.com/')
      console.error('  3. Ensure the Gemini API is enabled for your project.')
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\nDIAGNOSTIC FAILED — unexpected error: ${msg}`)
    }
    process.exit(1)
  }

  console.log(`Total models returned by API: ${allModels.length}`)
  console.log()

  // Filter to models that support generateContent.
  // The SDK uses `supportedActions` (not `supportedGenerationMethods` from the old REST v1 API).
  const generativeModels = allModels.filter((m) => supportsGenerateContent(m.supportedActions))

  if (generativeModels.length === 0) {
    console.log('No models with generateContent support found for this API key.')
    console.log('This may indicate the key lacks permissions or the project is restricted.')
    process.exit(0)
  }

  console.log(`Models supporting generateContent: ${generativeModels.length}`)
  console.log()

  // Sort: free-tier allowlisted first, then alphabetically.
  generativeModels.sort((a, b) => {
    const aId = getShortModelId(a.name)
    const bId = getShortModelId(b.name)
    const aAllowlisted = CHUYA_FREE_TIER_ALLOWLIST.has(aId) ? 0 : 1
    const bAllowlisted = CHUYA_FREE_TIER_ALLOWLIST.has(bId) ? 0 : 1
    if (aAllowlisted !== bAllowlisted) return aAllowlisted - bAllowlisted
    return aId.localeCompare(bId)
  })

  // Print table.
  console.log('--- Generative Models ---')
  console.log(
    `${'Model identifier'.padEnd(45)}  ${'Display name'.padEnd(35)}  ${'In free-tier allowlist'.padEnd(22)}  Supported actions`,
  )
  console.log('-'.repeat(140))

  for (const model of generativeModels) {
    const id = getShortModelId(model.name)
    const displayName = model.displayName ?? '(none)'
    const inAllowlist = CHUYA_FREE_TIER_ALLOWLIST.has(id) ? 'YES ✓' : 'no'
    const actions = (model.supportedActions ?? []).join(', ')
    console.log(`${id.padEnd(45)}  ${displayName.padEnd(35)}  ${inAllowlist.padEnd(22)}  ${actions}`)
  }

  console.log()

  // Summary: allowlisted models that are also accessible with this key.
  const accessibleAllowlisted = generativeModels.filter((m) =>
    CHUYA_FREE_TIER_ALLOWLIST.has(getShortModelId(m.name)),
  )

  if (accessibleAllowlisted.length > 0) {
    console.log('--- Free-tier allowlist models accessible with this key ---')
    for (const m of accessibleAllowlisted) {
      console.log(`  ${getShortModelId(m.name)}`)
    }
    console.log()
    console.log(
      `Recommended: set GEMINI_MODEL=${getShortModelId(accessibleAllowlisted[0]!.name)} in .env.local`,
    )
  } else {
    console.log('--- WARNING ---')
    console.log('None of the Chuya Motor free-tier allowlist models are accessible.')
    console.log('Allowlist:', [...CHUYA_FREE_TIER_ALLOWLIST].join(', '))
    console.log()
    console.log('Options:')
    console.log('  A) Try a different AI Studio key.')
    console.log('  B) Update GEMINI_FREE_TIER_MODELS in src/agents/llm/gemini-free-tier.ts')
    console.log('     to include one of the accessible models above, then re-run tests.')
    console.log()
    console.log('Accessible generative models (first 5):')
    for (const m of generativeModels.slice(0, 5)) {
      console.log(`  ${getShortModelId(m.name)}  (${m.displayName ?? 'no display name'})`)
    }
  }

  console.log()
  console.log('Note: accessibility != free tier. Confirm billing at:')
  console.log('  https://ai.google.dev/gemini-api/docs/rate-limits')
}

main().catch((err: unknown) => {
  console.error('DIAGNOSTIC CRASHED:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
