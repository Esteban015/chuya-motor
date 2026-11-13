'use client'

/**
 * budget-report.tsx — Redesigned budget result for /demo/presupuesto (Incremento 6.6). UI only.
 *
 * The API (ClientBudgetOutput) exposes the server's deterministic results: verification status,
 * computed total (and whether it is partial), the discrepancy flag and line counts. It does NOT
 * expose the parsed line items nor the declared total. Therefore:
 *   - the items are shown as the person's own text, labeled as such (never as "detected");
 *   - the declared total and the difference are shown only when they can be read unambiguously
 *     from that text AND agree with the server's discrepancy flag (format.ts → budgetComparison);
 *   - nothing says whether a price is high, low or fair: no market source exists.
 */
import type { ClientAnalyzeOutput, ClientBudgetOutput } from '@/app/api/analyze/schema'
import { FallbackAlert } from '@/components/fallback-alert'
import { SeverityBanner } from '@/components/severity-banner'
import { TraceViewer } from '@/components/trace-viewer'
import { BUDGET_STATUS_LABEL, budgetComparison, formatMoney } from './format'
import { BulletList, CopyQuestionsButton, QuestionList, ReportActions, ReportHeader, SectionCard, WarningsList } from './report-parts'

export interface DeclaredBudgetInput {
  budgetText: string
  vehicleType?: string
  make?: string
  model?: string
  year?: string
}

const STATUS_STYLE: Record<ClientBudgetOutput['completenessStatus'], string> = {
  COMPLETE: 'bg-brand-primary-tint text-brand-primary ring-brand-primary/20',
  PARTIAL: 'bg-amber-50 text-amber-800 ring-amber-200',
  INVALID: 'bg-red-50 text-red-700 ring-red-200',
}

