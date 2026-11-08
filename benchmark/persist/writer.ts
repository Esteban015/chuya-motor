import { writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import type { BenchmarkResult, CampaignResult } from '../runner/types'
import { PERSIST_SCHEMA_VERSION, MAX_RESULTS_FILE_BYTES } from './types'
import type { PersistedCampaign } from './types'
import { sanitizeForPersistence, deriveProvider } from './sanitizer'
import { loadCampaignUnsafe } from './reader'

/** Default results directory relative to CWD. */
export const DEFAULT_RESULTS_DIR = 'benchmark/results'

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Atomically writes content to filePath by writing to a .tmp file first
 * and then renaming. Prevents partially-written files on crash.
 * Throws if the serialized content exceeds MAX_RESULTS_FILE_BYTES.
 */
export function atomicWrite(filePath: string, content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_RESULTS_FILE_BYTES) {
    throw new Error(
      `Campaign result exceeds maximum allowed size (${MAX_RESULTS_FILE_BYTES} bytes). ` +
      `Reduce scenario count or check for runaway data.`,
    )
  }
  const tmpPath = filePath + '.tmp'
  ensureDir(filePath)
  writeFileSync(tmpPath, content, { encoding: 'utf8' })
  renameSync(tmpPath, filePath)
}

/** Builds the standard file path for a campaign in the results directory. */
export function campaignFilePath(campaignId: string, resultsDir: string = DEFAULT_RESULTS_DIR): string {
  return join(resultsDir, `${campaignId}.json`)
}

/**
 * Creates an initial "running" record before the campaign starts.
 * Allows detecting interrupted runs (completedAt remains null, status = 'running').
 */
export function initCampaignFile(
  params: {
    campaignId: string
    datasetVersion: string
    safetyPolicyVersion: string
    startedAt: string
    mode: PersistedCampaign['mode']
    provider: string
    model: string
    realRequestsLimit: number
    pendingIds: string[]
  },
  resultsDir: string = DEFAULT_RESULTS_DIR,
): string {
  const record: PersistedCampaign = {
    schemaVersion: PERSIST_SCHEMA_VERSION,
    campaignId: params.campaignId,
    datasetVersion: params.datasetVersion,
    safetyPolicyVersion: params.safetyPolicyVersion,
    startedAt: params.startedAt,
    completedAt: null,
    mode: params.mode,
    provider: params.provider,
    model: params.model,
    realRequestsUsed: 0,
    realRequestsLimit: params.realRequestsLimit,
    totalTokensUsed: 0,
    completed: [],
    skipped: [],
    pending: params.pendingIds,
    status: 'running',
  }
  const filePath = campaignFilePath(params.campaignId, resultsDir)
  atomicWrite(filePath, JSON.stringify(record, null, 2))
  return filePath
}

/**
 * Incrementally appends a completed scenario result to the in-progress record.
 * Reads the existing file, updates it, and re-writes atomically.
 * Does not throw on read failures — logs a warning and skips the update.
 */
export function appendScenarioResult(
  filePath: string,
  result: BenchmarkResult,
  pendingIds: string[],
): void {
  let record: PersistedCampaign
  try {
    record = loadCampaignUnsafe(filePath)
  } catch {
    // If we can't read the file, skip the incremental update — the final write will catch up.
    return
  }

  const persisted = sanitizeForPersistence(result)
  if (result.outcome === 'QUOTA_EXHAUSTED') {
    record.skipped = [...record.skipped, persisted]
  } else {
    record.completed = [...record.completed, persisted]
  }
  record.pending = pendingIds
  record.realRequestsUsed += persisted.realRequestsUsed
  record.totalTokensUsed += persisted.tokensUsed

  atomicWrite(filePath, JSON.stringify(record, null, 2))
}

/**
 * Finalizes the campaign file after all scenarios have completed.
 * Sets completedAt, status='completed', and writes the full result.
 */
export function finalizeCampaignFile(
  filePath: string,
  campaign: CampaignResult,
  safetyPolicyVersion: string,
): void {
  let record: PersistedCampaign
  try {
    record = loadCampaignUnsafe(filePath)
  } catch {
    // File may have been lost mid-run — rebuild from campaign result
    const provider = deriveProvider(campaign.model, campaign.mode as PersistedCampaign['mode'])
    record = {
      schemaVersion: PERSIST_SCHEMA_VERSION,
      campaignId: campaign.campaignId,
      datasetVersion: campaign.datasetVersion,
      safetyPolicyVersion,
      startedAt: campaign.startedAt,
      completedAt: null,
      mode: campaign.mode as PersistedCampaign['mode'],
      provider,
      model: campaign.model,
      realRequestsUsed: 0,
      realRequestsLimit: campaign.realRequestsLimit,
      totalTokensUsed: 0,
      completed: [],
      skipped: [],
      pending: campaign.pendingScenarios,
      status: 'running',
    }
  }

  record.completedAt = campaign.completedAt
  record.status = 'completed'
  record.completed = campaign.completed.map(sanitizeForPersistence)
  record.skipped = campaign.skipped.map(sanitizeForPersistence)
  record.pending = campaign.pendingScenarios
  record.realRequestsUsed = campaign.realRequestsUsed
  record.totalTokensUsed = campaign.completed.reduce((s, r) => s + r.tokensUsed, 0)

  atomicWrite(filePath, JSON.stringify(record, null, 2))
}

/**
 * Marks an in-progress campaign as 'interrupted' (e.g. on SIGINT).
 * Safe to call even if the file doesn't exist.
 */
export function markInterrupted(filePath: string): void {
  if (!existsSync(filePath)) return
  try {
    const record = loadCampaignUnsafe(filePath)
    record.status = 'interrupted'
    atomicWrite(filePath, JSON.stringify(record, null, 2))
  } catch {
    // Best-effort — don't throw during SIGINT handler
  }
}

/**
 * Validates that a path is within the authorized results directory.
 * Prevents path traversal attacks when accepting --save-report from CLI.
 */
export function validateResultsPath(inputPath: string, resultsDir: string = DEFAULT_RESULTS_DIR): string {
  const allowedDir = resolve(process.cwd(), resultsDir)
  const resolved = resolve(process.cwd(), inputPath)
  if (!resolved.startsWith(allowedDir + sep) && resolved !== allowedDir) {
    throw new Error(
      `Save path must be within the authorized results directory (${resultsDir}). ` +
      `Received: ${inputPath}`,
    )
  }
  return resolved
}

/** Cleans up a stale .tmp file left by a previous interrupted atomic write. */
export function cleanStaleTmp(filePath: string): void {
  const tmpPath = filePath + '.tmp'
  if (existsSync(tmpPath)) {
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}
