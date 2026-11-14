'use client'

/**
 * reference-form.tsx — Manual price reference for one part (7B). Validated by
 * validateReferenceInput: ARS integer price, http(s) link only, date not in the future.
 * Nothing is fetched: the person copies what they found.
 */
import { useId, useState } from 'react'
import { validateReferenceInput, type ReferenceField, type ReferenceInput } from '@/domain/budget/research/reference'
import { COMPATIBILITY_LABEL, PRESENTATION_LABEL, type PartReference, type Presentation } from '@/domain/budget/research/types'
import { formatArs } from '@/domain/budget/research/ars-amount'

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function toInput(ref: PartReference | null, presentation: Presentation): ReferenceInput {
  if (!ref) {
    return { url: '', store: '', price: '', consultedOn: todayIso(), description: '', compatibility: 'unverified', quantity: '1', presentation }
  }
  return {
    url: ref.url ?? '',
    store: ref.store,
    price: ref.priceMinor !== null ? formatArs(ref.priceMinor).replace('$ ', '') : '',
    consultedOn: ref.consultedOn,
    description: ref.description,
    compatibility: ref.compatibility,
    quantity: String(ref.quantity),
    presentation: ref.presentation,
  }
}

const inputCls =
  'w-full rounded-xl border border-brand-border bg-white px-3 py-2 text-sm text-brand-text placeholder-brand-text-light focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20'

export function ReferenceForm({
  partName,
  initial,
  onSave,
  onCancel,
}: {
  partName: string
  initial: ReferenceInput
  onSave: (ref: Omit<PartReference, 'id'>) => void
  onCancel: () => void
}) {
  const [values, setValues] = useState<ReferenceInput>(initial)
  const [errors, setErrors] = useState<Partial<Record<ReferenceField, string>>>({})
  const uid = useId()
  const id = (f: ReferenceField) => `${uid}-${f}`
  const err = (f: ReferenceField) => (errors[f] ? `${uid}-${f}-error` : undefined)

  function set<K extends ReferenceField>(k: K, v: string) {
    setValues((p) => ({ ...p, [k]: v }))
    setErrors((p) => ({ ...p, [k]: undefined }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = validateReferenceInput(values, todayIso())
    if (!r.ok) {
      setErrors(r.errors)
      return
    }
    onSave(r.reference)
  }

  const fieldError = (f: ReferenceField) =>
    errors[f] ? (
      <p id={`${uid}-${f}-error`} role="alert" className="mt-1 text-xs text-red-600">
        {errors[f]}
      </p>
    ) : null

  return (
    <form onSubmit={submit} noValidate aria-label={`Referencia de precio para ${partName}`} className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/50 p-4" data-testid="reference-form">
      <p className="text-xs text-brand-text-muted">
        Copiá los datos de la publicación que encontraste. Chuya Motor no abre ni verifica el enlace.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={id('store')} className="mb-1 block text-xs font-medium text-brand-text">Comercio o plataforma *</label>
          <input id={id('store')} className={inputCls} value={values.store} maxLength={80} onChange={(e) => set('store', e.target.value)} aria-invalid={!!errors.store} aria-describedby={err('store')} placeholder="Ej: casa de repuestos del barrio" />
          {fieldError('store')}
        </div>
        <div>
          <label htmlFor={id('price')} className="mb-1 block text-xs font-medium text-brand-text">Precio en pesos *</label>
          <input id={id('price')} className={inputCls} value={values.price} inputMode="decimal" maxLength={20} onChange={(e) => set('price', e.target.value)} aria-invalid={!!errors.price} aria-describedby={err('price')} placeholder="Ej: 15.000" />
          {fieldError('price')}
        </div>
        <div>
          <label htmlFor={id('quantity')} className="mb-1 block text-xs font-medium text-brand-text">Cantidad que incluye ese precio *</label>
          <input id={id('quantity')} className={inputCls} value={values.quantity} inputMode="numeric" maxLength={3} onChange={(e) => set('quantity', e.target.value)} aria-invalid={!!errors.quantity} aria-describedby={err('quantity')} />
          {fieldError('quantity')}
        </div>
        <div>
          <label htmlFor={id('presentation')} className="mb-1 block text-xs font-medium text-brand-text">Presentación *</label>
          <select id={id('presentation')} className={inputCls} value={values.presentation} onChange={(e) => set('presentation', e.target.value)} aria-invalid={!!errors.presentation} aria-describedby={err('presentation')}>
            {(Object.keys(PRESENTATION_LABEL) as Presentation[]).map((p) => (
              <option key={p} value={p}>{PRESENTATION_LABEL[p]}</option>
            ))}
          </select>
          {fieldError('presentation')}
        </div>
        <div>
          <label htmlFor={id('consultedOn')} className="mb-1 block text-xs font-medium text-brand-text">Fecha de consulta *</label>
          <input id={id('consultedOn')} type="date" className={inputCls} value={values.consultedOn} max={todayIso()} onChange={(e) => set('consultedOn', e.target.value)} aria-invalid={!!errors.consultedOn} aria-describedby={err('consultedOn')} />
          {fieldError('consultedOn')}
        </div>
        <div>
          <label htmlFor={id('url')} className="mb-1 block text-xs font-medium text-brand-text">Enlace (opcional)</label>
          <input id={id('url')} type="url" className={inputCls} value={values.url} maxLength={500} onChange={(e) => set('url', e.target.value)} aria-invalid={!!errors.url} aria-describedby={err('url')} placeholder="https://…" />
          {fieldError('url')}
        </div>
      </div>
      <div>
        <label htmlFor={id('description')} className="mb-1 block text-xs font-medium text-brand-text">Descripción o características (opcional)</label>
        <input id={id('description')} className={inputCls} value={values.description} maxLength={200} onChange={(e) => set('description', e.target.value)} placeholder="Ej: marca, código, medidas" />
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-brand-text">¿Es la misma pieza que la del presupuesto o la que buscás? *</legend>
        <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-4">
          {(['confirmed_equivalent', 'unverified', 'not_equivalent'] as const).map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm text-brand-text">
              <input type="radio" name={`${uid}-compat`} value={c} checked={values.compatibility === c} onChange={() => set('compatibility', c)} className="accent-brand-primary" />
              {c === 'confirmed_equivalent' ? 'Sí, confirmé que es la misma' : c === 'unverified' ? 'No lo sé todavía' : 'No, es distinta'}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-brand-text-muted">
          Solo calculamos diferencias cuando confirmás que es la misma pieza ({COMPATIBILITY_LABEL.confirmed_equivalent.toLowerCase()}).
        </p>
        {fieldError('compatibility')}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="rounded-xl bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2">
          Guardar referencia
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-text hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
          Cancelar
        </button>
      </div>
    </form>
  )
}
