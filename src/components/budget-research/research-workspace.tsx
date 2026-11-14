'use client'

/**
 * research-workspace.tsx — The list of identified items, grouped by concept (7B):
 * parts (search + references + comparison), labor (visible, never compared), other concepts and
 * unclassified lines the person can classify. Local state only.
 */
import { useId, useState } from 'react'
import { formatArs } from '@/domain/budget/research/ars-amount'
import { laborQuestions, partsQuestions } from '@/domain/budget/research/guidance'
import { sumWorkshopPrices } from '@/domain/budget/research/merge'
import { PART_SCREEN_TEXT, screenPartDescription } from '@/domain/budget/research/local-safety'
import { CATEGORY_LABEL, MAX_DESCRIPTION, MAX_LINES, type LineCategory, type ResearchLine, type VehicleInfo } from '@/domain/budget/research/types'
import { BulletList, CopyQuestionsButton, QuestionList, SectionCard } from '@/components/results/report-parts'
import { ProvenanceBadge } from './badges'
import { PartCard } from './part-card'

let lineSeq = 0
const newLineId = () => `added-${Date.now().toString(36)}-${++lineSeq}`

function ConceptRow({ line, onChange, onRemove }: { line: ResearchLine; onChange: (l: ResearchLine) => void; onRemove: () => void }) {
  const uid = useId()
  return (
    <li className="flex flex-col gap-2 border-b border-brand-border-light pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-brand-text">{line.description}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-brand-text-muted">
          <ProvenanceBadge kind="declared" />
          {line.workshopPriceMinor !== null ? (
            <span className="tabular-nums">Informado por el taller: {formatArs(line.workshopPriceMinor)}</span>
          ) : (
            <ProvenanceBadge kind="missing" label={line.pricePending ? 'Importe a confirmar' : 'Sin importe'} />
          )}
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <label htmlFor={`${uid}-cat`} className="sr-only">Tipo de concepto de {line.description}</label>
        <select id={`${uid}-cat`} value={line.category} onChange={(e) => onChange({ ...line, category: e.target.value as LineCategory })} className="rounded-lg border border-brand-border bg-white px-2 py-1.5 text-xs text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary/30">
          {(Object.keys(CATEGORY_LABEL) as LineCategory[]).map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <button type="button" onClick={onRemove} className="rounded-lg px-2 py-1.5 text-xs font-medium text-red-700 underline hover:no-underline">
          Eliminar<span className="sr-only"> {line.description}</span>
        </button>
      </div>
    </li>
  )
}

export function ResearchWorkspace({
  lines,
  onLinesChange,
  vehicle,
  mode,
  serverTotalMinor,
  serverQuestions = [],
}: {
  lines: ResearchLine[]
  onLinesChange: (lines: ResearchLine[]) => void
  vehicle: VehicleInfo
  mode: 'parts' | 'quote'
  serverTotalMinor?: number | null
  serverQuestions?: readonly string[]
}) {
  const [newPart, setNewPart] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const uid = useId()
  const isQuote = mode === 'quote'
  const parts = lines.filter((l) => l.category === 'part')
  const labor = lines.filter((l) => l.category === 'labor')
  const others = lines.filter((l) => l.category === 'other' || l.category === 'unclassified')
  const update = (l: ResearchLine) => onLinesChange(lines.map((x) => (x.id === l.id ? l : x)))
  const remove = (id: string) => onLinesChange(lines.filter((x) => x.id !== id))
  const sum = sumWorkshopPrices(lines)
  const vehicleLabel = [vehicle.make, vehicle.model, vehicle.engine, vehicle.year].filter(Boolean).join(' ')

  function addPart(e: React.FormEvent) {
    e.preventDefault()
    const description = newPart.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION)
    if (!description || lines.length >= MAX_LINES) return
    const screen = screenPartDescription(description)
    if (!screen.ok) {
      setAddError(PART_SCREEN_TEXT[screen.reason])
      return
    }
    setAddError(null)
    onLinesChange([
      ...lines,
      { id: newLineId(), description, category: 'part', quantity: 1, presentation: 'unit', partBrand: '', partCode: '', workshopPriceMinor: null, pricePending: false, references: [] },
    ])
    setNewPart('')
  }

  // Server questions already cover parts/labor topics: show only the local ones not repeated there.
  const seen = new Set(serverQuestions.map((q) => q.toLowerCase()))
  const laborQs = laborQuestions().filter((q) => !seen.has(q.toLowerCase()))
  const partsQs = partsQuestions().filter((q) => !seen.has(q.toLowerCase()))

  return (
    <div className="space-y-6" data-testid="research-workspace">
      <section aria-labelledby={`${uid}-parts`} className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id={`${uid}-parts`} className="font-display text-xl font-extrabold text-brand-text">
              {isQuote ? 'Repuestos: buscar y comparar' : 'Repuestos identificados'}
            </h2>
            <p className="text-xs text-brand-text-muted">
              {vehicleLabel ? `Para ${vehicleLabel}. ` : 'Sin datos del vehículo: las búsquedas serán menos precisas. '}
              Chuya Motor no consulta precios: abrís la búsqueda vos y cargás lo que encontrás.
            </p>
          </div>
          {isQuote && sum.pricedLines > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-brand-text-muted" data-testid="list-sum">
              <ProvenanceBadge kind="calculation" /> Suma de las partidas listadas: <strong className="tabular-nums text-brand-text">{formatArs(sum.totalMinor)}</strong>
            </p>
          )}
        </div>
        {isQuote && serverTotalMinor != null && sum.missingLines === 0 && sum.totalMinor !== serverTotalMinor && (
          <p role="note" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            La suma de esta lista ({formatArs(sum.totalMinor)}) no coincide con la verificación del presupuesto ({formatArs(serverTotalMinor)}). Revisá si falta, sobra o cambió alguna partida.
          </p>
        )}

        {parts.length === 0 ? (
          <p className="rounded-xl bg-white px-4 py-3 text-sm text-brand-text-muted">No hay repuestos en la lista. Agregá uno abajo o reclasificá un concepto.</p>
        ) : (
          <ul className="space-y-4">
            {parts.map((l) => (
              <PartCard key={l.id} line={l} vehicle={vehicle} showWorkshopPrice={isQuote} onChange={update} onRemove={() => remove(l.id)} />
            ))}
          </ul>
        )}

        <form onSubmit={addPart} className="flex flex-col gap-2 sm:flex-row" aria-label="Agregar un repuesto">
          <label htmlFor={`${uid}-new`} className="sr-only">Nombre del repuesto a agregar</label>
          <input
            id={`${uid}-new`}
            value={newPart}
            maxLength={MAX_DESCRIPTION}
            onChange={(e) => {
              setNewPart(e.target.value)
              setAddError(null)
            }}
            aria-invalid={!!addError}
            aria-describedby={addError ? `${uid}-add-error` : undefined}
            placeholder="Agregar otro repuesto, por ejemplo: Termostato"
            className="min-w-0 flex-1 rounded-xl border border-brand-border bg-white px-3 py-2 text-sm text-brand-text placeholder-brand-text-light focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
          />
          <button type="submit" disabled={!newPart.trim() || lines.length >= MAX_LINES} className="rounded-xl border border-brand-primary/30 bg-white px-4 py-2 text-sm font-semibold text-brand-primary hover:bg-brand-accent disabled:opacity-50">
            Agregar repuesto
          </button>
        </form>
        {addError && (
          <p id={`${uid}-add-error`} role="alert" className="text-xs text-red-600">
            {addError}
          </p>
        )}
      </section>

      {labor.length > 0 && (
        <SectionCard id={`${uid}-labor`} title="Mano de obra">
          <p className="mb-3 text-xs leading-relaxed text-brand-text-muted">
            Es parte del presupuesto, pero no se compara con referencias externas: depende del trabajo, el tiempo y la garantía de cada taller.
          </p>
          <ul className="space-y-3" data-testid="labor-lines">
            {labor.map((l) => (
              <ConceptRow key={l.id} line={l} onChange={update} onRemove={() => remove(l.id)} />
            ))}
          </ul>
          {laborQs.length > 0 && (
            <div className="mt-4 border-t border-brand-border-light pt-3">
              <p className="mb-2 text-xs font-semibold text-brand-text">Para preguntarle al taller sobre la mano de obra</p>
              <QuestionList questions={laborQs} />
              <div className="mt-3">
                <CopyQuestionsButton questions={laborQs} />
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {others.length > 0 && (
        <SectionCard id={`${uid}-others`} title="Otros conceptos">
          <p className="mb-3 text-xs text-brand-text-muted">
            Insumos, impuestos, envíos o partidas que no pudimos clasificar. Si alguna es un repuesto o mano de obra, cambiala en el selector.
          </p>
          <ul className="space-y-3">
            {others.map((l) => (
              <ConceptRow key={l.id} line={l} onChange={update} onRemove={() => remove(l.id)} />
            ))}
          </ul>
        </SectionCard>
      )}

      {parts.length > 0 && partsQs.length > 0 && (
        <SectionCard id={`${uid}-partsq`} title={isQuote ? 'Preguntas sobre los repuestos' : 'Si después pedís presupuesto'}>
          <BulletList items={partsQs} />
        </SectionCard>
      )}
    </div>
  )
}
