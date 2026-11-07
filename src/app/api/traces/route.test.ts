/**
 * route.test.ts — GET /api/traces
 *
 * Fase 4 — Production isolation for trace data.
 * Tests verify that:
 *   - In production: ALL requests return 404 (server-side check, not client-side).
 *   - In development: valid caseId with stored traces returns 200 + data.
 *   - In development: missing/invalid params return 400.
 *   - In development: unknown caseId returns 404.
 *   - There is no parameter that bypasses the production 404.
 *
 * Strategy: mock process.env.NODE_ENV via vi.stubEnv() for production tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { devTraceStore } from '@/agents/graph/dev-trace-store'
import type { SafeTraceData } from '@/agents/graph/trace-sanitizer'

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000'
const ANOTHER_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function makeGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/traces')
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }
  return new NextRequest(url.toString(), { method: 'GET' })
}

const SAMPLE_TRACES: SafeTraceData[] = [
  {
    nodeId: 'validator',
    status: 'success',
    durationMs: 5,
    timestamp: '2026-11-05T12:00:00.000Z',
    llmCalled: false,
    retryCount: 0,
    fallbackActivated: false,
    dataLabel: 'user_input',
    resultType: 'validation_passed',
  },
  {
    nodeId: 'safetyGate',
    status: 'success',
    durationMs: 8,
    timestamp: '2026-11-05T12:00:00.010Z',
    llmCalled: false,
    retryCount: 0,
    fallbackActivated: false,
    dataLabel: 'user_input',
    resultType: 'safety_passed',
    policyVersion: '1.2.0',
  },
]

// ── TAPI-01: Production isolation — 404 for all requests ─────────────────────

describe('TAPI-01: production isolation — GET /api/traces returns 404', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    devTraceStore.clear()
  })

  it('TAPI-01-A: 404 even when caseId exists in store', async () => {
    devTraceStore.store(VALID_UUID, SAMPLE_TRACES)
    const { GET } = await import('./route')
    const req = makeGetRequest({ caseId: VALID_UUID })
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('TAPI-01-B: 404 even without any caseId parameter', async () => {
    const { GET } = await import('./route')
    const req = makeGetRequest()
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('TAPI-01-C: response body is minimal (error: NOT_FOUND), no trace data', async () => {
    devTraceStore.store(VALID_UUID, SAMPLE_TRACES)
    const { GET } = await import('./route')
    const req = makeGetRequest({ caseId: VALID_UUID })
    const res = await GET(req)
    const body = await res.json() as unknown
    // Should not contain any trace data
    expect(JSON.stringify(body)).not.toContain('validator')
    expect(JSON.stringify(body)).not.toContain('safetyGate')
    expect((body as { error?: string }).error).toBe('NOT_FOUND')
  })

  it('TAPI-01-D: no query param enables tracing in production', async () => {
    devTraceStore.store(VALID_UUID, SAMPLE_TRACES)
    const { GET } = await import('./route')
    // Try various "bypass" parameters — all should still 404
    const attackVectors: Record<string, string>[] = [
      { caseId: VALID_UUID, debug: 'true' },
      { caseId: VALID_UUID, dev: '1' },
      { caseId: VALID_UUID, trace: 'enabled' },
      { caseId: VALID_UUID, 'x-dev': 'true' },
    ]
    for (const params of attackVectors) {
      const req = makeGetRequest(params)
      const res = await GET(req)
      expect(res.status).toBe(404)
    }
  })

  it('TAPI-01-E: Cache-Control: no-store on 404 response', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeGetRequest({ caseId: VALID_UUID }))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

// ── TAPI-02: Development mode ─────────────────────────────────────────────────

describe('TAPI-02: development mode — GET /api/traces', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test') // 'test' is not 'production'
    devTraceStore.clear()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    devTraceStore.clear()
  })

  it('TAPI-02-A: 200 with traces when caseId exists in store', async () => {
    devTraceStore.store(VALID_UUID, SAMPLE_TRACES)
    const { GET } = await import('./route')
    const req = makeGetRequest({ caseId: VALID_UUID })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json() as { caseId: string; traces: SafeTraceData[] }
    expect(body.caseId).toBe(VALID_UUID)
    expect(body.traces).toHaveLength(2)
    expect(body.traces[0]!.nodeId).toBe('validator')
  })

  it('TAPI-02-B: 404 when caseId not found in store', async () => {
    const { GET } = await import('./route')
    const req = makeGetRequest({ caseId: ANOTHER_UUID })
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('TAPI-02-C: 400 when caseId param is missing', async () => {
    const { GET } = await import('./route')
    const res = await GET(makeGetRequest())
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('MISSING_CASE_ID')
  })

  it('TAPI-02-D: 400 when caseId is not a valid UUID', async () => {
    const { GET } = await import('./route')
    const req = makeGetRequest({ caseId: 'not-a-uuid' })
    const res = await GET(req)
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('INVALID_CASE_ID')
  })

  it('TAPI-02-E: traces contain no traceId (server correlation only)', async () => {
    devTraceStore.store(VALID_UUID, SAMPLE_TRACES)
    const { GET } = await import('./route')
    const res = await GET(makeGetRequest({ caseId: VALID_UUID }))
    const body = await res.json() as { traces: SafeTraceData[] }
    for (const t of body.traces) {
      expect(Object.keys(t)).not.toContain('traceId')
    }
  })

  it('TAPI-02-F: Cache-Control: no-store on 200 response', async () => {
    devTraceStore.store(VALID_UUID, SAMPLE_TRACES)
    const { GET } = await import('./route')
    const res = await GET(makeGetRequest({ caseId: VALID_UUID }))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

// ── TAPI-03: UUID injection prevention ───────────────────────────────────────

describe('TAPI-03: caseId validation rejects non-UUID values', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    devTraceStore.clear()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    devTraceStore.clear()
  })

  const invalidIds = [
    '../../../etc/passwd',
    'SELECT * FROM traces',
    '<script>alert(1)</script>',
    '00000000-0000-0000-0000-00000000000',  // too short
    '00000000-0000-0000-0000-000000000000-extra',
    '',
  ]
  for (const id of invalidIds) {
    it(`TAPI-03: rejects caseId="${id.substring(0, 30)}"`, async () => {
      const { GET } = await import('./route')
      const req = makeGetRequest({ caseId: id })
      const res = await GET(req)
      // Should be 400 (invalid) or 400 (missing if empty)
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    })
  }
})
