/**
 * ingest.ts — Offline ingestion of an authorized registry-style source into a catalog dataset
 * (schema v2) plus a coverage / quality report (Incremento 7D.2).
 *
 * Pure: receives the rows of a LOCAL file (registry-input.ts) and options; never downloads
 * anything. Steps:
 *   1. reject rows without brand / model / known vehicle class;
 *   2. normalize brand / model text; merge brand spellings with the same key (reported as variants)
 *      or mapped explicitly (overrides.brandAliases); propose near-duplicate brands for review;
 *   3. resolve the product category from the registry body; ambiguous / unknown bodies go to
 *      QUARANTINE unless a reviewed override exists;
 *   4. parse years (invalid years dropped + reported; ambiguous tokens → quarantine);
 *   5. read displacement / fuel from the source text only (evidence "label"); contradictory fuel
 *      markers → fuel unknown + source_conflict;
 *   6. merge duplicate rows (same brand / description / body / category, e.g. imported and national
 *      registry codes) keeping every source row ID as provenance;
 *   7. assign deterministic stable IDs, retire IDs missing from the previous catalog version;
 *   8. integrity-check the result. Only `synthetic` / `authorized` sources are distributable.
 */
import { createHash } from 'node:crypto'
import {
  CATEGORY_LABEL,
  DISTRIBUTABLE_LICENSES,
  VEHICLE_CATEGORIES,
  catalogKey,
  displayName,
  type CatalogSource,
  type MissingField,
  type VehicleCategory,
} from '@/domain/vehicle/vehicle-catalog'
import { checkCatalogIntegrity, diffCatalogs, withDatasetHash, type CatalogDataset, type CatalogDiff, type DatasetVersion } from '../catalog-dataset'
import { canonicalText, categoryFromBody, looksLikeRegistryCode, modelFamily, parseEngineFromLabel, parseYears, slug } from './normalize'
import type { RegistryRow } from './registry-input'

export interface IngestOverrides {
  /** Brand key → canonical brand key (reviewed aliases, e.g. "ficticia automotores" → "ficticia autos"). */
  brandAliases?: Record<string, string>
  /** Brand key → word that the source puts at the start of the model but belongs to the brand ("mercedes" → "BENZ"). */
  brandContinuations?: Record<string, string>
  /** Multi-word model families (e.g. "GOL TREND"). */
  multiWordFamilies?: string[]
  /** "brandKey|familyKey" → category, for ambiguous registry bodies (reviewed by a person). */
  categoryOverrides?: Record<string, VehicleCategory>
  /** "brandKey|familyKey" → commercial model name (registry code kept as alias). */
  modelNames?: Record<string, string>
  /** Removed ID → replacement ID (when the previous catalog version is given). */
  retiredReplacements?: Record<string, string>
}

export interface IngestOptions {
  source: CatalogSource
  catalogVersion: string
  generatedAt: string
  overrides?: IngestOverrides
  previous?: CatalogDataset
  /** Input file identification for the report (name + SHA-256, no path). */
  input?: { name: string; sha256: string }
}

export type RowProblem =
  | 'brand_missing'
  | 'model_missing'
  | 'class_unknown'
  | 'category_ambiguous'
  | 'body_unknown'
  | 'body_missing'
  | 'year_ambiguous'

export interface IngestReport {
  source: { id: string; version: string; publishedAt: string; licenseStatus: string; isFixture: boolean }
  catalogVersion: string
  generatedAt: string
  input?: { name: string; sha256: string }
  distributable: boolean
  totals: { rows: number; accepted: number; duplicateRowsMerged: number; quarantined: number; rejected: number; brands: number; models: number; versions: number }
  byCategory: Record<VehicleCategory, { brands: number; models: number; versions: number }>
  quality: {
    versionsWithYears: number
    versionsWithDisplacement: number
    versionsWithFuel: number
    gncVersions: number
    dieselVersions: number
    sourceConflicts: number
    discontinuedModels: number
  }
  rejected: Array<{ recordId: string; line: number; problems: RowProblem[] }>
  quarantine: Array<{ recordId: string; line: number; problems: RowProblem[]; brand: string; modelDesc: string; body: string; candidates?: VehicleCategory[] }>
  warnings: Array<{ recordId: string; line: number; code: 'year_invalid_dropped' | 'fuel_markers_conflict'; detail: string }>
  brandVariants: Array<{ brand: string; variants: string[] }>
  aliasCandidates: Array<{ brand: string; similarTo: string }>
  registryCodeModels: Array<{ brand: string; model: string; modelKey: string }>
  familyCandidates: Array<{ brand: string; family: string; suggestion: string; versions: number }>
  duplicates: Array<{ versionId: string; recordIds: string[]; yearsDiffer: boolean }>
  integrity: string[]
  diff?: CatalogDiff
}

