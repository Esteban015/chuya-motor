/**
 * chuya-report.ts — "Chuya Informe" (Incremento 7F): the printable report of a consultation, built
 * ONLY from data the page already has (server output, the person's own input, the parts research
 * and the published offers already shown). Pure: no LLM, no provider search, no network.
 *
 * The same model feeds the PDF renderer (pdf-renderer.ts) and the HTML preview / print view, so
 * what the person previews is what they download.
 *
 * Rules:
 *   - Every section states where its content comes from: declared by the person, calculated by
 *     Chuya Motor, generated with AI (orientative) or published by third parties (unverified).
 *   - Hypotheses stay hypotheses; offers are never budgets and never declared compatible.
 *   - Severity warnings come first and cannot be removed. A Safety-Gate-blocked consultation has
 *     no report (the page shows the safety message instead).
 *   - Personal data in free text is redacted by default; the original text can be left out.
 *   - No internal ids (caseId, policy version, trace), keys, IPs or cookies ever enter the model.
 */
import type { AiStatus, ClientAnalyzeOutput, ClientBudgetItem, ClientBudgetNote, ClientBudgetOutput } from '@/app/api/analyze/schema'
import { contentFor } from '@/components/fallback-alert'
import { CONFIDENCE_LABEL, BUDGET_STATUS_LABEL, budgetComparison, formatMoney } from '@/components/results/format'
import { buildPartSearch } from '@/domain/budget/research/part-search'
import { laborQuestions, partsQuestions, purchaseChecklist } from '@/domain/budget/research/guidance'
import { COMPATIBILITY_LABEL, PRESENTATION_LABEL, type PartReference, type ResearchLine } from '@/domain/budget/research/types'
import { ITEM_REASON_LABEL, MISSING_DATA_LABEL, pricingLineId, safeOfferUrl, type ClientOffer, type ClientPricedItem } from '@/domain/budget/research/parts-prices-contract'
import { personalDataKinds, redactPersonalData, type PersonalDataKind } from './personal-data'
import { sanitizeExportUrl } from './export-url'

// ── Model ────────────────────────────────────────────────────────────────────

export type Provenance = 'declared' | 'calculated' | 'ai' | 'external' | 'system'

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  declared: 'Datos ingresados por vos (no verificados)',
  calculated: 'Cálculo automático de Chuya Motor, sin IA',
  ai: 'Orientación generada automáticamente: no es un diagnóstico confirmado',
  external: 'Publicaciones de terceros: compatibilidad no verificada',
  system: 'Información de Chuya Motor',
}

export interface ReportLink {
  label: string
  url: string
}

export type ReportBlock =
  | { kind: 'paragraph'; text: string; tone?: 'normal' | 'muted' | 'strong' }
  | { kind: 'alert'; level: 'critical' | 'high' | 'info'; title: string; lines: string[] }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'keyValues'; rows: Array<[string, string]> }
  | { kind: 'table'; columns: string[]; widths: number[]; align?: Array<'left' | 'right'>; rows: string[][] }
  | { kind: 'preformatted'; text: string }
  | { kind: 'entry'; title: string; lines: string[]; badges: string[]; link?: ReportLink }

export interface ReportSection {
  id: string
  title: string
  provenance?: Provenance
  blocks: ReportBlock[]
}

export interface ChuyaReport {
  variant: 'diagnosis' | 'budget' | 'parts'
  title: string
  subtitle: string
  generatedAtLabel: string
  sections: ReportSection[]
  disclaimer: string
  /** Generic, without personal data (e.g. "chuya-informe-presupuesto-2026-11-16.pdf"). */
  fileName: string
}

export interface PrivacyOptions {
  /** Replace detected personal data in free text with "[dato personal omitido]". Default true. */
  redactPersonalData: boolean
  /** Include the person's original text (symptom / budget as pasted). Default true. */
  includeOriginalText: boolean
}

export const DEFAULT_PRIVACY: PrivacyOptions = { redactPersonalData: true, includeOriginalText: true }

export interface DeclaredVehicle {
  vehicleType?: string
  make?: string
  model?: string
  year?: string
  engine?: string
  fuelType?: string
  /** 'catalog' = chosen in the 7D selector; 'manual' = typed by the person. */
  source?: 'catalog' | 'manual'
}

/** What the automatic search (7C) showed, as displayed on the page. */
export interface PricingSnapshot {
  items: Array<{ partLabel: string; item: ClientPricedItem }>
}

export type Readiness = { ok: true } | { ok: false; reason: 'safety_blocked' | 'insufficient' }

