/**
 * feedback-invite.tsx — Incremento 7A. Optional, discreet invitation to an external feedback form,
 * rendered at the end of the symptom and budget results (after the report and its disclaimer).
 *
 * - Renders nothing when NEXT_PUBLIC_FEEDBACK_FORM_URL is missing or invalid (no broken link).
 * - The link is the configured URL verbatim: no query data, no prefill, no case id.
 * - Opens in a new tab with rel="noopener noreferrer" (no Referer header is sent to Google).
 * - Visually quieter than SeverityBanner / FallbackAlert: neutral colors, no role="alert".
 */
import { configuredFeedbackFormUrl } from './feedback-url'

export function FeedbackInvite({ formUrl }: { formUrl?: string | null }) {
  const href = formUrl === undefined ? configuredFeedbackFormUrl() : formUrl
  if (!href) return null

  return (
    <section
      aria-labelledby="feedback-heading"
      data-testid="feedback-invite"
      className="rounded-2xl border border-brand-border-light bg-white/70 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6"
    >
      <div className="min-w-0">
        <h2 id="feedback-heading" className="font-display text-base font-bold text-brand-text">
          ¿Te resultó útil Chuya Motor?
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-brand-text-muted">
          Estamos mejorando la herramienta con la ayuda de quienes la prueban. Tu opinión nos sirve para hacerla más clara y útil.
        </p>
        <p className="mt-2 text-xs text-brand-text-light">
          Es voluntario. No incluyas datos personales, patentes ni información de tu consulta.
        </p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex w-full items-center justify-center whitespace-nowrap rounded-xl border border-brand-primary/30 bg-white px-5 py-3 text-sm font-semibold text-brand-primary transition hover:bg-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 sm:mt-0 sm:w-auto"
      >
        Contanos tu experiencia
        <span className="sr-only"> (formulario externo y opcional; se abre en una pestaña nueva)</span>
        <span aria-hidden="true" className="ml-1.5">↗</span>
      </a>
    </section>
  )
}
