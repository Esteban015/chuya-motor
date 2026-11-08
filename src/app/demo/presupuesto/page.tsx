'use client'

import { useState, useId } from 'react'
import Link from 'next/link'
import type {
  AnalyzeRequest,
  ApiVehicleInput,
  ClientAnalyzeOutput,
  SafetyBlockPayload,
} from '@/app/api/analyze/schema'
import { DemoBadge } from '@/components/demo-badge'
import { PrivacyNotice } from '@/components/privacy-notice'
import { SafetyAlert } from '@/components/safety-alert'
import { ReportView } from '@/components/report-view'

// ── Types ────────────────────────────────────────────────────────────────────

type VehicleType = NonNullable<ApiVehicleInput['vehicleType']>

type PageState =
  | { kind: 'form' }
  | { kind: 'loading' }
  | { kind: 'success'; report: ClientAnalyzeOutput }
  | { kind: 'safety'; payload: SafetyBlockPayload }
  | { kind: 'rate_limit'; message: string }
  | { kind: 'error'; message: string }

interface FormValues {
  budgetText: string
  make: string
  model: string
  year: string
  vehicleType: VehicleType | ''
}

const INITIAL_FORM: FormValues = {
  budgetText: '',
  make: '',
  model: '',
  year: '',
  vehicleType: '',
}

const DEMO_BUDGET = `Aceite motor: 4500
Filtro de aire: 1500
Filtro de aceite: 2000
Mano de obra: 3000
Total: 12500`

// ── Tips panel ────────────────────────────────────────────────────────────────

