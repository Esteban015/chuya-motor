interface FallbackAlertProps {
  fallbackText: string | null
}

export function FallbackAlert({ fallbackText }: FallbackAlertProps) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-brand-coral/40 bg-brand-coral-light p-4 space-y-2"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-brand-coral-dark text-base">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
            <path d="M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1ZM8.25 5.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5Zm.75 7.25a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
          </svg>
        </span>
        <h2 className="font-semibold text-brand-coral-dark text-sm">
          No pudimos completar el análisis automático
        </h2>
      </div>

      {fallbackText && (
        <p className="text-sm text-brand-coral-dark/90 leading-relaxed pl-6">{fallbackText}</p>
      )}
    </div>
  )
}
