import { describe, expect, it, vi } from 'vitest'
import { checkDeploymentProtection, classifyProtection } from './preview-protection'

describe('PV-01 preview protection check (anonymous, never triggers a search)', () => {
  it('classifies Vercel Authentication / password answers as protected and app answers as public', () => {
    expect(classifyProtection(401, null)).toBe('protected')
    expect(classifyProtection(403, null)).toBe('protected')
    expect(classifyProtection(307, 'https://vercel.com/sso-api?url=https%3A%2F%2Fx.vercel.app')).toBe('protected')
    expect(classifyProtection(200, null)).toBe('public')
    expect(classifyProtection(404, null)).toBe('public')
    expect(classifyProtection(415, null)).toBe('public')
    expect(classifyProtection(302, 'https://example.com/')).toBe('unknown')
    expect(classifyProtection(500, null)).toBe('unknown')
  })

  it('both the page and the pricing API must be protected; the API probe is text/plain with an empty body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const protectedFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response('Authentication Required', { status: 401 })
    }) as unknown as typeof fetch
    expect((await checkDeploymentProtection('https://x-preview.vercel.app/some/path', protectedFetch)).protected).toBe(true)
    expect(calls.map((c) => c.url)).toEqual(['https://x-preview.vercel.app/demo/presupuesto', 'https://x-preview.vercel.app/api/budget/parts-prices'])
    expect(calls[1]!.init).toMatchObject({ method: 'POST', body: '', headers: { 'Content-Type': 'text/plain' } })
    for (const c of calls) expect(JSON.stringify(c.init)).not.toMatch(/bypass|cookie|authorization/i)

    const half = vi.fn(async (url: string) => new Response('', { status: url.endsWith('/demo/presupuesto') ? 401 : 415 })) as unknown as typeof fetch
    const r = await checkDeploymentProtection('https://x-preview.vercel.app', half)
    expect(r).toMatchObject({ protected: false, api: { status: 415, verdict: 'public' } })
    await expect(checkDeploymentProtection('http://x-preview.vercel.app', half)).rejects.toThrow()
  })
})
