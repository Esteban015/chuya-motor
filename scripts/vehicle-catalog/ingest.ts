/**
 * scripts/vehicle-catalog/ingest.ts — Offline catalog ingestion CLI (Incremento 7D.2).
 *
 *   npm run catalog:ingest -- --input <local.csv> --config <source.json> --out <dir> [--previous <dataset.json>]
 *
 * config (JSON): { "source": CatalogSource, "catalogVersion": "…", "overrides": IngestOverrides }
 *
 * - Reads LOCAL files only; never downloads (URLs are refused). No network, no LLM, no SerpApi.
 * - Always writes report.json + report.md (coverage, quality, quarantine, aliases, duplicates).
 * - Writes dataset.json ONLY when the source license is "synthetic" or "authorized" (with a
 *   reference) AND the result passes the integrity checks. A "pending" source (e.g. a public
 *   document without an explicit license) produces a report only.
 * - Output stays where you point it: nothing is copied into the app. Shipping a dataset is a
 *   separate, reviewed change.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CatalogDatasetSchema, CatalogSourceSchema } from '../../src/server/vehicle-catalog/catalog-dataset'
import { ingestRegistry, renderIngestReport } from '../../src/server/vehicle-catalog/ingest/ingest'
import { readRegistryFile } from '../../src/server/vehicle-catalog/ingest/registry-input'
import { VEHICLE_CATEGORIES } from '../../src/domain/vehicle/vehicle-catalog'

const ConfigSchema = z
  .object({
    source: CatalogSourceSchema,
    catalogVersion: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,59}$/),
    overrides: z
      .object({
        brandAliases: z.record(z.string(), z.string()).optional(),
        brandContinuations: z.record(z.string(), z.string()).optional(),
        multiWordFamilies: z.array(z.string()).optional(),
        categoryOverrides: z.record(z.string(), z.enum(VEHICLE_CATEGORIES)).optional(),
        modelNames: z.record(z.string(), z.string()).optional(),
        retiredReplacements: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function main(): number {
  const input = arg('input')
  const config = arg('config')
  const out = arg('out')
  if (!input || !config || !out) {
    console.error('Uso: --input <archivo.csv local> --config <fuente.json> --out <carpeta> [--previous <dataset.json>]')
    return 2
  }
  const cfg = ConfigSchema.parse(JSON.parse(readFileSync(config, 'utf8')))
  const prevPath = arg('previous')
  const previous = prevPath ? CatalogDatasetSchema.parse(JSON.parse(readFileSync(prevPath, 'utf8'))) : undefined
  const { rows, input: inputInfo } = readRegistryFile(input)

  const { dataset, report } = ingestRegistry(rows, {
    source: cfg.source,
    catalogVersion: cfg.catalogVersion,
    generatedAt: new Date().toISOString(),
    overrides: cfg.overrides,
    previous,
    input: inputInfo,
  })

  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  writeFileSync(join(out, 'report.md'), renderIngestReport(report))
  // Compact JSON: this file ships with the app (one level is served per request, never the whole file).
  if (report.distributable) writeFileSync(join(out, 'dataset.json'), JSON.stringify(dataset))

  const t = report.totals
  console.log(`Filas ${t.rows} · aceptadas ${t.accepted} · cuarentena ${t.quarantined} · rechazadas ${t.rejected}`)
  console.log(`Marcas ${t.brands} · modelos ${t.models} · versiones ${t.versions}`)
  console.log(report.distributable ? `dataset.json escrito en ${out}` : `Solo reporte: la fuente no es distribuible (licencia "${cfg.source.license.status}"${report.integrity.length ? `, ${report.integrity.length} problemas de integridad` : ''}).`)
  return 0
}

process.exitCode = main()
