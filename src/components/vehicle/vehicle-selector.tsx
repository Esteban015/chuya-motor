'use client'

/**
 * vehicle-selector.tsx — Reusable, accessible dependent vehicle fields (Incremento 7D.1).
 *
 * Tipo → Marca → Modelo → Año → Versión. Each level is loaded on demand from
 * GET /api/vehicle-catalog (the browser never downloads the whole catalog). State lives in the
 * parent (vehicleSelectionReducer) so the rest of the form is never lost.
 *
 * - Tipo is a radio group and Año a native <select>. 7D.3: Marca, Modelo and Versión are ONE
 *   searchable combobox each (SearchableSelect, ARIA combobox pattern): the same field is used to
 *   search and to choose, never a search box next to a select. 44 px targets, full width on 320/390.
 * - Loading / empty / error / timeout / offline states, always with a way out to manual entry.
 * - "No sé el año", "No conozco el motor" and "No encuentro mi vehículo" (manual, marked as not
 *   verified). Resets of dependent fields are announced in an aria-live region.
 * - A synthetic catalog is always labelled as such: test data never poses as the Argentine market.
 * Mounted only when the server-side flag is on (VEHICLE_CATALOG_ENABLED); off → legacy fields.
 */
import { useEffect, useId, useMemo, useState, type Dispatch } from 'react'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  CATEGORY_LABEL,
  VEHICLE_CATEGORIES,
  type CatalogBrand,
  type CatalogMeta,
  type CatalogModel,
  type CatalogType,
  type CatalogVersion,
} from '@/domain/vehicle/vehicle-catalog'
import { manualYearError, staticTypeFor, type VehicleSelectionAction, type VehicleSelectionState } from '@/domain/vehicle/vehicle-selection'

// ── Loading ─────────────────────────────────────────────────────────────────

export type CatalogQuery =
  | { level: 'types' }
  | { level: 'brands'; typeId: string }
  | { level: 'models'; typeId: string; brandId: string }
  | { level: 'years'; modelId: string }
  | { level: 'versions'; modelId: string; year: number | null }

export type CatalogFailure = 'error' | 'timeout' | 'offline' | 'rate_limited'
export type CatalogLoadResult = { ok: true; data: unknown; meta: CatalogMeta } | { ok: false; reason: CatalogFailure }
export type CatalogLoader = (query: CatalogQuery, signal: AbortSignal) => Promise<CatalogLoadResult>

export const CATALOG_CLIENT_TIMEOUT_MS = 5_000

