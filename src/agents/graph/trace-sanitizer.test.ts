import { describe, it, expect } from 'vitest'
import { sanitizeTrace, sanitizeTraces, totalDurationMs } from './trace-sanitizer'
import type { TraceMetadata } from './trace'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTrace(overrides: Partial<TraceMetadata> = {}): TraceMetadata {
  return {
    traceId: 'test-case-id',
    nodeId: 'testNode',
    timestamp: '2026-11-05T12:00:00.000Z',
    durationMs: 42,
    status: 'success',
    llmCalled: false,
    retryCount: 0,
    dataLabel: 'synthetic_demo',
    fallbackActivated: false,
    ...overrides,
  }
}

// ── TSAN-01: allowlist fields only ────────────────────────────────────────────

describe('TSAN-01: sanitizeTrace — allowlist-based field filtering', () => {
  it('TSAN-01-A: returns only allowed structural fields', () => {
    const trace = makeTrace()
    const safe = sanitizeTrace(trace)
    // All expected fields present
    expect(safe.nodeId).toBe('testNode')
    expect(safe.status).toBe('success')
    expect(safe.durationMs).toBe(42)
    expect(safe.timestamp).toBe('2026-11-05T12:00:00.000Z')
    expect(safe.llmCalled).toBe(false)
    expect(safe.retryCount).toBe(0)
    expect(safe.fallbackActivated).toBe(false)
    expect(safe.dataLabel).toBe('synthetic_demo')
  })

  it('TSAN-01-B: traceId (caseId correlation) is NOT included in safe output', () => {
    const trace = makeTrace()
    const safe = sanitizeTrace(trace)
    // traceId should not be in the output
    expect(Object.keys(safe)).not.toContain('traceId')
  })

  it('TSAN-01-C: optional fields present only when defined on source', () => {
    const trace = makeTrace({
      llmModel: 'deterministic-mock-v1',
      errorCode: 'TEST_ERROR',
      policyVersion: '1.2.0',
      resultType: 'hypotheses_generated',
      tokensUsed: 150,
    })
    const safe = sanitizeTrace(trace)
    expect(safe.llmModel).toBe('deterministic-mock-v1')
    expect(safe.errorCode).toBe('TEST_ERROR')
    expect(safe.policyVersion).toBe('1.2.0')
    expect(safe.resultType).toBe('hypotheses_generated')
    expect(safe.tokensUsed).toBe(150)
  })

  it('TSAN-01-D: optional fields absent when undefined on source', () => {
    const trace = makeTrace() // no optional fields
    const safe = sanitizeTrace(trace)
    expect(safe.llmModel).toBeUndefined()
    expect(safe.errorCode).toBeUndefined()
    expect(safe.policyVersion).toBeUndefined()
    expect(safe.resultType).toBeUndefined()
    expect(safe.tokensUsed).toBeUndefined()
  })
})

// ── TSAN-02: PII and sensitive data never in output ───────────────────────────

describe('TSAN-02: PII / sensitive data never passes sanitizeTrace', () => {
  it('TSAN-02-A: a trace with hypothetical extra PII field does not bleed through', () => {
    // Simulate a future/accidental field containing PII
    const trace = {
      ...makeTrace(),
      userText: 'sensitive user input that must never appear',
      email: 'user@example.com',
      plate: 'ABC123',
    } as unknown as TraceMetadata

    const safe = sanitizeTrace(trace)
    // The allowlist prevents any extra field from leaking
    const keys = Object.keys(safe)
    expect(keys).not.toContain('userText')
    expect(keys).not.toContain('email')
    expect(keys).not.toContain('plate')
    expect(JSON.stringify(safe)).not.toContain('sensitive user input')
    expect(JSON.stringify(safe)).not.toContain('user@example.com')
    expect(JSON.stringify(safe)).not.toContain('ABC123')
  })

  it('TSAN-02-B: free-text errorMessage does not pass through (only structured errorCode)', () => {
    const trace = {
      ...makeTrace(),
      errorMessage: 'Internal stack trace: at Function.Module._load ...',
    } as unknown as TraceMetadata

    const safe = sanitizeTrace(trace)
    expect(Object.keys(safe)).not.toContain('errorMessage')
    expect(JSON.stringify(safe)).not.toContain('Internal stack trace')
  })
})

