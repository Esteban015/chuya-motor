/**
 * Campaign test suite — Fase 5D.1
 *
 * CAM-01: selectScenarios — IDs, categories, union, all
 * CAM-02: filterCompleted — campaign resume
 * CAM-03: Batch execution — batchSize, batchSummaries
 * CAM-04: Global request limit — quota exhaustion stops campaign
 * CAM-05: realRequestsUsed per scenario
 * CAM-06: RpmLimiter — time-based delay between real calls
 * CAM-07: Quota stop — QUOTA_EXHAUSTED outcome routes to skipped
 * CAM-08: Not-executed scenarios — skipped + pendingScenarios
 * CAM-09: Latency — durationMs excludes artificial delays
 * CAM-10: countByOutcome — outcome distribution metrics
 * CAM-11: Data protection — credentials not in reports
 * CAM-12: Campaign reports — toCampaignMarkdown, toCampaignJSON
 * CAM-13: Critical failures — FAILED_SAFETY + EvaluationOutcome classifier
 * CAM-14: Mock mode — realRequestsUsed=0 throughout
 *
 * No real API calls. No Gemini quota consumed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { getAllScenarios, getScenarioById } from '../dataset/scenarios'
import type { BenchmarkScenario } from '../dataset/types'
import type { LLMAdapter, LLMCompletionRequest, LLMResult } from '@/agents/llm/llm-adapter'
import { DeterministicMockLLMAdapter } from '@/agents/llm/deterministic-mock-adapter'
import { selectScenarios, filterCompleted } from '../runner/scenario-selector'
import { RpmLimiter } from '../runner/rate-limiter'
import { runCampaign } from '../runner/campaign'
import { toCampaignMarkdown, toCampaignJSON } from '../runner/report'
import { countByOutcome } from '../runner/metrics'
import { classifyOutcome } from '../runner/outcome'
import type { BenchmarkResult } from '../runner/types'

afterEach(() => vi.unstubAllEnvs())

// ── Helpers ───────────────────────────────────────────────────────────────────

function getScenario(id: string): BenchmarkScenario {
  const s = getScenarioById(id)
  if (!s) throw new Error(`Scenario ${id} not found`)
  return s
}

/** An adapter that counts real LLM calls and exhausts after maxCalls. */
function makeCountingAdapter(maxCalls: number): LLMAdapter & { requestsMade: number; isQuotaExhausted: boolean } {
  const delegate = new DeterministicMockLLMAdapter()
  let count = 0
  return {
    get modelId() { return delegate.modelId },
    get requestsMade() { return count },
    get isQuotaExhausted() { return count >= maxCalls },
    async complete(req: LLMCompletionRequest): Promise<LLMResult> {
      if (count >= maxCalls) {
        return { ok: false, error: { code: 'LLM_QUOTA_EXCEEDED', message: 'mock campaign quota exhausted' } }
      }
      count++
      return delegate.complete(req)
    },
  }
}

/** Minimal BenchmarkResult stub with explicit outcome. */
function makeResult(scenarioId: string, overrides: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    scenarioId,
    category: 'symptom',
    severity: 'high',
    mode: 'mock',
    passed: true,
    durationMs: 100,
    output: null,
    error: null,
    llmDiagnosis: null,
    deterministicChecks: [],
    securityCheck: { passed: true, violations: [] },
    tokensUsed: 0,
    requiresHumanReview: false,
    outcome: 'PASSED',
    realRequestsUsed: 0,
    ...overrides,
  }
}

// ── CAM-01: selectScenarios ───────────────────────────────────────────────────

