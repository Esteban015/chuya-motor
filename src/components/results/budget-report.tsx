'use client'

/**
 * budget-report.tsx — Budget result for /demo/presupuesto (6.6, deterministic detail in 7E). UI only.
 *
 * 7E: the server returns its deterministic reading (items, categories, declared total, difference,
 * breakdown, notes). It does not depend on the AI: when the AI is unavailable the verification is
 * still shown, with a separate AI notice (never a contradictory "Partidas: 0").
 *   - Amounts come only from the server (integer minor units). Nothing here recalculates them.
 *   - Older servers without the 7E fields → the declared total is read from the text as before
 *     (format.ts → budgetComparison), only when consistent with the server's discrepancy flag.
 *   - Nothing says whether a price is high, low or fair: no market source exists.
 */
import type { ClientAnalyzeOutput, ClientBudgetItem, ClientBudgetNote, ClientBudgetOutput } from '@/app/api/analyze/schema'
import { contentFor, FallbackAlert } from '@/components/fallback-alert'
import { FeedbackInvite } from '@/components/feedback/feedback-invite'
import { SeverityBanner } from '@/components/severity-banner'
import { TraceViewer } from '@/components/trace-viewer'
import { BUDGET_STATUS_LABEL, budgetComparison, formatMoney, type BudgetComparison } from './format'
import { BulletList, DriverQuestionsCard, ReportActions, ReportHeader, SectionCard, WarningsList, WorkshopQuestionsCard } from './report-parts'

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

const CATEGORY_LABEL: Record<ClientBudgetItem['category'], string> = {
  part: 'Repuesto',
  labor: 'Mano de obra',
  other: 'Otro concepto',
  unclassified: 'Sin clasificar',
}

const ITEM_STATUS_LABEL: Record<Exclude<ClientBudgetItem['status'], 'priced' | 'ambiguous'>, string> = {
  pending: 'A confirmar',
  missing: 'Sin importe',
}

const ISSUE_LABEL: Record<NonNullable<ClientBudgetItem['issue']>, string> = {
  unreadable_amount: 'Importe no legible: no se suma',
  amount_without_separator: 'Número sin «:» antes: no sabemos si es el importe o un código, no se suma',
  discount_sign: 'Descuento: no se suma, no sabemos si ya está aplicado',
  unverified_amount: 'Importe que no figura en tu texto: no se suma',
}

const NOTE_LABEL: Record<ClientBudgetNote, string> = {
  declared_total_conflict: 'Hay más de una línea de total con importes distintos: no la usamos para comparar.',
  declared_total_unreadable: 'No pudimos leer el importe de la línea de total.',
  lines_truncated: 'El presupuesto tiene más de 50 líneas: sólo leímos las primeras 50.',
  text_not_interpreted: 'Algunas líneas no parecen partidas (títulos o comentarios) y no se tuvieron en cuenta.',
}

/** Server comparison (7E) when available; else the 6.6 text-based comparison. */
function comparisonFor(budget: ClientBudgetOutput, budgetText: string): BudgetComparison | { kind: 'partial'; declared: number | null } {
  if (budget.declaredTotalMinorUnit === undefined) return budgetComparison(budget, budgetText)
  const declared = budget.declaredTotalMinorUnit
  if (budget.completenessStatus === 'PARTIAL') return { kind: 'partial', declared }
  if (budget.computedTotalMinorUnit === null) return { kind: 'unknown' }
  if (declared === null) return { kind: 'no_declared_total' }
  const difference = budget.differenceMinorUnit ?? declared - budget.computedTotalMinorUnit
  return difference === 0 ? { kind: 'match', declared } : { kind: 'mismatch', declared, difference }
}

