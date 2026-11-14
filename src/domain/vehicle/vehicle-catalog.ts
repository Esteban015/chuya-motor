/**
 * vehicle-catalog.ts — Source-agnostic vehicle catalog contract (Incremento 7D.1).
 *
 * Tipo → Marca → Modelo → Año → Versión. The rest of the app depends on these types only, never on
 * a concrete source. No real Argentine catalog is integrated yet (7D audit: no source is verified
 * for coverage AND permission of use); the only implementation is a clearly marked synthetic
 * fixture used in tests and behind a flag (src/server/vehicle-catalog).
 *
 * Rules:
 *   - IDs are OUR stable, opaque, namespaced IDs (t:/b:/m:/v:), never a provider's raw ID. Source
 *     references live apart (sourceRefs) so sources can change without breaking saved selections.
 *   - A version label is kept verbatim. Engine / fuel are only present when the SOURCE states them
 *     (`evidence`); nothing is inferred from a model or brand name.
 *   - Every response carries the catalog provenance (source, version, kind, isFixture).
 *
 * catalogKey() / displayName() reused from the Incremento 6.5 POC (stash, not applied).
 */
import { z } from 'zod'

// ── Categories ──────────────────────────────────────────────────────────────

export const VEHICLE_CATEGORIES = ['auto', 'moto', 'pickup', 'suv', 'utilitario', 'camion', 'otro'] as const
export type VehicleCategory = (typeof VEHICLE_CATEGORIES)[number]

export const CATEGORY_LABEL: Record<VehicleCategory, string> = {
  auto: 'Auto',
  moto: 'Moto',
  pickup: 'Pick-up',
  suv: 'SUV',
  utilitario: 'Utilitario',
  camion: 'Camión',
  otro: 'Otro',
}

/** Legacy `vehicleType` enum still accepted by POST /api/analyze (backward compatibility). */
export type LegacyVehicleType = 'sedan' | 'hatchback' | 'suv' | 'pickup' | 'van' | 'motorcycle' | 'other'

export const CATEGORY_TO_LEGACY: Record<VehicleCategory, LegacyVehicleType> = {
  auto: 'sedan',
  moto: 'motorcycle',
  pickup: 'pickup',
  suv: 'suv',
  utilitario: 'van',
  camion: 'other',
  otro: 'other',
}

// ── Fuel ────────────────────────────────────────────────────────────────────

export const FUEL_KINDS = ['nafta', 'diesel', 'gnc', 'hibrido', 'electrico'] as const
export type FuelKind = (typeof FUEL_KINDS)[number]
export type LegacyFuelType = 'gasoline' | 'diesel' | 'gnc' | 'hybrid' | 'electric' | 'other'

export const FUEL_TO_LEGACY: Record<FuelKind, LegacyFuelType> = {
  nafta: 'gasoline',
  diesel: 'diesel',
  gnc: 'gnc',
  hibrido: 'hybrid',
  electrico: 'electric',
}

export const LEGACY_FUEL_LABEL: Record<LegacyFuelType, string> = {
  gasoline: 'nafta',
  diesel: 'diésel',
  gnc: 'GNC',
  hybrid: 'híbrido',
  electric: 'eléctrico',
  other: 'otro',
}

// ── Stable IDs ──────────────────────────────────────────────────────────────

const slug = '[a-z0-9][a-z0-9-]{0,63}'
export const TypeIdSchema = z.string().regex(new RegExp(`^t:${slug}$`))
export const BrandIdSchema = z.string().regex(new RegExp(`^b:${slug}$`))
export const ModelIdSchema = z.string().regex(new RegExp(`^m:${slug}$`))
export const VersionIdSchema = z.string().regex(new RegExp(`^v:${slug}$`))
export type TypeId = z.infer<typeof TypeIdSchema>
export type BrandId = z.infer<typeof BrandIdSchema>
export type ModelId = z.infer<typeof ModelIdSchema>
export type VersionId = z.infer<typeof VersionIdSchema>

// ── Entities ────────────────────────────────────────────────────────────────

export type CatalogKind = 'fixture' | 'registry' | 'price_guide' | 'technical'

/** 7D.2 — versioned local dataset format (src/server/vehicle-catalog/catalog-dataset.ts). */
export const CATALOG_SCHEMA_VERSION = 2

/**
 * Basis for using the source. Servable:
 *   - synthetic          — our own fixtures;
 *   - authorized         — written permission or an explicit license (reference required);
 *   - public_information — official public information published by a national authority with no
 *                          published terms restricting reuse, reused under the general framework
 *                          of Ley 27.275 (principle of openness: formats that allow reuse and
 *                          redistribution by third parties). Requires the legal-basis reference
 *                          AND a visible attribution. It is an interpretation, NOT an individual
 *                          permission: the dataset records it as such.
 * Not servable: pending (not yet assessed / waiting for permission) and denied.
 */
export type LicenseStatus = 'synthetic' | 'authorized' | 'public_information' | 'pending' | 'denied'
export const DISTRIBUTABLE_LICENSES: readonly LicenseStatus[] = ['synthetic', 'authorized', 'public_information']

