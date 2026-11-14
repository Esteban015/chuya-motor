/**
 * datasets.ts — Versioned catalog datasets shipped with the app (Incremento 7D.2, real catalog).
 *
 * DNRPA — Tabla de Valuación de Automotores y Motovehículos, vigencia 01/11/2026: identification
 * data only (brand, model, version text, registry body, model years, registry codes as provenance);
 * no valuations. Generated offline and reproducibly:
 *   npm run catalog:dnrpa-extract -- --pdf <tabla.pdf> --out <dir>
 *   npm run catalog:ingest -- --input <dir>/registry.csv --config data/vehicle-catalog/dnrpa/source.json --out data/vehicle-catalog/dnrpa-2026-11-01
 *
 * The file is read from disk ONCE per server instance (lazily, on the first catalog request),
 * integrity-checked (StaticCatalogProvider) and indexed. It is never sent to the browser.
 * next.config.ts includes it in the server bundles that need it (outputFileTracingIncludes).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VehicleCatalogProvider } from '@/domain/vehicle/vehicle-catalog'
import { StaticCatalogProvider } from './static-catalog-provider'

export const DNRPA_DATASET_PATH = join('data', 'vehicle-catalog', 'dnrpa-2026-11-01', 'dataset.json')

let dnrpa: { provider: StaticCatalogProvider | null } | null = null

/** The real DNRPA-derived catalog, or null if the file is missing / unreadable / fails integrity. */
export function loadDnrpaCatalog(cwd: string = process.cwd()): VehicleCatalogProvider | null {
  if (dnrpa) return dnrpa.provider
  try {
    const provider = new StaticCatalogProvider(JSON.parse(readFileSync(join(cwd, DNRPA_DATASET_PATH), 'utf8')))
    dnrpa = { provider: provider.problems.length === 0 ? provider : null }
  } catch {
    dnrpa = { provider: null }
  }
  return dnrpa.provider
}

/**
 * Cheap check used by server pages to decide whether to render the selector, WITHOUT loading the
 * 7 MB dataset on the page request (the first catalog API call loads it). If the file later fails
 * its integrity check, the API answers 404/503 and the selector falls back to manual entry.
 */
export function dnrpaDatasetPresent(cwd: string = process.cwd()): boolean {
  if (dnrpa) return dnrpa.provider !== null
  try {
    return existsSync(join(cwd, DNRPA_DATASET_PATH))
  } catch {
    return false
  }
}

export function resetDatasetsForTests(): void {
  dnrpa = null
}
