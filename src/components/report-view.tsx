'use client'

import type { ClientAnalyzeOutput, ClientBudgetOutput } from '@/app/api/analyze/schema'
import { DemoBadge } from '@/components/demo-badge'
import { FallbackAlert } from '@/components/fallback-alert'
import { TraceViewer } from '@/components/trace-viewer'

interface ReportViewProps {
  report: ClientAnalyzeOutput
}

function confidenceBadge(confidence: 'low' | 'medium' | 'high') {
  const map = {
    low: 'inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-300',
    medium:
      'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-300',
    high: 'inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-300',
  } as const
  const labels = { low: 'Baja', medium: 'Media', high: 'Alta' } as const
  return { className: map[confidence], label: labels[confidence] }
}

function statusPill(status: ClientBudgetOutput['completenessStatus']) {
  const map = {
    COMPLETE:
      'inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 ring-1 ring-green-300',
    PARTIAL:
      'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-300',
    INVALID:
      'inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-300',
  } as const
  return map[status]
}

function formatAmountFromMinorUnit(minorUnit: number, currency: string | null): string {
  const amount = minorUnit / 100
  return amount.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + (currency ? ` ${currency}` : '')
}


export function ReportView({ report }: ReportViewProps) {
  return (
    <div className="space-y-6">
      {/* Always-visible demo badge */}
      <div>
        <DemoBadge />
      </div>

      {/* Fallback alert (shown if present, but content below still renders) */}
      {report.fallback && (
        <FallbackAlert fallbackText={report.fallbackText} />
      )}

      {/* Facts section */}
      {report.facts.length > 0 && (
        <section aria-labelledby="facts-heading">
          <h2 id="facts-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Lo que declaraste
          </h2>
          <ul className="space-y-1 list-disc list-inside text-sm text-gray-700">
            {report.facts.map((fact, i) => (
              <li key={i}>{fact}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Hypotheses section */}
      {report.hypotheses.length > 0 && (
        <section aria-labelledby="hypotheses-heading">
          <h2 id="hypotheses-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Hipótesis orientativas
          </h2>
          <div className="space-y-3">
            {report.hypotheses.map((h, i) => {
              const badge = confidenceBadge(h.confidence)
              return (
                <div
                  key={i}
                  className="rounded-lg border border-gray-200 bg-white p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold text-gray-800 text-sm">{h.statement}</p>
                    <span className={badge.className}>
                      Confianza: {badge.label}
                    </span>
                  </div>
                  {h.caveats.length > 0 && (
                    <ul className="space-y-0.5">
                      {h.caveats.map((caveat, ci) => (
                        <li key={ci} className="text-xs text-gray-500 italic">
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

      {/* Missing information section */}
      {report.missingInformation.length > 0 && (
        <section aria-labelledby="missing-heading">
          <h2 id="missing-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Información faltante
          </h2>
          <ul className="space-y-1">
            {report.missingInformation.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                <span aria-hidden="true" className="text-amber-500 flex-shrink-0">⚠</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Budget section */}
      {report.budget && report.route === 'budget' && (
        <section aria-labelledby="budget-heading">
          <h2 id="budget-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Análisis del presupuesto
          </h2>
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span>Estado:</span>
              <span className={statusPill(report.budget.completenessStatus)}>
                {report.budget.completenessStatus}
              </span>
            </div>

            {report.budget.computedTotalMinorUnit !== null && (
              <p className="text-sm text-gray-700">
                <span className="font-medium">Total calculado:</span>{' '}
                {formatAmountFromMinorUnit(report.budget.computedTotalMinorUnit, report.budget.currency)}
              </p>
            )}

            {report.budget.discrepancy === true && (
              <p className="flex items-center gap-1 text-sm font-medium text-red-600">
                <span aria-hidden="true">⚠</span>
                El total declarado no coincide con la suma calculada
              </p>
            )}

            {report.budget.discrepancy === false && (
              <p className="flex items-center gap-1 text-sm font-medium text-green-600">
                <span aria-hidden="true">✓</span>
                El total declarado coincide
              </p>
            )}

            {report.budget.computedTotalIsPartial && (
              <p className="text-sm text-amber-700">
                Subtotal parcial — hay partidas sin importe confirmado
              </p>
            )}

            <div className="flex gap-4 text-xs text-gray-500">
              <span>Partidas: {report.budget.lineCount}</span>
              {report.budget.missingLineCount > 0 && (
                <span>Sin importe: {report.budget.missingLineCount}</span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Warnings section */}
      {report.warnings.length > 0 && (
        <section aria-labelledby="warnings-heading">
          <h2 id="warnings-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Advertencias
          </h2>
          <ul className="space-y-2">
            {report.warnings.map((w, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
              >
                <span aria-hidden="true" className="flex-shrink-0">⚠</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Questions section */}
      {report.questions.length > 0 && (
        <section aria-labelledby="questions-heading">
          <h2 id="questions-heading" className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Preguntas para el taller
          </h2>
          <ol className="space-y-2 list-decimal list-inside">
            {report.questions.map((q, i) => (
              <li key={i} className="text-sm text-gray-700">
                {q}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Coverage disclaimer — always at bottom */}
      <p className="text-xs italic text-gray-400 border-t border-gray-100 pt-4">
        {report.coverageDisclaimer}
      </p>

      {/* DEV trace section — only rendered when server sends trace data (dev mode) */}
      {report.nodeTrace !== null && (
        <TraceViewer traces={report.nodeTrace} />
      )}
    </div>
  )
}
