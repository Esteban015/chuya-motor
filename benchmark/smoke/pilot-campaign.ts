/**
 * Pilot Campaign — Fase 5D.2
 *
 * Runs 5 curated scenarios across all categories with the Gemini free-tier adapter.
 * Maximum 5 real LLM calls (SAF-001 and SYM-003 safety-blocked → 3 real calls expected).
 *
 * Usage — dry run (mock mode, no Gemini calls, always safe):
 *   npx tsx benchmark/smoke/pilot-campaign.ts
 *
 * Usage — real Gemini calls (Git Bash):
 *   CAMPAIGN_REAL_LLM_AUTHORIZED=true npx tsx benchmark/smoke/pilot-campaign.ts
 *
 * Optional flags:
 *   --save-report <path>   Save report JSON to benchmark/results/<path>
 *   --verbose              Show per-scenario extended metadata (no LLM content)
 *   --resume <path>        Resume from a persisted campaign file
 *
 * Requirements for the real run:
 *   GEMINI_API_KEY=<key>  in .env.local
 *   GEMINI_MODEL=gemini-3.5-flash-lite  in .env.local (or unset → default)
 *   CAMPAIGN_REAL_LLM_AUTHORIZED=true  as a session variable
 *
 * Guards:
 *   - Blocked in CI environments.
 *   - Max 5 real LLM calls across all scenarios.
 *   - RPM limit: 10 req/min (6 s min interval).
 *   - Quota exhaustion stops the campaign gracefully.
 *   - API key is never printed.
 *   - Mock is the default.
 *   - LLM-generated content is never printed automatically (use --verbose with explicit auth).
 *   - Persisted files never contain LLM-generated content, credentials, or personal data.
 */

import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { getAllScenarios } from '../../benchmark/dataset/scenarios'
import { runCampaign } from '../../benchmark/runner/campaign'
import { toCampaignMarkdown } from '../../benchmark/runner/report'
import { redactApiKey } from './gemini-connectivity-utils'
import {
  initCampaignFile,
  appendScenarioResult,
  finalizeCampaignFile,
  markInterrupted,
  validateResultsPath,
  completedResultStubs,
  getResumeState,
  loadCampaign,
  deriveProvider,
  DEFAULT_RESULTS_DIR,
} from '../persist'
import { SAFETY_POLICY_VERSION } from '../../src/domain/safety/blocklist'

// --- .env.local loader -------------------------------------------------------
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
    if (!(key in process.env)) process.env[key] = value
  }
}

// --- CLI arg parsing ---------------------------------------------------------
function parseArgs(): {
  saveReportPath: string | null
  verbose: boolean
  resumePath: string | null
} {
  const args = process.argv.slice(2)
  let saveReportPath: string | null = null
  let verbose = false
  let resumePath: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--save-report' && args[i + 1]) {
      saveReportPath = args[++i]!
    } else if (args[i] === '--verbose') {
      verbose = true
    } else if (args[i] === '--resume' && args[i + 1]) {
      resumePath = args[++i]!
    }
  }

  return { saveReportPath, verbose, resumePath }
}

// --- Console table output ----------------------------------------------------
function printResultsTable(campaign: { completed: ReturnType<typeof getAllScenarios>[0] extends never ? never : import('../runner/types').CampaignResult['completed']; skipped: import('../runner/types').CampaignResult['skipped'] }, verbose: boolean): void {
  const rows = [
    ...campaign.completed.map((r) => ({
      scenarioId: r.scenarioId,
      outcome: r.outcome ?? 'UNKNOWN',
      passed: r.passed ? '✅' : '❌',
      durationMs: r.durationMs,
      requests: r.realRequestsUsed ?? 0,
      tokens: r.tokensUsed,
      blocked: r.output?.safetyBlocked ? 'Y' : 'N',
      fallback: r.output?.fallback ? 'Y' : 'N',
      review: r.requiresHumanReview ? 'Y' : 'N',
      ...(verbose ? { error: r.error ? r.error.slice(0, 60) : '' } : {}),
    })),
    ...campaign.skipped.map((r) => ({
      scenarioId: r.scenarioId,
      outcome: 'QUOTA_EXHAUSTED',
      passed: '⏭',
      durationMs: 0,
      requests: 0,
      tokens: 0,
      blocked: '-',
      fallback: '-',
      review: '-',
      ...(verbose ? { error: '' } : {}),
    })),
  ]
  console.table(rows)
}

