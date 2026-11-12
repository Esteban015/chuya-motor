/**
 * diagnosis-quality.ts — Deterministic quality layer for LLM diagnosis output (Incremento 6.4D, Fase 2).
 *
 * The prompt (diagnosis-prompt.ts v2.0.0) asks the model to behave; this module enforces the subset
 * that can be checked without understanding mechanics. It runs after Zod validation and before the
 * output safety guard. It never adds content: it only removes or downgrades.
 *
 *   D-09  internal labels (novice, experienceLevel, dataLabel, …) → fact/caveat/question removed,
 *         label scrubbed from statements.
 *   D-11  absences listed as facts ("No se reportan luces…") → fact removed.
 *   D-08  facts whose content words are mostly NOT present in the user's text or declared vehicle →
 *         fact removed (heuristic grounding: ≥50 % of content words must appear, 5-char prefix match).
 *   D-10  insufficient information (fewer than 6 content words in the symptom) → every confidence
 *         capped to "low"; otherwise "high" is capped to "medium" (no certainty without inspection).
 *
 * Limits (documented as residual risk): invented conditions inside hypotheses or caveats are not
 * detected; grounding is lexical (a paraphrase can be removed, a fabricated fact reusing the user's
 * words can survive). Mechanical correctness is out of scope and pending professional review.
 */
import { normalizeText } from '@/domain/safety/text-normalization'

export type Confidence = 'low' | 'medium' | 'high'

export interface DiagnosisCandidate {
  facts: string[]
  hypotheses: Array<{ statement: string; confidence: Confidence; caveats: string[]; evidenceIds: string[] }>
  questions: string[]
}

export interface QualityContext {
  userText: string
  /** Declared vehicle (make model year); part of the grounding source. */
  vehicleLine?: string
}

export interface QualityReport {
  removedInternalLabels: number
  removedAbsenceFacts: number
  removedUngroundedFacts: number
  cappedConfidence: number
  insufficientInformation: boolean
}

export const MIN_CONTENT_WORDS_FOR_MEDIUM = 6
export const FACT_GROUNDING_THRESHOLD = 0.5

const INTERNAL_LABEL = /\b(novice|intermediate|experienced|experiencelevel|experience_level|nivel de experiencia|perfil de quien consulta|datalabel|synthetic_demo|user_input|unknown)\b/i

const ABSENCE_FACT =
  /^(no\s+se\s+(reporta|reportan|menciona|mencionan|indica|indican|especifica|especifican|informa|informan|observa|observan|detalla|detallan|aclara|describe|describen)\b|no\s+(hay|existen?)\s+(datos|informacion|reportes?|mencion)\b|sin\s+(datos|informacion|mencion)\b|se\s+desconoce\b|no\s+(fue|esta|estan)\s+(especificad|informad|indicad)|desconocid)/

// Function words and meta words that carry no factual content for grounding.
const STOPWORDS = new Set([
  'para', 'pero', 'porque', 'sobre', 'entre', 'tras', 'luego', 'despues', 'antes', 'cuando', 'durante',
  'desde', 'hasta', 'como', 'esta', 'este', 'esto', 'estos', 'estas', 'esos', 'esas', 'ese', 'esa',
  'tiene', 'tienen', 'hace', 'hacen', 'solo', 'sola', 'mismo', 'misma', 'cada', 'otro', 'otra', 'otros',
  'otras', 'algun', 'alguna', 'algunos', 'algunas', 'muy', 'mucho', 'mucha', 'poco', 'poca', 'tambien',
  'aunque', 'donde', 'mientras', 'vez', 'veces', 'segun', 'cual', 'cuales', 'que', 'quien', 'unos', 'unas',
  'vehiculo', 'auto', 'coche', 'carro', 'modelo', 'marca', 'anio', 'conductor', 'usuario', 'usuaria',
  'persona', 'cliente', 'reporta', 'reportado', 'reportada', 'indica', 'menciona', 'describe', 'declara',
  'declarado', 'declarada', 'problema', 'sintoma', 'sintomas', 'ocurre', 'sucede', 'presenta', 'aparece',
  'tipo', 'dato', 'datos', 'verificado', 'verificada', 'manera', 'forma', 'momento', 'situacion',
])

function contentWords(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
}

const key = (t: string) => t.slice(0, 5)

/** Fraction of the fact's content words found in the source (5-char prefix match). 1 when empty. */
export function groundingRatio(fact: string, source: string): number {
  const words = contentWords(fact)
  if (words.length === 0) return 1
  const sourceKeys = new Set(normalizeText(source).split(' ').filter(Boolean).map(key))
  const found = words.filter((w) => sourceKeys.has(key(w))).length
  return found / words.length
}

export function hasInsufficientInformation(userText: string): boolean {
  return contentWords(userText).length < MIN_CONTENT_WORDS_FOR_MEDIUM
}

function scrubLabels(text: string): string {
  return text.replace(new RegExp(INTERNAL_LABEL.source, 'gi'), '').replace(/\s{2,}/g, ' ').trim()
}

export function refineDiagnosisOutput(
  candidate: DiagnosisCandidate,
  ctx: QualityContext,
): { output: DiagnosisCandidate; report: QualityReport } {
  const report: QualityReport = {
    removedInternalLabels: 0,
    removedAbsenceFacts: 0,
    removedUngroundedFacts: 0,
    cappedConfidence: 0,
    insufficientInformation: hasInsufficientInformation(ctx.userText),
  }
  const source = `${ctx.userText} ${ctx.vehicleLine ?? ''}`

  const facts = candidate.facts.filter((fact) => {
    if (INTERNAL_LABEL.test(fact)) {
      report.removedInternalLabels++
      return false
    }
    if (ABSENCE_FACT.test(normalizeText(fact))) {
      report.removedAbsenceFacts++
      return false
    }
    if (groundingRatio(fact, source) < FACT_GROUNDING_THRESHOLD) {
      report.removedUngroundedFacts++
      return false
    }
    return true
  })

  const hypotheses = candidate.hypotheses.map((h) => {
    let confidence = h.confidence
    if (report.insufficientInformation && confidence !== 'low') confidence = 'low'
    else if (confidence === 'high') confidence = 'medium'
    if (confidence !== h.confidence) report.cappedConfidence++

    const caveats = h.caveats.filter((c) => {
      const keep = !INTERNAL_LABEL.test(c)
      if (!keep) report.removedInternalLabels++
      return keep
    })
    let statement = h.statement
    if (INTERNAL_LABEL.test(statement)) {
      statement = scrubLabels(statement)
      report.removedInternalLabels++
    }
    return { ...h, statement, confidence, caveats }
  }).filter((h) => h.statement.length > 0)

  const questions = candidate.questions.filter((q) => {
    const keep = !INTERNAL_LABEL.test(q)
    if (!keep) report.removedInternalLabels++
    return keep
  })

  return { output: { facts, hypotheses, questions }, report }
}