// ── TSAN-03: sanitizeTraces (array) ──────────────────────────────────────────

describe('TSAN-03: sanitizeTraces — array variant', () => {
  it('TSAN-03-A: empty array returns empty array', () => {
    expect(sanitizeTraces([])).toEqual([])
  })

  it('TSAN-03-B: each element is sanitized individually', () => {
    const traces = [
      makeTrace({ nodeId: 'validator', resultType: 'validation_passed' }),
      makeTrace({ nodeId: 'safetyGate', status: 'blocked', resultType: 'safety_blocked', policyVersion: '1.2.0' }),
      makeTrace({ nodeId: 'reportBuilder', resultType: 'report_blocked' }),
    ]
    const safe = sanitizeTraces(traces)
    expect(safe).toHaveLength(3)
    expect(safe[0]!.nodeId).toBe('validator')
    expect(safe[0]!.resultType).toBe('validation_passed')
    expect(safe[1]!.status).toBe('blocked')
    expect(safe[1]!.policyVersion).toBe('1.2.0')
    expect(safe[2]!.nodeId).toBe('reportBuilder')
  })
})

// ── TSAN-04: totalDurationMs ──────────────────────────────────────────────────

describe('TSAN-04: totalDurationMs helper', () => {
  it('TSAN-04-A: single trace returns its own durationMs', () => {
    const traces = sanitizeTraces([makeTrace({ durationMs: 50 })])
    expect(totalDurationMs(traces)).toBe(50)
  })

  it('TSAN-04-B: empty array returns 0', () => {
    expect(totalDurationMs([])).toBe(0)
  })

  it('TSAN-04-C: multiple traces — total spans from first to last + last duration', () => {
    // t0: start=0ms, duration=10ms → ends at 10ms
    // t1: start=20ms, duration=15ms → ends at 35ms
    // total = 35ms - 0ms = 35ms
    const t0 = '2026-11-05T12:00:00.000Z'
    const t1 = '2026-11-05T12:00:00.020Z'
    const traces = sanitizeTraces([
      makeTrace({ timestamp: t0, durationMs: 10 }),
      makeTrace({ timestamp: t1, durationMs: 15 }),
    ])
    expect(totalDurationMs(traces)).toBe(35)
  })

  it('TSAN-04-D: traces out of insertion order are still computed correctly', () => {
    const t0 = '2026-11-05T12:00:00.000Z'
    const t1 = '2026-11-05T12:00:00.030Z'
    // Insert t1 before t0 — totalDurationMs must sort by timestamp
    const traces = sanitizeTraces([
      makeTrace({ timestamp: t1, durationMs: 5 }),
      makeTrace({ timestamp: t0, durationMs: 8 }),
    ])
    // t0 is first (0ms), t1 is last (30ms), t1.duration=5 → total = 30 + 5 = 35ms
    expect(totalDurationMs(traces)).toBe(35)
  })
})

// ── TSAN-05: status enum integrity ───────────────────────────────────────────

describe('TSAN-05: all status values survive sanitization', () => {
  const statuses: TraceMetadata['status'][] = ['success', 'fallback_used', 'blocked', 'skipped', 'error']
  for (const status of statuses) {
    it(`TSAN-05: status '${status}' preserved`, () => {
      const safe = sanitizeTrace(makeTrace({ status }))
      expect(safe.status).toBe(status)
    })
  }
})

// ── 6.4F (D-13): schema issue codes are structural only ──────────────────────

describe('TS-6.4F: schemaIssues allowlist', () => {
  it('keeps "<path pattern>:<code>" codes and drops anything that could carry content', () => {
    const safe = sanitizeTrace(
      makeTrace({
        schemaIssues: ['hypotheses.*.caveats.*:too_big', '$:json_parse', 'Mi patente es ABC123', 'facts.*:too big with text', 'x:y'.repeat(40)],
      }),
    )
    expect(safe.schemaIssues).toEqual(['hypotheses.*.caveats.*:too_big', '$:json_parse'])
  })

  it('omits the field when nothing structural remains', () => {
    expect(sanitizeTrace(makeTrace({ schemaIssues: ['texto libre del modelo'] }))).not.toHaveProperty('schemaIssues')
  })
})
