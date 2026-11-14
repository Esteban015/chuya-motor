// @vitest-environment jsdom
/**
 * vehicle-selector.test.tsx — VehicleSelector UI (Incremento 7D.1). The loader is backed by the
 * SYNTHETIC fixture through the real StaticCatalogProvider; no network, no fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useReducer } from 'react'
import { initialVehicleSelection, selectionToApiVehicle, vehicleSelectionReducer, type VehicleSelectionState } from '@/domain/vehicle/vehicle-selection'
import { FIXTURE_CATALOG } from '@/server/vehicle-catalog/fixture-catalog'
import { StaticCatalogProvider, type CatalogDataset } from '@/server/vehicle-catalog/static-catalog-provider'
import type { CatalogResult } from '@/domain/vehicle/vehicle-catalog'
import { VehicleSelector, createSessionCachedLoader, fetchCatalogLevel, versionOptionLabel, yearOptions, type CatalogLoader, type CatalogQuery } from './vehicle-selector'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function loaderFor(dataset: CatalogDataset = FIXTURE_CATALOG): CatalogLoader & { calls: CatalogQuery[] } {
  const p = new StaticCatalogProvider(dataset)
  const calls: CatalogQuery[] = []
  const fn = (async (q: CatalogQuery) => {
    calls.push(q)
    const r: CatalogResult<unknown> =
      q.level === 'types' ? await p.listTypes()
      : q.level === 'brands' ? await p.listBrands(q.typeId)
      : q.level === 'models' ? await p.listModels(q.typeId, q.brandId)
      : q.level === 'years' ? await p.listYears(q.modelId)
      : await p.listVersions(q.modelId, q.year)
    return r.ok ? { ok: true as const, data: r.data, meta: r.meta } : { ok: false as const, reason: 'error' as const }
  }) as unknown as CatalogLoader & { calls: CatalogQuery[] }
  fn.calls = calls
  return fn
}

let lastState: VehicleSelectionState = initialVehicleSelection
function Harness({ loader, askVersion = true }: { loader: CatalogLoader; askVersion?: boolean }) {
  const [state, dispatch] = useReducer(vehicleSelectionReducer, initialVehicleSelection)
  lastState = state
  return <VehicleSelector state={state} dispatch={dispatch} loader={loader} askVersion={askVersion} typeRequired />
}

const optionLabels = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent)
const brandSelect = () => screen.getByLabelText('Marca', { selector: 'select' })
const modelSelect = () => screen.getByLabelText('Modelo', { selector: 'select' })
const yearSelect = () => screen.getByLabelText(/^Año/, { selector: 'select' })
const versionSelect = () => screen.getByLabelText('Versión / motor', { selector: 'select' })

async function pick(select: () => HTMLElement, label: string) {
  await waitFor(() => expect(optionLabels(select())).toContain(label))
  const opt = within(select()).getAllByRole('option').find((o) => o.textContent === label) as HTMLOptionElement
  fireEvent.change(select(), { target: { value: opt.value } })
}

async function chooseType(label: string) {
  fireEvent.click(await screen.findByRole('radio', { name: label }))
}

describe('VS-01: dependent options per type', () => {
  it('Moto → only motorcycle brands and models', async () => {
    render(<Harness loader={loaderFor()} />)
    await chooseType('Moto')
    await waitFor(() => expect(optionLabels(brandSelect())).toEqual(['Elegí la marca', 'Ejemplo Motors', 'Prueba Motos']))
    await pick(brandSelect, 'Ejemplo Motors')
    await waitFor(() => expect(optionLabels(modelSelect())).toEqual(['Elegí el modelo', 'Moto M 150']))
  })

  it('Auto → car brands; the same brand only shows its car models', async () => {
    render(<Harness loader={loaderFor()} />)
    await chooseType('Auto')
    await pick(brandSelect, 'Ejemplo Motors')
    await waitFor(() => expect(optionLabels(modelSelect())).toEqual(['Elegí el modelo', 'Hatch E']))
  })

  it('discontinued models are shown and labelled', async () => {
    render(<Harness loader={loaderFor()} />)
    await chooseType('Auto')
    await pick(brandSelect, 'Ficticia Autos')
    await waitFor(() => expect(optionLabels(modelSelect())).toContain('Compacto B (ya no se fabrica)'))
  })

  it('dependent controls are disabled until their parent is chosen', async () => {
    render(<Harness loader={loaderFor()} />)
    await screen.findByRole('radio', { name: 'Auto' })
    expect((brandSelect() as HTMLSelectElement).disabled).toBe(true)
    expect((modelSelect() as HTMLSelectElement).disabled).toBe(true)
    expect((yearSelect() as HTMLSelectElement).disabled).toBe(true)
    expect((versionSelect() as HTMLSelectElement).disabled).toBe(true)
  })
})

describe('VS-02: resets of dependent fields', () => {
  it('changing the type clears brand and model and announces it', async () => {
    render(<Harness loader={loaderFor()} />)
    await chooseType('Auto')
    await pick(brandSelect, 'Ejemplo Motors')
    await pick(modelSelect, 'Hatch E')
    await chooseType('Moto')
    await waitFor(() => expect((brandSelect() as HTMLSelectElement).value).toBe(''))
    expect((modelSelect() as HTMLSelectElement).value).toBe('')
    expect(screen.getByTestId('vehicle-selector-live').textContent).toContain('Se borraron la marca y el modelo porque cambiaste el tipo de vehículo.')
  })

  it('changing the brand clears model, year and version', async () => {
    render(<Harness loader={loaderFor()} />)
    await chooseType('Auto')
    await pick(brandSelect, 'Ficticia Autos')
    await pick(modelSelect, 'Sedán A')
    await pick(yearSelect, '2017')
    await pick(versionSelect, '1.4 8V Nafta · Sedan 5 puertas')
    await pick(brandSelect, 'Ejemplo Motors')
    expect(lastState).toMatchObject({ model: null, year: null, version: null })
    expect((yearSelect() as HTMLSelectElement).value).toBe('')
    expect((versionSelect() as HTMLSelectElement).value).toBe('')
  })
})

describe('VS-03: unknown year / engine and versions', () => {
  it('versions depend on the year; "No sé el año" lists all; "No conozco el motor" is offered', async () => {
    render(<Harness loader={loaderFor()} />)
    await chooseType('Auto')
    await pick(brandSelect, 'Ficticia Autos')
    await pick(modelSelect, 'Sedán A')
    await pick(yearSelect, '2024')
    await waitFor(() => expect(optionLabels(versionSelect())).toEqual(['Elegí la versión', '1.6 Turbodiésel · Sedan 5 puertas', 'Edición Especial · motor no informado', 'No conozco el motor ni la versión']))
    await pick(yearSelect, 'No sé el año')
    await waitFor(() => expect(optionLabels(versionSelect())).toHaveLength(6))
    await pick(versionSelect, 'No conozco el motor ni la versión')
    expect(selectionToApiVehicle(lastState).catalog).toMatchObject({ yearUnknown: true, engineUnknown: true })
  })

  it('a version without engine data says so instead of guessing', async () => {
    render(<Harness loader={loaderFor()} />)
    await chooseType('Auto')
    await pick(brandSelect, 'Ficticia Autos')
    await pick(modelSelect, 'Sedán A')
    await pick(yearSelect, '2022')
    await pick(versionSelect, 'Edición Especial · motor no informado')
    expect(screen.getByText('El catálogo no indica el motor de esta versión.')).toBeTruthy()
  })

  it('model without year data: years are offered as unverified, plus "No sé el año"', async () => {
    render(<Harness loader={loaderFor()} />)
    await chooseType('Auto')
    await pick(brandSelect, 'Ficticia Autos')
    await pick(modelSelect, 'Clásico C (ya no se fabrica)')
    await waitFor(() => expect(screen.getByLabelText(/el catálogo no tiene años/)).toBeTruthy())
    expect(screen.getByText('El año que elijas se toma como dato tuyo, sin verificar.')).toBeTruthy()
    expect(optionLabels(screen.getByLabelText(/el catálogo no tiene años/))).toContain('No sé el año')
  })

  it('askVersion=false hides the version step (diagnosis does not need it)', async () => {
    render(<Harness loader={loaderFor()} askVersion={false} />)
    await screen.findByRole('radio', { name: 'Auto' })
    expect(screen.queryByLabelText('Versión / motor')).toBeNull()
  })
})

describe('VS-04: empty, failing, timing out and offline catalog', () => {
  it('empty category → message and manual entry', async () => {
    render(<Harness loader={loaderFor()} />)
    await chooseType('Camión')
    expect((await screen.findByTestId('vehicle-selector-empty')).textContent).toContain('No hay marcas cargadas para este tipo.')
    fireEvent.click(within(screen.getByTestId('vehicle-selector-empty')).getByRole('button', { name: 'Escribir los datos a mano' }))
    expect(screen.getByTestId('vehicle-selector-unverified')).toBeTruthy()
  })

  it('provider error → alert with retry; retry recovers', async () => {
    const good = loaderFor()
    let fail = true
    const flaky: CatalogLoader = async (q, s) => (fail ? { ok: false, reason: 'error' } : good(q, s))
    render(<Harness loader={flaky} />)
    expect((await screen.findByTestId('vehicle-selector-error')).textContent).toContain('No pudimos cargar el catálogo')
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('radio', { name: 'Auto' })).toBeTruthy()
  })

  it('timeout and offline have their own messages; offline offers manual entry, not retry', async () => {
    const { unmount } = render(<Harness loader={async () => ({ ok: false, reason: 'timeout' })} />)
    expect((await screen.findByTestId('vehicle-selector-error')).textContent).toContain('tardó demasiado')
    unmount()
    render(<Harness loader={async () => ({ ok: false, reason: 'offline' })} />)
    const alert = await screen.findByTestId('vehicle-selector-error')
    expect(alert.textContent).toContain('Sin conexión')
    expect(within(alert).queryByRole('button', { name: 'Reintentar' })).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Escribir los datos a mano' }))
    // Manual mode works without the catalog: static type options.
    expect(screen.getByRole('radio', { name: 'Utilitario' })).toBeTruthy()
  })

  it('default loader: offline browser → offline without fetching; HTTP 404 (flag off) → error', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 404 }))
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('navigator', { onLine: false })
    expect(await fetchCatalogLevel({ level: 'types' }, new AbortController().signal)).toEqual({ ok: false, reason: 'offline' })
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.stubGlobal('navigator', { onLine: true })
    expect(await fetchCatalogLevel({ level: 'brands', typeId: 't:auto' }, new AbortController().signal)).toEqual({ ok: false, reason: 'error' })
    expect(fetchSpy).toHaveBeenCalledWith('/api/vehicle-catalog?level=brands&typeId=t%3Aauto', expect.anything())
  })
})

describe('VS-05: manual alternative clearly marked as not verified', () => {
  it('keeps chosen values as text, is labelled unverified, and can go back', async () => {
    render(<Harness loader={loaderFor()} />)
    await chooseType('Auto')
    await pick(brandSelect, 'Ficticia Autos')
    fireEvent.click(screen.getByRole('button', { name: 'No encuentro mi vehículo' }))
    expect(screen.getByTestId('vehicle-selector-unverified').textContent).toContain('Datos escritos a mano. No se verifican con un catálogo.')
    expect((screen.getByLabelText('Marca') as HTMLInputElement).value).toBe('Ficticia Autos')
    expect((screen.getByRole('radio', { name: 'Auto' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '1800' } })
    expect(screen.getByRole('alert').textContent).toContain('El año debe estar entre 1900 y 2100.')
    expect(selectionToApiVehicle(lastState).catalog).toBeUndefined()
    fireEvent.click(screen.getByRole('button', { name: 'Volver a elegir de la lista' }))
    expect(await screen.findByLabelText('Marca', { selector: 'select' })).toBeTruthy()
  })
})

describe('VS-06: test data never poses as the Argentine catalog; accessibility', () => {
  it('fixture note is visible whenever the synthetic catalog is served', async () => {
    render(<Harness loader={loaderFor()} />)
    expect((await screen.findByTestId('vehicle-catalog-fixture-note')).textContent).toContain('no representan vehículos reales ni el mercado argentino')
  })

  it('type options form a labelled radio group; long lists get a labelled search box', async () => {
    const big: CatalogDataset = JSON.parse(JSON.stringify(FIXTURE_CATALOG))
    for (let i = 0; i < 10; i++) big.brands.push({ id: `b:extra-${i}`, name: `Marca Ficticia ${i}`, aliases: [], typeIds: ['t:auto'] })
    render(<Harness loader={loaderFor(big)} />)
    const group = await screen.findByRole('group', { name: /Tipo de vehículo/ })
    expect(within(group).getAllByRole('radio')).toHaveLength(7)
    await chooseType('Auto')
    const search = await screen.findByLabelText('Buscar marca')
    fireEvent.change(search, { target: { value: 'ficticia 3' } })
    await waitFor(() => expect(optionLabels(brandSelect())).toEqual(['Elegí la marca', 'Marca Ficticia 3']))
    expect(screen.getByText('1 resultados')).toBeTruthy()
  })
})

describe('VS-07 (7D.2): fewer browser requests and rate limiting', () => {
  it('session cache: the same level is fetched once; failures are not cached', async () => {
    let calls = 0
    let fail = true
    const inner: CatalogLoader = async () => {
      calls++
      return fail ? { ok: false, reason: 'error' } : { ok: true, data: [], meta: { source: 'fixture', version: 'v', kind: 'fixture', isFixture: true } }
    }
    const cached = createSessionCachedLoader(inner)
    const signal = new AbortController().signal
    expect((await cached({ level: 'types' }, signal)).ok).toBe(false)
    fail = false
    expect((await cached({ level: 'types' }, signal)).ok).toBe(true)
    expect((await cached({ level: 'types' }, signal)).ok).toBe(true)
    await Promise.all([cached({ level: 'brands', typeId: 't:auto' }, signal), cached({ level: 'brands', typeId: 't:auto' }, signal)])
    expect(calls).toBe(3) // 1 failed + 1 types + 1 shared brands request
  })

  it('going back to a previous brand does not re-request its models', async () => {
    const base = loaderFor()
    const cached = createSessionCachedLoader(base)
    render(<Harness loader={cached} />)
    await chooseType('Auto')
    await pick(brandSelect, 'Ficticia Autos')
    await pick(brandSelect, 'Ejemplo Motors')
    await pick(brandSelect, 'Ficticia Autos')
    await waitFor(() => expect(optionLabels(modelSelect())).toContain('Sedán A'))
    expect(base.calls.filter((q) => q.level === 'models' && q.brandId === 'b:ficticia-autos')).toHaveLength(1)
  })

  it('429 from the server → its own message and manual entry (no retry loop)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"RATE_LIMITED"}', { status: 429 })))
    vi.stubGlobal('navigator', { onLine: true })
    expect(await fetchCatalogLevel({ level: 'types' }, new AbortController().signal)).toEqual({ ok: false, reason: 'rate_limited' })
    render(<Harness loader={async () => ({ ok: false, reason: 'rate_limited' })} />)
    const alert = await screen.findByTestId('vehicle-selector-error')
    expect(alert.textContent).toContain('muchas consultas al catálogo')
    expect(within(alert).queryByRole('button', { name: 'Reintentar' })).toBeNull()
    expect(within(alert).getByRole('button', { name: 'Escribir los datos a mano' })).toBeTruthy()
  })
})

describe('VS-08 (7D.2 real catalog UX): readable versions, 0 km year, source attribution', () => {
  const meta = { source: 'dnrpa', version: 'v', kind: 'registry' as const, isFixture: false, sourcePublishedAt: '2026-11-01', attribution: 'Fuente: DNRPA.' }
  const version = { id: 'v:x', modelId: 'm:x', label: 'PALIO FIRE 1.4 8V', body: 'SEDAN 5 PUERTAS', years: [2017], engine: { displacementL: 1.4, evidence: 'label' as const }, missing: ['fuel' as const], verification: 'source_listed' as const }

  it('version label without the repeated model, with body and "motor no informado" when missing', () => {
    expect(versionOptionLabel(version, 'Palio')).toBe('FIRE 1.4 8V · Sedan 5 puertas')
    expect(versionOptionLabel({ ...version, label: 'ROUSER 135', body: 'MOTOCICLETA', engine: null }, 'Rouser')).toBe('135 · Motocicleta · motor no informado')
  })

  it('0 km year only for models still on sale, labelled as such', () => {
    const current = { id: 'm:x', brandId: 'b:x', typeId: 't:suv', name: '2008', key: '2008', aliases: [], discontinued: false }
    expect(yearOptions([2025, 2024], current, meta)[0]).toEqual({ value: '2026', label: '2026 (0 km)' })
    expect(yearOptions([2018, 2017], { ...current, discontinued: true }, meta).map((o) => o.value)).toEqual(['2018', '2017'])
  })

  it('a real catalog shows its attribution and says it does not certify parts compatibility', async () => {
    const loader: CatalogLoader = async (q) => (q.level === 'types' ? { ok: true, data: [{ id: 't:auto', category: 'auto', label: 'Auto' }], meta } : { ok: true, data: [], meta })
    render(<Harness loader={loader} />)
    const note = await screen.findByTestId('vehicle-catalog-attribution')
    expect(note.textContent).toContain('Fuente: DNRPA.')
    expect(note.textContent).toContain('no certifica la compatibilidad de repuestos')
    expect(screen.queryByTestId('vehicle-catalog-fixture-note')).toBeNull()
  })
})

describe('VS-09 (publication review): editorial classification and pre-2002 guidance are visible', () => {
  const meta = { source: 'dnrpa', version: 'v', kind: 'registry' as const, isFixture: false, sourcePublishedAt: '2026-11-01', attribution: 'Fuente: DNRPA.' }
  const loader: CatalogLoader = async (q) => {
    if (q.level === 'types') return { ok: true, data: [{ id: 't:suv', category: 'suv', label: 'SUV' }], meta }
    if (q.level === 'brands') return { ok: true, data: [{ id: 'b:peugeot', name: 'Peugeot', key: 'peugeot', aliases: [], typeIds: ['t:suv'] }], meta }
    if (q.level === 'models') return { ok: true, data: [{ id: 'm:peugeot-2008', brandId: 'b:peugeot', typeId: 't:suv', name: '2008', key: '2008', aliases: [], discontinued: false, editorial: ['category'] }], meta }
    if (q.level === 'years') return { ok: true, data: [2025, 2024], meta }
    return { ok: true, data: [], meta }
  }

  it('a model whose type is an editorial decision says so', async () => {
    render(<Harness loader={loader} />)
    await chooseType('SUV')
    await pick(brandSelect, 'Peugeot')
    await pick(modelSelect, '2008')
    expect(screen.getByText(/es una revisión de Chuya Motor, no un dato de la fuente/)).toBeTruthy()
  })

  it('the manual alternative explains that the DNRPA catalog starts in 2002', async () => {
    render(<Harness loader={loader} />)
    await screen.findByRole('radio', { name: 'SUV' })
    expect((await screen.findByTestId('vehicle-selector-manual-hint')).textContent).toContain('desde 2002')
  })
})
