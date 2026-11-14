// @vitest-environment jsdom
/**
 * feedback.test.tsx — Incremento 7A: optional feedback invitation + analytics URL sanitizing.
 * No network, no LLM: components are rendered with fixed fixtures.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import type { ClientAnalyzeOutput } from '@/app/api/analyze/schema'
import { SymptomReport } from '@/components/results/symptom-report'
import { BudgetReport } from '@/components/results/budget-report'
import { sanitizeAnalyticsEvent } from '@/components/site-analytics'
import { FeedbackInvite } from './feedback-invite'
import { resolveFeedbackFormUrl } from './feedback-url'

const FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSc-test-only/viewform'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const SYMPTOM: ClientAnalyzeOutput = {
  caseId: 'case-secret-123',
  safetyBlocked: false,
  safetyDerivationMessage: null,
  policyVersion: '1.5.0',
  coverageDisclaimer: 'Este análisis automático no reemplaza la inspección de un profesional.',
  route: 'symptom',
  facts: ['Ruido al arrancar'],
  hypotheses: [{ statement: 'Posible tensor gastado', confidence: 'low', caveats: [] }],
  questions: ['¿Desde cuándo?'],
  warnings: [],
  budget: null,
  missingInformation: [],
  fallback: false,
  fallbackText: null,
  nodeTrace: null,
  severity: null,
  aiStatus: { mode: 'simulated' },
} as ClientAnalyzeOutput

const BUDGET = {
  ...SYMPTOM,
  route: 'budget',
  facts: [],
  hypotheses: [],
  budget: {
    completenessStatus: 'COMPLETE',
    computedTotalMinorUnit: 1_100_000,
    computedTotalIsPartial: false,
    currency: 'ARS',
    discrepancy: false,
    lineCount: 2,
    missingLineCount: 0,
  },
} as ClientAnalyzeOutput

const CRITICAL = {
  level: 'critical',
  title: 'Atención: síntoma crítico de seguridad',
  message: 'El problema descripto podría comprometer seriamente el sistema de frenos.',
  action: 'No conduzcas el vehículo.',
} as unknown as NonNullable<ClientAnalyzeOutput['severity']>

const SYMPTOM_TEXT = 'Chilla al frenar en bajada ZZQX-sintoma-unico'
const declaredSymptom = { vehicleType: 'Sedán', make: 'MarcaUnicaQX', model: 'ModeloUnicoQX', year: '2019', symptomText: SYMPTOM_TEXT }
const declaredBudget = { budgetText: 'Pastillas ZZQX-presupuesto: $ 6.000\nMano de obra: $ 5.000', make: 'MarcaUnicaQX', model: 'ModeloUnicoQX' }

describe('resolveFeedbackFormUrl', () => {
  it.each([
    [FORM, FORM],
    ['  https://forms.gle/AbCdEf123  ', 'https://forms.gle/AbCdEf123'],
    ['https://docs.google.com/forms/d/e/abc/viewform?usp=sf_link', 'https://docs.google.com/forms/d/e/abc/viewform?usp=sf_link'],
  ])('accepts https Google Forms links: %s', (raw, expected) => {
    expect(resolveFeedbackFormUrl(raw)).toBe(expected)
  })

  it.each([
    undefined,
    null,
    '',
    '   ',
    'not a url',
    'http://docs.google.com/forms/d/e/abc/viewform', // not https
    'https://docs.google.com/document/d/abc', // not a form
    'https://forms.gle/', // no form id
    'https://evil.example.com/forms/d/e/abc', // other host
    'https://docs.google.com.evil.example/forms/x',
    'javascript:alert(1)',
    'https://user:pass@docs.google.com/forms/d/e/abc/viewform',
    'https://docs.google.com/forms/d/e/abc/viewform?entry.123=prefilled', // prefill rejected
  ])('rejects %s', (raw) => {
    expect(resolveFeedbackFormUrl(raw as string | undefined | null)).toBeNull()
  })
})

describe('FeedbackInvite', () => {
  it('renders the fixed copy and an accessible, external, voluntary CTA when configured', () => {
    render(<FeedbackInvite formUrl={FORM} />)
    const region = screen.getByRole('region', { name: '¿Te resultó útil Chuya Motor?' })
    expect(region.textContent).toContain('Estamos mejorando la herramienta con la ayuda de quienes la prueban. Tu opinión nos sirve para hacerla más clara y útil.')
    expect(region.textContent).toContain('Es voluntario')
    const link = within(region).getByRole('link', { name: /^Contanos tu experiencia/ })
    expect(link.getAttribute('href')).toBe(FORM)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    screen.getByRole('link', { name: 'Contanos tu experiencia (formulario externo y opcional; se abre en una pestaña nueva)' })
    expect(region.querySelector('[role="alert"]')).toBeNull()
  })

  it('reads NEXT_PUBLIC_FEEDBACK_FORM_URL when no prop is given', () => {
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', FORM)
    render(<FeedbackInvite />)
    expect(screen.getByRole('link', { name: /Contanos tu experiencia/ }).getAttribute('href')).toBe(FORM)
  })

  it.each(['', 'https://example.com/feedback', 'http://forms.gle/abc'])('renders nothing (no broken link) when the variable is %j', (value) => {
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', value)
    const { container } = render(<FeedbackInvite />)
    expect(container.innerHTML).toBe('')
  })
})

describe('integration in the results', () => {
  it('symptom: shown after the report; the link never carries symptom, vehicle or case data', () => {
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', FORM)
    render(<SymptomReport report={SYMPTOM} declared={declaredSymptom} onNewQuery={() => {}} />)
    const report = screen.getByTestId('symptom-report')
    const invite = screen.getByTestId('feedback-invite')
    const href = within(invite).getByRole('link').getAttribute('href')!
    expect(href).toBe(FORM)
    for (const secret of ['ZZQX', 'MarcaUnicaQX', 'ModeloUnicoQX', '2019', 'case-secret-123', 'tensor']) expect(href).not.toContain(secret)
    // Last block of the report (after actions and the coverage disclaimer).
    const actions = screen.getByRole('navigation', { name: 'Acciones del informe' })
    expect(actions.compareDocumentPosition(invite) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(SYMPTOM.coverageDisclaimer).compareDocumentPosition(invite) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(report.lastElementChild).toBe(invite)
  })

  it('budget: shown after the report; the link never carries budget or vehicle data', () => {
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', FORM)
    render(<BudgetReport report={BUDGET} declared={declaredBudget} onNewQuery={() => {}} />)
    const invite = screen.getByTestId('feedback-invite')
    const href = within(invite).getByRole('link').getAttribute('href')!
    expect(href).toBe(FORM)
    for (const secret of ['ZZQX', '6.000', 'MarcaUnicaQX', 'ModeloUnicoQX', 'case-secret-123']) expect(href).not.toContain(secret)
    expect(screen.getByTestId('budget-report').lastElementChild).toBe(invite)
  })

  it('critical severity: the SeverityBanner stays first and the invitation comes after everything else', () => {
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', FORM)
    render(<SymptomReport report={{ ...SYMPTOM, severity: CRITICAL }} declared={declaredSymptom} onNewQuery={() => {}} />)
    const banner = document.querySelector('[data-severity="critical"]')!
    const invite = screen.getByTestId('feedback-invite')
    expect(banner).not.toBeNull()
    expect(banner.compareDocumentPosition(invite) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('alert').every((a) => !invite.contains(a))).toBe(true)
  })

  it('both reports render normally without the variable (no feedback block, no empty link)', () => {
    vi.stubEnv('NEXT_PUBLIC_FEEDBACK_FORM_URL', '')
    render(<SymptomReport report={SYMPTOM} declared={declaredSymptom} onNewQuery={() => {}} />)
    render(<BudgetReport report={BUDGET} declared={declaredBudget} onNewQuery={() => {}} />)
    expect(screen.queryByTestId('feedback-invite')).toBeNull()
    expect(screen.queryByRole('link', { name: /Contanos tu experiencia/ })).toBeNull()
    expect(screen.getByTestId('symptom-report')).toBeTruthy()
    expect(screen.getByTestId('budget-report')).toBeTruthy()
  })
})

describe('sanitizeAnalyticsEvent', () => {
  it('drops query string and hash, keeps the path', () => {
    expect(sanitizeAnalyticsEvent({ type: 'pageview', url: 'https://chuya.example/demo/falla?symptom=frenos&make=Fiat#paso-2' })).toEqual({
      type: 'pageview',
      url: 'https://chuya.example/demo/falla',
    })
    expect(sanitizeAnalyticsEvent({ type: 'pageview', url: 'https://chuya.example/' })?.url).toBe('https://chuya.example/')
  })

  it('drops unparseable events instead of forwarding them', () => {
    expect(sanitizeAnalyticsEvent({ type: 'pageview', url: '::not a url' })).toBeNull()
  })
})