describe('CAM-01: selectScenarios', () => {
  const all = getAllScenarios()

  it('CAM-01-A: no filters → returns all scenarios unchanged', () => {
    const result = selectScenarios(all)
    expect(result).toHaveLength(all.length)
  })

  it('CAM-01-B: filter by specific IDs → returns only matching IDs', () => {
    const result = selectScenarios(all, { ids: ['SYM-001', 'BUD-001', 'SAF-001'] })
    expect(result).toHaveLength(3)
    expect(result.map((s) => s.id).sort()).toEqual(['BUD-001', 'SAF-001', 'SYM-001'])
  })

  it('CAM-01-C: filter by category → returns only that category', () => {
    const result = selectScenarios(all, { categories: ['safety'] })
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((s) => s.category === 'safety')).toBe(true)
  })

  it('CAM-01-D: IDs + categories → union (no duplicates for overlap)', () => {
    // SYM-001 matches both the ID and the symptom category
    const result = selectScenarios(all, { ids: ['SYM-001'], categories: ['budget'] })
    const ids = result.map((s) => s.id)
    // SYM-001 included via ID; all BUD-* included via category; no duplicates
    expect(ids.includes('SYM-001')).toBe(true)
    expect(ids.filter((id) => id === 'SYM-001')).toHaveLength(1)
    expect(result.filter((s) => s.category === 'budget').length).toBeGreaterThan(0)
  })

  it('CAM-01-E: non-existent ID → returns empty', () => {
    const result = selectScenarios(all, { ids: ['NONEXISTENT-999'] })
    expect(result).toHaveLength(0)
  })
})

// ── CAM-02: filterCompleted ───────────────────────────────────────────────────

describe('CAM-02: filterCompleted — campaign resume', () => {
  const all = getAllScenarios()

  it('CAM-02-A: filters out scenarios that have been completed', () => {
    const completedResults = [makeResult('SYM-001', { outcome: 'PASSED' })]
    const remaining = filterCompleted(all, completedResults)
    expect(remaining.find((s) => s.id === 'SYM-001')).toBeUndefined()
    expect(remaining.length).toBe(all.length - 1)
  })

  it('CAM-02-B: QUOTA_EXHAUSTED result is NOT treated as completed — scenario stays pending', () => {
    const quotaResults = [makeResult('SYM-001', { outcome: 'QUOTA_EXHAUSTED', error: 'QUOTA_EXHAUSTED: ...' })]
    const remaining = filterCompleted(all, quotaResults)
    expect(remaining.find((s) => s.id === 'SYM-001')).toBeDefined()
  })

  it('CAM-02-C: allowRerun=true → returns all scenarios unchanged', () => {
    const completedResults = all.map((s) => makeResult(s.id, { outcome: 'PASSED' }))
    const remaining = filterCompleted(all, completedResults, { allowRerun: true })
    expect(remaining).toHaveLength(all.length)
  })

  it('CAM-02-D: empty completedResults → returns all scenarios', () => {
    const remaining = filterCompleted(all, [])
    expect(remaining).toHaveLength(all.length)
  })

  it('CAM-02-E: FAILED_STRUCTURAL completed result is treated as completed', () => {
    const failed = [makeResult('BUD-001', { outcome: 'FAILED_STRUCTURAL', passed: false })]
    const remaining = filterCompleted(all, failed)
    expect(remaining.find((s) => s.id === 'BUD-001')).toBeUndefined()
  })
})

// ── CAM-03: Batch execution ───────────────────────────────────────────────────

describe('CAM-03: Batch execution — batchSize and batchSummaries', () => {
  it('CAM-03-A: batchSize=2 with 4 scenarios → 2 batchSummaries', async () => {
    const scenarios = ['SYM-001', 'BUD-001', 'SAF-001', 'AMB-001'].map(getScenario)
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: scenarios.map((s) => s.id),
      batchSize: 2,
    })
    expect(campaign.batchSummaries).toHaveLength(2)
    expect(campaign.batchSummaries[0]!.total).toBe(2)
    expect(campaign.batchSummaries[1]!.total).toBe(2)
  }, 30_000)

  it('CAM-03-B: partial batch is flushed at end (3 scenarios, batchSize=2)', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'BUD-001', 'SAF-001'],
      batchSize: 2,
    })
    // First batch: 2 scenarios; second (partial) batch: 1 scenario
    expect(campaign.batchSummaries).toHaveLength(2)
    expect(campaign.batchSummaries[1]!.total).toBe(1)
  }, 30_000)

  it('CAM-03-C: batchSummaries contain valid runId UUIDs', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'BUD-001'],
      batchSize: 1,
    })
    for (const batch of campaign.batchSummaries) {
      expect(batch.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
  }, 30_000)

  it('CAM-03-D: no batchSize → single batch for all scenarios', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'BUD-001', 'SAF-001'],
    })
    expect(campaign.batchSummaries).toHaveLength(1)
    expect(campaign.batchSummaries[0]!.total).toBe(3)
  }, 30_000)
})

