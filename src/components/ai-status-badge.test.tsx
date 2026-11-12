// @vitest-environment jsdom
/**
 * ai-status-badge.test.tsx — Incremento 6.4E: the visible label distinguishes real AI, stub,
 * withheld and unavailable, and never shows "RESPUESTAS SIMULADAS" for a real-AI response.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AiStatusBadge } from './ai-status-badge'
import { FallbackAlert } from './fallback-alert'
import { ReportView } from './report-view'
import type { ClientAnalyzeOutput } from '@/app/api/analyze/schema'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const REPORT: ClientAnalyzeOutput = {
  caseId: 'c',
  safetyBlocked: false,
  safetyDerivationMessage: null,
  policyVersion: '1.5.0',
  coverageDisclaimer: 'Este análisis automático no reemplaza la inspección de un profesional.',
  route: 'symptom',
  facts: ['Ruido al arrancar'],
  hypotheses: [{ statement: 'Posible tensor gastado', confidence: 'low', caveats: [] }],
  questions: [],
  warnings: [],
  budget: null,
  missingInformation: [],
  fallback: false,
  fallbackText: null,
  nodeTrace: null,
  severity: null,
}

describe('UI-AIS-01: per-response badge', () => {
  it('real AI → "PILOTO CON IA · RESPUESTAS ORIENTATIVAS", never "SIMULADAS"', () => {
    render(<ReportView report={{ ...REPORT, aiStatus: { mode: 'ai' } }} />)
    expect(screen.getByText('PILOTO CON IA · RESPUESTAS ORIENTATIVAS')).toBeTruthy()
    expect(screen.queryByText(/SIMULADAS/)).toBeNull()
  })

  it('stub → "MODO DEMO · RESPUESTAS SIMULADAS"', () => {
    render(<ReportView report={{ ...REPORT, aiStatus: { mode: 'simulated' } }} />)
    expect(screen.getByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeTruthy()
    expect(screen.queryByText(/PILOTO CON IA/)).toBeNull()
  })

  it('withheld and unavailable have their own labels', () => {
    const { rerender } = render(<AiStatusBadge status={{ mode: 'withheld' }} />)
    expect(screen.getByText('RESPUESTA RETENIDA POR SEGURIDAD')).toBeTruthy()
    rerender(<AiStatusBadge status={{ mode: 'unavailable', reason: 'visitor_limit' }} />)
    expect(screen.getByText('LÍMITE DE CONSULTAS CON IA ALCANZADO')).toBeTruthy()
    rerender(<AiStatusBadge status={{ mode: 'unavailable', reason: 'daily_quota' }} />)
    expect(screen.getByText('IA TEMPORALMENTE NO DISPONIBLE')).toBeTruthy()
  })

  it('no aiStatus (older server) → no mode claim at all', () => {
    render(<ReportView report={REPORT} />)
    expect(screen.queryByText(/SIMULADAS|PILOTO CON IA/)).toBeNull()
  })
})

describe('UI-AIS-02: fallback alert explains the reason', () => {
  it.each([
    [{ mode: 'unavailable', reason: 'visitor_limit' } as const, /Alcanzaste el límite de consultas con IA/],
    [{ mode: 'unavailable', reason: 'daily_quota' } as const, /Servicio con IA temporalmente no disponible/],
    [{ mode: 'withheld' } as const, /Respuesta retenida por seguridad/],
    [{ mode: 'unavailable', reason: 'provider_error' } as const, /No pudimos completar el análisis automático/],
  ])('%o', (aiStatus, title) => {
    render(<FallbackAlert fallbackText="texto" aiStatus={aiStatus} />)
    expect(screen.getByRole('alert').textContent).toMatch(title)
  })
})

describe('UI-AIS-03: site mode badge and privacy notice follow GET /api/status', () => {
  it('pilot mode → pilot badge and external-provider notice', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ mode: 'pilot' }), { status: 200 })))
    const { SiteModeBadge } = await import('./ai-status-badge')
    const { PrivacyNotice } = await import('./privacy-notice')
    render(
      <>
        <SiteModeBadge />
        <PrivacyNotice />
      </>,
    )
    expect(await screen.findByText('PILOTO CON IA · RESPUESTAS ORIENTATIVAS')).toBeTruthy()
    expect(await screen.findByText(/proveedor externo \(Groq\)/)).toBeTruthy()
    expect(screen.getByRole('note').textContent).toMatch(/No ingreses información personal, patentes/)
    expect(screen.queryByText(/SIMULADAS/)).toBeNull()
  })

  it('demo mode → demo badge', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ mode: 'demo' }), { status: 200 })))
    const { SiteModeBadge } = await import('./ai-status-badge')
    render(<SiteModeBadge />)
    expect(await screen.findByText('MODO DEMO · RESPUESTAS SIMULADAS')).toBeTruthy()
  })

  it('status endpoint failing → no mode claim', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { SiteModeBadge } = await import('./ai-status-badge')
    const { container } = render(<SiteModeBadge />)
    await new Promise((r) => setTimeout(r, 10))
    expect(container.textContent).toBe('')
  })
})
