// @vitest-environment jsdom
/**
 * report-export.test.tsx — Incremento 7F: "Descargar informe PDF" / "Imprimir informe".
 * Reports come from the REAL /api/analyze route (stub LLM or AI unavailable: no Groq call); the
 * PDF is generated locally and inspected. fetch is spied: the export must never call it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextRequest } from 'next/server'
import { PDFDocument } from 'pdf-lib'
import { POST } from '@/app/api/analyze/route'
import type { ClientAnalyzeOutput } from '@/app/api/analyze/schema'
import { resetLlmProtectionRuntimeForTests } from '@/server/llm-protection/runtime'
import { BudgetReport } from '@/components/results/budget-report'
import { SymptomReport } from '@/components/results/symptom-report'
import { buildBudgetReport, buildDiagnosisReport, budgetReadiness, diagnosisReadiness, type PrivacyOptions } from '@/domain/report/chuya-report'
import { REDACTED } from '@/domain/report/personal-data'
import { PRICING_WITH_OFFERS } from '@/domain/report/__fixtures__/report-fixtures'
import { ReportExport } from './report-export'

const BUDGET = 'Aceite motor: 4500\nFiltro de aire: 1500\nFiltro de aceite: 2000\nMano de obra: 3000\nTotal: 12500'
const SYMPTOM = 'Escucho un chirrido al frenar. Mi celular es 11-2345-6789.'
const AI_DOWN = { LLM_PROVIDER: 'groq', GROQ_API_KEY: '', LLM_KILL_SWITCH: 'true', LLM_QUOTA_STORE: 'memory' }
const STUB = { LLM_PROVIDER: 'stub', LLM_QUOTA_STORE: 'memory' }

let ip = 1
async function serverReport(env: Record<string, string>, userText: string): Promise<ClientAnalyzeOutput> {
  resetLlmProtectionRuntimeForTests()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  const res = await POST(new NextRequest('http://localhost/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.79.0.${ip++}` }, body: JSON.stringify({ userText }) }))
  expect(res.status).toBe(200)
  const body = (await res.json()) as ClientAnalyzeOutput
  vi.unstubAllEnvs()
  return body
}

let blobs: Blob[] = []
let downloads: string[] = []
let fetchSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  blobs = []
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b)
    return `blob:test-${blobs.length}`
  }) as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn()
  // jsdom cannot navigate to blob: URLs; the download anchor's click is recorded instead.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download)
  })
  downloads = []
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  document.documentElement.classList.remove('chuya-printing')
})

/** Spy fetch only AFTER the server report exists: from here on, nothing may be requested. */
function forbidNetwork() {
  fetchSpy = vi.fn(async () => {
    throw new Error('network is forbidden during export')
  })
  vi.stubGlobal('fetch', fetchSpy)
}

async function pdfOf(blob: Blob): Promise<{ doc: PDFDocument; bytes: Uint8Array }> {
  // jsdom's Blob is read with FileReader (no Response/arrayBuffer support).
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
  const bytes = new Uint8Array(buf)
  return { doc: await PDFDocument.load(bytes), bytes }
}

function renderBudget(report: ClientAnalyzeOutput, opts: { pricing?: typeof PRICING_WITH_OFFERS | null } = {}) {
  render(
    <BudgetReport
      report={report}
      declared={{ budgetText: BUDGET, make: 'Fiat', model: 'Palio', year: '2017' }}
      onNewQuery={() => {}}
      reportExport={
        <ReportExport
          readiness={budgetReadiness({ report })}
          freeTexts={[BUDGET]}
          build={(privacy: PrivacyOptions, generatedAt: Date) => buildBudgetReport({ report, vehicle: { make: 'Fiat', model: 'Palio', year: '2017', source: 'manual' }, budgetText: BUDGET, pricing: opts.pricing ?? null, generatedAt, privacy })}
        />
      }
    />,
  )
}

function renderSymptom(report: ClientAnalyzeOutput, symptomText = SYMPTOM) {
  render(
    <SymptomReport
      report={report}
      declared={{ make: 'Fiat', model: 'Palio', year: '2017', symptomText }}
      onNewQuery={() => {}}
      reportExport={
        <ReportExport
          readiness={diagnosisReadiness({ report, symptomText })}
          freeTexts={[symptomText]}
          build={(privacy: PrivacyOptions, generatedAt: Date) => buildDiagnosisReport({ report, vehicle: { make: 'Fiat', model: 'Palio', year: '2017', source: 'catalog' }, symptomText, generatedAt, privacy })}
        />
      }
    />,
  )
}

async function clickDownload() {
  fireEvent.click(screen.getByRole('button', { name: 'Descargar informe PDF' }))
  await waitFor(() => expect(screen.getByTestId('report-export-status').textContent).toContain('Descarga lista'))
}

