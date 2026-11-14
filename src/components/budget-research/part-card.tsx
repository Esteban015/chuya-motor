'use client'

/**
 * part-card.tsx — One part: declared data, Google search, purchase checklist, manual references
 * and the deterministic comparison with each confirmed-equivalent reference (7B).
 * Never shows a "fair price", an average or a minimum, and never concludes overpricing.
 */
import { useId, useState } from 'react'
import { formatArs, formatPercentTenths, parseArsAmount } from '@/domain/budget/research/ars-amount'
import { sanitizeExternalUrl } from '@/domain/budget/research/external-url'
import { buildPartSearch } from '@/domain/budget/research/part-search'
import { purchaseChecklist } from '@/domain/budget/research/guidance'
import { PART_SCREEN_TEXT, screenPartDescription } from '@/domain/budget/research/local-safety'
import { COMPARISON_DISCLAIMER, NOT_COMPARABLE_TEXT, compareWithReference } from '@/domain/budget/research/price-comparator'
import {
  CATEGORY_LABEL,
  COMPATIBILITY_LABEL,
  MAX_QUANTITY,
  MAX_REFERENCES_PER_LINE,
  PRESENTATION_LABEL,
  type LineCategory,
  type PartReference,
  type Presentation,
  type ResearchLine,
  type VehicleInfo,
} from '@/domain/budget/research/types'
import { ProvenanceBadge } from './badges'
import { ReferenceForm, toInput } from './reference-form'

let refSeq = 0
const newRefId = () => `ref-${Date.now().toString(36)}-${++refSeq}`

const btnSecondary =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-text transition hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary'
const inputCls =
  'w-full rounded-xl border border-brand-border bg-white px-3 py-2 text-sm text-brand-text focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20'

function ComparisonBlock({ line, reference }: { line: ResearchLine; reference: PartReference }) {
  const c = compareWithReference(line, reference)
  if (c.kind === 'not_comparable') {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-brand-text-muted" data-comparison="not_comparable" data-reason={c.reason}>
        <ProvenanceBadge kind={c.reason === 'unverified' ? 'unverified' : 'missing'} label={c.reason === 'unverified' ? 'Coincidencia no verificada' : undefined} />
        {NOT_COMPARABLE_TEXT[c.reason]}
      </p>
    )
  }
  const higher = c.differenceMinor > 0
  const equal = c.differenceMinor === 0
  return (
    <div className="mt-2 rounded-xl border border-brand-border-light bg-brand-bg p-3" data-comparison="compared">
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge kind="calculation" />
        <span className="text-sm font-semibold text-brand-text">
          {equal
            ? 'Mismo importe que esta referencia'
            : `Diferencia con esta referencia: ${formatArs(Math.abs(c.differenceMinor))} (${formatPercentTenths(c.differencePercentTenths)})`}
        </span>
      </div>
      {!equal && (
        <p className="mt-1 text-xs text-brand-text-muted">
          El presupuesto está {formatArs(Math.abs(c.differenceMinor))} {higher ? 'por encima' : 'por debajo'} de esta referencia para {line.quantity} × {PRESENTATION_LABEL[line.presentation].toLowerCase()}.
        </p>
      )}
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-brand-text-muted">Presupuesto (total)</dt>
        <dd className="text-right tabular-nums text-brand-text">{formatArs(c.workshopTotalMinor)}</dd>
        <dt className="text-brand-text-muted">Referencia (para la misma cantidad)</dt>
        <dd className="text-right tabular-nums text-brand-text">{formatArs(c.referenceTotalMinor)}</dd>
        <dt className="text-brand-text-muted">Precio unitario presupuesto</dt>
        <dd className="text-right tabular-nums text-brand-text">{formatArs(c.workshopUnitMinor)}</dd>
        <dt className="text-brand-text-muted">Precio unitario referencia</dt>
        <dd className="text-right tabular-nums text-brand-text">{formatArs(c.referenceUnitMinor)}</dd>
      </dl>
      <p className="mt-2 text-2xs leading-relaxed text-brand-text-muted">{COMPARISON_DISCLAIMER}</p>
    </div>
  )
}