function TotalsPanel({ budget, budgetText }: { budget: ClientBudgetOutput; budgetText: string }) {
  const cmp = budgetComparison(budget, budgetText)
  const money = (v: number) => formatMoney(v, budget.currency)
  return (
    <section aria-labelledby="totals-heading" data-testid="budget-totals" className="rounded-2xl border border-brand-border-light bg-white p-5 shadow-brand-xs sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="totals-heading" className="font-display text-sm font-bold uppercase tracking-wider text-brand-text-muted">
          Verificación de la suma
        </h2>
        <span
          data-status={budget.completenessStatus}
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${STATUS_STYLE[budget.completenessStatus]}`}
        >
          {BUDGET_STATUS_LABEL[budget.completenessStatus]}
        </span>
      </div>

      <dl className="mt-5 space-y-4">
        <div>
          <dt className="text-xs font-medium text-brand-text-muted">Total calculado (suma de partidas)</dt>
          <dd className="mt-1 font-display text-3xl font-extrabold tabular-nums text-brand-text">
            {budget.computedTotalMinorUnit !== null ? money(budget.computedTotalMinorUnit) : '—'}
          </dd>
          {budget.computedTotalIsPartial && <p className="mt-1 text-xs text-amber-800">Parcial: hay partidas sin importe confirmado.</p>}
        </div>
        {'declared' in cmp && cmp.declared !== null && (
          <div>
            <dt className="text-xs font-medium text-brand-text-muted">Total declarado en tu presupuesto</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-brand-text">{money(cmp.declared)}</dd>
          </div>
        )}
      </dl>

      <div className="mt-5" data-testid="budget-comparison" data-comparison={cmp.kind}>
        {cmp.kind === 'mismatch' && (
          <div className="rounded-xl border-2 border-brand-coral bg-brand-coral-light p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold text-brand-coral-dark">
              <span aria-hidden="true">⚠</span>
              El total declarado no coincide con la suma calculada
            </p>
            {cmp.difference !== null && (
              <p className="mt-2 text-sm text-brand-text">
                Diferencia: <strong className="font-display text-lg tabular-nums">{money(Math.abs(cmp.difference))}</strong>{' '}
                <span className="text-brand-text-muted">{cmp.difference > 0 ? 'más que la suma de partidas' : 'menos que la suma de partidas'}</span>
              </p>
            )}
            <p className="mt-2 text-xs text-brand-text-muted">Pedile al taller que revise la suma antes de aprobar el trabajo.</p>
          </div>
        )}
        {cmp.kind === 'match' && (
          <p className="flex items-center gap-1.5 rounded-xl bg-brand-primary-tint px-4 py-3 text-sm font-semibold text-brand-primary">
            <span aria-hidden="true">✓</span>
            El total declarado coincide
          </p>
        )}
        {cmp.kind === 'no_declared_total' && (
          <p className="rounded-xl bg-brand-bg px-4 py-3 text-sm text-brand-text-muted">
            No encontramos una línea de total para comparar. Podés agregar &quot;Total: importe&quot; para verificarlo.
          </p>
        )}
      </div>

      <div className="mt-5 flex gap-4 border-t border-brand-border-light pt-3 text-xs text-brand-text-muted">
        <span>
          Partidas: <strong className="text-brand-text">{budget.lineCount}</strong>
        </span>
        {budget.missingLineCount > 0 && (
          <span>
            Sin importe: <strong className="text-brand-text">{budget.missingLineCount}</strong>
          </span>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-brand-text-light">
        Sólo verificamos la suma. No evaluamos si los precios son adecuados: no hay una fuente de precios de mercado verificada.
      </p>
    </section>
  )
}

export function BudgetReport({
  report,
  declared,
  onNewQuery,
}: {
  report: ClientAnalyzeOutput
  declared: DeclaredBudgetInput
  onNewQuery: () => void
}) {
  const budget = report.route === 'budget' ? report.budget : null
  const vehicleName = [declared.make, declared.model, declared.year].filter(Boolean).join(' ')
  const title = budget && !report.fallback ? 'Tu análisis está listo' : 'Resultado de tu consulta'

  return (
    <div className="space-y-6" data-testid="budget-report">
      <ReportHeader
        eyebrow="Análisis de presupuesto · Resultado"
        title={title}
        chips={[
          { label: 'Vehículo', value: vehicleName || declared.vehicleType },
          { label: 'Partidas', value: budget ? String(budget.lineCount) : undefined },
        ]}
        aiStatus={report.aiStatus}
        disclaimer="Verificación automática de la suma del presupuesto. No es una tasación ni una opinión sobre los precios."
      />

      {report.severity && <SeverityBanner severity={report.severity} />}
      {report.fallback && <FallbackAlert fallbackText={report.fallbackText} aiStatus={report.aiStatus} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Totals first in DOM: the verdict is the most important information on mobile too. */}
        {budget && (
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">
            <TotalsPanel budget={budget} budgetText={declared.budgetText} />
          </div>
        )}

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          <SectionCard id="items-heading" title="Partidas que enviaste">
            <pre className="whitespace-pre-wrap break-words rounded-xl bg-brand-bg p-4 font-mono text-sm leading-relaxed text-brand-text">
              {declared.budgetText}
            </pre>
            <p className="mt-2 text-xs text-brand-text-muted">Tu texto, tal como lo pegaste. Los importes se suman del lado del servidor.</p>
          </SectionCard>

          {report.missingInformation.length > 0 && (
            <SectionCard id="missing-heading" title="Observaciones">
              <BulletList items={report.missingInformation} tone="warning" />
            </SectionCard>
          )}

          {report.warnings.length > 0 && (
            <SectionCard id="warnings-heading" title="Advertencias">
              <WarningsList warnings={report.warnings} />
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
        </div>
      </div>

      <ReportActions onNewQuery={onNewQuery} newQueryLabel="Analizar otro presupuesto" />

      <p className="border-t border-brand-border-light pt-4 text-xs italic leading-relaxed text-brand-text-light">{report.coverageDisclaimer}</p>

      {report.nodeTrace !== null && <TraceViewer traces={report.nodeTrace} />}
    </div>
  )
}
