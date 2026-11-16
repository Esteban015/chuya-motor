/**
 * report-fixtures.ts — SYNTHETIC consultations for the Chuya Informe tests and examples (7F).
 * Shapes follow ClientAnalyzeOutput exactly; no real person, phone, plate, store or price.
 */
import type { ClientAnalyzeOutput } from '@/app/api/analyze/schema'
import type { ResearchLine } from '@/domain/budget/research/types'
import type { DiagnosisReportInput, BudgetReportInput, PricingSnapshot } from '../chuya-report'

const base: ClientAnalyzeOutput = {
  caseId: 'case-internal-123',
  safetyBlocked: false,
  safetyDerivationMessage: null,
  policyVersion: 'policy-internal-v9',
  coverageDisclaimer: 'Chuya Motor brinda orientación general. No reemplaza la inspección de un mecánico matriculado.',
  route: 'symptom',
  facts: [],
  hypotheses: [],
  questions: [],
  driverQuestions: [],
  warnings: [],
  budget: null,
  missingInformation: [],
  fallback: false,
  fallbackText: null,
  aiUnavailable: false,
  nodeTrace: null,
  severity: null,
  aiStatus: { mode: 'ai' },
}

export const DIAGNOSIS_AI: ClientAnalyzeOutput = {
  ...base,
  facts: ['El ruido aparece al frenar', 'Comenzó hace una semana'],
  hypotheses: [
    { statement: 'Desgaste de pastillas de freno delanteras', confidence: 'medium', caveats: ['Puede confundirse con discos rayados', 'Depende del kilometraje desde el último cambio'] },
    { statement: 'Disco de freno con superficie irregular', confidence: 'low', caveats: [] },
  ],
  warnings: ['Si el pedal se hunde o el auto tira hacia un lado, no lo uses y pedí asistencia.'],
  missingInformation: ['Kilometraje desde el último cambio de pastillas'],
  driverQuestions: ['¿El ruido aparece también con el auto en frío?'],
  questions: ['¿Pueden medir el espesor de las pastillas y de los discos?', '¿Conviene rectificar o cambiar los discos?'],
}

export const DIAGNOSIS_AI_DOWN: ClientAnalyzeOutput = {
  ...base,
  fallback: true,
  fallbackText: 'No pudimos generar la orientación automática en este momento.',
  aiStatus: { mode: 'unavailable', reason: 'daily_quota' },
}

export const DIAGNOSIS_CRITICAL: ClientAnalyzeOutput = {
  ...DIAGNOSIS_AI,
  severity: { level: 'critical', title: 'No conduzcas el vehículo', message: 'Los síntomas que describís pueden indicar una pérdida de capacidad de frenado.', action: 'Pedí asistencia mecánica o una grúa.' },
}

export const BUDGET_EXAMPLE_TEXT = 'Aceite motor: 4500\nFiltro de aire: 1500\nFiltro de aceite: 2000\nMano de obra: 3000\nTotal: 12500'

export const BUDGET_DIFFERENCE: ClientAnalyzeOutput = {
  ...base,
  route: 'budget',
  aiStatus: { mode: 'unavailable', reason: 'disabled' },
  aiUnavailable: true,
  questions: ['¿Qué incluye la diferencia entre la suma de las partidas y el total?'],
  budget: {
    completenessStatus: 'COMPLETE',
    computedTotalMinorUnit: 1_100_000,
    computedTotalIsPartial: false,
    currency: 'ARS',
    discrepancy: true,
    lineCount: 4,
    missingLineCount: 0,
    declaredTotalMinorUnit: 1_250_000,
    differenceMinorUnit: 150_000,
    ambiguousLineCount: 0,
    breakdown: { partMinorUnit: 800_000, laborMinorUnit: 300_000, otherMinorUnit: 0, unclassifiedMinorUnit: 0 },
    items: [
      { description: 'Aceite motor', category: 'part', quantity: 1, amountMinorUnit: 450_000, status: 'priced' },
      { description: 'Filtro de aire', category: 'part', quantity: 1, amountMinorUnit: 150_000, status: 'priced' },
      { description: 'Filtro de aceite', category: 'part', quantity: 1, amountMinorUnit: 200_000, status: 'priced' },
      { description: 'Mano de obra', category: 'labor', quantity: 1, amountMinorUnit: 300_000, status: 'priced' },
    ],
    notes: [],
    source: 'deterministic',
  },
}

export const BUDGET_MATCH: ClientAnalyzeOutput = {
  ...BUDGET_DIFFERENCE,
  aiStatus: { mode: 'ai' },
  aiUnavailable: false,
  budget: { ...BUDGET_DIFFERENCE.budget!, declaredTotalMinorUnit: 1_100_000, differenceMinorUnit: 0, discrepancy: false },
}

