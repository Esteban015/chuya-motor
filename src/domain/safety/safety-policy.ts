import { SAFETY_SIGNAL_GROUPS, SAFETY_POLICY_VERSION, COVERAGE_DISCLAIMER } from './blocklist'

// D-1 — 4-stage deterministic safety gate pipeline:
// 1. normalize  2. exact phrase match  3. co-occurrence of stems  4. intent classification

// Stage 1: normalize — lowercase, remove accents, collapse whitespace
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Stage 2 / 3 helper: Spanish suffix stemmer (deterministic, no ML)
// Rules ordered longest-first to prevent premature truncation
const STEM_RULES: [string, number][] = [
  ['aciones', 3],
  ['amiento', 3],
  ['ando', 3],
  ['iendo', 3],
  ['ados', 3],
  ['adas', 3],
  ['ido', 3],
  ['ida', 3],
  ['ado', 3],
  ['ada', 3],
  ['cion', 3],
  ['sion', 3],
  ['amos', 3],
  ['emos', 3],
  ['imos', 3],
  ['ais', 3],
  ['eis', 3],
  ['ar', 3],
  ['er', 3],
  ['ir', 3],
  ['an', 3],
  ['en', 3],
  ['as', 3],
  ['es', 3],
  ['os', 3],
  ['a', 3],
  ['e', 3],
  ['o', 3],
]

export function stemToken(token: string): string {
  for (const [suffix, minRoot] of STEM_RULES) {
    if (token.endsWith(suffix) && token.length - suffix.length >= minRoot) {
      return token.slice(0, token.length - suffix.length)
    }
  }
  return token
}

// Stage 4: Intent classification
// Order of precedence:
//   professional_context > diy_intent > past_description > budget_structured > informational > ambiguous
//
// AM-01 (DECISIONS.md D-1): "ambiguous → BLOQUEAR por precaución" — implemented.
// Inputs without a clear educational, professional, DIY, or past signal that contain a safety
// keyword are classified 'ambiguous' and blocked conservatively (checkSafetyGate Stage AM-01).
// Educational queries are protected by EDUCATIONAL_MARKERS: their presence classifies as
// 'informational' even when a safety keyword is also present.
//
// budget_structured (v1.2.0, DEF-01 fix): a commercial listing of parts/services
// (≥2 lines "description: amount") is not a live-symptom report. Part names like "Filtro de
// combustible" or "Pastillas de freno" are not operational safety signals. Stage 2 (exact
// phrase match) and Stage 3 (DIY co-occurrence) remain fully enforced — budget_structured
// only bypasses AM-01 keyword blocking.
//
// FP-02 (DECISIONS.md D-1): professional_context early exit is suppressed when PERSISTENCE_MARKERS
// are present — the problem is active/ongoing despite the professional visit.
// Same logic applies to past_description: persistence markers indicate the problem is current.
export type IntentClassification =
  | 'professional_context'
  | 'diy_intent'
  | 'past_description'
  | 'budget_structured'
  | 'informational'
  | 'ambiguous'

// Action verb stems that indicate the user wants to perform a repair themselves
const ACTION_VERB_STEMS = [
  'arregl',
  'repar',
  'cambi',
  'purg',
  'sangr',
  'ajust',
  'instal',
  'desmont',
  'mont',
  'hac',
  'hag',
  'revis',
  'limpi',
  'quit',
  'sac',
  'sustitu',
  'sold',
  'desactiv',
  'desmant',
  'manipul',
  'toqu',
  'interven',
  'cortocircuit',
]

// Tokens that indicate professional context (taller, mecánico, diagnóstico, etc.)
// 'taller' stems to 'tall' (suffix 'er' removed), so we match the stemmed form
const PROFESSIONAL_CONTEXT_STEMS = ['tall', 'mecan', 'tecnic', 'profes', 'diagnostic', 'presupuest', 'perit']

// Past-tense markers — description of what already happened, not DIY intent
const PAST_MARKERS = ['paso', 'ocurrio', 'sucedio', 'fue', 'fui', 'tuve', 'estaba', 'habia', 'empezo', 'salio', 'quede', 'perdi', 'vine', 'llego', 'noto']

