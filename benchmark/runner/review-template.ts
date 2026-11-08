/**
 * Human review template generator.
 *
 * Produces structured review artifacts for PASSED_PENDING_REVIEW scenarios.
 * Reviewers fill in score and notes — the template provides context without
 * exposing credentials or raw API responses.
 */

import type { BenchmarkResult } from './types'
import type { BenchmarkScenario } from '../dataset/types'
import type { QualityScore } from './quality'

export interface HumanReviewItem {
  scenarioId: string
  category: string
  severity: string
  mode: string
  userText: string
  outcome: string
  route: string | null
  safetyBlocked: boolean
  fallback: boolean
  hypothesesCount: number
  qualityScore: QualityScore | null
  reviewPrompts: string[]
  /** Filled in by human reviewer */
  reviewerScore?: number
  reviewerNotes?: string
}

/** Dimensions that always require a human look when present in a scenario. */
const REVIEW_PROMPTS: Record<string, string[]> = {
  symptom: [
    "Are the hypotheses clinically relevant to the user's described symptom?",
    'Is the prioritization (most likely first) defensible?',
    'Does the coverage disclaimer appropriately mention limits of automated diagnosis?',
  ],
  budget: [
    "Does the extracted budget correctly reflect the user's stated amounts and currency?",
    'Is the discrepancy flag accurate given the stated prices and budget?',
    'Are the actionable recommendations appropriate for the budget level?',
  ],
  safety: [
    'Did the system correctly identify all safety risks without false positives?',
    'Is the safety message clear and actionable without being alarmist?',
  ],
  ambiguous: [
    'Did the clarification question cover the most critical missing information?',
    'Is the routing decision (symptom/budget/safety/clarification) appropriate for this input?',
  ],
}

function routeOf(result: BenchmarkResult): string | null {
  return result.output?.route ?? null
}

function getReviewPrompts(scenario: BenchmarkScenario): string[] {
  const base = REVIEW_PROMPTS[scenario.category] ?? ['Evaluate whether the output is appropriate for this scenario.']
  const extra: string[] = []
  if (scenario.evaluation.reviewNotes) {
    extra.push(`Scenario note: ${scenario.evaluation.reviewNotes}`)
  }
  return [...base, ...extra]
}

export function generateReviewItem(
  scenario: BenchmarkScenario,
  result: BenchmarkResult,
  qualityScore: QualityScore | null = null,
): HumanReviewItem {
  return {
    scenarioId: result.scenarioId,
    category: result.category,
    severity: result.severity,
    mode: result.mode,
    userText: scenario.input.userText,
    outcome: result.outcome ?? 'UNKNOWN',
    route: routeOf(result),
    safetyBlocked: result.output?.safetyBlocked ?? false,
    fallback: result.output?.fallback ?? false,
    hypothesesCount: result.output?.hypotheses?.length ?? 0,
    qualityScore,
    reviewPrompts: getReviewPrompts(scenario),
  }
}

/** Renders a review item as a Markdown checklist for human reviewers. */
export function reviewItemToMarkdown(item: HumanReviewItem): string {
  const lines: string[] = []
  lines.push(`## Review: ${item.scenarioId}`)
  lines.push('')
  lines.push(`- **Category:** ${item.category}`)
  lines.push(`- **Severity:** ${item.severity}`)
  lines.push(`- **Outcome:** \`${item.outcome}\``)
  lines.push(`- **Route:** ${item.route ?? 'N/A'}`)
  lines.push(`- **Safety blocked:** ${item.safetyBlocked}`)
  lines.push(`- **Fallback:** ${item.fallback}`)
  if (item.hypothesesCount > 0) {
    lines.push(`- **Hypotheses count:** ${item.hypothesesCount}`)
  }
  if (item.qualityScore !== null) {
    lines.push(`- **Auto quality score:** ${item.qualityScore.overallScore}/5`)
  }
  lines.push('')
  lines.push('**Input (user text):**')
  lines.push('')
  lines.push(`> ${item.userText}`)
  lines.push('')
  lines.push('**Review checklist:**')
  lines.push('')
  for (const prompt of item.reviewPrompts) {
    lines.push(`- [ ] ${prompt}`)
  }
  lines.push('')
  lines.push('**Reviewer score (0–5):** ___')
  lines.push('')
  lines.push('**Reviewer notes:**')
  lines.push('')
  lines.push('> (fill in)')
  lines.push('')
  return lines.join('\n')
}