// ── Shared helpers ──────────────────────────────────────────────────────────

const TZ = 'America/Argentina/Buenos_Aires'

export function formatReportDate(d: Date): string {
  const date = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ })
  const time = d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ })
  return `${date} ${time} (hora de Argentina)`
}

function isoDay(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).format(d)
  return parts.replace(/[^\d-]/g, '')
}

function formatOfferDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'fecha desconocida' : formatReportDate(d)
}

function ymdToAr(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd
}

const DISCLAIMER =
  'Documento generado automáticamente por Chuya Motor a partir de los datos que ingresaste. Es orientativo: no es un diagnóstico, una tasación ni un presupuesto, y no está certificado ni revisado por ningún taller. Confirmá todo con un profesional antes de decidir.'

/** Text helper bound to the privacy options: every user-derived string goes through it. */
function textFilter(privacy: PrivacyOptions) {
  return (s: string | null | undefined): string => {
    const t = (s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮]/g, '').trim()
    return privacy.redactPersonalData ? redactPersonalData(t) : t
  }
}

export function aiStatusLines(status: AiStatus | undefined, report: Pick<ClientAnalyzeOutput, 'fallback' | 'fallbackText'>, variant: ChuyaReport['variant'], aiUnavailable = false): { title: string; lines: string[] } {
  if (report.fallback || status?.mode === 'withheld' || status?.mode === 'unavailable' || aiUnavailable) {
    const { title, body } = contentFor(status, report.fallback ? report.fallbackText : null)
    const lines = body ? [body] : []
    if (variant === 'budget' && !report.fallback) lines.push('La verificación de importes no usa IA: sus resultados son válidos.')
    return { title, lines }
  }
  switch (status?.mode) {
    case 'ai':
      return { title: 'Procesado con IA (piloto)', lines: [variant === 'budget' ? 'La IA sólo ayuda a interpretar el texto; la suma la calcula Chuya Motor sin IA.' : 'Las respuestas son orientativas y deben verificarse en un taller.'] }
    case 'simulated':
      return { title: 'Respuesta de demostración', lines: ['El contenido fue generado por el modo de demostración, no por un modelo de IA real.'] }
    default:
      return { title: 'Sin procesamiento de IA', lines: [] }
  }
}

function vehicleSection(v: DeclaredVehicle, t: (s: string | undefined) => string): ReportSection {
  const rows = (
    [
      ['Tipo', v.vehicleType],
      ['Marca', v.make],
      ['Modelo', v.model],
      ['Año', v.year],
      ['Motor', v.engine],
      ['Combustible', v.fuelType],
    ] as Array<[string, string | undefined]>
  )
    .map(([k, val]) => [k, t(val)] as [string, string])
    .filter(([, val]) => val)
  const blocks: ReportBlock[] = []
  if (rows.length > 0) blocks.push({ kind: 'keyValues', rows })
  const missing = (['Marca', 'Modelo', 'Año'] as const).filter((k) => !rows.some(([r]) => r === k))
  if (rows.length === 0) blocks.push({ kind: 'paragraph', text: 'No informaste datos del vehículo. Llevá la marca, el modelo y el año al taller.', tone: 'muted' })
  else if (missing.length > 0) blocks.push({ kind: 'paragraph', text: `Datos del vehículo incompletos: falta ${missing.join(', ').toLowerCase()}.`, tone: 'muted' })
  if (rows.length > 0) {
    blocks.push({
      kind: 'paragraph',
      tone: 'muted',
      text: v.source === 'catalog' ? 'Vehículo elegido del catálogo de Chuya Motor.' : 'Vehículo ingresado manualmente (no verificado contra un catálogo).',
    })
  }
  return { id: 'vehicle', title: 'Vehículo', provenance: 'declared', blocks }
}

function severitySection(report: ClientAnalyzeOutput): ReportSection | null {
  const s = report.severity
  if (!s || s.level === 'normal') return null
  return {
    id: 'severity',
    title: s.level === 'critical' ? 'Advertencia de seguridad crítica' : 'Advertencia de seguridad',
    provenance: 'system',
    blocks: [{ kind: 'alert', level: s.level, title: s.title, lines: [s.message, s.action].filter(Boolean) }],
  }
}

