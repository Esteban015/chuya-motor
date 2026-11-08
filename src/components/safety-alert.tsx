interface SafetyAlertProps {
  message: string | null
  policyVersion: string
  coverageDisclaimer: string
}

export function SafetyAlert({ message, policyVersion, coverageDisclaimer }: SafetyAlertProps) {
  return (
    <div
      role="alert"
      className="rounded-xl border-2 border-red-300 bg-red-50 p-5 space-y-3"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex-shrink-0 rounded-full bg-red-100 p-1.5 text-red-600"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-3a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm0 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
          </svg>
        </span>
        <div>
          <h2 className="font-semibold text-red-800 text-base leading-tight">
            Consulta bloqueada por seguridad
          </h2>
          {message && (
            <p className="mt-1.5 text-sm text-red-700 leading-relaxed">{message}</p>
          )}
        </div>
      </div>

      <div className="ml-10 rounded-lg bg-red-100 px-3 py-2.5 text-xs text-red-700 leading-relaxed">
        {coverageDisclaimer}
      </div>

      <p className="ml-10 text-sm font-medium text-red-800">
        Contactá un taller o mecánico habilitado para esta consulta.
      </p>

      <p className="ml-10 text-xs text-red-400">Política v{policyVersion}</p>
    </div>
  )
}
