/**
 * guidance-safety.test.ts — Incremento 7B: purchase checklist, labor questions and the local
 * Safety Gate used by the parts mode (no API, no LLM).
 */
import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { analyzeCase } from '@/agents/graph/analyze-graph'
import { DeterministicMockLLMAdapter } from '@/agents/llm/deterministic-mock-adapter'
import { purchaseChecklist, laborQuestions, partsQuestions, needsProfessionalInstall } from './guidance'
import { localSafetyCheck, SAFETY_DERIVATION_MESSAGE } from './local-safety'

const NO_PRICE_JUDGEMENT = /caro|barato|precio justo|excesiv|razonable|cobra de m[aá]s|sobreprecio/i

describe('purchaseChecklist', () => {
  it('generic checks always present, no prices', () => {
    const c = purchaseChecklist('Manguera de respiración de gases')
    expect(c.some((x) => /modelo, año y motor/.test(x))).toBe(true)
    expect(c.some((x) => /código/.test(x))).toBe(true)
    expect(c.some((x) => /diámetro|largo|conexiones/.test(x))).toBe(true)
    expect(c.join(' ')).not.toMatch(/\$\s*\d/)
    expect(c.length).toBeLessThanOrEqual(7)
  })

  it.each([
    ['Pastillas de freno delanteras', /eje delantero o trasero/],
    ['Kit de distribución', /tensor/],
    ["Aceite 10W40 4 litros", /viscosidad/i],
    ['Batería 12V', /amperaje|polaridad/],
    ["Amortiguador trasero", /posición/i],
    ['Lámpara H4', /base/],
  ])('%s → specific check', (part, re) => {
    expect(purchaseChecklist(part).join(' ')).toMatch(re)
  })

  it('safety-critical parts recommend professional installation (no DIY)', () => {
    expect(needsProfessionalInstall('Pastillas de freno')).toBe(true)
    expect(needsProfessionalInstall('Extremo de dirección')).toBe(true)
    expect(needsProfessionalInstall('Escobillas')).toBe(false)
    expect(purchaseChecklist('Discos de freno').join(' ')).toMatch(/instalación la haga un taller/)
  })
})

describe('questions', () => {
  it('labor questions: scope, warranty, supplies and included tasks; never a price opinion', () => {
    const q = laborQuestions()
    expect(q.join(' ')).toMatch(/tareas/)
    expect(q.join(' ')).toMatch(/garantía/)
    expect(q.join(' ')).toMatch(/insumos/)
    expect(q.join(' ')).not.toMatch(NO_PRICE_JUDGEMENT)
  })

  it('parts questions: brand, code, warranty and equivalence; never a price opinion', () => {
    const q = partsQuestions()
    expect(q.join(' ')).toMatch(/marca y código/)
    expect(q.join(' ')).not.toMatch(NO_PRICE_JUDGEMENT)
  })
})

describe('localSafetyCheck — same Safety Gate as the server', () => {
  it('a plain parts list is not blocked', () => {
    expect(localSafetyCheck('Manguera de respiración de gases\nFiltro de aceite').blocked).toBe(false)
    expect(localSafetyCheck('Pastillas de freno delanteras\nDiscos de freno').blocked).toBe(false)
  })

  it('DIY intent on a safety system is blocked with the server message', async () => {
    const text = 'Quiero arreglar los frenos yo mismo esta tarde.'
    const local = localSafetyCheck(text)
    expect(local.blocked).toBe(true)
    if (!local.blocked) return
    const server = await analyzeCase(
      { caseId: randomUUID(), userText: text, experienceLevel: 'unknown', dataLabel: 'synthetic_demo' },
      { llmAdapter: new DeterministicMockLLMAdapter() },
    )
    expect(server.safetyBlocked).toBe(true)
    expect(local.payload.safetyDerivationMessage).toBe(server.safetyDerivationMessage)
    expect(local.payload.policyVersion).toBe(server.policyVersion)
    expect(local.payload.coverageDisclaimer).toBe(server.coverageDisclaimer)
    expect(SAFETY_DERIVATION_MESSAGE).toBe(server.safetyDerivationMessage)
  })

  it.each(['Extremo de dirección\nRótula', 'Bomba de nafta', 'Batería 12V', 'Airbag del conductor', 'Manguera de nafta'])(
    'the bare name of a safety-system part is not blocked (no generated text): %s',
    (text) => {
      expect(localSafetyCheck(text).blocked).toBe(false)
    },
  )

  it.each(['Cómo cambio las pastillas de freno yo mismo', 'Noto una perdida de frenos total cuando freno en la autopista.'])(
    'DIY intent or loss of braking is blocked: %s',
    (text) => {
      expect(localSafetyCheck(text).blocked).toBe(true)
    },
  )

  it('a blocked hazard keeps its critical warning (e.g. fuel leak)', () => {
    const r = localSafetyCheck('Tengo olor a nafta y una pérdida de combustible')
    expect(r.blocked).toBe(true)
    if (r.blocked) expect(r.payload.severity?.level).toBe('critical')
  })
})
