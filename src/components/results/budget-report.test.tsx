// @vitest-environment jsdom
/**
 * budget-report.test.tsx — Incremento 7E: the budget result with and without the AI.
 * The report is the REAL server output (route POST, stub or AI down); research uses the real
 * deterministic parser. No network: fetch is stubbed and must never be called without a click.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/analyze/route'
import type { ClientAnalyzeOutput } from '@/app/api/analyze/schema'
import { resetLlmProtectionRuntimeForTests } from '@/server/llm-protection/runtime'
import { ResearchWorkspace } from '@/components/budget-research/research-workspace'
import { parseResearchLines } from '@/domain/budget/research/line-parser'
import { BudgetReport } from './budget-report'

const EXAMPLE = 'Aceite motor: 4500\nFiltro de aire: 1500\nFiltro de aceite: 2000\nMano de obra: 3000\nTotal: 12500'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

let ip = 1
async function serverReport(env: Record<string, string>, text = EXAMPLE): Promise<ClientAnalyzeOutput> {
  resetLlmProtectionRuntimeForTests()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  const res = await POST(new NextRequest('http://localhost/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.78.0.${ip++}` }, body: JSON.stringify({ userText: text }) }))
  expect(res.status).toBe(200)
  return (await res.json()) as ClientAnalyzeOutput
}

function renderReport(report: ClientAnalyzeOutput, autoPricingEnabled: boolean) {
  const lines = parseResearchLines(EXAMPLE, { assumeParts: false }).lines
  render(
    <BudgetReport
      report={report}
      declared={{ budgetText: EXAMPLE, make: 'Fiat', model: 'Palio', year: '2017' }}
      onNewQuery={() => {}}
      research={<ResearchWorkspace lines={lines} onLinesChange={() => {}} vehicle={{ make: 'Fiat', model: 'Palio', year: '2017' }} mode="quote" serverTotalMinor={report.budget?.computedTotalMinorUnit ?? null} autoPricingEnabled={autoPricingEnabled} />}
    />,
  )
}

describe('BR-01 AI unavailable: verification, items and research stay; one consistent AI message', () => {
  it('7C disabled: no automatic search UI, manual search links kept, no request', async () => {
    const report = await serverReport({ LLM_PROVIDER: 'groq', GROQ_API_KEY: '', LLM_KILL_SWITCH: 'true', LLM_QUOTA_STORE: 'memory' })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderReport(report, false)

    const totals = screen.getByTestId('budget-totals')
    expect(within(totals).getByTestId('budget-computed').textContent).toBe('$ 11.000,00')
    expect(within(totals).getByTestId('budget-declared').textContent).toBe('$ 12.500,00')
    expect(within(totals).getByTestId('budget-difference').textContent).toContain('$ 1.500,00')
    expect(within(screen.getByTestId('budget-items')).getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByTestId('ai-unavailable-notice').textContent).toContain('La verificación de importes no usa IA')
    // Never the generic failure next to valid results; never "Partidas: 0".
    expect(screen.queryByText('No pudimos completar el análisis automático')).toBeNull()
    expect(document.body.textContent).not.toContain('Partidas: 0')
    expect(screen.getByText('Tu análisis está listo')).toBeTruthy()

    expect(screen.queryByTestId('auto-pricing-panel')).toBeNull()
    expect(screen.getAllByTestId('part-card')).toHaveLength(3)
    expect(screen.getAllByRole('link', { name: /Buscar en Google/i }).length).toBeGreaterThan(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('7C enabled: the panel lists only parts (labor excluded) and does not search by itself', async () => {
    const report = await serverReport({ LLM_PROVIDER: 'groq', GROQ_API_KEY: '', LLM_KILL_SWITCH: 'true', LLM_QUOTA_STORE: 'memory' })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderReport(report, true)
    const panel = screen.getByTestId('auto-pricing-panel')
    expect(within(within(panel).getByTestId('auto-parts')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Aceite motor', 'Filtro de aire', 'Filtro de aceite'])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('BR-02 AI available (stub): same verification, no AI notice', () => {
  it('stub server output renders the same numbers and no unavailable notice', async () => {
    const report = await serverReport({ LLM_PROVIDER: 'stub', LLM_QUOTA_STORE: 'memory' })
    renderReport(report, false)
    expect(screen.getByTestId('budget-computed').textContent).toBe('$ 11.000,00')
    expect(screen.queryByTestId('ai-unavailable-notice')).toBeNull()
  })
})

describe('BR-03 older server without 7E fields: falls back to the 6.6 rendering', () => {
  it('no items card, comparison from the text consistent with the server flag', () => {
    const legacy: ClientAnalyzeOutput = {
      caseId: 'c', safetyBlocked: false, safetyDerivationMessage: null, policyVersion: 'x', coverageDisclaimer: 'd', route: 'budget',
      facts: [], hypotheses: [], questions: [], warnings: [], missingInformation: [], fallback: false, fallbackText: null, nodeTrace: null, severity: null,
      budget: { completenessStatus: 'COMPLETE', computedTotalMinorUnit: 1_100_000, computedTotalIsPartial: false, currency: 'ARS', discrepancy: true, lineCount: 4, missingLineCount: 0 },
    }
    render(<BudgetReport report={legacy} declared={{ budgetText: EXAMPLE }} onNewQuery={() => {}} />)
    expect(screen.queryByTestId('budget-items')).toBeNull()
    expect(screen.getByTestId('budget-difference').textContent).toContain('$ 1.500,00')
  })
})