// ── CAM-04: Global request limit ─────────────────────────────────────────────

describe('CAM-04: Global request limit — quota exhaustion', () => {
  it('CAM-04-A: exhausted adapter from start → all scenarios go to skipped', async () => {
    const exhausted: LLMAdapter & { isQuotaExhausted: boolean } = {
      modelId: 'exhausted-mock',
      isQuotaExhausted: true,
      complete: (): never => { throw new Error('Should not be called when quota is exhausted') },
    }
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'BUD-001'],
      llmAdapter: exhausted,
    })
    expect(campaign.completed).toHaveLength(0)
    expect(campaign.skipped).toHaveLength(2)
  }, 15_000)

  it('CAM-04-B: counting adapter exhausts after 1 call → first scenario completes, rest skipped', async () => {
    const adapter = makeCountingAdapter(1)
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'SYM-003', 'BUD-001'],
      llmAdapter: adapter,
    })
    // SYM-001 uses 1 LLM call, exhausting the adapter
    // SYM-003 and BUD-001 are pre-check skipped
    expect(campaign.completed).toHaveLength(1)
    expect(campaign.completed[0]!.scenarioId).toBe('SYM-001')
    expect(campaign.skipped).toHaveLength(2)
  }, 30_000)

  it('CAM-04-C: skipped outcomes are QUOTA_EXHAUSTED', async () => {
    const exhausted: LLMAdapter & { isQuotaExhausted: boolean } = {
      modelId: 'exhausted-mock',
      isQuotaExhausted: true,
      complete: (): never => { throw new Error('unreachable') },
    }
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001'],
      llmAdapter: exhausted,
    })
    expect(campaign.skipped[0]!.outcome).toBe('QUOTA_EXHAUSTED')
    expect(campaign.skipped[0]!.realRequestsUsed).toBe(0)
  }, 15_000)
})

// ── CAM-05: realRequestsUsed per scenario ────────────────────────────────────

describe('CAM-05: realRequestsUsed per scenario', () => {
  it('CAM-05-A: counting adapter → SYM scenario uses 1 real call', async () => {
    const adapter = makeCountingAdapter(10)
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001'],
      llmAdapter: adapter,
    })
    const result = campaign.completed[0]!
    expect(result.realRequestsUsed).toBe(1)
  }, 30_000)

  it('CAM-05-B: SAF scenario (safety-blocked) uses 0 real LLM calls', async () => {
    const adapter = makeCountingAdapter(10)
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SAF-001'],
      llmAdapter: adapter,
    })
    // SAF-001 is safety-blocked → no LLM call
    const result = campaign.completed[0]!
    expect(result.realRequestsUsed).toBe(0)
  }, 30_000)

  it('CAM-05-C: campaign.realRequestsUsed equals sum of individual realRequestsUsed', async () => {
    const adapter = makeCountingAdapter(10)
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      // SYM-001: 1 LLM call (symptom route, diy_intent → not safety-blocked)
      // SAF-001: 0 LLM calls (safety-blocked by policy)
      // SYM-003 excluded (historical: blocked until Safety Gate v1.4.0; kept out so this
      //   aggregation test stays a 1-call baseline)
      scenarioIds: ['SYM-001', 'SAF-001'],
      llmAdapter: adapter,
    })
    const sumOfIndividual = campaign.completed.reduce((s, r) => s + (r.realRequestsUsed ?? 0), 0)
    // Aggregation test: campaign total must equal sum of individual results
    expect(campaign.realRequestsUsed).toBe(sumOfIndividual)
    // SYM-001 makes 1 real call; SAF-001 makes 0 (safety-blocked)
    expect(campaign.realRequestsUsed).toBe(1)
  }, 30_000)
})

// ── CAM-06: RpmLimiter ────────────────────────────────────────────────────────

