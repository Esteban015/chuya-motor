/**
 * ingest.test.ts — Offline catalog ingestion (Incremento 7D.2) over a SYNTHETIC registry-like CSV.
 * No network: URLs are refused; only local files are read.
 */
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { CatalogSource } from '@/domain/vehicle/vehicle-catalog'
import { resolveVehicle } from '@/domain/vehicle/vehicle-validation'
import { checkCatalogIntegrity } from '../catalog-dataset'
import { StaticCatalogProvider } from '../static-catalog-provider'
import { ingestRegistry, renderIngestReport, type IngestOptions } from './ingest'
import { categoryFromBody, modelFamily, parseEngineFromLabel, parseYears } from './normalize'
import { RegistryInputError, parseCsv, readRegistryFile, rowsFromCsv } from './registry-input'

const CSV = join(__dirname, '__fixtures__', 'synthetic-registry.csv')
const SYNTHETIC: CatalogSource = {
  id: 'synthetic-registry',
  name: 'Registro sintético de pruebas',
  version: 'syn-1',
  publishedAt: '2026-11-14',
  kind: 'fixture',
  isFixture: true,
  license: { status: 'synthetic' },
}
const OVERRIDES: IngestOptions['overrides'] = {
  brandAliases: { 'ficticia automotores': 'ficticia autos' },
  categoryOverrides: { 'ficticia autos|delta': 'pickup' },
  modelNames: { 'prueba motos|sx110': 'Scooter X 110' },
  multiWordFamilies: ['FURGON F'],
}
const run = (extra: Partial<IngestOptions> = {}) =>
  ingestRegistry(readRegistryFile(CSV).rows, { source: SYNTHETIC, catalogVersion: 'syn-2026-11-14.1', generatedAt: '2026-11-14T12:00:00.000Z', overrides: OVERRIDES, ...extra })
const label = (d: ReturnType<typeof run>['dataset'], text: string) => d.versions.find((v) => v.label === text)

describe('IN-01: local input only', () => {
  it('refuses URLs and non-CSV files (no downloads)', () => {
    expect(() => readRegistryFile('https://example.org/tabla.csv')).toThrow(RegistryInputError)
    expect(() => readRegistryFile('C:/datos/tabla.pdf')).toThrow(/\.csv/)
  })

  it('CSV with quotes, embedded commas and missing columns', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
    expect(() => rowsFromCsv('brand,model_desc\nX,Y')).toThrow(/Missing columns/)
  })

  it('identifies the input by name + SHA-256 (no path)', () => {
    const { input, rows } = readRegistryFile(CSV)
    expect(input.name).toBe('synthetic-registry.csv')
    expect(input.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(rows).toHaveLength(32)
  })
})

