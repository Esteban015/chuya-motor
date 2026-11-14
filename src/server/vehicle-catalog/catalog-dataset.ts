/**
 * catalog-dataset.ts — Versioned local vehicle catalog format (schema v2, Incremento 7D.2).
 *
 * One JSON document per catalog version, generated OFFLINE by the ingestion tool (ingest/) from a
 * local file of an AUTHORIZED source, reviewed by a person, then shipped with the app. Nothing is
 * downloaded at runtime and the browser receives one level at a time, never the whole dataset.
 *
 *   manifest  — catalog version, generation date, generator, source (id, edition, date, license
 *               status + reference) and a SHA-256 of the content (tamper / corruption check).
 *   types     — product categories (auto, moto, pickup, suv, utilitario, camion, otro).
 *   brands    — stable ID, display name, aliases (other spellings / registry names), types.
 *   models    — stable ID, brand, type, name, aliases, discontinued, years (null = unknown),
 *               provenance.
 *   versions  — stable ID, model, label verbatim, registry body, years, engine ONLY if documented
 *               (displacement / fuel + evidence), `missing` fields listed explicitly,
 *               verification (source_listed / source_conflict) and provenance (source row IDs +
 *               raw text).
 *   retired   — IDs removed since a previous catalog version → replacement ID or null.
 *
 * Only `synthetic` and `authorized` licenses are servable; `pending` / `denied` datasets are never
 * served (integrity problem `license_not_distributable`).
 */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  BrandIdSchema,
  CATALOG_SCHEMA_VERSION,
  DISTRIBUTABLE_LICENSES,
  FUEL_KINDS,
  MISSING_FIELDS,
  ModelIdSchema,
  TypeIdSchema,
  VEHICLE_CATEGORIES,
  VersionIdSchema,
  catalogKey,
} from '@/domain/vehicle/vehicle-catalog'

const Year = z.number().int().min(1900).max(2100)
const Label = z.string().trim().min(1).max(120)
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const AnyId = z.union([TypeIdSchema, BrandIdSchema, ModelIdSchema, VersionIdSchema])
const ProvenanceSchema = z.object({ sourceRecordIds: z.array(z.string().min(1).max(80)).min(1).max(50), rawText: z.string().max(300) })

export const CatalogSourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(60),
  publishedAt: Day,
  kind: z.enum(['fixture', 'registry', 'price_guide', 'technical']),
  isFixture: z.boolean(),
  license: z.object({ status: z.enum(['synthetic', 'authorized', 'public_information', 'pending', 'denied']), reference: z.string().max(600).optional() }),
  attribution: z.string().max(200).optional(),
  /** 7D.2 traceability: official URL and SHA-256 of the exact source document that was processed. */
  url: z.string().url().max(300).optional(),
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
})

/** What a model's identification owes to a reviewed editorial decision instead of the source text. */
export const EDITORIAL_FIELDS = ['brand', 'category', 'family', 'name'] as const

export const CatalogDatasetSchema = z.object({
  schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
  manifest: z.object({
    catalogVersion: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,59}$/),
    generatedAt: z.string().datetime(),
    generator: z.string().min(1).max(60),
    source: CatalogSourceSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    /** Fields DERIVED by the pipeline (not read from the source), with the rule used. */
    derivations: z.record(z.string().max(40), z.string().max(300)).optional(),
  }),
  types: z.array(z.object({ id: TypeIdSchema, category: z.enum(VEHICLE_CATEGORIES), label: Label })),
  brands: z.array(z.object({ id: BrandIdSchema, name: Label, aliases: z.array(Label).max(20), typeIds: z.array(TypeIdSchema).min(1) })),
  models: z.array(
    z.object({
      id: ModelIdSchema,
      brandId: BrandIdSchema,
      typeId: TypeIdSchema,
      name: Label,
      aliases: z.array(Label).max(20),
      discontinued: z.boolean(),
      years: z.array(Year).nullable(),
      provenance: ProvenanceSchema,
      /** Parts of this model's identification that are editorial (reviewed), not from the source. */
      editorial: z.array(z.enum(EDITORIAL_FIELDS)).optional(),
    }),
  ),
  versions: z.array(
    z.object({
      id: VersionIdSchema,
      modelId: ModelIdSchema,
      label: Label,
      body: z.string().trim().min(1).max(60).nullable(),
      years: z.array(Year).nullable(),
      engine: z
        .object({
          displacementL: z.number().positive().max(20).optional(),
          fuel: z.enum(FUEL_KINDS).optional(),
          evidence: z.enum(['structured', 'label']),
        })
        .nullable(),
      missing: z.array(z.enum(MISSING_FIELDS)),
      verification: z.enum(['source_listed', 'source_conflict']),
      provenance: ProvenanceSchema,
    }),
  ),
  retired: z.record(AnyId, AnyId.nullable()),
})
export type CatalogDataset = z.infer<typeof CatalogDatasetSchema>
export type DatasetVersion = CatalogDataset['versions'][number]

