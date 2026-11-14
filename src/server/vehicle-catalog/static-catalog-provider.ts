/**
 * static-catalog-provider.ts — VehicleCatalogProvider over a local, versioned dataset (7D.1, 7D.2).
 *
 * The catalog is served from local versioned data generated offline (catalog-dataset.ts, ingest/)
 * — never by calling a third-party API per visit, never via SerpApi or an LLM.
 *
 * The dataset is integrity-checked once (catalog-dataset.ts: schema, license, hash, IDs, parents,
 * repeated names, missing-field consistency, retired IDs). A broken or non-distributable dataset is
 * never served: every call answers INVALID_DATA and the UI falls back to manual entry.
 * Lookups use indexes built once (type → brands, brand+type → models, model → versions), so a
 * request never scans the whole catalog. Answers are pre-sorted and frozen-by-copy.
 */
import {
  catalogKey,
  type CatalogBrand,
  type CatalogMeta,
  type CatalogModel,
  type CatalogResult,
  type CatalogType,
  type CatalogVersion,
  type VehicleCatalogProvider,
} from '@/domain/vehicle/vehicle-catalog'
import { analyzeDataset, type CatalogDataset } from './catalog-dataset'

export { checkCatalogIntegrity, type CatalogDataset } from './catalog-dataset'

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'es')

interface Index {
  types: CatalogType[]
  typeIds: Set<string>
  brandsByType: Map<string, CatalogBrand[]>
  brandTypes: Map<string, string[]>
  modelsByBrandType: Map<string, CatalogModel[]>
  modelYears: Map<string, number[] | null>
  versionsByModel: Map<string, CatalogVersion[]>
  retired: Record<string, string | null>
}

function buildIndex(d: CatalogDataset): Index {
  const brandsByType = new Map<string, CatalogBrand[]>()
  const brandTypes = new Map<string, string[]>()
  for (const b of d.brands) {
    brandTypes.set(b.id, [...b.typeIds])
    const brand: CatalogBrand = { id: b.id, name: b.name, key: catalogKey(b.name), aliases: [...b.aliases], typeIds: [...b.typeIds] }
    for (const t of b.typeIds) {
      if (!brandsByType.has(t)) brandsByType.set(t, [])
      brandsByType.get(t)!.push(brand)
    }
  }
  for (const list of brandsByType.values()) list.sort(byName)

  const modelsByBrandType = new Map<string, CatalogModel[]>()
  const modelYears = new Map<string, number[] | null>()
  for (const m of d.models) {
    const k = `${m.typeId}|${m.brandId}`
    if (!modelsByBrandType.has(k)) modelsByBrandType.set(k, [])
    modelsByBrandType.get(k)!.push({ id: m.id, brandId: m.brandId, typeId: m.typeId, name: m.name, key: catalogKey(m.name), aliases: [...m.aliases], discontinued: m.discontinued, ...(m.editorial?.length ? { editorial: [...m.editorial] } : {}) })
    modelYears.set(m.id, m.years ? [...new Set(m.years)].sort((a, b) => b - a) : null)
  }
  for (const list of modelsByBrandType.values()) list.sort(byName)

  const versionsByModel = new Map<string, CatalogVersion[]>()
  for (const v of d.versions) {
    if (!versionsByModel.has(v.modelId)) versionsByModel.set(v.modelId, [])
    versionsByModel.get(v.modelId)!.push({ ...v, years: v.years ? [...v.years].sort((a, b) => b - a) : null })
  }
  for (const list of versionsByModel.values()) list.sort((a, b) => a.label.localeCompare(b.label, 'es') || (a.body ?? '').localeCompare(b.body ?? '', 'es'))

  return {
    types: d.types.map((t) => ({ ...t })),
    typeIds: new Set(d.types.map((t) => t.id)),
    brandsByType,
    brandTypes,
    modelsByBrandType,
    modelYears,
    versionsByModel,
    retired: { ...d.retired },
  }
}

const copyVersion = (v: CatalogVersion): CatalogVersion => ({
  ...v,
  years: v.years ? [...v.years] : null,
  engine: v.engine ? { ...v.engine } : null,
  missing: [...v.missing],
  ...(v.provenance ? { provenance: { sourceRecordIds: [...v.provenance.sourceRecordIds], rawText: v.provenance.rawText } } : {}),
})

export class StaticCatalogProvider implements VehicleCatalogProvider {
  readonly meta: CatalogMeta
  readonly problems: string[]
  readonly #ix: Index | null

