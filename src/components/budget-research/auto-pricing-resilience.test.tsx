// @vitest-environment jsdom
/**
 * auto-pricing-resilience.test.tsx — 7C: what the person sees when the search is slow, down,
 * limited or empty. fetch is mocked (no network); one request per explicit click, never retried.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AutoPricingPanel } from './auto-pricing-panel'
import type { ResearchLine } from '@/domain/budget/research/types'
import type { PartsPricesResponse } from '@/domain/budget/research/parts-prices-contract'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', engine: '' }
const line = (id: string, description: string): ResearchLine => ({
  id, description, category: 'part', quantity: 1, presentation: 'unit', partBrand: '', partCode: '', workshopPriceMinor: null, pricePending: false, references: [],
})
const parts = [line('l1', 'Filtro de aire'), line('l2', 'Filtro de aceite'), line('l3', 'Bujías'), line('l4', 'Correa')]

function stubFetch(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}
const respond = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })

async function clickSearch() {
  render(<AutoPricingPanel parts={parts} vehicle={vehicle} />)
  fireEvent.click(screen.getByRole('button', { name: 'Buscar publicaciones' }))
}

describe('APR-01 per-part messages: slow, unavailable, limit, no results', () => {
  it('each situation has its own text; failed parts are never counted as "0 results"', async () => {
    const body: PartsPricesResponse = {
      status: 'ok', provider: 'serpapi', truncated: false,
      items: [
        { lineId: 'l1', status: 'unavailable', reason: 'timeout', offers: [], hidden: 0 },
        { lineId: 'l2', status: 'unavailable', reason: 'network', offers: [], hidden: 0 },
        { lineId: 'l3', status: 'unavailable', reason: 'quota_exceeded', offers: [], hidden: 0 },
        { lineId: 'l4', status: 'no_results', offers: [], hidden: 0 },
      ],
    }
    const f = stubFetch(respond(200, body))
    await clickSearch()
    const items = await screen.findAllByTestId('auto-item')
    expect(items.map((i) => i.getAttribute('data-status'))).toEqual(['unavailable', 'unavailable', 'unavailable', 'no_results'])
    expect(items[0]!.textContent).toContain('tardó demasiado')
    expect(items[0]!.textContent).toContain('no significa que no haya publicaciones')
    expect(items[1]!.textContent).toContain('no está disponible en este momento')
    expect(items[2]!.textContent).toContain('límite de búsquedas')
    expect(items[3]!.textContent).toContain('No encontramos publicaciones')
    for (const i of items.slice(0, 3)) expect(i.textContent).not.toContain('No encontramos publicaciones')
    expect(screen.getByRole('status').textContent).toBe('Búsqueda terminada. 0 publicaciones para revisar. No pudimos consultar 3 repuestos: usá la búsqueda manual.')
    // Not retried by itself, and the same search is not repeated by a second click.
    fireEvent.click(screen.getByRole('button', { name: 'Búsqueda realizada' }))
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('APR-02 request-level failures', () => {
  it('browser timeout → "slow" message (not "unavailable"), one request, button usable again', async () => {
    const f = stubFetch(async () => {
      throw Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })
    })
    await clickSearch()
    expect((await screen.findByTestId('auto-pricing-error')).textContent).toContain('tardó demasiado')
    expect(f).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buscar publicaciones' }).hasAttribute('disabled')).toBe(false))
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('platform 504 → "slow"; network failure / 503 / error → "unavailable"; 429 → limit', async () => {
    const cases: Array<[() => Promise<unknown>, RegExp]> = [
      [respond(504, null), /tardó demasiado/],
      [async () => { throw new TypeError('Failed to fetch') }, /no está disponible/],
      [respond(503, { status: 'error' }), /no está disponible/],
      [respond(200, { status: 'error' }), /no está disponible/],
      [respond(200, { status: 'disabled' }), /no está disponible/],
      [respond(429, { status: 'rate_limited' }), /varias búsquedas seguidas/],
    ]
    for (const [impl, text] of cases) {
      const f = stubFetch(impl)
      await clickSearch()
      expect((await screen.findByTestId('auto-pricing-error')).textContent).toMatch(text)
      expect(f).toHaveBeenCalledTimes(1)
      cleanup()
    }
  })
  it('success with offers keeps the plain summary', async () => {
    const offer = { title: 'Filtro De Aire Fiat Palio', merchant: 'Tienda Sintética', priceMinor: 900_000, currency: 'ARS', url: 'https://www.google.com.ar/shopping/product/9', retrievedAt: '2026-11-14T17:10:15.187Z', decision: 'candidate', codeMatch: false, missing: [] }
    stubFetch(respond(200, { status: 'ok', provider: 'serpapi', truncated: false, items: [{ lineId: 'l1', status: 'ok', offers: [offer], hidden: 0 }] }))
    await clickSearch()
    await screen.findByTestId('auto-results')
    expect(screen.getByRole('status').textContent).toBe('Búsqueda terminada. 1 publicación para revisar.')
  })
})
