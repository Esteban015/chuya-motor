/**
 * GET /api/vehicle-catalog — one level of the dependent vehicle fields per request (7D.1).
 *
 *   ?level=types
 *   ?level=brands&typeId=t:auto
 *   ?level=models&typeId=t:auto&brandId=b:…
 *   ?level=years&modelId=m:…
 *   ?level=versions&modelId=m:…[&year=2017]       (no year = "No sé el año": all versions)
 *
 * 404 unless the catalog flag is on with an available source (catalog-config.ts). The browser
 * never downloads the whole catalog. Every answer carries the provenance (`meta`, incl.
 * isFixture) and, on failure, `manualFallback: true` so the form offers manual entry.
 * Public, non-personal data. 7D.2: per-client rate limit (catalog-rate-limit.ts, 429 + Retry-After +
 * manualFallback) and server-only provenance stripped from every answer.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { BrandIdSchema, ModelIdSchema, TypeIdSchema, type CatalogResult, type CatalogVersion } from '@/domain/vehicle/vehicle-catalog'
import { getVehicleCatalog } from '@/server/vehicle-catalog/catalog-config'
import { allowCatalogRequest } from '@/server/vehicle-catalog/catalog-rate-limit'

export const dynamic = 'force-dynamic'

const Year = z.coerce.number().int().min(1900).max(2100)
const Query = z.discriminatedUnion('level', [
  z.object({ level: z.literal('types') }).strict(),
  z.object({ level: z.literal('brands'), typeId: TypeIdSchema }).strict(),
  z.object({ level: z.literal('models'), typeId: TypeIdSchema, brandId: BrandIdSchema }).strict(),
  z.object({ level: z.literal('years'), modelId: ModelIdSchema }).strict(),
  z.object({ level: z.literal('versions'), modelId: ModelIdSchema, year: Year.optional() }).strict(),
])

const NO_STORE = { 'Cache-Control': 'no-store' }

/** Server-only fields never leave the server (provenance: source row IDs and raw text). */
function toClient(data: unknown): unknown {
  if (!Array.isArray(data)) return data
  return data.map((item) => {
    if (item && typeof item === 'object' && 'provenance' in item) {
      const { provenance: _omit, ...rest } = item as CatalogVersion
      return rest
    }
    return item
  })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const catalog = getVehicleCatalog()
  if (!catalog) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE })

  // 7D.2: per-client rate, before any parsing or catalog work.
  const rate = await allowCatalogRequest(req.headers)
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED', manualFallback: true },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rate.retryAfterSec) } },
    )
  }

  const q = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()))
  if (!q.success) return NextResponse.json({ error: 'VALIDATION_ERROR', manualFallback: true }, { status: 400, headers: NO_STORE })

  const p = q.data
  let result: CatalogResult<unknown>
  switch (p.level) {
    case 'types':
      result = await catalog.listTypes()
      break
    case 'brands':
      result = await catalog.listBrands(p.typeId)
      break
    case 'models':
      result = await catalog.listModels(p.typeId, p.brandId)
      break
    case 'years':
      result = await catalog.listYears(p.modelId)
      break
    case 'versions':
      result = await catalog.listVersions(p.modelId, p.year ?? null)
      break
  }

  if (!result.ok) {
    const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'TIMEOUT' ? 504 : 503
    return NextResponse.json({ error: result.error, manualFallback: true, meta: catalog.meta }, { status, headers: NO_STORE })
  }
  const empty = Array.isArray(result.data) && result.data.length === 0
  return NextResponse.json(
    { data: toClient(result.data), empty, manualFallback: empty, meta: result.meta },
    { status: 200, headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
  )
}