function questionSections(report: ClientAnalyzeOutput, t: (s: string) => string): ReportSection[] {
  const out: ReportSection[] = []
  const driver = (report.driverQuestions ?? []).map(t).filter(Boolean)
  const workshop = report.questions.map(t).filter(Boolean)
  if (driver.length) out.push({ id: 'driver-questions', title: 'Para preparar la consulta', provenance: 'ai', blocks: [{ kind: 'list', items: driver }] })
  if (workshop.length) out.push({ id: 'workshop-questions', title: 'Preguntas para el taller', provenance: 'ai', blocks: [{ kind: 'list', items: workshop, ordered: true }] })
  return out
}

const VARIANT_TITLE: Record<ChuyaReport['variant'], string> = {
  diagnosis: 'Informe de diagnóstico orientativo',
  budget: 'Informe de revisión de presupuesto',
  parts: 'Informe de consulta de repuestos',
}
const VARIANT_FILE: Record<ChuyaReport['variant'], string> = { diagnosis: 'diagnostico', budget: 'presupuesto', parts: 'repuestos' }

function header(variant: ChuyaReport['variant'], generatedAt: Date) {
  return {
    variant,
    title: VARIANT_TITLE[variant],
    subtitle: 'Chuya Informe · para llevar al taller',
    generatedAtLabel: `Generado el ${formatReportDate(generatedAt)}`,
    disclaimer: DISCLAIMER,
    fileName: `chuya-informe-${VARIANT_FILE[variant]}-${isoDay(generatedAt)}.pdf`,
  }
}

// ── A. Diagnosis ─────────────────────────────────────────────────────────────

export interface DiagnosisReportInput {
  report: ClientAnalyzeOutput
  vehicle: DeclaredVehicle
  symptomText: string
  occurrence?: string
  generatedAt: Date
  privacy?: PrivacyOptions
}

export function diagnosisReadiness(input: Pick<DiagnosisReportInput, 'report' | 'symptomText'>): Readiness {
  const r = input.report
  if (r.safetyBlocked) return { ok: false, reason: 'safety_blocked' }
  const content = r.hypotheses.length + r.warnings.length + r.questions.length + (r.driverQuestions?.length ?? 0) + r.facts.length + r.missingInformation.length
  if (content === 0 && !input.symptomText.trim() && !r.severity) return { ok: false, reason: 'insufficient' }
  return { ok: true }
}

export function buildDiagnosisReport(input: DiagnosisReportInput): ChuyaReport {
  const privacy = input.privacy ?? DEFAULT_PRIVACY
  const t = textFilter(privacy)
  const r = input.report
  const sections: ReportSection[] = []

  const severity = severitySection(r)
  if (severity) sections.push(severity)

  const ai = aiStatusLines(r.aiStatus, r, 'diagnosis')
  sections.push({ id: 'ai-status', title: 'Estado del análisis', provenance: 'system', blocks: [{ kind: 'keyValues', rows: [['Procesamiento', ai.title]] }, ...ai.lines.map((l) => ({ kind: 'paragraph' as const, text: l, tone: 'muted' as const }))] })

  sections.push(vehicleSection(input.vehicle, t))

  const symptomBlocks: ReportBlock[] = []
  if (privacy.includeOriginalText && t(input.symptomText)) symptomBlocks.push({ kind: 'preformatted', text: t(input.symptomText) })
  else symptomBlocks.push({ kind: 'paragraph', text: 'Elegiste no incluir el texto original del síntoma.', tone: 'muted' })
  if (input.occurrence) symptomBlocks.push({ kind: 'keyValues', rows: [['Cuándo ocurre', t(input.occurrence)]] })
  sections.push({ id: 'symptom', title: 'Síntomas informados', provenance: 'declared', blocks: symptomBlocks })

  const facts = r.facts.map(t).filter(Boolean)
  if (facts.length) sections.push({ id: 'facts', title: 'Datos tomados de tu relato', provenance: 'ai', blocks: [{ kind: 'list', items: facts }] })

  // Withheld answers are never exported (the server already returns no hypotheses for them).
  if (r.hypotheses.length > 0 && r.aiStatus?.mode !== 'withheld') {
    const blocks: ReportBlock[] = [{ kind: 'paragraph', text: 'Posibilidades a verificar en un taller. No son diagnósticos confirmados y la confianza no es una probabilidad.', tone: 'muted' }]
    r.hypotheses.forEach((h, i) => {
      blocks.push({
        kind: 'entry',
        title: `${i + 1}. ${t(h.statement)}`,
        badges: [`Confianza ${CONFIDENCE_LABEL[h.confidence]}`, 'Hipótesis a verificar'],
        lines: h.caveats.map(t).filter(Boolean).map((c) => `Incertidumbre: ${c}`),
      })
    })
    sections.push({ id: 'hypotheses', title: 'Hipótesis orientativas', provenance: 'ai', blocks })
  } else {
    sections.push({ id: 'hypotheses', title: 'Hipótesis orientativas', provenance: 'system', blocks: [{ kind: 'paragraph', text: 'Esta consulta no tiene hipótesis para mostrar. Describí el síntoma al taller con los datos de este informe.', tone: 'muted' }] })
  }

  const warnings = r.warnings.map(t).filter(Boolean)
  if (warnings.length) sections.push({ id: 'warnings', title: 'Advertencias', provenance: 'system', blocks: [{ kind: 'list', items: warnings }] })

  const missing = r.missingInformation.map(t).filter(Boolean)
  if (missing.length) sections.push({ id: 'missing', title: 'Datos faltantes', provenance: 'ai', blocks: [{ kind: 'list', items: missing }] })

  sections.push(...questionSections(r, t))
  if (r.coverageDisclaimer) sections.push({ id: 'coverage', title: 'Alcance', provenance: 'system', blocks: [{ kind: 'paragraph', text: r.coverageDisclaimer, tone: 'muted' }] })

  return { ...header('diagnosis', input.generatedAt), sections }
}

