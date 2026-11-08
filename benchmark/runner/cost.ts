/**
 * Token-based cost estimation.
 *
 * DISCLAIMER: Prices are approximate and may be outdated. Consult
 * https://www.anthropic.com/pricing for current rates before using
 * cost estimates for financial decisions.
 */

export interface ModelPricing {
  inputPer1kTokens: number  // USD
  outputPer1kTokens: number // USD
}

/**
 * Approximate pricing as of late 2025 — not authoritative.
 *
 * WARNING: claude-haiku-4-5-20251001 price is unverified for Haiku 4.5.
 * The values below ($0.25/$1.25 per 1M) are Claude Haiku 3 rates used as a
 * placeholder. Verify at https://www.anthropic.com/pricing before relying on
 * cost estimates for financial decisions.
 *
 * Gemini free-tier models are listed at $0.00 ONLY when using an AI Studio key
 * with the confirmed free tier. If your project has billing enabled, charges apply.
 * Verify at: https://ai.google.dev/gemini-api/docs/rate-limits
 * Cost $0 is NOT confirmed merely by the absence of billing information.
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5-20251001': { inputPer1kTokens: 0.00025, outputPer1kTokens: 0.00125 },
  'claude-sonnet-4-6': { inputPer1kTokens: 0.003, outputPer1kTokens: 0.015 },
  'claude-opus-4-8': { inputPer1kTokens: 0.015, outputPer1kTokens: 0.075 },
  // Gemini free-tier models — $0 ONLY when confirmed AI Studio key + free tier.
  // If billing is enabled on your GCP project, real charges will apply.
  'gemini-3.5-flash-lite': { inputPer1kTokens: 0, outputPer1kTokens: 0 },
  'gemini-2.5-flash': { inputPer1kTokens: 0, outputPer1kTokens: 0 },
  'gemini-2.5-flash-preview-04-17': { inputPer1kTokens: 0, outputPer1kTokens: 0 },
  'gemini-2.0-flash': { inputPer1kTokens: 0, outputPer1kTokens: 0 },
  'gemini-1.5-flash': { inputPer1kTokens: 0, outputPer1kTokens: 0 },
  'gemini-1.5-flash-8b': { inputPer1kTokens: 0, outputPer1kTokens: 0 },
  'deterministic-mock-v1': { inputPer1kTokens: 0, outputPer1kTokens: 0 },
  'stub-v1': { inputPer1kTokens: 0, outputPer1kTokens: 0 },
}

export interface CostEstimate {
  totalTokens: number
  estimatedUsd: number | null
  pricingDisclaimer: string
  unknownModel: boolean
  budgetExceeded: boolean
}

export const COST_DISCLAIMER =
  'Cost estimate is approximate and may be outdated. Consult https://www.anthropic.com/pricing for current rates.'

/** Provider-agnostic disclaimer for campaign reports that may use non-Anthropic models. */
export const CAMPAIGN_COST_DISCLAIMER =
  'Cost estimate is approximate and may be outdated. Consult your model provider\'s pricing page for current rates.'

export function estimateCost(
  totalTokens: number,
  modelId: string,
  budgetLimitTokens?: number,
): CostEstimate {
  const pricing = MODEL_PRICING[modelId]
  const budgetExceeded = budgetLimitTokens !== undefined && totalTokens > budgetLimitTokens

  if (!pricing) {
    return {
      totalTokens,
      estimatedUsd: null,
      pricingDisclaimer: COST_DISCLAIMER,
      unknownModel: true,
      budgetExceeded,
    }
  }

  // Rough split: assume ~50% input, ~50% output for single-turn interactions
  const inputTokens = Math.ceil(totalTokens * 0.5)
  const outputTokens = totalTokens - inputTokens
  const estimatedUsd =
    (inputTokens / 1000) * pricing.inputPer1kTokens +
    (outputTokens / 1000) * pricing.outputPer1kTokens

  return {
    totalTokens,
    estimatedUsd: Math.round(estimatedUsd * 1_000_000) / 1_000_000, // 6 decimal places
    pricingDisclaimer: COST_DISCLAIMER,
    unknownModel: false,
    budgetExceeded,
  }
}

export function getKnownModelIds(): string[] {
  return Object.keys(MODEL_PRICING)
}