function ReferenceItem({ line, reference, compare, onEdit, onRemove }: { line: ResearchLine; reference: PartReference; compare: boolean; onEdit: () => void; onRemove: () => void }) {
  const safeUrl = sanitizeExternalUrl(reference.url)
  return (
    <li className="rounded-xl border border-brand-border-light bg-white p-3" data-testid="reference-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-brand-text">{reference.store}</p>
          <p className="mt-0.5 text-xs text-brand-text-muted">
            {reference.priceMinor !== null ? formatArs(reference.priceMinor) : 'Sin precio'} · {reference.quantity} × {PRESENTATION_LABEL[reference.presentation].toLowerCase()} · consultado el {reference.consultedOn.split('-').reverse().join('/')}
          </p>
          {reference.description && <p className="mt-0.5 break-words text-xs text-brand-text-muted">{reference.description}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ProvenanceBadge kind="user_reference" />
          <ProvenanceBadge kind={reference.compatibility === 'confirmed_equivalent' ? 'declared' : 'unverified'} label={COMPATIBILITY_LABEL[reference.compatibility]} />
        </div>
      </div>
      <p className="mt-1 text-2xs text-brand-text-light">Informada por el usuario, sin verificación independiente.</p>
      {compare && <ComparisonBlock line={line} reference={reference} />}
      <div className="mt-2 flex flex-wrap gap-2">
        {safeUrl && (
          <a href={safeUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-xs font-semibold text-brand-primary underline hover:no-underline">
            Ver publicación<span className="sr-only"> de {reference.store} (sitio externo, se abre en una pestaña nueva)</span> ↗
          </a>
        )}
        <button type="button" onClick={onEdit} className="text-xs font-medium text-brand-text underline hover:no-underline">
          Editar<span className="sr-only"> referencia de {reference.store}</span>
        </button>
        <button type="button" onClick={onRemove} className="text-xs font-medium text-red-700 underline hover:no-underline">
          Eliminar<span className="sr-only"> referencia de {reference.store}</span>
        </button>
      </div>
    </li>
  )
}

export function PartCard({
  line,
  vehicle,
  showWorkshopPrice,
  onChange,
  onRemove,
}: {
  line: ResearchLine
  vehicle: VehicleInfo
  showWorkshopPrice: boolean
  onChange: (line: ResearchLine) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [refForm, setRefForm] = useState<{ editId: string | null } | null>(null)
  const [priceText, setPriceText] = useState(line.workshopPriceMinor !== null ? formatArs(line.workshopPriceMinor).replace('$ ', '') : '')
  const [priceError, setPriceError] = useState<string | null>(null)
  const uid = useId()
  const headingId = `${uid}-title`
  // Enforced at render time: descriptions edited, added or injected after the initial check never
  // produce a search link unless they read as a part identification (local-safety.ts).
  const screen = screenPartDescription(line.description)
  const search = screen.ok ? buildPartSearch({ description: line.description, partBrand: line.partBrand, partCode: line.partCode, vehicle }) : null
  const editingRef = refForm?.editId ? line.references.find((r) => r.id === refForm.editId) ?? null : null

  function saveReference(data: Omit<PartReference, 'id'>) {
    const references = refForm?.editId
      ? line.references.map((r) => (r.id === refForm.editId ? { ...data, id: r.id } : r))
      : [...line.references, { ...data, id: newRefId() }]
    onChange({ ...line, references })
    setRefForm(null)
  }

  function commitPrice(text: string) {
    setPriceText(text)
    if (!text.trim()) {
      setPriceError(null)
      onChange({ ...line, workshopPriceMinor: null })
      return
    }
    const v = parseArsAmount(text)
    if (v === null) setPriceError('Importe no válido. Ejemplo: 18.000 o 18.000,50')
    else {
      setPriceError(null)
      onChange({ ...line, workshopPriceMinor: v, pricePending: false })
    }
  }

  return (
    <li className="min-w-0">
      <article aria-labelledby={headingId} className="rounded-2xl border border-brand-border-light bg-white p-4 shadow-brand-xs sm:p-5" data-testid="part-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id={headingId} className="break-words font-display text-base font-bold text-brand-text">{line.description}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-brand-text-muted">
              <ProvenanceBadge kind="declared" />
              <span>{line.quantity} × {PRESENTATION_LABEL[line.presentation].toLowerCase()}</span>
              {line.partBrand && <span>· Marca: {line.partBrand}</span>}
              {line.partCode && <span>· Código: {line.partCode}</span>}
              {!line.partBrand && <ProvenanceBadge kind="missing" label="Marca de la pieza sin indicar" />}
            </p>
          </div>
          {showWorkshopPrice && (
            <div className="text-right" data-testid="workshop-price">
              <p className="text-2xs uppercase tracking-wider text-brand-text-muted">Presupuesto del taller</p>
              <p className="font-display text-lg font-extrabold tabular-nums text-brand-text">
                {line.workshopPriceMinor !== null ? formatArs(line.workshopPriceMinor) : line.pricePending ? 'A confirmar' : 'Sin precio'}
              </p>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {search && (
          <a
            href={search.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
            data-testid="search-link"
          >
            Buscar en Google<span className="sr-only">: {search.query} (sitio externo, se abre en una pestaña nueva)</span>
            <span aria-hidden="true">↗</span>
          </a>
          )}
          {line.references.length < MAX_REFERENCES_PER_LINE && !refForm && (
            <button type="button" className={btnSecondary} onClick={() => setRefForm({ editId: null })}>
              + Agregar referencia<span className="sr-only"> de precio para {line.description}</span>
            </button>
          )}
          <button type="button" className={btnSecondary} aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
            {editing ? 'Listo' : 'Editar'}<span className="sr-only"> {line.description}</span>
          </button>
          <button type="button" className={`${btnSecondary} text-red-700`} onClick={onRemove}>
            Eliminar<span className="sr-only"> {line.description}</span>
          </button>
        </div>
        {search ? (
          <p className="mt-1.5 text-2xs text-brand-text-light">
            Búsqueda: «{search.query}». Los resultados son externos; Chuya Motor no los consulta ni los verifica.
          </p>
        ) : (
          !screen.ok && (
            <p role="note" data-testid="search-unavailable" data-reason={screen.reason} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {PART_SCREEN_TEXT[screen.reason]}
            </p>
          )
        )}

        {editing && (
          <div className="mt-3 grid gap-3 rounded-xl bg-brand-bg p-3 sm:grid-cols-2" data-testid="line-editor">
            <div className="sm:col-span-2">
              <label htmlFor={`${uid}-desc`} className="mb-1 block text-xs font-medium text-brand-text">Descripción</label>
              <input id={`${uid}-desc`} className={inputCls} maxLength={200} value={line.description} onChange={(e) => onChange({ ...line, description: e.target.value.slice(0, 200) || line.description })} />
            </div>
            <div>
              <label htmlFor={`${uid}-cat`} className="mb-1 block text-xs font-medium text-brand-text">Tipo de concepto</label>
              <select id={`${uid}-cat`} className={inputCls} value={line.category} onChange={(e) => onChange({ ...line, category: e.target.value as LineCategory })}>
                {(Object.keys(CATEGORY_LABEL) as LineCategory[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={`${uid}-qty`} className="mb-1 block text-xs font-medium text-brand-text">Cantidad</label>
                <input id={`${uid}-qty`} className={inputCls} inputMode="numeric" value={line.quantity} onChange={(e) => {
                  const q = Number(e.target.value.replace(/\D/g, '').slice(0, 3))
                  onChange({ ...line, quantity: q >= 1 ? Math.min(q, MAX_QUANTITY) : 1 })
                }} />
              </div>
              <div>
                <label htmlFor={`${uid}-pres`} className="mb-1 block text-xs font-medium text-brand-text">Presentación</label>
                <select id={`${uid}-pres`} className={inputCls} value={line.presentation} onChange={(e) => onChange({ ...line, presentation: e.target.value as Presentation })}>
                  {(Object.keys(PRESENTATION_LABEL) as Presentation[]).map((p) => (
                    <option key={p} value={p}>{PRESENTATION_LABEL[p]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor={`${uid}-brand`} className="mb-1 block text-xs font-medium text-brand-text">Marca del repuesto (opcional)</label>
              <input id={`${uid}-brand`} className={inputCls} maxLength={40} value={line.partBrand} onChange={(e) => onChange({ ...line, partBrand: e.target.value.slice(0, 40) })} />
            </div>
            <div>
              <label htmlFor={`${uid}-code`} className="mb-1 block text-xs font-medium text-brand-text">Código de pieza (opcional)</label>
              <input id={`${uid}-code`} className={inputCls} maxLength={40} value={line.partCode} onChange={(e) => onChange({ ...line, partCode: e.target.value.slice(0, 40) })} />
            </div>
            {showWorkshopPrice && (
              <div className="sm:col-span-2">
                <label htmlFor={`${uid}-price`} className="mb-1 block text-xs font-medium text-brand-text">Precio del presupuesto para esta cantidad (opcional)</label>
                <input id={`${uid}-price`} className={inputCls} inputMode="decimal" maxLength={20} value={priceText} onChange={(e) => commitPrice(e.target.value)} aria-invalid={!!priceError} aria-describedby={priceError ? `${uid}-price-error` : undefined} />
                {priceError && <p id={`${uid}-price-error`} role="alert" className="mt-1 text-xs text-red-600">{priceError}</p>}
              </div>
            )}
          </div>
        )}

        <details className="mt-3 rounded-xl border border-brand-border-light px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-brand-text">Qué verificar antes de comprar</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-brand-text-muted">
            {purchaseChecklist(line.description).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>

        <section aria-label={`Referencias de precio para ${line.description}`} className="mt-3">
          {line.references.length === 0 && !refForm && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-brand-text-muted">
              <ProvenanceBadge kind="missing" label="Sin referencias" />
              Si encontrás una oferta, agregala para tenerla a mano{showWorkshopPrice ? ' y compararla' : ''}.
            </p>
          )}
          {line.references.length > 0 && (
            <ul className="space-y-2">
              {line.references.map((r) => (
                <ReferenceItem
                  key={r.id}
                  line={line}
                  reference={r}
                  compare={showWorkshopPrice}
                  onEdit={() => setRefForm({ editId: r.id })}
                  onRemove={() => onChange({ ...line, references: line.references.filter((x) => x.id !== r.id) })}
                />
              ))}
            </ul>
          )}
          {refForm && (
            <div className="mt-2">
              <ReferenceForm
                key={refForm.editId ?? 'new'}
                partName={line.description}
                initial={toInput(editingRef, line.presentation)}
                onSave={saveReference}
                onCancel={() => setRefForm(null)}
              />
            </div>
          )}
        </section>
      </article>
    </li>
  )
}
