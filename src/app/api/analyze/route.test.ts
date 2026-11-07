/**
 * route.test.ts — POST /api/analyze
 *
 * Strategy: call the exported POST function directly with real NextRequest objects.
 * No mocks of analyzeCase — the real graph runs with DeterministicMockLLMAdapter.
 * Rate-limit isolation: each test uses a unique x-forwarded-for IP so the
 * in-memory Map never carries state from one test to another.
 * API-06 uses a dedicated IP and exhausts the window in a controlled loop.
 */

import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'

// ── Helpers ──────────────────────────────────────────────────────────────────

let ipCounter = 1

/** Returns a fresh IP string per call, guaranteeing cross-test rate-limit isolation. */
function uniqueIP(): string {
  return `10.0.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`
}

function makeRequest(
  body: unknown,
  extraHeaders: Record<string, string> = {},
  ip?: string,
): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': ip ?? uniqueIP(),
    ...extraHeaders,
  }
  return new NextRequest('http://localhost/api/analyze', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

/** Make a request with a raw string body (for invalid-JSON test). */
function makeRawRequest(rawBody: string, ip?: string): NextRequest {
  return new NextRequest('http://localhost/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip ?? uniqueIP(),
    },
    body: rawBody,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/analyze', () => {
  // ── API-01: valid symptom → 200 with ClientAnalyzeOutput shape ───────────

  it('API-01: valid symptom input → 200 with ClientAnalyzeOutput shape', async () => {
    const req = makeRequest({ userText: 'El motor hace ruido al arrancar en frío.' })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    // Core shape fields
    expect(typeof body.caseId).toBe('string')
    expect(body.caseId.length).toBeGreaterThan(0)
    expect(body.safetyBlocked).toBe(false)
    expect(body.route).toBe('symptom')
    expect(body.fallback).toBe(false)
    // Cache header
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  // ── API-02: valid budget input → 200, route=budget, budget defined ────────

  it('API-02: valid budget input → 200, route=budget, budget.completenessStatus defined', async () => {
    const req = makeRequest({
      userText: 'Aceite motor: 4500\nFiltro de aire: 1500\nTotal: 6000',
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.route).toBe('budget')
    expect(body.budget).not.toBeNull()
    expect(['COMPLETE', 'PARTIAL', 'INVALID']).toContain(body.budget.completenessStatus)
  })

  // ── API-03: safety block → 422 SAFETY_BLOCKED ─────────────────────────────
  // "perdida de frenos" is an exact phrase in blocklist.ts — guaranteed block.

  it('API-03: safety block → 422 with SAFETY_BLOCKED payload', async () => {
    const req = makeRequest({
      userText: 'Tengo una pérdida total de frenos, el pedal no responde.',
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toBe('SAFETY_BLOCKED')
    expect(body.safetyBlocked).toBe(true)
    expect(typeof body.policyVersion).toBe('string')
    expect(body.policyVersion.length).toBeGreaterThan(0)
    expect(typeof body.coverageDisclaimer).toBe('string')
    expect(body.coverageDisclaimer.length).toBeGreaterThan(0)
  })

  // ── API-04: too short input → 400 VALIDATION_ERROR ─────────────────────────

  it('API-04: invalid input (too short) → 400 VALIDATION_ERROR', async () => {
    const req = makeRequest({ userText: 'corto' }) // 5 chars — below 10
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('VALIDATION_ERROR')
  })

  // ── API-05: invalid JSON body → 400 VALIDATION_ERROR ───────────────────────

  it('API-05: invalid JSON body → 400 VALIDATION_ERROR', async () => {
    const req = makeRawRequest('not valid json at all')
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('VALIDATION_ERROR')
  })

  // ── API-06: rate limit → 429 after RATE_LIMIT requests from same IP ────────
  // RATE_LIMIT = 10 (from route.ts). The 11th request must return 429.

  it('API-06: rate limit → 429 after RATE_LIMIT requests from same IP', async () => {
    const dedicatedIP = '192.0.2.99' // RFC 5737 test address — unique to this test

    const validBody = { userText: 'El motor hace ruido al arrancar en frío.' }

    // Fire exactly 10 allowed requests (filling the window)
    for (let i = 0; i < 10; i++) {
      const req = makeRequest(validBody, {}, dedicatedIP)
      const res = await POST(req)
      // All 10 should succeed (not 429)
      expect(res.status).not.toBe(429)
    }

    // 11th request must be rate-limited
    const limitedReq = makeRequest(validBody, {}, dedicatedIP)
    const limitedRes = await POST(limitedReq)
    const body = await limitedRes.json()

    expect(limitedRes.status).toBe(429)
    expect(body.error).toBe('RATE_LIMIT')
  })

  // ── API-07: budget with discrepancy → discrepancy=true ─────────────────────
  // sum of lines = 4500+1500 = 6000; declared = 9000 → discrepancy

  it('API-07: budget with discrepancy → discrepancy=true in response', async () => {
    const req = makeRequest({
      userText: 'Aceite motor: 4500\nFiltro de aire: 1500\nTotal: 9000',
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.budget).not.toBeNull()
    expect(body.budget.discrepancy).toBe(true)
    expect(body.budget.completenessStatus).toBe('COMPLETE')
  })

  // ── API-08: budget correct total → discrepancy=false ───────────────────────

  it('API-08: budget correct total → discrepancy=false', async () => {
    const req = makeRequest({
      userText: 'Aceite motor: 4500\nFiltro de aire: 1500\nTotal: 6000',
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.budget).not.toBeNull()
    expect(body.budget.discrepancy).toBe(false)
  })

  // ── API-09: nodeTrace is null in production mode ─────────────────────────────
  // NODE_ENV is typed read-only by TypeScript's ProcessEnv, but process.env at
  // runtime is a plain object whose properties are writable. We delete the
  // existing key and reassign via the untyped env reference to avoid ts-ignore.

  it('API-09: nodeTrace is null in production mode', async () => {
    // Cast to a mutable record to bypass the read-only TypeScript declaration
    // while still staying within the type system (no @ts-ignore needed).
    const env = process.env as Record<string, string | undefined>
    const original = env['NODE_ENV']
    delete env['NODE_ENV']
    env['NODE_ENV'] = 'production'

    try {
      const req = makeRequest({ userText: 'El motor hace ruido al arrancar en frío.' })
      const res = await POST(req)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.nodeTrace).toBeNull()
    } finally {
      delete env['NODE_ENV']
      if (original !== undefined) {
        env['NODE_ENV'] = original
      }
    }
  })

  // ── API-10: Cache-Control: no-store on every response ────────────────────────

  it('API-10: response always has Cache-Control: no-store header', async () => {
    const req = makeRequest({ userText: 'El motor hace ruido al arrancar en frío.' })
    const res = await POST(req)

    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  // ── API-11: PARTIAL budget (missing lines) → completenessStatus=PARTIAL ────
  // "Filtro de aire: pendiente" matches the missing-line regex in mock adapter.

  it('API-11: PARTIAL budget (missing lines) → completenessStatus=PARTIAL', async () => {
    const req = makeRequest({
      userText: 'Aceite motor: 4500\nFiltro de aire: pendiente',
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.budget).not.toBeNull()
    expect(body.budget.completenessStatus).toBe('PARTIAL')
  })

  // ── API-12: nodeTrace has extended fields in dev mode (Incremento 4) ─────────

  it('API-12: nodeTrace entries have extended fields (timestamp, retryCount, fallbackActivated, resultType)', async () => {
    const req = makeRequest({ userText: 'El motor hace ruido al arrancar en frío.' })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(Array.isArray(body.nodeTrace)).toBe(true)
    expect(body.nodeTrace.length).toBeGreaterThan(0)

    const firstTrace = body.nodeTrace[0]
    expect(typeof firstTrace.timestamp).toBe('string')
    expect(typeof firstTrace.retryCount).toBe('number')
    expect(typeof firstTrace.fallbackActivated).toBe('boolean')
    expect(typeof firstTrace.dataLabel).toBe('string')
    // resultType is optional but should be present on most nodes
    const withResultType = body.nodeTrace.filter((t: { resultType?: string }) => t.resultType !== undefined)
    expect(withResultType.length).toBeGreaterThan(0)
  })

  // ── API-13: nodeTrace does not expose traceId (caseId correlation) ───────────

  it('API-13: nodeTrace entries do not contain traceId', async () => {
    const req = makeRequest({ userText: 'El motor hace ruido al arrancar en frío.' })
    const res = await POST(req)
    const body = await res.json()

    for (const trace of body.nodeTrace ?? []) {
      expect(Object.keys(trace as object)).not.toContain('traceId')
    }
  })

  // ── API-14: devTraceStore populated in dev mode ───────────────────────────────

  it('API-14: in dev mode, trace is stored and retrievable by caseId', async () => {
    const { devTraceStore } = await import('@/agents/graph/dev-trace-store')
    const sizeBefore = devTraceStore.size()

    const req = makeRequest({ userText: 'El motor hace ruido al arrancar en frío.' })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    // Store grew by 1
    expect(devTraceStore.size()).toBe(sizeBefore + 1)
    // Stored traces retrievable by caseId
    const stored = devTraceStore.get(body.caseId)
    expect(stored).not.toBeNull()
    expect(stored!.length).toBeGreaterThan(0)
  })
})
