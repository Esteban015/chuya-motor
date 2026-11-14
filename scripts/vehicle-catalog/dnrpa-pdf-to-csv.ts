/**
 * scripts/vehicle-catalog/dnrpa-pdf-to-csv.ts — DNRPA valuation table PDF → registry CSV
 * (identification only, no valuations) + extraction report. Offline and reproducible.
 *
 *   npm run catalog:dnrpa-extract -- --pdf <local.pdf> --out <dir>
 *   npm run catalog:dnrpa-extract -- --raw <raw.txt> --table <table.txt> --out <dir>
 *
 * Requires xpdf `pdftotext` 4.x on PATH (uses `-raw` and `-table`; Poppler has no `-table`).
 * The PDF must be a local file obtained by a person from the official site; this script never
 * downloads anything. Output: registry.csv, extraction-report.json (with the PDF SHA-256).
 * Then: npm run catalog:ingest -- --input <dir>/registry.csv --config data/vehicle-catalog/dnrpa/source.json --out …
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractDnrpaRows, rowsToCsv } from '../../src/server/vehicle-catalog/sources/dnrpa-extract'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function main(): number {
  const out = arg('out')
  const pdf = arg('pdf')
  let rawPath = arg('raw')
  let tablePath = arg('table')
  if (!out || (!pdf && !(rawPath && tablePath))) {
    console.error('Uso: --pdf <archivo.pdf local> --out <carpeta>   |   --raw <raw.txt> --table <table.txt> --out <carpeta>')
    return 2
  }
  let pdfSha256: string | null = null
  if (pdf) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pdf)) throw new Error('Solo archivos locales: no se descarga nada.')
    pdfSha256 = createHash('sha256').update(readFileSync(pdf)).digest('hex')
    const tmp = mkdtempSync(join(tmpdir(), 'dnrpa-'))
    rawPath = join(tmp, 'raw.txt')
    tablePath = join(tmp, 'table.txt')
    // `pdftotext -v` prints to stderr and exits non-zero on xpdf: read it, do not treat it as a failure.
    const v = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' })
    const version = `${v.stdout ?? ''}${v.stderr ?? ''}`.trim() || 'pdftotext'
    console.log(`Usando ${version.split('\n')[0]}`)
    execFileSync('pdftotext', ['-raw', '-enc', 'UTF-8', pdf, rawPath])
    execFileSync('pdftotext', ['-table', '-enc', 'UTF-8', pdf, tablePath])
  }
  const { rows, report } = extractDnrpaRows(readFileSync(rawPath!, 'utf8'), readFileSync(tablePath!, 'utf8'))
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'registry.csv'), rowsToCsv(rows))
  writeFileSync(join(out, 'extraction-report.json'), JSON.stringify({ pdfSha256, ...report }, null, 2))
  console.log(`Vigencia ${report.validFrom} · ${report.pages} páginas · ${report.rows} filas (${report.automotores} automotores, ${report.motovehiculos} motos)`)
  console.log(`Años alineados ${report.yearsAligned} · sin alinear ${report.yearsUnaligned} · sin valores ${report.rowsWithoutValues}`)
  console.log(`Marca no resuelta ${report.brandUnresolved} · carrocería no reconocida ${report.bodyNotRecognized}`)
  return 0
}

process.exitCode = main()