// ── B. Budget ────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<ClientBudgetItem['category'], string> = { part: 'Repuesto', labor: 'Mano de obra', other: 'Otro concepto', unclassified: 'Sin clasificar' }

const ITEM_STATE: Record<ClientBudgetItem['status'], string> = { priced: 'Sumada', pending: 'A confirmar', missing: 'Sin importe', ambiguous: 'No se suma' }

const ISSUE_LABEL: Record<NonNullable<ClientBudgetItem['issue']>, string> = {
  unreadable_amount: 'Importe no legible',
  amount_without_separator: 'Número sin «:» (¿importe o código?)',
  discount_sign: 'Descuento: no sabemos si ya está aplicado',
  unverified_amount: 'Importe que no figura en el texto',
}

const NOTE_LABEL: Record<ClientBudgetNote, string> = {
  declared_total_conflict: 'Hay más de una línea de total con importes distintos: no se usó para comparar.',
  declared_total_unreadable: 'No se pudo leer el importe de la línea de total.',
  lines_truncated: 'El presupuesto tiene más de 50 líneas: sólo se leyeron las primeras 50.',
  text_not_interpreted: 'Algunas líneas no parecen partidas (títulos o comentarios) y no se tuvieron en cuenta.',
}

export interface BudgetReportInput {
  report: ClientAnalyzeOutput
  vehicle: DeclaredVehicle
  budgetText: string
  /** The parts research list (7B), with the person's own price references. */
  lines?: readonly ResearchLine[]
  /** Offers already shown by the automatic search (7C), if the person searched. */
  pricing?: PricingSnapshot | null
  generatedAt: Date
  privacy?: PrivacyOptions
}

export function budgetReadiness(input: Pick<BudgetReportInput, 'report'>): Readiness {
  const r = input.report
  if (r.safetyBlocked) return { ok: false, reason: 'safety_blocked' }
  const hasBudget = r.route === 'budget' && r.budget !== null
  if (!hasBudget && r.questions.length + (r.driverQuestions?.length ?? 0) + r.warnings.length === 0 && !r.severity) return { ok: false, reason: 'insufficient' }
  return { ok: true }
}

