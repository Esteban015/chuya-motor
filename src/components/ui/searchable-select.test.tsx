// @vitest-environment jsdom
/**
 * searchable-select.test.tsx — Accessible single-control combobox (Incremento 7D.3).
 * ARIA combobox pattern (editable, list autocomplete): one input, one listbox.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type ComponentProps } from 'react'
import { SearchableSelect, filterOptions, normalizeSearch, type SearchableOption } from './searchable-select'

afterEach(cleanup)

const BRANDS: SearchableOption[] = [
  { value: 'b:citroen', label: 'Citroën' },
  { value: 'b:fiat', label: 'Fiat' },
  { value: 'b:mercedes-benz', label: 'Mercedes Benz' },
  { value: 'b:peugeot', label: 'Peugeot' },
  { value: 'b:volkswagen', label: 'Volkswagen', keywords: ['VW'] },
]

function Harness(props: Partial<ComponentProps<typeof SearchableSelect>> & { initial?: string; onValue?: (v: string) => void }) {
  const { initial = '', onValue, ...rest } = props
  const [value, setValue] = useState(initial)
  return (
    <form onSubmit={(e) => { e.preventDefault(); rest.onChange?.('__submitted__') }}>
      <SearchableSelect
        id="brand"
        label="Marca"
        placeholder="Elegí la marca"
        options={BRANDS}
        clearable
        emptyMessage="No hay marcas que coincidan."
        {...rest}
        value={value}
        onChange={(v) => {
          setValue(v)
          onValue?.(v)
        }}
      />
      <button type="button">Después</button>
    </form>
  )
}

const combo = () => screen.getByRole('combobox', { name: 'Marca' }) as HTMLInputElement
const listbox = () => screen.getByRole('listbox')
const optionTexts = () => within(listbox()).queryAllByRole('option').map((o) => o.getAttribute('data-label'))
const key = (k: string) => fireEvent.keyDown(combo(), { key: k })

describe('SS-01: search helpers', () => {
  it('normalizes case and accents', () => {
    expect(normalizeSearch('  CitroËn  ')).toBe('citroen')
  })

  it('partial, accent-insensitive, every word must match; keywords count; prefix matches first', () => {
    expect(filterOptions(BRANDS, 'citroen').map((o) => o.value)).toEqual(['b:citroen'])
    expect(filterOptions(BRANDS, 'benz merc').map((o) => o.value)).toEqual(['b:mercedes-benz'])
    expect(filterOptions(BRANDS, 'vw').map((o) => o.value)).toEqual(['b:volkswagen'])
    expect(filterOptions(BRANDS, 'e').map((o) => o.label).slice(0, 1)).toEqual(['Citroën'])
    expect(filterOptions([{ value: 'a', label: 'Clase E Sedán' }, { value: 'b', label: 'Gran Sedan' }, { value: 'c', label: 'Sedán' }], 'sedan').map((o) => o.label)).toEqual(['Sedán', 'Clase E Sedán', 'Gran Sedan'])
    expect(filterOptions(BRANDS, '')).toBe(BRANDS)
  })
})

describe('SS-02: ARIA combobox structure', () => {
  it('one labelled combobox controlling one listbox; no separate select or search box', () => {
    render(<Harness />)
    const c = combo()
    expect(c.tagName).toBe('INPUT')
    expect(c.getAttribute('aria-expanded')).toBe('false')
    expect(c.getAttribute('aria-autocomplete')).toBe('list')
    expect(document.querySelectorAll('select')).toHaveLength(0)
    expect(document.querySelectorAll('input')).toHaveLength(1)
    fireEvent.click(c)
    expect(c.getAttribute('aria-expanded')).toBe('true')
    expect(c.getAttribute('aria-controls')).toBe(listbox().id)
    expect(listbox().getAttribute('aria-label')).toBe('Marca')
  })

  it('the list is portalled to <body> (cards with overflow-hidden cannot clip it)', () => {
    render(<div style={{ overflow: 'hidden' }} data-testid="card"><Harness /></div>)
    fireEvent.click(combo())
    expect(screen.getByTestId('brand-popup').parentElement).toBe(document.body)
    expect(screen.getByTestId('card').contains(listbox())).toBe(false)
    expect(screen.getByTestId('brand-popup').style.position).toBe('fixed')
  })
})

describe('SS-03: mouse / touch', () => {
  it('click opens all options; clicking one selects it and shows its label (never the ID)', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    fireEvent.click(combo())
    expect(optionTexts()).toEqual(['Citroën', 'Fiat', 'Mercedes Benz', 'Peugeot', 'Volkswagen'])
    const fiat = within(listbox()).getByRole('option', { name: 'Fiat' })
    fireEvent.mouseDown(fiat)
    fireEvent.click(fiat)
    expect(onValue).toHaveBeenCalledWith('b:fiat')
    expect(combo().value).toBe('Fiat')
    expect(combo().getAttribute('aria-expanded')).toBe('false')
  })

  it('reopening shows every option again with the current one marked selected; a new pick replaces it', () => {
    render(<Harness initial="b:fiat" />)
    expect(combo().value).toBe('Fiat')
    fireEvent.click(combo())
    expect(optionTexts()).toHaveLength(5)
    expect(within(listbox()).getByRole('option', { name: 'Fiat' }).getAttribute('aria-selected')).toBe('true')
    expect(within(listbox()).getByRole('option', { name: 'Peugeot' }).getAttribute('aria-selected')).toBe('false')
    fireEvent.click(within(listbox()).getByRole('option', { name: 'Peugeot' }))
    expect(combo().value).toBe('Peugeot')
  })
})

describe('SS-04: typing filters inside the same field', () => {
  it('filters while typing, ignoring accents; announces the count', () => {
    render(<Harness />)
    fireEvent.change(combo(), { target: { value: 'citro' } })
    expect(combo().getAttribute('aria-expanded')).toBe('true')
    expect(optionTexts()).toEqual(['Citroën'])
    fireEvent.change(combo(), { target: { value: 'CITROËN' } })
    expect(optionTexts()).toEqual(['Citroën'])
    expect(screen.getByTestId('brand-count').textContent).toBe('1 resultado')
  })

  it('no matches → clear empty message, no options', () => {
    render(<Harness />)
    fireEvent.change(combo(), { target: { value: 'zzz' } })
    expect(optionTexts()).toEqual([])
    expect(screen.getByText('No hay marcas que coincidan.')).toBeTruthy()
  })

  it('leaving without picking restores the selected label (typed text is not a value)', () => {
    const onValue = vi.fn()
    render(<Harness initial="b:fiat" onValue={onValue} />)
    fireEvent.change(combo(), { target: { value: 'peu' } })
    fireEvent.blur(combo())
    expect(combo().value).toBe('Fiat')
    expect(onValue).not.toHaveBeenCalled()
  })

  it('pinned options are always offered, even with no matches', () => {
    render(<Harness pinnedOptions={[{ value: '__unknown__', label: 'No conozco el motor' }]} />)
    fireEvent.change(combo(), { target: { value: 'zzz' } })
    expect(optionTexts()).toEqual(['No conozco el motor'])
  })
})

describe('SS-05: keyboard', () => {
  it('ArrowDown opens and moves; aria-activedescendant follows; Enter selects without submitting the form', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    combo().focus()
    key('ArrowDown')
    expect(combo().getAttribute('aria-expanded')).toBe('true')
    const first = within(listbox()).getByRole('option', { name: 'Citroën' })
    expect(combo().getAttribute('aria-activedescendant')).toBe(first.id)
    key('ArrowDown')
    key('ArrowDown')
    key('ArrowUp')
    expect(combo().getAttribute('aria-activedescendant')).toBe(within(listbox()).getByRole('option', { name: 'Fiat' }).id)
    key('Enter')
    expect(onValue).toHaveBeenCalledWith('b:fiat')
    expect(onValue).not.toHaveBeenCalledWith('__submitted__')
    expect(combo().value).toBe('Fiat')
    expect(combo().hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('typing then Enter picks the first match; reopening with arrows starts on the chosen option', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    fireEvent.change(combo(), { target: { value: 'peu' } })
    key('Enter')
    expect(onValue).toHaveBeenLastCalledWith('b:peugeot')
    key('ArrowUp')
    expect(combo().getAttribute('aria-activedescendant')).toBe(within(listbox()).getByRole('option', { name: 'Peugeot' }).id)
  })

  it('ArrowUp on a closed, empty field opens on the last option', () => {
    render(<Harness />)
    key('ArrowUp')
    expect(combo().getAttribute('aria-activedescendant')).toBe(within(listbox()).getByRole('option', { name: 'Volkswagen' }).id)
  })

  it('Escape closes and restores the label; Tab leaves without selecting', () => {
    const onValue = vi.fn()
    render(<Harness initial="b:fiat" onValue={onValue} />)
    fireEvent.change(combo(), { target: { value: 'vol' } })
    key('Escape')
    expect(combo().getAttribute('aria-expanded')).toBe('false')
    expect(combo().value).toBe('Fiat')
    fireEvent.change(combo(), { target: { value: 'vol' } })
    key('ArrowDown')
    key('Tab')
    fireEvent.blur(combo())
    expect(combo().getAttribute('aria-expanded')).toBe('false')
    expect(onValue).not.toHaveBeenCalled()
  })

  it('Home / End jump to the first / last option while open', () => {
    render(<Harness />)
    fireEvent.click(combo())
    key('End')
    expect(combo().getAttribute('aria-activedescendant')).toBe(within(listbox()).getByRole('option', { name: 'Volkswagen' }).id)
    key('Home')
    expect(combo().getAttribute('aria-activedescendant')).toBe(within(listbox()).getByRole('option', { name: 'Citroën' }).id)
  })
})

describe('SS-06: clear, disabled, loading', () => {
  it('clear button empties the value and returns focus to the field', () => {
    const onValue = vi.fn()
    render(<Harness initial="b:fiat" onValue={onValue} />)
    fireEvent.click(screen.getByRole('button', { name: 'Borrar marca' }))
    expect(onValue).toHaveBeenCalledWith('')
    expect(combo().value).toBe('')
    expect(document.activeElement).toBe(combo())
    expect(screen.queryByRole('button', { name: 'Borrar marca' })).toBeNull()
  })

  it('disabled: not focusable for editing, does not open, no clear button', () => {
    render(<Harness initial="b:fiat" disabled />)
    expect(combo().disabled).toBe(true)
    fireEvent.click(combo())
    expect(combo().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Borrar marca' })).toBeNull()
  })

  it('loading: disabled, aria-busy, says it is loading', () => {
    render(<Harness loading loadingText="Cargando marcas…" />)
    expect(combo().disabled).toBe(true)
    expect(combo().getAttribute('aria-busy')).toBe('true')
    expect(combo().placeholder).toBe('Cargando marcas…')
  })

  it('the selected label can be given while options are not loaded (no ID shown)', () => {
    render(<Harness initial="b:otra" options={[]} valueLabel="Otra Marca" />)
    expect(combo().value).toBe('Otra Marca')
  })
})

describe('SS-07: long lists', () => {
  it('renders a bounded number of options and tells the user to keep typing', () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ value: `m:${i}`, label: `Modelo ${i}` }))
    render(<Harness options={many} maxVisible={100} />)
    const t0 = performance.now()
    act(() => fireEvent.click(combo()))
    expect(optionTexts()).toHaveLength(100)
    expect(screen.getByTestId('brand-more').textContent).toContain('Mostrando 100 de 1200')
    fireEvent.change(combo(), { target: { value: 'modelo 1199' } })
    expect(optionTexts()).toEqual(['Modelo 1199'])
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
