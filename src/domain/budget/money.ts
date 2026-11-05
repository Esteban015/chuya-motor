import { z } from 'zod'

export const SUPPORTED_CURRENCIES = ['ARS', 'USD', 'CLP', 'PEN', 'COP', 'MXN', 'BRL'] as const
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]

// D-3: Money stored as integer minor units (centavos/centimos). Never floats for arithmetic.
export const MAX_AMOUNT_MINOR_UNIT = 999_999_999_99 // ~9.9 billion in minor units

export const MoneySchema = z.object({
  amountMinorUnit: z.number().int().nonnegative().max(MAX_AMOUNT_MINOR_UNIT),
  currency: z.enum(SUPPORTED_CURRENCIES),
})
export type Money = z.infer<typeof MoneySchema>

export function formatMinorUnit(amountMinorUnit: number, currency: CurrencyCode): string {
  const major = amountMinorUnit / 100
  return major.toLocaleString('es-AR', { style: 'currency', currency, minimumFractionDigits: 2 })
}
