/**
 * format.ts — Presentation helpers for the redesigned result views (Incremento 6.6). UI only:
 * no calculation here replaces the server's deterministic budget calculator.
 */
import type { ClientBudgetOutput } from '@/app/api/analyze/schema'

/** Argentine money format from minor units: ARS → "$ 12.500,00", USD → "US$ 12.500,00". */
export function formatMoney(minorUnit: number, currency: string | null): string {
  const amount = minorUnit / 100
  const number = amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (currency === 'ARS') return `$ ${number}`
  if (currency === 'USD') return `US$ ${number}`
  return currency ? `${number} ${currency}` : number
}

export const BUDGET_STATUS_LABEL: Record<ClientBudgetOutput['completenessStatus'], string> = {
  COMPLETE: 'Completo',
  PARTIAL: 'Parcial',
  INVALID: 'No se pudo verificar',
}

export const CONFIDENCE_LABEL = { low: 'baja', medium: 'media', high: 'alta' } as const

/**
 * Parses an Argentine amount written by the person: "12.500", "12500", "12.500,50", "$ 12.500".
 * Returns minor units, or null when the text is ambiguous.
 */
export function parseArgentineAmount(raw: string): number | null {
  const s = raw.replace(/\$|ars|\s/gi, '')
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null
  const [int, dec = ''] = s.split(',')
  const units = Number(int!.replace(/\./g, ''))
  if (!Number.isSafeInteger(units)) return null
  return units * 100 + Number(dec.padEnd(2, '0'))
}

/**
 * Declared total as written in the person's own text, ONLY when it is unambiguous: exactly one
 * line starting with "Total" and a parsable amount. Used solely to SHOW the declared figure and
 * the difference next to the server's result — and only when it agrees with the server's own
 * discrepancy flag (see budgetComparison). Never replaces the server calculation.
 */
export function declaredTotalFromText(text: string): number | null {
  const lines = text.split(/\r?\n/).filter((l) => /^\s*total\b/i.test(l))
  if (lines.length !== 1) return null
  const m = /^\s*total\b[^:=\d$]*[:=]?\s*(.+)$/i.exec(lines[0]!)
  return m ? parseArgentineAmount(m[1]!.trim()) : null
}

export type BudgetComparison =
  | { kind: 'match'; declared: number | null }
  | { kind: 'mismatch'; declared: number | null; difference: number | null }
  | { kind: 'no_declared_total' }
  | { kind: 'unknown' }

/**
 * Combines the server's discrepancy flag (authoritative) with the declared total read from the
 * text. Amounts are shown only if they are consistent with the server; otherwise only the
 * server's verdict is shown.
 */
export function budgetComparison(budget: ClientBudgetOutput, submittedText: string): BudgetComparison {
  if (budget.discrepancy === null) return budget.computedTotalMinorUnit === null ? { kind: 'unknown' } : { kind: 'no_declared_total' }
  const computed = budget.computedTotalMinorUnit
  const declared = declaredTotalFromText(submittedText)
  const consistent = declared !== null && computed !== null && (declared !== computed) === budget.discrepancy
  if (!budget.discrepancy) return { kind: 'match', declared: consistent ? declared : null }
  return {
    kind: 'mismatch',
    declared: consistent ? declared : null,
    difference: consistent ? declared! - computed! : null,
  }
}
