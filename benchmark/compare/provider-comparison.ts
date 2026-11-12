/**
 * Provider comparison — Incremento 6.3, Fase 6.
 *
 * Builds comparable, content-free metric summaries for:
 *   - contemporary runs (BenchmarkResult[] with full AnalyzeOutput in memory), and
 *   - historical persisted campaigns (PersistedCampaign: structural fields only).
 *
 * Principles:
 *   - A structurally valid response is NOT a correct mechanical diagnosis. Content metrics here
 *     are structural proxies; semantic correctness always requires human review.
 *   - A metric that cannot be computed is null ("n/d"), never 0.
 *   - Summaries never contain LLM free text (statements, questions, caveats) — only counts/ratios.
 */
import { z } from 'zod'
import type { BenchmarkScenario } from '../dataset/types'
import type { BenchmarkMode, BenchmarkResult } from '../runner/types'
import type { PersistedCampaign } from '../persist'
import type { AnalyzeOutput } from '@/agents/graph/types'
import { scoreQuality } from '../runner/quality'

/** Below this sample size p95 is not statistically meaningful and is reported as n/d. */
export const P95_MIN_SAMPLE = 20

const RatioSchema = z.object({ num: z.number().int().nonnegative(), den: z.number().int().positive() }).strict()
export type Ratio = z.infer<typeof RatioSchema>

export const ProviderMetricsSchema = z
  .object({
    label: z.string().max(64),
    provider: z.string().max(64),
    model: z.string().max(128),
    mode: z.enum(['mock', 'simulated', 'real']),
    source: z.enum(['contemporary', 'historical']),
    executedAt: z.string().max(64),
    scenarioIds: z.array(z.string().regex(/^[A-Z]{3}-\d{3}$/)).max(100),
    llmCalls: z.number().int().nonnegative(),
    structuredValidity: RatioSchema.nullable(),
    safetyCompliance: RatioSchema.nullable(),
    budgetAccuracy: RatioSchema.nullable(),
    meanQualityScore: z.number().min(0).max(5).nullable(),
    hypothesesPresent: RatioSchema.nullable(),
    appropriateUncertainty: RatioSchema.nullable(),
    workshopQuestions: z
      .object({ withQuestions: RatioSchema, avgPerAnalysis: z.number().nonnegative() })
      .strict()
      .nullable(),
    latency: z
      .object({ p50: z.number().nonnegative().nullable(), p95: z.number().nonnegative().nullable(), n: z.number().int().nonnegative() })
      .strict(),
    tokensPerAnalysis: z.number().nonnegative().nullable(),
    apiErrors: z.record(z.string().regex(/^[A-Z_]{1,64}$/), z.number().int().positive()),
    consistency: RatioSchema.nullable(),
    humanReview: z.number().int().nonnegative(),
  })
  .strict()
export type ProviderMetrics = z.infer<typeof ProviderMetricsSchema>

export interface RunMeta {
  label: string
  provider: string
  model: string
  mode: BenchmarkMode
  executedAt: string
}

/** Validates a metrics file loaded from disk. Rejects unknown fields (e.g. smuggled content). */
export function parseMetricsFile(raw: unknown): ProviderMetrics {
  return ProviderMetricsSchema.parse(raw)
}

// ── Contemporary runs ────────────────────────────────────────────────────────

