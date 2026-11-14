/**
 * Offline summary of a saved parts pricing probe report (Incremento 7C pilot). NO network.
 *   npx tsx benchmark/smoke/parts-pricing-audit-report.ts reviews-local/parts-pricing/<file>.json [...]
 * Reports created before the audit mode (14/11/2026 17:47 and earlier) have no discarded titles:
 * they are listed as "not captured" — nothing is reconstructed or invented.
 */
import { readFileSync } from 'node:fs'

interface Report {
  case: { id: string; description: string }
  query?: string
  item?: {
    status: string
    offers: Array<{ offer: { title: string; merchant: string; priceMinor: number }; match: { decision: string; reasons: string[] } }>
    discarded: number
    droppedInvalid?: number
    discardReasons?: Record<string, number>
    audit?: {
      discarded: Array<{ title: string; reasons: string[]; possibleFalseDiscard: boolean; reviewHint?: string }>
      dropped: Array<{ title: string; reason: string }>
      duplicates: { count: number; titles: string[] }
    }
  }
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.log('Usage: npx tsx benchmark/smoke/parts-pricing-audit-report.ts <report.json> [...]')
  process.exit(1)
}
for (const f of files) {
  const rows = JSON.parse(readFileSync(f, 'utf8')) as Report[]
  for (const r of rows) {
    const it = r.item
    console.log(`\n=== ${r.case.id} · ${r.query ?? r.case.description} · ${it?.status ?? '-'}`)
    if (!it) continue
    console.log(`kept=${it.offers.length} discarded=${it.discarded} ${JSON.stringify(it.discardReasons ?? {})} dropped=${it.droppedInvalid ?? 0}`)
    for (const o of it.offers) console.log(`  + [${o.match.decision}] ${o.offer.title} · ${o.offer.merchant}`)
    if (!it.audit) {
      console.log('  (discarded / dropped titles not captured in this report — run the probe again with authorization)')
      continue
    }
    for (const d of it.audit.discarded) console.log(`  - ${d.possibleFalseDiscard ? `? [${d.reviewHint}]` : '·'} ${d.title} · ${d.reasons.join(',')}`)
    for (const d of it.audit.dropped) console.log(`  x [${d.reason}] ${d.title}`)
    console.log(`  duplicates: ${it.audit.duplicates.count}${it.audit.duplicates.titles.length ? ` (${it.audit.duplicates.titles.join(' | ')})` : ''}`)
  }
}
