/**
 * POST /api/budget/parts-prices — automatic search of published part offers (Incremento 7C).
 * Disabled by default (PARTS_PRICING_ENABLED=true on the server). All logic and guarantees live in
 * src/server/parts-pricing/route-handler.ts. SERPAPI_API_KEY is read only on the server.
 */
import { handlePartsPricesRequest } from '@/server/parts-pricing/route-handler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/**
 * Explicit function limit (s): above the SerpApi timeout (15 s) plus store/cache round trips, and
 * above the browser's own timeout (25 s), so the person always gets the structured "slow
 * provider" answer instead of a platform 504. Valid on every Vercel plan.
 */
export const maxDuration = 30

export function POST(req: Request): Promise<Response> {
  return handlePartsPricesRequest(req)
}