export const BUDGET_AMBIGUOUS: ClientAnalyzeOutput = {
  ...BUDGET_DIFFERENCE,
  budget: {
    ...BUDGET_DIFFERENCE.budget!,
    completenessStatus: 'PARTIAL',
    computedTotalMinorUnit: 2_500_000,
    computedTotalIsPartial: true,
    discrepancy: null,
    differenceMinorUnit: null,
    declaredTotalMinorUnit: 4_000_000,
    lineCount: 4,
    missingLineCount: 2,
    ambiguousLineCount: 1,
    breakdown: { partMinorUnit: 1_800_000, laborMinorUnit: 700_000, otherMinorUnit: 0, unclassifiedMinorUnit: 0 },
    items: [
      { description: 'Pastillas de freno', category: 'part', quantity: 1, amountMinorUnit: 1_800_000, status: 'priced' },
      { description: 'Discos de freno', category: 'part', quantity: 2, amountMinorUnit: null, status: 'pending' },
      { description: 'Correa', category: 'part', quantity: 1, amountMinorUnit: null, status: 'ambiguous', issue: 'unreadable_amount' },
      { description: 'Mano de obra', category: 'labor', quantity: 1, amountMinorUnit: 700_000, status: 'priced' },
    ],
    notes: ['text_not_interpreted'],
  },
}

const line = (id: string, description: string, category: ResearchLine['category'], workshopPriceMinor: number | null): ResearchLine => ({
  id, description, category, quantity: 1, presentation: 'unit', partBrand: '', partCode: '', workshopPriceMinor, pricePending: false, references: [],
})

export const RESEARCH_LINES: ResearchLine[] = [
  {
    ...line('l1', 'Aceite motor', 'part', 450_000),
    references: [{ id: 'r1', url: 'https://www.ejemplo-sintetico.com.ar/aceite?id=1', store: 'Lubricentro Sintético', priceMinor: 420_000, currency: 'ARS', consultedOn: '2026-11-15', description: 'Aceite 10W40 4 L (referencia sintética)', compatibility: 'unverified', quantity: 1, presentation: 'unit', source: 'user' }],
  },
  line('l2', 'Filtro de aire', 'part', 150_000),
  line('l3', 'Filtro de aceite', 'part', 200_000),
  line('l4', 'Mano de obra', 'labor', 300_000),
]

export const PRICING_WITH_OFFERS: PricingSnapshot = {
  items: [
    {
      partLabel: 'Aceite motor',
      item: {
        lineId: 'l1', status: 'ok', hidden: 0,
        offers: [
          { title: 'Aceite Sintético 10W40 x 4 L (OFERTA SINTÉTICA DE PRUEBA)', merchant: 'Tienda Sintética Uno', priceMinor: 3_270_050, currency: 'ARS', url: 'https://www.google.com.ar/shopping/product/111?prds=synthetic-1&gl=ar', retrievedAt: '2026-11-16T17:10:15.187Z', decision: 'candidate', codeMatch: false, missing: ['part_code', 'presentation'] },
        ],
      },
    },
    { partLabel: 'Filtro de aire', item: { lineId: 'l2', status: 'no_results', offers: [], hidden: 0 } },
    { partLabel: 'Filtro de aceite', item: { lineId: 'l3', status: 'unavailable', reason: 'timeout', offers: [], hidden: 0 } },
  ],
}

export const SAMPLE_DIAGNOSIS: Omit<DiagnosisReportInput, 'generatedAt'> = {
  report: DIAGNOSIS_CRITICAL,
  vehicle: { vehicleType: 'Auto', make: 'Fiat', model: 'Palio', year: '2017', fuelType: 'Nafta', source: 'catalog' },
  symptomText: 'Hace una semana escucho un chirrido al frenar, sobre todo en bajada. Mi celular es 11-2345-6789 por si el taller necesita contactarme.',
  occurrence: 'Al frenar',
}

export const SAMPLE_BUDGET: Omit<BudgetReportInput, 'generatedAt'> = {
  report: BUDGET_DIFFERENCE,
  vehicle: { make: 'Fiat', model: 'Palio', year: '2017', source: 'manual' },
  budgetText: BUDGET_EXAMPLE_TEXT,
  lines: RESEARCH_LINES,
  pricing: PRICING_WITH_OFFERS,
}

// ── 7G: parts research ─────────────────────────────────────────────────────

/** Parts list: brand / code on one part, a user reference, a brake part never searched. */
export const PARTS_LINES: ResearchLine[] = [
  RESEARCH_LINES[0]!,
  { ...RESEARCH_LINES[1]!, partBrand: 'Marca Sintética', partCode: 'FA-1234', quantity: 1 },
  RESEARCH_LINES[2]!,
  { ...line('l5', 'Pastillas de freno delanteras', 'part', null), presentation: 'set' },
  RESEARCH_LINES[3]!,
]

export const PRICING_NO_RESULTS: PricingSnapshot = {
  items: PARTS_LINES.filter((l) => l.category === 'part').map((l) => ({ partLabel: l.description, item: { lineId: l.id, status: 'no_results' as const, offers: [], hidden: 0 } })),
}
