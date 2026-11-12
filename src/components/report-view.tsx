'use client'

import type { ClientAnalyzeOutput, ClientBudgetOutput } from '@/app/api/analyze/schema'
import { AiStatusBadge } from '@/components/ai-status-badge'
import { FallbackAlert } from '@/components/fallback-alert'
import { SeverityBanner } from '@/components/severity-banner'
import { TraceViewer } from '@/components/trace-viewer'

interface ReportViewProps {
  report: ClientAnalyzeOutput
}

function confidenceBadge(confidence: 'low' | 'medium' | 'high') {
  const styles = {
    low: 'inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-brand-text-muted ring-1 ring-brand-border',
    medium:
      'inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200',
    high: 'inline-flex items-center rounded-full bg-brand-primary-tint px-2 py-0.5 text-xs font-medium text-brand-primary ring-1 ring-brand-primary/20',
  } as const
  const labels = { low: 'Baja', medium: 'Media', high: 'Alta' } as const
  return { className: styles[confidence], label: labels[confidence] }
}

function statusPill(status: ClientBudgetOutput['completenessStatus']) {
  const styles = {
    COMPLETE:
      'inline-flex items-center rounded-full bg-brand-primary-tint px-2 py-0.5 text-xs font-semibold text-brand-primary ring-1 ring-brand-primary/20',
    PARTIAL:
      'inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200',
    INVALID:
      'inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600 ring-1 ring-red-200',
  } as const
  return styles[status]
}

function formatAmountFromMinorUnit(minorUnit: number, currency: string | null): string {
  const amount = minorUnit / 100
  return amount.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + (currency ? ` ${currency}` : '')
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="text-xs font-semibold text-brand-text-muted uppercase tracking-widest mb-3"
    >
      {children}
    </h2>
  )
}

export function ReportView({ report }: ReportViewProps) {
  return (
    <div className="space-y-5">
      {/* 6.4E: badge from what actually processed this request (server-side aiStatus) */}
      {report.aiStatus && report.aiStatus.mode !== 'none' && (
        <div className="flex justify-start">
          <AiStatusBadge status={report.aiStatus} />
        </div>
      )}

      {/* Fallback alert */}
      {report.fallback && (
        <FallbackAlert fallbackText={report.fallbackText} aiStatus={report.aiStatus} />
      )}

      {/* Severity banner — before hypotheses */}
      {report.severity && (
        <SeverityBanner severity={report.severity} />
      )}

      {/* Facts */}
      {report.facts.length > 0 && (
        <section aria-labelledby="facts-heading">
          <SectionHeading id="facts-heading">Lo que declaraste</SectionHeading>
          <ul className="space-y-1.5">
            {report.facts.map((fact, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-brand-text leading-relaxed"
              >
                <span
                  aria-hidden="true"
                  className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-brand-accent-dark"
                />
                {fact}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Hypotheses */}
      {report.hypotheses.length > 0 && (
        <section aria-labelledby="hypotheses-heading" data-testid="hypotheses">
          <SectionHeading id="hypotheses-heading">Hipótesis orientativas</SectionHeading>
          <div className="space-y-3">
            {report.hypotheses.map((h, i) => {
              const badge = confidenceBadge(h.confidence)
              return (
                <div
                  key={i}
                  className="rounded-xl border border-brand-border-light bg-white p-4 shadow-brand-xs space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-brand-text text-sm leading-relaxed">{h.statement}</p>
                    <span className={badge.className}>Confianza: {badge.label}</span>
                  </div>
                  {h.caveats.length > 0 && (
                    <ul className="space-y-0.5 pl-0">
                      {h.caveats.map((caveat, ci) => (
                        <li key={ci} className="text-xs text-brand-text-muted italic leading-relaxed">
                          {caveat}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Missing information */}
      {report.missingInformation.length > 0 && (
        <section aria-labelledby="missing-heading">
          <SectionHeading id="missing-heading">Información faltante</SectionHeading>
          <ul className="space-y-1.5">
            {report.missingInformation.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-brand-text-muted leading-relaxed">
                <span aria-hidden="true" className="text-amber-500 flex-shrink-0 mt-0.5">⚠</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Budget */}
      {report.budget && report.route === 'budget' && (
        <section aria-labelledby="budget-heading">
          <SectionHeading id="budget-heading">Análisis del presupuesto</SectionHeading>
          <div className="rounded-xl border border-brand-border-light bg-white p-4 shadow-brand-xs space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-brand-text-muted">Estado:</span>
              <span className={statusPill(report.budget.completenessStatus)}>
                {report.budget.completenessStatus}
              </span>
            </div>

            {report.budget.computedTotalMinorUnit !== null && (
              <p className="text-sm text-brand-text">
                <span className="font-medium">Total calculado:</span>{' '}
                {formatAmountFromMinorUnit(report.budget.computedTotalMinorUnit, report.budget.currency)}
              </p>
            )}

            {report.budget.discrepancy === true && (
              <p className="flex items-center gap-1.5 text-sm font-medium text-red-600">
                <span aria-hidden="true">⚠</span>
                El total declarado no coincide con la suma calculada
              </p>
            )}

            {report.budget.discrepancy === false && (
              <p className="flex items-center gap-1.5 text-sm font-medium text-brand-primary">
                <span aria-hidden="true">✓</span>
                El total declarado coincide
              </p>
            )}

            {report.budget.computedTotalIsPartial && (
              <p className="text-sm text-amber-700">
                Subtotal parcial — hay partidas sin importe confirmado
              </p>
            )}

            <div className="flex gap-4 text-xs text-brand-text-light border-t border-brand-border-light pt-2 mt-1">
              <span>Partidas: <strong className="text-brand-text-muted">{report.budget.lineCount}</strong></span>
              {report.budget.missingLineCount > 0 && (
                <span>Sin importe: <strong className="text-brand-text-muted">{report.budget.missingLineCount}</strong></span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <section aria-labelledby="warnings-heading">
          <SectionHeading id="warnings-heading">Advertencias</SectionHeading>
          <ul className="space-y-2">
            {report.warnings.map((w, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 leading-relaxed"
              >
                <span aria-hidden="true" className="flex-shrink-0 mt-0.5">⚠</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Questions */}
      {report.questions.length > 0 && (
        <section aria-labelledby="questions-heading">
          <SectionHeading id="questions-heading">Preguntas para el taller</SectionHeading>
          <ol className="space-y-2">
            {report.questions.map((q, i) => (
              <li
                key={i}
                className="flex items-start gap-3 text-sm text-brand-text leading-relaxed"
              >
                <span
                  aria-hidden="true"
                  className="flex-shrink-0 font-semibold text-brand-primary font-display text-xs mt-0.5 w-5 text-right"
                >
                  {i + 1}.
                </span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Disclaimer */}
      <p className="text-xs italic text-brand-text-light border-t border-brand-border-light pt-4 leading-relaxed">
        {report.coverageDisclaimer}
      </p>

      {/* DEV trace viewer */}
      {report.nodeTrace !== null && (
        <TraceViewer traces={report.nodeTrace} />
      )}
    </div>
  )
}
