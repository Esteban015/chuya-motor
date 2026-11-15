/**
 * vehicle-selection.ts — Pure state of the VehicleSelector (Incremento 7D.1).
 *
 * Tipo → Marca → Modelo → Año → Versión, plus a manual mode ("No encuentro mi vehículo") clearly
 * marked as not verified. Redesigned from the 6.5 POC reducer (stash, not applied): adds the type
 * level, the year step with "No sé el año" and "No conozco el motor".
 *
 * Invariants:
 *   - changing a parent clears every dependent value (and says so for screen readers);
 *   - a value is accepted only if it belongs to the current parent (brand listed for the type,
 *     model of that brand AND type, version of that model listing the year) — never kept stale;
 *   - manual mode keeps what was chosen as text and drops every catalog ID.
 * The server re-validates everything anyway (vehicle-validation.ts).
 */
import type { ApiVehicleInput } from '@/app/api/analyze/schema'
import type { VehicleInfo } from '@/domain/budget/research/types'
import { CATEGORY_LABEL, CATEGORY_TO_LEGACY, type CatalogBrand, type CatalogModel, type CatalogType, type CatalogVersion, type VehicleCategory } from './vehicle-catalog'

export interface ManualVehicleFields {
  make: string
  model: string
  year: string
  engine: string
}

export interface VehicleSelectionState {
  mode: 'catalog' | 'manual'
  type: CatalogType | null
  brand: CatalogBrand | null
  model: CatalogModel | null
  year: number | null
  yearUnknown: boolean
  version: CatalogVersion | null
  /** "No conozco el motor / la versión". */
  versionUnknown: boolean
  manual: ManualVehicleFields
  /** Catalog dataset version the options came from. */
  catalogVersion: string | null
  /** Last automatic change, announced in an aria-live region. */
  announcement: string
}

export const initialVehicleSelection: VehicleSelectionState = {
  mode: 'catalog',
  type: null,
  brand: null,
  model: null,
  year: null,
  yearUnknown: false,
  version: null,
  versionUnknown: false,
  manual: { make: '', model: '', year: '', engine: '' },
  catalogVersion: null,
  announcement: '',
}

export type VehicleSelectionAction =
  | { type: 'selectType'; value: CatalogType }
  | { type: 'selectBrand'; value: CatalogBrand }
  | { type: 'selectModel'; value: CatalogModel }
  | { type: 'selectYear'; value: number }
  | { type: 'yearUnknown' }
  | { type: 'selectVersion'; value: CatalogVersion }
  | { type: 'versionUnknown' }
  /** 7D.3: the clear (×) button of a searchable field; resets that field and every dependent. */
  | { type: 'clear'; field: 'brand' | 'model' | 'version' }
  | { type: 'switchToManual' }
  | { type: 'backToCatalog' }
  | { type: 'manualField'; field: keyof ManualVehicleFields; value: string }
  | { type: 'catalogVersion'; value: string }
  | { type: 'reset' }

const cleared = (labels: string[], reason: string) => (labels.length ? `Se borr${labels.length > 1 ? 'aron' : 'ó'} ${joinEs(labels)} porque cambiaste ${reason}.` : '')

