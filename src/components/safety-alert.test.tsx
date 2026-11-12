// @vitest-environment jsdom
/**
 * safety-alert.test.tsx — Incremento 6.4B (D-02)
 * The blocked-query alert must show an explicit critical "No conduzcas" warning when the server
 * sends a critical severity, inside the existing role="alert" container.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { SafetyAlert } from './safety-alert'

const CRITICAL = {
  level: 'critical' as const,
  title: 'Atención: síntoma crítico de seguridad',
  message: 'El problema descripto podría comprometer seriamente el sistema de frenos.',
  action: 'No conduzcas el vehículo. Solicitá asistencia profesional antes de volver a utilizarlo.',
}
const BASE = {
  message: 'Por seguridad, este tipo de intervención requiere atención profesional.',
  policyVersion: '1.3.0',
  coverageDisclaimer: 'Este análisis automático no reemplaza la inspección de un profesional.',
}

afterEach(cleanup)

describe('D-02 / UI-SA-01: SafetyAlert with critical severity', () => {
  it('renders "No conduzcas" and the critical title inside the single role="alert"', () => {
    render(<SafetyAlert {...BASE} severity={CRITICAL} />)
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    const alert = alerts[0]!
    expect(within(alert).getByText(/No conduzcas el vehículo/)).toBeTruthy()
    expect(within(alert).getByText(CRITICAL.title)).toBeTruthy()
    expect(within(alert).getByText('Consulta bloqueada por seguridad')).toBeTruthy()
    expect(alert.querySelector('[data-severity="critical"]')).not.toBeNull()
  })
})

describe('D-02 / UI-SA-02: SafetyAlert without severity is unchanged', () => {
  it.each([undefined, null])('severity=%s → no critical block', (severity) => {
    render(<SafetyAlert {...BASE} severity={severity} />)
    const alert = screen.getByRole('alert')
    expect(alert.querySelector('[data-severity]')).toBeNull()
    expect(within(alert).queryByText(/No conduzcas/)).toBeNull()
    expect(within(alert).getByText('Consulta bloqueada por seguridad')).toBeTruthy()
  })

  it('a non-critical severity is not rendered as a blocked-case alert', () => {
    render(<SafetyAlert {...BASE} severity={{ ...CRITICAL, level: 'high' }} />)
    expect(screen.getByRole('alert').querySelector('[data-severity]')).toBeNull()
  })
})