describe('IN-02: normalization rules', () => {
  it('years: ranges, lists, 0 km, unknown, invalid dropped, ambiguous flagged', () => {
    expect(parseYears('2015-2017;2020', 2027)).toMatchObject({ years: [2015, 2016, 2017, 2020], zeroKm: false })
    expect(parseYears('0KM;2025', 2027)).toMatchObject({ years: [2025], zeroKm: true })
    expect(parseYears('', 2027).years).toBeNull()
    expect(parseYears('1899;2020', 2027)).toMatchObject({ years: [2020], invalid: ['1899'] })
    expect(parseYears('2015/16', 2027).ambiguous).toEqual(['2015/16'])
    expect(parseYears('17', 2027).ambiguous).toEqual(['17'])
    expect(parseYears('2030', 2027).invalid).toEqual(['2030'])
  })

  it('engine only from the source text; nafta never inferred; GNC; contradictory markers', () => {
    expect(parseEngineFromLabel('ALFA 1.4 8V')).toEqual({ displacementL: 1.4, fuelConflict: false })
    expect(parseEngineFromLabel('PALIO ADVENTURE 1.7TD')).toEqual({ displacementL: 1.7, fuel: 'diesel', fuelConflict: false })
    expect(parseEngineFromLabel('ALFA 1.4 GNC').fuel).toBe('gnc')
    expect(parseEngineFromLabel('EPSILON 1.8 HIBRIDO').fuel).toBe('hibrido')
    expect(parseEngineFromLabel('BETA 1.3 GNC TD')).toEqual({ displacementL: 1.3, fuelConflict: true })
    expect(parseEngineFromLabel('OMEGA')).toEqual({ fuelConflict: false })
    expect(parseEngineFromLabel('RAYO 150').displacementL).toBeUndefined()
  })

  it('registry body vs product category', () => {
    expect(categoryFromBody('A', 'SEDAN 5 PUERTAS')).toEqual({ kind: 'resolved', category: 'auto' })
    expect(categoryFromBody('A', 'CHASIS C/CABINA')).toEqual({ kind: 'resolved', category: 'camion' })
    expect(categoryFromBody('A', 'RURAL 5 PUERTAS')).toEqual({ kind: 'ambiguous', candidates: ['auto', 'suv'] })
    expect(categoryFromBody('A', 'PICK-UP / TODO TERRENO')).toEqual({ kind: 'ambiguous', candidates: ['pickup', 'suv'] })
    expect(categoryFromBody('A', '')).toEqual({ kind: 'missing' })
    expect(categoryFromBody('A', 'CARROZA')).toEqual({ kind: 'unknown' })
    expect(categoryFromBody('M', 'MOTOCICLETA')).toEqual({ kind: 'resolved', category: 'moto' })
    expect(categoryFromBody('M', 'CUATRICICLO')).toEqual({ kind: 'resolved', category: 'otro' })
  })

  it('model family: first token, configured multi-word families win, generation codes stay in the label', () => {
    expect(modelFamily('PALIO (326) ATTRACTIVE 5P 1.4 8V')).toBe('PALIO')
    expect(modelFamily('GOL TREND 1.6', ['GOL TREND'])).toBe('GOL TREND')
    expect(modelFamily('GOL 1.4 POWER', ['GOL TREND'])).toBe('GOL')
  })
})

