// Incremento 2 — Deterministic mock LLM for integration tests.
// Returns structured responses based on prompt markers — never calls a real LLM.
// Same input always produces the same output (deterministic contract).
import type { LLMAdapter, LLMResult } from './llm-adapter'
import type { BudgetLine } from '@/domain/budget/budget'

export const LLM_MOCK_MODEL = 'deterministic-mock-v1'

interface MockDiagnosisResponse {
  facts: string[]
  hypotheses: Array<{
    statement: string
    confidence: 'low' | 'medium' | 'high'
    caveats: string[]
    evidenceIds: string[]
  }>
  questions: string[]
}

interface MockBudgetParseResponse {
  lines: BudgetLine[]
  declaredTotalMinorUnit: number | null
  currency: 'ARS' | 'USD' | null
}

const MOCK_DIAGNOSIS: MockDiagnosisResponse = {
  facts: ['Síntoma reportado por el usuario (dato no verificado).'],
  hypotheses: [
    {
      statement:
        'Hipótesis orientativa sintética — sin inspección real. Requiere evaluación profesional.',
      confidence: 'low',
      caveats: [
        'Dato sintético de prueba',
        'Sin evidencia verificada',
        'No es diagnóstico definitivo',
      ],
      evidenceIds: [],
    },
  ],
  questions: ['¿Cuándo empezó el problema?', '¿El síntoma es constante o intermitente?'],
}

function parseBudgetFromText(text: string): MockBudgetParseResponse {
  // Mixed currencies → INVALID (Ajuste A)
  const hasARS = /\bARS\b|\bpesos?\b/i.test(text)
  const hasUSD = /\bUSD\b|\bdólares?\b|\bdolares?\b|\bU\$S\b/i.test(text)
  if (hasARS && hasUSD) {
    return {
      lines: [
        {
          status: 'confirmed',
          description: 'Item moneda 1',
          amountMinorUnit: 450000,
          currency: 'ARS',
        },
        {
          status: 'confirmed',
          description: 'Item moneda 2',
          amountMinorUnit: 5000,
          currency: 'USD',
        },
      ],
      declaredTotalMinorUnit: null,
      currency: null,
    }
  }

  const lines: BudgetLine[] = []

  // "description: amount [currency]" — confirmed lines
  const confirmedRe = /^([^\n:]+?):\s*\$?\s*([\d.,]+)\s*(ARS|USD)?\s*$/gim
  let match: RegExpExecArray | null
  while ((match = confirmedRe.exec(text)) !== null) {
    const description = match[1].trim()
    const rawAmount = match[2].replace(',', '.')
    const amount = parseFloat(rawAmount)
    if (isNaN(amount) || description.length === 0) continue
    // Exclude "total / subtotal" lines — handled separately as declaredTotalMinorUnit
    if (/^(total|subtotal)$/i.test(description)) continue
    const currency: 'ARS' | 'USD' = match[3] === 'USD' ? 'USD' : 'ARS'
    lines.push({ status: 'confirmed', description, amountMinorUnit: Math.round(amount * 100), currency })
  }

  // "description: pendiente|por definir|a confirmar" — missing lines
  const missingRe = /^([^\n:]+?):\s*(?:pendiente|por definir|a confirmar|desconocido)\s*$/gim
  while ((match = missingRe.exec(text)) !== null) {
    const description = match[1].trim()
    if (description.length > 0) lines.push({ status: 'missing', description })
  }

  if (lines.length === 0) {
    return { lines: [], declaredTotalMinorUnit: null, currency: null }
  }

  // Declared total (optional)
  const totalRe = /(?:total|subtotal):\s*\$?\s*([\d.,]+)/i
  const totalMatch = totalRe.exec(text)
  const declaredTotalMinorUnit = totalMatch
    ? Math.round(parseFloat(totalMatch[1].replace(',', '.')) * 100)
    : null

  const confirmedCurrencies = new Set(
    lines
      .filter((l): l is Extract<BudgetLine, { status: 'confirmed' }> => l.status === 'confirmed')
      .map((l) => l.currency),
  )
  const currency = confirmedCurrencies.size === 1 ? ([...confirmedCurrencies][0] as 'ARS' | 'USD') : null

  return { lines, declaredTotalMinorUnit, currency }
}

export class DeterministicMockLLMAdapter implements LLMAdapter {
  async complete(prompt: string): Promise<LLMResult> {
    if (prompt.includes('[DIAGNOSIS_REQUEST]')) {
      return { ok: true, content: JSON.stringify(MOCK_DIAGNOSIS) }
    }

    if (prompt.includes('[BUDGET_PARSE_REQUEST]')) {
      const textSection = /\[BUDGET_PARSE_REQUEST\]\n([\s\S]*)/i.exec(prompt)
      const textToParse = textSection?.[1] ?? prompt
      const result = parseBudgetFromText(textToParse)
      return { ok: true, content: JSON.stringify(result) }
    }

    return { ok: true, content: JSON.stringify({ stub: true }) }
  }
}