function verificationBlocks(b: ClientBudgetOutput, budgetText: string): ReportBlock[] {
  const money = (v: number) => formatMoney(v, b.currency ?? 'ARS')
  const rows: Array<[string, string]> = [['Estado', BUDGET_STATUS_LABEL[b.completenessStatus]]]
  if (b.computedTotalMinorUnit !== null) rows.push([b.computedTotalIsPartial ? 'Suma parcial de partidas' : 'Suma de partidas', money(b.computedTotalMinorUnit)])
  let declared = b.declaredTotalMinorUnit
  let difference = b.differenceMinorUnit ?? null
  if (declared === undefined) {
    // Server predating 7E: the 6.6 comparison, consistent with the server flag.
    const c = budgetComparison(b, budgetText)
    declared = 'declared' in c ? c.declared : null
    difference = c.kind === 'mismatch' ? c.difference : c.kind === 'match' ? 0 : null
  }
  rows.push(['Total declarado', declared != null ? money(declared) : 'No figura o no se pudo leer'])
  if (b.breakdown) {
    rows.push(['Repuestos', money(b.breakdown.partMinorUnit)], ['Mano de obra', money(b.breakdown.laborMinorUnit)])
    if (b.breakdown.otherMinorUnit > 0) rows.push(['Otros conceptos', money(b.breakdown.otherMinorUnit)])
    if (b.breakdown.unclassifiedMinorUnit > 0) rows.push(['Sin clasificar', money(b.breakdown.unclassifiedMinorUnit)])
  }
  rows.push(['Partidas', String(b.lineCount)])
  const blocks: ReportBlock[] = [{ kind: 'keyValues', rows }]

  if (b.completenessStatus === 'COMPLETE' && b.discrepancy === true && difference !== null && difference !== 0) {
    blocks.push({ kind: 'alert', level: 'info', title: `Diferencia aritmética: ${money(Math.abs(difference))}`, lines: [`El total declarado es ${difference > 0 ? 'mayor' : 'menor'} que la suma de las partidas. Es una diferencia de cuentas, no una opinión sobre los precios: consultala con el taller.`] })
  } else if (b.completenessStatus === 'COMPLETE' && b.discrepancy === true) {
    blocks.push({ kind: 'alert', level: 'info', title: 'El total declarado no coincide con la suma calculada', lines: ['Consultá la diferencia con el taller.'] })
  } else if (b.completenessStatus === 'COMPLETE' && b.discrepancy === false) {
    blocks.push({ kind: 'paragraph', text: 'El total declarado coincide con la suma de las partidas.', tone: 'strong' })
  } else if (b.completenessStatus === 'PARTIAL') {
    blocks.push({ kind: 'paragraph', text: 'Hay partidas sin importe o con importes ambiguos: la suma es parcial y no se compara con el total declarado.', tone: 'muted' })
  } else if (b.completenessStatus === 'INVALID') {
    blocks.push({ kind: 'paragraph', text: 'No pudimos verificar la suma: el texto no tiene partidas con importes legibles.', tone: 'muted' })
  } else if (declared == null) {
    blocks.push({ kind: 'paragraph', text: 'El presupuesto no tiene un total declarado: sólo se muestra la suma.', tone: 'muted' })
  }
  return blocks
}

function itemsTable(items: readonly ClientBudgetItem[], currency: string | null, t: (s: string) => string): ReportBlock {
  return {
    kind: 'table',
    columns: ['Concepto', 'Tipo', 'Importe', 'Estado'],
    widths: [0.42, 0.18, 0.18, 0.22],
    align: ['left', 'left', 'right', 'left'],
    rows: items.map((i) => [
      `${t(i.description)}${i.quantity > 1 ? ` (x${i.quantity})` : ''}`,
      CATEGORY_LABEL[i.category],
      i.amountMinorUnit !== null ? formatMoney(i.amountMinorUnit, currency ?? 'ARS') : '—',
      i.issue ? ISSUE_LABEL[i.issue] : ITEM_STATE[i.status],
    ]),
  }
}

function offerEntry(o: ClientOffer, t: (s: string) => string): ReportBlock {
  // Same rule as the on-screen panel: only https Google Shopping product pages become links.
  const host = safeOfferUrl(o.url)
  const url = host ? sanitizeExportUrl(host) : null
  return {
    kind: 'entry',
    title: t(o.title),
    badges: ['Compatibilidad no verificada', 'No es un presupuesto'],
    lines: [
      `Precio publicado: ${formatMoney(o.priceMinor, 'ARS')}`,
      `Comercio: ${t(o.merchant)}`,
      `Consultado: ${formatOfferDate(o.retrievedAt)}`,
      ...(o.missing.length ? [`Falta confirmar: ${o.missing.map((m) => MISSING_DATA_LABEL[m]).join('; ')}`] : []),
    ],
    ...(url ? { link: { label: 'Ver publicación', url } } : {}),
  }
}

/** A price reference typed in by the person (7B "manual search" result). */
function referenceEntry(r: PartReference, t: (s: string) => string): ReportBlock {
  const url = sanitizeExportUrl(r.url)
  return {
    kind: 'entry',
    title: t(r.description) || t(r.store) || 'Referencia',
    badges: [COMPATIBILITY_LABEL[r.compatibility]],
    lines: [
      `Precio: ${r.priceMinor !== null ? formatMoney(r.priceMinor, 'ARS') : 'sin precio'} (${r.quantity} × ${PRESENTATION_LABEL[r.presentation].toLowerCase()})`,
      ...(r.store ? [`Comercio: ${t(r.store)}`] : []),
      `Consultado: ${ymdToAr(r.consultedOn)}`,
    ],
    ...(url ? { link: { label: 'Ver referencia', url } } : {}),
  }
}