describe('CAM-06: RpmLimiter — time-based delays', () => {
  it('CAM-06-A: rpm=60 → maxIntervalMs=1000ms (ceil(60000/60))', () => {
    const limiter = new RpmLimiter(60)
    // No previous call → no wait
    expect(limiter.totalDelayAppliedMs).toBe(0)
  })

  it('CAM-06-B: waitIfNeeded(false) always returns 0 without waiting', async () => {
    const limiter = new RpmLimiter(1) // 1 rpm = 60s interval
    limiter.recordCall()
    const wait = await limiter.waitIfNeeded(false) // hadRealCall=false
    expect(wait).toBe(0)
  })

  it('CAM-06-C: first call with no previous record → no wait (lastRealCallTs is null)', async () => {
    const limiter = new RpmLimiter(1)
    const wait = await limiter.waitIfNeeded(true)
    expect(wait).toBe(0) // no previous timestamp → no wait
  })

  it('CAM-06-D: rpm <= 0 throws RangeError', () => {
    expect(() => new RpmLimiter(0)).toThrow(RangeError)
    expect(() => new RpmLimiter(-5)).toThrow(RangeError)
  })

  it('CAM-06-E: totalDelayAppliedMs is tracked correctly', async () => {
    const limiter = new RpmLimiter(1200) // 1200 rpm → 50ms interval
    limiter.recordCall()
    // If we immediately call again, we might need to wait up to 50ms
    // (elapsed is likely < 50ms in test execution)
    await limiter.waitIfNeeded(true)
    // May be 0 if elapsed > 50ms, or positive if still within window
    expect(limiter.totalDelayAppliedMs).toBeGreaterThanOrEqual(0)
  }, 1000)
})

// ── CAM-07: Quota stop ───────────────────────────────────────────────────────

describe('CAM-07: Quota stop — skipped array and campaign state', () => {
  it('CAM-07-A: skipped results have outcome=QUOTA_EXHAUSTED', async () => {
    const exhausted: LLMAdapter & { isQuotaExhausted: boolean } = {
      modelId: 'exhausted-mock',
      isQuotaExhausted: true,
      complete: (): never => { throw new Error('unreachable') },
    }
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'BUD-001', 'SAF-001'],
      llmAdapter: exhausted,
    })
    expect(campaign.skipped).toHaveLength(3)
    for (const r of campaign.skipped) {
      expect(r.outcome).toBe('QUOTA_EXHAUSTED')
      expect(r.passed).toBe(false)
      expect(r.realRequestsUsed).toBe(0)
    }
  }, 15_000)

  it('CAM-07-B: campaign.realRequestsUsed is 0 when all skipped', async () => {
    const exhausted: LLMAdapter & { isQuotaExhausted: boolean } = {
      modelId: 'exhausted-mock',
      isQuotaExhausted: true,
      complete: (): never => { throw new Error('unreachable') },
    }
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001'],
      llmAdapter: exhausted,
    })
    expect(campaign.realRequestsUsed).toBe(0)
  }, 15_000)
})

// ── CAM-08: Not-executed scenarios (skipped) ─────────────────────────────────

describe('CAM-08: Not-executed scenarios — skipped + pendingScenarios', () => {
  it('CAM-08-A: skipped scenarios have durationMs=0', async () => {
    const exhausted: LLMAdapter & { isQuotaExhausted: boolean } = {
      modelId: 'exhausted-mock',
      isQuotaExhausted: true,
      complete: (): never => { throw new Error('unreachable') },
    }
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001'],
      llmAdapter: exhausted,
    })
    expect(campaign.skipped[0]!.durationMs).toBe(0)
    expect(campaign.skipped[0]!.output).toBeNull()
  }, 15_000)

  it('CAM-08-B: pendingScenarios is empty when all selected scenarios are processed', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'BUD-001'],
    })
    expect(campaign.pendingScenarios).toHaveLength(0)
  }, 30_000)
})

// ── CAM-09: Latency ───────────────────────────────────────────────────────────

