/**
 * normalize.ts — Normalization rules for the offline catalog ingestion (Incremento 7D.2).
 *
 * Pure functions, no I/O. Registry-style rows (similar in structure to a vehicle registry valuation
 * table: brand, model description with the version text, registry body, years) are normalized
 * WITHOUT inventing anything: engine and fuel are only read from the source's own text (evidence
 * "label"); a missing value stays missing; nafta is never inferred from the absence of a marker.
 */
import { catalogKey, type FuelKind, type VehicleCategory } from '@/domain/vehicle/vehicle-catalog'

/** Uppercase, single spaces, trimmed — the canonical form of registry text. */
export function canonicalText(text: string): string {
  return text.normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim()
}

/** Slug for stable IDs: lowercase, no accents, [a-z0-9-], bounded. */
export function slug(text: string, max = 20): string {
  const s = catalogKey(text)
    .replace(/[ .]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
  return s || 'x'
}

// ── Years ─────────────────────────────────────────────────────────────────────

export interface ParsedYears {
  years: number[] | null
  zeroKm: boolean
  /** Years outside [1900, maxYear] — dropped, reported. */
  invalid: string[]
  /** Tokens that cannot be read unambiguously (e.g. "2015/16", "15") — the record is quarantined. */
  ambiguous: string[]
}

/** "2015-2020", "2015;2017", "0KM;2024-2025", "" (unknown). */
export function parseYears(raw: string, maxYear: number): ParsedYears {
  const out: ParsedYears = { years: null, zeroKm: false, invalid: [], ambiguous: [] }
  const tokens = raw
    .split(/[;,|]/)
    .map((t) => t.trim())
    .filter(Boolean)
  const years = new Set<number>()
  for (const t of tokens) {
    if (/^0\s?KM$/i.test(t)) {
      out.zeroKm = true
      continue
    }
    const range = /^(\d{4})\s*-\s*(\d{4})$/.exec(t)
    const single = /^(\d{4})$/.exec(t)
    if (range) {
      const a = Number(range[1])
      const b = Number(range[2])
      if (a > b || b - a > 80) {
        out.ambiguous.push(t)
        continue
      }
      for (let y = a; y <= b; y++) {
        if (y >= 1900 && y <= maxYear) years.add(y)
        else out.invalid.push(String(y))
      }
    } else if (single) {
      const y = Number(single[1])
      if (y >= 1900 && y <= maxYear) years.add(y)
      else out.invalid.push(t)
    } else if (/^\d+$/.test(t) && Number(t) < 1900 && t.length !== 4) {
      out.ambiguous.push(t) // "15", "17": two-digit years are never guessed
    } else {
      out.ambiguous.push(t)
    }
  }
  out.years = years.size ? [...years].sort((a, b) => a - b) : null
  return out
}

// ── Engine / fuel (source text only) ──────────────────────────────────────────

/** "1.4", "1,6", "1.7TD", "2.0T": a single digit, a separator, a single digit, NOT glued to a preceding
 * letter or digit ("V3.0", "TR2.0", "10.0" are names / other numbers, not displacements). */
const DISPLACEMENT = /(?<![\w.,])(\d)[.,](\d)(?!\d)/g
/** Plausible passenger / light-commercial displacement range in litres. */
const MIN_L = 0.6
const MAX_L = 8.0
const DIESEL = /\b(?:TD|TDI|TDCI|TURBO ?DIESEL|DIESEL|DIÉSEL|HDI|DCI|JTD|MULTIJET|CRDI|D4D|D-4D|CDI|TDDI)\b|\d[.,]\d ?(?:TD|D|TDI|HDI|DCI)(?![\w/])/
const GNC = /\bGNC\b/
const HYBRID = /\bH[IÍ]BRIDO\b|\bHYBRID\b|\bHEV\b|\bPHEV\b/
const ELECTRIC = /\bEL[EÉ]CTRICO\b|\bELECTRIC\b|\bBEV\b/

export interface ParsedEngine {
  displacementL?: number
  fuel?: FuelKind
  /** Several incompatible fuel markers in the same text: fuel left unknown, record flagged. */
  fuelConflict: boolean
}

export interface EngineContext {
  /** Model family: a decimal that names the model ("9.3", "9.5") is not a displacement. */
  family?: string
  /** M = motovehículo: decimals in motorcycle names ("MOTARD 2.0", "FZ V3.0") are versions, not litres. */
  vehicleClass?: 'A' | 'M'
}

/**
 * Engine data ONLY when the source text states it unambiguously (7D.2 audit):
 *   - displacement: exactly one distinct "x.y" token, not part of the model family, not glued to a
 *     letter, within 0.6–8.0 L, and never for motovehículos; otherwise left unknown;
 *   - fuel: one explicit marker (diésel / GNC / híbrido / eléctrico); several → conflict, none →
 *     unknown. Nafta is never inferred from the absence of a marker.
 */
export function parseEngineFromLabel(text: string, ctx: EngineContext = {}): ParsedEngine {
  const t = canonicalText(text)
  const out: ParsedEngine = { fuelConflict: false }
  const familyTokens = new Set([...(ctx.family ? canonicalText(ctx.family) : '').matchAll(DISPLACEMENT)].map((m) => `${m[1]}.${m[2]}`))
  const tokens = [...new Set([...t.matchAll(DISPLACEMENT)].map((m) => `${m[1]}.${m[2]}`))].filter((x) => !familyTokens.has(x))
  if (ctx.vehicleClass !== 'M' && tokens.length === 1) {
    const value = Number(tokens[0])
    if (value >= MIN_L && value <= MAX_L) out.displacementL = value
  }
  const markers = new Set<FuelKind>()
  if (DIESEL.test(t)) markers.add('diesel')
  if (GNC.test(t)) markers.add('gnc')
  if (HYBRID.test(t)) markers.add('hibrido')
  if (ELECTRIC.test(t)) markers.add('electrico')
  if (markers.size === 1) out.fuel = [...markers][0]
  // GNC + diésel, híbrido + diésel, etc.: contradictory in the source text → never pick one.
  if (markers.size > 1) out.fuelConflict = true
  return out
}

// ── Category from registry body ───────────────────────────────────────────────

export type CategoryResolution =
  | { kind: 'resolved'; category: VehicleCategory }
  | { kind: 'ambiguous'; candidates: VehicleCategory[] }
  | { kind: 'unknown' }
  | { kind: 'missing' }

/**
 * Registry bodies observed in a vehicle registry valuation table (7D.2 discovery), grouped.
 * Bodies that do not determine the product category on their own are AMBIGUOUS: they go to
 * quarantine unless a reviewed model-level override exists (e.g. many SUVs are registered as
 * "SEDAN 5 PUERTAS" or "RURAL 5 PUERTAS").
 */
const BODY_RULES: Array<[RegExp, VehicleCategory[]]> = [
  [/^(SEDAN( \d PUERTAS)?( CON PORTON)?|COUPE|CABRIOLET|CONVERTIBLE|DESCAPOTABLE|HATCHBACK|BERLINA|FAMILIAR)$/, ['auto']],
  [/^PICK[- ]?UP( CABINA (SIMPLE|DOBLE|EXTENDIDA|Y MEDIA)| CARROZADA)?$/, ['pickup']],
  [/^(TODO TERRENO|JEEP|SUV)$/, ['suv']],
  [/^(FURGON|FURGONETA|FURGON VIDRIADO|UTILITARIO|FURGONETA O UTILITARIO)$/, ['utilitario']],
  [/^(CHASIS (C\/|CON |S\/|SIN )CABINA( DORMITORIO| DOBLE)?|CAMION( C\/CABINA DORMITORIO)?|TRACTOR( DE CARRETERA| C\/CABINA DORMITORIO| CON CABINA DORMITORIO)?)$/, ['camion']],
  [/^ARENERO$/, ['otro']],
  // A "rural" can be a station wagon or an SUV; passenger transport a van or a bus; "sin
  // especificación" says nothing: a person decides.
  [/^RURAL( \d(\/\d)? PUERTAS)?$/, ['auto', 'suv']],
  [/^(MINIBUS|MICROOMNIBUS|TRANS\.? ?DE PASAJEROS|TRANSPORTE DE PASAJEROS)$/, ['utilitario', 'otro']],
  [/^SIN ESPECIFICACION$/, ['auto', 'pickup', 'suv', 'utilitario', 'camion', 'otro']],
]
const MOTO_BODY = /^(MOTOCICLETA|CICLOMOTOR|SCOOTER|MOTONETA( \/ SCOOTER)?)$/
const OTHER_MOTO_BODY = /^(CUATRICICLO|CUATRIC\.C\/DISP\.ENG\.|TRICICLO|TRICICLO MOTORIZADO)$/

/** Every body text the rules know (longest first) — used to split a registry description. */
export const KNOWN_BODIES: string[] = [
  'SEDAN 2 PUERTAS', 'SEDAN 3 PUERTAS CON PORTON', 'SEDAN 3 PUERTAS', 'SEDAN 4 PUERTAS', 'SEDAN 5 PUERTAS', 'SEDAN',
  'COUPE', 'CABRIOLET', 'CONVERTIBLE', 'DESCAPOTABLE', 'FAMILIAR',
  'PICK-UP CABINA DOBLE', 'PICK-UP CABINA SIMPLE', 'PICK-UP CABINA Y MEDIA', 'PICK-UP CARROZADA', 'PICK-UP',
  'TODO TERRENO', 'JEEP',
  'FURGONETA O UTILITARIO', 'FURGONETA', 'FURGON', 'UTILITARIO',
  'CHASIS C/CABINA DORMITORIO', 'CHASIS CON CABINA DORMITORIO', 'CHASIS CON CABINA DOBLE', 'CHASIS C/CABINA', 'CHASIS CON CABINA', 'CHASIS S/CABINA', 'CHASIS SIN CABINA',
  'CAMION C/CABINA DORMITORIO', 'CAMION', 'TRACTOR DE CARRETERA', 'TRACTOR C/CABINA DORMITORIO', 'TRACTOR CON CABINA DORMITORIO',
  'ARENERO', 'RURAL 3 PUERTAS', 'RURAL 4/5 PUERTAS', 'RURAL 5 PUERTAS', 'MINIBUS', 'TRANS.DE PASAJEROS', 'TRANSPORTE DE PASAJEROS', 'SIN ESPECIFICACION',
  'MOTOCICLETA', 'MOTONETA / SCOOTER', 'SCOOTER', 'CICLOMOTOR', 'CUATRIC.C/DISP.ENG.', 'CUATRICICLO', 'TRICICLO',
].sort((a, b) => b.length - a.length)

/** Registry body → product category. `vehicleClass` A = automotor, M = motovehículo. */
export function categoryFromBody(vehicleClass: 'A' | 'M', bodyRaw: string): CategoryResolution {
  const body = canonicalText(bodyRaw)
  if (vehicleClass === 'M') {
    if (!body || MOTO_BODY.test(body)) return { kind: 'resolved', category: 'moto' }
    if (OTHER_MOTO_BODY.test(body)) return { kind: 'resolved', category: 'otro' }
    return { kind: 'unknown' }
  }
  if (!body) return { kind: 'missing' }
  // Several bodies in one row ("PICK-UP / TODO TERRENO") → the union of candidates.
  // The whole text first ("RURAL 4/5 PUERTAS", "CHASIS C/CABINA"); then " / "-separated combinations.
  const whole = BODY_RULES.find(([re]) => re.test(body))
  const parts = whole ? [body] : body.split(/\s+\/\s+/).filter(Boolean)
  const candidates = new Set<VehicleCategory>()
  for (const part of parts) {
    const rule = BODY_RULES.find(([re]) => re.test(part))
    if (!rule) return { kind: 'unknown' }
    rule[1].forEach((c) => candidates.add(c))
  }
  const list = [...candidates]
  return list.length === 1 ? { kind: 'resolved', category: list[0]! } : { kind: 'ambiguous', candidates: list }
}

// ── Model family ──────────────────────────────────────────────────────────────

/**
 * The model ("family") inside a registry model description. Configured multi-word families win
 * (longest first, e.g. "GOL TREND" before "GOL"); otherwise the first token. Parenthesized
 * generation codes ("PALIO (326) …") stay in the version label, never in the family.
 */
export function modelFamily(modelDesc: string, multiWordFamilies: string[] = []): string {
  const d = canonicalText(modelDesc)
  const configured = [...multiWordFamilies].map(canonicalText).sort((a, b) => b.length - a.length)
  const hit = configured.find((f) => d === f || d.startsWith(`${f} `))
  if (hit) return hit
  return d.split(' ')[0] ?? d
}

/** Looks like a registry code rather than a commercial name (e.g. "B110", "SX110"). */
export function looksLikeRegistryCode(family: string): boolean {
  return /^[A-Z]{1,3}-?\d{2,4}[A-Z]?$/.test(canonicalText(family))
}
