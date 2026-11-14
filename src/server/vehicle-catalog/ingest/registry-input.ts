/**
 * registry-input.ts — Reads a LOCAL registry-style CSV for the offline ingestion (Incremento 7D.2).
 *
 * Expected header (any column order):
 *   record_id, origin, code, class, brand, model_desc, body, years
 *     class  — A (automotor) | M (motovehículo)
 *     years  — "2015-2020", "2015;2017", "0KM;2024-2025" or empty (unknown)
 *
 * A real source must first be converted to this CSV by a person, locally (e.g. from a PDF the
 * source authorized). This module never downloads anything: URLs are refused, only local .csv files
 * up to MAX_INPUT_BYTES are read.
 */
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'

export interface RegistryRow {
  /** 1-based line in the input (header = line 1). */
  line: number
  recordId: string
  origin: string
  code: string
  vehicleClass: string
  brand: string
  modelDesc: string
  body: string
  years: string
}

export const MAX_INPUT_BYTES = 50 * 1024 * 1024
const REQUIRED = ['record_id', 'class', 'brand', 'model_desc', 'body', 'years'] as const

export class RegistryInputError extends Error {}

/** RFC 4180-style CSV (quotes, escaped quotes, commas / newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
      continue
    }
    if (ch === '"' && field === '') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (quoted) throw new RegistryInputError('Unterminated quoted field.')
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export function rowsFromCsv(text: string): RegistryRow[] {
  const table = parseCsv(text)
  const header = (table[0] ?? []).map((h) => h.trim().toLowerCase())
  const missing = REQUIRED.filter((c) => !header.includes(c))
  if (missing.length) throw new RegistryInputError(`Missing columns: ${missing.join(', ')}`)
  const col = (name: string) => header.indexOf(name)
  return table.slice(1).map((cells, i) => {
    const get = (name: string) => (col(name) >= 0 ? (cells[col(name)] ?? '').trim() : '')
    return {
      line: i + 2,
      recordId: get('record_id') || `line:${i + 2}`,
      origin: get('origin'),
      code: get('code'),
      vehicleClass: get('class').toUpperCase(),
      brand: get('brand'),
      modelDesc: get('model_desc'),
      body: get('body'),
      years: get('years'),
    }
  })
}

/** Reads a local CSV. Refuses URLs, non-.csv files and oversized inputs. */
export function readRegistryFile(path: string): { rows: RegistryRow[]; input: { name: string; sha256: string } } {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) throw new RegistryInputError('Only local files are accepted; URLs are refused (no downloads).')
  if (extname(path).toLowerCase() !== '.csv') throw new RegistryInputError('The input must be a local .csv file.')
  const size = statSync(path).size
  if (size > MAX_INPUT_BYTES) throw new RegistryInputError('Input file too large.')
  const buf = readFileSync(path)
  return { rows: rowsFromCsv(buf.toString('utf8')), input: { name: basename(path), sha256: createHash('sha256').update(buf).digest('hex') } }
}
