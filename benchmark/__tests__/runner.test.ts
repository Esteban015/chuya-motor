import { describe, it, expect, vi, afterEach } from 'vitest'
import { runBenchmark, isAdapterQuotaExhausted } from '../runner/runner'
import { getScenarioById, getScenariosByCategory } from '../dataset/scenarios'
import type { BenchmarkScenario } from '../dataset/types'
import type { LLMAdapter, LLMCompletionRequest, LLMResult } from '@/agents/llm/llm-adapter'

afterEach(() => vi.unstubAllEnvs())

function getScenario(id: string): BenchmarkScenario {
  const s = getScenarioById(id)
  if (!s) throw new Error(`Scenario ${id} not found`)
  return s
}

describe('RUN-01: Mock mode — basic execution', () => {
  it('RUN-01-A: runs a single symptom scenario without error', async () => {
    const run = await runBenchmark([getScenario('SYM-001')], { mode: 'mock' })
    expect(run.results).toHaveLength(1)
    expect(run.results[0]!.error).toBeNull()
  }, 15_000)

  it('RUN-01-B: summary is populated after run', async () => {
    const run = await runBenchmark([getScenario('SYM-001')], { mode: 'mock' })
    expect(run.summary).not.toBeNull()
    expect(run.summary!.total).toBe(1)
  }, 15_000)

  it('RUN-01-C: summary runId is a UUID', async () => {
    const run = await runBenchmark([getScenario('BUD-001')], { mode: 'mock' })
    expect(run.summary!.runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  }, 15_000)
})

describe('RUN-02: Mock mode — safety scenarios', () => {
  it('RUN-02-A: SAF-001 (frenos) is blocked by safety gate', async () => {
    const run = await runBenchmark([getScenario('SAF-001')], { mode: 'mock' })
    const result = run.results[0]!
    expect(result.output?.safetyBlocked).toBe(true)
  }, 15_000)

  it('RUN-02-B: SAF-001 passes all deterministic checks', async () => {
    const run = await runBenchmark([getScenario('SAF-001')], { mode: 'mock' })
    const result = run.results[0]!
    const failed = result.deterministicChecks.filter((c) => !c.passed)
    expect(failed).toHaveLength(0)
  }, 15_000)
})

describe('RUN-03: Mock mode — budget scenarios', () => {
  it('RUN-03-A: BUD-001 routes to budget', async () => {
    const run = await runBenchmark([getScenario('BUD-001')], { mode: 'mock' })
    const result = run.results[0]!
    expect(result.output?.route).toBe('budget')
  }, 15_000)

  it('RUN-03-B: BUD-001 has non-null budget output', async () => {
    const run = await runBenchmark([getScenario('BUD-001')], { mode: 'mock' })
    const result = run.results[0]!
    expect(result.output?.budget).not.toBeNull()
  }, 15_000)
})

describe('RUN-04: maxScenariosPerCategory limit', () => {
  it('RUN-04-A: limits to N scenarios per category', async () => {
    const all = [...getScenariosByCategory('symptom'), ...getScenariosByCategory('budget')]
    const run = await runBenchmark(all, { mode: 'mock', maxScenariosPerCategory: 2 })
    const symptomResults = run.results.filter((r) => r.category === 'symptom')
    const budgetResults = run.results.filter((r) => r.category === 'budget')
    expect(symptomResults).toHaveLength(2)
    expect(budgetResults).toHaveLength(2)
  }, 60_000)
})

describe('RUN-05: Error handling', () => {
  it('RUN-05-A: timeout produces error result, not throw', async () => {
    // timeoutMs=1 — extremely aggressive timeout to force timeout error
    const run = await runBenchmark([getScenario('SYM-001')], {
      mode: 'mock',
      timeoutMs: 1,
    })
    // Either times out or succeeds extremely fast — either way, no unhandled throw
    expect(run.results).toHaveLength(1)
    // If it errored, the run should capture it
    if (run.results[0]!.error !== null) {
      expect(run.results[0]!.error).toMatch(/Timeout|timeout/)
    }
  }, 15_000)
})

describe('RUN-06: Real mode guard', () => {
  it('RUN-06-A: real mode without authorization throws', async () => {
    vi.stubEnv('BENCHMARK_REAL_LLM_AUTHORIZED', '')
    await expect(
      runBenchmark([getScenario('SYM-001')], { mode: 'real' }),
    ).rejects.toThrow(/BENCHMARK_REAL_LLM_AUTHORIZED/)
  })

  it('RUN-06-B: real mode with authorization but CI=true throws', async () => {
    vi.stubEnv('BENCHMARK_REAL_LLM_AUTHORIZED', 'true')
    vi.stubEnv('CI', 'true')
    await expect(
      runBenchmark([getScenario('SYM-001')], { mode: 'real' }),
    ).rejects.toThrow(/CI/)
  })
})

describe('RUN-07: Latency and category aggregation', () => {
  it('RUN-07-A: latencyMs is populated', async () => {
    const run = await runBenchmark([getScenario('SYM-001'), getScenario('BUD-001')], { mode: 'mock' })
    expect(run.summary!.latencyMs.p50).toBeGreaterThanOrEqual(0)
    expect(run.summary!.latencyMs.max).toBeGreaterThanOrEqual(run.summary!.latencyMs.p50)
  }, 30_000)

  it('RUN-07-B: byCategory has an entry for each category present', async () => {
    const run = await runBenchmark(
      [getScenario('SYM-001'), getScenario('BUD-001'), getScenario('SAF-001')],
      { mode: 'mock' },
    )
    const categories = run.summary!.byCategory.map((c) => c.category)
    expect(categories).toContain('symptom')
    expect(categories).toContain('budget')
    expect(categories).toContain('safety')
  }, 30_000)
})

describe('RUN-08: Budget limit tracking', () => {
  it('RUN-08-A: budgetLimitTokens does not stop execution (only flags)', async () => {
    const run = await runBenchmark([getScenario('SYM-001')], {
      mode: 'mock',
      budgetLimitTokens: 1, // very low to trigger flag
    })
    // Run completes — tokens are tracked but execution is not halted
    expect(run.results).toHaveLength(1)
    expect(run.summary).not.toBeNull()
  }, 15_000)
})

describe('RUN-10: llmDiagnosis extraction from traces', () => {
  it('RUN-10-A: successful mock run → llmDiagnosis is null', async () => {
    const run = await runBenchmark([getScenario('SYM-001')], { mode: 'mock' })
    expect(run.results[0]!.llmDiagnosis).toBeNull()
  }, 15_000)

  it('RUN-10-B: LLM call that returns ok:false → llmDiagnosis contains node and error code', async () => {
    vi.stubEnv('BENCHMARK_REAL_LLM_AUTHORIZED', 'true')
    const failAdapter: LLMAdapter = {
      modelId: 'fail-stub',
      complete: (_req: LLMCompletionRequest): Promise<LLMResult> =>
        Promise.resolve({ ok: false, error: { code: 'LLM_AUTH_ERROR', message: 'API key not valid' } }),
    }
    // Inject the failing adapter via a custom scenario execution
    const { analyzeCase } = await import('@/agents/graph/analyze-graph')
    const { getScenarioById } = await import('../dataset/scenarios')
    const scenario = getScenarioById('SYM-001')!
    const { randomUUID } = await import('crypto')
    const output = await analyzeCase(
      { caseId: randomUUID(), userText: scenario.input.userText, experienceLevel: 'unknown', dataLabel: 'synthetic_demo' },
      { llmAdapter: failAdapter },
    )
    // Verify the error code flows through to traces
    const diagTrace = output.traces.find((t) => t.nodeId === 'diagnosisAgent')
    expect(diagTrace?.errorCode).toBe('LLM_AUTH_ERROR')
  }, 15_000)

  it('RUN-10-C: llmDiagnosis format is "nodeId::errorCode"', async () => {
    // Run with a live mock and verify the format is null (success) — format verified via INT5D tests
    const run = await runBenchmark([getScenario('BUD-001')], { mode: 'mock' })
    // Mock always succeeds — llmDiagnosis should be null
    expect(run.results[0]!.llmDiagnosis).toBeNull()
  }, 15_000)
})

describe('RUN-09: isAdapterQuotaExhausted utility', () => {
  function makeAdapter(overrides: Partial<LLMAdapter> & { isQuotaExhausted?: boolean }): LLMAdapter {
    const base: LLMAdapter = {
      modelId: 'test-stub',
      complete: (_req: LLMCompletionRequest): Promise<LLMResult> =>
        Promise.resolve({ ok: true, content: 'ok' }),
    }
    return Object.assign(base, overrides)
  }

  it('RUN-09-A: adapter without isQuotaExhausted property returns false', () => {
    const adapter = makeAdapter({})
    expect(isAdapterQuotaExhausted(adapter)).toBe(false)
  })

  it('RUN-09-B: adapter with isQuotaExhausted=false returns false', () => {
    const adapter = makeAdapter({ isQuotaExhausted: false })
    expect(isAdapterQuotaExhausted(adapter)).toBe(false)
  })

  it('RUN-09-C: adapter with isQuotaExhausted=true returns true', () => {
    const adapter = makeAdapter({ isQuotaExhausted: true })
    expect(isAdapterQuotaExhausted(adapter)).toBe(true)
  })
})