function joinEs(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`
}

function dependents(s: VehicleSelectionState, from: 'brand' | 'model' | 'year' | 'version'): string[] {
  const order: Array<['brand' | 'model' | 'year' | 'version', boolean, string]> = [
    ['brand', s.brand !== null, 'la marca'],
    ['model', s.model !== null, 'el modelo'],
    ['year', s.year !== null || s.yearUnknown, 'el año'],
    ['version', s.version !== null || s.versionUnknown, 'la versión'],
  ]
  const start = order.findIndex(([k]) => k === from)
  return order.slice(start).filter(([, set]) => set).map(([, , label]) => label)
}

const yearFits = (v: CatalogVersion, year: number | null) => year === null || v.years === null || v.years.includes(year)

export function vehicleSelectionReducer(s: VehicleSelectionState, a: VehicleSelectionAction): VehicleSelectionState {
  switch (a.type) {
    case 'selectType': {
      if (s.type?.id === a.value.id) return s
      return { ...initialVehicleSelection, mode: s.mode, manual: s.manual, catalogVersion: s.catalogVersion, type: a.value, announcement: cleared(dependents(s, 'brand'), 'el tipo de vehículo') }
    }
    case 'selectBrand': {
      if (!s.type || !a.value.typeIds.includes(s.type.id) || s.brand?.id === a.value.id) return s
      return { ...s, brand: a.value, model: null, year: null, yearUnknown: false, version: null, versionUnknown: false, announcement: cleared(dependents(s, 'model'), 'la marca') }
    }
    case 'selectModel': {
      if (!s.type || !s.brand || a.value.brandId !== s.brand.id || a.value.typeId !== s.type.id || s.model?.id === a.value.id) return s
      return { ...s, model: a.value, year: null, yearUnknown: false, version: null, versionUnknown: false, announcement: cleared(dependents(s, 'year'), 'el modelo') }
    }
    case 'selectYear': {
      if (!s.model || !Number.isInteger(a.value) || a.value < 1900 || a.value > 2100 || (s.year === a.value && !s.yearUnknown)) return s
      const keep = s.version !== null && yearFits(s.version, a.value)
      return {
        ...s,
        year: a.value,
        yearUnknown: false,
        version: keep ? s.version : null,
        versionUnknown: keep ? false : s.versionUnknown,
        announcement: s.version && !keep ? 'Se borró la versión porque no figura para el año elegido.' : '',
      }
    }
    case 'yearUnknown':
      if (!s.model) return s
      return { ...s, year: null, yearUnknown: true, announcement: '' }
    case 'selectVersion':
      if (!s.model || a.value.modelId !== s.model.id || !yearFits(a.value, s.year)) return s
      return { ...s, version: a.value, versionUnknown: false, announcement: '' }
    case 'versionUnknown':
      if (!s.model) return s
      return { ...s, version: null, versionUnknown: true, announcement: '' }
    case 'clear': {
      if (s.mode !== 'catalog') return s
      const labels = dependents(s, a.field)
      const set = a.field === 'version' ? s.version !== null || s.versionUnknown : s[a.field] !== null
      if (!set) return s
      const announcement = `Se borr${labels.length > 1 ? 'aron' : 'ó'} ${joinEs(labels)}.`
      if (a.field === 'version') return { ...s, version: null, versionUnknown: false, announcement }
      const keep = a.field === 'model' ? { brand: s.brand } : { brand: null }
      return { ...s, ...keep, model: null, year: null, yearUnknown: false, version: null, versionUnknown: false, announcement }
    }
    case 'switchToManual':
      return {
        ...initialVehicleSelection,
        mode: 'manual',
        type: s.type,
        catalogVersion: s.catalogVersion,
        manual: {
          make: s.brand?.name ?? s.manual.make,
          model: s.model?.name ?? s.manual.model,
          year: s.year !== null ? String(s.year) : s.manual.year,
          engine: (s.version ? engineForSearch(s.version) : undefined) ?? s.manual.engine,
        },
        announcement: 'Pasaste a escribir los datos a mano. No se verifican con un catálogo.',
      }
    case 'backToCatalog':
      return { ...initialVehicleSelection, type: s.type, manual: s.manual, catalogVersion: s.catalogVersion }
    case 'manualField':
      if (s.mode !== 'manual') return s
      return { ...s, manual: { ...s.manual, [a.field]: a.value.slice(0, 40) }, announcement: '' }
    case 'catalogVersion':
      return s.catalogVersion === a.value ? s : { ...s, catalogVersion: a.value }
    case 'reset':
      return initialVehicleSelection
  }
}

/** Static type options for manual mode (works even when the catalog is down). */
export function staticTypeFor(category: VehicleCategory): CatalogType {
  return { id: `t:${category}`, category, label: CATEGORY_LABEL[category] }
}

function manualYear(text: string): number | undefined {
  const y = Number(text.trim())
  return text.trim() && Number.isInteger(y) && y >= 1900 && y <= 2100 ? y : undefined
}

/** Body for POST /api/analyze. Names are informative: the server recomputes them from the IDs. */
export function selectionToApiVehicle(s: VehicleSelectionState): ApiVehicleInput {
  const v: ApiVehicleInput = {}
  if (s.type) v.vehicleType = CATEGORY_TO_LEGACY[s.type.category]
  if (s.mode === 'manual') {
    if (s.manual.make.trim()) v.make = s.manual.make.trim()
    if (s.manual.model.trim()) v.model = s.manual.model.trim()
    const y = manualYear(s.manual.year)
    if (y !== undefined) v.year = y
    if (s.manual.engine.trim()) v.engine = s.manual.engine.trim()
    return v
  }
  if (s.brand) v.make = s.brand.name.slice(0, 50)
  if (s.model) v.model = s.model.name.slice(0, 50)
  if (s.year !== null) v.year = s.year
  if (s.type) {
    v.catalog = { typeId: s.type.id }
    if (s.brand) v.catalog.brandId = s.brand.id
    if (s.model) v.catalog.modelId = s.model.id
    if (s.version) v.catalog.versionId = s.version.id
    if (s.yearUnknown) v.catalog.yearUnknown = true
    if (s.versionUnknown) v.catalog.engineUnknown = true
    if (s.catalogVersion) v.catalog.catalogVersion = s.catalogVersion
  }
  return v
}

/** Vehicle for the 7B searches / 7C prices (contract unchanged): engine only if the version states one. */
export function selectionToVehicleInfo(s: VehicleSelectionState): VehicleInfo {
  if (s.mode === 'manual') {
    return {
      make: s.manual.make.trim() || undefined,
      model: s.manual.model.trim() || undefined,
      year: manualYear(s.manual.year)?.toString(),
      engine: s.manual.engine.trim() || undefined,
    }
  }
  return {
    make: s.brand?.name,
    model: s.model?.name,
    year: s.year !== null ? String(s.year) : undefined,
    engine: s.version ? engineForSearch(s.version) : undefined,
  }
}

/**
 * Engine text for the 7B searches / 7C matching: ONLY what the version documents — displacement
 * ("1.4") plus a fuel word the matcher understands ("diesel", "GNC"). Never the whole version label
 * (it repeats the model name) and never "nafta" by omission.
 */
export function engineForSearch(v: CatalogVersion): string | undefined {
  const e = v.engine
  if (!e) return undefined
  const parts: string[] = []
  if (e.displacementL !== undefined) parts.push(e.displacementL.toFixed(1))
  if (e.fuel === 'diesel') parts.push('diesel')
  else if (e.fuel === 'gnc') parts.push('GNC')
  else if (e.fuel === 'hibrido') parts.push('híbrido')
  else if (e.fuel === 'electrico') parts.push('eléctrico')
  return parts.length ? parts.join(' ') : undefined
}

/** Manual-year validation message (null = ok or empty). */
export function manualYearError(s: VehicleSelectionState): string | null {
  if (s.mode !== 'manual' || !s.manual.year.trim()) return null
  return manualYear(s.manual.year) === undefined ? 'El año debe estar entre 1900 y 2100.' : null
}
