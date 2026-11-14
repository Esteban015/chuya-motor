/**
 * dnrpa-catalog.test.ts — REAL catalog derived from the DNRPA valuation table (vigencia 01/11/2026).
 * Identification data only (no valuations). Reads the versioned local dataset; no network.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveVehicle } from '@/domain/vehicle/vehicle-validation'
import { selectionToVehicleInfo, initialVehicleSelection, vehicleSelectionReducer } from '@/domain/vehicle/vehicle-selection'
import { buildPartSearch } from '@/domain/budget/research/part-search'
import { DNRPA_DATASET_PATH, loadDnrpaCatalog } from './datasets'
import type { CatalogResult, VehicleCatalogProvider } from '@/domain/vehicle/vehicle-catalog'

const ok = <T,>(r: CatalogResult<T>): T => {
  if (!r.ok) throw new Error(r.error)
  return r.data
}
const p: VehicleCatalogProvider = loadDnrpaCatalog()!

async function chain(typeId: string, brand: string, model: string) {
  const b = ok(await p.listBrands(typeId)).find((x) => x.name.toUpperCase() === brand.toUpperCase())
  const m = b ? ok(await p.listModels(typeId, b.id)).find((x) => x.name.toUpperCase() === model.toUpperCase()) : undefined
  return { b, m }
}

describe('DN-01: the real dataset loads, is consistent and identifies its source', () => {
  it('provenance: DNRPA, edition, license basis and attribution; no valuations anywhere', async () => {
    expect(DNRPA_DATASET_PATH).toMatch(/dnrpa-2026-11-01/)
    expect(p.meta).toMatchObject({ source: 'dnrpa', isFixture: false, licenseStatus: 'public_information', sourcePublishedAt: '2026-11-01' })
    expect(p.meta.attribution).toMatch(/DNRPA/)
    const versions = ok(await p.listVersions((await chain('t:auto', 'Fiat', 'Palio')).m!.id, null))
    // Registry codes stay as provenance; outside it, no long numbers (valuations) exist.
    expect(JSON.stringify(versions.map(({ provenance: _p, ...v }) => v))).not.toMatch(/\b\d{7,9}\b/)
    // Valuation amounts printed in the PDF next to Fiat Palio rows are absent from the shipped file.
    const file = readFileSync(join(process.cwd(), DNRPA_DATASET_PATH), 'utf8')
    for (const amount of ['9743000', '13871100', '9445700', '16060500']) expect(file).not.toContain(amount)
  })

  it('covers the vehicle categories', async () => {
    const types = ok(await p.listTypes()).map((t) => t.category)
    expect(types).toEqual(expect.arrayContaining(['auto', 'moto', 'pickup', 'suv', 'utilitario', 'camion']))
    expect(ok(await p.listBrands('t:auto')).length).toBeGreaterThan(50)
    expect(ok(await p.listBrands('t:moto')).length).toBeGreaterThan(50)
  })
})

describe('DN-02: requested real cases', () => {
  it('Auto → Fiat → Palio → 2017: several versions, discontinued, engine only from the version text', async () => {
    const { m } = await chain('t:auto', 'Fiat', 'Palio')
    expect(m).toMatchObject({ name: 'Palio', discontinued: true })
    expect(ok(await p.listYears(m!.id))).toContain(2017)
    const v2017 = ok(await p.listVersions(m!.id, 2017))
    expect(v2017.length).toBeGreaterThan(3)
    const fire = v2017.find((v) => v.label === 'PALIO FIRE 1.4 8V')
    expect(fire?.engine).toEqual({ displacementL: 1.4, evidence: 'label' })
    expect(fire?.missing).toContain('fuel') // nafta is never inferred
  })

  it('Moto → Bajaj → Rouser: motor not informed in the source', async () => {
    const { m } = await chain('t:moto', 'Bajaj', 'Rouser')
    expect(m).toBeDefined()
    const versions = ok(await p.listVersions(m!.id, null))
    expect(versions.length).toBeGreaterThan(5)
    expect(versions.every((v) => v.engine === null && v.missing.includes('displacement'))).toBe(true)
  })

  it('Pick-up → Toyota → Hilux: multiple versions, diesel read from "TDI"', async () => {
    const { m } = await chain('t:pickup', 'Toyota', 'Hilux')
    const v = ok(await p.listVersions(m!.id, 2020))
    expect(v.length).toBeGreaterThan(10)
    expect(v.some((x) => x.engine?.fuel === 'diesel' && x.engine.displacementL === 2.8)).toBe(true)
  })

  it('SUV → Peugeot → 2008 (registered as "SEDAN 5 PUERTAS"; reviewed category override)', async () => {
    const { m } = await chain('t:suv', 'Peugeot', '2008')
    expect(m).toMatchObject({ name: '2008', discontinued: false })
    expect((await chain('t:auto', 'Peugeot', '2008')).m).toBeUndefined()
  })
})

describe('DN-03: server-side validation with real IDs', () => {
  it('Fiat Palio 2017 + version → identity_full; names from the catalog', async () => {
    const { b, m } = await chain('t:auto', 'Fiat', 'Palio')
    const fire = ok(await p.listVersions(m!.id, 2017)).find((v) => v.label === 'PALIO FIRE 1.4 8V')!
    const r = await resolveVehicle({ make: 'x', model: 'y', year: 2017 }, { typeId: 't:auto', brandId: b!.id, modelId: m!.id, versionId: fire.id }, p)
    expect(r.vehicle).toMatchObject({ make: 'Fiat', model: 'Palio', year: 2017, engine: 'PALIO FIRE 1.4 8V', engineSource: 'catalog', validation: 'identity_full' })
    expect(r.vehicle.fuelType).toBeUndefined()
  })

  it('manipulated IDs: a moto model under the car type, or a brand of another type → user_declared', async () => {
    const rouser = await chain('t:moto', 'Bajaj', 'Rouser')
    const r1 = await resolveVehicle({ make: 'Bajaj' }, { typeId: 't:auto', brandId: rouser.b!.id, modelId: rouser.m!.id }, p)
    expect(r1.vehicle.validation).toBe('user_declared')
    const fiat = await chain('t:auto', 'Fiat', 'Palio')
    const r2 = await resolveVehicle({}, { typeId: 't:auto', brandId: fiat.b!.id, modelId: 'm:fiat-no-existe' }, p)
    expect(r2.issues).toEqual(['catalog_mismatch'])
  })

  it('a current model: 0 km year above the listed years is unverified, not a contradiction', async () => {
    const { b, m } = await chain('t:suv', 'Peugeot', '2008')
    const r = await resolveVehicle({ year: 2026 }, { typeId: 't:suv', brandId: b!.id, modelId: m!.id }, p)
    expect(r.issues).toContain('year_unverified')
    expect(r.vehicle.validation).toBe('identity_basic')
    const old = await chain('t:auto', 'Fiat', 'Palio')
    const r2 = await resolveVehicle({ year: 2026 }, { typeId: 't:auto', brandId: old.b!.id, modelId: old.m!.id }, p)
    expect(r2.vehicle.validation).toBe('identity_conflict') // discontinued: 2026 is a real contradiction
  })
})

describe('DN-04: the selected vehicle reaches the parts search', () => {
  it('selection → VehicleInfo → PartSearchBuilder query (engine as displacement, no duplicated model)', async () => {
    const { b, m } = await chain('t:auto', 'Fiat', 'Palio')
    const fire = ok(await p.listVersions(m!.id, 2017)).find((v) => v.label === 'PALIO FIRE 1.4 8V')!
    const types = ok(await p.listTypes())
    let s = initialVehicleSelection
    s = vehicleSelectionReducer(s, { type: 'selectType', value: types.find((t) => t.id === 't:auto')! })
    s = vehicleSelectionReducer(s, { type: 'selectBrand', value: b! })
    s = vehicleSelectionReducer(s, { type: 'selectModel', value: m! })
    s = vehicleSelectionReducer(s, { type: 'selectYear', value: 2017 })
    s = vehicleSelectionReducer(s, { type: 'selectVersion', value: fire })
    const info = selectionToVehicleInfo(s)
    expect(info).toEqual({ make: 'Fiat', model: 'Palio', year: '2017', engine: '1.4' })
    const { query } = buildPartSearch({ description: 'Bomba de agua', vehicle: info })
    expect(query).toContain('Fiat Palio')
    expect(query).toContain('1.4')
    expect(query).not.toMatch(/PALIO FIRE/)
  })

  it('a diesel version passes "diesel" so the 7C matching can discard gasoline-only listings', async () => {
    const { b, m } = await chain('t:pickup', 'Toyota', 'Hilux')
    const td = ok(await p.listVersions(m!.id, 2020)).find((v) => v.engine?.fuel === 'diesel' && v.engine.displacementL === 2.8)!
    const types = ok(await p.listTypes())
    let s = initialVehicleSelection
    s = vehicleSelectionReducer(s, { type: 'selectType', value: types.find((t) => t.id === 't:pickup')! })
    s = vehicleSelectionReducer(s, { type: 'selectBrand', value: b! })
    s = vehicleSelectionReducer(s, { type: 'selectModel', value: m! })
    s = vehicleSelectionReducer(s, { type: 'selectYear', value: 2020 })
    s = vehicleSelectionReducer(s, { type: 'selectVersion', value: td })
    expect(selectionToVehicleInfo(s).engine).toBe('2.8 diesel')
  })
})

describe('DN-05: performance of GET /api/vehicle-catalog with the real catalog (in-process)', () => {
  it('600 dependent requests from 30 clients: p95 < 200 ms, no full catalog in any answer', async () => {
    const { GET } = await import('@/app/api/vehicle-catalog/route')
    const { NextRequest } = await import('next/server')
    const { resetCatalogRateLimitForTests } = await import('./catalog-rate-limit')
    resetCatalogRateLimitForTests()
    const times: number[] = []
    let maxBytes = 0
    const call = async (qs: string, ip: string) => {
      const t = performance.now()
      const res = await GET(new NextRequest(`http://localhost/api/vehicle-catalog?${qs}`, { headers: { 'x-forwarded-for': ip } }))
      const text = await res.text()
      times.push(performance.now() - t)
      maxBytes = Math.max(maxBytes, text.length)
      expect(res.status).toBe(200)
      return JSON.parse(text).data
    }
    let i = 0
    while (times.length < 600) {
      const ip = `10.123.0.${(i++ % 30) + 1}`
      const types = await call('level=types', ip)
      const type = types[i % types.length]
      const brands = await call(`level=brands&typeId=${type.id}`, ip)
      if (!brands.length) continue
      const brand = brands[(i * 7) % brands.length]
      const models = await call(`level=models&typeId=${type.id}&brandId=${brand.id}`, ip)
      if (!models.length) continue
      const model = models[(i * 13) % models.length]
      await call(`level=years&modelId=${model.id}`, ip)
      await call(`level=versions&modelId=${model.id}`, ip)
    }
    times.sort((a, b) => a - b)
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!
    expect(p95).toBeLessThan(200)
    expect(maxBytes).toBeLessThan(200_000) // one level at a time; the dataset is ~7 MB
  })
})

describe('DN-06 (publication review): traceability, editorial marks, inference audit', () => {
  const dataset = JSON.parse(readFileSync(join(process.cwd(), DNRPA_DATASET_PATH), 'utf8'))

  it('the dataset identifies the exact official document, date and legal basis', () => {
    const src = dataset.manifest.source
    expect(src).toMatchObject({
      id: 'dnrpa',
      publishedAt: '2026-11-01',
      url: 'https://www.dnrpa.gov.ar/valuacion/informacion/01-11-2026.pdf',
      documentSha256: '6b841352d4f7f35feb43bf185e9612827d5fe140b27c551bcb5776d8b20dc1ba',
      license: { status: 'public_information' },
    })
    expect(src.license.reference).toMatch(/Ley 27\.275: art\. 1/)
    expect(src.license.reference).toMatch(/art\. 2/)
    expect(src.license.reference).toMatch(/No existe una licencia específica del PDF ni una autorización individual de la DNRPA/)
    expect(dataset.manifest.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(p.meta.sourceUrl).toBe(src.url)
  })

  it('editorial values are distinguishable from DNRPA values', async () => {
    const suv2008 = (await chain('t:suv', 'Peugeot', '2008')).m
    expect(suv2008?.editorial).toContain('category')
    expect((await chain('t:moto', 'Bajaj', 'Rouser')).m?.editorial).toBeUndefined()
    const mb = dataset.models.filter((m: { brandId: string }) => m.brandId === 'b:mercedes-benz')
    expect(mb.length).toBeGreaterThan(0)
    expect(mb.every((m: { editorial?: string[] }) => m.editorial?.includes('brand'))).toBe(true)
  })

  it('inference audit: no motorcycle displacement, no implausible litres, no model-name decimals', () => {
    const motoModels = new Set(dataset.models.filter((m: { typeId: string }) => m.typeId === 't:moto').map((m: { id: string }) => m.id))
    for (const v of dataset.versions) {
      if (v.engine?.displacementL === undefined) continue
      expect(motoModels.has(v.modelId)).toBe(false)
      expect(v.engine.displacementL).toBeGreaterThanOrEqual(0.6)
      expect(v.engine.displacementL).toBeLessThanOrEqual(8)
      expect(v.engine.evidence).toBe('label')
    }
    // No version claims a fuel without an explicit marker in its own text.
    for (const v of dataset.versions) {
      if (v.engine?.fuel === 'diesel') expect(v.label).toMatch(/TD|DIESEL|HDI|DCI|JTD|MULTIJET|CRDI|D4D|D-4D|CDI|\d[.,]\d ?D\b/)
      if (v.engine?.fuel === 'gnc') expect(v.label).toMatch(/\bGNC\b/)
    }
  })

  it('pre-2002 vehicles are not in the catalog (manual entry covers them)', async () => {
    const { m } = await chain('t:auto', 'Fiat', 'Palio')
    expect(Math.min(...ok(await p.listYears(m!.id))!)).toBeGreaterThanOrEqual(2002)
    expect(dataset.versions.every((v: { years: number[] | null }) => !v.years || Math.min(...v.years) >= 2002)).toBe(true)
  })
})