interface Accepted {
  row: RegistryRow
  brandKey: string
  brandName: string
  familyKey: string
  family: string
  category: VehicleCategory
  label: string
  body: string | null
  years: number[] | null
  zeroKm: boolean
  /** Which parts of this row's identification are an editorial decision, not the source's text. */
  editorial: Array<'category' | 'family' | 'brand'>
}

const hash8 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8)

export function ingestRegistry(rows: RegistryRow[], opts: IngestOptions): { dataset: CatalogDataset; report: IngestReport } {
  const o = opts.overrides ?? {}
  const publishedYear = Number(opts.source.publishedAt.slice(0, 4))
  const maxYear = publishedYear + 1
  const report: IngestReport = {
    source: { id: opts.source.id, version: opts.source.version, publishedAt: opts.source.publishedAt, licenseStatus: opts.source.license.status, isFixture: opts.source.isFixture },
    catalogVersion: opts.catalogVersion,
    generatedAt: opts.generatedAt,
    ...(opts.input ? { input: opts.input } : {}),
    distributable: false,
    totals: { rows: rows.length, accepted: 0, duplicateRowsMerged: 0, quarantined: 0, rejected: 0, brands: 0, models: 0, versions: 0 },
    byCategory: Object.fromEntries(VEHICLE_CATEGORIES.map((c) => [c, { brands: 0, models: 0, versions: 0 }])) as IngestReport['byCategory'],
    quality: { versionsWithYears: 0, versionsWithDisplacement: 0, versionsWithFuel: 0, gncVersions: 0, dieselVersions: 0, sourceConflicts: 0, discontinuedModels: 0 },
    rejected: [],
    quarantine: [],
    warnings: [],
    brandVariants: [],
    aliasCandidates: [],
    registryCodeModels: [],
    familyCandidates: [],
    duplicates: [],
    integrity: [],
  }

  // ── 1-4: per-row checks ──
  const accepted: Accepted[] = []
  const brandSpellings = new Map<string, Set<string>>()
  for (const row of rows) {
    const problems: RowProblem[] = []
    let brandRaw = canonicalText(row.brand)
    let descRaw = canonicalText(row.modelDesc)
    // Reviewed brand continuation: the source splits "MERCEDES" | "BENZ SPRINTER …".
    const continuation = o.brandContinuations?.[catalogKey(brandRaw)]
    const brandEditorial = !!continuation && descRaw.startsWith(`${canonicalText(continuation)} `)
    if (brandEditorial && continuation) {
      brandRaw = `${brandRaw} ${canonicalText(continuation)}`
      descRaw = descRaw.slice(continuation.length + 1).trim()
    }
    if (!brandRaw) problems.push('brand_missing')
    if (!descRaw) problems.push('model_missing')
    if (row.vehicleClass !== 'A' && row.vehicleClass !== 'M') problems.push('class_unknown')
    if (problems.length) {
      report.rejected.push({ recordId: row.recordId, line: row.line, problems })
      continue
    }
    let brandKey = catalogKey(brandRaw)
    const aliasedBrand = o.brandAliases?.[brandKey]
    brandKey = aliasedBrand ?? brandKey
    if (!brandSpellings.has(brandKey)) brandSpellings.set(brandKey, new Set())
    brandSpellings.get(brandKey)!.add(brandRaw)

    const family = modelFamily(descRaw, o.multiWordFamilies)
    const familyKey = catalogKey(family)
    const resolution = categoryFromBody(row.vehicleClass as 'A' | 'M', row.body)
    const override = o.categoryOverrides?.[`${brandKey}|${familyKey}`]
    let category: VehicleCategory | null = null
    let candidates: VehicleCategory[] | undefined
    // A reviewed model-level override wins over the registry body: many SUVs are registered as
    // "SEDAN 5 PUERTAS" / "RURAL 5 PUERTAS". Motovehículos keep their class.
    let categoryEditorial = false
    if (override && (row.vehicleClass === 'A' || override === 'moto' || override === 'otro')) {
      category = override
      // Editorial only when the override decided something the registry body did not.
      categoryEditorial = !(resolution.kind === 'resolved' && resolution.category === override)
    } else if (resolution.kind === 'resolved') category = resolution.category
    else if (resolution.kind === 'ambiguous') {
      problems.push('category_ambiguous')
      candidates = resolution.candidates
    } else problems.push(resolution.kind === 'missing' ? 'body_missing' : 'body_unknown')

    const years = parseYears(row.years, maxYear)
    if (years.ambiguous.length) problems.push('year_ambiguous')
    if (problems.length) {
      report.quarantine.push({ recordId: row.recordId, line: row.line, problems, brand: brandRaw, modelDesc: descRaw, body: canonicalText(row.body), ...(candidates ? { candidates } : {}) })
      continue
    }
    if (years.invalid.length) report.warnings.push({ recordId: row.recordId, line: row.line, code: 'year_invalid_dropped', detail: years.invalid.slice(0, 5).join(', ') })
    accepted.push({
      row,
      brandKey,
      brandName: brandRaw,
      familyKey,
      family,
      category: category!,
      label: descRaw,
      body: canonicalText(row.body) || null,
      years: years.years,
      zeroKm: years.zeroKm,
      editorial: [
        ...(categoryEditorial ? (['category'] as const) : []),
        ...(family.includes(' ') && (o.multiWordFamilies ?? []).map(canonicalText).includes(family) ? (['family'] as const) : []),
        ...(brandEditorial || aliasedBrand ? (['brand'] as const) : []),
      ],
    })
  }
  report.totals.rejected = report.rejected.length
  report.totals.quarantined = report.quarantine.length
  report.totals.accepted = accepted.length

  // ── 2: brand names, variants, near-duplicates ──
  const brandDisplay = new Map<string, string>()
  for (const [key, spellings] of brandSpellings) {
    const sorted = [...spellings].sort()
    // Prefer a spelling with spaces over hyphens/dots, then the shortest.
    const best = [...sorted].sort((a, b) => Number(/[-.]/.test(a)) - Number(/[-.]/.test(b)) || a.length - b.length)[0]!
    brandDisplay.set(key, displayName(best))
    if (sorted.length > 1) report.brandVariants.push({ brand: displayName(best), variants: sorted })
  }
  const brandKeys = [...brandSpellings.keys()].sort()
  for (const a of brandKeys) {
    for (const b of brandKeys) {
      if (a !== b && b.startsWith(`${a} `)) report.aliasCandidates.push({ brand: brandDisplay.get(b)!, similarTo: brandDisplay.get(a)! })
    }
  }

  // ── 6-7: group into models / versions with stable IDs ──
  const familyCategories = new Map<string, Set<VehicleCategory>>()
  for (const a of accepted) {
    const k = `${a.brandKey}|${a.familyKey}`
    if (!familyCategories.has(k)) familyCategories.set(k, new Set())
    familyCategories.get(k)!.add(a.category)
  }
  const typeId = (c: VehicleCategory) => `t:${c}`
  const brandId = (key: string) => `b:${slug(key, 30)}`
  const modelId = (a: Accepted) => {
    const base = `m:${slug(a.brandKey)}-${slug(a.familyKey)}`
    return familyCategories.get(`${a.brandKey}|${a.familyKey}`)!.size > 1 ? `${base}-${a.category}` : base
  }

  type VersionAcc = { v: DatasetVersion; years: Set<number> | null; yearsSeen: string[]; zeroKm: boolean; rowIds: string[] }
  const versions = new Map<string, VersionAcc>()
  const models = new Map<string, { a: Accepted; versions: Set<string>; editorial: Set<string> }>()
  for (const a of accepted) {
    const mId = modelId(a)
    const vKey = `${a.brandKey}|${a.familyKey}|${a.category}|${catalogKey(a.label)}|${catalogKey(a.body ?? '')}`
    const vId = `v:${slug(a.brandKey)}-${slug(a.familyKey)}-${hash8(vKey)}`
    if (!models.has(mId)) models.set(mId, { a, versions: new Set(), editorial: new Set() })
    models.get(mId)!.versions.add(vId)
    a.editorial.forEach((e) => models.get(mId)!.editorial.add(e))
    const existing = versions.get(vId)
    if (existing) {
      report.totals.duplicateRowsMerged++
      existing.rowIds.push(a.row.recordId)
      existing.yearsSeen.push(JSON.stringify(a.years))
      existing.zeroKm ||= a.zeroKm
      if (a.years) {
        existing.years ??= new Set()
        a.years.forEach((y) => existing.years!.add(y))
      }
      continue
    }
    const engine = parseEngineFromLabel(a.label, { family: a.family, vehicleClass: a.row.vehicleClass as 'A' | 'M' })
    if (engine.fuelConflict) report.warnings.push({ recordId: a.row.recordId, line: a.row.line, code: 'fuel_markers_conflict', detail: a.label.slice(0, 80) })
    const eng = engine.displacementL !== undefined || engine.fuel !== undefined
      ? { ...(engine.displacementL !== undefined ? { displacementL: engine.displacementL } : {}), ...(engine.fuel ? { fuel: engine.fuel } : {}), evidence: 'label' as const }
      : null
    versions.set(vId, {
      v: {
        id: vId,
        modelId: mId,
        label: a.label.slice(0, 120),
        body: a.body ? a.body.slice(0, 60) : null,
        years: null,
        engine: eng,
        missing: [],
        verification: engine.fuelConflict ? 'source_conflict' : 'source_listed',
        provenance: { sourceRecordIds: [], rawText: `${a.brandName} | ${a.label} | ${a.body ?? ''}`.slice(0, 300) },
      },
      years: a.years ? new Set(a.years) : null,
      yearsSeen: [JSON.stringify(a.years)],
      zeroKm: a.zeroKm,
      rowIds: [a.row.recordId],
    })
  }

  const finalVersions: DatasetVersion[] = []
  for (const acc of versions.values()) {
    const years = acc.years ? [...acc.years].sort((x, y) => x - y) : null
    const missing: MissingField[] = []
    if (!years) missing.push('years')
    if (!acc.v.body) missing.push('body')
    if (acc.v.engine?.displacementL === undefined) missing.push('displacement')
    if (acc.v.engine?.fuel === undefined) missing.push('fuel')
    const v: DatasetVersion = { ...acc.v, years, missing, provenance: { ...acc.v.provenance, sourceRecordIds: acc.rowIds.slice(0, 50) } }
    finalVersions.push(v)
    if (acc.rowIds.length > 1) report.duplicates.push({ versionId: v.id, recordIds: acc.rowIds.slice(0, 50), yearsDiffer: new Set(acc.yearsSeen).size > 1 })
  }

  const finalModels: CatalogDataset['models'] = []
  const zeroKmByModel = new Map<string, boolean>()
  for (const acc of versions.values()) zeroKmByModel.set(acc.v.modelId, (zeroKmByModel.get(acc.v.modelId) ?? false) || acc.zeroKm)
  for (const [mId, { a, versions: vIds, editorial }] of models) {
    const vs = finalVersions.filter((v) => vIds.has(v.id))
    const allYears = vs.some((v) => v.years) ? [...new Set(vs.flatMap((v) => v.years ?? []))].sort((x, y) => x - y) : null
    const reviewedName = o.modelNames?.[`${a.brandKey}|${a.familyKey}`]
    const registryName = displayName(a.family)
    if (!reviewedName && looksLikeRegistryCode(a.family)) report.registryCodeModels.push({ brand: brandDisplay.get(a.brandKey)!, model: registryName, modelKey: `${a.brandKey}|${a.familyKey}` })
    const discontinued = !zeroKmByModel.get(mId) && allYears !== null && allYears[allYears.length - 1]! < publishedYear - 1
    finalModels.push({
      id: mId,
      brandId: brandId(a.brandKey),
      typeId: typeId(a.category),
      name: (reviewedName ?? registryName).slice(0, 120),
      aliases: reviewedName ? [registryName] : [],
      discontinued,
      years: allYears,
      provenance: { sourceRecordIds: vs.flatMap((v) => v.provenance.sourceRecordIds).slice(0, 50), rawText: a.family },
      // Editorial (reviewed) decisions, kept apart from what the source says. "discontinued" is
      // always derived (manifest.derivations), never a source field.
      editorial: [...new Set([...editorial, ...(reviewedName ? ['name'] : [])])].sort() as Array<'brand' | 'category' | 'family' | 'name'>,
    })
  }

  // Family candidates: a recurring non-numeric second word inside a single-word family.
  const byFamily = new Map<string, string[]>()
  for (const a of accepted) {
    const k = `${a.brandKey}|${a.familyKey}`
    if (!byFamily.has(k)) byFamily.set(k, [])
    byFamily.get(k)!.push(a.label)
  }
  for (const [k, labels] of byFamily) {
    const [bKey, fKey] = k.split('|') as [string, string]
    const second = new Map<string, number>()
    for (const l of new Set(labels)) {
      const w = l.split(' ')[fKey.split(' ').length]
      if (w && /^[A-Z]{3,}$/.test(w)) second.set(w, (second.get(w) ?? 0) + 1)
    }
    for (const [w, n] of second) {
      if (n >= 2 && second.size >= 2) report.familyCandidates.push({ brand: brandDisplay.get(bKey)!, family: displayName(fKey), suggestion: `${canonicalText(fKey)} ${w}`, versions: n })
    }
  }

  const usedCategories = [...new Set(accepted.map((a) => a.category))]
  const brands: CatalogDataset['brands'] = [...brandSpellings.keys()]
    .filter((key) => accepted.some((a) => a.brandKey === key))
    .map((key) => {
      const display = brandDisplay.get(key)!
      // Only spellings that search differently are kept as aliases ("Ficticia Automotores"), not
      // punctuation variants of the same key ("FICTICIA-AUTOS").
      const variants = [...(brandSpellings.get(key) ?? [])].map(displayName)
      const aliases = [...new Set(variants)].filter((v) => catalogKey(v) !== catalogKey(display))
      return {
        id: brandId(key),
        name: display,
        aliases: aliases.slice(0, 20),
        typeIds: [...new Set(accepted.filter((a) => a.brandKey === key).map((a) => typeId(a.category)))].sort(),
      }
    })

  // ── 7: retired IDs vs the previous catalog version ──
  const retired: CatalogDataset['retired'] = {}
  if (opts.previous) {
    const live = new Set<string>([...usedCategories.map(typeId), ...brands.map((b) => b.id), ...finalModels.map((m) => m.id), ...finalVersions.map((v) => v.id)])
    const prevIds = [...opts.previous.types.map((t) => t.id), ...opts.previous.brands.map((b) => b.id), ...opts.previous.models.map((m) => m.id), ...opts.previous.versions.map((v) => v.id)]
    for (const [id, to] of Object.entries(opts.previous.retired)) if (!live.has(id)) retired[id] = to && live.has(to) ? to : null
    for (const id of prevIds) {
      if (live.has(id)) continue
      const to = o.retiredReplacements?.[id]
      retired[id] = to && live.has(to) ? to : null
    }
  }

  const dataset = withDatasetHash({
    schemaVersion: 2,
    manifest: {
      catalogVersion: opts.catalogVersion,
      generatedAt: opts.generatedAt,
      generator: 'chuya-catalog-ingest/2',
      source: opts.source,
      derivations: {
        'models.discontinued': `Derivado: la fuente no lista 0 km y el último año listado es anterior a ${publishedYear - 1}. No es un dato de la fuente.`,
        'versions.engine': 'Solo del texto de la versión (evidencia "label"): una única cilindrada x.y inequívoca (0,6–8,0 L, no en motos ni en el nombre del modelo) y un marcador explícito de combustible. Nafta nunca se infiere.',
        'versions.years': 'Años con valor en la tabla de la fuente (alineación verificada). 0 km no se convierte en año.',
        'models.editorial': 'Marca, familia, categoría o nombre fijados por revisión editorial (overrides versionados), no por el texto de la fuente.',
      },
    },
    types: VEHICLE_CATEGORIES.filter((c) => usedCategories.includes(c)).map((c) => ({ id: typeId(c), category: c, label: CATEGORY_LABEL[c] })),
    brands: brands.sort((a, b) => a.name.localeCompare(b.name, 'es')),
    models: finalModels.sort((a, b) => a.id.localeCompare(b.id)),
    versions: finalVersions.sort((a, b) => a.id.localeCompare(b.id)),
    retired,
  })

  // ── 8: report ──
  report.totals.brands = dataset.brands.length
  report.totals.models = dataset.models.length
  report.totals.versions = dataset.versions.length
  for (const c of VEHICLE_CATEGORIES) {
    const ms = dataset.models.filter((m) => m.typeId === typeId(c))
    report.byCategory[c] = {
      brands: dataset.brands.filter((b) => b.typeIds.includes(typeId(c))).length,
      models: ms.length,
      versions: dataset.versions.filter((v) => ms.some((m) => m.id === v.modelId)).length,
    }
  }
  const q = report.quality
  for (const v of dataset.versions) {
    if (v.years) q.versionsWithYears++
    if (v.engine?.displacementL !== undefined) q.versionsWithDisplacement++
    if (v.engine?.fuel) q.versionsWithFuel++
    if (v.engine?.fuel === 'gnc') q.gncVersions++
    if (v.engine?.fuel === 'diesel') q.dieselVersions++
    if (v.verification === 'source_conflict') q.sourceConflicts++
  }
  q.discontinuedModels = dataset.models.filter((m) => m.discontinued).length
  report.integrity = checkCatalogIntegrity(dataset)
  report.distributable = DISTRIBUTABLE_LICENSES.includes(opts.source.license.status) && report.integrity.length === 0
  if (opts.previous) report.diff = diffCatalogs(opts.previous, dataset)
  return { dataset, report }
}

