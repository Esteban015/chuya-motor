/**
 * matching.ts — Deterministic match evaluation between a requested part and a provider offer.
 *
 * It NEVER asserts compatibility. Outcomes:
 *   discard      — evidence of a different product: other part type or position, explicit other
 *                  engine, year range that excludes the vehicle, different part number, used or
 *                  refurbished.
 *   needs_review — no contrary evidence but not enough data (model / year / presentation unknown,
 *                  presentation differs).
 *   candidate    — part type, model, year (when stated) and engine (when stated) agree. Still NOT
 *                  "compatible": the person (or the workshop) confirms.
 * comparable (arithmetic difference allowed without asking) only when the offer's part number
 * equals the part code of the quote and nothing contradicts it — labeled as a code match.
 */
import { normalizeForMatch } from '@/domain/budget/research/line-parser'
import type { PriceOffer, PriceQuery } from './types'

type Signal = 'match' | 'mismatch' | 'unknown'

export interface MatchResult {
  decision: 'candidate' | 'needs_review' | 'discard'
  comparable: boolean
  reasons: string[]
  signals: {
    partCode: Signal
    partType: Signal
    model: Signal
    year: Signal
    engine: Signal
    presentation: Signal
    /** unverified = the request has no position but the listing names one (front / rear...). */
    position: Signal | 'unverified'
    condition: PriceOffer['condition']
  }
}

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'y', 'x', 'con', 'en', 'un', 'una', 'repuesto', 'original'])
const POSITION = /\b(delante\w*|traser\w*|izquierd\w*|derech\w*)\b/g
/** Housings, covers, brackets... of the part are other products (real case: "Carcaza Filtro De Aire"). */
const ACCESSORY = /\b(carcaza|carcasa|tapa|soporte|portafiltro|caja|abrazadera)\b/
/** Body / trim variants written right after the model ("Palio Weekend", "Palio W.end", "PALIO WE"). */
const VARIANT = String.raw`(weekend|w\.?\s?end|we|adventure|locker|trekking)`
const alnum = (s: string) => normalizeForMatch(s).replace(/[^a-z0-9]/g, '')
const stem = (t: string) => t.slice(0, 6)

function tokens(text: string): string[] {
  return normalizeForMatch(text)
    .replace(/carcaza/g, 'carcasa') // common spelling in listings
    .replace(POSITION, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t))
}

/** The first meaningful word of the request (the part's head noun) appears in the title. Audit only. */
export function headNounPresent(description: string, title: string): boolean {
  const want = tokens(description)
  return want.length > 0 && new Set(tokens(title).map(stem)).has(stem(want[0]!))
}

function partTypeSignal(description: string, title: string): Signal {
  const want = tokens(description)
  if (want.length === 0) return 'unknown'
  const have = new Set(tokens(title).map(stem))
  if (!have.has(stem(want[0]!))) return 'mismatch'
  const qualifiers = want.slice(1)
  if (qualifiers.length === 0) return 'match'
  const hits = qualifiers.filter((t) => have.has(stem(t))).length
  return hits * 2 >= qualifiers.length ? 'match' : 'mismatch'
}

function positionSignal(description: string, title: string): Signal | 'unverified' {
  const want = normalizeForMatch(description).match(POSITION)?.map((p) => p.slice(0, 5)) ?? []
  const got = normalizeForMatch(title).match(POSITION)?.map((p) => p.slice(0, 5)) ?? []
  if (want.length === 0 && got.length > 0) return 'unverified'
  if (want.length === 0 || got.length === 0) return 'unknown'
  return want.some((w) => got.includes(w)) ? 'match' : 'mismatch'
}

