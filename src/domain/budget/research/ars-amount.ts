/**
 * ars-amount.ts — Argentine peso amounts as integer minor units (centavos). Deterministic.
 *
 * Accepted: "18000", "18.000", "$ 18.000", "18.000,50", "18000,5", "ARS 4.500".
 * Rejected as ambiguous: "18,000.50" (US format), "18.00" (dot decimals), "12,345" (3 decimals),
 * negatives, exponents and anything above MAX_ARS_MINOR.
 */
import { MAX_AMOUNT_MINOR_UNIT } from '../money'

export const MAX_ARS_MINOR = MAX_AMOUNT_MINOR_UNIT

const AMOUNT = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/

export function parseArsAmount(raw: string): number | null {
  const s = raw.replace(/\$|ars|pesos?|\s/gi, '')
  if (!s || !AMOUNT.test(s)) return null
  const [intPart, decPart = ''] = s.split(',')
  const units = Number(intPart!.replace(/\./g, ''))
  if (!Number.isSafeInteger(units)) return null
  const minor = units * 100 + Number(decPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(minor) || minor > MAX_ARS_MINOR) return null
  return minor
}

/** "$ 18.000,50" — formatted from integers only (no float rounding in the display). */
export function formatArs(minor: number): string {
  if (!Number.isSafeInteger(minor)) return '—'
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const units = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}$ ${grouped},${cents}`
}

/** "+20,0 %" from tenths of a percent. */
export function formatPercentTenths(tenths: number): string {
  const sign = tenths > 0 ? '+' : tenths < 0 ? '−' : ''
  const abs = Math.abs(tenths)
  return `${sign}${Math.floor(abs / 10)},${abs % 10} %`
}
