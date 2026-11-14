/**
 * vehicle-context.api.test.ts — POST /api/analyze vehicle context (Incremento 7D.1).
 *
 * Before 7D.1 `engine` was silently dropped by the API schema and the graph never saw it. The real
 * graph runs (DeterministicMockLLMAdapter / stub); analyzeCase is only wrapped to observe the
 * vehicle that reaches it. No real LLM, no network. Catalog = synthetic fixture via env stubs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { AnalyzeInput } from '@/agents/graph/types'

const captured = vi.hoisted(() => ({ inputs: [] as AnalyzeInput[] }))

vi.mock('@/agents/graph/analyze-graph', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/agents/graph/analyze-graph')>()
  return {
    ...real,
    analyzeCase: vi.fn(async (input: AnalyzeInput, deps: Parameters<typeof real.analyzeCase>[1]) => {
      captured.inputs.push(input)
      return real.analyzeCase(input, deps)
    }),
  }
})

import { POST } from './route'

let ip = 1
function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.77.${Math.floor(ip / 256)}.${ip++ % 256}` },
      body: JSON.stringify(body),
    }),
  )
}
const TEXT = 'El motor hace un ruido metálico al arrancar en frío.'
const lastVehicle = () => captured.inputs.at(-1)?.vehicle

beforeEach(() => {
  captured.inputs.length = 0
  vi.stubEnv('LLM_PROVIDER', 'stub')
  vi.stubEnv('VEHICLE_CATALOG_ENABLED', 'false')
  vi.stubEnv('VEHICLE_CATALOG_SOURCE', '')
  vi.stubEnv('VERCEL_ENV', '')
})
afterEach(() => vi.unstubAllEnvs())

const enableFixture = () => {
  vi.stubEnv('VEHICLE_CATALOG_ENABLED', 'true')
  vi.stubEnv('VEHICLE_CATALOG_SOURCE', 'fixture')
}

describe('VA-01: engine and fuel are no longer lost', () => {
  it('declared engine and fuel reach the graph, marked as declared', async () => {
    const res = await post({ userText: TEXT, vehicle: { make: 'Fiat', model: 'Palio', year: 2017, engine: '1.4 8v', fuelType: 'gasoline' } })
    expect(res.status).toBe(200)
    expect(lastVehicle()).toMatchObject({
      make: 'Fiat',
      model: 'Palio',
      year: 2017,
      engine: '1.4 8v',
      engineSource: 'declared',
      fuelType: 'gasoline',
      fuelSource: 'declared',
      validation: 'user_declared',
    })
  })

  it('engine longer than 40 characters → 400 (same limit as the forms)', async () => {
    const res = await post({ userText: TEXT, vehicle: { engine: 'x'.repeat(41) } })
    expect(res.status).toBe(400)
  })
})

describe('VA-02: backward compatibility with existing clients', () => {
  it('legacy body (make/model/year/vehicleType/fuelType) works unchanged and is user_declared', async () => {
    const res = await post({ userText: TEXT, vehicle: { make: 'Toyota', model: 'Corolla', year: 2015, vehicleType: 'sedan', fuelType: 'diesel' } })
    expect(res.status).toBe(200)
    const v = lastVehicle()!
    expect(v).toMatchObject({ make: 'Toyota', model: 'Corolla', year: 2015, vehicleType: 'sedan', fuelType: 'diesel', validation: 'user_declared' })
    expect(v.catalog).toBeUndefined()
    expect(v.engine).toBeUndefined()
  })

  it('no vehicle at all still works', async () => {
    const res = await post({ userText: TEXT })
    expect(res.status).toBe(200)
    expect(lastVehicle()).toBeUndefined()
  })
})

describe('VA-03: the client cannot declare its vehicle validated', () => {
  it('a client-sent validation / catalog provenance is ignored', async () => {
    const res = await post({
      userText: TEXT,
      vehicle: { make: 'Fiat', validation: 'catalog_validated', engineSource: 'catalog', catalogProvenance: { source: 'dnrpa' } },
    })
    expect(res.status).toBe(200)
    expect(lastVehicle()).toMatchObject({ make: 'Fiat', validation: 'user_declared' })
    expect(lastVehicle()!.engineSource).toBeUndefined()
  })

  it('catalog IDs with the catalog OFF → user_declared, IDs dropped', async () => {
    const res = await post({ userText: TEXT, vehicle: { make: 'X', catalog: { typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-sedan-a' } } })
    expect(res.status).toBe(200)
    expect(lastVehicle()).toMatchObject({ make: 'X', validation: 'user_declared' })
    expect(lastVehicle()!.catalog).toBeUndefined()
  })

  it('malformed catalog IDs or unknown catalog keys → 400', async () => {
    expect((await post({ userText: TEXT, vehicle: { catalog: { typeId: 'auto' } } })).status).toBe(400)
    expect((await post({ userText: TEXT, vehicle: { catalog: { typeId: 't:auto', validation: 'catalog_validated' } } })).status).toBe(400)
  })
})

describe('VA-04: server-side catalog validation (synthetic fixture)', () => {
  it('valid chain → identity_full; names, engine and fuel come from the catalog', async () => {
    enableFixture()
    const res = await post({
      userText: TEXT,
      vehicle: {
        make: 'nombre-del-cliente',
        model: 'otro',
        year: 2019,
        catalog: { typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-sedan-a', versionId: 'v:sedan-a-16-diesel' },
      },
    })
    expect(res.status).toBe(200)
    expect(lastVehicle()).toMatchObject({
      make: 'Ficticia Autos',
      model: 'Sedán A',
      year: 2019,
      vehicleType: 'sedan',
      version: '1.6 Turbodiésel',
      engine: '1.6 Turbodiésel',
      engineSource: 'catalog',
      fuelType: 'diesel',
      fuelSource: 'catalog',
      validation: 'identity_full',
      catalog: { source: 'fixture', isFixture: true, typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-sedan-a', versionId: 'v:sedan-a-16-diesel' },
    })
  })

  it('invalid combination (motorcycle model under the car type) → user_declared, IDs dropped', async () => {
    enableFixture()
    const res = await post({
      userText: TEXT,
      vehicle: { make: 'Ejemplo Motors', catalog: { typeId: 't:auto', brandId: 'b:ejemplo-motors', modelId: 'm:ejemplo-moto-m' } },
    })
    expect(res.status).toBe(200)
    expect(lastVehicle()).toMatchObject({ make: 'Ejemplo Motors', validation: 'user_declared' })
    expect(lastVehicle()!.catalog).toBeUndefined()
  })

  it('fixture never used on public production (VERCEL_ENV=production) → user_declared', async () => {
    enableFixture()
    vi.stubEnv('VERCEL_ENV', 'production')
    await post({ userText: TEXT, vehicle: { catalog: { typeId: 't:auto', brandId: 'b:ficticia-autos' } } })
    expect(lastVehicle()).toMatchObject({ validation: 'user_declared' })
    expect(lastVehicle()!.catalog).toBeUndefined()
  })

  it('"No sé el año" / "No conozco el motor": year and engine are not invented', async () => {
    enableFixture()
    await post({
      userText: TEXT,
      vehicle: { year: 2019, engine: '1.4', catalog: { typeId: 't:auto', brandId: 'b:ficticia-autos', modelId: 'm:ficticia-sedan-a', yearUnknown: true, engineUnknown: true } },
    })
    const v = lastVehicle()!
    expect(v.validation).toBe('identity_basic')
    expect(v.year).toBeUndefined()
    expect(v.engine).toBeUndefined()
    expect(v.fuelType).toBeUndefined()
  })
})