  constructor(raw: unknown) {
    const { dataset, problems } = analyzeDataset(raw)
    this.problems = problems
    this.#ix = problems.length === 0 && dataset ? buildIndex(dataset) : null
    const src = dataset ? dataset.manifest.source : null
    this.meta = dataset && src
      ? {
          source: src.id,
          version: dataset.manifest.catalogVersion,
          kind: src.kind,
          isFixture: src.isFixture,
          sourceVersion: src.version,
          sourcePublishedAt: src.publishedAt,
          licenseStatus: src.license.status,
          ...(src.attribution ? { attribution: src.attribution } : {}),
          ...(src.url ? { sourceUrl: src.url } : {}),
        }
      : { source: 'invalid', version: 'invalid', kind: 'fixture', isFixture: true }
  }

  #ok<T>(data: T): CatalogResult<T> {
    return { ok: true, data, meta: this.meta }
  }

  async listTypes(): Promise<CatalogResult<CatalogType[]>> {
    if (!this.#ix) return { ok: false, error: 'INVALID_DATA' }
    return this.#ok(this.#ix.types.map((t) => ({ ...t })))
  }

  async listBrands(typeId: string): Promise<CatalogResult<CatalogBrand[]>> {
    const ix = this.#ix
    if (!ix) return { ok: false, error: 'INVALID_DATA' }
    if (!ix.typeIds.has(typeId)) return { ok: false, error: 'NOT_FOUND' }
    return this.#ok((ix.brandsByType.get(typeId) ?? []).map((b) => ({ ...b, aliases: [...b.aliases], typeIds: [...b.typeIds] })))
  }

  async listModels(typeId: string, brandId: string): Promise<CatalogResult<CatalogModel[]>> {
    const ix = this.#ix
    if (!ix) return { ok: false, error: 'INVALID_DATA' }
    if (!ix.brandTypes.get(brandId)?.includes(typeId)) return { ok: false, error: 'NOT_FOUND' }
    return this.#ok((ix.modelsByBrandType.get(`${typeId}|${brandId}`) ?? []).map((m) => ({ ...m, aliases: [...m.aliases], ...(m.editorial ? { editorial: [...m.editorial] } : {}) })))
  }

  async listYears(modelId: string): Promise<CatalogResult<number[] | null>> {
    const ix = this.#ix
    if (!ix) return { ok: false, error: 'INVALID_DATA' }
    if (!ix.modelYears.has(modelId)) return { ok: false, error: 'NOT_FOUND' }
    const years = ix.modelYears.get(modelId)!
    return this.#ok(years ? [...years] : null)
  }

  async listVersions(modelId: string, year: number | null): Promise<CatalogResult<CatalogVersion[]>> {
    const ix = this.#ix
    if (!ix) return { ok: false, error: 'INVALID_DATA' }
    if (!ix.modelYears.has(modelId)) return { ok: false, error: 'NOT_FOUND' }
    const list = ix.versionsByModel.get(modelId) ?? []
    return this.#ok(list.filter((v) => year === null || v.years === null || v.years.includes(year)).map(copyVersion))
  }

  retiredReplacement(id: string): string | null | undefined {
    if (!this.#ix || !(id in this.#ix.retired)) return undefined
    return this.#ix.retired[id] ?? null
  }
}

/** Wraps a provider so no call can hang: after `ms` it answers TIMEOUT; a throw becomes UNAVAILABLE. */
export function withCatalogTimeout(inner: VehicleCatalogProvider, ms: number): VehicleCatalogProvider {
  const guard = async <T>(call: () => Promise<CatalogResult<T>>): Promise<CatalogResult<T>> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<CatalogResult<T>>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: 'TIMEOUT' }), ms)
    })
    try {
      return await Promise.race([call().catch((): CatalogResult<T> => ({ ok: false, error: 'UNAVAILABLE' })), timeout])
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    meta: inner.meta,
    listTypes: () => guard(() => inner.listTypes()),
    listBrands: (t) => guard(() => inner.listBrands(t)),
    listModels: (t, b) => guard(() => inner.listModels(t, b)),
    listYears: (m) => guard(() => inner.listYears(m)),
    listVersions: (m, y) => guard(() => inner.listVersions(m, y)),
    retiredReplacement: (id) => {
      try {
        return inner.retiredReplacement(id)
      } catch {
        return undefined
      }
    },
  }
}
