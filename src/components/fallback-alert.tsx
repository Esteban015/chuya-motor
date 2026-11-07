interface FallbackAlertProps {
  fallbackText: string | null
}

export function FallbackAlert({ fallbackText }: FallbackAlertProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-orange-300 bg-orange-50 p-4 space-y-2"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">⚠</span>
        <h2 className="font-semibold text-orange-800 text-base">
          No pudimos completar el análisis automático
        </h2>
      </div>

      {fallbackText && (
        <p className="text-sm text-orange-700">{fallbackText}</p>
      )}
    </div>
  )
}
