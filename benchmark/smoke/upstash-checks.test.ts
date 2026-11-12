/**
 * upstash-checks.test.ts — Incremento 6.4E: dry run of the real-Upstash integration checks against
 * FakeUpstash (offline). Proves the script itself is correct before it is authorized against Redis,
 * and that cleanup deletes only the run's own prefix.
 */
import { describe, it, expect } from 'vitest'
import { FakeUpstash } from '../../src/server/llm-protection/fake-upstash'
import { runUpstashChecks } from './upstash-checks'

const TOKEN = 'AXfakeIntegrationToken_0123456789'
const URL_ = 'https://fake-it.upstash.io'

describe('UPS-IT: integration checks (offline dry run)', () => {
  it('UPS-IT-01: every check passes on a Redis-compatible backend; only the run prefix is deleted', async () => {
    const backend = new FakeUpstash()
    backend.expectedToken = TOKEN
    // Someone else's data in the same database must survive the run.
    backend.execute(['SET', 'chuya:llm:groq:calls:2026-11-13', '7'])
    backend.execute(['SET', 'other-app:key', 'x'])

    const report = await runUpstashChecks({ url: URL_, token: TOKEN, prefix: 'it6e-test0001', fetchImpl: backend.fetch })

    expect(report.results.filter((r) => !r.ok)).toEqual([])
    expect(report.passed).toBe(10)
    expect(report.providerCalls).toBe(0)
    expect(report.deletedKeys).toBeGreaterThan(0)
    expect([...backend.data.keys()].some((k) => k.startsWith('it6e-test0001'))).toBe(false)
    expect(backend.execute(['GET', 'chuya:llm:groq:calls:2026-11-13'])).toBe('7')
    expect(backend.execute(['GET', 'other-app:key'])).toBe('x')
    expect(JSON.stringify(backend.commands)).not.toContain(TOKEN)
  }, 20_000)

  it('UPS-IT-02: rejects an unsafe prefix', async () => {
    await expect(runUpstashChecks({ url: URL_, token: TOKEN, prefix: '*', fetchImpl: new FakeUpstash().fetch })).rejects.toThrow(/prefix/)
  })
})
