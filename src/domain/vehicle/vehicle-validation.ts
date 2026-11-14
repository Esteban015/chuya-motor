/**
 * vehicle-validation.ts — Server-side resolution of the vehicle sent by a client (7D.1, 7D.2).
 *
 * The browser may send free-text fields (legacy clients) and, optionally, catalog IDs chosen in the
 * VehicleSelector. The server never trusts the client: it re-walks tipo ∋ marca ∋ modelo
 * (∋ año / versión) and computes the IDENTIFICATION level itself (vehicle.ts). Identification is
 * not parts compatibility: no level certifies that a part fits.
 *
 *   - No IDs                                       → user_declared (free text, as before 7D).
 *   - Catalog off / failing / timing out           → user_declared + catalog_unavailable.
 *   - IDs that do not belong together              → user_declared + catalog_mismatch (ALL IDs dropped).
 *   - Retired ID with a replacement                → replacement used + catalog_id_migrated.
 *   - Retired ID without replacement               → user_declared + catalog_id_retired.
 *   - Only type / type + brand                     → identity_partial.
 *   - Model verified, year / version unconfirmed   → identity_basic.
 *   - Everything listed consistently               → identity_full.
 *   - Contradictions                               → identity_conflict (the year is kept as declared).
 *
 * With valid IDs, names come from the catalog (client names ignored). Engine / fuel come from the
 * catalog only when the chosen version documents them; otherwise they stay as declared or unknown.
 */
import { z } from 'zod'
import type { Vehicle, VehicleType, FuelType, VehicleValidation } from './vehicle'
import {
  BrandIdSchema,
  CATEGORY_TO_LEGACY,
  FUEL_TO_LEGACY,
  ModelIdSchema,
  TypeIdSchema,
  VersionIdSchema,
  type CatalogMeta,
  type VehicleCatalogProvider,
} from './vehicle-catalog'

export const CatalogSelectionInputSchema = z
  .object({
    typeId: TypeIdSchema,
    brandId: BrandIdSchema.optional(),
    modelId: ModelIdSchema.optional(),
    versionId: VersionIdSchema.optional(),
    /** "No sé el año". */
    yearUnknown: z.boolean().optional(),
    /** "No conozco el motor / la versión". */
    engineUnknown: z.boolean().optional(),
    /** Catalog version the client saw (informational). */
    catalogVersion: z.string().max(60).optional(),
  })
  .strict()
export type CatalogSelectionInput = z.infer<typeof CatalogSelectionInputSchema>

export interface DeclaredVehicle {
  make?: string
  model?: string
  year?: number
  vehicleType?: VehicleType
  fuelType?: FuelType
  engine?: string
}

export type VehicleIssue =
  | 'catalog_unavailable'
  | 'catalog_mismatch'
  | 'catalog_version_changed'
  | 'catalog_id_migrated'
  | 'catalog_id_retired'
  | 'year_not_listed'
  | 'year_unverified'
  | 'version_mismatch'
  | 'year_not_listed_for_version'
  | 'fuel_conflict'
  | 'version_source_conflict'

export interface ResolvedVehicle {
  vehicle: Vehicle
  issues: VehicleIssue[]
}

/** Issues that mean the catalog contradicts the data (→ identity_conflict). */
const CONFLICT_ISSUES: VehicleIssue[] = ['year_not_listed', 'year_not_listed_for_version', 'fuel_conflict', 'version_source_conflict']

function declaredOnly(d: DeclaredVehicle, sel: CatalogSelectionInput | undefined, issues: VehicleIssue[]): ResolvedVehicle {
  const v: Vehicle = { validation: 'user_declared' }
  if (d.make) v.make = d.make
  if (d.model) v.model = d.model
  if (d.year !== undefined && !sel?.yearUnknown) v.year = d.year
  if (d.vehicleType) v.vehicleType = d.vehicleType
  if (d.fuelType) {
    v.fuelType = d.fuelType
    v.fuelSource = 'declared'
  }
  if (d.engine && !sel?.engineUnknown) {
    v.engine = d.engine
    v.engineSource = 'declared'
  }
  return { vehicle: v, issues }
}

const provenance = (meta: CatalogMeta) => ({ source: meta.source, version: meta.version, isFixture: meta.isFixture })

/**
 * A model still on sale (not discontinued) may be sold as 0 km with a model year the source edition
 * does not list yet: a year after the last listed one, up to the edition's year + 1, is UNVERIFIED
 * (identity_basic), not a contradiction. For discontinued models it stays a contradiction.
 */
function isNewerThanListed(year: number, listed: number[], discontinued: boolean, sourcePublishedAt?: string): boolean {
  if (discontinued || !listed.length || !sourcePublishedAt) return false
  const editionYear = Number(sourcePublishedAt.slice(0, 4))
  return year > Math.max(...listed) && year <= editionYear + 1
}