function yearSignal(year: string | undefined, title: string): Signal | 'unverified' {
  const y = Number(year)
  if (!year || !Number.isInteger(y)) return 'unknown'
  const CLOSED = /\b((?:19|20)\d{2})\s*(?:-|\/|a|al|hasta)\s*((?:19|20)\d{2})\b/g
  // Open ranges seen in real listings: "1997+", "2013/", "2012 en adelante", "desde 2012".
  const OPEN = /\b((?:19|20)\d{2})\s*(?:\+|\/|en adelante|>)|\bdesde\s+((?:19|20)\d{2})\b/g
  let t = normalizeForMatch(title)
  const ranges: Array<readonly [number, number]> = [...t.matchAll(CLOSED)].map((m) => [Number(m[1]), Number(m[2])] as const)
  t = t.replace(CLOSED, ' ')
  for (const m of t.matchAll(OPEN)) ranges.push([Number(m[1] ?? m[2]), 9999] as const)
  t = t.replace(OPEN, ' ')
  const singles = [...t.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1]))
  if (ranges.length === 0 && singles.length === 0) return 'unknown'
  if (ranges.some(([a, b]) => y >= Math.min(a, b) && y <= Math.max(a, b)) || singles.includes(y)) return 'match'
  // Only an explicit range that excludes the year is evidence of incompatibility. A lone year
  // ("Palio 2012", "desde 2012", a model-year mention) is not: the same part often fits many
  // years. That is "unverified" → needs_review, never a discard.
  return ranges.length > 0 ? 'mismatch' : 'unverified'
}

/** Vehicle makes sold in Argentina — used only to detect listings for OTHER vehicles. */
const MAKES = /\b(fiat|chevrolet|chevy|gm|ford|volkswagen|vw|renault|peugeot|citroen|toyota|honda|nissan|jeep|hyundai|kia|chery|suzuki|mitsubishi|dodge|chrysler|ram|audi|bmw|mercedes|ds|baic|jac|geely|byd)\b/g

/** Makes named in the title other than the requested one. */
function otherMakes(make: string | undefined, title: string): string[] {
  const want = make ? normalizeForMatch(make).trim() : ''
  const aliases = want === 'volkswagen' || want === 'vw' ? ['volkswagen', 'vw'] : want === 'chevrolet' || want === 'gm' ? ['chevrolet', 'chevy', 'gm'] : [want]
  return [...new Set(normalizeForMatch(title).match(MAKES) ?? [])].filter((m) => !aliases.includes(m))
}

/** A body / trim variant of the requested model that the person did not state. */
function modelVariant(model: string | undefined, title: string): boolean {
  if (!model) return false
  const m = normalizeForMatch(model).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, String.raw`\s+`)
  return new RegExp(String.raw`\b${m}\s*${VARIANT}(?![a-z])`).test(normalizeForMatch(title))
}

/**
 * Displacement like "1.4", "1,4" — also glued to a suffix ("1.7td", "1.4fire", "1,4evo"), which
 * real listings use (pilot 14/11/2026: "Manguera Descarga Gases 1.7td Palio/siena/str").
 * Not part of a longer number ("11.45", "2.000").
 */
const DISPLACEMENT = /(?<![\d.,])(\d[.,]\d)(?![\d])/g
/** Diesel markers in Argentine listings: TD / TDI / JTD / Multijet / Diesel ("1.7td", "1.3 JTD"). */
const DIESEL = /(?:\d[.,]\d|\b)(td|tdi|jtd|multijet|mjet|diesel|turbodiesel)\b/

function engineSignal(engine: string | undefined, title: string): Signal {
  const want = engine?.match(/\d[.,]\d/)?.[0]?.replace(',', '.')
  if (!want) return 'unknown'
  const got = [...normalizeForMatch(title).matchAll(DISPLACEMENT)].map((m) => m[1]!.replace(',', '.'))
  if (got.length === 0) return 'unknown'
  return got.includes(want) ? 'match' : 'mismatch'
}

/**
 * Fuel: only when the person STATED an engine. A diesel listing for a stated non-diesel engine is
 * a confirmed incompatibility when no displacement in the title matches; if the title also lists
 * the requested displacement (multi-engine listing) it is only "unverified".
 */
function fuelSignal(engine: string | undefined, title: string, engineSig: Signal): 'ok' | 'mismatch' | 'unverified' {
  if (!engine || DIESEL.test(normalizeForMatch(engine))) return 'ok'
  if (!DIESEL.test(normalizeForMatch(title))) return 'ok'
  return engineSig === 'match' ? 'unverified' : 'mismatch'
}

function presentationSignal(requested: PriceQuery['presentation'], quantity: number, title: string): Signal {
  const t = normalizeForMatch(title)
  const multi = t.match(/\bx\s?(\d{1,2})\b|\b(\d{1,2})\s?(?:unidades|u)\b/)
  const offered = /\bjuego\b|\bset\b/.test(t) ? 'set' : /\bkit\b/.test(t) ? 'kit' : /\bpar\b/.test(t) ? 'pair' : multi ? 'unit-multi' : null
  if (offered === null) return 'unknown'
  if (offered === 'unit-multi') return requested === 'unit' && Number(multi![1] ?? multi![2]) === quantity ? 'match' : 'mismatch'
  return offered === requested ? 'match' : 'mismatch'
}

