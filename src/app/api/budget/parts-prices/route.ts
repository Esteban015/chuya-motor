/**
 * POST /api/budget/parts-prices — automatic search of published part offers (Incremento 7C).
 * Disabled by default (PARTS_PRICING_ENABLED=true on the server). All logic and guarantees live in
 * src/server/parts-pricing/route-handler.ts. SERPAPI_API_KEY is read only on the server.
 */
import { handlePartsPricesRequest } from '@/server/parts-pricing/route-handler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function POST(req: Request): Promise<Response> {
  return handlePartsPricesRequest(req)
}