export interface CatalogSource {
  id: string
  name: string
  /** Version / edition of the source document (e.g. a disposition number). */
  version: string
  /** Date the source edition was published or took effect (YYYY-MM-DD). */
  publishedAt: string
  kind: CatalogKind
  isFixture: boolean
  license: { status: LicenseStatus; reference?: string }
  attribution?: string
  /** Official URL and SHA-256 of the exact document processed (traceability). */
  url?: string
  documentSha256?: string
}

export interface CatalogMeta {
  /** Source identifier, e.g. "fixture". Real sources are added only after a verified permission. */
  source: string
  /** Version of the local dataset (e.g. "fixture-2026-11-14.2"). */
  version: string
  kind: CatalogKind
  /** True for synthetic test data: the UI must say it is not a real catalog. */
  isFixture: boolean
  /** Edition and date of the source the dataset was built from. */
  sourceVersion?: string
  sourcePublishedAt?: string
  licenseStatus?: LicenseStatus
  /** Visible attribution, when the source requires it. */
  attribution?: string
  /** Official URL of the source document. */
  sourceUrl?: string
}

/** Fields a source did not document for a version. Listed explicitly, never filled in. */
export const MISSING_FIELDS = ['years', 'body', 'displacement', 'fuel'] as const
export type MissingField = (typeof MISSING_FIELDS)[number]

/**
 * Per-record verification inside the dataset:
 *   source_listed   — the source lists it consistently;
 *   source_conflict — the source itself is contradictory (e.g. duplicate rows with different years,
 *                     incompatible fuel markers). Served, but never as a full identification.
 */
export type RecordVerification = 'source_listed' | 'source_conflict'

/** Where a record comes from: source row references and the raw text, verbatim. */
export interface Provenance {
  sourceRecordIds: string[]
  rawText: string
}

export interface CatalogType {
  id: TypeId
  category: VehicleCategory
  label: string
}

export interface CatalogBrand {
  id: BrandId
  /** Display name. */
  name: string
  /** Matching key (catalogKey). */
  key: string
  /** Other spellings / registry names of the same brand (searchable). */
  aliases: string[]
  /** Types this brand is listed under (a brand can make cars and motorcycles). */
  typeIds: TypeId[]
}

export interface CatalogModel {
  id: ModelId
  brandId: BrandId
  typeId: TypeId
  name: string
  key: string
  /** Registry / alternative names (e.g. a registry code for a commercial name). */
  aliases: string[]
  /** No longer sold new — DERIVED by the pipeline (see manifest.derivations), not a source field. */
  discontinued: boolean
  /** Parts of the identification that are editorial (reviewed), not from the source text. */
  editorial?: Array<'brand' | 'category' | 'family' | 'name'>
}

export interface CatalogEngine {
  displacementL?: number
  fuel?: FuelKind
  /** "structured" = a field of the source; "label" = read from the source's version name. */
  evidence: 'structured' | 'label'
}

export interface CatalogVersion {
  id: VersionId
  modelId: ModelId
  /** Version label exactly as the source lists it. */
  label: string
  /** Model years listed for this version; null = the source does not say. */
  years: number[] | null
  /** Only when the source states it; null = unknown (never inferred). */
  engine: CatalogEngine | null
  /** Body as the source names it (registry body, e.g. "SEDAN 5 PUERTAS"); null = not stated. */
  body: string | null
  /** What the source does not document for this version. */
  missing: MissingField[]
  verification: RecordVerification
  /** Server-side only: stripped from API responses. */
  provenance?: Provenance
}

// ── Provider ────────────────────────────────────────────────────────────────

export type CatalogErrorCode = 'NOT_FOUND' | 'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_DATA'

export type CatalogResult<T> = { ok: true; data: T; meta: CatalogMeta } | { ok: false; error: CatalogErrorCode }

export interface VehicleCatalogProvider {
  readonly meta: CatalogMeta
  listTypes(): Promise<CatalogResult<CatalogType[]>>
  listBrands(typeId: TypeId): Promise<CatalogResult<CatalogBrand[]>>
  listModels(typeId: TypeId, brandId: BrandId): Promise<CatalogResult<CatalogModel[]>>
  /** Model years for a model; `null` data = the source has no year information for it. */
  listYears(modelId: ModelId): Promise<CatalogResult<number[] | null>>
  /** Versions of a model; `year` null = all versions (year unknown). */
  listVersions(modelId: ModelId, year: number | null): Promise<CatalogResult<CatalogVersion[]>>
  /**
   * IDs removed in a later catalog version: `undefined` = not retired, `null` = retired without a
   * replacement, string = the ID that replaces it (selections saved with an older catalog).
   */
  retiredReplacement(id: string): string | null | undefined
}

// ── Name normalization (reused from 6.5) ────────────────────────────────────

/** Matching key: lowercase, no accents, punctuation → space, single spaces. */
export function catalogKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const KEEP_UPPER = new Set(['BMW', 'DS', 'GMC', 'JAC', 'MG', 'RAM', 'BYD', 'KTM', 'GWM', 'BAIC', 'DFSK', 'JMC', 'SUV', 'GTI', 'GT', 'RS', 'AMG'])

/** Display name: "FIAT" → "Fiat", "ALFA ROMEO" → "Alfa Romeo"; acronyms and codes keep their case. */
export function displayName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => {
      if (KEEP_UPPER.has(w.toUpperCase()) || /\d/.test(w)) return w.toUpperCase()
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}