/** One part's automatic search result, exactly as shown on screen (never a new search). */
function pricingItemBlocks(item: ClientPricedItem, t: (s: string) => string): ReportBlock[] {
  if (item.status === 'ok' && item.offers.length > 0) {
    const blocks = item.offers.slice(0, 5).map((o) => offerEntry(o, t))
    if (item.hidden > 0) blocks.push({ kind: 'paragraph', tone: 'muted', text: `${item.hidden === 1 ? 'Se ocultó 1 publicación' : `Se ocultaron ${item.hidden} publicaciones`} que no mencionan el modelo del vehículo.` })
    return blocks
  }
  if (item.status === 'no_results' || item.status === 'ok') return [{ kind: 'paragraph', text: 'No se encontraron publicaciones para este repuesto.', tone: 'muted' }]
  return [{ kind: 'paragraph', text: ITEM_REASON_LABEL[item.reason ?? ''] ?? 'No se pudo buscar este repuesto automáticamente.', tone: 'muted' }]
}

function referencesSections(lines: readonly ResearchLine[], pricing: PricingSnapshot | null | undefined, t: (s: string) => string): ReportSection[] {
  const out: ReportSection[] = []
  const withRefs = lines.filter((l) => l.category === 'part' && l.references.length > 0)
  if (withRefs.length) {
    const blocks: ReportBlock[] = [{ kind: 'paragraph', text: 'Precios que encontraste y cargaste vos. Chuya Motor no los consultó ni los verificó.', tone: 'muted' }]
    for (const l of withRefs) {
      blocks.push({ kind: 'paragraph', text: t(l.description), tone: 'strong' })
      for (const r of l.references) blocks.push(referenceEntry(r, t))
    }
    out.push({ id: 'user-references', title: 'Tus referencias de precios', provenance: 'declared', blocks })
  }

  if (pricing && pricing.items.length > 0) {
    const blocks: ReportBlock[] = [
      {
        kind: 'paragraph',
        tone: 'muted',
        text: 'Precios publicados por comercios en Google Shopping al momento de la búsqueda. No son presupuestos, no incluyen mano de obra ni envío, y no confirmamos que las piezas sirvan para tu vehículo. Confirmá código, presentación y estado con el comercio o el taller.',
      },
    ]
    for (const { partLabel, item } of pricing.items) {
      blocks.push({ kind: 'paragraph', text: t(partLabel), tone: 'strong' })
      blocks.push(...pricingItemBlocks(item, t))
    }
    out.push({ id: 'offers', title: 'Referencias comerciales encontradas automáticamente', provenance: 'external', blocks })
  }
  return out
}

export function buildBudgetReport(input: BudgetReportInput): ChuyaReport {
  const privacy = input.privacy ?? DEFAULT_PRIVACY
  const t = textFilter(privacy)
  const r = input.report
  const b = r.route === 'budget' ? r.budget : null
  const sections: ReportSection[] = []

  const severity = severitySection(r)
  if (severity) sections.push(severity)

  const ai = aiStatusLines(r.aiStatus, r, 'budget', r.aiUnavailable === true)
  sections.push({ id: 'ai-status', title: 'Estado del análisis', provenance: 'system', blocks: [{ kind: 'keyValues', rows: [['Procesamiento', ai.title]] }, ...ai.lines.map((l) => ({ kind: 'paragraph' as const, text: l, tone: 'muted' as const }))] })

  sections.push(vehicleSection(input.vehicle, t))

  if (b) {
    sections.push({ id: 'verification', title: 'Verificación de importes', provenance: 'calculated', blocks: verificationBlocks(b, input.budgetText) })
    const items = b.items ?? []
    if (items.length) {
      const blocks: ReportBlock[] = [itemsTable(items, b.currency, t)]
      if (b.source === 'llm') blocks.push({ kind: 'paragraph', text: 'Partidas interpretadas con ayuda de IA: sólo se suman importes que figuran escritos en tu texto.', tone: 'muted' })
      sections.push({ id: 'items', title: 'Partidas interpretadas', provenance: 'calculated', blocks })
    }
    const unclear = items.filter((i) => i.status !== 'priced')
    const notes = (b.notes ?? []).map((n) => NOTE_LABEL[n])
    if (unclear.length || notes.length) {
      const list = [...unclear.map((i) => `${t(i.description)}: ${i.issue ? ISSUE_LABEL[i.issue] : ITEM_STATE[i.status]}`), ...notes]
      sections.push({ id: 'unclear', title: 'Líneas ambiguas o sin importe', provenance: 'calculated', blocks: [{ kind: 'list', items: list }] })
    }
  }

  sections.push({
    id: 'original',
    title: 'Presupuesto original declarado',
    provenance: 'declared',
    blocks: privacy.includeOriginalText && t(input.budgetText) ? [{ kind: 'preformatted', text: t(input.budgetText) }] : [{ kind: 'paragraph', text: 'Elegiste no incluir el texto original del presupuesto.', tone: 'muted' }],
  })

  const missing = r.missingInformation.map(t).filter(Boolean)
  if (missing.length) sections.push({ id: 'missing', title: 'Observaciones', provenance: 'ai', blocks: [{ kind: 'list', items: missing }] })
  const warnings = r.warnings.map(t).filter(Boolean)
  if (warnings.length) sections.push({ id: 'warnings', title: 'Advertencias', provenance: 'system', blocks: [{ kind: 'list', items: warnings }] })

  sections.push(...questionSections(r, t))
  sections.push(...referencesSections(input.lines ?? [], input.pricing, t))
  if (r.coverageDisclaimer) sections.push({ id: 'coverage', title: 'Alcance', provenance: 'system', blocks: [{ kind: 'paragraph', text: r.coverageDisclaimer, tone: 'muted' }] })

  return { ...header('budget', input.generatedAt), sections }
}