export function evaluateMatch(query: PriceQuery, offer: PriceOffer): MatchResult {
  const reasons: string[] = []
  const title = offer.title

  let partCode: Signal = 'unknown'
  if (query.partCode) {
    const want = alnum(query.partCode)
    if (offer.partNumber) partCode = alnum(offer.partNumber) === want ? 'match' : 'mismatch'
    else if (want.length >= 4 && alnum(title).includes(want)) partCode = 'match'
  }

  const typeSig = partTypeSignal(query.description, title)
  const posSig = positionSignal(query.description, title)
  const model = query.vehicle.model ? (normalizeForMatch(title).includes(normalizeForMatch(query.vehicle.model)) ? 'match' : 'unknown') : 'unknown'
  const yearRaw = yearSignal(query.vehicle.year, title)
  const year: Signal = yearRaw === 'unverified' ? 'unknown' : yearRaw
  const engine = engineSignal(query.vehicle.engine, title)
  const presentation = presentationSignal(query.presentation, query.quantity, title)

  if (offer.condition === 'used' || offer.condition === 'refurbished') reasons.push('not_new')
  if (partCode === 'mismatch') reasons.push('part_code_mismatch')
  if (typeSig === 'mismatch' && partCode !== 'match') reasons.push('part_type_mismatch')
  if (posSig === 'mismatch') reasons.push('position_mismatch')
  if (year === 'mismatch') reasons.push('year_mismatch')
  if (engine === 'mismatch') reasons.push('engine_mismatch')
  const fuel = fuelSignal(query.vehicle.engine, title, engine)
  if (fuel === 'mismatch' && engine !== 'mismatch') reasons.push('fuel_mismatch')
  // A housing / cover / bracket of the part is another product unless that is what was asked for.
  const accessory = normalizeForMatch(title).match(ACCESSORY)?.[1]
  if (accessory && !normalizeForMatch(query.description).includes(accessory.slice(0, 5)) && partCode !== 'match') reasons.push('accessory_not_part')
  // A title naming another make and NOT the requested model is a listing for another vehicle
  // (real case: "Pastillas ... Bosch Peugeot 208 1.5 8v 2013/" for a Fiat Palio). A code match wins.
  const foreignMakes = otherMakes(query.vehicle.make, title)
  if (foreignMakes.length > 0 && model !== 'match' && partCode !== 'match') reasons.push('vehicle_mismatch')

  const signals = { partCode, partType: typeSig, model, year, engine, presentation, position: posSig, condition: offer.condition } as MatchResult['signals']

  if (reasons.length > 0) return { decision: 'discard', comparable: false, reasons, signals }

  // A listing that names several makes ("Peugeot 208 / C3 Palio Nuevo") is a fitment claim by the
  // seller, not evidence: it always needs confirmation.
  const multiVehicle = foreignMakes.length > 0
  // "Palio Weekend" / "Palio W.end" for a Palio: same name, different body — needs confirmation.
  const variant = modelVariant(query.vehicle.model, title)
  const candidate = typeSig === 'match' && model === 'match' && presentation !== 'mismatch' && yearRaw !== 'unverified' && !multiVehicle && !variant && fuel !== 'unverified'
  if (multiVehicle) reasons.push('multi_vehicle_listing')
  if (variant) reasons.push('model_variant')
  if (fuel === 'unverified') reasons.push('fuel_unverified')
  if (posSig === 'unverified') reasons.push('position_unverified')
  if (yearRaw === 'unverified') reasons.push('year_unverified')
  if (presentation === 'mismatch') reasons.push('presentation_mismatch')
  if (model !== 'match') reasons.push('model_not_stated')
  if (offer.condition === 'unknown') reasons.push('condition_unknown')

  const comparable = partCode === 'match' && presentation !== 'mismatch' && offer.condition === 'new' && posSig !== 'unverified' && !variant && fuel === 'ok'
  return { decision: candidate ? 'candidate' : 'needs_review', comparable, reasons, signals }
}
