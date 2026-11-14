/**
 * types.ts — Presupuestos 2.0 (Incremento 7B): local, in-memory model for part research and
 * budget comparison. Nothing here is persisted (no database in the MVP) or sent to Analytics.
 *
 * Money: integer ARS minor units (centavos). Never floats for arithmetic.
 */

/** What a budget line is. "unclassified" lets the person decide instead of guessing. */
export type LineCategory = 'part' | 'labor' | 'other' | 'unclassified'

/** How a part is sold. Prices are compared only between identical presentations. */
export type Presentation = 'unit' | 'pair' | 'set' | 'kit' | 'liter'

/** Whether the person confirmed that a reference is the same part. */
export type Compatibility = 'confirmed_equivalent' | 'unverified' | 'not_equivalent'

export interface VehicleInfo {
  make?: string
  model?: string
  year?: string
  engine?: string
}

/** External price reference typed in by the person. Never fetched or verified by Chuya Motor. */
export interface PartReference {
  id: string
  url: string | null
  store: string
  /** Price for `quantity` × `presentation`, in ARS minor units. */
  priceMinor: number | null
  currency: 'ARS'
  /** YYYY-MM-DD */
  consultedOn: string
  description: string
  compatibility: Compatibility
  quantity: number
  presentation: Presentation
  source: 'user'
}

export interface ResearchLine {
  id: string
  description: string
  category: LineCategory
  /** Units of `presentation` (1–999). */
  quantity: number
  presentation: Presentation
  partBrand: string
  partCode: string
  /** Line total quoted by the workshop (for `quantity`), ARS minor units; null if none. */
  workshopPriceMinor: number | null
  /** The quote says "a confirmar" / "pendiente". */
  pricePending: boolean
  references: PartReference[]
}

export const CATEGORY_LABEL: Record<LineCategory, string> = {
  part: 'Repuesto',
  labor: 'Mano de obra',
  other: 'Otro concepto',
  unclassified: 'Sin clasificar',
}

export const PRESENTATION_LABEL: Record<Presentation, string> = {
  unit: 'Unidad',
  pair: 'Par',
  set: 'Juego',
  kit: 'Kit',
  liter: 'Litro',
}

export const COMPATIBILITY_LABEL: Record<Compatibility, string> = {
  confirmed_equivalent: 'Confirmaste que es la misma pieza',
  unverified: 'Coincidencia no verificada',
  not_equivalent: 'No es equivalente',
}

export const MAX_LINES = 50
export const MAX_DESCRIPTION = 200
export const MAX_QUANTITY = 999
export const MAX_REFERENCES_PER_LINE = 5
