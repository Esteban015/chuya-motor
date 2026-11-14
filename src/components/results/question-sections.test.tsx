// @vitest-environment jsdom
/**
 * question-sections.test.tsx — Bugfix 7B: the results show driver questions and workshop questions
 * as two distinct sections; "Copiar preguntas" copies only the workshop ones.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react'
import type { ClientAnalyzeOutput } from '@/app/api/analyze/schema'
import { SymptomReport } from './symptom-report'
import { BudgetReport } from './budget-report'
import { ReportView } from '@/components/report-view'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const WORKSHOP = ['¿Qué códigos de falla registró el escáner OBD-II y qué indica cada uno?', '¿Qué pruebas permiten confirmar la causa antes de reemplazar componentes?']
const DRIVER = ['Cuando decís que la luz está intermitente, ¿parpadea (se prende y se apaga rápido) con el motor en marcha, o queda fija y aparece solo algunas veces?', '¿Desde cuándo notás que la luz está intermitente?']

const REPORT = {
  caseId: 'c',
  safetyBlocked: false,
  safetyDerivationMessage: null,
  policyVersion: '1.5.0',
  coverageDisclaimer: 'Este análisis automático no reemplaza la inspección de un profesional.',
  route: 'symptom',
  facts: ['Luz de check engine'],
  hypotheses: [{ statement: 'Posible falla de encendido', confidence: 'low', caveats: [] }],
  questions: WORKSHOP,
  driverQuestions: DRIVER,
  warnings: [],
  budget: null,
  missingInformation: [],
  fallback: false,
  fallbackText: null,
  nodeTrace: null,
  severity: null,
  aiStatus: { mode: 'simulated' },
} as ClientAnalyzeOutput

const declared = { vehicleType: 'Sedán', symptomText: 'Se enciende la luz de check engine intermitente' }

describe('SymptomReport', () => {
  it('two labeled sections: driver questions are not presented as questions for the workshop', () => {
    render(<SymptomReport report={REPORT} declared={declared} onNewQuery={() => {}} />)
    const workshop = screen.getByRole('region', { name: 'Preguntas para el taller' })
    const driver = screen.getByRole('region', { name: 'Para preparar tu consulta' })
    for (const q of WORKSHOP) expect(workshop.textContent).toContain(q)
    for (const q of DRIVER) {
      expect(driver.textContent).toContain(q)
      expect(workshop.textContent).not.toContain(q)
    }
    expect(driver.textContent).toMatch(/Preguntas para vos/)
    expect(workshop.textContent).toMatch(/Para hacerle al mecánico/)
    // Driver section first (prepare), then the workshop questions.
    expect(driver.compareDocumentPosition(workshop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('"Copiar preguntas" copies only the workshop questions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<SymptomReport report={REPORT} declared={declared} onNewQuery={() => {}} />)
    const workshop = screen.getByRole('region', { name: 'Preguntas para el taller' })
    fireEvent.click(within(workshop).getByRole('button', { name: 'Copiar preguntas' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const copied = writeText.mock.calls[0]![0] as string
    expect(copied).toBe(['Preguntas para el taller:', `1. ${WORKSHOP[0]}`, `2. ${WORKSHOP[1]}`].join('\n'))
    for (const q of DRIVER) expect(copied).not.toContain(q)
    expect(within(screen.getByRole('region', { name: 'Para preparar tu consulta' })).queryByRole('button')).toBeNull()
  })

  it('servers that predate driverQuestions: no driver section, workshop section unchanged', () => {
    const { driverQuestions: _omit, ...legacy } = REPORT
    render(<SymptomReport report={legacy as ClientAnalyzeOutput} declared={declared} onNewQuery={() => {}} />)
    expect(screen.queryByRole('region', { name: 'Para preparar tu consulta' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Preguntas para el taller' })).toBeTruthy()
  })
})

describe('BudgetReport', () => {
  it('shows the workshop questions about the quote, no driver section when there are none', () => {
    const budget = {
      ...REPORT,
      route: 'budget',
      hypotheses: [],
      questions: ['¿Qué incluye exactamente cada partida de mano de obra?'],
      driverQuestions: [],
      budget: { completenessStatus: 'COMPLETE', computedTotalMinorUnit: 600000, computedTotalIsPartial: false, currency: 'ARS', discrepancy: false, lineCount: 2, missingLineCount: 0 },
    } as ClientAnalyzeOutput
    render(<BudgetReport report={budget} declared={{ budgetText: 'Aceite motor: 4500\nFiltro aire: 1500' }} onNewQuery={() => {}} />)
    expect(screen.getByRole('region', { name: 'Preguntas para el taller' }).textContent).toContain('mano de obra')
    expect(screen.queryByRole('region', { name: 'Para preparar tu consulta' })).toBeNull()
  })
})

describe('ReportView (legacy /falla)', () => {
  it('also separates both audiences', () => {
    render(<ReportView report={REPORT} />)
    const workshop = screen.getByRole('region', { name: 'Preguntas para el taller' })
    const driver = screen.getByRole('region', { name: 'Para preparar tu consulta' })
    for (const q of DRIVER) {
      expect(driver.textContent).toContain(q)
      expect(workshop.textContent).not.toContain(q)
    }
  })
})
