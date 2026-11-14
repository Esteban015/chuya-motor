'use client'

/**
 * /demo/presupuesto — Presupuestos 2.0 (Incremento 7B).
 *
 * Two modes (accessible tabs, state only — the URL never carries what the person types):
 *   A. "Consultar repuestos": a parts list without prices. 100 % local and deterministic: the same
 *      Safety Gate as the server (scoped policy, local-safety.ts), line parsing, Google search links,
 *      purchase checklist and manual references. No API call, no LLM.
 *   B. "Comparar presupuesto" (default, unchanged route behavior): POST /api/analyze exactly as
 *      before (Safety Gate, sum verification, workshop questions, rate limit, LLM quota — one call),
 *      plus a local, deterministic split of the same text into parts / labor / other concepts for
 *      search, manual references and comparison. No extra LLM call.
 * Form data survives going back from results or errors. Nothing is stored or sent to Analytics.
 */
import { useId, useState } from 'react'
import Link from 'next/link'
import type { AnalyzeRequest, ApiVehicleInput, ClientAnalyzeOutput, SafetyBlockPayload } from '@/app/api/analyze/schema'
import { SiteModeBadge } from '@/components/ai-status-badge'
import { PrivacyNotice } from '@/components/privacy-notice'
import { SafetyAlert } from '@/components/safety-alert'
import { BudgetReport } from '@/components/results/budget-report'
import { RESULTS_CONTAINER } from '@/components/results/report-parts'
import { FORM_CONTAINER, FORM_GRID } from '@/components/forms/form-context-panels'
import { FeedbackInvite } from '@/components/feedback/feedback-invite'
import { ModeTabs, panelId, tabId, type BudgetMode } from '@/components/budget-research/mode-tabs'
import { ResearchWorkspace } from '@/components/budget-research/research-workspace'
import { ProvenanceLegend } from '@/components/budget-research/badges'
import { parseResearchLines } from '@/domain/budget/research/line-parser'
import { mergeLines } from '@/domain/budget/research/merge'
import { localSafetyCheck, screenPartDescription } from '@/domain/budget/research/local-safety'
import type { ResearchLine, VehicleInfo } from '@/domain/budget/research/types'

// ── Types ────────────────────────────────────────────────────────────────────

type VehicleType = NonNullable<ApiVehicleInput['vehicleType']>

type QuoteState =
  | { kind: 'form' }
  | { kind: 'loading' }
  | { kind: 'success'; report: ClientAnalyzeOutput }
  | { kind: 'safety'; payload: SafetyBlockPayload }
  | { kind: 'rate_limit'; message: string }
  | { kind: 'error'; message: string }

type PartsState = { kind: 'form' } | { kind: 'results' } | { kind: 'safety'; payload: SafetyBlockPayload }

interface FormValues {
  partsText: string
  budgetText: string
  make: string
  model: string
  year: string
  engine: string
  vehicleType: VehicleType | ''
}

type FieldKey = keyof FormValues

const INITIAL_FORM: FormValues = { partsText: '', budgetText: '', make: '', model: '', year: '', engine: '', vehicleType: '' }

const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  sedan: 'Automóvil (sedan)',
  hatchback: 'Hatchback',
  suv: 'SUV / Camioneta 4x4',
  pickup: 'Pick-up',
  van: 'Furgoneta / Van',
  motorcycle: 'Moto',
  other: 'Otro',
}

// Synthetic examples (not real quotes).
const DEMO_BUDGET = `Aceite motor: 4500
Filtro de aire: 1500
Filtro de aceite: 2000
Mano de obra: 3000
Total: 12500`

const DEMO_PARTS = `Manguera de respiración de gases
Filtro de aceite
Bujías x4`

const DEMO_VEHICLE = { make: 'Fiat', model: 'Palio', year: '2017', engine: '1.4 8v' }

// ── Help panels ──────────────────────────────────────────────────────────────

function HelpItem({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand-accent-dark" />
      <div>
        <p className="text-sm font-semibold text-brand-text">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-brand-text-muted">{body}</p>
      </div>
    </li>
  )
}

