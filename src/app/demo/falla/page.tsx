'use client'

import { useState, useId } from 'react'
import Link from 'next/link'
import type {
  AnalyzeRequest,
  ApiVehicleInput,
  ClientAnalyzeOutput,
  SafetyBlockPayload,
} from '@/app/api/analyze/schema'
import { StepIndicator } from '@/components/step-indicator'
import { SiteModeBadge } from '@/components/ai-status-badge'
import { PrivacyNotice } from '@/components/privacy-notice'
import { SafetyAlert } from '@/components/safety-alert'
import { SymptomReport } from '@/components/results/symptom-report'
import { RESULTS_CONTAINER } from '@/components/results/report-parts'

// ── Types ────────────────────────────────────────────────────────────────────

type VehicleType = NonNullable<ApiVehicleInput['vehicleType']>
type FuelType = NonNullable<ApiVehicleInput['fuelType']>
type ExperienceLevel = NonNullable<AnalyzeRequest['experienceLevel']>

type PageState =
  | { kind: 'form'; step: 1 | 2 }
  | { kind: 'loading' }
  | { kind: 'success'; report: ClientAnalyzeOutput }
  | { kind: 'safety'; payload: SafetyBlockPayload }
  | { kind: 'rate_limit'; message: string }
  | { kind: 'error'; message: string }

interface FormValues {
  vehicleType: VehicleType | ''
  make: string
  model: string
  year: string
  fuelType: FuelType | ''
  symptomText: string
  occurrence: string
  experienceLevel: ExperienceLevel | ''
}

const INITIAL_FORM: FormValues = {
  vehicleType: '',
  make: '',
  model: '',
  year: '',
  fuelType: '',
  symptomText: '',
  occurrence: '',
  experienceLevel: '',
}

const WIZARD_STEPS = ['Mi vehículo', 'El síntoma', 'Resultado'] as const

const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  sedan: 'Automóvil (sedan)',
  hatchback: 'Hatchback',
  suv: 'SUV / Camioneta 4x4',
  pickup: 'Pick-up',
  van: 'Furgoneta / Van',
  motorcycle: 'Moto',
  other: 'Otro',
}

const FUEL_LABEL: Record<FuelType, string> = {
  gasoline: 'Nafta',
  diesel: 'Diésel',
  gnc: 'GNC',
  hybrid: 'Híbrido',
  electric: 'Eléctrico',
  other: 'Otro',
}

const SYMPTOM_EXAMPLES = [
  'El motor hace un ruido extraño al arrancar en frío.',
  'Escucho un golpeteo cuando acelero en cuesta.',
  'Se enciende la luz de check engine intermitente.',
  'La dirección vibra a partir de 80 km/h.',
]

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-xl border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text placeholder-brand-text-light focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:opacity-50 transition-colors'

const selectCls =
  'w-full rounded-xl border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20 disabled:opacity-50 transition-colors'

// ── Component ─────────────────────────────────────────────────────────────────