// ── Hash ──────────────────────────────────────────────────────────────────────

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** SHA-256 of the dataset content (canonical JSON), excluding manifest.sha256 itself. */
export function computeDatasetHash(d: CatalogDataset): string {
  const { sha256: _ignored, ...manifest } = d.manifest
  return createHash('sha256').update(stable({ ...d, manifest })).digest('hex')
}

export function withDatasetHash(d: CatalogDataset): CatalogDataset {
  return { ...d, manifest: { ...d.manifest, sha256: computeDatasetHash(d) } }
}

// ── Integrity ─────────────────────────────────────────────────────────────────

/** Structural problems of a dataset (empty = valid). Codes only, no user data. */
export function checkCatalogIntegrity(raw: unknown): string[] {
  return analyzeDataset(raw).problems
}

/** Parses the dataset ONCE and returns it with its integrity problems (used by the provider). */
export function analyzeDataset(raw: unknown): { dataset: CatalogDataset | null; problems: string[] } {
  const parsed = CatalogDatasetSchema.safeParse(raw)
  if (!parsed.success) return { dataset: null, problems: parsed.error.issues.slice(0, 20).map((i) => `schema:${i.path.join('.')}`) }
  const problems = integrityProblems(parsed.data)
  return { dataset: parsed.data, problems }
}

