/**
 * hazard-signals.ts — Explicit-hazard catalog + hazard-negation masking (Incremento 6.4D, P0).
 *
 * Shared, deterministic and import-light (only text normalization),
 * so the Safety Gate (blocking) and the Severity Assessor (preventive warning) use the same signals
 * while remaining separate components.
 *
 * Why (P0 defect): permissive classifications (symptom_description "cuando/al + verbo",
 * informational, professional/past context, the 6.4C descriptive exemption) were evaluated before
 * any hazard was recognized, so "Cuando arranco, la batería tira chispas" was not blocked.
 * Policy v1.5.0 evaluates explicit hazards right after the exact-phrase stage.
 *
 * Negation (masking): a hazard term is ignored only when it sits inside an explicit negated
 * perception/existence scope ("no veo chispas ni olor a quemado", "no hay humo", "sin humo"),
 * within the same clause and before a clause break (punctuation, "pero", "y", "aunque", …).
 * NOT negation: uncertainty ("no sé si salen chispas"), resolution ("ya no sale humo").
 * Masking removes only the negated hazard span; it never hides "no frena" (brake loss is not a
 * hazard term) and never touches text outside the scope.
 *
 * No list of expressions guarantees detecting every risk (see COVERAGE_DISCLAIMER).
 */
import { normalizeText } from './text-normalization'

export type ExplicitHazardKind =
  | 'fire_smoke'
  | 'fuel_gas_leak'
  | 'battery_electrical'
  | 'burning_smell'

export interface ExplicitHazard {
  kind: ExplicitHazardKind
  /** Signal-group category reported by the Safety Gate (audit only). */
  category: string
  /** Structural signal id (never user text). */
  signal: string
}

// ── Negation masking ─────────────────────────────────────────────────────────

const NEGATORS = new Set(['no', 'nunca', 'tampoco'])
const CLITICS = new Set(['se', 'me', 'le', 'les', 'lo', 'la', 'te', 'nos'])
// Perception / existence / emission verbs that make "no + verbo + peligro" a real negation.
const PERCEPTION_VERBS = new Set([
  'hay', 'habia', 'hubo', 'veo', 'vi', 've', 'ven', 'vemos', 'noto', 'note', 'nota', 'notan',
  'siento', 'senti', 'siente', 'sienten', 'huele', 'huelen', 'olia', 'olio', 'sale', 'salen',
  'salio', 'salieron', 'salia', 'tira', 'tiran', 'tiro', 'larga', 'largan', 'echa', 'echan',
  'tiene', 'tienen', 'tenia', 'aparece', 'aparecen', 'aparecio', 'da', 'dan', 'hace', 'hacen',
  'detecto', 'percibo', 'observo', 'registro',
])
// Words that end a negation scope inside a clause.
const SCOPE_BREAKERS = new Set(['pero', 'aunque', 'sino', 'y', 'e', 'o', 'u', 'mientras', 'salvo', 'excepto'])
const HAZARD_TERM_PREFIXES = [
  'chisp', 'humo', 'hume', 'humare', 'fuego', 'llamas', 'llamarad', 'incendi', 'quemad', 'olor',
  'huel', 'hinchad', 'inflad', 'deformad', 'abombad', 'explot', 'acido', 'podrid', 'azufr',
  'derram', 'fuga', 'chorre', 'calient', 'recalient', 'nafta', 'gasolin', 'combustib', 'gasoil',
]
const HAZARD_TERM_EXACT = new Set(['gas', 'gnc'])

function isHazardTerm(token: string): boolean {
  return HAZARD_TERM_EXACT.has(token) || HAZARD_TERM_PREFIXES.some((p) => token.startsWith(p))
}

/** Index where the negated scope starts (the verb after the negator), or -1. */
function negationScopeStart(tokens: string[], i: number): number {
  const t = tokens[i]!
  if (t === 'sin') return i + 1
  if (!NEGATORS.has(t)) return -1
  if (tokens[i - 1] === 'ya') return -1 // "ya no sale humo" = resolution, not absence
  let j = i + 1
  while (j < tokens.length && CLITICS.has(tokens[j]!)) j++
  return j < tokens.length && PERCEPTION_VERBS.has(tokens[j]!) ? j : -1
}

function maskClause(tokens: string[]): { tokens: string[]; masked: boolean } {
  const out = [...tokens]
  const remove = new Set<number>()
  for (let i = 0; i < tokens.length; i++) {
    const start = negationScopeStart(tokens, i)
    if (start < 0) continue
    let end = start
    while (end < tokens.length && !SCOPE_BREAKERS.has(tokens[end]!)) end++
    let lastHazard = -1
    for (let k = start; k < end; k++) if (isHazardTerm(tokens[k]!)) lastHazard = k
    if (lastHazard < 0) continue
    for (let k = i; k <= lastHazard; k++) remove.add(k)
    i = lastHazard
  }
  return { tokens: out.filter((_, k) => !remove.has(k)), masked: remove.size > 0 }
}

/**
 * Normalized text with negated hazard spans removed. Clauses are split on punctuation BEFORE
 * normalization (normalizeText drops punctuation). With no negated hazard, the result equals
 * normalizeText(text).
 */
