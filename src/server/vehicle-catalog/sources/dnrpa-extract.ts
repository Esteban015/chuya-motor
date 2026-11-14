/**
 * dnrpa-extract.ts — DNRPA valuation table (PDF) → registry rows for the catalog ingestion
 * (Incremento 7D.2 real catalog). Pure: receives the two text renderings of the PDF produced
 * locally by xpdf `pdftotext` 4.x (`-raw` and `-table`); no network.
 *
 *   -raw   → clean descriptions in reading order (long descriptions wrap: the continuation line
 *            is joined back to its row);
 *   -table → column positions: each value sits under its year column ("0Km", 2025 … 2002).
 *
 * Only IDENTIFICATION data leaves this module: brand, model description (version text), registry
 * body, class (A automotor / M motovehículo), registry codes and the model years that have a value
 * in the table. The monetary valuations are read only to know WHICH year columns are filled and are
 * never copied. Years are emitted only when the value count of the row matches between both
 * renderings and every value maps to a distinct column in order; otherwise years stay EMPTY
 * (unknown) and the row is reported — never guessed.
 */
import { KNOWN_BODIES, canonicalText } from '../ingest/normalize'
import type { RegistryRow } from '../ingest/registry-input'

const ROW = /^([IN]) (\S+) ([AM]) (.*)$/
const TABLE_ROW = /^([IN])\s+(\S+)\s+([AM])\s+(.*)$/
/** A valuation cell: plain integer, or scientific notation for very large values ("1,058E+09"). */
const VALUE = /^(?:\d{4,9}|\d,\d{1,3}E\+\d{2})$/
const VALUE_IN_LINE = /(?<!\S)(\d{4,9}|\d,\d{1,3}E\+\d{2})(?!\S)/g
/** Page footer that the raw rendering appends to the last row of each page. */
const FOOTER = /\s*P[ÁA]GINA\s+\d+\s+DE\s+\d+\s*/gi

export interface DnrpaExtractionReport {
  validFrom: string | null
  pages: number
  rows: number
  automotores: number
  motovehiculos: number
  continuationLinesJoined: number
  yearsAligned: number
  yearsUnaligned: number
  rowsWithoutValues: number
  brandUnresolved: number
  bodyNotRecognized: number
  /** Body glued to the previous word in the PDF text ("…CVSEDAN 3 PUERTAS"), separated. */
  bodyGlued: number
  brandCandidatesDropped: number
  samples: { yearsUnaligned: string[]; brandUnresolved: string[]; bodyNotRecognized: string[] }
}

interface RawRow {
  io: 'I' | 'N'
  mtm: string
  cls: 'A' | 'M'
  codes: string[]
  desc: string
  values: number
}

function parseRaw(raw: string, report: DnrpaExtractionReport): RawRow[] {
  const rows: RawRow[] = []
  let current: { head: RegExpExecArray; text: string } | null = null
  const flush = () => {
    if (!current) return
    const [, io, mtm, cls] = current.head
    const tokens = current.text.split(' ').filter(Boolean)
    const ncodes = io === 'I' ? 3 : 4
    const codes = tokens.slice(0, ncodes)
    const rest = tokens.slice(ncodes)
    let values = 0
    while (rest.length && VALUE.test(rest[rest.length - 1]!)) {
      rest.pop()
      values++
    }
    rows.push({ io: io as 'I' | 'N', mtm: mtm!, cls: cls as 'A' | 'M', codes, desc: canonicalText(rest.join(' ')), values })
    current = null
  }
  for (const line of raw.split(/\r?\n/)) {
    const l = line.replace(/\f/g, '').replace(FOOTER, ' ').trim()
    if (!l) continue
    if (/^Vigencia\b/i.test(l)) {
      report.validFrom ??= /(\d{2})\/(\d{2})\/(\d{4})/.exec(l)?.slice(1).reverse().join('-') ?? null
      continue
    }
    if (/^I\/N\b/.test(l)) continue
    const m = ROW.exec(l)
    if (m) {
      flush()
      current = { head: m, text: m[4]! }
    } else if (current) {
      current.text += ` ${l}`
      report.continuationLinesJoined++
    }
  }
  flush()
  return rows
}

