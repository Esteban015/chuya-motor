interface SafetyAlertProps {
  message: string | null
  policyVersion: string
  coverageDisclaimer: string
}

export function SafetyAlert({ message, policyVersion, coverageDisclaimer }: SafetyAlertProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-lg">⚠</span>
        <h2 className="font-semibold text-red-800 text-base">
          Consulta bloqueada por seguridad
        </h2>
      </div>

      {message && (
        <p className="text-sm text-red-700">{message}</p>
      )}

      <div className="rounded bg-red-100 px-3 py-2 text-xs text-red-700">
        {coverageDisclaimer}
      </div>

      <p className="text-sm font-medium text-red-800">
        Contactá un taller o mecánico habilitado para esta consulta.
      </p>

      <p className="text-xs text-red-500">Política: {policyVersion}</p>
    </div>
  )
}
