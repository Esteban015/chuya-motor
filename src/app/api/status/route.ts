/**
 * GET /api/status — Public site mode for the header badge (Incremento 6.4E).
 *
 * Returns only { mode: 'pilot' | 'demo' } derived from LLM_PROVIDER at request time (not baked at
 * build time). No secrets, no quota store access, no rate limit cost. The per-response badge
 * (aiStatus in POST /api/analyze) remains the authoritative label for each answer.
 */
import { NextResponse } from 'next/server'
import { publicAiMode } from '@/server/public-ai-mode'

export const dynamic = 'force-dynamic'

export function GET(): NextResponse {
  return NextResponse.json({ mode: publicAiMode() }, { headers: { 'Cache-Control': 'no-store' } })
}
