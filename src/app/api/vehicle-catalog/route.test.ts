/**
 * route.test.ts — GET /api/vehicle-catalog (7D.1). Synthetic fixture via env stubs; no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from './route'
import { resetCatalogRateLimitForTests } from '@/server/vehicle-catalog/catalog-rate-limit'

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/vehicle-catalog?${qs}`))

beforeEach(() => {
  vi.stubEnv('VEHICLE_CATALOG_ENABLED', 'true')
  vi.stubEnv('VEHICLE_CATALOG_SOURCE', 'fixture')
  vi.stubEnv('VERCEL_ENV', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('RT-7D1: catalog route', () => {
  it('kill switch VEHICLE_CATALOG_ENABLED=false → 404, no data', async () => {
    vi.stubEnv('VEHICLE_CATALOG_ENABLED', 'false')
    const res = await get('level=types')
    expect(res.status).toBe(404)
  })

  it('public production never serves the fixture → 404', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await get('level=types')).status).toBe(404)
  })

  it('one level per request with provenance; the fixture is flagged', async () => {
    const res = await get('level=brands&typeId=t:moto')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.map((b: { name: string }) => b.name)).toEqual(['Ejemplo Motors', 'Prueba Motos'])
    expect(body.meta).toMatchObject({ source: 'fixture', isFixture: true })
    expect(body.manualFallback).toBe(false)
  })

  it('versions with and without year', async () => {
    const withYear = await (await get('level=versions&modelId=m:ficticia-sedan-a&year=2024')).json()
    const all = await (await get('level=versions&modelId=m:ficticia-sedan-a')).json()
    expect(withYear.data).toHaveLength(2)
    expect(all.data).toHaveLength(4)
  })

  it('empty category → 200 empty with manualFallback', async () => {
    const body = await (await get('level=brands&typeId=t:camion')).json()
    expect(body).toMatchObject({ empty: true, manualFallback: true, data: [] })
  })

  it('cross-type request → 404 with manualFallback', async () => {
    const res = await get('level=models&typeId=t:moto&brandId=b:ficticia-autos')
    expect(res.status).toBe(404)
    expect((await res.json()).manualFallback).toBe(true)
  })

  it.each(['level=all', 'level=brands', 'level=brands&typeId=auto', 'level=types&extra=1', 'level=versions&modelId=m:x&year=abc'])(
    'invalid query %s → 400 without touching the catalog',
    async (qs) => {
      expect((await get(qs)).status).toBe(400)
    },
  )
})

describe('RT-7D2: rate limit and server-only fields', () => {
  it('per-client limit → 429 with Retry-After and manualFallback; other clients unaffected', async () => {
    vi.stubEnv('VEHICLE_CATALOG_RATE_PER_MINUTE', '3')
    resetCatalogRateLimitForTests()
    const from = (ip: string) => GET(new NextRequest('http://localhost/api/vehicle-catalog?level=types', { headers: { 'x-forwarded-for': ip } }))
    for (let i = 0; i < 3; i++) expect((await from('10.9.9.1')).status).toBe(200)
    const limited = await from('10.9.9.1')
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await limited.json()).toEqual({ error: 'RATE_LIMITED', manualFallback: true })
    expect((await from('10.9.9.2')).status).toBe(200)
  })

  it('versions never carry provenance (source row IDs / raw text) to the browser', async () => {
    resetCatalogRateLimitForTests()
    const body = await (await get('level=versions&modelId=m:ficticia-sedan-a')).json()
    expect(body.data.length).toBeGreaterThan(0)
    for (const v of body.data) {
      expect(v).not.toHaveProperty('provenance')
      expect(v).toHaveProperty('missing')
    }
    expect(JSON.stringify(body)).not.toContain('fixture:')
  })

  it('identity data only: the meta says which source edition and license, never "compatible"', async () => {
    resetCatalogRateLimitForTests()
    const body = await (await get('level=types')).json()
    expect(body.meta).toMatchObject({ source: 'fixture', version: 'fixture-2026-11-14.2', sourceVersion: 'synthetic-2', licenseStatus: 'synthetic', isFixture: true })
    expect(JSON.stringify(body)).not.toMatch(/compatib/i)
  })
})
