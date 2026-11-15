/**
 * vehicle-integration.test.ts — 7D vehicle selection → 7C automatic search (public pilot).
 * The selection goes through the real reducer and selectionToVehicleInfo, then the real route with
 * a spy provider (no SerpApi): the provider query must carry exactly what the catalog documents.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InMemoryQuotaStore } from '@/server/llm-protection/quota-store'
import { initialVehicleSelection, selectionToVehicleInfo, vehicleSelectionReducer as r, type VehicleSelectionAction, type VehicleSelectionState } from '@/domain/vehicle/vehicle-selection'
import type { CatalogBrand, CatalogModel, CatalogType, CatalogVersion } from '@/domain/vehicle/vehicle-catalog'
import type { VehicleInfo } from '@/domain/budget/research/types'
import { handlePartsPricesRequest, resetPartsPricingRuntimeForTests } from './route-handler'
import { buildProviderQuery } from './query'
import type { PriceProvider, PriceQuery } from './types'

const pickup: CatalogType = { id: 't:pickup', category: 'pickup', label: 'Pick-up' }
const auto: CatalogType = { id: 't:auto', category: 'auto', label: 'Auto' }
const toyota: CatalogBrand = { id: 'b:toyota', name: 'Toyota', key: 'toyota', aliases: [], typeIds: ['t:pickup'] }
const fiat: CatalogBrand = { id: 'b:fiat', name: 'Fiat', key: 'fiat', aliases: [], typeIds: ['t:auto'] }
const hilux: CatalogModel = { id: 'm:toyota-hilux', brandId: 'b:toyota', typeId: 't:pickup', name: 'Hilux', key: 'hilux', aliases: [], discontinued: false }
const palio: CatalogModel = { id: 'm:fiat-palio', brandId: 'b:fiat', typeId: 't:auto', name: 'Palio', key: 'palio', aliases: [], discontinued: true }
const v = (o: Partial<CatalogVersion> & Pick<CatalogVersion, 'id' | 'modelId' | 'label'>): CatalogVersion => ({ body: null, years: [2017, 2020], engine: null, missing: [], verification: 'source_listed', ...o })
const hiluxTdi = v({ id: 'v:hilux-28-tdi', modelId: 'm:toyota-hilux', label: '4X4 D/C SRV 2.8 TDI 6 A/T', engine: { displacementL: 2.8, fuel: 'diesel', evidence: 'label' } })
const palioFire = v({ id: 'v:palio-fire', modelId: 'm:fiat-palio', label: 'PALIO FIRE 1.4 8V', engine: { displacementL: 1.4, evidence: 'label' }, missing: ['fuel'] })
const palioNafta = v({ id: 'v:palio-nafta', modelId: 'm:fiat-palio', label: 'PALIO 1.4 NAFTA', engine: { displacementL: 1.4, fuel: 'nafta', evidence: 'structured' } })
const palioNoEngine = v({ id: 'v:palio-esp', modelId: 'm:fiat-palio', label: 'PALIO ESPECIAL', engine: null, missing: ['displacement', 'fuel'] })

const run = (...a: VehicleSelectionAction[]) => a.reduce<VehicleSelectionState>(r, initialVehicleSelection)
const ENV = { PARTS_PRICING_ENABLED: 'true', LLM_QUOTA_STORE: 'memory' }

/** Same request the AutoPricingPanel builds from the VehicleInfo (trimmed, year validated). */
async function queryFor(vehicle: VehicleInfo, description = 'Filtro de aire'): Promise<{ query: string; sent: PriceQuery['vehicle'] }> {
  let captured: PriceQuery | null = null
  const provider: PriceProvider = { id: 'serpapi', search: vi.fn(async (q: PriceQuery) => ((captured = q), { status: 'no_results' as const, offers: [], droppedInvalid: 0, latencyMs: 1 })) }
  const body = { vehicle: { make: vehicle.make ?? '', model: vehicle.model ?? '', year: vehicle.year ?? '', engine: vehicle.engine ?? '' }, lines: [{ id: 'l1', description }] }
  const req = new Request('http://localhost/api/budget/parts-prices', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' }, body: JSON.stringify(body) })
  await handlePartsPricesRequest(req, { env: ENV, provider, store: new InMemoryQuotaStore() })
  expect(captured).not.toBeNull()
  return { query: buildProviderQuery(captured!), sent: captured!.vehicle }
}

beforeEach(() => resetPartsPricingRuntimeForTests())

describe('VI-01 catalog selection → provider query', () => {
  it('Pick-up · Toyota · Hilux · 2020 · 2.8 TDI: make, model, displacement, diesel (from the version) and year', async () => {
    const s = run({ type: 'selectType', value: pickup }, { type: 'selectBrand', value: toyota }, { type: 'selectModel', value: hilux }, { type: 'selectYear', value: 2020 }, { type: 'selectVersion', value: hiluxTdi })
    const { query, sent } = await queryFor(selectionToVehicleInfo(s))
    expect(sent).toEqual({ make: 'Toyota', model: 'Hilux', year: '2020', engine: '2.8 diesel' })
    expect(query).toBe('Filtro de aire Toyota Hilux 2.8 diesel 2020')
    expect(query).not.toMatch(/4X4|D\/C|SRV|A\/T/) // version text is never sent as is
  })

  it('fuel not documented by the source (Palio FIRE 1.4): no fuel word is invented', async () => {
    const s = run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: fiat }, { type: 'selectModel', value: palio }, { type: 'selectYear', value: 2017 }, { type: 'selectVersion', value: palioFire })
    const { query } = await queryFor(selectionToVehicleInfo(s))
    expect(query).toBe('Filtro de aire Fiat Palio 1.4 2017')
    expect(query).not.toMatch(/nafta|diesel|gnc/i)
  })

  it('documented nafta is not added either (default fuel; only distinctive fuels narrow the search)', async () => {
    const s = run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: fiat }, { type: 'selectModel', value: palio }, { type: 'selectYear', value: 2017 }, { type: 'selectVersion', value: palioNafta })
    expect((await queryFor(selectionToVehicleInfo(s))).query).toBe('Filtro de aire Fiat Palio 1.4 2017')
  })
})

