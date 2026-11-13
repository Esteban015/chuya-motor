'use client'

/**
 * symptom-report.tsx — Redesigned symptom result for /demo/falla (Incremento 6.6). UI only.
 *
 * Order (DOM = reading order on every screen size):
 *   header → CRITICAL/HIGH severity banner (full width) → fallback / withheld notice (full width)
 *   → hypotheses + warnings (main) → vehicle, declared facts, missing data, questions (aside)
 *   → actions → coverage disclaimer.
 * On desktop the aside is placed in the left column with CSS grid placement only, so screen
 * readers and mobile keep the most relevant content first. Nothing safety-related is collapsible.
 */
import type { ClientAnalyzeOutput } from '@/app/api/analyze/schema'
import { FallbackAlert } from '@/components/fallback-alert'
import { SeverityBanner } from '@/components/severity-banner'
import { TraceViewer } from '@/components/trace-viewer'
import {
  BulletList,
  ConfidenceIndicator,
  CopyQuestionsButton,
  QuestionList,
  ReportActions,
  ReportHeader,
  SectionCard,
  WarningsList,
} from './report-parts'

export interface DeclaredSymptomInput {
  vehicleType?: string
  make?: string
  model?: string
  year?: string
  fuelType?: string
  symptomText: string
  occurrence?: string
}

export function SymptomReport({
  report,
  declared,
  onNewQuery,
}: {
  report: ClientAnalyzeOutput
  declared: DeclaredSymptomInput
  onNewQuery: () => void
}) {
  const vehicleName = [declared.make, declared.model, declared.year].filter(Boolean).join(' ')
  const hasHypotheses = report.hypotheses.length > 0
  const withheld = report.aiStatus?.mode === 'withheld'
  const title = report.fallback || withheld || !hasHypotheses ? 'Resultado de tu consulta' : 'Tu análisis está listo'

  const vehicleRows = [
    ['Tipo', declared.vehicleType],
    ['Marca', declared.make],
    ['Modelo', declared.model],
    ['Año', declared.year],
    ['Combustible', declared.fuelType],
  ].filter((r): r is [string, string] => Boolean(r[1]))

  return (
    <div className="space-y-6" data-testid="symptom-report">
      <ReportHeader
        eyebrow="Análisis de síntoma · Resultado"
        title={title}
        chips={[
          { label: 'Vehículo', value: vehicleName || declared.vehicleType },
          { label: 'Ocurre', value: declared.occurrence },
        ]}
        summaryLabel="Síntoma"
        summary={declared.symptomText}
        aiStatus={report.aiStatus}
        disclaimer="Orientación automática para conversar con un taller. No es un diagnóstico definitivo ni reemplaza una inspección profesional."
      />

      {/* Safety first: full width, right before the hypotheses, never collapsible. */}
      {report.severity && <SeverityBanner severity={report.severity} />}
      {report.fallback && <FallbackAlert fallbackText={report.fallbackText} aiStatus={report.aiStatus} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        {/* Main column (first in DOM) */}
        <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-1">
          {hasHypotheses && (
            <section aria-labelledby="hypotheses-heading" data-testid="hypotheses" className="space-y-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <h2 id="hypotheses-heading" className="font-display text-xl font-extrabold text-brand-text">
                  Hipótesis orientativas
                </h2>
                <p className="text-xs text-brand-text-muted">Posibilidades a verificar en un taller · la confianza no es una probabilidad</p>
              </div>
              <ol className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {report.hypotheses.map((h, i) => (
                  <li key={i} className="flex flex-col rounded-2xl border border-brand-border-light bg-white p-5 shadow-brand-xs">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-accent font-display text-xs font-bold text-brand-primary"
                      >
                        {i + 1}
                      </span>
                      <h3 className="min-w-0 break-words text-[15px] font-semibold leading-snug text-brand-text">{h.statement}</h3>
                    </div>
                    <div className="mt-3 pl-10">
                      <ConfidenceIndicator confidence={h.confidence} />
                    </div>
                    {h.caveats.length > 0 && (
                      <div className="mt-3 border-t border-brand-border-light pt-3 pl-10">
                        <p className="text-xs font-semibold text-brand-text-muted">Para tener en cuenta</p>
                        <ul className="mt-1.5 space-y-1">
                          {h.caveats.map((c, ci) => (
                            <li key={ci} className="break-words text-sm leading-relaxed text-brand-text-muted">
                              {c}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {report.warnings.length > 0 && (
            <SectionCard id="warnings-heading" title="Advertencias">
              <WarningsList warnings={report.warnings} />
            </SectionCard>
          )}
        </div>

        {/* Context column (left on desktop) */}
        <aside className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1" aria-label="Datos de la consulta">
          {vehicleRows.length > 0 && (
            <SectionCard id="vehicle-heading" title="Tu vehículo" tone="muted">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {vehicleRows.map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-xs text-brand-text-muted">{k}</dt>
                    <dd className="break-words font-medium text-brand-text">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-brand-text-muted">Datos ingresados por vos (no verificados).</p>
            </SectionCard>
          )}

          {report.facts.length > 0 && (
            <SectionCard id="facts-heading" title="Lo que declaraste">
              <BulletList items={report.facts} />
            </SectionCard>
          )}

          {report.missingInformation.length > 0 && (
            <SectionCard id="missing-heading" title="Información faltante">
              <BulletList items={report.missingInformation} tone="warning" />
            </SectionCard>
          )}

          {report.questions.length > 0 && (
            <SectionCard id="questions-heading" title="Preguntas para el taller">
              <QuestionList questions={report.questions} />
              <div className="mt-4 border-t border-brand-border-light pt-3">
                <CopyQuestionsButton questions={report.questions} />
              </div>
            </SectionCard>
          )}
        </aside>
      </div>

      <ReportActions onNewQuery={onNewQuery} />

      <p className="border-t border-brand-border-light pt-4 text-xs italic leading-relaxed text-brand-text-light">{report.coverageDisclaimer}</p>

      {report.nodeTrace !== null && <TraceViewer traces={report.nodeTrace} />}
    </div>
  )
}
