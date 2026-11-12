/**
 * Groq opt-in smoke & pilot — pure core (Incremento 6.3, Fase 7).
 *
 * No I/O and no top-level side effects: the CLI scripts (groq-connectivity.ts, groq-pilot.ts)
 * import from here so the guard and loop logic is unit-tested without real Groq calls.
 */
import type { LLMCompletionRequest } from '../../src/agents/llm/llm-adapter'
import type { BenchmarkScenario } from '../dataset/types'
import type { BenchmarkResult } from '../runner/types'

type Env = Partial<Record<string, string | undefined>>

export const GROQ_AUTH_FLAG = 'GROQ_REAL_LLM_AUTHORIZED'

/** Hard ceiling for this increment. Running more requires a code change + new authorization. */
export const GROQ_PILOT_MAX_CASES = 5

/**
 * Same 5 scenarios as the historical Gemini pilot (Fase 5D.2) so results are comparable.
 * SAF-001 is blocked by the Safety Gate → 4 real LLM calls expected (SYM-003 allowed since
 * Safety Gate v1.4.0 / 6.4C; it was blocked, and the pilot made 3 calls, before).
 */
export const GROQ_PILOT_DEFAULT_SCENARIO_IDS: readonly string[] = Object.freeze([
  'SYM-001',
  'SYM-003',
  'BUD-001',
  'SAF-001',
  'AMB-001',
])

export const GROQ_PILOT_DEFAULT_DELAY_MS = 4_000
export const GROQ_PILOT_MAX_DELAY_MS = 60_000
export const GROQ_PILOT_DEFAULT_TOKEN_BUDGET = 12_000
export const GROQ_PILOT_MAX_TOKEN_BUDGET = 30_000

/**
 * Synthetic connectivity request. gpt-oss is a reasoning model: reasoning tokens count against
 * max_completion_tokens even with include_reasoning=false, so 32 tokens (Gemini's value) would
 * truncate. 256 leaves room for low-effort reasoning plus the one-word answer.
 */
export const GROQ_CONNECTIVITY_REQUEST: LLMCompletionRequest = Object.freeze({
  system: 'Responde únicamente con la palabra OK.',
  userContent: 'OK',
  maxTokens: 256,
  timeoutMs: 20_000,
})

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: 'CI' | 'NO_KEY' | 'NOT_AUTHORIZED'; message: string }

/** All real Groq calls pass through this check. Only server-side vars are read. */
export function checkGroqRealGuards(env: Env): GuardResult {
  if (env['CI']) {
    return { ok: false, reason: 'CI', message: 'Real Groq calls are blocked in CI environments.' }
  }
  if (!env['GROQ_API_KEY']) {
    return { ok: false, reason: 'NO_KEY', message: 'GROQ_API_KEY is not set (server-side .env.local).' }
  }
  if (env[GROQ_AUTH_FLAG] !== 'true') {
    return {
      ok: false,
      reason: 'NOT_AUTHORIZED',
      message: `Real call not authorized. Set ${GROQ_AUTH_FLAG}=true as a session variable.`,
    }
  }
  return { ok: true }
}

/**
 * Runs an env loader (e.g. .env.local) while keeping the authorization flag exactly as it was
 * in the session: a value written by the loader is discarded. Uses delete (not `= undefined`,
 * which Node would store as the string "undefined").
 */
export function pinSessionAuthorization(loader: () => void, flags: readonly string[] = [GROQ_AUTH_FLAG]): void {
  const before = flags.map((f) => [f, process.env[f]] as const)
  loader()
  for (const [flag, value] of before) {
    if (value !== undefined) process.env[flag] = value
    else delete process.env[flag]
  }
}

/** Safe one-line representation of an unexpected error for console output. */
export function redactSecretsForLog(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  const out = msg.replace(/gsk_[A-Za-z0-9_-]{6,}/g, '[REDACTED]')
  return out.length > 200 ? `${out.slice(0, 200)}…` : out
}

export interface PilotConfig {
  scenarioIds: string[]
  delayMs: number
  tokenBudget: number
}