export default function DemoFallaPage() {
  const [form, setForm] = useState<FormValues>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormValues, string>>>({})
  const [pageState, setPageState] = useState<PageState>({ kind: 'form', step: 1 })

  const symptomErrorId = useId()
  const occurrenceErrorId = useId()
  const vehicleTypeErrorId = useId()
  const yearErrorId = useId()

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  function validateStep1(): boolean {
    const errors: Partial<Record<keyof FormValues, string>> = {}
    if (!form.vehicleType) errors.vehicleType = 'Seleccioná el tipo de vehículo.'
    if (form.year) {
      const y = Number(form.year)
      if (isNaN(y) || y < 1900 || y > 2100) errors.year = 'El año debe estar entre 1900 y 2100.'
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function validateStep2(): boolean {
    const errors: Partial<Record<keyof FormValues, string>> = {}
    if (!form.occurrence) errors.occurrence = 'Seleccioná cuándo ocurre el problema.'
    if (form.symptomText.trim().length < 10)
      errors.symptomText = 'Describí el síntoma con al menos 10 caracteres.'
    if (form.symptomText.trim().length > 1500)
      errors.symptomText = 'El síntoma no puede superar los 1500 caracteres.'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function goToStep2() {
    if (validateStep1()) setPageState({ kind: 'form', step: 2 })
  }

  function goToStep1() {
    setFieldErrors({})
    setPageState({ kind: 'form', step: 1 })
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!validateStep2()) return
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
        setPageState({ kind: 'form', step: 2 })
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
    setPageState({ kind: 'form', step: 1 })
  }

  const indicatorStep: 1 | 2 | 3 =
    pageState.kind === 'form' ? pageState.step : 3

  // 6.6: the result uses the wide layout; the wizard keeps a comfortable narrow column.
  const isResult = pageState.kind === 'success'
  const container = isResult ? `${RESULTS_CONTAINER} pt-6 pb-16 sm:pt-8` : 'max-w-2xl mx-auto px-4 pt-8 pb-16 space-y-6'

  return (
    <main className="min-h-screen bg-brand-bg">

      {/* Header */}
      <header className="bg-white border-b border-brand-border-light px-6">
        <div className="max-w-7xl mx-auto h-14 flex items-center justify-between gap-4">
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
          {/* The result shows the badge of the provider that really answered: not repeated here. */}
          {!isResult && <SiteModeBadge />}
        </div>
      </header>

      {/* Wizard / result container */}
      <div className={container}>

        {/* Step indicator */}
        {(pageState.kind === 'form' || pageState.kind === 'loading') && (
          <div className="bg-white rounded-2xl border border-brand-border-light px-6 py-4">
            <StepIndicator current={indicatorStep} steps={WIZARD_STEPS} />
          </div>
        )}

        {/* ── Step 1: Mi vehículo ───────────────────────────────────────── */}
        {pageState.kind === 'form' && pageState.step === 1 && (
          <div className="bg-white rounded-2xl border border-brand-border-light overflow-hidden animate-fade-in">
            <div className="px-6 pt-6 pb-4 border-b border-brand-border-light">
              <h1 className="text-xl font-extrabold text-brand-text font-display">Mi vehículo</h1>
              <p className="mt-1 text-sm text-brand-text-muted">
                Estos datos ayudan a ajustar el análisis al tipo de auto.
              </p>
            </div>
            <div className="px-6 py-6 space-y-5">

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
                  onChange={(e) => update('vehicleType', e.target.value as VehicleType | '')}
                  className={selectCls}
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

              <fieldset className="space-y-4">
                <legend className="text-sm font-medium text-brand-text-muted">Datos opcionales</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="make" className="block text-xs font-medium text-brand-text-muted mb-1.5">Marca</label>
                    <input id="make" name="make" type="text" placeholder="Ej: Toyota" value={form.make} onChange={(e) => update('make', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="model" className="block text-xs font-medium text-brand-text-muted mb-1.5">Modelo</label>
                    <input id="model" name="model" type="text" placeholder="Ej: Corolla" value={form.model} onChange={(e) => update('model', e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="year" className="block text-xs font-medium text-brand-text-muted mb-1.5">Año</label>
                    <input
                      id="year" name="year" type="number" min={1900} max={2100}
                      placeholder="Ej: 2015" value={form.year}
                      onChange={(e) => update('year', e.target.value)}
                      aria-describedby={fieldErrors.year ? yearErrorId : undefined}
                      className={inputCls}
                    />
                    {fieldErrors.year && (
                      <p id={yearErrorId} role="alert" className="mt-1.5 text-xs text-red-600">{fieldErrors.year}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="fuelType" className="block text-xs font-medium text-brand-text-muted mb-1.5">Combustible</label>
                    <select id="fuelType" name="fuelType" value={form.fuelType} onChange={(e) => update('fuelType', e.target.value as FuelType | '')} className={selectCls}>
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

              <div className="pt-2">
                <button
                  type="button"
                  onClick={goToStep2}
                  className="w-full rounded-xl bg-brand-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-primary-light focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
                >
                  Siguiente →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: El síntoma ─────────────────────────────────────────── */}
        {pageState.kind === 'form' && pageState.step === 2 && (
          <form onSubmit={handleSubmit} noValidate className="bg-white rounded-2xl border border-brand-border-light overflow-hidden animate-fade-in">
            <div className="px-6 pt-6 pb-4 border-b border-brand-border-light">
              <h1 className="text-xl font-extrabold text-brand-text font-display">El síntoma</h1>
              <p className="mt-1 text-sm text-brand-text-muted">
                Describí lo que hace el auto con tus propias palabras.
              </p>
            </div>
            <div className="px-6 py-6 space-y-5">

              <div>
                <p className="text-xs font-medium text-brand-text-muted mb-2">Ejemplos frecuentes</p>
                <div className="flex flex-wrap gap-2">
                  {SYMPTOM_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => update('symptomText', ex)}
                      className="rounded-lg border border-brand-border bg-brand-bg px-3 py-1.5 text-xs text-brand-text-muted hover:border-brand-primary hover:text-brand-primary transition-colors"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="symptomText" className="block text-sm font-medium text-brand-text mb-1.5">
                  Describí el síntoma <span className="text-red-500" aria-hidden="true">*</span>
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
                  onChange={(e) => update('symptomText', e.target.value)}
                  className={`${inputCls} resize-y`}
                />
                <div className="mt-1.5 flex items-start justify-between gap-2">
                  <div>
                    {fieldErrors.symptomText && (
                      <p id={symptomErrorId} role="alert" className="text-xs text-red-600">
                        {fieldErrors.symptomText}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-brand-text-light flex-shrink-0">{form.symptomText.length}/1500</span>
                </div>
              </div>

              <div>
                <label htmlFor="occurrence" className="block text-sm font-medium text-brand-text mb-1.5">
                  ¿Cuándo ocurre? <span className="text-red-500" aria-hidden="true">*</span>
                </label>
                <select
                  id="occurrence"
                  name="occurrence"
                  required
                  aria-required="true"
                  aria-describedby={fieldErrors.occurrence ? occurrenceErrorId : undefined}
                  value={form.occurrence}
                  onChange={(e) => update('occurrence', e.target.value)}
                  className={selectCls}
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

              <div>
                <label htmlFor="experienceLevel" className="block text-sm font-medium text-brand-text mb-1.5">
                  Nivel de experiencia (opcional)
                </label>
                <select
                  id="experienceLevel"
                  name="experienceLevel"
                  value={form.experienceLevel}
                  onChange={(e) => update('experienceLevel', e.target.value as ExperienceLevel | '')}
                  className={selectCls}
                >
                  <option value="">Seleccioná...</option>
                  <option value="unknown">Desconozco</option>
                  <option value="novice">Principiante</option>
                  <option value="intermediate">Intermedio</option>
                  <option value="experienced">Con experiencia</option>
                </select>
              </div>

              <PrivacyNotice />

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={goToStep1}
                  className="rounded-xl border border-brand-border bg-white px-4 py-3 text-sm font-medium text-brand-text hover:bg-brand-bg transition-colors focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
                >
                  ← Volver
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-brand-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-primary-light focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Analizar síntoma
                </button>
              </div>
            </div>
          </form>
        )}

        {/* ── Loading ────────────────────────────────────────────────────── */}
        {pageState.kind === 'loading' && (
          <div className="bg-white rounded-2xl border border-brand-border-light px-6 py-10 space-y-4">
            <div aria-live="polite" aria-label="Analizando síntoma" className="space-y-3 animate-pulse">
              <div className="h-4 bg-brand-bg-alt rounded-lg w-3/4" />
              <div className="h-4 bg-brand-bg-alt rounded-lg w-1/2" />
              <div className="h-4 bg-brand-bg-alt rounded-lg w-5/6" />
              <div className="h-4 bg-brand-bg-alt rounded-lg w-2/3" />
            </div>
            <p className="text-sm text-brand-text-muted">Analizando síntoma…</p>
          </div>
        )}

        {/* ── Safety block ──────────────────────────────────────────────── */}
        {pageState.kind === 'safety' && (
          <div className="space-y-4">
            <SafetyAlert
              message={pageState.payload.safetyDerivationMessage}
              policyVersion={pageState.payload.policyVersion}
              coverageDisclaimer={pageState.payload.coverageDisclaimer}
              severity={pageState.payload.severity ?? null}
            />
            <button type="button" onClick={resetAll} className="rounded-xl border border-brand-border bg-white px-4 py-2.5 text-sm font-medium text-brand-text hover:bg-brand-bg transition-colors">
              Volver a intentar
            </button>
          </div>
        )}

        {/* ── Rate limit ────────────────────────────────────────────────── */}
        {pageState.kind === 'rate_limit' && (
          <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4">
            <p className="text-sm font-medium text-amber-800">Límite de consultas alcanzado. {pageState.message}</p>
            <button type="button" onClick={resetAll} className="mt-2 text-sm text-amber-700 underline hover:no-underline">Volver al formulario</button>
          </div>
        )}

        {/* ── Generic error ─────────────────────────────────────────────── */}
        {pageState.kind === 'error' && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-6 py-4">
            <p className="text-sm font-medium text-red-700">{pageState.message}</p>
            <button type="button" onClick={resetAll} className="mt-2 text-sm text-red-600 underline hover:no-underline">Volver al formulario</button>
          </div>
        )}

        {/* ── Success ───────────────────────────────────────────────────── */}
        {pageState.kind === 'success' && (
          <div className="animate-fade-in">
            <SymptomReport
              report={pageState.report}
              declared={{
                vehicleType: form.vehicleType ? VEHICLE_TYPE_LABEL[form.vehicleType] : undefined,
                make: form.make.trim() || undefined,
                model: form.model.trim() || undefined,
                year: form.year || undefined,
                fuelType: form.fuelType ? FUEL_LABEL[form.fuelType] : undefined,
                symptomText: form.symptomText.trim(),
                occurrence: form.occurrence || undefined,
              }}
              onNewQuery={resetAll}
            />
          </div>
        )}

      </div>
    </main>
  )
}
