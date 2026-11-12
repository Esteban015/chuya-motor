import { SAFETY_SIGNAL_GROUPS, SAFETY_POLICY_VERSION, COVERAGE_DISCLAIMER } from './blocklist'
import { matchesBrakeCapacityLoss } from './brake-capacity-signals'
import { normalizeText } from './text-normalization'
import { maskNegatedHazards, detectExplicitHazard } from './hazard-signals'

// D-1 — 4-stage deterministic safety gate pipeline:
// 1. normalize  2. exact phrase match  3. co-occurrence of stems  4. intent classification

// Stage 1: normalize — lowercase, remove accents, collapse whitespace (text-normalization.ts, 6.4D)
export { normalizeText }

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
//   professional_context > diy_intent > past_description > budget_structured > informational > symptom_description > ambiguous
//
// AM-01 (DECISIONS.md D-1): "ambiguous → BLOQUEAR por precaución" — implemented.
// Inputs without a clear educational, professional, DIY, past, or symptom signal that contain a
// safety keyword are classified 'ambiguous' and blocked conservatively (checkSafetyGate Stage AM-01).
// Educational queries are protected by EDUCATIONAL_MARKERS: their presence classifies as
// 'informational' even when a safety keyword is also present.
//
// budget_structured (v1.2.0, DEF-01 fix): a commercial listing of parts/services
// (≥2 lines "description: amount") is not a live-symptom report. Part names like "Filtro de
// combustible" or "Pastillas de freno" are not operational safety signals. Stage 2 (exact
// phrase match) and Stage 3 (DIY co-occurrence) remain fully enforced — budget_structured
// only bypasses AM-01 keyword blocking.
//
// symptom_description (v1.3.0, FASE 5D.1.1): inputs containing "al/cuando + [driving verb]"
// describe when a symptom occurs, not DIY intent ("al frenar hace ruido" = temporal descriptor).
// ACTION_VERB_EXCLUSIONS prevents "hace/hacen" (3rd-person of "hacer" = machine behavior) from
// triggering diy_intent — "el motor hace ruido" is not a repair request.
// symptom_description is checked AFTER educational markers so "qué causa el ruido al frenar"
// stays 'informational'. Stage 2 (exact phrase) and Stage 3 (diy_intent co-occurrence) remain
// fully enforced — symptom_description only bypasses the AM-01 conservative ambiguous block.
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
  | 'symptom_description'

// 3rd-person forms of "hacer" excluded from diy_intent: they describe what the machine does
// ("el motor hace ruido", "los frenos hacen calor"), not what the user intends to do.
// Only present-tense 3rd-person forms are excluded; "hacer" (infinitive) and "hago" (1st person)
// still trigger diy_intent because they describe user actions ("voy a hacer", "hago el cambio").
const ACTION_VERB_EXCLUSIONS = new Set(['hace', 'hacen'])

// Stem roots of verbs describing driving actions used in temporal phrases ("al frenar",
// "cuando acelera"). Detecting these allows the system to classify "al/cuando + [driving verb]"
// as a symptom context descriptor rather than diy_intent or ambiguous input.
// Checked AFTER educational markers (so "qué causa el ruido al frenar" stays 'informational')
// and AFTER diy_intent (so mixed inputs like "al frenar arreglo los frenos" stay blocked).
const SYMPTOM_CONTEXT_STEMS = ['fren', 'arranc', 'aceler', 'conduc', 'manej', 'gir']

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
// v1.3.1 (6.4B, D-03): "fueron" added — plural of "fue". Without it SAFETY.md's own example
// "se me fueron los frenos en la ruta" was blocked as ambiguous. DIY (checked earlier) and
// persistence markers still take precedence.
const PAST_MARKERS = ['paso', 'ocurrio', 'sucedio', 'fue', 'fueron', 'fui', 'tuve', 'estaba', 'habia', 'empezo', 'salio', 'quede', 'perdi', 'vine', 'llego', 'noto']

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

  // Exclude 3rd-person "hacer" tokens: "hace/hacen" describe what the machine does, not DIY intent.
  const hasActionVerb = tokens.some(
    (t, i) => !ACTION_VERB_EXCLUSIONS.has(t) && ACTION_VERB_STEMS.some((v) => stems[i]!.startsWith(v)),
  )
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
  // Checked BEFORE symptom_context so "qué causa el ruido al frenar" stays 'informational'.
  const hasEducational = stems.some((s) => EDUCATIONAL_MARKER_STEMS.some((es) => s === es))
  if (hasEducational) return 'informational'

  // Symptom context: "al/cuando + [driving verb]" describes when a symptom occurs (FASE 5D.1.1).
  // Only triggers for infinitive and conjugated forms of driving verbs after a temporal marker.
  const hasSymptomContext = tokens.some((t, i) => {
    if (t !== 'al' && t !== 'cuando') return false
    const nextStem = stems[i + 1]
    return nextStem !== undefined && SYMPTOM_CONTEXT_STEMS.some((s) => nextStem.startsWith(s))
  })
  if (hasSymptomContext) return 'symptom_description'

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

