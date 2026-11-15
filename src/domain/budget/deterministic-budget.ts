/**
 * deterministic-budget.ts — Budget reading that never depends on an LLM (Incremento 7E).
 *
 * Builds on the 7B deterministic line parser (research/line-parser.ts) and the authoritative
 * integer calculator (budget.ts → determineBudgetState). Nothing here sums money on its own except
 * the per-category breakdown, which uses the same integer minor units.
 *
 * Conservative rules (never invent an amount, a quantity or a category):
 *   - An amount is read only after an explicit separator (":", "=" or "$"), Argentine format.
 *   - A line with an unreadable amount, a bare trailing number without separator, or a discount
 *     (sign unknown: maybe already applied) is AMBIGUOUS: shown, never summed → partial sum.
 *   - "A confirmar" / "pendiente" → PENDING; a recognizable item without amount → MISSING.
 *     Both make the sum partial. Unrecognized text without amount (headers, greetings) is a note,
 *     not an item, so it does not turn a complete budget into a partial one.
 *   - Quantities are informative: the written amount is taken as the line amount (never multiplied).
 *   - Unknown concepts stay "unclassified" (never assumed to be parts).
 *   - Several different "Total" lines, or an unreadable one → no declared total (reported).
 *   - Foreign currency markers (USD, U$S, dólares) → this reader declines: ARS only.
 */
import type { BudgetLine, BudgetLineConfirmed } from './budget'
import { parseArsAmount } from './research/ars-amount'
import { classifyDescription, normalizeForMatch, parseResearchLines } from './research/line-parser'
import type { LineCategory, Presentation } from './research/types'

export type BudgetItemStatus = 'priced' | 'pending' | 'missing' | 'ambiguous'
export type BudgetItemIssue = 'unreadable_amount' | 'amount_without_separator' | 'discount_sign' | 'unverified_amount'

export interface BudgetItem {
  /** 1-based position among the non-empty lines of the text (null when it came from the LLM). */
  lineNumber: number | null
  description: string
  category: LineCategory
  quantity: number
  presentation: Presentation
  currency: BudgetLineConfirmed['currency']
  /** Amount as written; present for priced items and for ambiguous discounts (shown, not summed). */
  amountMinorUnit: number | null
  status: BudgetItemStatus
  issue?: BudgetItemIssue
}

export type BudgetNote = 'declared_total_conflict' | 'declared_total_unreadable' | 'lines_truncated' | 'text_not_interpreted'

export interface BudgetTextAnalysis {
  items: BudgetItem[]
  declaredTotalMinorUnit: number | null
  notes: BudgetNote[]
  /** Text lines that were not read as items nor totals (headers, comments). */
  ignoredLineCount: number
  /** The text uses a currency this reader does not handle: the analysis is not usable. */
  foreignCurrency: boolean
}

const FOREIGN_CURRENCY = /\b(usd|u\$s|us\$|dolares?|d[oó]lares?|euros?|eur)\b|u\$s|us\$/i
const DISCOUNT = /\b(descuento|bonificacion|rebaja)\b/
const AMOUNT_AFTER_SEPARATOR = /[:=$]\s*\S*\d/
const BARE_TRAILING_AMOUNT = /(?:^|\s)(?:\d{1,3}(?:\.\d{3})+|\d{3,})(?:,\d{1,2})?\s*$/

export function analyzeBudgetText(text: string): BudgetTextAnalysis {
  const parsed = parseResearchLines(text, { assumeParts: false })
  const unreadable = new Set(parsed.unreadableAmountLines)
  const items: BudgetItem[] = []

  for (const line of parsed.lines) {
    const lineNumber = Number(line.id.slice(1))
    const source = parsed.sourceLines[lineNumber - 1] ?? ''
    const base = {
      lineNumber,
      description: line.description,
      category: line.category,
      quantity: line.quantity,
      presentation: line.presentation,
      currency: 'ARS' as const,
    }
    if (line.workshopPriceMinor !== null) {
      if (DISCOUNT.test(normalizeForMatch(line.description))) {
        items.push({ ...base, amountMinorUnit: line.workshopPriceMinor, status: 'ambiguous', issue: 'discount_sign' })
      } else {
        items.push({ ...base, amountMinorUnit: line.workshopPriceMinor, status: 'priced' })
      }
    } else if (line.pricePending) {
      items.push({ ...base, amountMinorUnit: null, status: 'pending' })
    } else if (unreadable.has(lineNumber) || AMOUNT_AFTER_SEPARATOR.test(source)) {
      items.push({ ...base, amountMinorUnit: null, status: 'ambiguous', issue: 'unreadable_amount' })
    } else if (BARE_TRAILING_AMOUNT.test(source)) {
      items.push({ ...base, amountMinorUnit: null, status: 'ambiguous', issue: 'amount_without_separator' })
    } else if (line.category !== 'unclassified' && !/:\s*$/.test(source)) {
      items.push({ ...base, amountMinorUnit: null, status: 'missing' })
    }
    // else: header / comment → ignored (counted below)
  }

  const notes: BudgetNote[] = []
  const totals = parsed.totalLines
  const readable = [...new Set(totals.map((t) => t.amountMinor).filter((a): a is number => a !== null))]
  let declaredTotalMinorUnit: number | null = null
  if (readable.length > 1) notes.push('declared_total_conflict')
  else if (totals.some((t) => t.amountMinor === null)) notes.push('declared_total_unreadable')
  else declaredTotalMinorUnit = readable[0] ?? null
  if (parsed.truncated) notes.push('lines_truncated')

  const ignoredLineCount = parsed.lines.length - items.length
  if (ignoredLineCount > 0) notes.push('text_not_interpreted')

  return { items, declaredTotalMinorUnit, notes, ignoredLineCount, foreignCurrency: FOREIGN_CURRENCY.test(text) }
}

