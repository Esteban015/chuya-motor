/**
 * Groq opt-in smoke & pilot — pure core (Incremento 6.3, Fase 7).
 * No real Groq calls: scenario execution and sleep are injected.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  checkGroqRealGuards,
  resolvePilotConfig,
  runGroqPilot,
  GROQ_CONNECTIVITY_REQUEST,
  GROQ_PILOT_DEFAULT_SCENARIO_IDS,
  GROQ_PILOT_MAX_CASES,
  GROQ_AUTH_FLAG,
  pinSessionAuthorization,
  redactSecretsForLog,
} from './groq-smoke-utils'
import type { BenchmarkResult } from '../runner/types'
import { getAllScenarios } from '../dataset/scenarios'

const all = getAllScenarios()
const pick = (ids: readonly string[]) => ids.map((id) => all.find((s) => s.id === id)!)

function res(scenarioId: string, over: Partial<BenchmarkResult> = {}): BenchmarkResult {
  const s = all.find((x) => x.id === scenarioId)!
  return {
    scenarioId,
    category: s.category,
    severity: s.severity,
    mode: 'real',
    passed: true,
    durationMs: 10,
    output: null,
    error: null,
    llmDiagnosis: null,
    deterministicChecks: [],
    securityCheck: { passed: true, violations: [] },
    tokensUsed: 500,
    requiresHumanReview: false,
    outcome: 'PASSED',
    realRequestsUsed: 1,
    ...over,
  }
}

describe('GSM-01: real-call guards', () => {
  const ok = { GROQ_API_KEY: 'gsk_test', GROQ_REAL_LLM_AUTHORIZED: 'true' }

  it('GSM-01-A: key + explicit authorization → allowed', () => {
    expect(checkGroqRealGuards(ok)).toEqual({ ok: true })
  })
  it('GSM-01-B: missing key → NO_KEY', () => {
    expect(checkGroqRealGuards({ GROQ_REAL_LLM_AUTHORIZED: 'true' })).toMatchObject({ ok: false, reason: 'NO_KEY' })
  })
  it.each(['', 'TRUE', '1', 'yes', undefined])('GSM-01-C: authorization must be exactly "true" (got %s)', (v) => {
    expect(checkGroqRealGuards({ GROQ_API_KEY: 'gsk_x', GROQ_REAL_LLM_AUTHORIZED: v })).toMatchObject({ ok: false, reason: 'NOT_AUTHORIZED' })
  })
  it('GSM-01-D: CI always blocks, even when authorized', () => {
    expect(checkGroqRealGuards({ ...ok, CI: 'true' })).toMatchObject({ ok: false, reason: 'CI' })
  })
  it('GSM-01-E: NEXT_PUBLIC_GROQ_API_KEY is not a substitute', () => {
    expect(checkGroqRealGuards({ NEXT_PUBLIC_GROQ_API_KEY: 'gsk_x', GROQ_REAL_LLM_AUTHORIZED: 'true' })).toMatchObject({ ok: false, reason: 'NO_KEY' })
  })
})

describe('GSM-05: session-only authorization & log redaction', () => {
  it('GSM-05-A: a flag coming only from .env.local is discarded', () => {
    vi.stubEnv(GROQ_AUTH_FLAG, undefined as unknown as string)
    delete process.env[GROQ_AUTH_FLAG]
    pinSessionAuthorization(() => { process.env[GROQ_AUTH_FLAG] = 'true' })
    expect(process.env[GROQ_AUTH_FLAG]).toBeUndefined()
    expect(GROQ_AUTH_FLAG in process.env).toBe(false)
    vi.unstubAllEnvs()
  })
  it('GSM-05-B: a session flag survives the loader', () => {
    vi.stubEnv(GROQ_AUTH_FLAG, 'true')
    pinSessionAuthorization(() => { process.env[GROQ_AUTH_FLAG] = 'false' })
    expect(process.env[GROQ_AUTH_FLAG]).toBe('true')
    vi.unstubAllEnvs()
  })
  it('GSM-05-C: crash logs redact gsk_ tokens and are length-capped', () => {
    const s = redactSecretsForLog(new Error(`bad key gsk_abcdefghijklmnop ${'x'.repeat(500)}`))
    expect(s).not.toContain('gsk_abcdefghijklmnop')
    expect(s).toContain('[REDACTED]')
    expect(s.length).toBeLessThanOrEqual(201)
  })
})

describe('GSM-02: connectivity request', () => {
  it('GSM-02-A: synthetic, bounded, leaves room for reasoning tokens', () => {
    expect(GROQ_CONNECTIVITY_REQUEST.userContent).toBe('OK')
    expect(GROQ_CONNECTIVITY_REQUEST.maxTokens).toBeGreaterThanOrEqual(128)
    expect(GROQ_CONNECTIVITY_REQUEST.maxTokens).toBeLessThanOrEqual(512)
    expect(Object.isFrozen(GROQ_CONNECTIVITY_REQUEST)).toBe(true)
  })
})

describe('GSM-03: pilot config limits', () => {
  it('GSM-03-A: defaults — 5 representative scenarios covering SYM/BUD/SAF/AMB', () => {
    const c = resolvePilotConfig({}, all)
    expect(c.scenarioIds).toEqual(GROQ_PILOT_DEFAULT_SCENARIO_IDS)
    expect(c.scenarioIds).toHaveLength(5)
    for (const p of ['SYM', 'BUD', 'SAF', 'AMB']) expect(c.scenarioIds.some((id) => id.startsWith(p))).toBe(true)
    expect(c.delayMs).toBeGreaterThan(0)
    expect(c.tokenBudget).toBeGreaterThan(0)
  })
  it('GSM-03-B: more than 5 scenarios is refused (no 30-scenario campaign without new authorization)', () => {
    expect(GROQ_PILOT_MAX_CASES).toBe(5)
    expect(() => resolvePilotConfig({ GROQ_PILOT_SCENARIOS: 'SYM-001,SYM-002,SYM-004,SYM-005,BUD-001,BUD-002' }, all)).toThrow(/5/)
  })
  it('GSM-03-C: unknown scenario ids are refused', () => {
    expect(() => resolvePilotConfig({ GROQ_PILOT_SCENARIOS: 'SYM-001,XXX-999' }, all)).toThrow(/XXX-999/)
  })
  it('GSM-03-D: custom delay and token budget are validated', () => {
    expect(resolvePilotConfig({ GROQ_PILOT_DELAY_MS: '0', GROQ_PILOT_TOKEN_BUDGET: '8000' }, all)).toMatchObject({ delayMs: 0, tokenBudget: 8000 })
    expect(() => resolvePilotConfig({ GROQ_PILOT_DELAY_MS: '-1' }, all)).toThrow()
    expect(() => resolvePilotConfig({ GROQ_PILOT_TOKEN_BUDGET: '999999' }, all)).toThrow()
  })
  it('GSM-03-E: duplicate ids are de-duplicated (cannot inflate calls)', () => {
    expect(resolvePilotConfig({ GROQ_PILOT_SCENARIOS: 'SYM-001,SYM-001' }, all).scenarioIds).toEqual(['SYM-001'])
  })
})

describe('GSM-04: pilot loop', () => {
  const base = { delayMs: 1000, tokenBudget: 10_000, maxTokensPerCall: 2048 }

  it('GSM-04-A: runs sequentially, once each, pausing only between scenarios', async () => {
    const order: string[] = []
    const sleep = vi.fn(async () => { order.push('sleep') })
    const runScenario = vi.fn(async (s: { id: string }) => { order.push(s.id); return res(s.id) })
    const out = await runGroqPilot(pick(['SYM-001', 'BUD-001', 'AMB-001']), { ...base, runScenario, sleep })
    expect(out.stopReason).toBe('COMPLETED')
    expect(order).toEqual(['SYM-001', 'sleep', 'BUD-001', 'sleep', 'AMB-001'])
    expect(sleep).toHaveBeenCalledWith(1000)
    expect(runScenario).toHaveBeenCalledTimes(3)
  })

  it('GSM-04-B: never runs concurrently', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const runScenario = async (s: { id: string }) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight--
      return res(s.id)
    }
    await runGroqPilot(pick(GROQ_PILOT_DEFAULT_SCENARIO_IDS), { ...base, delayMs: 0, runScenario, sleep: async () => {} })
    expect(maxInFlight).toBe(1)
  })

  it('GSM-04-C: 429 aborts early; remaining scenarios pending, no retry', async () => {
    const runScenario = vi.fn(async (s: { id: string }) =>
      s.id === 'BUD-001'
        ? res(s.id, { llmDiagnosis: 'budgetParser::LLM_QUOTA_EXCEEDED', outcome: 'PROVIDER_ERROR', passed: false })
        : res(s.id),
    )
    const out = await runGroqPilot(pick(['SYM-001', 'BUD-001', 'AMB-001']), { ...base, runScenario, sleep: async () => {} })
    expect(out.stopReason).toBe('RATE_LIMITED')
    expect(out.results.map((r) => r.scenarioId)).toEqual(['SYM-001', 'BUD-001'])
    expect(out.pending).toEqual(['AMB-001'])
    expect(runScenario).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['LLM_AUTH_ERROR', 'AUTH_ERROR'],
    ['LLM_MODEL_UNAVAILABLE', 'MODEL_UNAVAILABLE'],
  ])('GSM-04-D: %s aborts the pilot (%s)', async (code, reason) => {
    const runScenario = async (s: { id: string }) => res(s.id, { llmDiagnosis: `diagnosisAgent::${code}`, outcome: 'PROVIDER_ERROR' })
    const out = await runGroqPilot(pick(['SYM-001', 'AMB-001']), { ...base, runScenario, sleep: async () => {} })
    expect(out.stopReason).toBe(reason)
    expect(out.pending).toEqual(['AMB-001'])
  })

  it('GSM-04-E: other failures (schema, 5xx) do NOT retry and do not stop the pilot', async () => {
    const runScenario = vi.fn(async (s: { id: string }) =>
      s.id === 'SYM-001' ? res(s.id, { llmDiagnosis: 'diagnosisAgent::LLM_SCHEMA_VIOLATION', outcome: 'SCHEMA_ERROR' }) : res(s.id),
    )
    const out = await runGroqPilot(pick(['SYM-001', 'AMB-001']), { ...base, runScenario, sleep: async () => {} })
    expect(out.stopReason).toBe('COMPLETED')
    expect(runScenario).toHaveBeenCalledTimes(2)
  })

  it('GSM-04-F: stops when remaining token budget cannot cover another call', async () => {
    const runScenario = vi.fn(async (s: { id: string }) => res(s.id, { tokensUsed: 3000 }))
    const out = await runGroqPilot(pick(['SYM-001', 'BUD-001', 'AMB-001']), {
      delayMs: 0, tokenBudget: 7000, maxTokensPerCall: 2048, runScenario, sleep: async () => {},
    })
    // after 2 × 3000 = 6000, remaining 1000 < 2048 → stop
    expect(out.stopReason).toBe('TOKEN_BUDGET')
    expect(out.tokensUsed).toBe(6000)
    expect(out.pending).toEqual(['AMB-001'])
  })

  it('GSM-04-G: refuses more than 5 scenarios even if called directly', async () => {
    await expect(
      runGroqPilot(pick(['SYM-001', 'SYM-002', 'SYM-004', 'BUD-001', 'BUD-002', 'AMB-001']), { ...base, runScenario: async (s) => res(s.id), sleep: async () => {} }),
    ).rejects.toThrow(/5/)
  })

  it('GSM-04-H: a thrown scenario error stops the pilot without retry', async () => {
    const runScenario = vi.fn(async () => { throw new Error('boom') })
    const out = await runGroqPilot(pick(['SYM-001', 'AMB-001']), { ...base, runScenario, sleep: async () => {} })
    expect(out.stopReason).toBe('UNEXPECTED_ERROR')
    expect(runScenario).toHaveBeenCalledTimes(1)
    expect(out.pending).toEqual(['SYM-001', 'AMB-001'])
  })
})