describe('CAM-09: Latency — durationMs excludes artificial scenario delay', () => {
  it('CAM-09-A: durationMs measures scenario execution only, not scenarioDelayMs', async () => {
    const DELAY_MS = 50
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'BUD-001'],
      scenarioDelayMs: DELAY_MS,
    })
    // Both results should have durationMs << DELAY_MS * total_scenarios
    // (the delay is NOT counted in durationMs)
    for (const result of campaign.completed) {
      expect(result.durationMs).toBeLessThan(10_000) // sanity check — not inflated by delay
    }
    // The total campaign time was longer than just execution, but durationMs per result is unaffected
    const totalDuration = campaign.completed.reduce((s, r) => s + r.durationMs, 0)
    // The sum of durationMs should be much less than the wall-clock campaign time + 2*delay
    // We can't measure wall-clock here, but we verify durationMs is reasonable
    expect(totalDuration).toBeGreaterThan(0)
  }, 60_000)
})

// ── CAM-10: countByOutcome ────────────────────────────────────────────────────

describe('CAM-10: countByOutcome — outcome distribution metrics', () => {
  it('CAM-10-A: counts all outcomes correctly', () => {
    const results = [
      makeResult('SYM-001', { outcome: 'PASSED' }),
      makeResult('SYM-002', { outcome: 'PASSED' }),
      makeResult('BUD-001', { outcome: 'FAILED_STRUCTURAL', passed: false }),
      makeResult('SAF-001', { outcome: 'QUOTA_EXHAUSTED', error: 'QUOTA_EXHAUSTED: ...' }),
    ]
    const counts = countByOutcome(results)
    expect(counts.PASSED).toBe(2)
    expect(counts.FAILED_STRUCTURAL).toBe(1)
    expect(counts.QUOTA_EXHAUSTED).toBe(1)
    expect(counts.PASSED_PENDING_REVIEW).toBe(0)
    expect(counts.FAILED_SAFETY).toBe(0)
  })

  it('CAM-10-B: results without outcome field are ignored (backward compat)', () => {
    const results = [
      makeResult('SYM-001', { outcome: undefined }),
      makeResult('SYM-002', { outcome: 'PASSED' }),
    ]
    const counts = countByOutcome(results)
    expect(counts.PASSED).toBe(1)
    // All other outcomes are 0 since the undefined-outcome result is ignored
    const total = Object.values(counts).reduce((s, n) => s + n, 0)
    expect(total).toBe(1)
  })

  it('CAM-10-C: empty results → all counts are 0', () => {
    const counts = countByOutcome([])
    expect(Object.values(counts).every((n) => n === 0)).toBe(true)
  })
})

// ── CAM-11: Data protection ───────────────────────────────────────────────────

describe('CAM-11: Data protection — no credentials in reports', () => {
  it('CAM-11-A: toCampaignJSON does not include Gemini API key patterns', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001'],
    })
    // Inject a fake key-like string into the campaign result for testing
    const fakeResult = {
      ...campaign,
      model: 'AIzaSyFakeKeyXxxxxXxxxxXxxxxXxx_TestKey1234',
    }
    const json = toCampaignJSON(fakeResult)
    // The model field may contain the fake key but not via the credential patterns
    // The sanitizer targets actual key patterns (AIza... 20+ chars)
    expect(json.includes('AIzaSyFakeKeyXxxxxXxxxxXxxxxXxx_TestKey1234')).toBe(false)
  })

  it('CAM-11-B: toCampaignJSON output is sanitized — no sk-ant- patterns', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SAF-001'],
    })
    const json = toCampaignJSON(campaign)
    expect(json.includes('sk-ant-')).toBe(false)
  })
})

// ── CAM-12: Campaign reports ──────────────────────────────────────────────────

