/**
 * line-parser.ts — Deterministic, local reading of a parts list or a workshop quote
 * (Incremento 7B). It never calls an LLM and never invents prices.
 *
 * Per line: description, category (part / labor / other / unclassified), quantity, presentation,
 * optional workshop price (ARS minor units) and "price pending" ("a confirmar", "pendiente").
 * "Total: X" lines are read as the declared total, not as items.
 *
 * Amounts require an explicit separator (":", "=" or "$") so data such as the engine ("1.4 8v")
 * is never read as a price. It does NOT replace the server's budget verification (POST
 * /api/analyze), which stays authoritative for the sum check.
 */
import { parseArsAmount } from './ars-amount'
import { MAX_DESCRIPTION, MAX_LINES, MAX_QUANTITY, type LineCategory, type Presentation, type ResearchLine } from './types'

export interface ParseOptions {
  /** Mode A (parts list): unknown items are parts. Mode B (quote): unknown → unclassified. */
  assumeParts: boolean
}

export interface ParseResult {
  lines: ResearchLine[]
  declaredTotalMinor: number | null
  truncated: boolean
  /** Lines whose amount could not be read unambiguously (1-based). */
  unreadableAmountLines: number[]
}

/** Control, zero-width and bidirectional-override characters are removed (malformed / spoofed input). */
export function stripInvisible(text: string): string {
  return text.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
}

export function normalizeForMatch(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const LABOR =
  /^(mano de obra|m\.?\s?o\.?(?=\s|$|:))|\b(mano de obra|colocacion|instalacion|diagnostico|alineacion|balanceo|reparacion|rectificacion|honorarios|servicio tecnico|trabajo|armado|desarme|revision|escaneo|programacion|regulacion)\b/
const OTHER = /\b(insumos?|varios|iva|impuestos?|envio|flete|descartables?|traslado|grua|lavado|recargo|descuento|tasa|bonificacion)\b/
const PART =
  /\b(filtros?|aceites?|pastillas?|discos?|bujias?|correas?|mangueras?|bombas?|amortiguador\w*|rotulas?|embragues?|baterias?|lamparas?|juntas?|reten\w*|sensor\w*|termostatos?|radiador\w*|cables?|kit|juegos?|rodamientos?|rulemanes?|ruleman|cubiertas?|neumaticos?|escobillas?|tensor\w*|poleas?|bujes?|bieletas?|espirales?|cazoletas?|axial\w*|extremos?|homocinetic\w*|liquido\w*|refrigerante\w*|valvulas?|inyector\w*|bobinas?|alternador\w*|burro|motor de arranque|electroventilador\w*|ventilador\w*|tapa\w*|caja\w*|cilindros?|campanas?|cintas?|mazas?|parrillas?|tazas?|soportes?|silenciador\w*|caños?|escape|catalizador\w*|sonda\w*|calipers?|mordaza\w*|patin\w*|zapatas?|crucetas?|semiejes?|palier\w*|depositos?|vasos? de expansion|respiradero\w*|valvula pcv|pcv|empaquetadura\w*|o-?rings?|abrazaderas?|tornillos?|bulones?)\b/

const TOTAL_LINE = /^\s*(sub)?total\b[^:=\d$]*[:=]?\s*(.*)$/i
const PENDING = /^(.*?)\s*[:=]\s*(a confirmar|pendiente|por definir|sin precio|a cotizar|consultar)\s*\.?\s*$/i
const PRICED = /^(.*?)\s*(?:[:=]\s*|(?=\$))\$?\s*(\d[\d.,]*)\s*(?:ars|pesos?)?\s*\.?\s*$/i

function classify(description: string, assumeParts: boolean): LineCategory {
  const n = normalizeForMatch(description)
  if (LABOR.test(n)) return 'labor'
  if (OTHER.test(n)) return 'other'
  if (PART.test(n) || assumeParts) return 'part'
  return 'unclassified'
}

function extractQuantity(description: string): { description: string; quantity: number; presentation: Presentation } {
  let d = description
  let quantity = 1
  let presentation: Presentation = 'unit'

  const liters = /(\d{1,3})\s*(litros?|lts?\.?|l)\b/i.exec(d)
  if (liters) {
    quantity = Number(liters[1])
    presentation = 'liter'
  } else {
    const leading = /^(\d{1,3})\s*(?:x|×)\s+|^(\d{1,3})\s+(?=[a-záéíóúñ])/i.exec(d)
    const trailing = /\s*\(?\s*(?:x|×)\s*(\d{1,3})\s*\)?\s*$/i.exec(d)
    const units = /\s*\(?\s*(\d{1,3})\s*(?:unidades|u\.)\s*\)?\s*$/i.exec(d)
    const cant = /\s*cant(?:idad)?\.?\s*:?\s*(\d{1,3})\s*$/i.exec(d)
    const m = leading ?? trailing ?? units ?? cant
    if (m) {
      quantity = Number(m[1] ?? m[2])
      d = (d.slice(0, m.index) + d.slice(m.index + m[0].length)).trim()
    }
    const n = normalizeForMatch(d)
    if (/\bjuegos?\b/.test(n)) presentation = 'set'
    else if (/\bkit\b/.test(n)) presentation = 'kit'
    else if (/\bpar\b/.test(n)) presentation = 'pair'
  }
  if (!Number.isInteger(quantity) || quantity < 1) quantity = 1
  if (quantity > MAX_QUANTITY) quantity = MAX_QUANTITY
  return { description: d, quantity, presentation }
}

function cleanDescription(raw: string): string {
  return raw
    .replace(/^[-*•·]\s+/, '')
    .replace(/[\s:=\-–]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DESCRIPTION)
    .trim()
}

export function parseResearchLines(text: string, options: ParseOptions): ParseResult {
  const rawLines = stripInvisible(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => /[\p{L}\p{N}]/u.test(l))
  const lines: ResearchLine[] = []
  let declaredTotalMinor: number | null = null
  const unreadableAmountLines: number[] = []
  let truncated = false

  rawLines.forEach((raw, i) => {
    const total = TOTAL_LINE.exec(raw)
    if (total) {
      const amount = parseArsAmount(total[2] ?? '')
      if (amount !== null && !total[1]) declaredTotalMinor = amount
      return
    }
    if (lines.length >= MAX_LINES) {
      truncated = true
      return
    }

    let descriptionRaw = raw
    let workshopPriceMinor: number | null = null
    let pricePending = false

    const pending = PENDING.exec(raw)
    const priced = pending ? null : PRICED.exec(raw)
    if (pending) {
      descriptionRaw = pending[1]!
      pricePending = true
    } else if (priced && priced[1]!.trim()) {
      const amount = parseArsAmount(priced[2]!)
      descriptionRaw = priced[1]!
      if (amount === null) unreadableAmountLines.push(i + 1)
      else workshopPriceMinor = amount
    }

    const q = extractQuantity(cleanDescription(descriptionRaw))
    const description = cleanDescription(q.description)
    if (!description) return

    lines.push({
      id: `l${i + 1}`,
      description,
      category: classify(description, options.assumeParts),
      quantity: q.quantity,
      presentation: q.presentation,
      partBrand: '',
      partCode: '',
      workshopPriceMinor,
      pricePending,
      references: [],
    })
  })

  return { lines, declaredTotalMinor, truncated, unreadableAmountLines }
}
