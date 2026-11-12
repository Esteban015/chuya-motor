import type { AiStatus } from '@/app/api/analyze/schema'

interface FallbackAlertProps {
  fallbackText: string | null
  /** 6.4E: what happened, so a quota limit or a withheld answer is not shown as a generic failure. */
  aiStatus?: AiStatus
}

function contentFor(aiStatus: AiStatus | undefined, fallbackText: string | null): { title: string; body: string | null } {
  if (aiStatus?.mode === 'withheld') {
    return { title: 'Respuesta retenida por seguridad', body: 'La orientación generada no superó la validación de seguridad y no se muestra.' }
  }
  if (aiStatus?.mode === 'unavailable') {
    switch (aiStatus.reason) {
      case 'visitor_limit':
        return {
          title: 'Alcanzaste el límite de consultas con IA',
          body: 'Para cuidar el cupo compartido del piloto, cada visitante tiene un número limitado de consultas con IA por hora. Probá de nuevo más tarde.',
        }
      case 'daily_quota':
        return { title: 'Servicio con IA temporalmente no disponible', body: 'El piloto alcanzó su cupo diario de consultas con IA. Probá de nuevo mañana.' }
      case 'busy':
        return { title: 'Servicio con IA temporalmente no disponible', body: 'Hay muchas consultas en curso. Probá de nuevo en unos minutos.' }
      case 'disabled':
        return { title: 'Servicio con IA temporalmente no disponible', body: 'El análisis con IA está pausado en este momento.' }
    }
  }
  return { title: 'No pudimos completar el análisis automático', body: fallbackText }
}

export function FallbackAlert({ fallbackText, aiStatus }: FallbackAlertProps) {
  const { title, body } = contentFor(aiStatus, fallbackText)
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
        <h2 className="font-semibold text-brand-coral-dark text-sm">{title}</h2>
      </div>

      {body && <p className="text-sm text-brand-coral-dark/90 leading-relaxed pl-6">{body}</p>}
    </div>
  )
}
