/**
 * provider-utils.ts — Shared, defensive helpers for provider adapters (server only).
 */
import { MAX_ARS_MINOR } from '@/domain/budget/research/ars-amount'
import type { DropReason, ProviderDiagnostics, ProviderResult, UnavailableReason } from './types'

export const PROVIDER_TIMEOUT_MS = 4000
export const MAX_RESULTS_PER_QUERY = 10

export function httpFailure(status: number): UnavailableReason {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate_limited'
  return 'provider_error'
}

export function networkFailure(e: unknown): UnavailableReason {
  const name = (e as { name?: string })?.name
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network'
}

export function unavailable(reason: UnavailableReason, startedAt: number, diagnostics?: ProviderDiagnostics): ProviderResult {
  return { status: 'unavailable', reason, offers: [], droppedInvalid: 0, latencyMs: Date.now() - startedAt, ...(diagnostics ? { diagnostics } : {}) }
}

/**
 * Body read/parse failure. The timeout signal also aborts the BODY read: an abort there is a
 * timeout, not a malformed response (first real SerpApi probe, case D: 4021 ms → "bad_response").
 */
export function bodyFailure(e: unknown): UnavailableReason {
  return networkFailure(e) === 'timeout' ? 'timeout' : 'bad_response'
}

export function emptyDiagnostics(httpStatus?: number): ProviderDiagnostics {
  return { ...(httpStatus !== undefined ? { httpStatus } : {}), sourceCounts: {}, rawCount: 0, dropReasons: {}, priceFormats: [], linkHosts: [] }
}

export function countDrop(d: ProviderDiagnostics, reason: DropReason): void {
  d.dropReasons[reason] = (d.dropReasons[reason] ?? 0) + 1
}

const MAX_DIAG_SAMPLES = 3

/** Shape of a display price with all digits masked ("$ 25.000,00" → "$ 99.999,99"). */
export function notePriceFormat(d: ProviderDiagnostics, raw: unknown): void {
  if (typeof raw !== 'string') return
  const masked = raw.replace(/\d/g, '9').replace(/\s+/g, ' ').trim().slice(0, 24)
  if (masked && d.priceFormats.length < MAX_DIAG_SAMPLES && !d.priceFormats.includes(masked)) d.priceFormats.push(masked)
}

/** Hostname only (no path, query or credentials) of a rejected link. */
export function noteLinkHost(d: ProviderDiagnostics, raw: unknown): void {
  if (typeof raw !== 'string') return
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase().slice(0, 80)
  } catch {
    host = '(invalid)'
  }
  if (host && d.linkHosts.length < MAX_DIAG_SAMPLES && !d.linkHosts.includes(host)) d.linkHosts.push(host)
}

/** Provider numbers (e.g. 15000 or 15000.5) → integer centavos, or null. */
export function toMinor(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const minor = Math.round(value * 100)
  return Number.isSafeInteger(minor) && minor <= MAX_ARS_MINOR ? minor : null
}

/** https URL whose host is one of the allowed suffixes; anything else → null. */
export function allowedHttpsUrl(raw: unknown, hostSuffixes: readonly string[]): string | null {
  if (typeof raw !== 'string' || raw.length > 500) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  const host = url.hostname.toLowerCase()
  return hostSuffixes.some((s) => host === s || host.endsWith(`.${s}`)) ? url.toString() : null
}

export function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  return t || null
}