export function maskNegatedHazards(text: string): { text: string; negationApplied: boolean } {
  let negationApplied = false
  const parts: string[] = []
  for (const rawClause of text.split(/[.,;:!?¡¿\n]+/)) {
    const clause = normalizeText(rawClause)
    if (!clause) continue
    const { tokens, masked } = maskClause(clause.split(' '))
    negationApplied ||= masked
    if (tokens.length) parts.push(tokens.join(' '))
  }
  return { text: parts.join(' '), negationApplied }
}

// ── Explicit hazard detection (on masked, normalized text) ───────────────────

const W = '(?:\\w+\\s+)'
const SMELL = '(?:olor|huele|huelen|olia|olio)\\s+a\\s+'

const FIRE = [/\b(fuego|incendi\w*|llamarada\w*)\b/, /\ben\s+llamas\b/, /\b(salen|salian|salieron|hay|habia|vi|veo|tira|tiran|larga|largan|echa|echan)\s+llamas\b/]
const SMOKE = /\b(humo|humea\w*|humareda)\b/
// Exhaust smoke ("humo azul del escape") is a diagnostic symptom, not a fire hazard.
const EXHAUST_SMOKE = new RegExp(`\\b(humo|humea\\w*)\\s+${W}{0,4}(escape|cano|silenciador)\\b|\\b(escape|cano|silenciador)\\s+${W}{0,3}(humo|humea\\w*)\\b`)

const FUEL_GAS = [
  new RegExp(`\\b${SMELL}(nafta|gasolina|combustible|gasoil|diesel|gas|gnc)\\b`),
  new RegExp(`\\b(pierde|pierden|gotea|gotean|chorrea|derrama|fuga\\s+de|perdida\\s+de|escape\\s+de)\\s+${W}{0,1}(nafta|gasolina|combustible|gasoil|gas|gnc)\\b`),
]

const BATTERY_CONTEXT = /\b(bateri\w*|borne\w*|acumulador\w*)\b/
const BATTERY_HAZARDS = [
  new RegExp(`\\bbateri\\w*\\s+${W}{0,4}(hinchad|inflad|deformad|abombad)\\w*`),
  new RegExp(`\\b(hinchad|inflad|deformad|abombad)\\w*\\s+${W}{0,3}bateri\\w*`),
  new RegExp(`\\b(pierde|pierden|gotea|derrama|chorrea|tira|larga|sale|salen|perdida\\s+de)\\s+${W}{0,2}(liquido|acido)\\b`),
  /\bacido\b/,
  /\bhuevo\s+podrido\b|\bazufre\b/,
  new RegExp(`\\bbateri\\w*\\s+${W}{0,5}(caliente|calienta|recalienta\\w*|hirviendo|hierve)\\b`),
  /\bexplot\w*/,
]
// Sparks: electrical hazard, except the ignition context ("falta chispa en la bujía").
const SPARKS = /\bchisp\w*/
const IGNITION_CONTEXT = /\b(bujia|bujias|bobina|bobinas)\b/
const WIRING_CONTEXT = /\b(bateri\w*|borne\w*|cable\w*|tablero|fusible\w*|instalacion)\b/

const BURNING_SMELL = new RegExp(`\\b${SMELL}((cable|cables|plastico|goma|caucho|algo)\\s+)?quemad\\w*`)

/**
 * First explicit hazard found in an ALREADY-MASKED normalized text, by urgency:
 * fire/smoke > fuel/gas > battery/electrical > burning smell.
 * Loss of braking capacity is NOT in this list on purpose: it is already recognized by
 * brake-capacity-signals.ts and always surfaces the CRITICAL "No conduzcas" warning, blocked or not
 * (FASE 6 / 6.4B decision, SAFETY.md). See docs/reviews/groq-production-readiness-6.4d.md.
 */
export function detectExplicitHazard(masked: string): ExplicitHazard | null {
  if (FIRE.some((re) => re.test(masked))) return { kind: 'fire_smoke', category: 'fire_smoke', signal: 'hazard:fire' }
  if (SMOKE.test(masked) && !EXHAUST_SMOKE.test(masked)) return { kind: 'fire_smoke', category: 'fire_smoke', signal: 'hazard:smoke' }
  if (FUEL_GAS.some((re) => re.test(masked))) {
    const gas = /\b(gas|gnc)\b/.test(masked) && !/\b(nafta|gasolina|combustible|gasoil|diesel)\b/.test(masked)
    return gas
      ? { kind: 'fuel_gas_leak', category: 'gnc_leak', signal: 'hazard:gas' }
      : { kind: 'fuel_gas_leak', category: 'fuel_leak', signal: 'hazard:fuel' }
  }
  if (SPARKS.test(masked) && !(IGNITION_CONTEXT.test(masked) && !WIRING_CONTEXT.test(masked))) {
    return { kind: 'battery_electrical', category: 'high_voltage', signal: 'hazard:sparks' }
  }
  if (BATTERY_CONTEXT.test(masked) && BATTERY_HAZARDS.some((re) => re.test(masked))) {
    return { kind: 'battery_electrical', category: 'high_voltage', signal: 'hazard:battery' }
  }
  if (BURNING_SMELL.test(masked)) return { kind: 'burning_smell', category: 'fire_smoke', signal: 'hazard:burning_smell' }
  return null
}

/** Convenience for raw user text: mask negated hazards, then detect. */
export function detectExplicitHazardInText(text: string): ExplicitHazard | null {
  return detectExplicitHazard(maskNegatedHazards(text).text)
}
