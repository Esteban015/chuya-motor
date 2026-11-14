// @vitest-environment jsdom
/**
 * auto-pricing-panel.test.tsx — Incremento 7C UI. fetch is mocked (no network, SYNTHETIC offers).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ResearchWorkspace } from './research-workspace'
import { AutoPricingPanel } from './auto-pricing-panel'
import type { ResearchLine } from '@/domain/budget/research/types'
import type { ClientOffer, PartsPricesResponse } from '@/domain/budget/research/parts-prices-contract'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', engine: '' }
const line = (id: string, description: string, category: ResearchLine['category'] = 'part'): ResearchLine => ({
  id, description, category, quantity: 1, presentation: 'set', partBrand: '', partCode: '', workshopPriceMinor: 4_000_000, pricePending: false, references: [],
})
const parts = [line('l1', 'Pastillas de freno delanteras'), line('l2', 'Filtro de aire')]

const okBody: PartsPricesResponse = {
  status: 'ok',
  provider: 'serpapi',
  truncated: false,
  items: [
    {
      lineId: 'l1', status: 'ok', hidden: 2,
      offers: [
        { title: 'Pastillas De Freno Delantera Fiat Palio 1997+ - Sintética 123', merchant: 'Tienda Sintética', priceMinor: 3_270_000, currency: 'ARS', url: 'https://www.google.com.ar/search?ibp=oshop&prds=1', retrievedAt: '2026-11-14T17:10:15.187Z', decision: 'candidate', codeMatch: false, missing: ['part_code', 'presentation', 'condition'] },
        { title: 'Pastillas Freno Palio Maliciosa', merchant: 'X', priceMinor: 1_000_000, currency: 'ARS', url: 'javascript:alert(1)', retrievedAt: '2026-11-14T17:10:15.187Z', decision: 'needs_review', codeMatch: false, missing: ['year'] },
      ],
    },
    { lineId: 'l2', status: 'unavailable', reason: 'quota_exceeded', offers: [], hidden: 0 },
  ],
}

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('AP-01 feature flag in the UI', () => {
  it('flag off (default) → no panel, no request, 7B text unchanged', () => {
    const f = mockFetch(200, okBody)
    render(<ResearchWorkspace lines={parts} onLinesChange={() => {}} vehicle={vehicle} mode="quote" />)
    expect(screen.queryByTestId('auto-pricing-panel')).toBeNull()
    expect(screen.getByText(/Chuya Motor no consulta precios/)).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })

  it('flag on → panel with the identified parts only (labor not listed), and NO request on render / rerender', () => {
    const f = mockFetch(200, okBody)
    const lines = [...parts, line('m', 'Mano de obra', 'labor')]
    const { rerender } = render(<ResearchWorkspace lines={lines} onLinesChange={() => {}} vehicle={vehicle} mode="quote" autoPricingEnabled />)
    rerender(<ResearchWorkspace lines={lines} onLinesChange={() => {}} vehicle={{ ...vehicle }} mode="quote" autoPricingEnabled />)
    const chips = within(screen.getByTestId('auto-parts')).getAllByRole('listitem').map((li) => li.textContent)
    expect(chips).toEqual(['Pastillas de freno delanteras', 'Filtro de aire'])
    expect(f).not.toHaveBeenCalled()
  })
})

describe('AP-02 explicit search, results and labels', () => {
  it('one click → one POST with identifying data only; offers with price, merchant, date, safe link, "no verificada" and missing data', async () => {
    const f = mockFetch(200, okBody)
    render(<AutoPricingPanel parts={parts} vehicle={vehicle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar publicaciones' }))
    await screen.findByTestId('auto-results')
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/budget/parts-prices')
    const sent = JSON.parse(String(init.body))
    expect(Object.keys(sent).sort()).toEqual(['lines', 'vehicle'])
    expect(Object.keys(sent.lines[0]).sort()).toEqual(['description', 'id', 'partBrand', 'partCode', 'presentation', 'quantity'])
    expect(JSON.stringify(sent)).not.toContain('4000000') // the workshop price never leaves the browser

    const offers = screen.getAllByTestId('auto-offer')
    expect(offers).toHaveLength(2)
    const first = offers[0]!
    expect(first.textContent).toContain('Compatibilidad no verificada')
    expect(first.textContent).toContain('$ 32.700,00')
    expect(first.textContent).toContain('Tienda Sintética')
    expect(first.textContent).toMatch(/Consultado: 14\/11\/(20)?26/)
    expect(within(first).getByTestId('auto-offer-missing').textContent).toMatch(/Código de pieza.*Presentación.*Estado/)
    const link = within(first).getByRole('link')
    expect(link.getAttribute('href')).toBe('https://www.google.com.ar/search?ibp=oshop&prds=1')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer nofollow')
    // javascript: link from a (tampered) response is never rendered.
    expect(within(offers[1]!).queryByRole('link')).toBeNull()
    expect(offers[1]!.textContent).toContain('Compatibilidad no verificada')
    // Item-level states.
    expect(screen.getByText(/Ocultamos 2 publicaciones que no mencionan el modelo/)).toBeTruthy()
    expect(screen.getByText(/límite de búsquedas automáticas/)).toBeTruthy()
  })

  it('never shows averages, differences or overpricing verdicts', async () => {
    mockFetch(200, okBody)
    render(<AutoPricingPanel parts={parts} vehicle={vehicle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar publicaciones' }))
    const panel = await screen.findByTestId('auto-pricing-panel')
    await screen.findByTestId('auto-results')
    const text = panel.textContent ?? ''
    for (const forbidden of [/promedio/i, /sobreprecio/i, /más caro/i, /más barato/i, /diferencia de/i, /es compatible/i, /\+\d+[.,]?\d* ?%/]) expect(text).not.toMatch(forbidden)
    expect(text).toMatch(/no indican cuánto debería costar la reparación/)
    // Same guard as the 7B E2E (budget-research.spec.ts PRICE_JUDGEMENT): the panel lives inside the report.
    expect(text).not.toMatch(/\bcaro\b|barato|precio justo(?! de mercado)|excesiv|razonable|cobra de m[aá]s|sobreprecio/i)
  })

  it('no repeated search for the same parts; a second click is ignored while loading', async () => {
    let resolve!: (v: Response) => void
    const f = vi.fn(() => new Promise<Response>((r) => (resolve = r)))
    vi.stubGlobal('fetch', f)
    render(<AutoPricingPanel parts={parts} vehicle={vehicle} />)
    const btn = screen.getByRole('button', { name: 'Buscar publicaciones' })
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(f).toHaveBeenCalledTimes(1)
    resolve({ ok: true, status: 200, json: async () => okBody } as Response)
    await screen.findByTestId('auto-results')
    const done = screen.getByRole('button', { name: 'Búsqueda realizada' })
    expect((done as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(done)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('AP-05 compact layout (pilot polish)', () => {
  const offer = (title: string, priceMinor: number, missing: ClientOffer['missing'], decision: ClientOffer['decision'] = 'candidate'): ClientOffer => ({
    title, merchant: 'Tienda Sintética', priceMinor, currency: 'ARS', url: 'https://www.google.com.ar/search?ibp=oshop&prds=1', retrievedAt: '2026-11-14T18:00:00.000Z', decision, codeMatch: false, missing,
  })
  const compactBody: PartsPricesResponse = {
    status: 'ok', provider: 'serpapi', truncated: false,
    items: [{
      lineId: 'l1', status: 'ok', hidden: 0,
      offers: [
        offer('Pastillas Sintéticas Caras', 9_000_000, ['part_code', 'presentation', 'condition', 'year']),
        offer('Pastillas Sintéticas Baratas', 1_000_000, ['part_code', 'presentation', 'condition'], 'needs_review'),
      ],
    }],
  }

  it('missing data collapsed in an accessible <details>, title/price/merchant/date/link/label always visible', async () => {
    mockFetch(200, compactBody)
    render(<AutoPricingPanel parts={parts} vehicle={vehicle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar publicaciones' }))
    await screen.findByTestId('auto-results')
    const card = screen.getAllByTestId('auto-offer')[0]!
    const details = within(card).getByTestId('auto-offer-details') as HTMLDetailsElement
    expect(details.tagName).toBe('DETAILS')
    expect(details.open).toBe(false)
    expect(within(card).getByText(/Qué falta confirmar \(4\)/)).toBeTruthy()
    for (const visible of ['Pastillas Sintéticas Caras', '$ 90.000,00', 'Tienda Sintética', 'Compatibilidad no verificada']) expect(card.textContent).toContain(visible)
    expect(card.textContent).toMatch(/Consultado: 14\/11\/(20)?26/)
    expect(within(card).getByRole('link', { name: /Ver publicación/ })).toBeTruthy()
    // Full information remains available on expansion.
    expect(within(details).getByTestId('auto-offer-missing').textContent).toMatch(/Código de pieza.*Presentación.*Estado.*Año/)
  })

  it('per-part summary: count, coherent vs few data, shared missing data once, provider order (not by price), no "best" wording', async () => {
    mockFetch(200, compactBody)
    render(<AutoPricingPanel parts={parts} vehicle={vehicle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar publicaciones' }))
    await screen.findByTestId('auto-results')
    expect(screen.getByTestId('auto-item-summary').textContent).toBe('2 publicaciones · 1 con título coherente con tu vehículo · 1 con pocos datos. Ordenadas por coincidencia del título, no por precio.')
    expect(screen.getByTestId('auto-item-common-missing').textContent).toBe('En todas falta confirmar: código de pieza, presentación (unidad, par o juego), estado (nuevo o usado).')
    expect(screen.getAllByTestId('auto-offer').map((c) => c.querySelector('p')?.textContent)).toEqual(['Pastillas Sintéticas Caras', 'Pastillas Sintéticas Baratas'])
    const text = screen.getByTestId('auto-pricing-panel').textContent ?? ''
    expect(text).not.toMatch(/mejor precio|mejor compra|recomendad|m[aá]s conveniente|oferta destacada|promedio/i)
  })
})

describe('AP-03 failures keep the manual flow', () => {
  it.each([
    [429, { status: 'rate_limited' }, /varias búsquedas seguidas/],
    [404, { status: 'not_found' }, /no está disponible/],
    [200, { status: 'disabled' }, /no está disponible/],
    [500, null, /no está disponible/],
    [400, { status: 'invalid_request' }, /No pudimos buscar/],
  ])('HTTP %i → clear message, manual search suggested', async (status, body, msg) => {
    mockFetch(status, body)
    render(<AutoPricingPanel parts={parts} vehicle={vehicle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar publicaciones' }))
    const err = await screen.findByTestId('auto-pricing-error')
    expect(err.textContent).toMatch(msg)
    // A failed search can be retried (not marked as done).
    await waitFor(() => expect((screen.getByRole('button', { name: 'Buscar publicaciones' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('network error → message, no crash', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    render(<AutoPricingPanel parts={parts} vehicle={vehicle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar publicaciones' }))
    expect((await screen.findByTestId('auto-pricing-error')).textContent).toMatch(/búsqueda manual/)
  })
})

describe('AP-04 privacy and isolation', () => {
  it('the panel sends nothing to Analytics and does not import server code or secrets', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/budget-research/auto-pricing-panel.tsx'), 'utf8')
    expect(src).not.toMatch(/@vercel\/analytics|gtag|dataLayer|track\(/)
    expect(src).not.toMatch(/server\/parts-pricing|SERPAPI|api_key|process\.env/)
  })
})