export function summarizeLiveRun(
  meta: RunMeta,
  results: BenchmarkResult[],
  scenarios: BenchmarkScenario[],
): ProviderMetrics {
  const byId = new Map(scenarios.map((s) => [s.id, s]))
  const executed = results.filter((r) => r.outcome !== 'QUOTA_EXHAUSTED')
  const nonBlocked = executed.filter((r) => !r.output?.safetyBlocked)
  const usable = nonBlocked.filter((r): r is BenchmarkResult & { output: AnalyzeOutput } => !!r.output && !r.output.fallback)

  // Rubric (deterministic, structural) over every produced output.
  const qualityScores = executed
    .filter((r) => r.output && byId.has(r.scenarioId))
    .map((r) => scoreQuality(byId.get(r.scenarioId)!, r.output!).overallScore)

  const symptomWithHyp = usable.filter((r) => r.output.route === 'symptom')
  const uncertaintyPool = symptomWithHyp.filter((r) => r.output.hypotheses.length > 0)
  const questionPool = usable.filter((r) => r.output.route === 'symptom' || r.output.route === 'clarification')
  const totalQuestions = questionPool.reduce((s, r) => s + r.output.questions.length, 0)

  const llmScenarios = executed.filter((r) => (r.realRequestsUsed ?? 0) > 0)

  return {
    ...metaFields(meta, 'contemporary'),
    scenarioIds: results.map((r) => r.scenarioId),
    llmCalls: executed.reduce((s, r) => s + (r.realRequestsUsed ?? 0), 0),
    structuredValidity: ratio(nonBlocked.filter(isStructurallyValid).length, nonBlocked.length),
    safetyCompliance: ratio(executed.filter((r) => r.outcome !== 'FAILED_SAFETY' && r.securityCheck.passed).length, executed.length),
    budgetAccuracy: budgetRatio(executed.map((r) => ({ id: r.scenarioId, passed: r.passed }))),
    meanQualityScore: qualityScores.length > 0 ? round1(mean(qualityScores)) : null,
    hypothesesPresent: ratio(symptomWithHyp.filter((r) => r.output.hypotheses.length > 0).length, symptomWithHyp.length),
    appropriateUncertainty: ratio(
      uncertaintyPool.filter((r) => hasAppropriateUncertainty(r.output, byId.get(r.scenarioId))).length,
      uncertaintyPool.length,
    ),
    workshopQuestions:
      questionPool.length > 0
        ? {
            withQuestions: ratio(questionPool.filter((r) => r.output.questions.length > 0).length, questionPool.length)!,
            avgPerAnalysis: round1(totalQuestions / questionPool.length),
          }
        : null,
    latency: latencyOf(nonBlocked.map((r) => r.durationMs)),
    tokensPerAnalysis: llmScenarios.length > 0 ? Math.round(sum(llmScenarios.map((r) => r.tokensUsed)) / llmScenarios.length) : null,
    apiErrors: countCodes(executed.map((r) => errorCodeOf(r.llmDiagnosis, r.outcome))),
    consistency: null,
    humanReview: executed.filter((r) => r.requiresHumanReview).length,
  }
}

function isStructurallyValid(r: BenchmarkResult): boolean {
  if (!r.output || r.output.fallback) return false
  return r.outcome !== 'SCHEMA_ERROR' && r.outcome !== 'PROVIDER_ERROR' && r.outcome !== 'TIMEOUT'
}

/**
 * Structural proxy for "appropriate uncertainty":
 *   - every 'high' confidence hypothesis carries at least one caveat;
 *   - a coverage disclaimer is present;
 *   - for ambiguous (AMB) scenarios, not every hypothesis is 'high'.
 * Passing this does not mean the uncertainty level is mechanically right.
 */
function hasAppropriateUncertainty(o: AnalyzeOutput, scenario: BenchmarkScenario | undefined): boolean {
  if (o.coverageDisclaimer.trim() === '') return false
  if (o.hypotheses.some((h) => h.confidence === 'high' && h.caveats.length === 0)) return false
  if (scenario?.category === 'ambiguous' &&o.hypotheses.every((h) => h.confidence === 'high')) return false
  return true
}

// ── Historical persisted campaigns ───────────────────────────────────────────