/** Default loader: same-origin GET with a timeout. Never throws. */
export const fetchCatalogLevel: CatalogLoader = async (query, signal) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' }
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== null && v !== undefined) params.set(k, String(v))
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal.addEventListener('abort', onAbort)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, CATALOG_CLIENT_TIMEOUT_MS)
  try {
    const res = await fetch(`/api/vehicle-catalog?${params.toString()}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return { ok: false, reason: res.status === 504 ? 'timeout' : res.status === 429 ? 'rate_limited' : 'error' }
    const body = (await res.json()) as { data?: unknown; meta?: CatalogMeta }
    if (body.data === undefined || !body.meta) return { ok: false, reason: 'error' }
    return { ok: true, data: body.data, meta: body.meta }
  } catch {
    if (timedOut) return { ok: false, reason: 'timeout' }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, reason: 'offline' }
    return { ok: false, reason: 'error' }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 7D.2: session cache in front of a loader. Successful answers are reused for the same query (the
 * catalog changes at most per deploy), so going back and forth between levels does not repeat
 * requests. Failures are never cached. Bounded; per page session only (no browser storage).
 */
export function createSessionCachedLoader(inner: CatalogLoader, maxEntries = 200): CatalogLoader {
  const cache = new Map<string, Extract<CatalogLoadResult, { ok: true }>>()
  const inflight = new Map<string, Promise<CatalogLoadResult>>()
  return async (query, signal) => {
    const key = JSON.stringify(query)
    const hit = cache.get(key)
    if (hit) return hit
    let pending = inflight.get(key)
    if (!pending) {
      // The shared request is not tied to one component's abort signal.
      pending = inner(query, new AbortController().signal).finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    const result = await pending
    if (signal.aborted) return { ok: false, reason: 'error' }
    if (result.ok) {
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value as string)
      cache.set(key, result)
    }
    return result
  }
}

const defaultLoader = createSessionCachedLoader(fetchCatalogLevel)

type ListState<T> = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; data: T; meta: CatalogMeta } | { status: CatalogFailure }

function useCatalogList<T>(query: CatalogQuery | null, loader: CatalogLoader, retry: number): ListState<T> {
  const key = query ? JSON.stringify(query) : null
  const [state, setState] = useState<ListState<T>>({ status: 'idle' })
  useEffect(() => {
    if (!key) {
      setState({ status: 'idle' })
      return
    }
    const ctrl = new AbortController()
    setState({ status: 'loading' })
    loader(JSON.parse(key) as CatalogQuery, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return
      setState(r.ok ? { status: 'ready', data: r.data as T, meta: r.meta } : { status: r.reason })
    })
    return () => ctrl.abort()
  }, [key, loader, retry])
  return state
}

// ── Styles ──────────────────────────────────────────────────────────────────

const fieldCls =
  'w-full min-h-[44px] rounded-xl border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:cursor-not-allowed disabled:bg-brand-surface disabled:opacity-60'
const labelCls = 'mb-1.5 block text-xs font-medium text-brand-text-muted'
const linkBtnCls =
  'inline-flex min-h-[44px] items-center rounded-lg px-1 text-sm font-semibold text-brand-primary underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary'

const UNKNOWN = '__unknown__'

const sentenceCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()

/**
 * Version option text: the source label without the repeated model name, the registry body, and
 * an explicit "motor no informado" when the source does not document it (7D.2 real catalog).
 * e.g. "PALIO FIRE 1.4 8V" + "SEDAN 5 PUERTAS" under "Palio" → "FIRE 1.4 8V · Sedan 5 puertas".
 */
export function versionOptionLabel(v: CatalogVersion, modelName?: string): string {
  let label = v.label
  const prefix = modelName?.toUpperCase()
  if (prefix && label.toUpperCase().startsWith(`${prefix} `)) label = label.slice(prefix.length + 1)
  const parts = [label]
  if (v.body) parts.push(sentenceCase(v.body))
  if (!v.engine) parts.push('motor no informado')
  return parts.join(' · ')
}

/**
 * Listed years, plus — for a model still on sale — the year of the catalog edition (0 km) when the
 * source does not list it yet. The server treats that year as unverified, never as validated.
 */
export function yearOptions(years: number[], model: CatalogModel | null, meta: CatalogMeta): Option[] {
  const options = years.map((y) => ({ value: String(y), label: String(y) }))
  const edition = meta.sourcePublishedAt ? Number(meta.sourcePublishedAt.slice(0, 4)) : null
  if (model && !model.discontinued && edition && years.length && edition > Math.max(...years)) {
    options.unshift({ value: String(edition), label: `${edition} (0 km)` })
  }
  return options
}

const FAILURE_TEXT: Record<CatalogFailure, string> = {
  rate_limited: 'Hiciste muchas consultas al catálogo en poco tiempo. Esperá un minuto o escribí los datos a mano.',
  error: 'No pudimos cargar el catálogo. Podés reintentar o escribir los datos a mano.',
  timeout: 'El catálogo tardó demasiado en responder. Podés reintentar o escribir los datos a mano.',
  offline: 'Sin conexión. Podés escribir los datos a mano y seguir con el formulario.',
}

// ── Pieces ──────────────────────────────────────────────────────────────────

interface Option {
  value: string
  label: string
}

function ListStatus({ state, emptyText, what, onRetry, onManual, showLoading = true }: { state: ListState<unknown[]>; emptyText: string; what: string; onRetry: () => void; onManual: () => void; showLoading?: boolean }) {
  if (state.status === 'loading' && showLoading) return <p role="status" className="mt-1.5 text-xs text-brand-text-muted">Cargando {what}…</p>
  if (state.status === 'ready' && Array.isArray(state.data) && state.data.length === 0) {
    return (
      <p role="status" className="mt-1.5 text-xs text-brand-text-muted" data-testid="vehicle-selector-empty">
        {emptyText}{' '}
        <button type="button" onClick={onManual} className={linkBtnCls}>Escribir los datos a mano</button>
      </p>
    )
  }
  if (state.status === 'error' || state.status === 'timeout' || state.status === 'offline' || state.status === 'rate_limited') {
    return (
      <div role="alert" className="mt-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="vehicle-selector-error">
        <p>{FAILURE_TEXT[state.status]}</p>
        <div className="mt-1 flex flex-wrap gap-x-4">
          {state.status !== 'offline' && state.status !== 'rate_limited' && <button type="button" onClick={onRetry} className={linkBtnCls}>Reintentar</button>}
          <button type="button" onClick={onManual} className={linkBtnCls}>Escribir los datos a mano</button>
        </div>
      </div>
    )
  }
  return null
}

/** Native select for short lists (Año): no search needed. */
function PlainSelect(props: {
  id: string
  label: string
  options: Option[]
  value: string
  onChange: (value: string) => void
  disabled: boolean
  placeholder: string
  hint?: string
  extraOptions?: Option[]
}) {
  const { id, label, options, value, onChange, disabled, placeholder, hint, extraOptions = [] } = props
  const hintId = `${id}-hint`
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={labelCls}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-describedby={hint ? hintId : undefined} className={fieldCls}>
        <option value="">{placeholder}</option>
        {[...options, ...extraOptions].map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && <p id={hintId} className="mt-1 text-xs text-brand-text-light">{hint}</p>}
    </div>
  )
}

const modelLabel = (m: CatalogModel) => (m.discontinued ? `${m.name} (ya no se fabrica)` : m.name)
const NO_OPTIONS: Option[] = []
const VERSION_UNKNOWN_OPTIONS: Option[] = [{ value: UNKNOWN, label: 'No conozco el motor ni la versión' }]

// ── Component ───────────────────────────────────────────────────────────────

export interface VehicleSelectorProps {
  state: VehicleSelectionState
  dispatch: Dispatch<VehicleSelectionAction>
  loader?: CatalogLoader
  /** Show the version / engine step (budget searches need it; diagnosis keeps it optional). */
  askVersion?: boolean
  typeRequired?: boolean
  typeError?: string
  disabled?: boolean
}

export function VehicleSelector({ state: s, dispatch, loader = defaultLoader, askVersion = true, typeRequired = false, typeError, disabled = false }: VehicleSelectorProps) {
  const uid = useId()
  const [retry, setRetry] = useState(0)
  const catalogMode = s.mode === 'catalog'

  const types = useCatalogList<CatalogType[]>(catalogMode ? { level: 'types' } : null, loader, retry)
  const brands = useCatalogList<CatalogBrand[]>(catalogMode && s.type ? { level: 'brands', typeId: s.type.id } : null, loader, retry)
  const models = useCatalogList<CatalogModel[]>(catalogMode && s.type && s.brand ? { level: 'models', typeId: s.type.id, brandId: s.brand.id } : null, loader, retry)
  const years = useCatalogList<number[] | null>(catalogMode && s.model ? { level: 'years', modelId: s.model.id } : null, loader, retry)
  const versions = useCatalogList<CatalogVersion[]>(
    catalogMode && askVersion && s.model && (s.year !== null || s.yearUnknown) ? { level: 'versions', modelId: s.model.id, year: s.year } : null,
    loader,
    retry,
  )

  const lists: ListState<unknown>[] = [types, brands, models, years, versions]
  const ready = lists.find((l) => l.status === 'ready')
  const meta = ready && ready.status === 'ready' ? ready.meta : null
  useEffect(() => {
    if (meta) dispatch({ type: 'catalogVersion', value: meta.version })
  }, [meta, dispatch])

  const toManual = () => dispatch({ type: 'switchToManual' })
  const doRetry = () => setRetry((n) => n + 1)
  const typeOptions: CatalogType[] = catalogMode ? (types.status === 'ready' ? types.data : []) : VEHICLE_CATEGORIES.map(staticTypeFor)
  const typeErrorId = `${uid}-type-error`
  const yearError = manualYearError(s)
  // Stable option arrays (the combobox caches normalized search text per option object).
  const brandOptions = useMemo(() => (brands.status === 'ready' ? brands.data.map((b) => ({ value: b.id, label: b.name, keywords: b.aliases })) : NO_OPTIONS), [brands])
  const modelOptions = useMemo(() => (models.status === 'ready' ? models.data.map((m) => ({ value: m.id, label: modelLabel(m), keywords: m.aliases })) : NO_OPTIONS), [models])
  const modelName = s.model?.name
  const versionOptions = useMemo(() => (versions.status === 'ready' ? versions.data.map((v) => ({ value: v.id, label: versionOptionLabel(v, modelName) })) : NO_OPTIONS), [versions, modelName])

  return (
    <div className="space-y-4" data-testid="vehicle-selector" data-mode={s.mode}>
      <p aria-live="polite" className="sr-only" data-testid="vehicle-selector-live">{s.announcement}</p>

      {meta?.isFixture && catalogMode && (
        <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900" data-testid="vehicle-catalog-fixture-note">
          <strong>Catálogo de prueba.</strong> Las marcas y modelos son ficticios: no representan vehículos reales ni el mercado argentino.
        </p>
      )}
      {meta && !meta.isFixture && catalogMode && (
        <p className="text-xs text-brand-text-light" data-testid="vehicle-catalog-attribution">
          {meta.attribution ?? `Fuente: ${meta.source}.`} Sirve para identificar el vehículo; no certifica la compatibilidad de repuestos.
        </p>
      )}

      <fieldset aria-describedby={typeError ? typeErrorId : undefined} disabled={disabled}>
        <legend className="mb-1.5 block text-sm font-medium text-brand-text">
          Tipo de vehículo {typeRequired && <span className="text-red-500" aria-hidden="true">*</span>}
        </legend>
        {catalogMode && <ListStatus state={types} what="los tipos" emptyText="No hay tipos de vehículo cargados." onRetry={doRetry} onManual={toManual} />}
        {typeOptions.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="vehicle-type-options">
            {typeOptions.map((t) => (
              <label
                key={t.id}
                className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-brand-border bg-white px-3 py-2 text-sm text-brand-text has-[:checked]:border-brand-primary has-[:checked]:bg-brand-primary/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-primary"
              >
                <input
                  type="radio"
                  name={`${uid}-type`}
                  value={t.id}
                  checked={s.type?.category === t.category}
                  onChange={() => dispatch({ type: 'selectType', value: t })}
                  required={typeRequired}
                  className="h-4 w-4 accent-brand-primary"
                />
                <span>{t.label || CATEGORY_LABEL[t.category]}</span>
              </label>
            ))}
          </div>
        )}
        {typeError && <p id={typeErrorId} role="alert" className="mt-1.5 text-xs text-red-600">{typeError}</p>}
      </fieldset>

      {catalogMode ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <SearchableSelect
                id={`${uid}-brand`}
                label="Marca"
                placeholder={s.type ? 'Buscá o elegí la marca' : 'Elegí primero el tipo'}
                options={brandOptions}
                value={s.brand?.id ?? ''}
                valueLabel={s.brand?.name}
                loading={brands.status === 'loading'}
                loadingText="Cargando marcas…"
                emptyMessage="Ninguna marca coincide con lo que escribiste."
                clearable
                disabled={disabled || brands.status !== 'ready' || brands.data.length === 0}
                onChange={(id) => {
                  if (!id) return dispatch({ type: 'clear', field: 'brand' })
                  const b = brands.status === 'ready' ? brands.data.find((x) => x.id === id) : undefined
                  if (b) dispatch({ type: 'selectBrand', value: b })
                }}
              />
              <ListStatus state={brands} showLoading={false} what="las marcas" emptyText="No hay marcas cargadas para este tipo." onRetry={doRetry} onManual={toManual} />
            </div>
            <div className="min-w-0">
              <SearchableSelect
                id={`${uid}-model`}
                label="Modelo"
                placeholder={s.brand ? 'Buscá o elegí el modelo' : 'Elegí primero la marca'}
                options={modelOptions}
                value={s.model?.id ?? ''}
                valueLabel={s.model ? modelLabel(s.model) : undefined}
                loading={models.status === 'loading'}
                loadingText="Cargando modelos…"
                emptyMessage="Ningún modelo coincide con lo que escribiste."
                clearable
                disabled={disabled || models.status !== 'ready' || models.data.length === 0}
                hint={s.model?.editorial?.includes('category') ? 'La clasificación de tipo de este modelo (o de algunas de sus versiones) es una revisión de Chuya Motor, no un dato de la fuente.' : undefined}
                onChange={(id) => {
                  if (!id) return dispatch({ type: 'clear', field: 'model' })
                  const m = models.status === 'ready' ? models.data.find((x) => x.id === id) : undefined
                  if (m) dispatch({ type: 'selectModel', value: m })
                }}
              />
              <ListStatus state={models} showLoading={false} what="los modelos" emptyText="No hay modelos cargados para esta marca." onRetry={doRetry} onManual={toManual} />
            </div>
            <div className="min-w-0">
              {years.status === 'ready' && years.data === null ? (
                <div>
                  <label htmlFor={`${uid}-year-free`} className={labelCls}>Año (el catálogo no tiene años para este modelo)</label>
                  <select
                    id={`${uid}-year-free`}
                    value={s.yearUnknown ? UNKNOWN : s.year !== null ? String(s.year) : ''}
                    onChange={(e) => (e.target.value === UNKNOWN ? dispatch({ type: 'yearUnknown' }) : e.target.value && dispatch({ type: 'selectYear', value: Number(e.target.value) }))}
                    disabled={disabled}
                    className={fieldCls}
                  >
                    <option value="">Elegí el año</option>
                    {Array.from({ length: 2100 - 1950 + 1 }, (_, i) => new Date().getFullYear() + 1 - i)
                      .filter((y) => y >= 1950)
                      .map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    <option value={UNKNOWN}>No sé el año</option>
                  </select>
                  <p className="mt-1 text-xs text-brand-text-light">El año que elijas se toma como dato tuyo, sin verificar.</p>
                </div>
              ) : (
                <PlainSelect
                  id={`${uid}-year`}
                  label="Año"
                  placeholder={s.model ? 'Elegí el año' : 'Elegí primero el modelo'}
                  options={years.status === 'ready' && years.data ? yearOptions(years.data, s.model, years.meta) : []}
                  extraOptions={years.status === 'ready' ? [{ value: UNKNOWN, label: 'No sé el año' }] : []}
                  value={s.yearUnknown ? UNKNOWN : s.year !== null ? String(s.year) : ''}
                  disabled={disabled || years.status !== 'ready'}
                  hint={years.status === 'ready' && years.data && s.year !== null && !years.data.includes(s.year) ? 'Año 0 km posterior a la edición del catálogo: se toma como dato tuyo, sin verificar.' : undefined}
                  onChange={(v) => (v === UNKNOWN ? dispatch({ type: 'yearUnknown' }) : v && dispatch({ type: 'selectYear', value: Number(v) }))}
                />
              )}
              <ListStatus state={years as ListState<unknown[]>} what="los años" emptyText="No hay años cargados para este modelo." onRetry={doRetry} onManual={toManual} />
            </div>
            {askVersion && (
              <div className="min-w-0">
                <SearchableSelect
                  id={`${uid}-version`}
                  label="Versión / motor"
                  placeholder={s.model && (s.year !== null || s.yearUnknown) ? 'Buscá o elegí la versión' : 'Elegí primero el año'}
                  options={versionOptions}
                  pinnedOptions={versions.status === 'ready' ? VERSION_UNKNOWN_OPTIONS : NO_OPTIONS}
                  value={s.versionUnknown ? UNKNOWN : (s.version?.id ?? '')}
                  valueLabel={s.version ? versionOptionLabel(s.version, s.model?.name) : undefined}
                  loading={versions.status === 'loading'}
                  loadingText="Cargando versiones…"
                  emptyMessage="Ninguna versión coincide con lo que escribiste."
                  clearable
                  disabled={disabled || versions.status !== 'ready'}
                  hint={s.version && !s.version.engine ? 'El catálogo no indica el motor de esta versión.' : undefined}
                  onChange={(id) => {
                    if (!id) return dispatch({ type: 'clear', field: 'version' })
                    if (id === UNKNOWN) return dispatch({ type: 'versionUnknown' })
                    const v = versions.status === 'ready' ? versions.data.find((x) => x.id === id) : undefined
                    if (v) dispatch({ type: 'selectVersion', value: v })
                  }}
                />
                <ListStatus state={versions} showLoading={false} what="las versiones" emptyText="No hay versiones cargadas para este año." onRetry={doRetry} onManual={toManual} />
              </div>
            )}
          </div>
          <div>
            <button type="button" onClick={toManual} disabled={disabled} className={linkBtnCls} data-testid="vehicle-selector-manual" aria-describedby={`${uid}-manual-hint`}>
              No encuentro mi vehículo
            </button>
            <p id={`${uid}-manual-hint`} className="text-xs text-brand-text-light" data-testid="vehicle-selector-manual-hint">
              {meta?.source === 'dnrpa'
                ? 'El catálogo incluye vehículos desde 2002. Si el tuyo es anterior o no aparece, escribí los datos a mano.'
                : 'Si tu vehículo no aparece, escribí los datos a mano.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="vehicle-selector-manual-fields">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="vehicle-selector-unverified">
            <strong>Datos escritos a mano.</strong> No se verifican con un catálogo.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ['make', 'Marca', 'Ej: Fiat', 'text'],
                ['model', 'Modelo', 'Ej: Palio', 'text'],
                ['year', 'Año', 'Ej: 2017', 'number'],
                ['engine', 'Motor (si lo sabés)', 'Ej: 1.4 8v', 'text'],
              ] as const
            ).map(([field, label, placeholder, type]) => (
              <div key={field} className="min-w-0">
                <label htmlFor={`${uid}-manual-${field}`} className={labelCls}>{label}</label>
                <input
                  id={`${uid}-manual-${field}`}
                  type={type}
                  inputMode={type === 'number' ? 'numeric' : undefined}
                  min={type === 'number' ? 1900 : undefined}
                  max={type === 'number' ? 2100 : undefined}
                  maxLength={40}
                  placeholder={placeholder}
                  value={s.manual[field]}
                  onChange={(e) => dispatch({ type: 'manualField', field, value: e.target.value })}
                  disabled={disabled}
                  aria-invalid={field === 'year' && !!yearError}
                  aria-describedby={field === 'year' && yearError ? `${uid}-manual-year-error` : undefined}
                  className={fieldCls}
                />
                {field === 'year' && yearError && (
                  <p id={`${uid}-manual-year-error`} role="alert" className="mt-1.5 text-xs text-red-600">{yearError}</p>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => dispatch({ type: 'backToCatalog' })} disabled={disabled} className={linkBtnCls}>
            Volver a elegir de la lista
          </button>
        </div>
      )}
    </div>
  )
}