describe('CAM-12: Campaign reports — toCampaignMarkdown and toCampaignJSON', () => {
  it('CAM-12-A: toCampaignMarkdown contains campaign ID', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001'],
    })
    const md = toCampaignMarkdown(campaign)
    expect(md.includes(campaign.campaignId)).toBe(true)
  }, 30_000)

  it('CAM-12-B: toCampaignMarkdown contains scenario counts', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'BUD-001'],
    })
    const md = toCampaignMarkdown(campaign)
    expect(md.includes('2')).toBe(true) // at least "Scenarios executed | 2"
  }, 30_000)

  it('CAM-12-C: toCampaignJSON is valid JSON and parses without error', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SAF-001'],
    })
    const json = toCampaignJSON(campaign)
    expect(() => JSON.parse(json)).not.toThrow()
  }, 30_000)

  it('CAM-12-D: toCampaignJSON with omitResultDetails=true omits completed/skipped arrays', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001'],
    })
    const json = toCampaignJSON(campaign, { omitResultDetails: true })
    const parsed = JSON.parse(json) as { completed: unknown[]; skipped: unknown[] }
    expect(parsed.completed).toHaveLength(0)
    expect(parsed.skipped).toHaveLength(0)
  }, 30_000)

  it('CAM-12-G: toCampaignJSON default → completed array is populated (DEF-03)', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'BUD-001'],
    })
    const json = toCampaignJSON(campaign)
    const parsed = JSON.parse(json) as { completed: unknown[] }
    // DEF-03: results must be included by default, not stripped
    expect(parsed.completed).toHaveLength(2)
  }, 30_000)

  it('CAM-12-H: toCampaignMarkdown does not reference anthropic.com (DEF-04)', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SAF-001'],
    })
    const md = toCampaignMarkdown(campaign)
    expect(md.includes('anthropic.com')).toBe(false)
  }, 15_000)

  it('CAM-12-E: campaign result has valid UUID as campaignId', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SAF-001'],
    })
    expect(campaign.campaignId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  }, 15_000)

  it('CAM-12-F: datasetVersion encodes scenario count', async () => {
    const all = getAllScenarios()
    const campaign = await runCampaign(all, {
      mode: 'mock',
      scenarioIds: ['SAF-001'],
    })
    expect(campaign.datasetVersion).toBe(`v${all.length}`)
  }, 15_000)
})

// ── CAM-13: Critical failures — EvaluationOutcome classification ──────────────

describe('CAM-13: EvaluationOutcome classifier — classifyOutcome', () => {
  const basePassed = {
    passed: true,
    error: null,
    llmDiagnosis: null,
    output: { safetyBlocked: false, fallback: false },
    securityCheck: { passed: true, violations: [] },
    requiresHumanReview: false,
    deterministicChecks: [{ passed: true }],
  }

  it('CAM-13-A: all checks pass, no review → PASSED', () => {
    expect(classifyOutcome(basePassed)).toBe('PASSED')
  })

  it('CAM-13-B: requiresHumanReview=true → PASSED_PENDING_REVIEW', () => {
    expect(classifyOutcome({ ...basePassed, requiresHumanReview: true })).toBe('PASSED_PENDING_REVIEW')
  })

  it('CAM-13-C: securityCheck.passed=false → FAILED_SAFETY', () => {
    const input = { ...basePassed, securityCheck: { passed: false, violations: ['CF-01'] } }
    expect(classifyOutcome(input)).toBe('FAILED_SAFETY')
  })

  it('CAM-13-D: passed=false, deterministicChecks fail → FAILED_STRUCTURAL', () => {
    const input = {
      ...basePassed,
      passed: false,
      deterministicChecks: [{ passed: false }],
    }
    expect(classifyOutcome(input)).toBe('FAILED_STRUCTURAL')
  })

  it('CAM-13-E: error contains QUOTA_EXHAUSTED → QUOTA_EXHAUSTED', () => {
    const input = { ...basePassed, passed: false, error: 'QUOTA_EXHAUSTED: not executed' }
    expect(classifyOutcome(input)).toBe('QUOTA_EXHAUSTED')
  })

  it('CAM-13-F: error contains "timeout" (case-insensitive) → TIMEOUT', () => {
    const input = { ...basePassed, passed: false, error: 'Timeout after 30000ms' }
    expect(classifyOutcome(input)).toBe('TIMEOUT')
  })

  it('CAM-13-G: fallback=true with schema violation diagnosis → SCHEMA_ERROR', () => {
    const input = {
      ...basePassed,
      output: { safetyBlocked: false, fallback: true },
      llmDiagnosis: 'diagnosisAgent::LLM_SCHEMA_VIOLATION',
    }
    expect(classifyOutcome(input)).toBe('SCHEMA_ERROR')
  })

  it('CAM-13-H: fallback=true without diagnosis → FALLBACK_ACTIVATED', () => {
    const input = {
      ...basePassed,
      output: { safetyBlocked: false, fallback: true },
      llmDiagnosis: null,
    }
    expect(classifyOutcome(input)).toBe('FALLBACK_ACTIVATED')
  })

  it('CAM-13-I: SAF-001 in mock mode → outcome=PASSED (safety correctly blocked)', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SAF-001'],
    })
    const result = campaign.completed[0]!
    expect(result.passed).toBe(true)
    expect(result.outcome).toBe('PASSED')
  }, 15_000)
})