function integrityProblems(d: CatalogDataset): string[] {
  const problems: string[] = []
  const add = (p: string) => problems.length < 200 && problems.push(p)

  // License / provenance of the whole dataset.
  const src = d.manifest.source
  if (!DISTRIBUTABLE_LICENSES.includes(src.license.status)) add('license_not_distributable')
  if ((src.license.status === 'authorized' || src.license.status === 'public_information') && !src.license.reference) add('license_reference_missing')
  if (src.license.status === 'public_information' && !src.attribution) add('attribution_missing')
  if (src.isFixture !== (src.license.status === 'synthetic')) add('fixture_license_mismatch')
  if (d.manifest.sha256 && d.manifest.sha256 !== computeDatasetHash(d)) add('hash_mismatch')

  const dupIds = (ids: string[], what: string) => {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) add(`duplicate_${what}:${id}`)
      seen.add(id)
    }
  }
  dupIds(d.types.map((t) => t.id), 'type')
  dupIds(d.brands.map((b) => b.id), 'brand')
  dupIds(d.models.map((m) => m.id), 'model')
  dupIds(d.versions.map((v) => v.id), 'version')

  const types = new Set(d.types.map((t) => t.id))
  const brands = new Map(d.brands.map((b) => [b.id, b]))
  const models = new Map(d.models.map((m) => [m.id, m]))
  const versions = new Set(d.versions.map((v) => v.id))

  // Repeated brands under different IDs (same name or alias key).
  const brandKeys = new Map<string, string>()
  for (const b of d.brands) {
    for (const key of [catalogKey(b.name), ...b.aliases.map(catalogKey)]) {
      const owner = brandKeys.get(key)
      if (owner && owner !== b.id) add(`duplicate_brand_name:${b.id}`)
      brandKeys.set(key, b.id)
    }
    for (const t of b.typeIds) if (!types.has(t)) add(`brand_unknown_type:${b.id}`)
  }

  const modelKeys = new Map<string, string>()
  for (const m of d.models) {
    const b = brands.get(m.brandId)
    if (!b) add(`model_unknown_brand:${m.id}`)
    else if (!b.typeIds.includes(m.typeId)) add(`model_type_not_listed_for_brand:${m.id}`)
    if (!types.has(m.typeId)) add(`model_unknown_type:${m.id}`)
    for (const key of [catalogKey(m.name), ...m.aliases.map(catalogKey)]) {
      const scoped = `${m.brandId}|${m.typeId}|${key}`
      const owner = modelKeys.get(scoped)
      if (owner && owner !== m.id) add(`duplicate_model_name:${m.id}`)
      modelKeys.set(scoped, m.id)
    }
    if (m.years && new Set(m.years).size !== m.years.length) add(`model_duplicate_years:${m.id}`)
  }

  const versionKeys = new Map<string, string>()
  for (const v of d.versions) {
    const m = models.get(v.modelId)
    if (!m) {
      add(`version_unknown_model:${v.id}`)
      continue
    }
    const scoped = `${v.modelId}|${catalogKey(v.label)}|${catalogKey(v.body ?? '')}`
    if (versionKeys.has(scoped)) add(`duplicate_version_label:${v.id}`)
    versionKeys.set(scoped, v.id)
    if (v.years && m.years && v.years.some((y) => !m.years!.includes(y))) add(`version_years_outside_model:${v.id}`)
    if (v.years && m.years === null) add(`version_years_but_model_unknown:${v.id}`)
    // `missing` must match the data exactly: nothing filled in silently, nothing hidden.
    const expected = new Set<string>()
    if (v.years === null) expected.add('years')
    if (v.body === null) expected.add('body')
    if (v.engine?.displacementL === undefined) expected.add('displacement')
    if (v.engine?.fuel === undefined) expected.add('fuel')
    const declared = new Set<string>(v.missing)
    if (expected.size !== declared.size || [...expected].some((f) => !declared.has(f))) add(`missing_fields_mismatch:${v.id}`)
    if (v.engine && v.engine.displacementL === undefined && v.engine.fuel === undefined) add(`empty_engine:${v.id}`)
  }

  const live = new Set<string>([...types, ...brands.keys(), ...models.keys(), ...versions])
  for (const [oldId, replacement] of Object.entries(d.retired)) {
    if (live.has(oldId)) add(`retired_id_still_live:${oldId}`)
    if (replacement && !live.has(replacement)) add(`retired_replacement_unknown:${oldId}`)
    if (replacement && replacement.slice(0, 2) !== oldId.slice(0, 2)) add(`retired_replacement_other_level:${oldId}`)
  }
  return problems
}

// ── Diff between catalog versions ─────────────────────────────────────────────

export interface CatalogDiff {
  from: string
  to: string
  added: string[]
  removed: string[]
  /** Removed IDs without an entry in `retired`: saved selections would silently break. */
  removedWithoutRetirement: string[]
  renamed: Array<{ id: string; from: string; to: string }>
  yearsChanged: string[]
  engineChanged: string[]
}

export function diffCatalogs(prev: CatalogDataset, next: CatalogDataset): CatalogDiff {
  const entries = (d: CatalogDataset) =>
    new Map<string, { name: string; years?: number[] | null; engine?: unknown }>([
      ...d.types.map((t) => [t.id, { name: t.label }] as const),
      ...d.brands.map((b) => [b.id, { name: b.name }] as const),
      ...d.models.map((m) => [m.id, { name: m.name, years: m.years }] as const),
      ...d.versions.map((v) => [v.id, { name: v.label, years: v.years, engine: v.engine }] as const),
    ])
  const a = entries(prev)
  const b = entries(next)
  const removed = [...a.keys()].filter((id) => !b.has(id))
  const diff: CatalogDiff = {
    from: prev.manifest.catalogVersion,
    to: next.manifest.catalogVersion,
    added: [...b.keys()].filter((id) => !a.has(id)),
    removed,
    removedWithoutRetirement: removed.filter((id) => !(id in next.retired)),
    renamed: [],
    yearsChanged: [],
    engineChanged: [],
  }
  for (const [id, x] of a) {
    const y = b.get(id)
    if (!y) continue
    if (x.name !== y.name) diff.renamed.push({ id, from: x.name, to: y.name })
    if (stable(x.years ?? null) !== stable(y.years ?? null)) diff.yearsChanged.push(id)
    if (stable(x.engine ?? null) !== stable(y.engine ?? null)) diff.engineChanged.push(id)
  }
  return diff
}
