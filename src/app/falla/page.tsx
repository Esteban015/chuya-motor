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
type FuelType = NonNullable<ApiVehicleInput['fuelType']>
type ExperienceLevel = NonNullable<AnalyzeRequest['experienceLevel']>

type PageState =
  | { kind: 'form' }
  | { kind: 'loading' }
  | { kind: 'success'; report: ClientAnalyzeOutput }
  | { kind: 'safety'; payload: SafetyBlockPayload }
  | { kind: 'rate_limit'; message: string }
  | { kind: 'error'; message: string }

interface FormValues {
  vehicleType: VehicleType | ''
  symptomText: string
  occurrence: string
  make: string
  model: string
  year: string
  fuelType: FuelType | ''
  experienceLevel: ExperienceLevel | ''
}

const INITIAL_FORM: FormValues = {
  vehicleType: '',
  symptomText: '',
  occurrence: '',
  make: '',
  model: '',
  year: '',
  fuelType: '',
  experienceLevel: '',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FallaPage() {
  const [form, setForm] = useState<FormValues>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({})
  const [pageState, setPageState] = useState<PageState>({ kind: 'form' })

  const symptomErrorId = useId()
  const occurrenceErrorId = useId()
  const vehicleTypeErrorId = useId()
  const yearErrorId = useId()

  function updateField<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof FormValues, string>> = {}
    if (!form.vehicleType) errors.vehicleType = 'Seleccioná el tipo de vehículo.'
    if (!form.occurrence) errors.occurrence = 'Seleccioná cuándo ocurre el problema.'
    if (form.symptomText.trim().length < 10) errors.symptomText = 'Describí el síntoma con al menos 10 caracteres.'
    if (form.symptomText.trim().length > 1500) errors.symptomText = 'El síntoma no puede superar los 1500 caracteres.'
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

    const userText = `${form.symptomText.trim()}. Condición de ocurrencia: ${form.occurrence}.`
    const vehicle: ApiVehicleInput = {}
    if (form.vehicleType) vehicle.vehicleType = form.vehicleType as VehicleType
    if (form.make.trim()) vehicle.make = form.make.trim()
    if (form.model.trim()) vehicle.model = form.model.trim()
    if (form.year) vehicle.year = Number(form.year)
    if (form.fuelType) vehicle.fuelType = form.fuelType as FuelType

    const body: AnalyzeRequest = { userText }
    if (Object.keys(vehicle).length > 0) body.vehicle = vehicle
    if (form.experienceLevel) body.experienceLevel = form.experienceLevel as ExperienceLevel

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
        setFieldErrors({ symptomText: data.message })
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
          <h1 className="text-2xl font-bold text-brand-text font-display">Tengo una falla</h1>
          <p className="mt-1 text-sm text-brand-text-muted leading-relaxed">
            Describí el síntoma y obtendrás hipótesis orientativas para hablar con tu mecánico.
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
              severity={pageState.payload.severity ?? null}
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
            {/* Vehicle type */}
            <div>
              <label htmlFor="vehicleType" className="block text-sm font-medium text-brand-text mb-1.5">
                Tipo de vehículo <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <select
                id="vehicleType"
                name="vehicleType"
                required
                aria-required="true"
                aria-describedby={fieldErrors.vehicleType ? vehicleTypeErrorId : undefined}
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
              {fieldErrors.vehicleType && (
                <p id={vehicleTypeErrorId} role="alert" className="mt-1.5 text-xs text-red-600">
                  {fieldErrors.vehicleType}
                </p>
              )}
            </div>

            {/* Symptom text */}
            <div>
              <label htmlFor="symptomText" className="block text-sm font-medium text-brand-text mb-1.5">
                Describí el síntoma principal{' '}
                <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <textarea
                id="symptomText"
                name="symptomText"
                required
                aria-required="true"
                aria-describedby={fieldErrors.symptomText ? symptomErrorId : undefined}
                rows={4}
                minLength={10}
                maxLength={1500}
                placeholder="Ej: Escucho un golpeteo en el motor cuando acelero, especialmente en frío."
                value={form.symptomText}
                onChange={(e) => updateField('symptomText', e.target.value)}
                disabled={isLoading}
                className={`${inputClass} resize-y`}
              />
              <div className="mt-1.5 flex items-start justify-between gap-2">
                <div>
                  {fieldErrors.symptomText && (
                    <p id={symptomErrorId} role="alert" className="text-xs text-red-600">
                      {fieldErrors.symptomText}
                    </p>
                  )}
                </div>
                <span className="text-xs text-brand-text-light flex-shrink-0">
                  {form.symptomText.length}/1500
                </span>
              </div>
            </div>

            {/* Occurrence */}
            <div>
              <label htmlFor="occurrence" className="block text-sm font-medium text-brand-text mb-1.5">
                ¿Cuándo ocurre?{' '}
                <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <select
                id="occurrence"
                name="occurrence"
                required
                aria-required="true"
                aria-describedby={fieldErrors.occurrence ? occurrenceErrorId : undefined}
                value={form.occurrence}
                onChange={(e) => updateField('occurrence', e.target.value)}
                disabled={isLoading}
                className={selectClass}
              >
                <option value="">Seleccioná...</option>
                <option value="Siempre">Siempre</option>
                <option value="Al frenar">Al frenar</option>
                <option value="Al acelerar">Al acelerar</option>
                <option value="Al arrancar">Al arrancar</option>
                <option value="Intermitente">Intermitente</option>
                <option value="Otro">Otro</option>
              </select>
              {fieldErrors.occurrence && (
                <p id={occurrenceErrorId} role="alert" className="mt-1.5 text-xs text-red-600">
                  {fieldErrors.occurrence}
                </p>
              )}
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
                  <label htmlFor="fuelType" className="block text-xs font-medium text-brand-text-muted mb-1.5">
                    Combustible
                  </label>
                  <select
                    id="fuelType"
                    name="fuelType"
                    value={form.fuelType}
                    onChange={(e) => updateField('fuelType', e.target.value as FuelType | '')}
                    disabled={isLoading}
                    className={selectClass}
                  >
                    <option value="">Seleccioná...</option>
                    <option value="gasoline">Nafta</option>
                    <option value="diesel">Diésel</option>
                    <option value="gnc">GNC</option>
                    <option value="hybrid">Híbrido</option>
                    <option value="electric">Eléctrico</option>
                    <option value="other">Otro</option>
                  </select>
                </div>
              </div>
            </fieldset>

            {/* Experience level */}
            <div>
              <label htmlFor="experienceLevel" className="block text-sm font-medium text-brand-text mb-1.5">
                Nivel de experiencia (opcional)
              </label>
              <select
                id="experienceLevel"
                name="experienceLevel"
                value={form.experienceLevel}
                onChange={(e) => updateField('experienceLevel', e.target.value as ExperienceLevel | '')}
                disabled={isLoading}
                className={selectClass}
              >
                <option value="">Seleccioná...</option>
                <option value="unknown">Desconozco</option>
                <option value="novice">Principiante</option>
                <option value="intermediate">Intermedio</option>
                <option value="experienced">Con experiencia</option>
              </select>
            </div>

            <PrivacyNotice />

            <button
              type="submit"
              disabled={isLoading}
              aria-busy={isLoading}
              className="w-full rounded-xl bg-brand-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-primary-light focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? 'Analizando...' : 'Analizar síntoma'}
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
