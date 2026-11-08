'use client'

import { useState, useId } from 'react'
import type {
  AnalyzeRequest,
  ApiVehicleInput,
  ClientAnalyzeOutput,
  SafetyBlockPayload,
} from '@/app/api/analyze/schema'
import { AppHeader } from '@/components/app-header'
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function PresupuestoPage() {
  const [form, setForm] = useState<FormValues>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({})
  const [pageState, setPageState] = useState<PageState>({ kind: 'form' })

  const budgetErrorId = useId()
  const yearErrorId = useId()

  function updateField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
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

  const inputClass =
    'w-full rounded-xl border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text placeholder-brand-text-light focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:opacity-50 transition-colors'

  const selectClass =
    'w-full rounded-xl border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:opacity-50 transition-colors'

  return (
    <main className="min-h-screen bg-brand-bg">
      <AppHeader />

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-brand-text font-display">Entender mi presupuesto</h1>
          <p className="mt-1 text-sm text-brand-text-muted leading-relaxed">
            Pegá las partidas del presupuesto para verificar la suma y obtener las preguntas
            correctas para hacerle al taller.
          </p>
        </div>

        {/* Rate limit error */}
        {pageState.kind === 'rate_limit' && (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-800">
              Límite de consultas alcanzado. {pageState.message}
            </p>
            <button
              type="button"
              onClick={resetAll}
              className="mt-2 text-sm text-amber-700 underline hover:no-underline"
            >
              Volver al formulario
            </button>
          </div>
        )}

        {/* Generic error */}
        {pageState.kind === 'error' && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-medium text-red-700">{pageState.message}</p>
            <button
              type="button"
              onClick={resetAll}
              className="mt-2 text-sm text-red-600 underline hover:no-underline"
            >
              Volver al formulario
            </button>
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
            <button
              type="button"
              onClick={resetAll}
              className="rounded-xl border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-text hover:bg-brand-bg transition-colors"
            >
              Volver a intentar
            </button>
          </div>
        )}

        {/* Form */}
        {(pageState.kind === 'form' || pageState.kind === 'loading') && (
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Budget text */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="budgetText" className="block text-sm font-medium text-brand-text">
                  Partidas del presupuesto{' '}
                  <span className="text-red-500" aria-hidden="true">*</span>
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
              <textarea
                id="budgetText"
                name="budgetText"
                required
                aria-required="true"
                aria-describedby={fieldErrors.budgetText ? budgetErrorId : undefined}
                rows={7}
                minLength={10}
                maxLength={2000}
                placeholder={'Ej:\nPastillas de freno delanteras: 8500\nMano de obra: 3000\nTotal: 11500'}
                value={form.budgetText}
                onChange={(e) => updateField('budgetText', e.target.value)}
                disabled={isLoading}
                className={`${inputClass} font-mono resize-y`}
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
                <span className="text-xs text-brand-text-light flex-shrink-0">
                  {form.budgetText.length}/2000
                </span>
              </div>
            </div>

            {/* Optional vehicle fields */}
            <fieldset className="space-y-4">
              <legend className="text-sm font-medium text-brand-text-muted">
                Datos del vehículo (opcional)
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="make" className="block text-xs font-medium text-brand-text-muted mb-1.5">
                    Marca
                  </label>
                  <input
                    id="make"
                    name="make"
                    type="text"
                    placeholder="Ej: Toyota"
                    value={form.make}
                    onChange={(e) => updateField('make', e.target.value)}
                    disabled={isLoading}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="model" className="block text-xs font-medium text-brand-text-muted mb-1.5">
                    Modelo
                  </label>
                  <input
                    id="model"
                    name="model"
                    type="text"
                    placeholder="Ej: Corolla"
                    value={form.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    disabled={isLoading}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="year" className="block text-xs font-medium text-brand-text-muted mb-1.5">
                    Año
                  </label>
                  <input
                    id="year"
                    name="year"
                    type="number"
                    min={1900}
                    max={2100}
                    placeholder="Ej: 2015"
                    value={form.year}
                    onChange={(e) => updateField('year', e.target.value)}
                    disabled={isLoading}
                    aria-describedby={fieldErrors.year ? yearErrorId : undefined}
                    className={inputClass}
                  />
                  {fieldErrors.year && (
                    <p id={yearErrorId} role="alert" className="mt-1.5 text-xs text-red-600">
                      {fieldErrors.year}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="vehicleType" className="block text-xs font-medium text-brand-text-muted mb-1.5">
                    Tipo de vehículo
                  </label>
                  <select
                    id="vehicleType"
                    name="vehicleType"
                    value={form.vehicleType}
                    onChange={(e) => updateField('vehicleType', e.target.value as VehicleType | '')}
                    disabled={isLoading}
                    className={selectClass}
                  >
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
          </form>
        )}

        {/* Loading skeleton */}
        {pageState.kind === 'loading' && (
          <div aria-live="polite" aria-label="Cargando análisis" className="space-y-3 animate-pulse">
            <div className="h-4 bg-brand-bg-alt rounded-lg w-3/4" />
            <div className="h-4 bg-brand-bg-alt rounded-lg w-1/2" />
            <div className="h-4 bg-brand-bg-alt rounded-lg w-5/6" />
            <div className="h-4 bg-brand-bg-alt rounded-lg w-2/3" />
          </div>
        )}

        {/* Success: report */}
        {pageState.kind === 'success' && (
          <div className="space-y-6">
            <ReportView report={pageState.report} />
            <button
              type="button"
              onClick={resetAll}
              className="rounded-xl border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-text hover:bg-brand-bg transition-colors"
            >
              Nueva consulta
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
