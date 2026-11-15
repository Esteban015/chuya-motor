/**
 * vehicle-selection.test.ts — Pure VehicleSelector state (7D.1). Synthetic fixture entities.
 */
import { describe, expect, it } from 'vitest'
import { catalogKey, type CatalogBrand, type CatalogModel, type CatalogType, type CatalogVersion } from './vehicle-catalog'
import {
  initialVehicleSelection as S0,
  manualYearError,
  selectionToApiVehicle,
  selectionToVehicleInfo,
  vehicleSelectionReducer as r,
  type VehicleSelectionAction,
  type VehicleSelectionState,
} from './vehicle-selection'

const auto: CatalogType = { id: 't:auto', category: 'auto', label: 'Auto' }
const moto: CatalogType = { id: 't:moto', category: 'moto', label: 'Moto' }
const ficticia: CatalogBrand = { id: 'b:ficticia-autos', name: 'Ficticia Autos', key: catalogKey('Ficticia Autos'), aliases: [], typeIds: ['t:auto', 't:pickup', 't:suv'] }
const ejemplo: CatalogBrand = { id: 'b:ejemplo-motors', name: 'Ejemplo Motors', key: 'ejemplo motors', aliases: [], typeIds: ['t:auto', 't:moto'] }
const sedanA: CatalogModel = { id: 'm:ficticia-sedan-a', brandId: 'b:ficticia-autos', typeId: 't:auto', name: 'Sedán A', key: 'sedan a', aliases: [], discontinued: false }
const motoM: CatalogModel = { id: 'm:ejemplo-moto-m', brandId: 'b:ejemplo-motors', typeId: 't:moto', name: 'Moto M 150', key: 'moto m 150', aliases: [], discontinued: false }
const v14: CatalogVersion = { id: 'v:sedan-a-14-nafta', modelId: 'm:ficticia-sedan-a', label: '1.4 8V Nafta', years: [2020, 2019, 2018, 2017, 2016, 2015], engine: { displacementL: 1.4, fuel: 'nafta', evidence: 'structured' }, body: 'SEDAN 5 PUERTAS', missing: [], verification: 'source_listed' }
const vEsp: CatalogVersion = { id: 'v:sedan-a-especial', modelId: 'm:ficticia-sedan-a', label: 'Edición Especial', years: [2025, 2024, 2023, 2022, 2021], engine: null, body: null, missing: ['body', 'displacement', 'fuel'], verification: 'source_listed' }

const run = (...actions: VehicleSelectionAction[]) => actions.reduce<VehicleSelectionState>(r, S0)
const full = () => run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: ficticia }, { type: 'selectModel', value: sedanA }, { type: 'selectYear', value: 2017 }, { type: 'selectVersion', value: v14 })

describe('SEL-01: dependent resets', () => {
  it('changing the type clears brand, model, year and version and announces it', () => {
    const s = r(full(), { type: 'selectType', value: moto })
    expect(s).toMatchObject({ type: moto, brand: null, model: null, year: null, version: null })
    expect(s.announcement).toBe('Se borraron la marca, el modelo, el año y la versión porque cambiaste el tipo de vehículo.')
  })

  it('changing the brand clears model, year and version', () => {
    const s = r(full(), { type: 'selectBrand', value: ejemplo })
    expect(s).toMatchObject({ brand: ejemplo, model: null, year: null, yearUnknown: false, version: null })
    expect(s.announcement).toMatch(/el modelo, el año y la versión porque cambiaste la marca/)
  })

  it('changing the model clears year and version', () => {
    const s = r(r(full(), { type: 'selectBrand', value: ficticia }), { type: 'selectModel', value: { ...sedanA, id: 'm:ficticia-compacto-b', name: 'Compacto B' } })
    expect(s).toMatchObject({ year: null, version: null })
  })

  it('a year the version does not list clears the version; a year it lists keeps it', () => {
    expect(r(full(), { type: 'selectYear', value: 2016 }).version).toEqual(v14)
    const s = r(full(), { type: 'selectYear', value: 2024 })
    expect(s.version).toBeNull()
    expect(s.announcement).toMatch(/no figura para el año/)
  })

  it('re-selecting the same value changes nothing', () => {
    const s = full()
    expect(r(s, { type: 'selectType', value: auto })).toBe(s)
    expect(r(s, { type: 'selectBrand', value: ficticia })).toBe(s)
  })
})

describe('SEL-02: invalid selections are never kept', () => {
  it('a brand not listed for the type is ignored', () => {
    const s = run({ type: 'selectType', value: moto }, { type: 'selectBrand', value: ficticia })
    expect(s.brand).toBeNull()
  })

  it('a model of another type or brand is ignored', () => {
    const s = run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: ejemplo }, { type: 'selectModel', value: motoM })
    expect(s.model).toBeNull()
    expect(run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: ejemplo }, { type: 'selectModel', value: sedanA }).model).toBeNull()
  })

  it('a version of another model or not listing the year is ignored; year out of range ignored', () => {
    const base = run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: ficticia }, { type: 'selectModel', value: sedanA }, { type: 'selectYear', value: 2017 })
    expect(r(base, { type: 'selectVersion', value: { ...v14, modelId: 'm:otro' } }).version).toBeNull()
    expect(r(base, { type: 'selectVersion', value: vEsp }).version).toBeNull()
    expect(r(base, { type: 'selectYear', value: 1800 }).year).toBe(2017)
  })

  it('year / version require a model', () => {
    expect(r(S0, { type: 'selectYear', value: 2017 }).year).toBeNull()
    expect(r(S0, { type: 'versionUnknown' }).versionUnknown).toBe(false)
  })
})

