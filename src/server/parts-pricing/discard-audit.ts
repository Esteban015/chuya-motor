/**
 * discard-audit.ts — Local audit of discarded / dropped results (Incremento 7C pilot). SERVER ONLY.
 *
 * Used ONLY by the opt-in probe script (benchmark/smoke/parts-pricing-probe.ts) to review the
 * matching rules offline. Never part of the API response, never cached, never logged.
 * Content: public listing titles, merchants and rule codes. No API key, no request URL, no data
 * about the person (the query is built from part + vehicle only).
 *
 * "Possible false discard" is a REVIEW HINT, not a verdict: a discard whose only reason could be a
 * wording gap rather than evidence of a different product. It never changes what users see.
 */
import { normalizeForMatch } from '@/domain/budget/research/line-parser'
import { headNounPresent, type MatchResult } from './matching'
import type { DropReason, PriceOffer, PriceQuery } from './types'

if (typeof window !== 'undefined') throw new Error('parts-pricing is server-only')

export type ReviewHint = 'qualifier_wording' | 'engine_only' | 'year_only' | 'position_only' | 'vehicle_only'

export interface DiscardAudit {
  discarded: Array<{ title: string; merchant: string; reasons: string[]; possibleFalseDiscard: boolean; reviewHint?: ReviewHint }>
  /** Results the adapter dropped before matching (price / link / merchant validation). */
  dropped: Array<{ title: string; reason: DropReason }>
  /** Listings sharing the same normalized title (count of extra copies) and the titles involved. */
  duplicates: { count: number; titles: string[] }
}

const SINGLE_REASON_HINT: Record<string, ReviewHint> = {
  engine_mismatch: 'engine_only',
  year_mismatch: 'year_only',
  position_mismatch: 'position_only',
  vehicle_mismatch: 'vehicle_only',
}

function hintFor(query: PriceQuery, offer: PriceOffer, match: MatchResult): ReviewHint | undefined {
  if (match.reasons.length !== 1) return undefined
  const only = match.reasons[0]!
  // Same head noun ("Manguera ...") but the qualifiers are worded differently ("descarga" vs "respiración").
  if (only === 'part_type_mismatch') return headNounPresent(query.description, offer.title) ? 'qualifier_wording' : undefined
  return SINGLE_REASON_HINT[only]
}

const titleKey = (t: string) => normalizeForMatch(t).replace(/[^a-z0-9]+/g, ' ').trim()

export function buildDiscardAudit(
  query: PriceQuery,
  evaluated: Array<{ offer: PriceOffer; match: MatchResult }>,
  dropped: Array<{ title: string; reason: DropReason }> = [],
): DiscardAudit {
  const discarded = evaluated
    .filter((e) => e.match.decision === 'discard')
    .map((e) => {
      const hint = hintFor(query, e.offer, e.match)
      return { title: e.offer.title, merchant: e.offer.merchant, reasons: e.match.reasons, possibleFalseDiscard: hint !== undefined, ...(hint ? { reviewHint: hint } : {}) }
    })
  const groups = new Map<string, string[]>()
  for (const { offer } of evaluated) {
    const k = titleKey(offer.title)
    groups.set(k, [...(groups.get(k) ?? []), offer.title])
  }
  const dup = [...groups.values()].filter((g) => g.length > 1)
  return {
    discarded,
    dropped,
    duplicates: { count: dup.reduce((n, g) => n + g.length - 1, 0), titles: dup.map((g) => g[0]!) },
  }
}