describe('RX-01 budget, AI unavailable (real server output)', () => {
  it('downloads a valid PDF with the verification; states preparing → ready; no network; repeated download too', async () => {
    const report = await serverReport(AI_DOWN, BUDGET)
    expect(report.aiStatus?.mode).toBe('unavailable')
    forbidNetwork()
    renderBudget(report)
    const button = screen.getByRole('button', { name: 'Descargar informe PDF' })
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Preparando PDF…' }).hasAttribute('disabled')).toBe(true)
    await waitFor(() => expect(screen.getByTestId('report-export-status').textContent).toMatch(/Descarga lista: chuya-informe-presupuesto-\d{4}-\d{2}-\d{2}\.pdf/))
    expect(blobs).toHaveLength(1)
    expect(blobs[0]!.type).toBe('application/pdf')
    const { doc } = await pdfOf(blobs[0]!)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1)
    expect(doc.getTitle()).toBe('Chuya Motor - Informe de revisión de presupuesto')

    await clickDownload()
    expect(blobs).toHaveLength(2)
    expect(downloads).toHaveLength(2)
    expect(downloads[0]).toMatch(/^chuya-informe-presupuesto-\d{4}-\d{2}-\d{2}\.pdf$/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('offers already shown are exported; no search is made by the export', async () => {
    const report = await serverReport(AI_DOWN, BUDGET)
    forbidNetwork()
    renderBudget(report, { pricing: PRICING_WITH_OFFERS })
    fireEvent.click(screen.getByRole('button', { name: /Vista previa y privacidad/ }))
    const preview = screen.getByTestId('report-preview')
    expect(preview.textContent).toContain('Compatibilidad no verificada')
    expect(preview.textContent).toContain('$ 32.700,50')
    expect(within(preview).getByRole('link', { name: /google\.com\.ar\/shopping/ }).getAttribute('rel')).toContain('noopener')
    expect(preview.textContent).toContain('$ 11.000,00')
    expect(preview.textContent).toContain('Diferencia aritmética: $ 1.500,00')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('RX-02 diagnosis (real server output)', () => {
  it('with the stub AI: preview, then PDF; personal data omitted by default and the notice says so', async () => {
    const report = await serverReport(STUB, 'Escucho un chirrido al frenar desde hace una semana')
    forbidNetwork()
    renderSymptom(report)
    expect(screen.getByTestId('report-personal-data').textContent).toContain('teléfono')
    expect(screen.getByTestId('report-personal-data').textContent).toContain('los omitimos')
    fireEvent.click(screen.getByRole('button', { name: /Vista previa y privacidad/ }))
    expect(screen.getByRole('button', { name: /Vista previa y privacidad/ }).getAttribute('aria-expanded')).toBe('true')
    const preview = screen.getByTestId('report-preview')
    expect(preview.textContent).toContain(REDACTED)
    expect(preview.textContent).not.toContain('2345-6789')

    // The person can choose to include it, or to leave the original text out entirely.
    fireEvent.click(screen.getByRole('checkbox', { name: /Omitir datos personales/ }))
    expect(screen.getByTestId('report-preview').textContent).toContain('11-2345-6789')
    expect(screen.getByTestId('report-personal-data').textContent).toContain('incluirá')
    fireEvent.click(screen.getByRole('checkbox', { name: /Incluir mi texto original/ }))
    expect(screen.getByTestId('report-preview').textContent).not.toContain('chirrido al frenar. Mi celular')

    await clickDownload()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('AI unavailable: the report still downloads and states the AI status', async () => {
    const report = await serverReport(AI_DOWN, 'Escucho un chirrido al frenar desde hace una semana')
    forbidNetwork()
    renderSymptom(report, 'Escucho un chirrido al frenar desde hace una semana')
    fireEvent.click(screen.getByRole('button', { name: /Vista previa y privacidad/ }))
    expect(screen.getByTestId('report-preview').textContent).toMatch(/IA temporalmente no disponible|No pudimos completar/)
    await clickDownload()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('RX-03 error, insufficient information, safety block', () => {
  it('generation error → error message; the button is usable again', async () => {
    forbidNetwork()
    render(<ReportExport readiness={{ ok: true }} freeTexts={[]} build={() => { throw new Error('boom') }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Descargar informe PDF' }))
    await waitFor(() => expect(screen.getByTestId('report-export-status').textContent).toContain('No pudimos generar el PDF'))
    expect(screen.getByRole('button', { name: 'Descargar informe PDF' }).hasAttribute('disabled')).toBe(false)
  })
  it('insufficient → both actions disabled with the reason; safety-blocked → no report actions at all', () => {
    const build = vi.fn()
    const { unmount } = render(<ReportExport readiness={{ ok: false, reason: 'insufficient' }} freeTexts={[]} build={build} />)
    expect(screen.getByRole('button', { name: 'Descargar informe PDF' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Imprimir informe' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('report-export-status').textContent).toContain('información suficiente')
    unmount()
    render(<ReportExport readiness={{ ok: false, reason: 'safety_blocked' }} freeTexts={[]} build={build} />)
    expect(screen.queryByTestId('report-export')).toBeNull()
    expect(build).not.toHaveBeenCalled()
  })
})

describe('RX-04 print', () => {
  it('"Imprimir informe" prints only the report (body-level root), then cleans up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const print = vi.fn()
    vi.stubGlobal('print', print)
    window.print = print
    const report = await serverReport(AI_DOWN, BUDGET)
    renderBudget(report)
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir informe' }))
    const root = await screen.findByTestId('report-print-root')
    expect(root.parentElement).toBe(document.body)
    expect(root.id).toBe('chuya-print-root')
    expect(root.textContent).toContain('Informe de revisión de presupuesto')
    expect(document.documentElement.classList.contains('chuya-printing')).toBe(true)
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(print).toHaveBeenCalledTimes(1)
    act(() => {
      window.dispatchEvent(new Event('afterprint'))
    })
    expect(screen.queryByTestId('report-print-root')).toBeNull()
    expect(document.documentElement.classList.contains('chuya-printing')).toBe(false)
    vi.useRealTimers()
  })
})