describe('IN-03: ingestion of the synthetic registry', () => {
  it('totals: rejected (no brand, unknown class), quarantined (ambiguous / missing / unknown body, ambiguous year)', () => {
    const { report } = run()
    expect(report.totals).toMatchObject({ rows: 32, rejected: 2, quarantined: 4, accepted: 26 })
    expect(report.rejected.map((r) => [r.recordId, r.problems])).toEqual([['r016', ['brand_missing']], ['r019', ['class_unknown']]])
    expect(Object.fromEntries(report.quarantine.map((q) => [q.recordId, q.problems]))).toEqual({
      r009: ['category_ambiguous'],
      r014: ['year_ambiguous'],
      r017: ['body_missing'],
      r018: ['body_unknown'],
    })
    expect(report.quarantine.find((q) => q.recordId === 'r009')?.candidates).toEqual(['auto', 'suv'])
  })

  it('reviewed override resolves an ambiguous body; without it the row is quarantined', () => {
    expect(run().dataset.models.find((m) => m.id === 'm:ficticia-autos-delta')?.typeId).toBe('t:pickup')
    const noOverride = run({ overrides: { ...OVERRIDES, categoryOverrides: {} } })
    expect(noOverride.report.quarantine.map((q) => q.recordId)).toContain('r011')
  })

  it('duplicates (imported + national codes, brand spelling variants, reviewed alias) are merged with provenance', () => {
    const { dataset, report } = run()
    const alfa = label(dataset, 'ALFA 1.4 8V')!
    expect(alfa.provenance.sourceRecordIds).toEqual(['r001', 'r002', 'r032'])
    const td = label(dataset, 'ALFA 1.6 TD')!
    expect(td.provenance.sourceRecordIds).toEqual(['r003', 'r004'])
    expect(td.years).toEqual([2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025])
    expect(report.duplicates.find((d) => d.versionId === td.id)?.yearsDiffer).toBe(true)
    expect(report.brandVariants[0]).toEqual({ brand: 'Ficticia Autos', variants: ['FICTICIA AUTOMOTORES', 'FICTICIA AUTOS', 'FICTICIA-AUTOS'] })
    expect(dataset.brands.find((b) => b.id === 'b:ficticia-autos')?.aliases).toEqual(['Ficticia Automotores'])
  })

  it('alias proposals are reported, not merged; registry codes get a reviewed commercial name', () => {
    const { dataset, report } = run()
    expect(report.aliasCandidates).toEqual([{ brand: 'Demo Utilitarios Trucks', similarTo: 'Demo Utilitarios' }])
    expect(dataset.brands.map((b) => b.name)).toContain('Demo Utilitarios Trucks')
    const sx = dataset.models.find((m) => m.id === 'm:prueba-motos-sx110')!
    expect(sx).toMatchObject({ name: 'Scooter X 110', aliases: ['SX110'] })
    const unreviewed = run({ overrides: { ...OVERRIDES, modelNames: {} } }).report
    expect(unreviewed.registryCodeModels).toEqual([{ brand: 'Prueba Motos', model: 'SX110', modelKey: 'prueba motos|sx110' }])
  })

  it('missing data stays missing: unknown years / engine / fuel are listed, never filled in', () => {
    const { dataset } = run()
    expect(label(dataset, 'OMEGA')).toMatchObject({ years: null, engine: null, missing: ['years', 'displacement', 'fuel'] })
    expect(label(dataset, 'ALFA 1.4 8V')).toMatchObject({ engine: { displacementL: 1.4, evidence: 'label' }, missing: ['fuel'] })
    expect(label(dataset, 'RAYO 150')?.engine).toBeNull()
    expect(dataset.models.find((m) => m.name === 'Omega')).toMatchObject({ years: null, discontinued: false })
  })

  it('GNC, diesel, hybrid and contradictory fuel markers (source_conflict)', () => {
    const { dataset, report } = run()
    expect(label(dataset, 'ALFA 1.4 GNC')?.engine?.fuel).toBe('gnc')
    expect(label(dataset, 'BETA 1.3 GNC TD')).toMatchObject({ verification: 'source_conflict', missing: ['fuel'] })
    expect(report.quality).toMatchObject({ gncVersions: 1, dieselVersions: 3, sourceConflicts: 1 })
    expect(report.warnings.map((w) => w.code).sort()).toEqual(['fuel_markers_conflict', 'year_invalid_dropped'])
  })

  it('discontinued models, family candidates and coverage per category', () => {
    const { dataset, report } = run()
    expect(dataset.models.find((m) => m.name === 'Beta')?.discontinued).toBe(true)
    expect(dataset.models.find((m) => m.name === 'Alfa')?.discontinued).toBe(false)
    expect(report.familyCandidates.map((f) => f.suggestion).sort()).toEqual(['LINEA POWER', 'LINEA TREND'])
    expect(report.byCategory).toMatchObject({ moto: { models: 2 }, camion: { models: 1 }, otro: { models: 1 }, pickup: { models: 1 }, suv: { models: 1 } })
  })

  it('stable, deterministic IDs: re-running gives the same dataset hash', () => {
    expect(run().dataset.manifest.sha256).toBe(run().dataset.manifest.sha256)
  })

  it('the output is a valid, servable v2 dataset with provenance on every record', async () => {
    const { dataset, report } = run()
    expect(report.integrity).toEqual([])
    expect(report.distributable).toBe(true)
    expect(checkCatalogIntegrity(dataset)).toEqual([])
    const p = new StaticCatalogProvider(dataset)
    const brands = await p.listBrands('t:moto')
    expect(brands.ok && brands.data.map((b) => b.name)).toEqual(['Ejemplo Motors', 'Prueba Motos'])
    expect(renderIngestReport(report)).toContain('Distribuible: **sí**')
  })
})

