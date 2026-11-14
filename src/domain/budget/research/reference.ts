/**
 * reference.ts — Validation of a price reference typed in by the person (Incremento 7B).
 * The result is always labeled source="user": "Informada por el usuario, sin verificación
 * independiente". Chuya Motor never fetches the URL nor confirms the price.
 */
import { parseArsAmount } from './ars-amount'
import { sanitizeExternalUrl } from './external-url'
import { MAX_QUANTITY, type Compatibility, type PartReference, type Presentation } from './types'

export interface ReferenceInput {
  url: string
  store: string
  price: string
  consultedOn: string
  description: string
  compatibility: string
  quantity: string
  presentation: string
}

export type ReferenceField = keyof ReferenceInput
export type ReferenceValidation = { ok: true; reference: Omit<PartReference, 'id'> } | { ok: false; errors: Partial<Record<ReferenceField, string>> }

const PRESENTATIONS: readonly Presentation[] = ['unit', 'pair', 'set', 'kit', 'liter']
const COMPATIBILITIES: readonly Compatibility[] = ['confirmed_equivalent', 'unverified', 'not_equivalent']
const CONTROL = /[\u0000-\u001f\u007f]/g

const clean = (s: string, max: number) => s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** today: YYYY-MM-DD (injected for deterministic tests). */
export function validateReferenceInput(input: ReferenceInput, today: string): ReferenceValidation {
  const errors: Partial<Record<ReferenceField, string>> = {}

  let url: string | null = null
  if (input.url.trim()) {
    url = sanitizeExternalUrl(input.url)
    if (!url) errors.url = 'Ingresá un enlace que empiece con https:// (o dejalo vacío).'
  }

  const store = clean(input.store, 80)
  if (!store) errors.store = 'Indicá el comercio o la plataforma.'

  const priceMinor = parseArsAmount(input.price)
  if (priceMinor === null || priceMinor <= 0) errors.price = 'Ingresá un precio en pesos, por ejemplo 15.000 o 15.000,50.'

  const date = input.consultedOn.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || date > today || date < '2000-01-01') {
    errors.consultedOn = 'Ingresá la fecha de consulta (no puede ser futura).'
  }

  const quantity = Number(input.quantity)
  if (!/^\d{1,3}$/.test(input.quantity.trim()) || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    errors.quantity = 'La cantidad debe ser un número entero entre 1 y 999.'
  }

  if (!PRESENTATIONS.includes(input.presentation as Presentation)) errors.presentation = 'Elegí la presentación.'
  if (!COMPATIBILITIES.includes(input.compatibility as Compatibility)) errors.compatibility = 'Indicá si es la misma pieza.'

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    reference: {
      url,
      store,
      priceMinor,
      currency: 'ARS',
      consultedOn: date,
      description: clean(input.description, 200),
      compatibility: input.compatibility as Compatibility,
      quantity,
      presentation: input.presentation as Presentation,
      source: 'user',
    },
  }
}
