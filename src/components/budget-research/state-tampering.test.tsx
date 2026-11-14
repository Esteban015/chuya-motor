// @vitest-environment jsdom
/**
 * state-tampering.test.tsx — Incremento 7B audit: the UI re-validates at render time, so values
 * injected into the page state (devtools, edited descriptions, added parts) never produce a search
 * link for unsafe text, a javascript: link or a crash.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { useState } from 'react'
import { PartCard } from './part-card'
import { ResearchWorkspace } from './research-workspace'
import type { PartReference, ResearchLine } from '@/domain/budget/research/types'

afterEach(cleanup)

const vehicle = { make: 'Fiat', model: 'Palio', year: '2017', engine: '1.4 8v' }
const base: ResearchLine = {
  id: 'l1', description: 'Manguera de respiración de gases', category: 'part', quantity: 1, presentation: 'unit',
  partBrand: '', partCode: '', workshopPriceMinor: 1_800_000, pricePending: false, references: [],
}
const evilRef = {
  id: 'r1', url: 'javascript:alert(1)', store: 'X', priceMinor: Number.NaN, currency: 'ARS', consultedOn: '2026-11-10',
  description: '', compatibility: 'confirmed_equivalent', quantity: 1.5, presentation: 'unit', source: 'user',
} as unknown as PartReference

describe('PartCard with injected state', () => {
  it('unsafe description → no search link, explicit notice', () => {
    render(<ul><PartCard line={{ ...base, description: 'Cómo anular el sensor de frenos' }} vehicle={vehicle} showWorkshopPrice onChange={() => {}} onRemove={() => {}} /></ul>)
    expect(screen.queryByTestId('search-link')).toBeNull()
    const note = screen.getByTestId('search-unavailable')
    expect(note.getAttribute('data-reason')).toBe('unsafe')
    expect(note.textContent).toMatch(/no generamos búsquedas/)
  })

  it('javascript: URL, NaN price and decimal quantity → no link, no NaN, no comparison, no crash', () => {
    const { container } = render(
      <ul><PartCard line={{ ...base, references: [evilRef] }} vehicle={vehicle} showWorkshopPrice onChange={() => {}} onRemove={() => {}} /></ul>,
    )
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(within(screen.getByTestId('reference-item')).queryByRole('link')).toBeNull()
    expect(container.textContent).not.toMatch(/NaN/)
    expect(container.querySelector('[data-comparison="compared"]')).toBeNull()
    expect(screen.getByTestId('search-link').getAttribute('href')).toMatch(/^https:\/\/www\.google\.com\/search\?q=/)
  })
})

function Harness() {
  const [lines, setLines] = useState<ResearchLine[]>([base])
  return <ResearchWorkspace lines={lines} onLinesChange={setLines} vehicle={vehicle} mode="parts" />
}

describe('ResearchWorkspace — "Agregar repuesto"', () => {
  it.each([
    ['Cómo desconectar el ABS', /no generamos búsquedas/],
    ['¿Dónde queda el taller?', /No parece el nombre de un repuesto/],
  ])('rejects %s', (text, message) => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Nombre del repuesto a agregar'), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar repuesto' }))
    expect(screen.getByRole('alert').textContent).toMatch(message)
    expect(screen.getAllByTestId('part-card')).toHaveLength(1)
  })

  it('accepts a part name', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('Nombre del repuesto a agregar'), { target: { value: 'Pastillas de freno delanteras' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar repuesto' }))
    expect(screen.getAllByTestId('part-card')).toHaveLength(2)
  })
})