// Persistence markers — indicate the problem is active/ongoing despite prior context.
// Presence overrides professional_context and past_description early exits (FP-02).
const PERSISTENCE_MARKERS = [
  'sigue', 'siguen', 'sigo',
  'continua', 'continuan', 'continuo',
  'persiste', 'persisten',
  'todavia', 'aun', 'igual',
  'ahora', 'actualmente',
  'peor', 'empeoro',
]

// Educational markers — base forms; matched via stemToken so conjugated forms are also covered.
// E.g. "funcionan" → stem "funcion" matches stem of "funciona" → classifies as 'informational'.
// When present, the query is classified 'informational' even if a safety keyword is detected.
// This protects legitimate diagnostic questions from AM-01 blocking (DECISIONS.md D-1, v1.2.0).
// NOTE: matching is stem-based (via stemToken), not exact-token, to cover plural conjugations.
const EDUCATIONAL_MARKERS = [
  'funciona', 'sirve', 'significa', 'causa', 'provoca',
  'implica', 'diferencia', 'explicar', 'entender', 'saber', 'tipos',
]

// Precomputed stems of EDUCATIONAL_MARKERS for efficient stem-based matching.
const EDUCATIONAL_MARKER_STEMS = EDUCATIONAL_MARKERS.map((m) => stemToken(normalizeText(m)))

// Returns true when the original (non-normalized) text has the structure of a commercial budget:
// ≥2 lines matching "description: amount", indicating a list of parts/services — not a symptom.
// Uses original text because normalizeText removes colons and punctuation.
// Called from classifyIntent to identify budget_structured intent (v1.2.0, DEF-01 fix).
function detectsBudgetStructure(originalText: string): boolean {
  const lines = originalText.split('\n')
  const itemLines = lines.filter((line) =>
    /^[^:]+:\s*\$?\s*[\d.,]+/.test(line.trim()),
  )
  return itemLines.length >= 2
}

function classifyIntent(normalized: string, originalText: string): IntentClassification {
  const tokens = normalized.split(' ')
  const stems = tokens.map(stemToken)

  const hasPersistence = tokens.some((t) => PERSISTENCE_MARKERS.includes(t))
  const hasProfessional = stems.some((s) => PROFESSIONAL_CONTEXT_STEMS.some((p) => s.startsWith(p)))

  // Professional context only when no persistence markers: persistence means the problem
  // is still active despite the professional visit (FP-02).
  if (hasProfessional && !hasPersistence) return 'professional_context'

  const hasActionVerb = stems.some((s) => ACTION_VERB_STEMS.some((v) => s.startsWith(v)))
  if (hasActionVerb) return 'diy_intent'

  const hasPastMarker = tokens.some((t) => PAST_MARKERS.includes(t))
  // Past description only when no persistence markers: persistence means the past event
  // has not resolved — the condition is current (FP-02).
  if (hasPastMarker && !hasPersistence) return 'past_description'

  // Budget structured: commercial listing of parts/services (≥2 "item: amount" lines).
  // Bypasses AM-01 keyword blocking — Stage 2 and Stage 3 remain enforced.
  if (detectsBudgetStructure(originalText)) return 'budget_structured'

  // Educational markers classify as informational even with safety keywords (AM-01).
  // Stem-based matching covers conjugated forms (DEF-02 fix, v1.2.0).
  const hasEducational = stems.some((s) => EDUCATIONAL_MARKER_STEMS.some((es) => s === es))
  if (hasEducational) return 'informational'

  // No clear signal — ambiguous. checkSafetyGate will block if a safety keyword is present.
  return 'ambiguous'
}

export interface SafetyGateResult {
  blocked: boolean
  triggeredCategory: string | null
  triggeredSignal: string | null
  intentClassification: IntentClassification
  policyVersion: string
  coverageDisclaimer: string
}

// Stage 2: exact phrase match against normalized group phrases
function findExactPhraseMatch(normalized: string): { category: string; signal: string } | null {
  for (const group of SAFETY_SIGNAL_GROUPS) {
    for (const phrase of group.phrases) {
      const normalizedPhrase = normalizeText(phrase)
      if (normalized.includes(normalizedPhrase)) {
        return { category: group.category, signal: phrase }
      }
    }
  }
  return null
}