/** Usable without an LLM: ARS only and at least one priced or explicitly pending item. */
export function hasInterpretableItems(a: BudgetTextAnalysis): boolean {
  return !a.foreignCurrency && a.items.some((i) => i.status === 'priced' || i.status === 'pending')
}

/** Lines for the authoritative calculator: only priced items are "confirmed"; anything else is missing. */
export function toBudgetLines(a: BudgetTextAnalysis): BudgetLine[] {
  return a.items.map((i) =>
    i.status === 'priced' && i.amountMinorUnit !== null
      ? { status: 'confirmed', description: i.description, amountMinorUnit: i.amountMinorUnit, currency: i.currency }
      : { status: 'missing', description: i.description },
  )
}

export interface BudgetBreakdown {
  partMinorUnit: number
  laborMinorUnit: number
  otherMinorUnit: number
  unclassifiedMinorUnit: number
}

/** Integer subtotals of PRICED items by category (ambiguous / missing items are not included). */
export function breakdownByCategory(items: readonly BudgetItem[]): BudgetBreakdown {
  const b: BudgetBreakdown = { partMinorUnit: 0, laborMinorUnit: 0, otherMinorUnit: 0, unclassifiedMinorUnit: 0 }
  for (const i of items) {
    if (i.status !== 'priced' || i.amountMinorUnit === null) continue
    if (i.category === 'part') b.partMinorUnit += i.amountMinorUnit
    else if (i.category === 'labor') b.laborMinorUnit += i.amountMinorUnit
    else if (i.category === 'other') b.otherMinorUnit += i.amountMinorUnit
    else b.unclassifiedMinorUnit += i.amountMinorUnit
  }
  return b
}

/** Every amount written in the text (Argentine format), in minor units — to verify LLM figures. */
export function amountsWrittenIn(text: string): Set<number> {
  const out = new Set<number>()
  for (const m of text.matchAll(/\d[\d.,]*\d|\d/g)) {
    const a = parseArsAmount(m[0])
    if (a !== null) out.add(a)
  }
  return out
}

/**
 * LLM-parsed lines (used only when the deterministic reader finds nothing usable): an amount the
 * LLM reports is kept only if that exact figure is written in the text; otherwise the item is
 * ambiguous and not summed. Same for the declared total. Categories come from the deterministic
 * classifier, never from the LLM.
 */
export function analysisFromLlmLines(text: string, lines: readonly BudgetLine[], declaredTotal: number | null): BudgetTextAnalysis {
  const written = amountsWrittenIn(text)
  const items: BudgetItem[] = lines.map((l) => {
    const base = { lineNumber: null, description: l.description, category: classifyDescription(l.description), quantity: 1, presentation: 'unit' as const }
    if (l.status === 'missing') return { ...base, currency: 'ARS' as const, amountMinorUnit: null, status: 'missing' as const }
    if (!written.has(l.amountMinorUnit)) return { ...base, currency: l.currency, amountMinorUnit: null, status: 'ambiguous' as const, issue: 'unverified_amount' as const }
    return { ...base, currency: l.currency, amountMinorUnit: l.amountMinorUnit, status: 'priced' as const }
  })
  const notes: BudgetNote[] = []
  let declaredTotalMinorUnit = declaredTotal
  if (declaredTotal !== null && !written.has(declaredTotal)) {
    declaredTotalMinorUnit = null
    notes.push('declared_total_unreadable')
  }
  return { items, declaredTotalMinorUnit, notes, ignoredLineCount: 0, foreignCurrency: false }
}