function QuoteHelp() {
  return (
    <aside className="space-y-5" aria-label="Ayuda: análisis del presupuesto">
      <div>
        <h2 className="font-display text-base font-bold text-brand-text">¿Qué hace el análisis?</h2>
        <p className="mt-1 text-sm leading-relaxed text-brand-text-muted">Verificamos la suma, separamos repuestos y mano de obra, y te ayudamos a buscar referencias.</p>
      </div>
      <ul className="space-y-4">
        <HelpItem title="Verificación de suma" body='Si incluís una línea "Total: importe", verificamos que coincida con la suma de las partidas.' />
        <HelpItem title="Importes argentinos" body='Aceptamos "15.000", "15000" o "15.000,50". Usá "Descripción: importe", una partida por línea.' />
        <HelpItem title="Repuestos y referencias" body="Para cada repuesto armamos una búsqueda en Google. Si encontrás una oferta, la cargás y vemos la diferencia aritmética." />
        <HelpItem title="Sin opiniones de precio" body="No decimos si algo es caro o barato: no tenemos una fuente de precios verificada." />
      </ul>
      <div className="mt-2 rounded-2xl bg-brand-primary-tint p-4" aria-hidden="true">
        <p className="space-y-1 font-mono text-xs text-brand-text-muted">
          <span className="block">Manguera de respiración: 18.000</span>
          <span className="block">Mano de obra: 12.000</span>
          <span className="block font-semibold text-brand-primary">Total: 30.000</span>
        </p>
      </div>
    </aside>
  )
}

