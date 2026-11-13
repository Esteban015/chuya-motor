'use client'

/**
 * report-parts.tsx — Building blocks of the redesigned result views (Incremento 6.6).
 * Presentation only: every value comes from the API response or from what the person typed.
 */
import { useState } from 'react'
import Link from 'next/link'
import type { AiStatus } from '@/app/api/analyze/schema'
import { AiStatusBadge } from '@/components/ai-status-badge'
import { CONFIDENCE_LABEL } from './format'

export const RESULTS_CONTAINER = 'mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8'

// ── Header ───────────────────────────────────────────────────────────────────

export interface ReportHeaderProps {
  title: string
  eyebrow: string
  /** Short facts shown as chips (vehicle, occurrence…). Empty values are skipped. */
  chips: Array<{ label: string; value: string | undefined }>
  summaryLabel?: string
  summary?: string
  aiStatus?: AiStatus
  disclaimer: string
}

export function ReportHeader({ title, eyebrow, chips, summaryLabel, summary, aiStatus, disclaimer }: ReportHeaderProps) {
  const visible = chips.filter((c): c is { label: string; value: string } => Boolean(c.value))
  return (
    <header className="rounded-3xl border border-brand-border-light bg-white px-5 py-6 shadow-brand-xs sm:px-8 sm:py-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-text-muted">{eyebrow}</p>
          <h1 className="font-display text-2xl font-extrabold leading-tight text-brand-text sm:text-3xl">{title}</h1>
        </div>
        {aiStatus && aiStatus.mode !== 'none' && (
          <div className="flex-shrink-0">
            <AiStatusBadge status={aiStatus} />
          </div>
        )}
      </div>

      {visible.length > 0 && (
        <dl className="mt-5 flex flex-wrap gap-2">
          {visible.map((c) => (
            <div key={c.label} className="flex items-center gap-1.5 rounded-full bg-brand-bg px-3 py-1.5 text-sm">
              <dt className="text-brand-text-muted">{c.label}:</dt>
              <dd className="font-medium text-brand-text">{c.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {summary && (
        <div className="mt-4">
          {summaryLabel && <p className="text-xs font-semibold uppercase tracking-widest text-brand-text-muted">{summaryLabel}</p>}
          <p className="mt-1 max-w-4xl break-words text-base leading-relaxed text-brand-text">{summary}</p>
        </div>
      )}

      <p className="mt-5 flex items-start gap-2 border-t border-brand-border-light pt-4 text-sm text-brand-text-muted">
        <span aria-hidden="true" className="mt-0.5 text-brand-primary">ⓘ</span>
        <span>{disclaimer}</span>
      </p>
    </header>
  )
}

// ── Section card ─────────────────────────────────────────────────────────────

export function SectionCard({
  id,
  title,
  children,
  action,
  tone = 'default',
}: {
  id: string
  title: string
  children: React.ReactNode
  action?: React.ReactNode
  tone?: 'default' | 'muted'
}) {
  return (
    <section
      aria-labelledby={id}
      className={`rounded-2xl border border-brand-border-light p-5 sm:p-6 ${tone === 'muted' ? 'bg-brand-bg-alt/40' : 'bg-white shadow-brand-xs'}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id={id} className="font-display text-sm font-bold uppercase tracking-wider text-brand-text-muted">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

// ── Confidence (qualitative, never a percentage) ─────────────────────────────

export function ConfidenceIndicator({ confidence }: { confidence: 'low' | 'medium' | 'high' }) {
  const filled = confidence === 'low' ? 1 : confidence === 'medium' ? 2 : 3
  const label = `Confianza ${CONFIDENCE_LABEL[confidence]}`
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium text-brand-text-muted" data-confidence={confidence}>
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-1.5 w-4 rounded-full ${i <= filled ? 'bg-brand-primary' : 'bg-brand-border'}`} />
        ))}
      </span>
      {label}
    </span>
  )
}

// ── Copy questions ───────────────────────────────────────────────────────────

/** Text copied: only the visible questions, numbered. No vehicle, symptom or personal data. */
export function questionsClipboardText(questions: readonly string[]): string {
  return ['Preguntas para el taller:', ...questions.map((q, i) => `${i + 1}. ${q}`)].join('\n')
}

export function CopyQuestionsButton({ questions }: { questions: readonly string[] }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy() {
    try {
      await navigator.clipboard.writeText(questionsClipboardText(questions))
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-xs font-semibold text-brand-primary transition-colors hover:bg-brand-primary-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
      >
        Copiar preguntas
      </button>
      <span role="status" aria-live="polite" className="text-xs text-brand-text-muted">
        {state === 'copied' ? 'Copiadas' : state === 'failed' ? 'No se pudo copiar' : ''}
      </span>
    </div>
  )
}

// ── Lists ────────────────────────────────────────────────────────────────────

export function BulletList({ items, tone = 'default' }: { items: readonly string[]; tone?: 'default' | 'warning' }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm leading-relaxed text-brand-text">
          <span
            aria-hidden="true"
            className={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full ${tone === 'warning' ? 'bg-amber-500' : 'bg-brand-accent-dark'}`}
          />
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function QuestionList({ questions }: { questions: readonly string[] }) {
  return (
    <ol className="space-y-2.5">
      {questions.map((q, i) => (
        <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-brand-text">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-primary-tint font-display text-2xs font-bold text-brand-primary"
          >
            {i + 1}
          </span>
          <span className="min-w-0 break-words">{q}</span>
        </li>
      ))}
    </ol>
  )
}

/** Warnings stay visible (never inside an accordion). */
export function WarningsList({ warnings }: { warnings: readonly string[] }) {
  return (
    <ul className="space-y-2">
      {warnings.map((w, i) => (
        <li key={i} className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900">
          <span aria-hidden="true" className="mt-0.5 flex-shrink-0">⚠</span>
          <span className="min-w-0 break-words">{w}</span>
        </li>
      ))}
    </ul>
  )
}

// ── Actions ──────────────────────────────────────────────────────────────────

export function ReportActions({ onNewQuery, newQueryLabel = 'Realizar otra consulta' }: { onNewQuery: () => void; newQueryLabel?: string }) {
  return (
    <nav aria-label="Acciones del informe" className="flex flex-col gap-3 sm:flex-row">
      <button
        type="button"
        onClick={onNewQuery}
        className="rounded-xl bg-brand-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
      >
        {newQueryLabel}
      </button>
      <Link
        href="/demo"
        className="rounded-xl border border-brand-border bg-white px-5 py-3 text-center text-sm font-semibold text-brand-text transition hover:bg-brand-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2"
      >
        Volver a la demo
      </Link>
    </nav>
  )
}