describe('SEL-03: unknown year / engine and manual mode', () => {
  it('"No sé el año" lists all versions (year null) and "No conozco el motor" sends no engine', () => {
    const s = run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: ficticia }, { type: 'selectModel', value: sedanA }, { type: 'yearUnknown' }, { type: 'versionUnknown' })
    expect(s).toMatchObject({ year: null, yearUnknown: true, versionUnknown: true })
    expect(selectionToApiVehicle(s)).toEqual({
      vehicleType: 'sedan',
      make: 'Ficticia Autos',
      model: 'Sedán A',
      catalog: { typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-sedan-a', yearUnknown: true, engineUnknown: true },
    })
    expect(selectionToVehicleInfo(s).engine).toBeUndefined()
  })

  it('manual mode keeps chosen values as text, drops every catalog ID and is announced as not verified', () => {
    const s = r(full(), { type: 'switchToManual' })
    expect(s.mode).toBe('manual')
    expect(s.manual).toEqual({ make: 'Ficticia Autos', model: 'Sedán A', year: '2017', engine: '1.4' })
    expect(s.announcement).toMatch(/no se verifican/i)
    const api = selectionToApiVehicle(s)
    expect(api.catalog).toBeUndefined()
    expect(api).toMatchObject({ vehicleType: 'sedan', make: 'Ficticia Autos', year: 2017, engine: '1.4' })
  })

  it('manual fields are trimmed, capped at 40 chars, invalid years flagged and not sent', () => {
    let s = r(S0, { type: 'switchToManual' })
    s = r(s, { type: 'manualField', field: 'make', value: '  Fiat  ' })
    s = r(s, { type: 'manualField', field: 'engine', value: 'x'.repeat(60) })
    s = r(s, { type: 'manualField', field: 'year', value: '1700' })
    expect(manualYearError(s)).toBe('El año debe estar entre 1900 y 2100.')
    const api = selectionToApiVehicle(s)
    expect(api.make).toBe('Fiat')
    expect(api.engine).toHaveLength(40)
    expect(api.year).toBeUndefined()
  })

  it('back to catalog keeps the type and the typed text, but no catalog values', () => {
    const s = r(r(full(), { type: 'switchToManual' }), { type: 'backToCatalog' })
    expect(s).toMatchObject({ mode: 'catalog', type: auto, brand: null, model: null })
    expect(s.manual.make).toBe('Ficticia Autos')
  })

  it('pricing VehicleInfo: engine only when the version states one', () => {
    expect(selectionToVehicleInfo(full())).toEqual({ make: 'Ficticia Autos', model: 'Sedán A', year: '2017', engine: '1.4' })
    const esp = run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: ficticia }, { type: 'selectModel', value: sedanA }, { type: 'selectYear', value: 2022 }, { type: 'selectVersion', value: vEsp })
    expect(selectionToVehicleInfo(esp).engine).toBeUndefined()
  })
})

describe('SEL-04 (7D.3): clearing a searchable field resets its dependents', () => {
  it('clearing the brand clears model, year and version and announces it', () => {
    const s = r(full(), { type: 'clear', field: 'brand' })
    expect(s).toMatchObject({ type: auto, brand: null, model: null, year: null, yearUnknown: false, version: null, versionUnknown: false })
    expect(s.announcement).toBe('Se borraron la marca, el modelo, el año y la versión.')
  })

  it('clearing the model keeps the brand; clearing the version keeps model and year', () => {
    const m = r(full(), { type: 'clear', field: 'model' })
    expect(m).toMatchObject({ brand: ficticia, model: null, year: null, version: null })
    expect(m.announcement).toBe('Se borraron el modelo, el año y la versión.')
    const v = r(full(), { type: 'clear', field: 'version' })
    expect(v).toMatchObject({ brand: ficticia, model: sedanA, year: 2017, version: null, versionUnknown: false })
    expect(v.announcement).toBe('Se borró la versión.')
    const vu = r(run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: ficticia }, { type: 'selectModel', value: sedanA }, { type: 'versionUnknown' }), { type: 'clear', field: 'version' })
    expect(vu.versionUnknown).toBe(false)
  })

  it('clearing an empty field or in manual mode is a no-op', () => {
    const s = run({ type: 'selectType', value: auto })
    expect(r(s, { type: 'clear', field: 'brand' })).toBe(s)
    const manual = r(full(), { type: 'switchToManual' })
    expect(r(manual, { type: 'clear', field: 'brand' })).toBe(manual)
  })
})