// --- Main --------------------------------------------------------------------
async function main(): Promise<void> {
  loadEnvLocal()

  const { saveReportPath, verbose, resumePath } = parseArgs()

  console.log('=== Chuya Motor — Pilot Campaign (Fase 5D.2) ===')
  console.log()

  // CI guard
  if (process.env['CI']) {
    console.error('ERROR: Real campaigns are blocked in CI environments.')
    process.exit(1)
  }

  const isAuthorized = process.env['CAMPAIGN_REAL_LLM_AUTHORIZED'] === 'true'
  const mode = isAuthorized ? 'real' : 'mock'

  if (!isAuthorized) {
    console.log('Running in MOCK mode (no real Gemini calls).')
    console.log('To run with real Gemini calls:')
    console.log()
    console.log('  CAMPAIGN_REAL_LLM_AUTHORIZED=true npx tsx benchmark/smoke/pilot-campaign.ts')
    console.log()
  } else {
    process.env['BENCHMARK_REAL_LLM_AUTHORIZED'] = 'true'

    const apiKey = process.env['GEMINI_API_KEY'] ?? ''
    const model = process.env['GEMINI_MODEL'] ?? 'gemini-3.5-flash-lite'
    console.log(`API key : ${redactApiKey(apiKey)}`)
    console.log(`Model   : ${model}`)
    console.log()

    if (!apiKey) {
      console.error('ERROR: GEMINI_API_KEY is not set in .env.local')
      process.exit(1)
    }
  }

  const PILOT_SCENARIO_IDS = ['SYM-001', 'SYM-003', 'BUD-001', 'SAF-001', 'AMB-001']
  const allScenarios = getAllScenarios()
  const datasetVersion = `v${allScenarios.length}`
  const model = isAuthorized ? (process.env['GEMINI_MODEL'] ?? 'gemini-3.5-flash-lite') : 'mock'
  const provider = deriveProvider(model, mode)

  // --- Resume logic ----------------------------------------------------------
  let resumeFrom: ReturnType<typeof completedResultStubs> | undefined
  if (resumePath) {
    console.log(`Resuming from: ${resumePath}`)
    const state = getResumeState(resumePath, model, provider, datasetVersion)
    if (state.alreadyCompleted) {
      console.log('Campaign already completed — nothing to resume.')
      const persisted = loadCampaign(resumePath)
      printResultsTable(
        { completed: completedResultStubs(persisted) as unknown as import('../runner/types').CampaignResult['completed'], skipped: [] },
        verbose,
      )
      return
    }
    const persisted = loadCampaign(resumePath)
    resumeFrom = completedResultStubs(persisted)
    console.log(`Resuming: ${state.completedIds.size} already completed.`)
    console.log()
  }

  // --- Validate --save-report path -------------------------------------------
  let resolvedSavePath: string | null = null
  if (saveReportPath) {
    try {
      resolvedSavePath = validateResultsPath(
        saveReportPath.includes('/') || saveReportPath.includes('\\')
          ? saveReportPath
          : `${DEFAULT_RESULTS_DIR}/${saveReportPath}`,
      )
    } catch (e) {
      console.error(`ERROR: ${(e as Error).message}`)
      process.exit(1)
    }
  }

  console.log(`Scenarios : ${PILOT_SCENARIO_IDS.join(', ')}`)
  console.log(`Mode      : ${mode}`)
  console.log(`Max calls : 5 real LLM calls (SAF-001 and SYM-003 safety-blocked → 3 real calls expected; AMB-001 NOT blocked in v1.3.0)`)
  console.log(`RPM limit : 10 req/min`)
  console.log()

  // --- Init persist file -----------------------------------------------------
  // We use a placeholder campaignId that will be overwritten after runCampaign gives us the real one.
  // The init here is best-effort — the final write (finalizeCampaignFile) is authoritative.
  let persistFilePath: string | null = null

  // --- SIGINT handler --------------------------------------------------------
  process.on('SIGINT', () => {
    if (persistFilePath) {
      markInterrupted(persistFilePath)
      console.log('\nCampaign interrupted — partial results saved to:')
      console.log(`  ${persistFilePath}`)
    }
    process.exit(130)
  })

  console.log('Starting campaign...')
  const startMs = Date.now()

  const campaign = await runCampaign(allScenarios, {
    mode,
    scenarioIds: PILOT_SCENARIO_IDS,
    maxRealRequestsPerCampaign: 5,
    rpmLimit: 10,
    timeoutMs: 30_000,
    resumeFrom: resumeFrom as unknown as import('../runner/types').BenchmarkResult[] | undefined,
    onScenarioComplete: async (result, remainingIds) => {
      // Init persist file on first callback (we now have the campaignId from result context)
      // Since we don't have campaignId before runCampaign returns, we init lazily on first callback.
      if (!persistFilePath) {
        // Use a deterministic placeholder for the incremental file — it will be renamed on finalize.
        // For simplicity, skip incremental writes until finalize which uses the real campaignId.
        // This is an intentional trade-off: the file is created atomically at the end.
        return
      }
      appendScenarioResult(persistFilePath, result, remainingIds)
    },
  })

  const elapsedMs = Date.now() - startMs

  // --- Persist final result --------------------------------------------------
  persistFilePath = initCampaignFile(
    {
      campaignId: campaign.campaignId,
      datasetVersion,
      safetyPolicyVersion: SAFETY_POLICY_VERSION,
      startedAt: campaign.startedAt,
      mode,
      provider,
      model,
      realRequestsLimit: campaign.realRequestsLimit,
      pendingIds: campaign.pendingScenarios,
    },
  )

  finalizeCampaignFile(persistFilePath, campaign, SAFETY_POLICY_VERSION)
  console.log()
  console.log(`Auto-persisted results → ${persistFilePath}`)

  // --- Save report (optional) ------------------------------------------------
  if (resolvedSavePath) {
    const { writeFileSync } = await import('fs')
    const reportContent = JSON.stringify(loadCampaign(persistFilePath), null, 2)
    writeFileSync(resolvedSavePath, reportContent, 'utf8')
    console.log(`Report saved → ${resolvedSavePath}`)
  }

  // --- Console output --------------------------------------------------------
  console.log()
  console.log(`Campaign completed in ${elapsedMs}ms`)
  console.log()
  console.log('--- Summary ---')
  console.log(`Executed   : ${campaign.completed.length}`)
  console.log(`Skipped    : ${campaign.skipped.length}`)
  console.log(`Pending    : ${campaign.pendingScenarios.length}`)
  console.log(`Real calls : ${campaign.realRequestsUsed} / ${campaign.realRequestsLimit || '∞'}`)
  console.log(`RPM delay  : ${campaign.totalDelayAppliedMs}ms`)
  console.log()

  printResultsTable(campaign, verbose)

  if (verbose) {
    console.log()
    console.log('NOTE: Use BENCHMARK_CONTENT_REVIEW_AUTHORIZED=true to view LLM-generated content (not shown here).')
  }

  console.log()
  console.log('--- Markdown Report ---')
  console.log(toCampaignMarkdown(campaign))
}

main().catch((err: unknown) => {
  console.error('PILOT CAMPAIGN CRASHED:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
