/**
 * merge.ts — Keeps what the person added (references, brand, code) when a list is edited and
 * parsed again; integer sum of the quoted prices of the current list (Incremento 7B).
 */
import { normalizeForMatch } from './line-parser'
import type { ResearchLine } from './types'

const key = (description: string) => normalizeForMatch(description).replace(/[^a-z0-9]+/g, ' ').trim()

export function mergeLines(previous: readonly ResearchLine[], next: readonly ResearchLine[]): ResearchLine[] {
  const byKey = new Map(previous.map((l) => [key(l.description), l]))
  return next.map((line) => {
    const old = byKey.get(key(line.description))
    if (!old) return line
    byKey.delete(key(line.description))
    return { ...line, references: old.references, partBrand: old.partBrand || line.partBrand, partCode: old.partCode || line.partCode }
  })
}

export function sumWorkshopPrices(lines: readonly ResearchLine[]): { totalMinor: number; pricedLines: number; missingLines: number } {
  let totalMinor = 0
  let pricedLines = 0
  for (const l of lines) {
    if (l.workshopPriceMinor !== null) {
      totalMinor += l.workshopPriceMinor
      pricedLines++
    }
  }
  return { totalMinor, pricedLines, missingLines: lines.length - pricedLines }
}