describe('VI-02 incomplete vehicles', () => {
  it('version without engine data, "No sé el año", "No conozco el motor": only what is known is sent', async () => {
    const noEngine = run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: fiat }, { type: 'selectModel', value: palio }, { type: 'selectYear', value: 2017 }, { type: 'selectVersion', value: palioNoEngine })
    expect((await queryFor(selectionToVehicleInfo(noEngine))).query).toBe('Filtro de aire Fiat Palio 2017')
    const unknownYear = run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: fiat }, { type: 'selectModel', value: palio }, { type: 'yearUnknown' }, { type: 'versionUnknown' })
    const r1 = await queryFor(selectionToVehicleInfo(unknownYear))
    expect(r1.query).toBe('Filtro de aire Fiat Palio')
    expect(r1.sent).toEqual({ make: 'Fiat', model: 'Palio', year: undefined, engine: undefined })
  })

  it('type only / brand only: no model, nothing invented', async () => {
    expect((await queryFor(selectionToVehicleInfo(run({ type: 'selectType', value: auto })))).query).toBe('Filtro de aire')
    expect((await queryFor(selectionToVehicleInfo(run({ type: 'selectType', value: auto }, { type: 'selectBrand', value: fiat })))).query).toBe('Filtro de aire Fiat')
  })

  it('manual entry ("No encuentro mi vehículo"): the typed text is used, sanitized; never a plate', async () => {
    let s = run({ type: 'selectType', value: auto }, { type: 'switchToManual' })
    for (const [field, value] of [['make', 'Renault'], ['model', 'Clio'], ['year', '1999'], ['engine', '1.2 16v AB123CD']] as const) s = r(s, { type: 'manualField', field, value })
    const { query } = await queryFor(selectionToVehicleInfo(s))
    expect(query).toContain('Filtro de aire Renault Clio')
    expect(query).toContain('1999')
    expect(query).not.toContain('AB123CD')
  })
})
