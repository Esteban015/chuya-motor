/**
 * catalog-config.ts — Vehicle catalog switch and source selection (7D.1 → 7D.2 real catalog).
 * Server-side only; read at request time.
 *
 *   VEHICLE_CATALOG_ENABLED   — ON by default since the real catalog exists; "false" turns it OFF
 *                               (kill switch: the forms go back to free-text fields).
 *   VEHICLE_CATALOG_SOURCE    — "dnrpa" (default: real catalog, data/vehicle-catalog/dnrpa-…)
 *                               | "fixture" (SYNTHETIC test data; never on public production).
 *
 * If the real dataset is missing or fails its integrity check, the catalog is OFF (manual entry):
 * a fictitious catalog is never used as a fallback for real users.
 */
import type { VehicleCatalogProvider } from '@/domain/vehicle/vehicle-catalog'
import { dnrpaDatasetPresent, loadDnrpaCatalog } from './datasets'
import { FIXTURE_CATALOG } from './fixture-catalog'
import { StaticCatalogProvider, withCatalogTimeout } from './static-catalog-provider'

type Env = Record<string, string | undefined>

export const CATALOG_TIMEOUT_MS = 3_000

let fixtureProvider: VehicleCatalogProvider | null = null
let dnrpaProvider: { inner: VehicleCatalogProvider; wrapped: VehicleCatalogProvider } | null = null

export type CatalogSource = 'dnrpa' | 'fixture'

/** Which source the configuration asks for (no data is loaded here). null = catalog OFF. */
export function configuredCatalogSource(env: Env = process.env): CatalogSource | null {
  const enabled = (env['VEHICLE_CATALOG_ENABLED'] ?? '').trim().toLowerCase()
  if (enabled === 'false' || enabled === '0' || enabled === 'off') return null
  const source = (env['VEHICLE_CATALOG_SOURCE'] ?? '').trim().toLowerCase() || 'dnrpa'
  if (source === 'fixture') return env['VERCEL_ENV'] === 'production' ? null : 'fixture'
  return source === 'dnrpa' ? 'dnrpa' : null
}

/** The provider to use, or null when the catalog is off / unavailable (callers fall back to manual). */
export function getVehicleCatalog(env: Env = process.env): VehicleCatalogProvider | null {
  const source = configuredCatalogSource(env)
  if (source === 'fixture') {
    fixtureProvider ??= withCatalogTimeout(new StaticCatalogProvider(FIXTURE_CATALOG), CATALOG_TIMEOUT_MS)
    return fixtureProvider
  }
  if (source === 'dnrpa') {
    const inner = loadDnrpaCatalog()
    if (!inner) return null
    if (!dnrpaProvider || dnrpaProvider.inner !== inner) dnrpaProvider = { inner, wrapped: withCatalogTimeout(inner, CATALOG_TIMEOUT_MS) }
    return dnrpaProvider.wrapped
  }
  return null
}

/**
 * Whether the forms should render the VehicleSelector (server pages, request time). Does NOT load
 * the real dataset (a page render must not pay the ~0.5 s cold load): it checks the configuration
 * and that the versioned file is present. The catalog API loads and integrity-checks it.
 */
export function isVehicleCatalogEnabled(env: Env = process.env): boolean {
  const source = configuredCatalogSource(env)
  if (source === 'fixture') return true
  if (source === 'dnrpa') return dnrpaDatasetPresent()
  return false
}
