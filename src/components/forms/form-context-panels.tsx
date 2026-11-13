'use client'

/**
 * form-context-panels.tsx — Secondary column of the demo forms (Incremento 6.7). Presentation only.
 *
 * Content rules: explains how the data is used, summarizes what the person entered and gives
 * writing tips. It never contains diagnoses, mechanical instructions or claims about results.
 * On desktop it sits next to the form (sticky only from lg up); on mobile it goes below the form.
 */
import { PrivacyNotice } from '@/components/privacy-notice'
import { SectionCard } from '@/components/results/report-parts'

export const FORM_CONTAINER = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8'
/** Form ≈ 67 % / context ≈ 33 % on desktop; one column below lg. */
export const FORM_GRID = 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start'
export const ASIDE_CLS = 'min-w-0 space-y-4 lg:sticky lg:top-6'

export interface VehicleSummaryValues {
  vehicleType?: string
  make?: string
  model?: string
  year?: string
  fuelType?: string
}

export function VehicleStepPanel({ values }: { values: VehicleSummaryValues }) {
  const rows: Array<[string, string | undefined, boolean]> = [
    ['Tipo', values.vehicleType, true],
    ['Marca', values.make, false],
    ['Modelo', values.model, false],
    ['Año', values.year, false],
    ['Combustible', values.fuelType, false],
  ]
  return (
    <aside className={ASIDE_CLS} aria-label="Ayuda del paso: Mi vehículo" data-testid="form-context">
      <SectionCard id="vehicle-summary-heading" title="Tu selección">
        <dl className="space-y-2 text-sm" aria-live="polite">
          {rows.map(([label, value, required]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 border-b border-brand-border-light pb-2 last:border-0 last:pb-0">
              <dt className="text-brand-text-muted">
                {label}
                {required && <span className="sr-only"> (obligatorio)</span>}
              </dt>
              <dd className={`min-w-0 break-words text-right ${value ? 'font-medium text-brand-text' : 'text-brand-text-light'}`}>
                {value || (required ? 'Falta elegir' : 'Sin completar')}
              </dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      <SectionCard id="vehicle-usage-heading" title="Cómo usamos estos datos" tone="muted">
        <p className="text-sm leading-relaxed text-brand-text">
          Sirven para ajustar las hipótesis de esta consulta al tipo de vehículo. No necesitás registrarte.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-brand-text-muted">
          Sólo el tipo de vehículo es obligatorio. Marca, modelo, año y combustible son opcionales: si no los sabés, podés seguir igual.
        </p>
      </SectionCard>
    </aside>
  )
}

const TIPS: Array<{ title: string; example: string }> = [
  { title: 'Qué notás', example: 'un ruido, una vibración, un olor o una luz del tablero' },
  { title: 'Cuándo pasa', example: 'en frío, al frenar, al acelerar o a cierta velocidad' },
  { title: 'Desde cuándo', example: 'si empezó de golpe o fue aumentando' },
  { title: 'Qué lo cambia', example: 'si mejora, empeora o desaparece en alguna situación' },
]

export function SymptomStepPanel() {
  return (
    <aside className={ASIDE_CLS} aria-label="Ayuda del paso: El síntoma" data-testid="form-context">
      <SectionCard id="symptom-tips-heading" title="Cómo describirlo mejor">
        <ul className="space-y-3">
          {TIPS.map((t) => (
            <li key={t.title} className="text-sm leading-relaxed">
              <span className="font-semibold text-brand-text">{t.title}:</span>{' '}
              <span className="text-brand-text-muted">{t.example}.</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-xl bg-brand-bg px-3 py-2.5 text-sm italic leading-relaxed text-brand-text-muted">
          Ejemplo: «Chilla al frenar en bajada desde hace una semana».
        </p>
      </SectionCard>

      {/* Desktop: the privacy notice lives here. Mobile shows it inside the form, before the button. */}
      <div className="hidden lg:block">
        <PrivacyNotice />
      </div>
    </aside>
  )
}