function TipsPanel() {
  const tips = [
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9 2L2 16h14L9 2z" stroke="#103B3B" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M9 7v4M9 13h.01" stroke="#103B3B" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
      title: 'Verificación de suma',
      body: 'Si incluís una línea "Total: importe", verificamos que coincida con la suma de las partidas.',
    },
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="12" height="12" rx="2" stroke="#103B3B" strokeWidth="1.5" />
          <path d="M6 9h6M6 12h4" stroke="#103B3B" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
      title: 'Formato libre',
      body: 'Podés pegar el texto tal como lo recibiste del taller — no hace falta ningún formato especial.',
    },
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="6.5" stroke="#103B3B" strokeWidth="1.5" />
          <path d="M9 6v3l2 2" stroke="#103B3B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: 'Importes argentinos',
      body: 'Aceptamos el formato local: "15.000" o "15000". Ambos se interpretan igual.',
    },
    {
      icon: (
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9 2a7 7 0 100 14A7 7 0 009 2z" stroke="#103B3B" strokeWidth="1.5" />
          <path d="M6.5 9a2.5 2.5 0 015 0" stroke="#103B3B" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="9" cy="12" r="1" fill="#103B3B" />
        </svg>
      ),
      title: 'Preguntas para el taller',
      body: 'El análisis incluye las preguntas exactas que podés hacerle al mecánico para entender cada partida.',
    },
  ]

  return (
    <aside className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-brand-text font-display">¿Qué hace el análisis?</h2>
        <p className="mt-1 text-sm text-brand-text-muted leading-relaxed">
          Revisamos el presupuesto por vos y preparamos las preguntas correctas.
        </p>
      </div>

      <ul className="space-y-4">
        {tips.map((tip) => (
          <li key={tip.title} className="flex gap-3">
            <span className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-brand-primary-tint flex items-center justify-center">
              {tip.icon}
            </span>
            <div>
              <p className="text-sm font-semibold text-brand-text">{tip.title}</p>
              <p className="text-xs text-brand-text-muted mt-0.5 leading-relaxed">{tip.body}</p>
            </div>
          </li>
        ))}
      </ul>

      {/* Budget illustration */}
      <div className="rounded-2xl bg-brand-primary-tint p-4 mt-2" aria-hidden="true">
        <p className="text-xs font-mono text-brand-text-muted space-y-1">
          <span className="block">Pastillas de freno: 8.500</span>
          <span className="block">Mano de obra: 3.000</span>
          <span className="block font-semibold text-brand-primary">Total declarado: 12.500</span>
          <span className="block mt-2 text-brand-coral font-semibold">⚠ Suma calculada: 11.500</span>
        </p>
      </div>
    </aside>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DemoPresupuestoPage() {
  const [form, setForm] = useState<FormValues>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({})
  const [pageState, setPageState] = useState<PageState>({ kind: 'form' })

  const budgetErrorId = useId()
  const yearErrorId = useId()

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  function fillDemoExample() {
    setForm((prev) => ({ ...prev, budgetText: DEMO_BUDGET }))
    setFieldErrors((prev) => ({ ...prev, budgetText: undefined }))
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof FormValues, string>> = {}
    if (form.budgetText.trim().length < 10)
      errors.budgetText = 'Ingresá las partidas del presupuesto (al menos 10 caracteres).'
    if (form.budgetText.trim().length > 2000)
      errors.budgetText = 'El presupuesto no puede superar los 2000 caracteres.'
    if (form.year) {
      const y = Number(form.year)
      if (isNaN(y) || y < 1900 || y > 2100) errors.year = 'El año debe estar entre 1900 y 2100.'
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!validate()) return
    setPageState({ kind: 'loading' })

    const vehicle: ApiVehicleInput = {}
    if (form.vehicleType) vehicle.vehicleType = form.vehicleType as VehicleType
    if (form.make.trim()) vehicle.make = form.make.trim()
    if (form.model.trim()) vehicle.model = form.model.trim()
    if (form.year) vehicle.year = Number(form.year)

    const body: AnalyzeRequest = { userText: form.budgetText.trim() }
    if (Object.keys(vehicle).length > 0) body.vehicle = vehicle

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (response.status === 422) {
        const payload = (await response.json()) as SafetyBlockPayload
        setPageState({ kind: 'safety', payload })
        return
      }
      if (response.status === 429) {
        const data = (await response.json()) as { error: string; message: string }
        setPageState({ kind: 'rate_limit', message: data.message })
        return
      }
      if (response.status === 400) {
        const data = (await response.json()) as { error: string; message: string }
        setFieldErrors({ budgetText: data.message })
        setPageState({ kind: 'form' })
        return
      }
      if (!response.ok) {
        setPageState({ kind: 'error', message: 'Error interno del servidor. Intentá de nuevo más tarde.' })
        return
      }

      const report = (await response.json()) as ClientAnalyzeOutput
      setPageState({ kind: 'success', report })
    } catch {
      setPageState({ kind: 'error', message: 'No se pudo conectar con el servidor. Revisá tu conexión.' })
    }
  }

  function resetAll() {
    setForm(INITIAL_FORM)
    setFieldErrors({})
    setPageState({ kind: 'form' })
  }

  const isLoading = pageState.kind === 'loading'

  const inputCls =
    'w-full rounded-xl border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text placeholder-brand-text-light focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:opacity-50 transition-colors'

  const selectCls =
    'w-full rounded-xl border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:opacity-50 transition-colors'

  return (
    <main className="min-h-screen bg-brand-bg">

      {/* Header */}
      <header className="bg-white border-b border-brand-border-light px-6">
        <div className="max-w-6xl mx-auto h-14 flex items-center justify-between gap-4">
          <Link
            href="/demo"
            className="flex items-center gap-1.5 text-sm text-brand-text-muted hover:text-brand-primary transition-colors"
            aria-label="Volver al demo"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 3L5 8l5 5" />
            </svg>
            <span>Demo</span>
          </Link>
          <DemoBadge />
        </div>
      </header>

      {/* Page title */}
      <div className="max-w-6xl mx-auto px-4 pt-8 pb-4">
        <h1 className="text-2xl font-extrabold text-brand-text font-display">Entender mi presupuesto</h1>
        <p className="mt-1 text-sm text-brand-text-muted leading-relaxed">
          Pegá las partidas del presupuesto para verificar la suma y obtener las preguntas correctas para el taller.
        </p>
      </div>

      {/* 2-col layout */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <div className="grid lg:grid-cols-[1fr_320px] gap-8 items-start">

          {/* Left — form + result */}
          <div className="space-y-6">

            {/* Rate limit */}
            {pageState.kind === 'rate_limit' && (
              <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-800">Límite de consultas alcanzado. {pageState.message}</p>
                <button type="button" onClick={resetAll} className="mt-2 text-sm text-amber-700 underline hover:no-underline">Volver al formulario</button>
              </div>
            )}

            {/* Generic error */}
            {pageState.kind === 'error' && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-700">{pageState.message}</p>
                <button type="button" onClick={resetAll} className="mt-2 text-sm text-red-600 underline hover:no-underline">Volver al formulario</button>
              </div>
            )}

            {/* Safety block */}
            {pageState.kind === 'safety' && (
              <div className="space-y-4">
                <SafetyAlert
                  message={pageState.payload.safetyDerivationMessage}
                  policyVersion={pageState.payload.policyVersion}
                  coverageDisclaimer={pageState.payload.coverageDisclaimer}
                />
                <button type="button" onClick={resetAll} className="rounded-xl border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-text hover:bg-brand-bg transition-colors">
                  Volver a intentar
                </button>
              </div>
            )}

            {/* Form */}
            {(pageState.kind === 'form' || pageState.kind === 'loading') && (
              <form onSubmit={handleSubmit} noValidate className="bg-white rounded-2xl border border-brand-border-light overflow-hidden">
                <div className="px-6 pt-6 pb-4 border-b border-brand-border-light">
                  <div className="flex items-center justify-between">
                    <label htmlFor="budgetText" className="text-sm font-medium text-brand-text">
                      Partidas del presupuesto <span className="text-red-500" aria-hidden="true">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={fillDemoExample}
                      disabled={isLoading}
                      className="text-xs text-brand-primary hover:text-brand-primary-light underline hover:no-underline disabled:opacity-50 transition-colors"
                    >
                      Usar ejemplo
                    </button>
                  </div>
                </div>
                <div className="px-6 py-6 space-y-5">
                  <div>
                    <textarea
                      id="budgetText"
                      name="budgetText"
                      required
                      aria-required="true"
                      aria-describedby={fieldErrors.budgetText ? budgetErrorId : undefined}
                      rows={8}
                      minLength={10}
                      maxLength={2000}
                      placeholder={'Ej:\nPastillas de freno delanteras: 8500\nMano de obra: 3000\nTotal: 11500'}
                      value={form.budgetText}
                      onChange={(e) => update('budgetText', e.target.value)}
                      disabled={isLoading}
                      className={`${inputCls} font-mono resize-y`}
                    />
                    <div className="mt-1.5 flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <p className="text-xs text-brand-text-muted">
                          Usá el formato &apos;Descripción: Importe&apos;. Podés incluir una línea
                          &apos;Total: importe&apos; para verificar la suma.
                        </p>
                        {fieldErrors.budgetText && (
                          <p id={budgetErrorId} role="alert" className="text-xs text-red-600">
                            {fieldErrors.budgetText}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-brand-text-light flex-shrink-0">{form.budgetText.length}/2000</span>
                    </div>
                  </div>

                  {/* Optional vehicle fields */}
                  <fieldset className="space-y-4">
                    <legend className="text-sm font-medium text-brand-text-muted">Datos del vehículo (opcional)</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="make" className="block text-xs font-medium text-brand-text-muted mb-1.5">Marca</label>
                        <input id="make" name="make" type="text" placeholder="Ej: Toyota" value={form.make} onChange={(e) => update('make', e.target.value)} disabled={isLoading} className={inputCls} />
                      </div>
                      <div>
                        <label htmlFor="model" className="block text-xs font-medium text-brand-text-muted mb-1.5">Modelo</label>
                        <input id="model" name="model" type="text" placeholder="Ej: Corolla" value={form.model} onChange={(e) => update('model', e.target.value)} disabled={isLoading} className={inputCls} />
                      </div>
                      <div>
                        <label htmlFor="year" className="block text-xs font-medium text-brand-text-muted mb-1.5">Año</label>
                        <input
                          id="year" name="year" type="number" min={1900} max={2100}
                          placeholder="Ej: 2015" value={form.year}
                          onChange={(e) => update('year', e.target.value)}
                          disabled={isLoading}
                          aria-describedby={fieldErrors.year ? yearErrorId : undefined}
                          className={inputCls}
                        />
                        {fieldErrors.year && (
                          <p id={yearErrorId} role="alert" className="mt-1.5 text-xs text-red-600">{fieldErrors.year}</p>
                        )}
                      </div>
                      <div>
                        <label htmlFor="vehicleType" className="block text-xs font-medium text-brand-text-muted mb-1.5">Tipo de vehículo</label>
                        <select id="vehicleType" name="vehicleType" value={form.vehicleType} onChange={(e) => update('vehicleType', e.target.value as VehicleType | '')} disabled={isLoading} className={selectCls}>
                          <option value="">Seleccioná...</option>
                          <option value="sedan">Automóvil (sedan)</option>
                          <option value="hatchback">Hatchback</option>
                          <option value="suv">SUV / Camioneta 4x4</option>
                          <option value="pickup">Pick-up</option>
                          <option value="van">Furgoneta / Van</option>
                          <option value="motorcycle">Moto</option>
                          <option value="other">Otro</option>
                        </select>
                      </div>
                    </div>
                  </fieldset>

                  <PrivacyNotice />

                  <button
                    type="submit"
                    disabled={isLoading}
                    aria-busy={isLoading}
                    className="w-full rounded-xl bg-brand-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-primary-light focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoading ? 'Analizando...' : 'Analizar presupuesto'}
                  </button>
                </div>
              </form>
            )}

            {/* Loading skeleton */}
            {pageState.kind === 'loading' && (
              <div aria-live="polite" aria-label="Cargando análisis" className="space-y-3 animate-pulse">
                <div className="h-4 bg-brand-bg-alt rounded-lg w-3/4" />
                <div className="h-4 bg-brand-bg-alt rounded-lg w-1/2" />
                <div className="h-4 bg-brand-bg-alt rounded-lg w-5/6" />
              </div>
            )}

            {/* Success */}
            {pageState.kind === 'success' && (
              <div className="space-y-6">
                <ReportView report={pageState.report} />
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={resetAll}
                    className="rounded-xl border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-text hover:bg-brand-bg transition-colors"
                  >
                    Nueva consulta
                  </button>
                  <Link href="/demo" className="rounded-xl border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-text hover:bg-brand-bg transition-colors text-center">
                    Volver al demo
                  </Link>
                </div>
              </div>
            )}

          </div>

          {/* Right — tips (always visible) */}
          <div className="hidden lg:block">
            <div className="sticky top-6 bg-white rounded-2xl border border-brand-border-light p-6">
              <TipsPanel />
            </div>
          </div>

        </div>
      </div>
    </main>
  )
}