/** For each row of the -table rendering (keyed by MTM + class, in order): the year columns filled. */
function parseTableYears(table: string, report: DnrpaExtractionReport): { years: Map<string, Array<string[] | null>>; brands: Set<string> } {
  const years = new Map<string, Array<string[] | null>>()
  const brands = new Set<string>()
  const pages = table.split('\f')
  report.pages = pages.filter((p) => p.includes('Desc. Modelo')).length
  for (const page of pages) {
    const lines = page.split(/\r?\n/)
    const header = lines.find((l) => l.includes('Desc. Modelo'))
    if (!header) continue
    const cols = [...header.matchAll(/0Km|20\d\d/g)].map((m) => ({ start: m.index!, label: m[0] }))
    if (!cols.length) continue
    const firstValueCol = cols[0]!.start - 12
    for (const line of lines) {
      const m = TABLE_ROW.exec(line)
      if (!m) continue
      const key = `${m[2]}|${m[3]}`
      // Brand = first text column after the codes (2+ spaces separate the columns).
      const ncodes = m[1] === 'I' ? 3 : 4
      const parts = m[4]!.trim().split(/\s{2,}/)
      const brand = parts.slice(ncodes).find((p) => !VALUE.test(p))
      if (brand && /^[A-Z0-9][A-Z0-9 .&'\-/]*$/.test(brand)) brands.add(canonicalText(brand))
      // Values and their columns.
      const assigned: number[] = []
      for (const n of line.matchAll(VALUE_IN_LINE)) {
        if (n.index! < firstValueCol) continue
        let best = 0
        for (let i = 1; i < cols.length; i++) if (Math.abs(cols[i]!.start - n.index!) < Math.abs(cols[best]!.start - n.index!)) best = i
        assigned.push(best)
      }
      const ordered = assigned.every((c, i) => i === 0 || c > assigned[i - 1]!)
      if (!years.has(key)) years.set(key, [])
      years.get(key)!.push(ordered ? assigned.map((i) => cols[i]!.label) : null)
    }
  }
  return { years, brands }
}

function splitDescription(desc: string, brands: string[]): { brand: string | null; model: string; body: string; glued: boolean } {
  const brand = brands.find((b) => desc === b || desc.startsWith(`${b} `)) ?? null
  let rest = brand ? desc.slice(brand.length).trim() : desc
  let glued = false
  let body = KNOWN_BODIES.find((b) => rest === b || rest.endsWith(` ${b}`)) ?? ''
  if (!body) {
    // The PDF sometimes glues the body to the last word of the description ("135 CVSEDAN 3 PUERTAS").
    body = KNOWN_BODIES.find((b) => rest.length > b.length + 1 && rest.endsWith(b) && /[A-Z0-9.)]/.test(rest[rest.length - b.length - 1]!)) ?? ''
    glued = body !== ''
  }
  if (body) rest = rest.slice(0, rest.length - body.length).trim()
  return { brand, model: rest, body, glued }
}

/**
 * Brand cells of the -table rendering sometimes swallow the start of the model when the columns
 * touch ("HARLEY DAVIDSON 1200 CUSTOM XLC"). A candidate that extends another candidate by whole
 * words ("FORD" → "FORD F150 …") is dropped; unresolvable rows are rejected, never guessed.
 */
function cleanBrandCandidates(candidates: Set<string>, report: DnrpaExtractionReport): string[] {
  const list = [...candidates]
  const kept = list.filter((b) => !list.some((a) => a !== b && b.startsWith(`${a} `)))
  report.brandCandidatesDropped = list.length - kept.length
  return kept.sort((a, b) => b.length - a.length)
}

export function extractDnrpaRows(rawText: string, tableText: string): { rows: RegistryRow[]; report: DnrpaExtractionReport } {
  const report: DnrpaExtractionReport = {
    validFrom: null,
    pages: 0,
    rows: 0,
    automotores: 0,
    motovehiculos: 0,
    continuationLinesJoined: 0,
    yearsAligned: 0,
    yearsUnaligned: 0,
    rowsWithoutValues: 0,
    brandUnresolved: 0,
    bodyNotRecognized: 0,
    bodyGlued: 0,
    brandCandidatesDropped: 0,
    samples: { yearsUnaligned: [], brandUnresolved: [], bodyNotRecognized: [] },
  }
  const raw = parseRaw(rawText, report)
  const { years, brands } = parseTableYears(tableText, report)
  const brandList = cleanBrandCandidates(brands, report)
  const seen = new Map<string, number>()
  const rows: RegistryRow[] = []
  const sample = (list: string[], s: string) => list.length < 15 && list.push(s)

  for (const r of raw) {
    const key = `${r.mtm}|${r.cls}`
    const occurrence = seen.get(key) ?? 0
    seen.set(key, occurrence + 1)
    const cols = years.get(key)?.[occurrence]
    let yearText = ''
    if (r.values === 0) report.rowsWithoutValues++
    else if (cols && cols.length === r.values && new Set(cols).size === cols.length) {
      yearText = cols.map((c) => (c === '0Km' ? '0KM' : c)).join(';')
      report.yearsAligned++
    } else {
      report.yearsUnaligned++
      sample(report.samples.yearsUnaligned, `${r.mtm} ${r.desc}`.slice(0, 90))
    }
    const split = splitDescription(r.desc, brandList)
    if (!split.brand) {
      report.brandUnresolved++
      sample(report.samples.brandUnresolved, r.desc.slice(0, 90))
    }
    if (split.glued) report.bodyGlued++
    if (!split.body) {
      report.bodyNotRecognized++
      sample(report.samples.bodyNotRecognized, r.desc.slice(0, 90))
    }
    if (r.cls === 'A') report.automotores++
    else report.motovehiculos++
    rows.push({
      line: rows.length + 1,
      recordId: `dnrpa:${r.io}:${r.mtm}:${r.cls}${occurrence ? `:${occurrence}` : ''}`,
      origin: r.io,
      code: `${r.mtm} ${r.codes.join(' ')}`.trim(),
      vehicleClass: r.cls,
      brand: split.brand ?? '',
      modelDesc: split.model,
      body: split.body,
      years: yearText,
    })
  }
  report.rows = rows.length
  return { rows, report }
}

/** Registry CSV (identification only — no valuations) for `npm run catalog:ingest`. */
export function rowsToCsv(rows: RegistryRow[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const header = 'record_id,origin,code,class,brand,model_desc,body,years'
  return [header, ...rows.map((r) => [r.recordId, r.origin, r.code, r.vehicleClass, r.brand, r.modelDesc, r.body, r.years].map(esc).join(','))].join('\n') + '\n'
}