// ── C. Parts research (7G) ───────────────────────────────────────────────────

export interface PartsReportInput {
  /** The parts list as edited on screen (7B), with the person's own references. */
  lines: readonly ResearchLine[]
  vehicle: DeclaredVehicle
  /** Offers already shown by the automatic search (7C), if the person searched. */
  pricing?: PricingSnapshot | null
  /** Whether the automatic search exists on this site (server flag). */
  autoPricingEnabled: boolean
  generatedAt: Date
  privacy?: PrivacyOptions
}

export type PartSearchState = 'found' | 'no_results' | 'unavailable' | 'not_searched' | 'not_available'

export const PART_SEARCH_STATE_LABEL: Record<PartSearchState, string> = {
  found: 'Publicaciones encontradas',
  no_results: 'Sin resultados',
  unavailable: 'Proveedor no disponible',
  not_searched: 'Búsqueda no realizada',
  not_available: 'Búsqueda automática no disponible',
}

export function partsReadiness(input: Pick<PartsReportInput, 'lines'>): Readiness {
  return input.lines.some((l) => l.category === 'part' && l.description.trim()) ? { ok: true } : { ok: false, reason: 'insufficient' }
}

/** The automatic search result shown for a line, if any (matched by the id the panel sent). */
function pricingFor(line: ResearchLine, pricing: PricingSnapshot | null | undefined): ClientPricedItem | null {
  const id = pricingLineId(line.id)
  return pricing?.items.find((i) => i.item.lineId === id)?.item ?? null
}

export function partSearchState(line: ResearchLine, pricing: PricingSnapshot | null | undefined, autoPricingEnabled: boolean): { state: PartSearchState; detail?: string } {
  if (!autoPricingEnabled) return { state: 'not_available' }
  const item = pricingFor(line, pricing)
  if (!item) return { state: 'not_searched' }
  if (item.status === 'ok' && item.offers.length > 0) return { state: 'found' }
  if (item.status === 'ok' || item.status === 'no_results') return { state: 'no_results' }
  if (item.status === 'skipped') return { state: 'not_searched', detail: ITEM_REASON_LABEL[item.reason ?? ''] }
  return { state: 'unavailable', detail: ITEM_REASON_LABEL[item.reason ?? ''] }
}

/**
 * The parts report never adds prices up: offers and references are ALTERNATIVES for one part
 * (not different parts) and published prices are not a budget for the vehicle.
 */
