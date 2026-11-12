'use client'

import { useEffect, useState } from 'react'
import type { AiStatus } from '@/app/api/analyze/schema'
import { DemoBadge } from '@/components/demo-badge'

/**
 * Incremento 6.4E — badges that tell the visitor what actually processed their request.
 *  - AiStatusBadge: per response, from aiStatus (server-side, authoritative).
 *  - SiteModeBadge: site mode from GET /api/status (pilot with AI vs. demo with the stub).
 * Neither ever claims real AI for a stub answer, nor "simulated" for a failed AI answer.
 */

const PILL = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1'

export const PILOT_BADGE_TEXT = 'PILOTO CON IA · RESPUESTAS ORIENTATIVAS'

export function PilotBadge() {
  return (
    <span
      className={`${PILL} bg-brand-primary-tint text-brand-primary ring-brand-primary/20`}
      aria-label="Piloto con inteligencia artificial — respuestas orientativas, no diagnósticos definitivos"
      data-ai-badge="ai"
    >
      {PILOT_BADGE_TEXT}
    </span>
  )
}

function NoticeBadge({ text, kind }: { text: string; kind: string }) {
  return (
    <span className={`${PILL} bg-amber-50 text-amber-800 ring-amber-200`} data-ai-badge={kind}>
      {text}
    </span>
  )
}

export function AiStatusBadge({ status }: { status: AiStatus | undefined }) {
  if (!status) return null
  switch (status.mode) {
    case 'ai':
      return <PilotBadge />
    case 'simulated':
      return <DemoBadge />
    case 'withheld':
      return <NoticeBadge kind="withheld" text="RESPUESTA RETENIDA POR SEGURIDAD" />
    case 'unavailable':
      return status.reason === 'visitor_limit' ? (
        <NoticeBadge kind="visitor_limit" text="LÍMITE DE CONSULTAS CON IA ALCANZADO" />
      ) : (
        <NoticeBadge kind="unavailable" text="IA TEMPORALMENTE NO DISPONIBLE" />
      )
    default:
      return null
  }
}

// ── Site mode ────────────────────────────────────────────────────────────────

export type SiteMode = 'pilot' | 'demo'

let siteModePromise: Promise<SiteMode | null> | null = null

function fetchSiteMode(): Promise<SiteMode | null> {
  siteModePromise ??= fetch('/api/status', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((b: { mode?: unknown } | null) => (b?.mode === 'pilot' || b?.mode === 'demo' ? b.mode : null))
    .catch(() => null)
  return siteModePromise
}

/** Site mode, or null while loading / unknown (then nothing mode-specific is claimed). */
export function useSiteMode(): SiteMode | null {
  const [mode, setMode] = useState<SiteMode | null>(null)
  useEffect(() => {
    let alive = true
    fetchSiteMode().then((m) => alive && setMode(m))
    return () => {
      alive = false
    }
  }, [])
  return mode
}

export function SiteModeBadge() {
  const mode = useSiteMode()
  if (mode === 'pilot') return <PilotBadge />
  if (mode === 'demo') return <DemoBadge />
  return null
}