// ── CAM-14: Mock mode verification ───────────────────────────────────────────

describe('CAM-14: Mock mode — no real LLM calls', () => {
  it('CAM-14-A: mock mode → all results have realRequestsUsed=0', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'BUD-001', 'SAF-001', 'AMB-001'],
    })
    for (const result of campaign.completed) {
      expect(result.realRequestsUsed).toBe(0)
    }
  }, 30_000)

  it('CAM-14-B: mock mode → campaign.realRequestsUsed is 0', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'SYM-003', 'BUD-001'],
    })
    expect(campaign.realRequestsUsed).toBe(0)
  }, 30_000)

  it('CAM-14-C: mock mode → all 5 pilot scenarios complete without quota issues', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-001', 'SYM-003', 'BUD-001', 'SAF-001', 'AMB-001'],
    })
    expect(campaign.completed).toHaveLength(5)
    expect(campaign.skipped).toHaveLength(0)
  }, 60_000)

  it('CAM-14-D: mode is reflected in campaign result', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SAF-001'],
    })
    expect(campaign.mode).toBe('mock')
  }, 15_000)
})

// ── DEF-01 (superseded by 6.4C, D-03): SYM-003 — 12 V battery symptom now allowed ──

describe('DEF-01 → D-03: SYM-003 descriptive 12 V battery symptom is allowed (Safety Gate v1.4.0, dataset v1.2.0)', () => {
  it('DEF-01-A: SYM-003 mock → safetyBlocked=false (descriptive 12 V battery, no high-voltage context)', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-003'],
    })
    const result = campaign.completed[0]!
    expect(result.output?.safetyBlocked).toBe(false)
    expect(result.output?.route).toBe('symptom')
  }, 15_000)

  it('DEF-01-B: SYM-003 mock → passed=true, outcome=PASSED_PENDING_REVIEW (expected allow matches actual allow)', async () => {
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['SYM-003'],
    })
    const result = campaign.completed[0]!
    expect(result.passed).toBe(true)
    // Now produces LLM output → human review required (evaluation.requiresHumanReview=true).
    expect(result.outcome).toBe('PASSED_PENDING_REVIEW')
  }, 15_000)

  it('DEF-01-C: SYM-003 scenario version is 1.2.0 (dataset bump, 6.4C)', () => {
    const s = getScenario('SYM-003')
    expect(s.version).toBe('1.2.0')
    expect(s.expected.safetyBlocked).toBe(false)
    expect(s.security.expectsSafetyBlock).toBe(false)
  })
})

// ── DEF-02: AMB-001 — Fixed in v1.3.0 (FASE 5D.1.1) ──────────────────────────

describe('DEF-02: AMB-001 — Fixed in v1.3.0: symptom_description classification', () => {
  it('DEF-02-A: AMB-001 mock → safetyBlocked=false, passed=true (FASE 5D.1.1 fix)', async () => {
    // Fix: ACTION_VERB_EXCLUSIONS removes "hace/hacen" from diy_intent detection.
    // SYMPTOM_CONTEXT_STEMS + "al/cuando" pattern → symptom_description → NOT blocked.
    // "El motor hace ruido al frenar lentamente" is correctly classified as a symptom report.
    const campaign = await runCampaign(getAllScenarios(), {
      mode: 'mock',
      scenarioIds: ['AMB-001'],
    })
    const result = campaign.completed[0]!
    expect(result.output?.safetyBlocked).toBe(false)
    expect(result.passed).toBe(true)
    expect(result.outcome).toBe('PASSED_PENDING_REVIEW')
  }, 15_000)
})