export function summarizePersistedCampaign(label: string, c: PersistedCampaign): ProviderMetrics {
  const executed = c.completed.filter((r) => r.outcome !== 'QUOTA_EXHAUSTED')
  const nonBlocked = executed.filter((r) => !r.safetyBlocked)
  const valid = nonBlocked.filter(
    (r) => !r.fallback && r.outcome !== 'SCHEMA_ERROR' && r.outcome !== 'PROVIDER_ERROR' && r.outcome !== 'TIMEOUT',
  )
  const llmScenarios = executed.filter((r) => r.realRequestsUsed > 0)

  return {
    ...metaFields({ label, provider: c.provider, model: c.model, mode: c.mode, executedAt: c.startedAt }, 'historical'),
    scenarioIds: [...c.completed, ...c.skipped].map((r) => r.scenarioId),
    llmCalls: c.realRequestsUsed,
    structuredValidity: ratio(valid.length, nonBlocked.length),
    safetyCompliance: ratio(executed.filter((r) => r.outcome !== 'FAILED_SAFETY').length, executed.length),
    budgetAccuracy: budgetRatio(executed.map((r) => ({ id: r.scenarioId, passed: r.passed }))),
    // Content-derived metrics were never persisted (by design) → not computable.
    meanQualityScore: null,
    hypothesesPresent: null,
    appropriateUncertainty: null,
    workshopQuestions: null,
    latency: latencyOf(nonBlocked.map((r) => r.durationMs)),
    tokensPerAnalysis: llmScenarios.length > 0 ? Math.round(sum(llmScenarios.map((r) => r.tokensUsed)) / llmScenarios.length) : null,
    apiErrors: countCodes(executed.map((r) => (r.reasonCode?.startsWith('LLM_') ? r.reasonCode : null))),
    consistency: null,
    humanReview: executed.filter((r) => r.humanReviewRequired).length,
  }
}

// ── Consistency ──────────────────────────────────────────────────────────────

/**
 * Fraction of scenarios whose structural signature matches between two runs.
 * Signature: outcome, route, safetyBlocked, fallback, budget status/discrepancy,
 * hypothesis confidence profile and counts. Wording differences are ignored.
 */
export function computeConsistency(a: BenchmarkResult[], b: BenchmarkResult[]): Ratio | null {
  const bById = new Map(b.map((r) => [r.scenarioId, r]))
  const pairs = a.filter((r) => bById.has(r.scenarioId))
  return ratio(pairs.filter((r) => signature(r) === signature(bById.get(r.scenarioId)!)).length, pairs.length)
}

function signature(r: BenchmarkResult): string {
  const o = r.output
  if (!o) return `none|${r.outcome}`
  return JSON.stringify([
    r.outcome,
    o.route,
    o.safetyBlocked,
    o.fallback,
    o.budget?.completenessStatus ?? null,
    o.budget?.discrepancy ?? null,
    o.budget?.computedTotalMinorUnit ?? null,
    o.hypotheses.map((h) => h.confidence),
    o.questions.length > 0,
  ])
}

// ── Markdown report ──────────────────────────────────────────────────────────