export function resolvePilotConfig(env: Env, allScenarios: BenchmarkScenario[]): PilotConfig {
  const raw = env['GROQ_PILOT_SCENARIOS']
  const requested = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [...GROQ_PILOT_DEFAULT_SCENARIO_IDS]
  const scenarioIds = [...new Set(requested)]

  if (scenarioIds.length === 0) throw new Error('GROQ_PILOT_SCENARIOS is empty.')
  if (scenarioIds.length > GROQ_PILOT_MAX_CASES) {
    throw new Error(
      `Groq pilot is limited to ${GROQ_PILOT_MAX_CASES} scenarios (got ${scenarioIds.length}). ` +
        'A larger campaign requires additional explicit authorization.',
    )
  }
  const known = new Set(allScenarios.map((s) => s.id))
  const unknown = scenarioIds.filter((id) => !known.has(id))
  if (unknown.length > 0) throw new Error(`Unknown scenario ids: ${unknown.join(', ')}`)

  return {
    scenarioIds,
    delayMs: readInt(env, 'GROQ_PILOT_DELAY_MS', GROQ_PILOT_DEFAULT_DELAY_MS, 0, GROQ_PILOT_MAX_DELAY_MS),
    tokenBudget: readInt(env, 'GROQ_PILOT_TOKEN_BUDGET', GROQ_PILOT_DEFAULT_TOKEN_BUDGET, 1, GROQ_PILOT_MAX_TOKEN_BUDGET),
  }
}

export function readInt(env: Env, name: string, def: number, min: number, max: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return def
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${name}="${raw}". Expected an integer in [${min}, ${max}].`)
  }
  return n
}

export type PilotStopReason =
  | 'COMPLETED'
  | 'RATE_LIMITED'
  | 'AUTH_ERROR'
  | 'MODEL_UNAVAILABLE'
  | 'TOKEN_BUDGET'
  | 'UNEXPECTED_ERROR'

/** Minimal shapes the loop needs — satisfied by BenchmarkScenario/BenchmarkResult and review items. */
export interface PilotItem {
  id: string
}
export interface PilotItemResult {
  tokensUsed: number
  llmDiagnosis: string | null
}

export interface PilotOptions<S extends PilotItem = BenchmarkScenario, R extends PilotItemResult = BenchmarkResult> {
  /** Hard cap on items; defaults to GROQ_PILOT_MAX_CASES (5). */
  maxCases?: number
  delayMs: number
  tokenBudget: number
  /** Per-call max_completion_tokens; a new scenario starts only if this still fits in the budget. */
  maxTokensPerCall: number
  runScenario: (scenario: S) => Promise<R>
  sleep: (ms: number) => Promise<void>
}

export interface PilotOutcome<R extends PilotItemResult = BenchmarkResult> {
  results: R[]
  pending: string[]
  stopReason: PilotStopReason
  tokensUsed: number
  /** Safe, code-only detail when stopped by an unexpected error. */
  stopDetail: string | null
}

const ABORTING_CODES: Array<[string, PilotStopReason]> = [
  ['LLM_QUOTA_EXCEEDED', 'RATE_LIMITED'],
  ['LLM_AUTH_ERROR', 'AUTH_ERROR'],
  ['LLM_MODEL_UNAVAILABLE', 'MODEL_UNAVAILABLE'],
]

/**
 * Sequential pilot loop. Each scenario runs at most once (no retries).
 * Aborts early on 429 / auth / model errors or when the token budget can't cover another call.
 */
export async function runGroqPilot<S extends PilotItem = BenchmarkScenario, R extends PilotItemResult = BenchmarkResult>(
  scenarios: S[],
  opts: PilotOptions<S, R>,
): Promise<PilotOutcome<R>> {
  const maxCases = opts.maxCases ?? GROQ_PILOT_MAX_CASES
  if (scenarios.length > maxCases) {
    throw new Error(`Groq run is limited to ${maxCases} scenarios (got ${scenarios.length}).`)
  }

  const results: R[] = []
  let tokensUsed = 0
  const pendingFrom = (i: number) => scenarios.slice(i).map((s) => s.id)

  for (let i = 0; i < scenarios.length; i++) {
    if (opts.tokenBudget - tokensUsed < opts.maxTokensPerCall) {
      return { results, pending: pendingFrom(i), stopReason: 'TOKEN_BUDGET', tokensUsed, stopDetail: null }
    }
    if (i > 0 && opts.delayMs > 0) await opts.sleep(opts.delayMs)

    let r: R
    try {
      r = await opts.runScenario(scenarios[i]!)
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error'
      return { results, pending: pendingFrom(i), stopReason: 'UNEXPECTED_ERROR', tokensUsed, stopDetail: name }
    }
    results.push(r)
    tokensUsed += r.tokensUsed

    const abort = ABORTING_CODES.find(([code]) => r.llmDiagnosis?.includes(code))
    if (abort) {
      return { results, pending: pendingFrom(i + 1), stopReason: abort[1], tokensUsed, stopDetail: null }
    }
  }
  return { results, pending: [], stopReason: 'COMPLETED', tokensUsed, stopDetail: null }
}
