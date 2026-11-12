'use client'

import { useSiteMode } from '@/components/ai-status-badge'

/**
 * Privacy notice (D-4). 6.4E: the mode sentence follows the real site mode — in the pilot, user text
 * is sent to an external AI provider, so the visitor is told so before submitting.
 */
export function PrivacyNotice() {
  const mode = useSiteMode()
  return (
    <div
      role="note"
      className="rounded-xl border border-brand-border bg-white/60 px-4 py-3 text-sm text-brand-text-muted"
    >
      <strong className="font-medium text-brand-text">Chuya Motor está en desarrollo.</strong>{' '}
      {mode === 'pilot' && (
        <>
          Es un piloto: tu consulta se procesa con un modelo de IA de un proveedor externo (Groq) y las
          respuestas son orientativas, pueden contener errores y no son un diagnóstico definitivo.{' '}
        </>
      )}
      {mode === 'demo' && <>Esta versión demostrativa utiliza respuestas simuladas. </>}
      No ingreses información personal, patentes, documentación privada ni información sensible. Las
      orientaciones no sustituyen una inspección profesional.
    </div>
  )
}
