import type { BenchmarkResult, BenchmarkCategorySummary } from './types'
import type { EvaluationOutcome } from './outcome'

export interface LatencyPercentiles {
  p50: number
  p95: number
  max: number
  sampleSize: number
  smallSampleWarning: boolean
}

const SMALL_SAMPLE_THRESHOLD = 5

export function computeLatencyPercentiles(results: BenchmarkResult[]): LatencyPercentiles {
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b)
  const n = durations.length

  if (n === 0) {
    return { p50: 0, p95: 0, max: 0, sampleSize: 0, smallSampleWarning: true }
  }

  const p50 = percentile(durations, 50)
  const p95 = percentile(durations, 95)
  const max = durations[n - 1]!

  return {
    p50,
    p95,
    max,
    sampleSize: n,
    smallSampleWarning: n < SMALL_SAMPLE_THRESHOLD,
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]!
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]!
  const fraction = index - lower
  return sorted[lower]! + fraction * (sorted[upper]! - sorted[lower]!)
}

export function aggregateByCategory(results: BenchmarkResult[]): BenchmarkCategorySummary[] {
  const groups = new Map<string, BenchmarkResult[]>()

  for (const result of results) {
    const existing = groups.get(result.category) ?? []
    existing.push(result)
    groups.set(result.category, existing)
  }

  const summaries: BenchmarkCategorySummary[] = []

  for (const [category, categoryResults] of groups.entries()) {
    const total = categoryResults.length
    const passed = categoryResults.filter((r) => r.passed).length
    const failed = total - passed
    const passRate = total > 0 ? passed / total : 0
    const avgDurationMs =
      total > 0
        ? categoryResults.reduce((sum, r) => sum + r.durationMs, 0) / total
        : 0
    const totalTokens = categoryResults.reduce((sum, r) => sum + r.tokensUsed, 0)

    summaries.push({
      category,
      total,
      passed,
      failed,
      passRate,
      avgDurationMs: Math.round(avgDurationMs),
      totalTokens,
    })
  }

  return summaries.sort((a, b) => a.category.localeCompare(b.category))
}

const ALL_OUTCOMES: EvaluationOutcome[] = [
  'PASSED',
  'PASSED_PENDING_REVIEW',
  'FAILED_STRUCTURAL',
  'FAILED_SAFETY',
  'PROVIDER_ERROR',
  'SCHEMA_ERROR',
  'QUOTA_EXHAUSTED',
  'TIMEOUT',
  'FALLBACK_ACTIVATED',
]

/** Counts results by EvaluationOutcome. Results without an outcome field are ignored. */
export function countByOutcome(results: BenchmarkResult[]): Record<EvaluationOutcome, number> {
  const counts = Object.fromEntries(ALL_OUTCOMES.map((o) => [o, 0])) as Record<EvaluationOutcome, number>
  for (const r of results) {
    if (r.outcome !== undefined) {
      counts[r.outcome]++
    }
  }
  return counts
}
