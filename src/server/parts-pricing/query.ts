/**
 * query.ts — Provider query from identifying data only (part, brand, code, vehicle). Reuses the 7B
 * PartSearchBuilder sanitizers: prices, plates, e-mails and phone numbers never leave the server.
 */
import { buildPartSearch } from '@/domain/budget/research/part-search'
import type { PriceQuery } from './types'

export function buildProviderQuery(q: PriceQuery): string {
  const { query } = buildPartSearch({ description: q.description, partBrand: q.partBrand, partCode: q.partCode, vehicle: q.vehicle })
  // Providers are already scoped to Argentina (site MLA / gl=ar): drop the trailing country word.
  return query.replace(/\s*Argentina$/, '').trim()
}