export function buildPartsReport(input: PartsReportInput): ChuyaReport {
  const privacy = input.privacy ?? DEFAULT_PRIVACY
  const t = textFilter(privacy)
  const parts = input.lines.filter((l) => l.category === 'part')
  const notParts = input.lines.filter((l) => l.category !== 'part')
  const sections: ReportSection[] = []

  sections.push({
    id: 'compatibility',
    title: 'Antes de comprar',
    provenance: 'system',
    blocks: [
      {
        kind: 'alert',
        level: 'high',
        title: 'Compatibilidad no verificada',
        lines: [
          'Chuya Motor no verificó que ninguna publicación ni referencia de este informe sirva para tu vehículo. Confirmá código, presentación y estado con el comercio o con tu taller.',
          'Los precios no se suman: cada publicación es una alternativa para el mismo repuesto, no un presupuesto de la reparación (no incluyen mano de obra ni envío).',
        ],
      },
    ],
  })

  sections.push(vehicleSection(input.vehicle, t))

  const states = parts.map((l) => partSearchState(l, input.pricing, input.autoPricingEnabled))
  sections.push({
    id: 'parts-summary',
    title: 'Repuestos consultados',
    provenance: 'declared',
    blocks: [
      {
        kind: 'table',
        columns: ['Repuesto', 'Cantidad', 'Marca / código', 'Tus referencias', 'Búsqueda automática'],
        widths: [0.3, 0.14, 0.2, 0.14, 0.22],
        rows: parts.map((l, i) => [
          t(l.description),
          `${l.quantity} × ${PRESENTATION_LABEL[l.presentation].toLowerCase()}`,
          [t(l.partBrand), t(l.partCode)].filter(Boolean).join(' · ') || '—',
          l.references.length === 0 ? 'Ninguna' : String(l.references.length),
          PART_SEARCH_STATE_LABEL[states[i]!.state],
        ]),
      },
      ...(states.some((s) => s.state === 'not_searched' || s.state === 'unavailable')
        ? [{ kind: 'paragraph' as const, tone: 'muted' as const, text: 'Información parcial: algunos repuestos no tienen resultados de búsqueda automática. Podés buscarlos con el enlace de búsqueda de cada uno.' }]
        : []),
    ],
  })

  parts.forEach((l, i) => {
    const blocks: ReportBlock[] = []
    const details: Array<[string, string]> = [['Cantidad', `${l.quantity} × ${PRESENTATION_LABEL[l.presentation].toLowerCase()}`]]
    if (t(l.partBrand)) details.push(['Marca', t(l.partBrand)])
    if (t(l.partCode)) details.push(['Código', t(l.partCode)])
    blocks.push({ kind: 'keyValues', rows: details })

    const search = sanitizeExportUrl(buildPartSearch({ description: l.description, partBrand: l.partBrand, partCode: l.partCode, vehicle: input.vehicle }).url)
    if (search) blocks.push({ kind: 'entry', title: 'Búsqueda manual sugerida', badges: ['Resultados externos no verificados'], lines: [], link: { label: 'Buscar en Google', url: search } })

    if (l.references.length) {
      blocks.push({ kind: 'paragraph', tone: 'strong', text: 'Tus referencias (las cargaste vos)' })
      for (const r of l.references) blocks.push(referenceEntry(r, t))
    }

    const { state, detail } = states[i]!
    blocks.push({ kind: 'paragraph', tone: 'strong', text: `Búsqueda automática: ${PART_SEARCH_STATE_LABEL[state].toLowerCase()}` })
    const item = pricingFor(l, input.pricing)
    if (item && (state === 'found' || state === 'no_results')) blocks.push(...pricingItemBlocks(item, t))
    else if (detail) blocks.push({ kind: 'paragraph', tone: 'muted', text: detail })
    else if (state === 'not_searched') blocks.push({ kind: 'paragraph', tone: 'muted', text: 'No se buscaron publicaciones automáticamente para este repuesto.' })

    // Safety-relevant checks (e.g. brakes: professional installation) are always kept.
    blocks.push({ kind: 'paragraph', tone: 'strong', text: 'Qué verificar antes de comprar' })
    blocks.push({ kind: 'list', items: purchaseChecklist(l.description) })

    sections.push({ id: `part-${i + 1}`, title: `Repuesto: ${t(l.description)}`, provenance: item ? 'external' : 'declared', blocks })
  })

  if (notParts.length) {
    sections.push({
      id: 'not-parts',
      title: 'Otros conceptos de la lista',
      provenance: 'declared',
      blocks: [
        { kind: 'paragraph', tone: 'muted', text: 'No se buscan precios para mano de obra ni otros conceptos.' },
        { kind: 'list', items: notParts.map((l) => t(l.description)) },
      ],
    })
  }

  const questions = [...partsQuestions(), ...(notParts.some((l) => l.category === 'labor') ? laborQuestions() : [])]
  sections.push({ id: 'workshop-questions', title: 'Preguntas para el taller', provenance: 'system', blocks: [{ kind: 'list', items: questions, ordered: true }] })

  return { ...header('parts', input.generatedAt), sections }
}

/** Personal data kinds present in the free text that would be exported (for the preview notice). */
export function detectedPersonalData(texts: ReadonlyArray<string | null | undefined>): PersonalDataKind[] {
  return personalDataKinds(texts)
}
