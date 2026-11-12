/**
 * FASE 5D.2 — Persist module TDD tests.
 * All tests are deterministic — no real LLM calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  atomicWrite,
  initCampaignFile,
  finalizeCampaignFile,
  markInterrupted,
  validateResultsPath,
  cleanStaleTmp,
  DEFAULT_RESULTS_DIR,
} from '../persist/writer'
import {
  loadCampaign,
  getResumeState,
  completedResultStubs,
  CampaignLoadError,
  CampaignCompatibilityError,
} from '../persist/reader'
import { sanitizeForPersistence, deriveProvider } from '../persist/sanitizer'
import { PERSIST_SCHEMA_VERSION, MAX_RESULTS_FILE_BYTES } from '../persist/types'
import type { PersistedCampaign } from '../persist/types'
import type { BenchmarkResult, CampaignResult } from '../runner/types'

// ── Test helpers ─────────────────────────────────────────────────────────────

const TEST_DIR = join('benchmark', 'results', '__test__')

function makeTmpDir(): string {
  const dir = join(TEST_DIR, randomUUID())
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanupTestDir(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true })
  }
}

function minimalBenchmarkResult(override: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    scenarioId: 'SYM-001',
    category: 'symptom',
    severity: 'low',
    mode: 'mock',
    passed: true,
    durationMs: 42,
    output: {
      caseId: '00000000-0000-0000-0000-000000000001',
      route: 'symptom',
      safetyBlocked: false,
      safetyDerivationMessage: null,
      policyVersion: '1.3.0',
      coverageDisclaimer: 'mock',
      fallback: false,
      fallbackText: null,
      facts: [],
      hypotheses: [],
      questions: [],
      warnings: [],
      budget: null,
      missingInformation: [],
      traces: [],
    },
    error: null,
    llmDiagnosis: null,
    deterministicChecks: [],
    securityCheck: { passed: true, violations: [] },
    tokensUsed: 100,
    requiresHumanReview: false,
    outcome: 'PASSED',
    realRequestsUsed: 0,
    ...override,
  }
}

function minimalCampaign(override: Partial<PersistedCampaign> = {}): PersistedCampaign {
  return {
    schemaVersion: PERSIST_SCHEMA_VERSION,
    campaignId: randomUUID(),
    datasetVersion: 'v5',
    safetyPolicyVersion: '1.3.0',
    startedAt: new Date().toISOString(),
    completedAt: null,
    mode: 'mock',
    provider: 'mock',
    model: 'mock',
    realRequestsUsed: 0,
    realRequestsLimit: 0,
    totalTokensUsed: 0,
    completed: [],
    skipped: [],
    pending: ['SYM-001'],
    status: 'running',
    ...override,
  }
}

function minimalCampaignResult(completed: BenchmarkResult[] = []): CampaignResult {
  return {
    campaignId: randomUUID(),
    datasetVersion: 'v5',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    mode: 'mock',
    model: 'mock',
    realRequestsUsed: 0,
    realRequestsLimit: 0,
    totalDelayAppliedMs: 0,
    completed,
    skipped: [],
    pendingScenarios: [],
    batchSummaries: [],
  }
}

// ── PERSIST-01: atomicWrite creates file atomically ───────────────────────────

describe('PERSIST-01: atomicWrite', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(cleanupTestDir)

  it('PERSIST-01-A: writes content to target file', () => {
    const filePath = join(tmpDir, 'test.json')
    atomicWrite(filePath, '{"ok":true}')
    expect(existsSync(filePath)).toBe(true)
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ ok: true })
  })

  it('PERSIST-01-B: does not leave .tmp file on success', () => {
    const filePath = join(tmpDir, 'test.json')
    atomicWrite(filePath, '{}')
    expect(existsSync(filePath + '.tmp')).toBe(false)
  })

  it('PERSIST-01-C: throws if content exceeds MAX_RESULTS_FILE_BYTES', () => {
    const filePath = join(tmpDir, 'big.json')
    const big = 'x'.repeat(MAX_RESULTS_FILE_BYTES + 1)
    expect(() => atomicWrite(filePath, big)).toThrow('maximum allowed size')
  })

  it('PERSIST-01-D: creates parent directory if it does not exist', () => {
    const filePath = join(tmpDir, 'nested', 'deep', 'file.json')
    atomicWrite(filePath, '{}')
    expect(existsSync(filePath)).toBe(true)
  })
})

// ── PERSIST-02: initCampaignFile ─────────────────────────────────────────────

describe('PERSIST-02: initCampaignFile', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(cleanupTestDir)

  it('PERSIST-02-A: creates a "running" record with correct structure', () => {
    const campaignId = randomUUID()
    const filePath = initCampaignFile(
      {
        campaignId,
        datasetVersion: 'v5',
        safetyPolicyVersion: '1.3.0',
        startedAt: '2026-01-01T00:00:00.000Z',
        mode: 'mock',
        provider: 'mock',
        model: 'mock',
        realRequestsLimit: 0,
        pendingIds: ['SYM-001', 'SAF-001'],
      },
      tmpDir,
    )
    expect(existsSync(filePath)).toBe(true)
    const record = loadCampaign(filePath)
    expect(record.status).toBe('running')
    expect(record.completedAt).toBeNull()
    expect(record.pending).toEqual(['SYM-001', 'SAF-001'])
    expect(record.schemaVersion).toBe(PERSIST_SCHEMA_VERSION)
  })

  it('PERSIST-02-B: file path follows campaignId naming convention', () => {
    const campaignId = randomUUID()
    const filePath = initCampaignFile(
      {
        campaignId,
        datasetVersion: 'v5',
        safetyPolicyVersion: '1.3.0',
        startedAt: '2026-01-01T00:00:00.000Z',
        mode: 'mock',
        provider: 'mock',
        model: 'mock',
        realRequestsLimit: 0,
        pendingIds: [],
      },
      tmpDir,
    )
    expect(filePath).toBe(join(tmpDir, `${campaignId}.json`))
  })
})

// ── PERSIST-03: finalizeCampaignFile ─────────────────────────────────────────

describe('PERSIST-03: finalizeCampaignFile', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(cleanupTestDir)

  it('PERSIST-03-A: sets status=completed and completedAt after full run', () => {
    const campaignResult = minimalCampaignResult([minimalBenchmarkResult()])
    const campaignId = campaignResult.campaignId

    // First initialize
    const filePath = initCampaignFile(
      {
        campaignId,
        datasetVersion: 'v5',
        safetyPolicyVersion: '1.3.0',
        startedAt: campaignResult.startedAt,
        mode: 'mock',
        provider: 'mock',
        model: 'mock',
        realRequestsLimit: 0,
        pendingIds: ['SYM-001'],
      },
      tmpDir,
    )

    finalizeCampaignFile(filePath, campaignResult, '1.3.0')

    const record = loadCampaign(filePath)
    expect(record.status).toBe('completed')
    expect(record.completedAt).not.toBeNull()
    expect(record.completed).toHaveLength(1)
    expect(record.completed[0]!.scenarioId).toBe('SYM-001')
  })

  it('PERSIST-03-B: persisted result does not contain LLM-generated content', () => {
    const result = minimalBenchmarkResult()
    const campaignResult = minimalCampaignResult([result])
    const campaignId = campaignResult.campaignId

    const filePath = initCampaignFile(
      {
        campaignId,
        datasetVersion: 'v5',
        safetyPolicyVersion: '1.3.0',
        startedAt: campaignResult.startedAt,
        mode: 'mock',
        provider: 'mock',
        model: 'mock',
        realRequestsLimit: 0,
        pendingIds: [],
      },
      tmpDir,
    )

    finalizeCampaignFile(filePath, campaignResult, '1.3.0')

    const record = loadCampaign(filePath)
    const persisted = record.completed[0]!
    // Must not contain LLM content fields
    expect('facts' in persisted).toBe(false)
    expect('hypotheses' in persisted).toBe(false)
    expect('questions' in persisted).toBe(false)
    expect('warnings' in persisted).toBe(false)
    // Must contain allowlist fields
    expect(persisted.scenarioId).toBe('SYM-001')
    expect(persisted.passed).toBe(true)
    expect(typeof persisted.durationMs).toBe('number')
  })
})

// ── PERSIST-04: markInterrupted ───────────────────────────────────────────────

describe('PERSIST-04: markInterrupted', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(cleanupTestDir)

  it('PERSIST-04-A: marks a running campaign as interrupted', () => {
    const campaignId = randomUUID()
    const filePath = initCampaignFile(
      {
        campaignId,
        datasetVersion: 'v5',
        safetyPolicyVersion: '1.3.0',
        startedAt: new Date().toISOString(),
        mode: 'mock',
        provider: 'mock',
        model: 'mock',
        realRequestsLimit: 0,
        pendingIds: ['SYM-001'],
      },
      tmpDir,
    )

    markInterrupted(filePath)

    const record = loadCampaign(filePath)
    expect(record.status).toBe('interrupted')
  })

  it('PERSIST-04-B: does not throw if file does not exist', () => {
    expect(() => markInterrupted(join(tmpDir, 'nonexistent.json'))).not.toThrow()
  })
})

// ── PERSIST-05: loadCampaign schema validation ────────────────────────────────

describe('PERSIST-05: loadCampaign schema validation', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(cleanupTestDir)

  it('PERSIST-05-A: throws NOT_FOUND for missing file', () => {
    expect(() => loadCampaign(join(tmpDir, 'missing.json'))).toThrow(CampaignLoadError)
    try {
      loadCampaign(join(tmpDir, 'missing.json'))
    } catch (e) {
      expect((e as CampaignLoadError).code).toBe('NOT_FOUND')
    }
  })

  it('PERSIST-05-B: throws PARSE_ERROR for invalid JSON', () => {
    const filePath = join(tmpDir, 'bad.json')
    writeFileSync(filePath, 'not json', 'utf8')
    try {
      loadCampaign(filePath)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as CampaignLoadError).code).toBe('PARSE_ERROR')
    }
  })

  it('PERSIST-05-C: throws SCHEMA_ERROR for wrong schemaVersion', () => {
    const filePath = join(tmpDir, 'wrong-version.json')
    const badRecord = { ...minimalCampaign(), schemaVersion: '9.9.9' }
    writeFileSync(filePath, JSON.stringify(badRecord), 'utf8')
    try {
      loadCampaign(filePath)
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as CampaignLoadError).code).toBe('SCHEMA_ERROR')
    }
  })

  it('PERSIST-05-D: successfully parses a valid campaign file', () => {
    const campaignId = randomUUID()
    const record = minimalCampaign({ campaignId, status: 'completed', completedAt: new Date().toISOString() })
    const filePath = join(tmpDir, `${campaignId}.json`)
    writeFileSync(filePath, JSON.stringify(record), 'utf8')
    const loaded = loadCampaign(filePath)
    expect(loaded.campaignId).toBe(campaignId)
    expect(loaded.status).toBe('completed')
  })
})

// ── PERSIST-06: getResumeState compatibility checks ──────────────────────────

describe('PERSIST-06: getResumeState compatibility checks', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(cleanupTestDir)

  function writeRecord(record: PersistedCampaign): string {
    const filePath = join(tmpDir, `${record.campaignId}.json`)
    writeFileSync(filePath, JSON.stringify(record), 'utf8')
    return filePath
  }

  it('PERSIST-06-A: returns completedIds from completed array', () => {
    const record = minimalCampaign({
      status: 'interrupted',
      model: 'mock',
      provider: 'mock',
      datasetVersion: 'v5',
      completed: [
        {
          scenarioId: 'SYM-001',
          caseId: null,
          outcome: 'PASSED',
          passed: true,
          durationMs: 10,
          realRequestsUsed: 0,
          tokensUsed: 50,
          safetyBlocked: false,
          fallback: false,
          humanReviewRequired: false,
          reasonCode: null,
        },
      ],
    })
    const filePath = writeRecord(record)
    const state = getResumeState(filePath, 'mock', 'mock', 'v5')
    expect(state.completedIds).toContain('SYM-001')
    expect(state.alreadyCompleted).toBe(false)
  })

  it('PERSIST-06-B: throws CampaignCompatibilityError on model mismatch', () => {
    const record = minimalCampaign({ model: 'gemini-3.5-flash-lite', provider: 'google', datasetVersion: 'v5' })
    const filePath = writeRecord(record)
    expect(() => getResumeState(filePath, 'mock', 'mock', 'v5')).toThrow(CampaignCompatibilityError)
  })

  it('PERSIST-06-C: allowMismatch bypasses compatibility check', () => {
    const record = minimalCampaign({ model: 'gemini-3.5-flash-lite', provider: 'google', datasetVersion: 'v5' })
    const filePath = writeRecord(record)
    const state = getResumeState(filePath, 'mock', 'mock', 'v5', { allowMismatch: true })
    expect(state.completedIds).toBeDefined()
  })

  it('PERSIST-06-D: alreadyCompleted=true for status=completed campaign', () => {
    const record = minimalCampaign({
      status: 'completed',
      completedAt: new Date().toISOString(),
      model: 'mock',
      provider: 'mock',
      datasetVersion: 'v5',
    })
    const filePath = writeRecord(record)
    const state = getResumeState(filePath, 'mock', 'mock', 'v5')
    expect(state.alreadyCompleted).toBe(true)
  })
})

// ── PERSIST-07: sanitizeForPersistence allowlist ──────────────────────────────

describe('PERSIST-07: sanitizeForPersistence', () => {
  it('PERSIST-07-A: strips LLM-generated content fields', () => {
    const result = minimalBenchmarkResult()
    const persisted = sanitizeForPersistence(result)
    expect('facts' in persisted).toBe(false)
    expect('hypotheses' in persisted).toBe(false)
    expect('questions' in persisted).toBe(false)
    expect('warnings' in persisted).toBe(false)
    expect('error' in persisted).toBe(false)
  })

  it('PERSIST-07-B: extracts KNOWN reasonCode from error string', () => {
    const result = minimalBenchmarkResult({ error: 'quota exceeded: QUOTA_EXHAUSTED', outcome: 'QUOTA_EXHAUSTED' })
    const persisted = sanitizeForPersistence(result)
    expect(persisted.reasonCode).toBe('QUOTA_EXHAUSTED')
  })

  it('PERSIST-07-C: reasonCode=UNKNOWN_ERROR for unrecognized error', () => {
    const result = minimalBenchmarkResult({ error: 'connection reset by peer', outcome: 'PROVIDER_ERROR' })
    const persisted = sanitizeForPersistence(result)
    expect(persisted.reasonCode).toBe('UNKNOWN_ERROR')
  })

  it('PERSIST-07-D: reasonCode=null when no error', () => {
    const result = minimalBenchmarkResult({ error: null })
    const persisted = sanitizeForPersistence(result)
    expect(persisted.reasonCode).toBeNull()
  })
})

// ── PERSIST-08: deriveProvider ────────────────────────────────────────────────

describe('PERSIST-08: deriveProvider', () => {
  it('PERSIST-08-A: mock mode → "mock"', () => {
    expect(deriveProvider('anything', 'mock')).toBe('mock')
  })

  it('PERSIST-08-B: gemini model → "google"', () => {
    expect(deriveProvider('gemini-3.5-flash-lite', 'real')).toBe('google')
  })

  it('PERSIST-08-C: claude model → "anthropic"', () => {
    expect(deriveProvider('claude-sonnet-4-6', 'real')).toBe('anthropic')
  })

  it('PERSIST-08-D: groq gpt-oss models → "groq" regardless of LLM_PROVIDER env', () => {
    vi.stubEnv('LLM_PROVIDER', '')
    expect(deriveProvider('openai/gpt-oss-120b', 'real')).toBe('groq')
    expect(deriveProvider('openai/gpt-oss-20b', 'real')).toBe('groq')
    vi.unstubAllEnvs()
  })
})

// ── PERSIST-08B: reasonCode keeps LLM error codes (Incremento 6.3) ───────────

describe('PERSIST-08B: reasonCode preserves LLM API error codes', () => {
  it.each([
    'LLM_QUOTA_EXCEEDED',
    'LLM_PROVIDER_UNAVAILABLE',
    'LLM_MODEL_UNAVAILABLE',
    'LLM_EMPTY_RESPONSE',
  ])('PERSIST-08B: diagnosisAgent::%s is persisted as its code', (code) => {
    const r = minimalBenchmarkResult({ llmDiagnosis: `diagnosisAgent::${code}` })
    expect(sanitizeForPersistence(r).reasonCode).toBe(code)
  })
})

// ── PERSIST-09: validateResultsPath security ──────────────────────────────────

describe('PERSIST-09: validateResultsPath', () => {
  it('PERSIST-09-A: throws for path traversal outside results dir', () => {
    expect(() => validateResultsPath('../../../etc/passwd')).toThrow('authorized results directory')
  })

  it('PERSIST-09-B: accepts a valid path within results dir', () => {
    const valid = join(DEFAULT_RESULTS_DIR, 'my-report.json')
    expect(() => validateResultsPath(valid)).not.toThrow()
  })
})

// ── PERSIST-10: cleanStaleTmp ─────────────────────────────────────────────────

describe('PERSIST-10: cleanStaleTmp', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(cleanupTestDir)

  it('PERSIST-10-A: removes stale .tmp file', () => {
    const filePath = join(tmpDir, 'test.json')
    writeFileSync(filePath + '.tmp', 'stale', 'utf8')
    cleanStaleTmp(filePath)
    expect(existsSync(filePath + '.tmp')).toBe(false)
  })

  it('PERSIST-10-B: does not throw if .tmp file does not exist', () => {
    expect(() => cleanStaleTmp(join(tmpDir, 'no-tmp-here.json'))).not.toThrow()
  })
})

// ── PERSIST-11: completedResultStubs ──────────────────────────────────────────

describe('PERSIST-11: completedResultStubs', () => {
  it('PERSIST-11-A: stubs include scenarioId and outcome', () => {
    const record = minimalCampaign({
      completed: [
        {
          scenarioId: 'SYM-001',
          caseId: null,
          outcome: 'PASSED',
          passed: true,
          durationMs: 10,
          realRequestsUsed: 0,
          tokensUsed: 50,
          safetyBlocked: false,
          fallback: false,
          humanReviewRequired: false,
          reasonCode: null,
        },
      ],
    })
    const stubs = completedResultStubs(record)
    expect(stubs).toHaveLength(1)
    expect(stubs[0]!.scenarioId).toBe('SYM-001')
    expect(stubs[0]!.outcome).toBe('PASSED')
  })
})