describe('IN-04: licenses and catalog versions', () => {
  it('a pending license (public document without explicit permission) produces a report only', () => {
    const { report } = run({ source: { ...SYNTHETIC, id: 'registro-oficial', kind: 'registry', isFixture: false, license: { status: 'pending' } } })
    expect(report.distributable).toBe(false)
    expect(report.integrity).toContain('license_not_distributable')
    expect(renderIngestReport(report)).toContain('Distribuible: **NO**')
  })

  it('a new catalog version retires removed IDs (with reviewed replacements) and selections migrate', async () => {
    const v1 = run().dataset
    const rows = readRegistryFile(CSV).rows.filter((r) => r.recordId !== 'r007' && r.recordId !== 'r008' && r.recordId !== 'r020')
    const omegaV1 = v1.versions.find((v) => v.label === 'OMEGA')!.id
    const { dataset: v2, report } = ingestRegistry(rows, {
      source: SYNTHETIC,
      catalogVersion: 'syn-2026-12-01.1',
      generatedAt: '2026-12-01T12:00:00.000Z',
      overrides: { ...OVERRIDES, retiredReplacements: { 'm:ficticia-autos-beta': 'm:ficticia-autos-alfa' } },
      previous: v1,
    })
    expect(report.integrity).toEqual([])
    expect(v2.retired['m:ficticia-autos-beta']).toBe('m:ficticia-autos-alfa')
    expect(v2.retired['m:ejemplo-motors-hatch']).toBeNull()
    expect(report.diff?.removed).toContain('m:ficticia-autos-beta')
    expect(report.diff?.removedWithoutRetirement).toEqual([])
    expect(v2.versions.find((v) => v.label === 'OMEGA')!.id).toBe(omegaV1) // unchanged records keep their ID

    const p = new StaticCatalogProvider(v2)
    const migrated = await resolveVehicle({}, { typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-autos-beta' }, p)
    expect(migrated.issues).toContain('catalog_id_migrated')
    expect(migrated.vehicle).toMatchObject({ model: 'Alfa', validation: 'identity_basic' })
    const gone = await resolveVehicle({ make: 'Escrita' }, { typeId: 't:auto', brandId: 'b:ejemplo-motors', modelId: 'm:ejemplo-motors-hatch' }, p)
    expect(gone.issues).toEqual(['catalog_id_retired'])
    expect(gone.vehicle).toEqual({ make: 'Escrita', validation: 'user_declared' })
  })
})

describe('IN-05 (7D.2 audit): displacement only when unambiguous', () => {
  it.each([
    ['9.3 VECTOR 2.0 T', { family: '9.3' }, 2.0],
    ['9.5 SE', { family: '9.5' }, undefined],
    ['HILUX 2.4/2.8/D/4WD', {}, undefined],
    ['QM200GY MOTARD 2.0', { vehicleClass: 'M' as const }, undefined],
    ['FZ-S FI V3.0', {}, undefined],
    ['TR2.0', {}, undefined],
    ['CAPTAIN 9.9', {}, undefined],
    ['PALIO FIRE 1.4 8V', { family: 'PALIO', vehicleClass: 'A' as const }, 1.4],
  ])('%s → %s', (label, ctx, expected) => {
    expect(parseEngineFromLabel(label, ctx).displacementL).toBe(expected)
  })

  it('"D/C" (doble cabina) is not a diesel marker; explicit markers still are', () => {
    expect(parseEngineFromLabel('RANGER 2.5 D/C XL').fuel).toBeUndefined()
    expect(parseEngineFromLabel('RANGER 3.2 D/C TDCI').fuel).toBe('diesel')
    expect(parseEngineFromLabel('PEUGEOT 206 1.9 D').fuel).toBe('diesel')
  })
})

describe('IN-06 (7D.2 audit): editorial decisions are marked, derivations documented', () => {
  it('models carry which parts are editorial; the manifest explains derived fields', () => {
    const { dataset } = run()
    expect(dataset.models.find((m) => m.id === 'm:ficticia-autos-delta')?.editorial).toEqual(['category'])
    expect(dataset.models.find((m) => m.id === 'm:ficticia-autos-alfa')?.editorial).toEqual(['brand'])
    expect(dataset.models.find((m) => m.id === 'm:prueba-motos-sx110')?.editorial).toEqual(['name'])
    expect(dataset.models.find((m) => m.id === 'm:demo-utilitarios-furgon-f')?.editorial).toEqual(['family'])
    expect(dataset.models.find((m) => m.id === 'm:ejemplo-motors-rayo')?.editorial).toEqual([])
    expect(Object.keys(dataset.manifest.derivations ?? {})).toEqual(expect.arrayContaining(['models.discontinued', 'versions.engine', 'versions.years', 'models.editorial']))
  })
})
