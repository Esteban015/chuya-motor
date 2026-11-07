// Fase 4 — Production isolation for trace data.
//
// Security contract:
//   - In PRODUCTION: all methods return 404. No trace data is ever exposed.
//   - In DEVELOPMENT: GET returns sanitized traces stored by the analyze route.
//   - The production check is performed SERVER-SIDE (not in client code).
//   - There is no query parameter, header, or flag that enables tracing in production.
//   - TRACE_VERBOSE is a server-only env var; it is never NEXT_PUBLIC_ prefixed.
//
// This endpoint exists to:
//   1. Provide a testable isolation boundary (automated tests assert 404 in prod mode).
//   2. Allow dev tooling to fetch full traces for a completed case.
import { NextRequest, NextResponse } from 'next/server'
import { devTraceStore } from '@/agents/graph/dev-trace-store'

const NOT_FOUND = NextResponse.json(
  { error: 'NOT_FOUND' },
  { status: 404, headers: { 'Cache-Control': 'no-store' } },
)

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Server-side production guard — no way to bypass from client
  if (process.env['NODE_ENV'] === 'production') return NOT_FOUND

  const caseId = req.nextUrl.searchParams.get('caseId')
  if (!caseId) {
    return NextResponse.json(
      { error: 'MISSING_CASE_ID', message: 'Query param caseId is required.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  // Basic UUID format validation — prevents store key injection
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)) {
    return NextResponse.json(
      { error: 'INVALID_CASE_ID', message: 'caseId must be a valid UUID.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const traces = devTraceStore.get(caseId)
  if (!traces) {
    return NOT_FOUND
  }

  return NextResponse.json(
    { caseId, traces },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
