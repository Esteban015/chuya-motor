import type { SeverityAssessment } from '@/domain/safety/severity-assessor'

interface SeverityBannerProps {
  severity: SeverityAssessment
}

export function SeverityBanner({ severity }: SeverityBannerProps) {
  const isCritical = severity.level === 'critical'

  // Colores y estilos según severidad.
  // Atributos data-severity y role="alert" NO se modifican — son parte del contrato de accesibilidad y tests.
  const containerClass = isCritical
    ? 'rounded-xl border-2 border-red-400 bg-red-50 p-4 space-y-2.5'
    : 'rounded-xl border-2 border-brand-coral/60 bg-brand-coral-light p-4 space-y-2.5'

  const iconClass = isCritical ? 'text-red-500' : 'text-brand-coral-dark'

  const titleClass = isCritical
    ? 'font-semibold text-red-800 text-sm leading-tight'
    : 'font-semibold text-brand-coral-dark text-sm leading-tight'

  const messageClass = isCritical
    ? 'text-sm text-red-700 leading-relaxed'
    : 'text-sm text-brand-coral-dark/90 leading-relaxed'

  const actionClass = isCritical
    ? 'rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-800 flex items-start gap-2'
    : 'rounded-lg bg-brand-coral/15 px-3 py-2 text-sm font-medium text-brand-coral-dark flex items-start gap-2'

  return (
    <div
      role="alert"
      aria-label={severity.title}
      data-severity={severity.level}
      className={containerClass}
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className={`mt-0.5 flex-shrink-0 ${iconClass}`}>
          {isCritical ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
              <path d="M8.11 2.293a1 1 0 0 1 1.78 0l5.823 11.11A1 1 0 0 1 14.823 15H3.177a1 1 0 0 1-.89-1.597L8.11 2.293ZM9 7a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 9 7Zm0 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
              <path d="M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1ZM8.25 5.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
            </svg>
          )}
        </span>
        <div className="space-y-1">
          <h2 className={titleClass}>{severity.title}</h2>
          <p className={messageClass}>{severity.message}</p>
        </div>
      </div>

      <div className={actionClass}>
        <span aria-hidden="true" className="flex-shrink-0 mt-0.5">→</span>
        <span>{severity.action}</span>
      </div>
    </div>
  )
}