// ── Stage AM-01 calibration (v1.4.0, Incremento 6.4C, D-03) ──────────────────
// AM-01 blocks every ambiguous input that mentions a safety keyword. Two DESCRIPTIVE symptom
// families were over-blocked and are now allowed when — and only when — the context shows a
// symptom description (not a request) and no hazard signal is present:
//   1. conventional 12 V battery: "la batería se descarga", "no arranca", "quedó tirada";
//   2. brake noise / vibration:    "los frenos hacen ruido", "chillan", "rechinan", "vibran".
// Every keyword hit in the text must be covered by an exemption; any other category (steering,
// fire, fuel, …), any high-voltage context, battery hazard, intervention verb or loss of braking
// capacity keeps the conservative block. Stage 2 (exact phrases) and Stage 3 (DIY co-occurrence)
// run before and are unaffected. Exempted inputs are reported as 'symptom_description'.
// Context lists match by prefix on RAW normalized tokens (the stemmer cuts "hibrido"→"hibr",
// "tension"→"ten"); keyword hits reuse the stem matching of AM-01. No list is exhaustive.

// Symptom descriptors of a discharged / failing 12 V battery.
const BATTERY_SYMPTOM_PREFIXES = ['descarg', 'arranc', 'agot', 'muert', 'tirad', 'prend', 'enciend', 'testig', 'luz', 'dur', 'carg', 'baj', 'qued']
// High-voltage (hybrid / EV traction) context: never exempt.
const HIGH_VOLTAGE_CONTEXT_PREFIXES = ['hibr', 'electr', 'tension', 'voltaj', 'traccion', 'enchuf', 'kwh']
// Battery hazards (hydrogen, acid, swelling, heat, sparks): never exempt.
const BATTERY_HAZARD_PREFIXES = ['chisp', 'hinch', 'infl', 'explot', 'acid', 'azufr', 'podrid', 'derram', 'gote', 'fug', 'calient', 'recalient', 'olor', 'huel', 'sulfur']
// Physical intervention vocabulary not covered by ACTION_VERB_STEMS: never exempt.
const INTERVENTION_PREFIXES = ['desconect', 'conect', 'puent', 'pinz', 'born', 'cabl', 'empalm', 'multimetr', 'tester']
// Brake noise / vibration descriptors (machine behavior, 3rd person or nouns).
const BRAKE_NOISE_PREFIXES = ['ruid', 'chirri', 'chill', 'rechin', 'sonid', 'suen', 'zumb', 'golpet', 'cruj', 'chasquid', 'vibr', 'tiembl']
// Brake keywords that the noise exemption may cover. "liquido"/"hidraulico" (fluid, pressure) never.
const BRAKE_EXEMPTIBLE_KEYWORDS = new Set(['frenos', 'freno', 'frenado', 'pastillas', 'discos', 'abs'])

interface KeywordHit {
  category: string
  keyword: string
}

// All safety keyword hits (every group, every keyword) — used by the AM-01 calibration.
// Keyword hits that are verb forms of another word, ignored ONLY by this calibration:
// "llama" (flame, fire_smoke) stem-matches "llamar a alguien" (SYM-003). The noun keeps blocking.
const KEYWORD_TOKEN_FILTER: Record<string, RegExp> = { llama: /^llam(a|as|arada|aradas)$/ }