export function toComparisonMarkdown(metrics: ProviderMetrics[], generatedAt = new Date().toISOString()): string {
  const header = `| Métrica | ${metrics.map((m) => m.label).join(' | ')} |`
  const sep = `|---|${metrics.map(() => '---').join('|')}|`
  const row = (name: string, f: (m: ProviderMetrics) => string) => `| ${name} | ${metrics.map(f).join(' | ')} |`

  const lines = [
    '# Benchmark comparativo de proveedores LLM — Chuya Motor',
    '',
    `Generado: ${generatedAt}. Dataset sintético, sin datos personales. No contiene texto generado por LLM.`,
    '',
    '> **Advertencia:** una respuesta estructuralmente válida **no implica diagnóstico mecánico correcto**.',
    '> Las métricas de hipótesis, incertidumbre y preguntas son indicadores estructurales; la calidad',
    '> técnica requiere revisión humana de un mecánico.',
    '',
    '## Origen de cada columna',
    '',
    '| Columna | Proveedor / modelo | Modo | Origen | Fecha | Escenarios |',
    '|---|---|---|---|---|---|',
    ...metrics.map(
      (m) =>
        `| ${m.label} | ${m.provider} / \`${m.model}\` | ${m.mode} | ${m.source === 'historical' ? 'Histórico (persistido)' : 'Contemporáneo (esta ejecución)'} | ${m.executedAt} | ${m.scenarioIds.length} (${m.scenarioIds.join(', ')}) |`,
    ),
    '',
    '## Métricas',
    '',
    header,
    sep,
    row('Llamadas reales al LLM', (m) => String(m.llmCalls)),
    row('Validez de respuesta estructurada', (m) => fmtRatio(m.structuredValidity)),
    row('Cumplimiento de políticas de seguridad', (m) => fmtRatio(m.safetyCompliance)),
    row('Exactitud de presupuesto (BUD)', (m) => fmtRatio(m.budgetAccuracy)),
    row('Rúbrica estructural media (0–5)', (m) => (m.meanQualityScore === null ? 'n/d' : m.meanQualityScore.toFixed(1))),
    row('Hipótesis presentes (ruta síntoma)', (m) => fmtRatio(m.hypothesesPresent)),
    row('Incertidumbre apropiada (proxy)', (m) => fmtRatio(m.appropriateUncertainty)),
    row('Análisis con preguntas para el taller', (m) => (m.workshopQuestions ? fmtRatio(m.workshopQuestions.withQuestions) : 'n/d')),
    row('Preguntas promedio por análisis', (m) => (m.workshopQuestions ? String(m.workshopQuestions.avgPerAnalysis) : 'n/d')),
    row('Latencia p50 (ms)', (m) => (m.latency.p50 === null ? 'n/d' : `${Math.round(m.latency.p50)} (n=${m.latency.n})`)),
    row(`Latencia p95 (ms, n≥${P95_MIN_SAMPLE})`, (m) => (m.latency.p95 === null ? `n/d (n=${m.latency.n})` : String(Math.round(m.latency.p95)))),
    row('Tokens por análisis con LLM', (m) => (m.tokensPerAnalysis === null ? 'n/d' : String(m.tokensPerAnalysis))),
    row('Errores de API', (m) => fmtErrors(m.apiErrors)),
    row('Consistencia entre corridas', (m) => fmtRatio(m.consistency)),
    row('Casos que requieren revisión humana', (m) => String(m.humanReview)),
    '',
    '## Notas de interpretación',
    '',
    '- **n/d** = no disponible o no computable (nunca se reporta como 0%).',
    '- Los resultados históricos sólo persisten campos estructurales: las métricas derivadas del contenido no se pueden recalcular.',
    '- El stub es una referencia técnica determinística: su calidad no representa capacidad diagnóstica.',
    `- p95 se omite con menos de ${P95_MIN_SAMPLE} muestras. La latencia del stub es local y no es comparable con la de un proveedor remoto.`,
    '- Los escenarios bloqueados por el Safety Gate no llaman al LLM: la seguridad es determinística e independiente del proveedor.',
    '- La consistencia requiere al menos dos corridas del mismo proveedor sobre los mismos escenarios.',
    '',
  ]
  return lines.join('\n')
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function metaFields(meta: RunMeta, source: ProviderMetrics['source']) {
  return { label: meta.label, provider: meta.provider, model: meta.model, mode: meta.mode, source, executedAt: meta.executedAt }
}

function ratio(num: number, den: number): Ratio | null {
  return den > 0 ? { num, den } : null
}

function budgetRatio(rows: Array<{ id: string; passed: boolean }>): Ratio | null {
  const bud = rows.filter((r) => r.id.startsWith('BUD-'))
  return ratio(bud.filter((r) => r.passed).length, bud.length)
}

function latencyOf(durations: number[]): ProviderMetrics['latency'] {
  const s = [...durations].sort((x, y) => x - y)
  const n = s.length
  return { p50: n > 0 ? percentile(s, 50) : null, p95: n >= P95_MIN_SAMPLE ? percentile(s, 95) : null, n }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo]! + (idx - lo) * (sorted[hi]! - sorted[lo]!)
}

function errorCodeOf(llmDiagnosis: string | null, outcome: BenchmarkResult['outcome']): string | null {
  if (llmDiagnosis) {
    const code = llmDiagnosis.split('::')[1]
    if (code && /^[A-Z_]{1,64}$/.test(code)) return code
  }
  if (outcome === 'TIMEOUT') return 'SCENARIO_TIMEOUT'
  return null
}

function countCodes(codes: Array<string | null>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of codes) if (c) out[c] = (out[c] ?? 0) + 1
  return out
}

function fmtRatio(r: Ratio | null): string {
  if (!r) return 'n/d'
  return `${Math.round((r.num / r.den) * 100)}% (${r.num}/${r.den})`
}

function fmtErrors(e: Record<string, number>): string {
  const entries = Object.entries(e)
  return entries.length === 0 ? '0' : entries.map(([k, v]) => `${k}×${v}`).join(', ')
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const mean = (xs: number[]) => sum(xs) / xs.length
const round1 = (x: number) => Math.round(x * 10) / 10
