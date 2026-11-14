/**
 * vehicle-catalog.test.ts — Catalog contract, local provider, integrity, server-side validation and
 * flag / production guard (Incremento 7D.1). Synthetic fixture only; no network.
 */
import { describe, expect, it } from 'vitest'
import { catalogKey, displayName, type CatalogResult, type VehicleCatalogProvider } from '@/domain/vehicle/vehicle-catalog'
import { resolveVehicle, CatalogSelectionInputSchema } from '@/domain/vehicle/vehicle-validation'
import { FIXTURE_CATALOG } from './fixture-catalog'
import { StaticCatalogProvider, checkCatalogIntegrity, withCatalogTimeout, type CatalogDataset } from './static-catalog-provider'
import { getVehicleCatalog, isVehicleCatalogEnabled } from './catalog-config'

const provider = () => new StaticCatalogProvider(FIXTURE_CATALOG)
const data = <T,>(r: CatalogResult<T>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`)
  return r.data
}
const clone = (): CatalogDataset => JSON.parse(JSON.stringify(FIXTURE_CATALOG)) as CatalogDataset

describe('VC-01: dependent listing (tipo → marca → modelo → año → versión)', () => {
  it('moto → only motorcycle brands and models', async () => {
    const p = provider()
    const brands = data(await p.listBrands('t:moto'))
    expect(brands.map((b) => b.id)).toEqual(['b:ejemplo-motors', 'b:prueba-motos'])
    const models = data(await p.listModels('t:moto', 'b:ejemplo-motors'))
    expect(models.map((m) => m.name)).toEqual(['Moto M 150'])
    expect(models.every((m) => m.typeId === 't:moto')).toBe(true)
  })

  it('auto → car brands and only the car models of a brand that also makes motorcycles', async () => {
    const p = provider()
    expect(data(await p.listBrands('t:auto')).map((b) => b.id)).toEqual(['b:ejemplo-motors', 'b:ficticia-autos'])
    expect(data(await p.listModels('t:auto', 'b:ejemplo-motors')).map((m) => m.name)).toEqual(['Hatch E'])
  })

  it('a brand under the wrong type → NOT_FOUND (no cross-type listing)', async () => {
    expect(await provider().listModels('t:moto', 'b:ficticia-autos')).toEqual({ ok: false, error: 'NOT_FOUND' })
    expect(await provider().listBrands('t:inexistente')).toEqual({ ok: false, error: 'NOT_FOUND' })
  })

  it('discontinued models are listed and flagged, not hidden', async () => {
    const models = data(await provider().listModels('t:auto', 'b:ficticia-autos'))
    expect(models.find((m) => m.name === 'Compacto B')?.discontinued).toBe(true)
    expect(models.find((m) => m.name === 'Sedán A')?.discontinued).toBe(false)
  })

  it('years newest first; a model without year data answers null (unknown), never invented', async () => {
    const p = provider()
    expect(data(await p.listYears('m:ficticia-compacto-b'))).toEqual([2016, 2015, 2014, 2013, 2012, 2011, 2010, 2009, 2008])
    expect(data(await p.listYears('m:ficticia-clasico-c'))).toBeNull()
  })

  it('versions filtered by year keep different engines / fuels; year unknown lists all', async () => {
    const p = provider()
    const v2017 = data(await p.listVersions('m:ficticia-sedan-a', 2017))
    expect(v2017.map((v) => v.engine?.fuel)).toEqual(['gnc', 'nafta'])
    const v2024 = data(await p.listVersions('m:ficticia-sedan-a', 2024))
    expect(v2024.map((v) => v.label)).toEqual(['1.6 Turbodiésel', 'Edición Especial'])
    expect(v2024.find((v) => v.label === 'Edición Especial')?.engine).toBeNull()
    expect(data(await p.listVersions('m:ficticia-sedan-a', null))).toHaveLength(4)
  })

  it('empty categories answer an empty list (UI shows the empty state + manual entry)', async () => {
    expect(data(await provider().listBrands('t:camion'))).toEqual([])
  })

  it('every response carries the provenance and flags the fixture', async () => {
    const r = await provider().listTypes()
    expect(r.ok && r.meta).toMatchObject({ source: 'fixture', kind: 'fixture', isFixture: true })
  })
})

describe('VC-02: dataset integrity (a broken catalog is never served)', () => {
  it('the fixture is consistent', () => {
    expect(checkCatalogIntegrity(FIXTURE_CATALOG)).toEqual([])
  })

  it.each([
    ['duplicate id', (d: CatalogDataset) => d.models.push({ ...d.models[0]! })],
    ['orphan model', (d: CatalogDataset) => (d.models[0]!.brandId = 'b:no-existe')],
    ['model type not listed for its brand', (d: CatalogDataset) => (d.models[0]!.typeId = 't:moto')],
    ['version years outside the model', (d: CatalogDataset) => (d.versions[0]!.years = [1999])],
    ['malformed id', (d: CatalogDataset) => ((d.types[0] as { id: string }).id = 'auto')],
  ])('%s → INVALID_DATA on every call', async (_name, mutate) => {
    const d = clone()
    mutate(d)
    const p = new StaticCatalogProvider(d)
    expect(p.problems.length).toBeGreaterThan(0)
    expect(await p.listTypes()).toEqual({ ok: false, error: 'INVALID_DATA' })
    expect(await p.listBrands('t:auto')).toEqual({ ok: false, error: 'INVALID_DATA' })
  })
})

describe('VC-03: provider failure and timeout', () => {
  const hanging: VehicleCatalogProvider = {
    meta: new StaticCatalogProvider(FIXTURE_CATALOG).meta,
    retiredReplacement: () => undefined,
    listTypes: () => new Promise(() => {}),
    listBrands: () => Promise.reject(new Error('boom')),
    listModels: () => new Promise(() => {}),
    listYears: () => new Promise(() => {}),
    listVersions: () => new Promise(() => {}),
  }

  it('a hanging call answers TIMEOUT; a throwing call answers UNAVAILABLE', async () => {
    const p = withCatalogTimeout(hanging, 20)
    expect(await p.listTypes()).toEqual({ ok: false, error: 'TIMEOUT' })
    expect(await p.listBrands('t:auto')).toEqual({ ok: false, error: 'UNAVAILABLE' })
  })

  it('validation with a failing catalog degrades to user_declared (never blocks, never invents)', async () => {
    const r = await resolveVehicle({ make: 'Fiat', engine: '1.4' }, { typeId: 't:auto', brandId: 'b:ficticia-autos' }, withCatalogTimeout(hanging, 20))
    expect(r.issues).toEqual(['catalog_unavailable'])
    expect(r.vehicle).toEqual({ make: 'Fiat', engine: '1.4', engineSource: 'declared', validation: 'user_declared' })
  })
})

describe('VC-04: server-side validation of combinations', () => {
  const p = provider()
  const sedanA = { typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-sedan-a' }

  it('valid full chain → identity_full with catalog names', async () => {
    const r = await resolveVehicle({ make: 'cliente', model: 'cliente', year: 2017 }, { ...sedanA, versionId: 'v:sedan-a-14-gnc' }, p)
    expect(r.issues).toEqual([])
    expect(r.vehicle).toMatchObject({ make: 'Ficticia Autos', model: 'Sedán A', year: 2017, fuelType: 'gnc', fuelSource: 'catalog', validation: 'identity_full' })
  })

  it.each([
    ['brand not listed for the type', { typeId: 't:moto', brandId: 'b:ficticia-autos' }],
    ['model of another brand', { typeId: 't:auto', brandId: 'b:ejemplo-motors', modelId: 'm:ficticia-sedan-a' }],
    ['model of another type', { typeId: 't:auto', brandId: 'b:ejemplo-motors', modelId: 'm:ejemplo-moto-m' }],
    ['model without brand', { typeId: 't:auto', modelId: 'm:ficticia-sedan-a' }],
    ['unknown type', { typeId: 't:nave' }],
  ])('%s → user_declared + catalog_mismatch, no catalog IDs kept', async (_n, sel) => {
    const r = await resolveVehicle({ make: 'Declarada' }, sel, p)
    expect(r.issues).toEqual(['catalog_mismatch'])
    expect(r.vehicle).toEqual({ make: 'Declarada', validation: 'user_declared' })
  })

  it('version of another model → identity_basic, version dropped, engine not taken from it', async () => {
    const r = await resolveVehicle({ year: 2017 }, { ...sedanA, versionId: 'v:pickup-p-28-diesel' }, p)
    expect(r.issues).toEqual(['version_mismatch'])
    expect(r.vehicle.validation).toBe('identity_basic')
    expect(r.vehicle.version).toBeUndefined()
    expect(r.vehicle.fuelType).toBeUndefined()
  })

  it('year outside the model years → identity_conflict, year kept as declared', async () => {
    const r = await resolveVehicle({ year: 2001 }, sedanA, p)
    expect(r.issues).toEqual(['year_not_listed'])
    expect(r.vehicle).toMatchObject({ year: 2001, validation: 'identity_conflict' })
  })

  it('discontinued model without year data: year kept but unverified', async () => {
    const r = await resolveVehicle({ year: 1995 }, { typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-clasico-c' }, p)
    expect(r.issues).toEqual(['year_unverified'])
    expect(r.vehicle).toMatchObject({ model: 'Clásico C', year: 1995, validation: 'identity_basic' })
  })

  it('version that does not list the chosen year → identity_conflict (contradiction surfaced)', async () => {
    const r = await resolveVehicle({ year: 2024 }, { ...sedanA, versionId: 'v:sedan-a-14-nafta' }, p)
    expect(r.issues).toEqual(['year_not_listed_for_version'])
    expect(r.vehicle.validation).toBe('identity_conflict')
  })

  it('version without engine data: engine / fuel stay unknown (never inferred from the name)', async () => {
    const r = await resolveVehicle({ year: 2022 }, { ...sedanA, versionId: 'v:sedan-a-especial' }, p)
    expect(r.vehicle).toMatchObject({ version: 'Edición Especial', validation: 'identity_full' })
    expect(r.vehicle.engine).toBeUndefined()
    expect(r.vehicle.fuelType).toBeUndefined()
  })

  it('declared fuel contradicting the catalog version → catalog wins, conflict reported', async () => {
    const r = await resolveVehicle({ fuelType: 'gasoline' }, { ...sedanA, versionId: 'v:sedan-a-16-diesel' }, p)
    expect(r.issues).toContain('fuel_conflict')
    expect(r.vehicle).toMatchObject({ fuelType: 'diesel', fuelSource: 'catalog' })
  })

  it('type only → identity_partial with the category mapped to the legacy vehicleType', async () => {
    const r = await resolveVehicle({ make: 'Escrita' }, { typeId: 't:moto' }, p)
    expect(r.vehicle).toMatchObject({ make: 'Escrita', vehicleType: 'motorcycle', validation: 'identity_partial' })
  })

  it('selection schema is strict: a client-declared validation is rejected', () => {
    expect(CatalogSelectionInputSchema.safeParse({ typeId: 't:auto', validation: 'catalog_validated' }).success).toBe(false)
    expect(CatalogSelectionInputSchema.safeParse({ typeId: 't:auto' }).success).toBe(true)
  })
})

describe('VC-05: catalog switch and production guard (7D.2: real catalog ON by default)', () => {
  it('default = real DNRPA catalog; "false" is the kill switch; unknown sources are off', () => {
    expect(getVehicleCatalog({})?.meta).toMatchObject({ source: 'dnrpa', isFixture: false })
    expect(getVehicleCatalog({ VEHICLE_CATALOG_SOURCE: 'dnrpa' })?.meta.source).toBe('dnrpa')
    for (const off of ['false', 'FALSE', '0', 'off']) expect(getVehicleCatalog({ VEHICLE_CATALOG_ENABLED: off })).toBeNull()
    expect(getVehicleCatalog({ VEHICLE_CATALOG_SOURCE: 'argautos' })).toBeNull()
    expect(isVehicleCatalogEnabled({ VEHICLE_CATALOG_SOURCE: 'fixture' })).toBe(true)
    expect(getVehicleCatalog({ VEHICLE_CATALOG_SOURCE: 'fixture' })?.meta.isFixture).toBe(true)
  })

  it('the synthetic fixture is never served on public production, with no override', () => {
    expect(getVehicleCatalog({ VEHICLE_CATALOG_ENABLED: 'true', VEHICLE_CATALOG_SOURCE: 'fixture', VERCEL_ENV: 'production' })).toBeNull()
  })
})

describe('VC-06: name normalization (reused from 6.5)', () => {
  it('matching key without accents and display names', () => {
    expect(catalogKey('Citroën  C-Élysée')).toBe('citroen c elysee')
    expect(displayName('ALFA ROMEO')).toBe('Alfa Romeo')
    expect(displayName('BMW x1')).toBe('BMW X1')
  })
})

describe('VC-07 (7D.2): identification levels — computed on the server, never "compatibility"', () => {
  const p = provider()
  const sedanA = { typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-sedan-a' }

  it('identity_full: type, brand, model, year and a version the source lists for that year', async () => {
    const r = await resolveVehicle({ year: 2019 }, { ...sedanA, versionId: 'v:sedan-a-14-nafta' }, p)
    expect(r.vehicle.validation).toBe('identity_full')
  })

  it('identity_basic: model verified, year / version unconfirmed', async () => {
    expect((await resolveVehicle({}, sedanA, p)).vehicle.validation).toBe('identity_basic')
    expect((await resolveVehicle({ year: 2019 }, sedanA, p)).vehicle.validation).toBe('identity_basic')
    const unknownYear = await resolveVehicle({ year: 2019 }, { ...sedanA, versionId: 'v:sedan-a-14-nafta', yearUnknown: true }, p)
    expect(unknownYear.vehicle).toMatchObject({ validation: 'identity_basic' })
    expect(unknownYear.vehicle.year).toBeUndefined()
  })

  it('identity_partial: only type, or type + brand', async () => {
    expect((await resolveVehicle({}, { typeId: 't:auto' }, p)).vehicle.validation).toBe('identity_partial')
    expect((await resolveVehicle({ model: 'Escrito' }, { typeId: 't:auto', brandId: 'b:ficticia-autos' }, p)).vehicle).toMatchObject({ make: 'Ficticia Autos', validation: 'identity_partial' })
  })

  it('identity_conflict: a version the source lists inconsistently is never a full identification', async () => {
    const r = await resolveVehicle({ year: 2011 }, { typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-compacto-b', versionId: 'v:compacto-b-13-dudosa' }, p)
    expect(r.issues).toContain('version_source_conflict')
    expect(r.vehicle.validation).toBe('identity_conflict')
    expect(r.vehicle.fuelType).toBeUndefined() // the source does not document it
  })

  it('declared fuel contradicting the version → identity_conflict', async () => {
    const r = await resolveVehicle({ year: 2019, fuelType: 'gasoline' }, { ...sedanA, versionId: 'v:sedan-a-16-diesel' }, p)
    expect(r.vehicle.validation).toBe('identity_conflict')
  })

  it('manual vehicle stays user_declared whatever the client claims', async () => {
    const r = await resolveVehicle({ make: 'Fiat', model: 'Palio', year: 2017, engine: '1.4 8v' }, undefined, p)
    expect(r.vehicle).toEqual({ make: 'Fiat', model: 'Palio', year: 2017, engine: '1.4 8v', engineSource: 'declared', validation: 'user_declared' })
  })

  it('retired IDs: replacement migrates; a retired version only drops the version; no replacement → declared', async () => {
    const migrated = await resolveVehicle({}, { typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-sedan-viejo' }, p)
    expect(migrated.issues).toContain('catalog_id_migrated')
    expect(migrated.vehicle).toMatchObject({ model: 'Sedán A', catalog: { modelId: 'm:ficticia-sedan-a' } })
    const droppedVersion = await resolveVehicle({ year: 2019 }, { ...sedanA, versionId: 'v:sedan-a-13-retirada' }, p)
    expect(droppedVersion.issues).toContain('catalog_id_retired')
    expect(droppedVersion.vehicle).toMatchObject({ validation: 'identity_basic' })
    expect(droppedVersion.vehicle.version).toBeUndefined()
  })

  it('selection made with an older catalog version is re-validated against the current one', async () => {
    const r = await resolveVehicle({ year: 2019 }, { ...sedanA, catalogVersion: 'fixture-2026-01-01.1' }, p)
    expect(r.issues).toContain('catalog_version_changed')
    expect(r.vehicle.validation).toBe('identity_basic')
  })
})