function findAllKeywordMatches(tokens: string[], stems: string[]): KeywordHit[] {
  const hits: KeywordHit[] = []
  for (const group of SAFETY_SIGNAL_GROUPS) {
    for (const keyword of group.keywords) {
      const keywordStem = stemToken(normalizeText(keyword))
      const filter = KEYWORD_TOKEN_FILTER[keyword]
      if (stems.some((s, i) => (s === keywordStem || s.startsWith(keywordStem)) && (!filter || filter.test(tokens[i]!)))) {
        hits.push({ category: group.category, keyword })
      }
    }
  }
  return hits
}

function hasPrefix(tokens: string[], list: readonly string[]): boolean {
  return tokens.some((t) => list.some((p) => t.startsWith(p)))
}

/** True when an AM-01-ambiguous input is a descriptive 12 V battery or brake-noise symptom. */
function isDescriptiveSymptomExemption(normalized: string): boolean {
  const tokens = normalized.split(' ')
  const stems = tokens.map(stemToken)
  const hits = findAllKeywordMatches(tokens, stems)
  if (hits.length === 0) return false
  if (hasPrefix(tokens, INTERVENTION_PREFIXES)) return false
  if (matchesBrakeCapacityLoss(normalized)) return false
  // Persistence / worsening after a prior state keeps FP-02's conservative reading ("pero ahora…").
  if (tokens.some((t) => PERSISTENCE_MARKERS.includes(t))) return false

  const batteryOk = () =>
    hasPrefix(tokens, BATTERY_SYMPTOM_PREFIXES) &&
    !hasPrefix(tokens, HIGH_VOLTAGE_CONTEXT_PREFIXES) &&
    !hasPrefix(tokens, BATTERY_HAZARD_PREFIXES)
  const brakeNoiseOk = () =>
    tokens.some((t) => t.startsWith('fren') || t.startsWith('pastill')) &&
    // Pedal feel is closer to braking capacity than to noise: "el pedal vibra" stays blocked (AM-01-BLK-01).
    !tokens.includes('pedal') &&
    hasPrefix(tokens, BRAKE_NOISE_PREFIXES)

  return hits.every((h) => {
    if (h.category === 'high_voltage') return h.keyword === 'bateria' && batteryOk()
    if (h.category === 'brakes') return BRAKE_EXEMPTIBLE_KEYWORDS.has(h.keyword) && brakeNoiseOk()
    return false
  })
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
  // Stage 1 (v1.5.0): normalization + masking of explicitly NEGATED hazard spans
  // ("no veo chispas ni olor a quemado"). Without a negated hazard this equals normalizeText().
  const normalized = maskNegatedHazards(userText).text

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

  // Stage 2b — explicit hazard precedence (v1.5.0, Incremento 6.4D, P0). An explicit, non-negated
  // hazard (sparks, battery swelling/leak/heat/gas, fire, smoke outside the exhaust, burning smell,
  // fuel/gas smell or leak) blocks BEFORE any permissive classification: symptom_description,
  // informational, professional_context, past_description, budget_structured and the 6.4C
  // descriptive exemption can no longer let it through. Loss of braking capacity is handled by
  // brake-capacity-signals.ts (AM-01 block or CRITICAL banner, never silent) — unchanged.
  const hazard = detectExplicitHazard(normalized)
  if (hazard) {
    return {
      blocked: true,
      triggeredCategory: hazard.category,
      triggeredSignal: hazard.signal,
      intentClassification: intent,
      policyVersion: SAFETY_POLICY_VERSION,
      coverageDisclaimer: COVERAGE_DISCLAIMER,
    }
  }

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
    // v1.4.0 (6.4C, D-03): descriptive 12 V battery / brake-noise symptoms are not blocked.
    if (keywordMatch && isDescriptiveSymptomExemption(normalized)) {
      return {
        blocked: false,
        triggeredCategory: null,
        triggeredSignal: null,
        intentClassification: 'symptom_description',
        policyVersion: SAFETY_POLICY_VERSION,
        coverageDisclaimer: COVERAGE_DISCLAIMER,
      }
    }
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
