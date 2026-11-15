/**
 * part-search.ts — PartSearchBuilder (Incremento 7B). Builds a Google search for a part.
 *
 * - Only identifying data: part description (cleaned), part brand / code if given, vehicle make,
 *   model, engine, year and "Argentina". Never the full free text of the quote.
 * - Prices, plates, e-mails and phone numbers are removed from the description; plates and phone
 *   numbers also from the vehicle fields (typed by hand in manual mode).
 * - HTTPS Google search URL built with encodeURIComponent. Chuya Motor never opens, scrapes or
 *   reads the results: the person opens them in a new tab; results are external and unverified.
 */
import type { VehicleInfo } from './types'

export const MAX_QUERY_LENGTH = 160

const PRICE = /\$\s*[\d.,]+|\b\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?\b|\b\d{4,}(?:,\d{1,2})?\b/g
const EMAIL = /\S+@\S+/g
// Argentine plates: old "ABC123", Mercosur "AB123CD"; optional "patente"/"dominio" label.
// Argentine plates: labeled ("patente ABC123", "dominio AB 123 CD") or written in capitals in the
// old "ABC123" / Mercosur "AB123CD" formats. Lower-case alphanumerics are kept (often part codes).
const PLATE_LABELED = /\b(?:patente|dominio)\b\s*:?\s*(?:[a-z]{2,3}\s?\d{3}(?:\s?[a-z]{2})?)?/gi
const PLATE_CAPS = /\b[A-Z]{3}\d{3}\b|\b[A-Z]{2}\d{3}[A-Z]{2}\b/g
const PLATE_MERCOSUR = /\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b/g
const PHONE = /\+?\d[\d\s-]{6,}\d/g
const CONTROL = /[\u0000-\u001f\u007f<>"`]/g

/** Keeps only what identifies the part. */
export function sanitizeSearchTerm(text: string): string {
  return text
    .replace(EMAIL, ' ')
    .replace(PHONE, ' ')
    .replace(PRICE, ' ')
    .replace(PLATE_LABELED, ' ')
    .replace(PLATE_CAPS, ' ')
    .replace(CONTROL, ' ')
    .replace(/[:=$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Vehicle fields and part codes: short identifiers, never prices — only unsafe content removed. */
function sanitizeField(text: string | undefined, max = 40): string {
  return (text ?? '')
    .slice(0, max)
    .replace(EMAIL, ' ')
    .replace(PLATE_LABELED, ' ')
    .replace(CONTROL, ' ')
    .replace(/[^\p{L}\p{N} ./+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Vehicle make / model / engine (7C public pilot): typed by hand in manual mode, so they get the
 * personal-data filters too. Plates in both formats and phone numbers are removed from make and
 * engine; the model keeps the old "ABC123" shape (real models such as CBR600 or XRE300) and only
 * loses Mercosur plates. Part codes are NOT filtered this way (codes may look like plates).
 */
function sanitizeVehicleField(text: string | undefined, kind: 'make' | 'model' | 'engine' | 'year'): string {
  let t = (text ?? '').slice(0, 40).replace(PHONE, ' ')
  t = kind === 'model' ? t.replace(PLATE_MERCOSUR, ' ') : t.replace(PLATE_CAPS, ' ').replace(PLATE_MERCOSUR, ' ')
  return sanitizeField(t)
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim()
}

export interface PartSearchInput {
  description: string
  partBrand?: string
  partCode?: string
  vehicle: VehicleInfo
}

export interface PartSearch {
  query: string
  url: string
}

export function buildPartSearch(input: PartSearchInput): PartSearch {
  const v = input.vehicle
  const tail = [
    sanitizeField(input.partBrand),
    sanitizeField(input.partCode),
    sanitizeVehicleField(v.make, 'make'),
    sanitizeVehicleField(v.model, 'model'),
    sanitizeVehicleField(v.engine, 'engine'),
    sanitizeVehicleField(v.year, 'year'),
  ]
    .filter(Boolean)
    .concat('Argentina')
    .join(' ')
  const budget = Math.max(20, MAX_QUERY_LENGTH - tail.length - 1)
  const part = clip(sanitizeSearchTerm(input.description), budget)
  const query = clip([part, tail].filter(Boolean).join(' '), MAX_QUERY_LENGTH - 'Argentina'.length - 1)
  const finalQuery = query.endsWith('Argentina') ? query : `${query} Argentina`
  return {
    query: finalQuery,
    url: `https://www.google.com/search?q=${encodeURIComponent(finalQuery)}&hl=es-419&gl=ar`,
  }
}
