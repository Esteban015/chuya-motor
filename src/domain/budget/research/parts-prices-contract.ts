/**
 * parts-prices-contract.ts — Response contract of POST /api/budget/parts-prices (Incremento 7C).
 * Shared by the server route and the browser UI: types and display labels only, no logic that
 * could call a provider. Offers are published listings reported by the provider; they are never
 * declared compatible, and no difference, average or verdict is part of the contract.
 */

export type MissingData = 'part_code' | 'presentation' | 'condition' | 'year' | 'engine' | 'model' | 'multi_vehicle' | 'model_variant' | 'position'

export interface ClientOffer {
  title: string
  merchant: string
  /** ARS minor units, as published (not a fair repair price). */
  priceMinor: number
  currency: 'ARS'
  /** https link reported by the provider (Google Shopping product page). */
  url: string
  /** ISO timestamp of the search. */
  retrievedAt: string
  /** candidate = title coherent with the part and vehicle; needs_review = less data. NEVER "compatible". */
  decision: 'candidate' | 'needs_review'
  /** The listing's part number equals the code the person entered (still to be confirmed). */
  codeMatch: boolean
  /** What is missing to confirm equivalence. */
  missing: MissingData[]
}

export interface ClientPricedItem {
  lineId: string
  status: 'ok' | 'no_results' | 'unavailable' | 'skipped'
  reason?: string
  offers: ClientOffer[]
  /** Valid listings not shown because the title does not name the vehicle model. */
  hidden: number
}

export type PartsPricesResponse =
  | { status: 'ok'; provider: 'mercadolibre' | 'serpapi'; items: ClientPricedItem[]; truncated: boolean }
  | { status: 'disabled' | 'rate_limited' | 'invalid_request' | 'not_found' | 'error' }

export const MISSING_DATA_LABEL: Record<MissingData, string> = {
  part_code: 'Código de pieza (comparalo con el del presupuesto)',
  presentation: 'Presentación: unidad, par o juego',
  condition: 'Estado: nuevo, usado o reacondicionado',
  year: 'Año del vehículo',
  engine: 'Motorización',
  model: 'Modelo del vehículo',
  multi_vehicle: 'La publicación menciona varios vehículos',
  model_variant: 'La publicación es para una versión del modelo (por ejemplo Weekend): confirmá que sea la tuya',
  position: 'Posición: delantero o trasero (la publicación indica una y tu pedido no)',
}

/** Short forms for the per-part summary ("En todas falta confirmar: código, presentación..."). */
export const MISSING_SHORT_LABEL: Record<MissingData, string> = {
  part_code: 'código de pieza',
  presentation: 'presentación (unidad, par o juego)',
  condition: 'estado (nuevo o usado)',
  year: 'año',
  engine: 'motorización',
  model: 'modelo',
  multi_vehicle: 'que no sea una publicación para varios vehículos',
  model_variant: 'versión del modelo',
  position: 'posición (delantero o trasero)',
}

/** Provider failures that are neither slowness nor a search limit: one "temporarily unavailable" text. */
const TEMPORARILY_UNAVAILABLE = 'El servicio de búsqueda no está disponible en este momento. Esto no significa que no haya publicaciones: usá la búsqueda manual.'

/**
 * Per-part reasons. Four different situations, never mixed up:
 *   slow provider (timeout) · temporarily unavailable · search limit reached · no publications
 *   (status no_results, rendered separately). A failure is NEVER worded as "no results".
 */
export const ITEM_REASON_LABEL: Record<string, string> = {
  quota_exceeded: 'Se alcanzó el límite de búsquedas automáticas por ahora. Usá la búsqueda manual.',
  timeout: 'El proveedor de búsqueda tardó demasiado en responder. Esto no significa que no haya publicaciones: usá la búsqueda manual o probá más tarde.',
  store_unavailable: TEMPORARILY_UNAVAILABLE,
  network: TEMPORARILY_UNAVAILABLE,
  provider_error: TEMPORARILY_UNAVAILABLE,
  bad_response: TEMPORARILY_UNAVAILABLE,
  unauthorized: TEMPORARILY_UNAVAILABLE,
  forbidden: TEMPORARILY_UNAVAILABLE,
  rate_limited: TEMPORARILY_UNAVAILABLE,
  disabled: TEMPORARILY_UNAVAILABLE,
  not_a_part: 'No se busca automáticamente: no es un repuesto.',
  unsafe: 'Por seguridad, no se busca automáticamente esta descripción.',
  empty: 'Falta el nombre del repuesto.',
  too_long: 'La descripción es demasiado larga.',
  limit: 'Se buscan hasta 5 repuestos por vez.',
}

export const MAX_AUTO_PARTS = 5
