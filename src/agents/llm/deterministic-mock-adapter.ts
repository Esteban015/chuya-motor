// Incremento 2 — Deterministic mock LLM for integration tests.
// Returns structured responses based on prompt markers — never calls a real LLM.
// Same input always produces the same output (deterministic contract).
import type { LLMAdapter, LLMCompletionRequest, LLMResult } from './llm-adapter'
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
    const amount = parseAmountEsAR(match[2])
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

  // Declared total (optional) — parsed with es-AR locale rules
  const totalRe = /(?:total|subtotal):\s*\$?\s*([\d.,]+)/i
  const totalMatch = totalRe.exec(text)
  const declaredTotalMinorUnit = totalMatch
    ? Math.round(parseAmountEsAR(totalMatch[1]) * 100)
    : null

  const confirmedCurrencies = new Set(
    lines
      .filter((l): l is Extract<BudgetLine, { status: 'confirmed' }> => l.status === 'confirmed')
      .map((l) => l.currency),
  )
  const currency = confirmedCurrencies.size === 1 ? ([...confirmedCurrencies][0] as 'ARS' | 'USD') : null

  return { lines, declaredTotalMinorUnit, currency }
}

// Parse a monetary amount string using es-AR locale rules (DEF-03 fix):
//   - Dot = thousands separator when followed by exactly 3 digits (e.g. "15.000" → 15000)
//   - Comma = decimal separator (e.g. "4500,50" → 4500.50)
//   - Combined: "15.000,50" → 15000.50
//   - Plain integer or simple decimal: "4500" / "15.5" handled as-is
// Never uses parseFloat on localized strings directly.
function parseAmountEsAR(raw: string): number {
  const s = raw.replace(/[$\s]/g, '').trim()

  // es-AR full: "15.000,50" or "1.500,00" — thousands dot + decimal comma
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    const noThousands = s.replace(/\./g, '')
    return parseFloat(noThousands.replace(',', '.'))
  }

  // es-AR decimal only: "1500,50"
  if (/^\d+,\d{1,2}$/.test(s)) {
    return parseFloat(s.replace(',', '.'))
  }

  // Plain integer or simple decimal: "4500", "15.5"
  return parseFloat(s.replace(',', '.'))
}

export class DeterministicMockLLMAdapter implements LLMAdapter {
  readonly modelId = LLM_MOCK_MODEL

  async complete(req: LLMCompletionRequest): Promise<LLMResult> {
    // Marker-based routing: check system field (and userContent for backward compat)
    const combined = `${req.system}\n${req.userContent}`

    if (combined.includes('[DIAGNOSIS_REQUEST]')) {
      return { ok: true, content: JSON.stringify(MOCK_DIAGNOSIS) }
    }

    if (combined.includes('[BUDGET_PARSE_REQUEST]')) {
      // userContent is the user budget text — parse it directly
      const result = parseBudgetFromText(req.userContent)
      return { ok: true, content: JSON.stringify(result) }
    }

    return { ok: true, content: JSON.stringify({ stub: true }) }
  }
}
