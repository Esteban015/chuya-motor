/**
 * price-comparator.ts — PriceComparator (Incremento 7B). Deterministic, integer arithmetic.
 *
 * Compares the workshop line price with ONE reference typed in by the person, only when:
 *   - the line is a part (labor and other concepts are never compared);
 *   - the person confirmed the reference is the same part ("confirmed_equivalent");
 *   - both prices exist and the presentation is the same (a set is never compared with a unit).
 * The reference is scaled to the workshop quantity: refTotal = refPrice × lineQty / refQty,
 * rounded half away from zero to the centavo. Percentage = difference / refTotal, in tenths.
 *
 * It never averages references, never takes the minimum as a "fair" price and never concludes
 * overpricing: a difference can come from brand, warranty, stock, shipping or installation.
 */
import { MAX_ARS_MINOR } from './ars-amount'
import { MAX_QUANTITY, type PartReference, type ResearchLine } from './types'

export type NotComparableReason =
  | 'not_a_part'
  | 'unverified'
  | 'not_equivalent'
  | 'presentation_mismatch'
  | 'no_workshop_price'
  | 'no_reference_price'
  | 'invalid_quantity'

export type Comparison =
  | {
      kind: 'compared'
      workshopTotalMinor: number
      referenceTotalMinor: number
      /** workshop − reference (positive: the quote is higher than this reference). */
      differenceMinor: number
      /** Tenths of a percent relative to the reference total (200 = +20,0 %). */
      differencePercentTenths: number
      workshopUnitMinor: number
      referenceUnitMinor: number
    }
  | { kind: 'not_comparable'; reason: NotComparableReason }

export const NOT_COMPARABLE_TEXT: Record<NotComparableReason, string> = {
  not_a_part: 'Solo se comparan repuestos. La mano de obra y otros conceptos no se comparan.',
  unverified: 'Coincidencia no verificada: confirmá que es la misma pieza para ver la diferencia.',
  not_equivalent: 'Marcaste que no es la misma pieza: no se compara.',
  presentation_mismatch: 'La presentación no coincide (por ejemplo unidad contra juego): no se compara.',
  no_workshop_price: 'El presupuesto no tiene un precio para esta pieza.',
  no_reference_price: 'La referencia no tiene un precio válido.',
  invalid_quantity: 'La cantidad no es válida: debe ser un número entero entre 1 y 999.',
}

export const COMPARISON_DISCLAIMER =
  'Es una diferencia aritmética con una referencia que ingresaste vos. No indica que el taller cobre de más ni define un precio justo de mercado: la marca, la garantía, la disponibilidad, el envío o la colocación pueden explicar la diferencia.'

/** a × b / c rounded half away from zero, exact with BigInt. */
function mulDivRound(a: number, b: number, c: number): bigint {
  const num = BigInt(a) * BigInt(b)
  const den = BigInt(c)
  const q = num / den
  const r = num % den
  const twice = (r < 0n ? -r : r) * 2n
  if (twice >= (den < 0n ? -den : den)) return num < 0n ? q - 1n : q + 1n
  return q
}

function roundDiv(num: bigint, den: bigint): bigint {
  const q = num / den
  const r = num % den
  const twice = (r < 0n ? -r : r) * 2n
  if (twice >= den) return num < 0n ? q - 1n : q + 1n
  return q
}

const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= MAX_ARS_MINOR
const isQuantity = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_QUANTITY

export function compareWithReference(line: ResearchLine, ref: PartReference): Comparison {
  if (line.category !== 'part') return { kind: 'not_comparable', reason: 'not_a_part' }
  if (ref.compatibility === 'not_equivalent') return { kind: 'not_comparable', reason: 'not_equivalent' }
  if (ref.compatibility !== 'confirmed_equivalent') return { kind: 'not_comparable', reason: 'unverified' }
  // Inputs come from page state: validated here, never trusted (NaN / decimals / out of range).
  if (!isMoney(line.workshopPriceMinor)) return { kind: 'not_comparable', reason: 'no_workshop_price' }
  if (!isMoney(ref.priceMinor)) return { kind: 'not_comparable', reason: 'no_reference_price' }
  if (!isQuantity(line.quantity) || !isQuantity(ref.quantity)) return { kind: 'not_comparable', reason: 'invalid_quantity' }
  if (line.presentation !== ref.presentation) return { kind: 'not_comparable', reason: 'presentation_mismatch' }

  const refTotal = mulDivRound(ref.priceMinor, line.quantity, ref.quantity)
  if (refTotal <= 0n || refTotal > BigInt(MAX_ARS_MINOR)) return { kind: 'not_comparable', reason: 'no_reference_price' }

  const workshop = BigInt(line.workshopPriceMinor)
  const diff = workshop - refTotal
  const percentTenths = roundDiv(diff * 1000n, refTotal)

  return {
    kind: 'compared',
    workshopTotalMinor: line.workshopPriceMinor,
    referenceTotalMinor: Number(refTotal),
    differenceMinor: Number(diff),
    differencePercentTenths: Number(percentTenths),
    workshopUnitMinor: Number(mulDivRound(line.workshopPriceMinor, 1, line.quantity)),
    referenceUnitMinor: Number(mulDivRound(ref.priceMinor, 1, ref.quantity)),
  }
}
