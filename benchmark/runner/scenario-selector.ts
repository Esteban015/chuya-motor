import type { BenchmarkScenario } from '../dataset/types'
import type { BenchmarkResult } from './types'

export interface ScenarioSelectionOptions {
  /** Select only scenarios with these exact IDs. Combined with categories via union. */
  ids?: string[]
  /** Select only scenarios from these categories. Combined with ids via union. */
  categories?: string[]
}

export interface ResumeOptions {
  /** When true, skip the completed-scenario filter and re-run everything. Default: false. */
  allowRerun?: boolean
}

/**
 * Selects scenarios from the full dataset based on IDs and/or categories.
 * When no filters are provided, returns all scenarios unchanged.
 * IDs and categories are combined as a union (a scenario matches if either condition is true).
 */
export function selectScenarios(
  all: BenchmarkScenario[],
  options: ScenarioSelectionOptions = {},
): BenchmarkScenario[] {
  if (!options.ids?.length && !options.categories?.length) return all
  const idSet = new Set(options.ids ?? [])
  const categorySet = new Set(options.categories ?? [])
  return all.filter((s) => idSet.has(s.id) || categorySet.has(s.category))
}

/**
 * Filters out already-completed scenarios to allow campaign resume.
 * A scenario is considered "completed" if it appears in completedResults
 * with an outcome other than QUOTA_EXHAUSTED (which means it was not executed).
 *
 * When allowRerun=true, returns the full scenario list unchanged.
 */
export function filterCompleted(
  scenarios: BenchmarkScenario[],
  completedResults: BenchmarkResult[],
  options: ResumeOptions = {},
): BenchmarkScenario[] {
  if (options.allowRerun) return scenarios
  const executedIds = new Set(
    completedResults
      .filter(
        (r) =>
          r.outcome !== 'QUOTA_EXHAUSTED' &&
          !r.error?.includes('QUOTA_EXHAUSTED'),
      )
      .map((r) => r.scenarioId),
  )
  return scenarios.filter((s) => !executedIds.has(s.id))
}
