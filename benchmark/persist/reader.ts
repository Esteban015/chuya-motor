import { readFileSync, existsSync } from 'fs'
import { PersistedCampaignSchema } from './types'
import type { PersistedCampaign } from './types'

export class CampaignLoadError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'PARSE_ERROR' | 'SCHEMA_ERROR',
    message: string,
  ) {
    super(message)
    this.name = 'CampaignLoadError'
  }
}

export class CampaignCompatibilityError extends Error {
  constructor(
    public readonly field: 'model' | 'provider' | 'datasetVersion',
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(
      `Campaign resume mismatch on ${field}: expected "${expected}", found "${actual}". ` +
      `Use --allow-mismatch to override (may produce invalid comparisons).`,
    )
    this.name = 'CampaignCompatibilityError'
  }
}

/**
 * Parses and validates a campaign file.
 * Throws CampaignLoadError if the file is missing, unparseable, or fails schema validation.
 */
export function loadCampaign(filePath: string): PersistedCampaign {
  if (!existsSync(filePath)) {
    throw new CampaignLoadError('NOT_FOUND', `Campaign file not found: ${filePath}`)
  }

  let raw: string
  try {
    raw = readFileSync(filePath, { encoding: 'utf8' })
  } catch (err) {
    throw new CampaignLoadError('PARSE_ERROR', `Could not read campaign file: ${filePath}. ${err}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CampaignLoadError('PARSE_ERROR', `Campaign file is not valid JSON: ${filePath}`)
  }

  const result = PersistedCampaignSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new CampaignLoadError('SCHEMA_ERROR', `Campaign file failed schema validation: ${issues}`)
  }

  return result.data
}

/**
 * Like loadCampaign, but skips schema validation.
 * Used internally by writer.ts for incremental updates where we trust our own writes.
 * Not exported as a public API — use loadCampaign() from outside this module.
 */
export function loadCampaignUnsafe(filePath: string): PersistedCampaign {
  if (!existsSync(filePath)) {
    throw new CampaignLoadError('NOT_FOUND', `Campaign file not found: ${filePath}`)
  }
  const raw = readFileSync(filePath, { encoding: 'utf8' })
  return JSON.parse(raw) as PersistedCampaign
}

export interface ResumeState {
  /** Set of scenarioIds that are already completed (should be skipped in resume). */
  completedIds: Set<string>
  /** Number of real requests used so far in the campaign. */
  realRequestsUsed: number
  /** Whether the campaign was cleanly completed before — resuming a completed campaign is a no-op. */
  alreadyCompleted: boolean
}

/**
 * Loads a campaign file and returns a ResumeState for the campaign runner.
 * Performs model / provider / datasetVersion compatibility checks before resuming.
 * Throws CampaignCompatibilityError if any field mismatches (unless allowMismatch=true).
 */
export function getResumeState(
  filePath: string,
  model: string,
  provider: string,
  datasetVersion: string,
  options: { allowMismatch?: boolean } = {},
): ResumeState {
  const campaign = loadCampaign(filePath)

  if (campaign.status === 'completed') {
    return {
      completedIds: new Set(campaign.completed.map((r) => r.scenarioId)),
      realRequestsUsed: campaign.realRequestsUsed,
      alreadyCompleted: true,
    }
  }

  if (!options.allowMismatch) {
    if (campaign.model !== model) {
      throw new CampaignCompatibilityError('model', model, campaign.model)
    }
    if (campaign.provider !== provider) {
      throw new CampaignCompatibilityError('provider', provider, campaign.provider)
    }
    if (campaign.datasetVersion !== datasetVersion) {
      throw new CampaignCompatibilityError('datasetVersion', datasetVersion, campaign.datasetVersion)
    }
  }

  return {
    completedIds: new Set(campaign.completed.map((r) => r.scenarioId)),
    realRequestsUsed: campaign.realRequestsUsed,
    alreadyCompleted: false,
  }
}

/**
 * Returns the scenario IDs from the completed array of a persisted campaign,
 * formatted as BenchmarkResult stubs for use with filterCompleted().
 * This allows the campaign runner to skip already-processed scenarios without
 * loading the full BenchmarkResult objects.
 */
export function completedResultStubs(campaign: PersistedCampaign) {
  return campaign.completed.map((r) => ({
    scenarioId: r.scenarioId,
    outcome: r.outcome,
    passed: r.passed,
    // Minimal stubs — these fields are required by BenchmarkResult but unused during filtering
    category: 'general' as const,
    severity: 'medium' as const,
    mode: campaign.mode,
    durationMs: r.durationMs,
    output: null,
    error: null,
    llmDiagnosis: null,
    deterministicChecks: [],
    securityCheck: { passed: r.passed, violations: [] },
    tokensUsed: r.tokensUsed,
    requiresHumanReview: r.humanReviewRequired,
    realRequestsUsed: r.realRequestsUsed,
  }))
}