function TotalsPanel({ budget, budgetText }: { budget: ClientBudgetOutput; budgetText: string }) {
  const cmp = comparisonFor(budget, budgetText)
  const money = (v: number) => formatMoney(v, budget.currency ?? 'ARS')
  const b = budget.breakdown
  return (
    <section aria-labelledby="totals-heading" data-testid="budget-totals" className="rounded-2xl border border-brand-border-light bg-white p-5 shadow-brand-xs sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="totals-heading" className="font-display text-sm font-bold uppercase tracking-wider text-brand-text-muted">
          Verificación de importes
        </h2>
        <span
          data-status={budget.completenessStatus}
          className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${STATUS_STYLE[budget.completenessStatus]}`}
        >
          {BUDGET_STATUS_LABEL[budget.completenessStatus]}
        </span>
      </div>

      <dl className="mt-5 space-y-4">
        <div>
          <dt className="text-xs font-medium text-brand-text-muted">Suma de partidas</dt>
          <dd className="mt-1 font-display text-3xl font-extrabold tabular-nums text-brand-text" data-testid="budget-computed">
            {budget.computedTotalMinorUnit !== null ? money(budget.computedTotalMinorUnit) : '—'}
          </dd>
          {budget.computedTotalIsPartial && <p className="mt-1 text-xs text-amber-800">Suma parcial: hay partidas sin importe o con un importe que no pudimos leer.</p>}
        </div>
        {'declared' in cmp && cmp.declared !== null && (
          <div>
            <dt className="text-xs font-medium text-brand-text-muted">Total declarado en tu presupuesto</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-brand-text" data-testid="budget-declared">
              {money(cmp.declared)}
            </dd>
          </div>
        )}
      </dl>

      {b && (
        <dl className="mt-5 space-y-1.5 border-t border-brand-border-light pt-4 text-sm" data-testid="budget-breakdown">
          <BreakdownRow label="Repuestos" value={money(b.partMinorUnit)} />
          <BreakdownRow label="Mano de obra" value={money(b.laborMinorUnit)} />
          {b.otherMinorUnit > 0 && <BreakdownRow label="Otros conceptos" value={money(b.otherMinorUnit)} />}
          {b.unclassifiedMinorUnit > 0 && <BreakdownRow label="Sin clasificar" value={money(b.unclassifiedMinorUnit)} />}
        </dl>
      )}

      <div className="mt-5" data-testid="budget-comparison" data-comparison={cmp.kind}>
        {cmp.kind === 'mismatch' && (
          <div className="rounded-xl border-2 border-brand-coral bg-brand-coral-light p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold text-brand-coral-dark">
              <span aria-hidden="true">⚠</span>
              El total declarado no coincide con la suma calculada
            </p>
            {cmp.difference !== null && (
              <p className="mt-2 text-sm text-brand-text" data-testid="budget-difference">
                Diferencia aritmética: <strong className="font-display text-lg tabular-nums">{money(Math.abs(cmp.difference))}</strong>{' '}
                <span className="text-brand-text-muted">{cmp.difference > 0 ? '(el total declarado es mayor)' : '(el total declarado es menor)'}</span>
              </p>
            )}
            <p className="mt-2 text-xs text-brand-text-muted">Puede deberse a un error de suma o a un concepto que no figura en las partidas. Pedile al taller que lo revise antes de aprobar el trabajo.</p>
          </div>
        )}
        {cmp.kind === 'match' && (
          <p className="flex items-center gap-1.5 rounded-xl bg-brand-primary-tint px-4 py-3 text-sm font-semibold text-brand-primary">
            <span aria-hidden="true">✓</span>
            El total declarado coincide con la suma de partidas
          </p>
        )}
        {cmp.kind === 'partial' && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No comparamos con el total declarado porque la suma es parcial. Completá los importes que faltan para verificarla.
          </p>
        )}
        {cmp.kind === 'no_declared_total' && (
          <p className="rounded-xl bg-brand-bg px-4 py-3 text-sm text-brand-text-muted">
            No encontramos una línea de total para comparar. Podés agregar &quot;Total: importe&quot; para verificarlo.
          </p>
        )}
        {cmp.kind === 'unknown' && (
          <p className="rounded-xl bg-brand-bg px-4 py-3 text-sm text-brand-text-muted">
            No pudimos verificar la suma: no encontramos partidas con un importe legible. Escribí una partida por línea, por ejemplo &quot;Filtro de aceite: 2000&quot;.
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-brand-border-light pt-3 text-xs text-brand-text-muted">
        <span>
          Partidas: <strong className="text-brand-text">{budget.lineCount}</strong>
        </span>
        {budget.missingLineCount > 0 && (
          <span>
            Sin importe confirmado: <strong className="text-brand-text">{budget.missingLineCount}</strong>
          </span>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-brand-text-light">
        Sólo verificamos la aritmética, con reglas fijas y sin IA. No evaluamos si los precios son adecuados: no hay una fuente de precios de mercado verificada.
      </p>
    </section>
  )
}

function BreakdownRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-brand-text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-brand-text">{value}</dd>
    </div>
  )
}

function ItemsCard({ budget }: { budget: ClientBudgetOutput }) {
  const items = budget.items ?? []
  const notes = budget.notes ?? []
  const flagged = items.filter((i) => i.status !== 'priced')
  const money = (v: number) => formatMoney(v, budget.currency ?? 'ARS')
  return (
    <SectionCard id="identified-heading" title="Partidas identificadas">
      <ul className="divide-y divide-brand-border-light" data-testid="budget-items">
        {items.map((item, idx) => (
          <li key={idx} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4" data-status={item.status} data-category={item.category}>
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-brand-text">{item.description}</p>
              <p className="text-xs text-brand-text-muted">
                {CATEGORY_LABEL[item.category]}
                {item.quantity > 1 && ` · cantidad ${item.quantity} (importe tal como figura)`}
              </p>
            </div>
            <div className="shrink-0 text-left sm:text-right">
              {item.status === 'priced' && item.amountMinorUnit !== null && <p className="text-sm font-semibold tabular-nums text-brand-text">{money(item.amountMinorUnit)}</p>}
              {(item.status === 'pending' || item.status === 'missing') && <p className="text-xs font-semibold text-amber-800">{ITEM_STATUS_LABEL[item.status]}</p>}
              {item.status === 'ambiguous' && (
                <p className="text-xs font-semibold text-amber-800">
                  {item.amountMinorUnit !== null && <span className="tabular-nums">{money(item.amountMinorUnit)} · </span>}
                  {item.issue ? ISSUE_LABEL[item.issue] : 'Importe a revisar: no se suma'}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {(flagged.length > 0 || notes.length > 0) && (
        <div className="mt-4 rounded-xl bg-amber-50 p-3" data-testid="budget-limitations">
          <p className="text-xs font-semibold text-amber-900">Datos faltantes o ambiguos</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-900">
            {flagged.length > 0 && (
              <li>
                {flagged.length === 1 ? '1 partida no tiene un importe que podamos sumar' : `${flagged.length} partidas no tienen un importe que podamos sumar`}: la suma es parcial.
              </li>
            )}
            {notes.map((n) => (
              <li key={n}>{NOTE_LABEL[n]}</li>
            ))}
          </ul>
        </div>
      )}
      {budget.source === 'llm' && (
        <p className="mt-3 text-xs text-brand-text-muted">Partidas leídas con ayuda de IA porque el texto no tenía una partida por línea. Sólo se suman importes que figuran en tu texto.</p>
      )}
    </SectionCard>
  )
}

/** 7E: the AI failed but the verification above is valid — a status, not an error. */
function AiUnavailableNotice({ report }: { report: ClientAnalyzeOutput }) {
  const { title, body } = contentFor(report.aiStatus, null)
  return (
    <div role="status" data-testid="ai-unavailable-notice" className="rounded-xl border border-brand-border bg-brand-bg p-4">
      <p className="text-sm font-semibold text-brand-text">{title}</p>
      {body && <p className="mt-1 text-sm text-brand-text-muted">{body}</p>}
      <p className="mt-1 text-sm text-brand-text-muted">La verificación de importes no usa IA: los resultados de esta página son válidos y podés seguir con la investigación de repuestos.</p>
    </div>
  )
}

export function BudgetReport({
  report,
  declared,
  onNewQuery,
  research,
}: {
  report: ClientAnalyzeOutput
  declared: DeclaredBudgetInput
  onNewQuery: () => void
  /** 7B: parts research / comparison, rendered after the verification and before the actions. */
  research?: React.ReactNode
}) {
  const budget = report.route === 'budget' ? report.budget : null
  const vehicleName = [declared.make, declared.model, declared.year].filter(Boolean).join(' ')
  const title = budget && !report.fallback ? 'Tu análisis está listo' : 'Resultado de tu consulta'
  const showAiNotice = !report.fallback && report.aiUnavailable === true

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
        {/* Totals first in DOM: the verification is the most important information on mobile too. */}
        {budget && (
          <div className="min-w-0 lg:col-start-2 lg:row-start-1">
            <TotalsPanel budget={budget} budgetText={declared.budgetText} />
          </div>
        )}

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
          {budget && (budget.items?.length ?? 0) > 0 && <ItemsCard budget={budget} />}

          {showAiNotice && <AiUnavailableNotice report={report} />}

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

          <DriverQuestionsCard questions={report.driverQuestions ?? []} />
          <WorkshopQuestionsCard questions={report.questions} />
        </div>
      </div>

      {research}

      <ReportActions onNewQuery={onNewQuery} newQueryLabel="Analizar otro presupuesto" />

      <p className="border-t border-brand-border-light pt-4 text-xs italic leading-relaxed text-brand-text-light">{report.coverageDisclaimer}</p>

      {/* 7A: optional feedback, always last — never above safety or the result itself. */}
      <FeedbackInvite />

      {report.nodeTrace !== null && <TraceViewer traces={report.nodeTrace} />}
    </div>
  )
}