function PartsHelp() {
  return (
    <aside className="space-y-5" aria-label="Ayuda: consulta de repuestos">
      <div>
        <h2 className="font-display text-base font-bold text-brand-text">¿Cómo funciona?</h2>
        <p className="mt-1 text-sm leading-relaxed text-brand-text-muted">Escribí los repuestos que necesitás, sin precios. Armamos la búsqueda y la lista de cosas a verificar.</p>
      </div>
      <ul className="space-y-4">
        <HelpItem title="Una pieza por línea" body='Podés indicar cantidades: "Bujías x4" o "2 x Amortiguador trasero".' />
        <HelpItem title="Marca, modelo, año y motor" body="Hacen que la búsqueda sea más precisa. Son opcionales." />
        <HelpItem title="Búsqueda externa" body="Abrís los resultados de Google en otra pestaña. Chuya Motor no consulta ni verifica precios." />
        <HelpItem title="Tus referencias" body="Si encontrás una oferta, cargá comercio, precio y fecha para tenerla a mano." />
      </ul>
    </aside>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DemoPresupuestoPage() {
  const [mode, setMode] = useState<BudgetMode>('quote')
  const [form, setForm] = useState<FormValues>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [quoteState, setQuoteState] = useState<QuoteState>({ kind: 'form' })
  const [partsState, setPartsState] = useState<PartsState>({ kind: 'form' })
  const [quoteLines, setQuoteLines] = useState<ResearchLine[]>([])
  const [partsLines, setPartsLines] = useState<ResearchLine[]>([])

  const uid = useId()
  const textErrorId = `${uid}-text-error`
  const yearErrorId = `${uid}-year-error`

  const isQuote = mode === 'quote'
  const textKey: 'budgetText' | 'partsText' = isQuote ? 'budgetText' : 'partsText'
  const isLoading = isQuote && quoteState.kind === 'loading'
  const isResult = isQuote ? quoteState.kind === 'success' : partsState.kind === 'results'

  const vehicle: VehicleInfo = {
    make: form.make.trim() || undefined,
    model: form.model.trim() || undefined,
    year: form.year.trim() || undefined,
    engine: form.engine.trim() || undefined,
  }

  function update<K extends FieldKey>(key: K, value: FormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  function fillExample() {
    if (isQuote) setForm((p) => ({ ...p, budgetText: DEMO_BUDGET }))
    else setForm((p) => ({ ...p, partsText: DEMO_PARTS, ...DEMO_VEHICLE }))
    setFieldErrors({})
  }

  function validate(): boolean {
    const errors: Partial<Record<FieldKey, string>> = {}
    const text = form[textKey].trim()
    if (isQuote && text.length < 10) errors.budgetText = 'Ingresá las partidas del presupuesto (al menos 10 caracteres).'
    if (!isQuote && text.length < 3) errors.partsText = 'Escribí al menos un repuesto.'
    if (text.length > 2000) errors[textKey] = 'El texto no puede superar los 2000 caracteres.'
    if (form.year) {
      const y = Number(form.year)
      if (!Number.isInteger(y) || y < 1900 || y > 2100) errors.year = 'El año debe estar entre 1900 y 2100.'
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function submitParts() {
    const text = form.partsText.trim()
    const safety = localSafetyCheck(text)
    if (safety.blocked) {
      setPartsState({ kind: 'safety', payload: safety.payload })
      return
    }
    const parsed = parseResearchLines(text, { assumeParts: true })
    if (parsed.lines.length === 0) {
      setFieldErrors({ partsText: 'No encontramos repuestos en el texto. Escribí uno por línea.' })
      return
    }
    const rejected = parsed.lines.filter((l) => !screenPartDescription(l.description).ok).map((l) => `«${l.description.slice(0, 60)}»`)
    if (rejected.length > 0) {
      setFieldErrors({ partsText: `Estas líneas no parecen nombres de repuestos: ${rejected.slice(0, 3).join(', ')}. Escribí solo la pieza, una por línea.` })
      return
    }
    setPartsLines((prev) => mergeLines(prev, parsed.lines))
    setPartsState({ kind: 'results' })
  }

  async function submitQuote() {
    setQuoteState({ kind: 'loading' })
    const apiVehicle: ApiVehicleInput = {}
    if (form.vehicleType) apiVehicle.vehicleType = form.vehicleType as VehicleType
    if (form.make.trim()) apiVehicle.make = form.make.trim()
    if (form.model.trim()) apiVehicle.model = form.model.trim()
    if (form.year) apiVehicle.year = Number(form.year)
    // Unchanged contract: the engine is used only locally for searches.
    const body: AnalyzeRequest = { userText: form.budgetText.trim() }
    if (Object.keys(apiVehicle).length > 0) body.vehicle = apiVehicle

    try {
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (response.status === 422) {
        setQuoteState({ kind: 'safety', payload: (await response.json()) as SafetyBlockPayload })
        return
      }
      if (response.status === 429) {
        const data = (await response.json()) as { message: string }
        setQuoteState({ kind: 'rate_limit', message: data.message })
        return
      }
      if (response.status === 400) {
        const data = (await response.json()) as { message: string }
        setFieldErrors({ budgetText: data.message })
        setQuoteState({ kind: 'form' })
        return
      }
      if (!response.ok) {
        setQuoteState({ kind: 'error', message: 'Error interno del servidor. Intentá de nuevo más tarde.' })
        return
      }
      const report = (await response.json()) as ClientAnalyzeOutput
      const parsed = parseResearchLines(form.budgetText.trim(), { assumeParts: false })
      setQuoteLines((prev) => mergeLines(prev, parsed.lines))
      setQuoteState({ kind: 'success', report })
    } catch {
      setQuoteState({ kind: 'error', message: 'No se pudo conectar con el servidor. Revisá tu conexión.' })
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!validate()) return
    if (isQuote) void submitQuote()
    else submitParts()
  }

  /** Back to the form keeping everything the person typed. */
  function backToForm() {
    if (isQuote) setQuoteState({ kind: 'form' })
    else setPartsState({ kind: 'form' })
  }

  /** "Analizar otro presupuesto": a new, empty quote (vehicle data kept). */
  function newQuote() {
    setForm((p) => ({ ...p, budgetText: '' }))
    setQuoteLines([])
    setFieldErrors({})
    setQuoteState({ kind: 'form' })
  }

  const inputCls =
    'w-full rounded-xl border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text placeholder-brand-text-light focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:opacity-50 transition-colors'
  const container = isResult ? RESULTS_CONTAINER : FORM_CONTAINER
  const textError = fieldErrors[textKey]

  return (
    <main className="min-h-screen bg-brand-bg">
      <header className="border-b border-brand-border-light bg-white">
        <div className={`${container} flex h-14 items-center justify-between gap-4`}>
          <Link href="/demo" className="flex items-center gap-1.5 text-sm text-brand-text-muted transition-colors hover:text-brand-primary" aria-label="Volver al demo">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3L5 8l5 5" />
            </svg>
            <span>Demo</span>
          </Link>
          {!isResult && <SiteModeBadge />}
        </div>
      </header>

      <div className={`${container} pt-6 sm:pt-8`}>
        {!isResult && (
          <div className="pb-4">
            <h1 className="font-display text-2xl font-extrabold text-brand-text">Presupuestos y repuestos</h1>
            <p className="mt-1 text-sm leading-relaxed text-brand-text-muted">
              Buscá referencias de repuestos o revisá el presupuesto del taller. Chuya Motor no consulta precios por su cuenta: te ayuda a buscar y a comparar lo que encontrás.
            </p>
          </div>
        )}
        <ModeTabs mode={mode} onChange={(m) => { setMode(m); setFieldErrors({}) }} />
      </div>

      {(['parts', 'quote'] as const).filter((m) => m !== mode).map((m) => (
        <div key={m} role="tabpanel" id={panelId(m)} aria-labelledby={tabId(m)} hidden />
      ))}

      <div role="tabpanel" id={panelId(mode)} aria-labelledby={tabId(mode)}>
        {/* ── Quote results ── */}
        {isQuote && quoteState.kind === 'success' && (
          <div className={`${RESULTS_CONTAINER} animate-fade-in pb-16 pt-6`}>
            <div className="mb-4 flex justify-end">
              <button type="button" onClick={backToForm} className="rounded-xl border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-text hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
                ← Corregir el presupuesto
              </button>
            </div>
            <BudgetReport
              report={quoteState.report}
              declared={{
                budgetText: form.budgetText.trim(),
                vehicleType: form.vehicleType ? VEHICLE_TYPE_LABEL[form.vehicleType] : undefined,
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year,
              }}
              onNewQuery={newQuote}
              research={
                quoteState.report.route === 'budget' ? (
                  <ResearchWorkspace
                    lines={quoteLines}
                    onLinesChange={setQuoteLines}
                    vehicle={vehicle}
                    mode="quote"
                    serverTotalMinor={quoteState.report.budget?.computedTotalMinorUnit ?? null}
                    serverQuestions={quoteState.report.questions}
                  />
                ) : undefined
              }
            />
          </div>
        )}

        {/* ── Parts results ── */}
        {!isQuote && partsState.kind === 'results' && (
          <div className={`${RESULTS_CONTAINER} animate-fade-in space-y-6 pb-16 pt-6`} data-testid="parts-results">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-3xl border border-brand-border-light bg-white p-5 shadow-brand-xs sm:p-6">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-text-muted">Consulta de repuestos · Resultado</p>
                <h1 className="mt-1 font-display text-2xl font-extrabold text-brand-text">Tu lista de repuestos</h1>
                <p className="mt-1 text-sm text-brand-text-muted">
                  {partsLines.length} {partsLines.length === 1 ? 'ítem' : 'ítems'} · sin precios inventados: los precios los buscás y cargás vos.
                </p>
              </div>
              <button type="button" onClick={backToForm} className="rounded-xl border border-brand-border bg-white px-4 py-2 text-sm font-medium text-brand-text hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
                ← Editar la lista
              </button>
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
              <div className="min-w-0">
                <ResearchWorkspace lines={partsLines} onLinesChange={setPartsLines} vehicle={vehicle} mode="parts" />
              </div>
              <div className="min-w-0 space-y-4 lg:sticky lg:top-6">
                <ProvenanceLegend />
                <p className="rounded-2xl border border-brand-border-light bg-white p-4 text-xs leading-relaxed text-brand-text-muted">
                  Las búsquedas abren Google en otra pestaña. Los resultados son externos y Chuya Motor no los verificó. Antes de comprar, confirmá la compatibilidad con el vendedor o con tu taller.
                </p>
              </div>
            </div>
            <p className="border-t border-brand-border-light pt-4 text-xs italic leading-relaxed text-brand-text-light">
              Orientación automática para buscar repuestos. No reemplaza la inspección ni el consejo de un profesional.
            </p>
            <FeedbackInvite />
          </div>
        )}

        {/* ── Forms, errors and safety ── */}
        {!isResult && (
          <div className={`${FORM_CONTAINER} pb-16 pt-4`}>
            <div className={FORM_GRID}>
              <div className="min-w-0 space-y-6">
                {isQuote && quoteState.kind === 'rate_limit' && (
                  <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-medium text-amber-800">Límite de consultas alcanzado. {quoteState.message}</p>
                    <button type="button" onClick={backToForm} className="mt-2 text-sm text-amber-700 underline hover:no-underline">Volver al formulario</button>
                  </div>
                )}
                {isQuote && quoteState.kind === 'error' && (
                  <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-medium text-red-700">{quoteState.message}</p>
                    <button type="button" onClick={backToForm} className="mt-2 text-sm text-red-600 underline hover:no-underline">Volver al formulario</button>
                  </div>
                )}
                {((isQuote && quoteState.kind === 'safety') || (!isQuote && partsState.kind === 'safety')) && (
                  <div className="space-y-4">
                    {(() => {
                      const payload = isQuote ? (quoteState as { payload: SafetyBlockPayload }).payload : (partsState as { payload: SafetyBlockPayload }).payload
                      return (
                        <SafetyAlert message={payload.safetyDerivationMessage} policyVersion={payload.policyVersion} coverageDisclaimer={payload.coverageDisclaimer} severity={payload.severity ?? null} />
                      )
                    })()}
                    <button type="button" onClick={backToForm} className="rounded-xl border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-text transition-colors hover:bg-brand-bg">
                      Volver a intentar
                    </button>
                  </div>
                )}

                {((isQuote && (quoteState.kind === 'form' || quoteState.kind === 'loading')) || (!isQuote && partsState.kind === 'form')) && (
                  <form onSubmit={handleSubmit} noValidate className="overflow-hidden rounded-2xl border border-brand-border-light bg-white shadow-brand-xs">
                    <div className="border-b border-brand-border-light px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
                      <div className="flex items-center justify-between gap-3">
                        <label htmlFor={textKey} className="text-sm font-medium text-brand-text">
                          {isQuote ? 'Partidas del presupuesto' : 'Repuestos que necesitás'} <span className="text-red-500" aria-hidden="true">*</span>
                        </label>
                        <button type="button" onClick={fillExample} disabled={isLoading} className="text-xs text-brand-primary underline transition-colors hover:text-brand-primary-light hover:no-underline disabled:opacity-50">
                          Usar ejemplo
                        </button>
                      </div>
                    </div>
                    <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
                      <div>
                        <textarea
                          id={textKey}
                          name={textKey}
                          required
                          aria-required="true"
                          aria-invalid={!!textError}
                          aria-describedby={textError ? textErrorId : `${uid}-text-hint`}
                          rows={isQuote ? 8 : 6}
                          maxLength={2000}
                          placeholder={isQuote ? 'Ej:\nManguera de respiración de gases: 18000\nMano de obra: 12000\nTotal: 30000' : 'Ej:\nManguera de respiración de gases\nFiltro de aceite\nBujías x4'}
                          value={form[textKey]}
                          onChange={(e) => update(textKey, e.target.value)}
                          disabled={isLoading}
                          className={`${inputCls} resize-y font-mono`}
                        />
                        <div className="mt-1.5 flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <p id={`${uid}-text-hint`} className="text-xs text-brand-text-muted">
                              {isQuote
                                ? "Una partida por línea con el formato 'Descripción: importe'. Podés incluir 'Total: importe' para verificar la suma."
                                : 'Un repuesto por línea, sin precios. Podés indicar cantidades ("x4").'}
                            </p>
                            {textError && (
                              <p id={textErrorId} role="alert" className="text-xs text-red-600">{textError}</p>
                            )}
                          </div>
                          <span className="flex-shrink-0 text-xs text-brand-text-light">{form[textKey].length}/2000</span>
                        </div>
                      </div>

                      <fieldset className="space-y-4">
                        <legend className="text-sm font-medium text-brand-text-muted">Datos del vehículo (opcional)</legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label htmlFor="make" className="mb-1.5 block text-xs font-medium text-brand-text-muted">Marca</label>
                            <input id="make" name="make" type="text" maxLength={40} placeholder="Ej: Fiat" value={form.make} onChange={(e) => update('make', e.target.value)} disabled={isLoading} className={inputCls} />
                          </div>
                          <div>
                            <label htmlFor="model" className="mb-1.5 block text-xs font-medium text-brand-text-muted">Modelo</label>
                            <input id="model" name="model" type="text" maxLength={40} placeholder="Ej: Palio" value={form.model} onChange={(e) => update('model', e.target.value)} disabled={isLoading} className={inputCls} />
                          </div>
                          <div>
                            <label htmlFor="year" className="mb-1.5 block text-xs font-medium text-brand-text-muted">Año</label>
                            <input id="year" name="year" type="number" min={1900} max={2100} placeholder="Ej: 2017" value={form.year} onChange={(e) => update('year', e.target.value)} disabled={isLoading} aria-invalid={!!fieldErrors.year} aria-describedby={fieldErrors.year ? yearErrorId : undefined} className={inputCls} />
                            {fieldErrors.year && <p id={yearErrorId} role="alert" className="mt-1.5 text-xs text-red-600">{fieldErrors.year}</p>}
                          </div>
                          <div>
                            <label htmlFor="engine" className="mb-1.5 block text-xs font-medium text-brand-text-muted">Motor</label>
                            <input id="engine" name="engine" type="text" maxLength={40} placeholder="Ej: 1.4 8v" value={form.engine} onChange={(e) => update('engine', e.target.value)} disabled={isLoading} className={inputCls} />
                          </div>
                          {isQuote && (
                            <div>
                              <label htmlFor="vehicleType" className="mb-1.5 block text-xs font-medium text-brand-text-muted">Tipo de vehículo</label>
                              <select id="vehicleType" name="vehicleType" value={form.vehicleType} onChange={(e) => update('vehicleType', e.target.value as VehicleType | '')} disabled={isLoading} className={inputCls}>
                                <option value="">Seleccioná...</option>
                                {(Object.keys(VEHICLE_TYPE_LABEL) as VehicleType[]).map((t) => (
                                  <option key={t} value={t}>{VEHICLE_TYPE_LABEL[t]}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </fieldset>

                      <PrivacyNotice />

                      <button
                        type="submit"
                        disabled={isLoading}
                        aria-busy={isLoading}
                        className="w-full rounded-xl bg-brand-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-primary-light focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isQuote ? (isLoading ? 'Analizando...' : 'Analizar presupuesto') : 'Preparar búsqueda'}
                      </button>
                      {!isQuote && <p className="text-center text-xs text-brand-text-muted">Se resuelve en tu navegador: no se envía a ningún servidor ni a una IA.</p>}
                    </div>
                  </form>
                )}

                {isLoading && (
                  <div aria-live="polite" aria-label="Cargando análisis" className="animate-pulse space-y-3">
                    <div className="h-4 w-3/4 rounded-lg bg-brand-bg-alt" />
                    <div className="h-4 w-1/2 rounded-lg bg-brand-bg-alt" />
                    <div className="h-4 w-5/6 rounded-lg bg-brand-bg-alt" />
                  </div>
                )}
              </div>

              <div className="min-w-0" data-testid="form-context">
                <div className="rounded-2xl border border-brand-border-light bg-white p-6 shadow-brand-xs lg:sticky lg:top-6">
                  {isQuote ? <QuoteHelp /> : <PartsHelp />}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
