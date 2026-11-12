/**
 * Groq quality review runner — Incremento 6.4A (local only, never in CI).
 *
 * Runs the 7 review scenarios (SYM-001, AMB-001, REV-001..REV-005) through the real LangGraph
 * pipeline and writes a human-readable report — INCLUDING LLM-generated text — to the
 * git-ignored folder reviews-local/groq-quality/<runId>/.
 *
 * STUB dry-run (no external calls; validates the tool, not Groq quality):
 *   npm run review:groq
 *
 * REAL run (Git Bash). Both flags must be SESSION variables (values in .env.local are ignored):
 *   GROQ_REAL_LLM_AUTHORIZED=true GROQ_REVIEW_CONTENT_AUTHORIZED=true npm run review:groq
 *
 * Expected real calls: 6 since Safety Gate v1.4.0 (REV-002 is allowed; REV-003 is blocked → 0 calls).
 * 6.4D: prompt v2.0.0 + deterministic quality layer (D-08..D-10) are exercised by this run; new
 * automatic checks INTERNAL_LABEL_LEAK / ABSENCE_AS_FACT / FORMAL_REGISTER. NOT executed in 6.4D:
 * requires explicit authorization (see docs/reviews/groq-production-readiness-6.4d.md §9).
 * Limits: ≤7 scenarios, ≤6 requests (adapter cap, 6.4E), sequential, no retries, abort on
 * 429/auth/model errors, token budget (GROQ_REVIEW_TOKEN_BUDGET, default 15000, max 30000),
 * pause GROQ_REVIEW_DELAY_MS (default 4000). Optional GROQ_REVIEW_SCENARIOS=SYM-001,REV-004.
 * The API key is never printed or written.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { analyzeCase } from '@/agents/graph/analyze-graph'
import { DeterministicMockLLMAdapter } from '@/agents/llm/deterministic-mock-adapter'
import { GroqAdapter, GROQ_DEFAULT_MODEL, GROQ_DEFAULT_MAX_TOKENS } from '@/agents/llm/groq-adapter'
import type { LLMAdapter } from '@/agents/llm/llm-adapter'
import { resolveUserFacingSeverity } from '@/domain/safety/severity-assessor'
import type { AnalyzeInput } from '@/agents/graph/types'
import { getReviewScenarios } from './review-scenarios'
import type { ReviewScenario } from './review-scenarios'
import type { ReviewItemResult } from './review-checks'
import { toReviewMarkdown, resolveReviewOutputDir } from './review-report'
import { redactApiKey } from '../smoke/gemini-connectivity-utils'
import {
  checkGroqRealGuards,
  pinSessionAuthorization,
  redactSecretsForLog,
  readInt,
  runGroqPilot,
  GROQ_AUTH_FLAG,
} from '../smoke/groq-smoke-utils'
import { loadEnvLocal } from '../smoke/load-env-local'

export const REVIEW_CONTENT_FLAG = 'GROQ_REVIEW_CONTENT_AUTHORIZED'
export const REVIEW_MAX_SCENARIOS = 7
/** 6.4E: hard cap of real Groq calls per run (the spec allows at most 6). */
export const REVIEW_MAX_REAL_CALLS = 6

pinSessionAuthorization(loadEnvLocal, [GROQ_AUTH_FLAG, REVIEW_CONTENT_FLAG])