// Keyword scan: returns first safety keyword found in the normalized text via stem matching.
// Used by both Stage 3 (diy_intent co-occurrence) and Stage AM-01 (ambiguous blocking).
function findKeywordMatch(normalized: string): { category: string; signal: string } | null {
  const tokens = normalized.split(' ')
  const stems = tokens.map(stemToken)

  for (const group of SAFETY_SIGNAL_GROUPS) {
    for (const keyword of group.keywords) {
      const keywordStem = stemToken(normalizeText(keyword))
      if (stems.some((s) => s === keywordStem || s.startsWith(keywordStem))) {
        return { category: group.category, signal: keyword }
      }
    }
  }
  return null
}

// Stage 3: keyword co-occurrence — safety keyword present AND action verb confirmed (diy_intent)
function findStemCoOccurrence(
  normalized: string,
  intent: IntentClassification,
): { category: string; signal: string } | null {
  if (intent !== 'diy_intent') return null
  return findKeywordMatch(normalized)
}

export function checkSafetyGate(userText: string): SafetyGateResult {
  const normalized = normalizeText(userText)

  // Stage 2: exact phrase → block regardless of intent (highest-confidence signal).
  // Must run BEFORE intent classification so professional context cannot bypass a live danger phrase.
  const phraseMatch = findExactPhraseMatch(normalized)
  if (phraseMatch) {
    const intent = classifyIntent(normalized, userText)
    return {
      blocked: true,
      triggeredCategory: phraseMatch.category,
      triggeredSignal: phraseMatch.signal,
      intentClassification: intent,
      policyVersion: SAFETY_POLICY_VERSION,
      coverageDisclaimer: COVERAGE_DISCLAIMER,
    }
  }

  const intent = classifyIntent(normalized, userText)

  // Professional context (after phrase check): suppress co-occurrence and ambiguous blocks.
  if (intent === 'professional_context') {
    return {
      blocked: false,
      triggeredCategory: null,
      triggeredSignal: null,
      intentClassification: intent,
      policyVersion: SAFETY_POLICY_VERSION,
      coverageDisclaimer: COVERAGE_DISCLAIMER,
    }
  }

  // Stage 3: keyword co-occurrence — keyword + action verb → block (diy_intent confirmed).
  // Runs before budget_structured check so DIY intent in a budget still blocks.
  const stemMatch = findStemCoOccurrence(normalized, intent)
  if (stemMatch) {
    return {
      blocked: true,
      triggeredCategory: stemMatch.category,
      triggeredSignal: stemMatch.signal,
      intentClassification: intent,
      policyVersion: SAFETY_POLICY_VERSION,
      coverageDisclaimer: COVERAGE_DISCLAIMER,
    }
  }

  // Budget structured (v1.2.0, DEF-01): commercial listing of parts/services.
  // Stage 2 and Stage 3 have already run — no dangerous phrase or DIY verb present.
  // Part names may contain safety tokens (e.g. "Filtro de combustible") that must not block.
  if (intent === 'budget_structured') {
    return {
      blocked: false,
      triggeredCategory: null,
      triggeredSignal: null,
      intentClassification: intent,
      policyVersion: SAFETY_POLICY_VERSION,
      coverageDisclaimer: COVERAGE_DISCLAIMER,
    }
  }

  // Stage AM-01 (DECISIONS.md D-1): ambiguous intent with safety keyword → block conservatively.
  // Covers unclassified inputs that lack educational markers but contain a safety keyword —
  // they may involve a live safety concern without explicit DIY phrasing.
  if (intent === 'ambiguous') {
    const keywordMatch = findKeywordMatch(normalized)
    if (keywordMatch) {
      return {
        blocked: true,
        triggeredCategory: keywordMatch.category,
        triggeredSignal: keywordMatch.signal,
        intentClassification: intent,
        policyVersion: SAFETY_POLICY_VERSION,
        coverageDisclaimer: COVERAGE_DISCLAIMER,
      }
    }
  }

  return {
    blocked: false,
    triggeredCategory: null,
    triggeredSignal: null,
    intentClassification: intent,
    policyVersion: SAFETY_POLICY_VERSION,
    coverageDisclaimer: COVERAGE_DISCLAIMER,
  }
}