/** Applies retired-ID replacements. Returns null when an ID was retired without replacement. */
function migrate(sel: CatalogSelectionInput, provider: VehicleCatalogProvider, issues: VehicleIssue[]): CatalogSelectionInput | null {
  const out: CatalogSelectionInput = { ...sel }
  for (const key of ['typeId', 'brandId', 'modelId', 'versionId'] as const) {
    const id = out[key]
    if (!id) continue
    const replacement = provider.retiredReplacement(id)
    if (replacement === undefined) continue
    if (replacement === null) {
      if (key === 'versionId') {
        // A dropped version does not invalidate the model: the version is simply unknown now.
        delete out.versionId
        issues.push('catalog_id_retired')
        continue
      }
      return null
    }
    out[key] = replacement
    if (!issues.includes('catalog_id_migrated')) issues.push('catalog_id_migrated')
  }
  return out
}

export async function resolveVehicle(
  declared: DeclaredVehicle,
  selection: CatalogSelectionInput | undefined,
  provider: VehicleCatalogProvider | null,
): Promise<ResolvedVehicle> {
  if (!selection) return declaredOnly(declared, undefined, [])
  if (!provider) return declaredOnly(declared, selection, ['catalog_unavailable'])

  // Provider errors other than NOT_FOUND mean "catalog unavailable", never "invalid vehicle".
  const fail = (error: string) => declaredOnly(declared, selection, [error === 'NOT_FOUND' ? 'catalog_mismatch' : 'catalog_unavailable'])
  const mismatch = () => declaredOnly(declared, selection, ['catalog_mismatch'])

  const issues: VehicleIssue[] = []
  const sel = migrate(selection, provider, issues)
  if (!sel) return declaredOnly(declared, selection, ['catalog_id_retired'])

  const types = await provider.listTypes()
  if (!types.ok) return fail(types.error)
  const type = types.data.find((t) => t.id === sel.typeId)
  if (!type) return mismatch()
  if (sel.catalogVersion && sel.catalogVersion !== types.meta.version) issues.push('catalog_version_changed')

  // Start from the declared data; catalog-backed levels overwrite it below.
  const base = declaredOnly(declared, sel, []).vehicle
  const v: Vehicle = { ...base, vehicleType: CATEGORY_TO_LEGACY[type.category], catalog: { ...provenance(types.meta), typeId: type.id } }

  const finish = (level: Exclude<VehicleValidation, 'user_declared' | 'identity_conflict'>): ResolvedVehicle => {
    const conflict = issues.some((i) => CONFLICT_ISSUES.includes(i))
    return { vehicle: { ...v, validation: conflict ? 'identity_conflict' : level }, issues }
  }

  if (!sel.brandId) {
    if (sel.modelId || sel.versionId) return mismatch()
    return finish('identity_partial')
  }
  const brands = await provider.listBrands(type.id)
  if (!brands.ok) return fail(brands.error)
  const brand = brands.data.find((b) => b.id === sel.brandId)
  if (!brand) return mismatch()
  v.make = brand.name.slice(0, 50)
  v.catalog = { ...v.catalog!, brandId: brand.id }

  if (!sel.modelId) {
    if (sel.versionId) return mismatch()
    delete v.model // a typed model name is not validated against this brand
    return finish('identity_partial')
  }
  const models = await provider.listModels(type.id, brand.id)
  if (!models.ok) return fail(models.error)
  const model = models.data.find((m) => m.id === sel.modelId)
  if (!model) return mismatch()
  v.model = model.name.slice(0, 50)
  v.catalog = { ...v.catalog!, modelId: model.id }

  // Year: kept as declared; checked against the model years when the source has them.
  let yearListed = false
  if (v.year !== undefined) {
    const years = await provider.listYears(model.id)
    if (!years.ok) return fail(years.error)
    if (years.data === null) issues.push('year_unverified')
    else if (years.data.includes(v.year)) yearListed = true
    else if (isNewerThanListed(v.year, years.data, model.discontinued, types.meta.sourcePublishedAt)) issues.push('year_unverified')
    else issues.push('year_not_listed')
  }

  let versionConfirmed = false
  if (sel.versionId) {
    const versions = await provider.listVersions(model.id, null)
    if (!versions.ok) return fail(versions.error)
    const version = versions.data.find((x) => x.id === sel.versionId)
    if (!version) {
      issues.push('version_mismatch')
    } else {
      v.version = version.label.slice(0, 120)
      v.catalog = { ...v.catalog!, versionId: version.id }
      if (version.verification === 'source_conflict') issues.push('version_source_conflict')
      if (v.year !== undefined && version.years && !version.years.includes(v.year)) issues.push('year_not_listed_for_version')
      if (version.engine) {
        v.engine = version.label.slice(0, 80)
        v.engineSource = 'catalog'
        if (version.engine.fuel) {
          const fuel = FUEL_TO_LEGACY[version.engine.fuel]
          if (declared.fuelType && declared.fuelType !== fuel) issues.push('fuel_conflict')
          v.fuelType = fuel
          v.fuelSource = 'catalog'
        }
      }
      // Full identification needs the source to list THIS year for THIS version.
      versionConfirmed = version.verification === 'source_listed' && version.years !== null && yearListed
    }
  }
  return finish(yearListed && versionConfirmed ? 'identity_full' : 'identity_basic')
}