async function main(): Promise<void> {
  console.log('=== Chuya Motor — Groq Quality Review (Incremento 6.4A) ===\n')
  if (process.env['CI']) {
    console.error('ERROR: the quality review runner never runs in CI.')
    process.exit(1)
  }

  const scenarios = selectScenarios(getReviewScenarios(), process.env['GROQ_REVIEW_SCENARIOS'])
  const wantsReal = process.env[GROQ_AUTH_FLAG] === 'true' || process.env[REVIEW_CONTENT_FLAG] === 'true'
  const delayMs = readInt(process.env, 'GROQ_REVIEW_DELAY_MS', 4_000, 0, 60_000)
  const tokenBudget = readInt(process.env, 'GROQ_REVIEW_TOKEN_BUDGET', 15_000, 1, 30_000)
  const maxTokens = readInt(process.env, 'GROQ_MAX_TOKENS', GROQ_DEFAULT_MAX_TOKENS, 1, 8192)

  let adapter: LLMAdapter
  let mode: 'mock' | 'real'
  if (wantsReal) {
    const guard = checkGroqRealGuards(process.env)
    if (!guard.ok) {
      console.error(`Real review NOT executed: ${guard.message}`)
      process.exit(1)
    }
    if (process.env[REVIEW_CONTENT_FLAG] !== 'true') {
      console.error(`Real review NOT executed: set ${REVIEW_CONTENT_FLAG}=true (session) to allow writing LLM text locally.`)
      process.exit(1)
    }
    const model = process.env['GROQ_MODEL'] || GROQ_DEFAULT_MODEL
    console.log(`API key : ${redactApiKey(process.env['GROQ_API_KEY'] ?? '')}`)
    adapter = new GroqAdapter(process.env['GROQ_API_KEY']!, { model, maxTokens, maxRetries: 0, maxRequestsPerRun: REVIEW_MAX_REAL_CALLS })
    mode = 'real'
  } else {
    adapter = new DeterministicMockLLMAdapter()
    mode = 'mock'
    console.log('STUB dry-run (no external calls). For a real Groq review:')
    console.log(`  ${GROQ_AUTH_FLAG}=true ${REVIEW_CONTENT_FLAG}=true npm run review:groq\n`)
  }

  console.log(`Model     : ${adapter.modelId}`)
  console.log(`Scenarios : ${scenarios.map((s) => s.id).join(', ')}`)
  console.log(`Limits    : sequential, no retries, ${mode === 'real' ? `${delayMs}ms pause, ` : ''}token budget ${tokenBudget}\n`)

  const requestsMade = () => ('requestsMade' in adapter ? (adapter as GroqAdapter).requestsMade : 0)
  const outcome = await runGroqPilot<ReviewScenario, ReviewItemResult>(scenarios, {
    maxCases: REVIEW_MAX_SCENARIOS,
    delayMs: mode === 'real' ? delayMs : 0,
    tokenBudget,
    maxTokensPerCall: maxTokens,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    runScenario: async (s) => {
      const r = await runReviewScenario(s, adapter, requestsMade)
      console.log(`  ${s.id}: blocked=${r.output?.safetyBlocked} route=${r.output?.route ?? '-'} banner=${r.severity?.level ?? '-'} calls=${r.llmCalls} tokens=${r.tokensUsed}`)
      return r
    },
  })

  const generatedAt = new Date().toISOString()
  const runId = `${generatedAt.replace(/[:.]/g, '-')}-${mode}`
  const dir = resolveReviewOutputDir(runId)
  mkdirSync(dir, { recursive: true })
  const entries = outcome.results.map((result) => ({ scenario: scenarios.find((s) => s.id === result.scenarioId)!, result }))
  const md = toReviewMarkdown(
    { mode, model: adapter.modelId, generatedAt, realCalls: requestsMade(), tokensUsed: outcome.tokensUsed, stopReason: outcome.stopReason },
    entries,
  )
  writeFileSync(join(dir, 'review.md'), md, 'utf8')

  console.log(`\nStop reason : ${outcome.stopReason}`)
  console.log(`Pending     : ${outcome.pending.join(', ') || '-'}`)
  console.log(`Real calls  : ${requestsMade()} · Tokens: ${outcome.tokensUsed}`)
  console.log(`Report      → ${join(dir, 'review.md')} (git-ignored; contains LLM text)`)
  if (outcome.stopReason !== 'COMPLETED') process.exit(2)
}

async function runReviewScenario(
  s: ReviewScenario,
  adapter: LLMAdapter,
  requestsMade: () => number,
): Promise<ReviewItemResult> {
  const before = requestsMade()
  const start = Date.now()
  const input = {
    caseId: randomUUID(),
    userText: s.userText,
    vehicle: s.vehicle
      ? {
          make: s.vehicle.make ?? 'Unknown',
          model: s.vehicle.model ?? 'Unknown',
          year: s.vehicle.year ?? 2000,
          vehicleType: s.vehicle.vehicleType ?? 'other',
          fuelType: s.vehicle.fuelType ?? 'gasoline',
        }
      : undefined,
    experienceLevel: s.experienceLevel,
    dataLabel: 'synthetic_demo',
  } as AnalyzeInput
  try {
    const output = await analyzeCase(input, { llmAdapter: adapter })
    const traces = output.traces as Array<{ errorCode?: string; nodeId?: string; tokensUsed?: number; schemaIssues?: string[] }>
    const err = traces.find((t) => t.errorCode)
    // 6.4F (D-13): structural codes of the failed / recovered schema constraints (no content).
    const issues = traces.flatMap((t) => t.schemaIssues ?? [])
    return {
      scenarioId: s.id,
      output,
      // Same precedence as POST /api/analyze (route.ts, 6.4B): critical alert on blocked brake loss.
      severity: resolveUserFacingSeverity({ userText: s.userText, safetyBlocked: output.safetyBlocked, route: output.route }),
      durationMs: Date.now() - start,
      tokensUsed: traces.reduce((n, t) => n + (t.tokensUsed ?? 0), 0),
      llmCalls: requestsMade() - before,
      llmDiagnosis: err
        ? `${err.nodeId ?? 'unknown'}::${err.errorCode}${issues.length ? ` [${issues.join(', ')}]` : ''}`
        : issues.length
          ? `normalizado [${issues.join(', ')}]`
          : null,
      error: null,
    }
  } catch (e) {
    return {
      scenarioId: s.id, output: null, severity: null, durationMs: Date.now() - start,
      tokensUsed: 0, llmCalls: requestsMade() - before, llmDiagnosis: null, error: redactSecretsForLog(e),
    }
  }
}

function selectScenarios(all: ReviewScenario[], raw: string | undefined): ReviewScenario[] {
  if (!raw) return all
  const ids = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
  const unknown = ids.filter((id) => !all.some((s) => s.id === id))
  if (unknown.length > 0) throw new Error(`Unknown review scenario ids: ${unknown.join(', ')}`)
  return all.filter((s) => ids.includes(s.id))
}

main().catch((err: unknown) => {
  console.error('QUALITY REVIEW CRASHED:', redactSecretsForLog(err))
  process.exit(1)
})