/** Long review lists are capped in the Markdown summary; report.json keeps them complete. */
const cap = (items: string[], max = 40) => (items.length > max ? `${items.slice(0, max).join('; ')}; … y ${items.length - max} más (ver report.json)` : items.join('; '))

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : '—')

/** Human-readable summary for the person who reviews the import. No secrets, no personal data. */
export function renderIngestReport(r: IngestReport): string {
  const t = r.totals
  const lines = [
    `# Reporte de ingesta — ${r.catalogVersion}`,
    '',
    `Fuente: ${r.source.id} ${r.source.version} (${r.source.publishedAt}) · licencia: **${r.source.licenseStatus}**${r.source.isFixture ? ' · DATOS SINTÉTICOS' : ''}`,
    r.input ? `Archivo: ${r.input.name} · SHA-256 ${r.input.sha256}` : '',
    `Distribuible: **${r.distributable ? 'sí' : 'NO'}**${r.integrity.length ? ` · problemas de integridad: ${r.integrity.length}` : ''}`,
    '',
    '## Totales',
    `Filas ${t.rows} · aceptadas ${t.accepted} · duplicadas fusionadas ${t.duplicateRowsMerged} · cuarentena ${t.quarantined} · rechazadas ${t.rejected}`,
    `Marcas ${t.brands} · modelos ${t.models} · versiones ${t.versions}`,
    '',
    '## Cobertura por categoría',
    '| Categoría | Marcas | Modelos | Versiones |',
    '|---|---|---|---|',
    ...VEHICLE_CATEGORIES.map((c) => `| ${CATEGORY_LABEL[c]} | ${r.byCategory[c].brands} | ${r.byCategory[c].models} | ${r.byCategory[c].versions} |`),
    '',
    '## Calidad',
    `Con años ${pct(r.quality.versionsWithYears, t.versions)} · con cilindrada ${pct(r.quality.versionsWithDisplacement, t.versions)} · con combustible ${pct(r.quality.versionsWithFuel, t.versions)} (diésel ${r.quality.dieselVersions}, GNC ${r.quality.gncVersions})`,
    `Conflictos de la fuente ${r.quality.sourceConflicts} · modelos discontinuados ${r.quality.discontinuedModels}`,
    '',
    '## Para revisar',
    `- Cuarentena: ${r.quarantine.length} (${[...new Set(r.quarantine.flatMap((q) => q.problems))].join(', ') || '—'})`,
    `- Rechazadas: ${r.rejected.length}`,
    `- Variantes de marca fusionadas: ${cap(r.brandVariants.map((b) => `${b.brand} ← ${b.variants.join(' / ')}`)) || '—'}`,
    `- Posibles alias de marca (no fusionados): ${cap(r.aliasCandidates.map((a) => `${a.brand} ~ ${a.similarTo}`)) || '—'}`,
    `- Modelos con nombre registral (proponer nombre comercial): ${r.registryCodeModels.length} — ${cap(r.registryCodeModels.map((m) => `${m.brand} ${m.model}`)) || '—'}`,
    `- Posibles familias de varias palabras: ${r.familyCandidates.length} — ${cap(r.familyCandidates.map((f) => f.suggestion)) || '—'}`,
    `- Duplicados fusionados: ${r.duplicates.length} (con años distintos: ${r.duplicates.filter((d) => d.yearsDiffer).length})`,
    `- Avisos: ${r.warnings.length}`,
    r.diff ? `- Cambios vs ${r.diff.from}: +${r.diff.added.length} / −${r.diff.removed.length} (sin retiro: ${r.diff.removedWithoutRetirement.length}), renombrados ${r.diff.renamed.length}` : '',
    r.integrity.length ? `\n## Integridad\n${r.integrity.map((p) => `- ${p}`).join('\n')}` : '',
  ]
  return lines.filter((l) => l !== '').join('\n') + '\n'
}
