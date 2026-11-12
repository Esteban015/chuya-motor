/**
 * output-safety.ts — Deterministic safety validation of LLM-generated diagnosis text
 * (Incremento 6.4B, D-05).
 *
 * Runs server-side, after the LLM answer passed schema validation and BEFORE the report is built.
 * It never asks the LLM to judge its own answer and never rewrites text: an unsafe answer is
 * withheld as a whole (see outputSafetyGuardNode).
 *
 * Authority: deterministic warnings (Safety Gate, Severity Assessor) stay the source of truth.
 * The recognized risk level comes from resolveUserFacingSeverity(userText), never from the LLM.
 *
 * Checks:
 *   STRUCTURE_INVALID                   — shape/limits of facts, hypotheses, questions.
 *   DIY_INSTRUCTION_SAFETY_SYSTEM       — any severity: instructions for the user to intervene on
 *                                         a safety-critical system (SAFETY.md: no DIY in MVP).
 *   DRIVING_ENCOURAGED_UNDER_RISK       — severity high/critical: "podés seguir manejando", …
 *   RISK_MINIMIZED_UNDER_RISK           — severity high/critical: "no es grave", "no te preocupes".
 *   PROFESSIONAL_DISCOURAGED_UNDER_RISK — severity high/critical: "no hace falta ir al taller".
 *   UNSAFE_ELECTRICAL_CHECK             — any severity (6.4F, D-14): a check that implies handling the
 *                                         battery, bridging cables or high voltage, in ANY mood
 *                                         ("al desconectar la batería…", "puenteando el relé…"),
 *                                         unless prohibited, performed by a named professional, or
 *                                         asked as a descriptive question.
 *
 * False-positive controls: quoted segments are removed; sentences with reported speech
 * ("según tu relato", "mencionaste", "te dijeron") are skipped; negations in the 3 preceding
 * tokens ("no", "nunca", "evitá", …) cancel a match; questions to the user are exempt from the
 * risk-context checks (not from the DIY check).
 *
 * LIMITATION: this is a phrase list. It reduces known unsafe patterns; it cannot guarantee the
 * detection of every unsafe recommendation (paraphrases, other languages, irony, evasion through
 * attribution). It complements — never replaces — the Safety Gate, the prompt rules and
 * professional review.
 */
import { z } from 'zod'
import { normalizeText } from './safety-policy'

export const OUTPUT_SAFETY_VERSION = '1.1.0'

export type OutputSafetyViolation =
  | 'STRUCTURE_INVALID'
  | 'DIY_INSTRUCTION_SAFETY_SYSTEM'
  | 'DRIVING_ENCOURAGED_UNDER_RISK'
  | 'RISK_MINIMIZED_UNDER_RISK'
  | 'PROFESSIONAL_DISCOURAGED_UNDER_RISK'
  | 'UNSAFE_ELECTRICAL_CHECK'

export interface DiagnosisOutputCandidate {
  facts: string[]
  hypotheses: Array<{
    statement: string
    confidence: 'low' | 'medium' | 'high'
    caveats: string[]
    evidenceIds?: string[]
  }>
  questions: string[]
}

export interface OutputSafetyContext {
  /** Deterministic, user-facing severity level (from resolveUserFacingSeverity). */
  severityLevel: 'normal' | 'high' | 'critical'
}

export interface OutputSafetyResult {
  safe: boolean
  violations: OutputSafetyViolation[]
}

// Same limits as DiagnosisResponseSchema, plus non-empty text.
const nonEmpty = (max: number) => z.string().max(max).refine((s) => s.trim().length > 0)
const CandidateSchema = z.object({
  facts: z.array(nonEmpty(500)).max(10),
  hypotheses: z
    .array(
      z.object({
        statement: nonEmpty(500),
        confidence: z.enum(['low', 'medium', 'high']),
        caveats: z.array(z.string().max(200)).max(10),
        evidenceIds: z.array(z.string().max(100)).max(20).optional(),
      }),
    )
    .max(5),
  questions: z.array(nonEmpty(300)).max(5),
})

// ── Patterns (run on normalizeText output: lowercase, no accents, no punctuation) ──────────────

const MOVE = String.raw`(manej|conduc|circul)\w*|usa(r|ndo)\w*|utiliza(r|ndo)\w*`

const DRIVING_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\b(podes|puedes|podrias|podras|podra|se\s+puede)\s+(seguir\s+|continuar\s+)?(${MOVE})`),
  new RegExp(String.raw`\b(segui|siga|continua|continue)\s+(${MOVE})`),
  new RegExp(String.raw`\b(es|resulta|seria|sigue\s+siendo)\s+(seguro|posible|aceptable|razonable)\s+(seguir\s+|continuar\s+)?(${MOVE})`),
  new RegExp(String.raw`\bno\s+(hay|existe)\s+(ningun\s+)?(riesgo|peligro|problema)\s+(en|de|para|al)\s+(seguir\s+|continuar\s+)?(${MOVE})`),
  /\bno\s+(es\s+(necesario|urgente)|hace\s+falta)\s+(dejar\s+de|detener\w*|parar)\b/,
]

const MINIMIZATION_PATTERNS: readonly RegExp[] = [
  /\bno\s+(es|parece|seria|luce)\s+(nada\s+)?(grave|peligroso|preocupante|urgente|serio|riesgoso)\b/,
  /\bno\s+te\s+preocupes\b/,
  /\bno\s+(hay|existe)\s+(ningun\s+)?(riesgo|peligro)\b/,
  /\b(es|parece)\s+(totalmente\s+)?inofensiv\w*/,
]

const PROFESSIONAL_DISCOURAGED_PATTERNS: readonly RegExp[] = [
  /\bno\s+(es\s+(necesario|urgente|imprescindible)|hace\s+falta|necesitas|tenes\s+que|tienes\s+que)\s+(ir|llevar\w*|consultar\w*|acudir|visitar)\b/,
]

const DIY_VERBS = String.raw`purgar|sangrar|desconectar|desarmar|desmontar|aflojar|abrir|quitar|sacar|puentear|anular|desactivar|manipular|cambiar|reemplazar|ajustar|rellenar|cortar|soldar`
const DIY_MODAL = new RegExp(
  String.raw`\b(podes|puedes|tenes\s+que|tienes\s+que|debes|deberias|necesitas|intenta|proba)\s+(\w+\s+){0,2}?(${DIY_VERBS})\b`,
)
// Voseo imperatives keep their accent in the raw text ("purgá", "abrí"): checked before normalizing.
const DIY_IMPERATIVE_RAW =
  /(?:^|[\s¡¿("'])(purgá|sangrá|desconectá|desarmá|desmontá|aflojá|abrí|quitá|sacá|puenteá|anulá|desactivá|manipulá|cambiá|reemplazá|ajustá|rellená|cortá|soldá)(?=[\s,.;:!?)]|$)/i
const DIY_IMPERATIVE_USTED = /\b(purgue|desconecte|desmonte|desarme|afloje|puentee|anule|desactive|manipule|reemplace)\b/
const DIY_SELF = /\b(vos\s+mismo|tu\s+mismo|usted\s+mismo|por\s+tu\s+cuenta|en\s+casa)\b/
const SAFETY_SYSTEM_OBJECT =
  /\b(fren\w*|pastillas?|discos?|abs|airbag|bolsa\s+de\s+aire|alta\s+tension|hibrid\w*|gnc|gas|combustible|nafta|gasoil|tanque|inyector\w*|direccion|cremallera|radiador|refrigerante|bateria)\b/
const DELEGATED_TO_PROFESSIONAL = /\b(taller|mecanico|profesional|especialista|concesionari\w*|tecnico)\b/

const ATTRIBUTION =
  /\b(segun\s+(vos|usted|tu\s+relato|tu\s+descripcion|lo\s+que\s+\w+)|el\s+usuario\s+(dice|indica|menciona|reporta|comenta|afirma|refiere|senala)|mencionaste|indicaste|dijiste|comentaste|contaste|declaraste|referiste|senalaste|te\s+dijeron|le\s+dijeron|me\s+dijeron|te\s+comentaron|le\s+comentaron)\b/

const NEGATORS = new Set(['no', 'nunca', 'jamas', 'ni', 'sin', 'evita', 'evitar', 'evites', 'tampoco', 'nadie'])

// ── D-14 (6.4F): electrical / battery / high-voltage checks, in any grammatical mood ──────────────
// Verb forms are limited to infinitive, gerund, imperative and present: a past description
// ("alguien desconectó la batería") is not a suggestion.
const BATTERY_TARGET = String.raw`(bateria|baterias|borne|bornes|terminal|terminales|polo|polos)`
const HANDLE_VERB = String.raw`(desconect|desenchuf|manipul)(ar|ando|a|as|e|es|en|arla|arlo|ala|alo|andola|andolo)|(sac|quit|retir)(ar|ando|a|ala|arla|andola)|(desmont|desarm)(ar|ando|a|e|es|arla|ala)`
const TOUCH_VERB = String.raw`(tocar|tocando|toca|toques|toque)`
const HV_VERB = String.raw`(medir|midiendo|medi|tocar|tocando|toca|manipular|manipulando|manipula|abrir|abriendo|abri|desconectar|desconectando|desconecta|revisar|revisando|revisa)`
const HV_TARGET = String.raw`(alta\s+tension|cables?\s+naranjas?|pack\s+de\s+baterias|baterias?\s+(de\s+)?(alta\s+tension|hibrid\w*|traccion))`

const ELECTRICAL_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\b(${HANDLE_VERB})\s+(\w+\s+){0,3}?${BATTERY_TARGET}\b`, 'g'),
  new RegExp(String.raw`\b(con|dejando|deja|dejar|dejala)\s+(la\s+)?bateria\s+desconectad\w*`, 'g'),
  new RegExp(String.raw`\b${TOUCH_VERB}\s+(\w+\s+){0,2}?(bateria|borne\w*|terminal\w*|cable\w*)\b`, 'g'),
  new RegExp(String.raw`\bpuente(ar|ando|ado|a|an|as|e|es|o)\b`, 'g'),
  new RegExp(String.raw`\b(hac|hag)\w*\s+(un\s+)?puente\b`, 'g'),
  new RegExp(String.raw`\b(usar|usando|usa|conectar|conectando|conecta|poner|poniendo|proba|probar|probando)\s+(\w+\s+){0,2}?cables?\s+(de\s+)?(arranque|puente)\b`, 'g'),
  new RegExp(String.raw`\b${HV_VERB}\s+(\w+\s+){0,4}?${HV_TARGET}`, 'g'),
]
/** Second-person directives: a professional mention never excuses "desconectá…" / "podés desconectar…". */
const DIRECTIVE_MODAL = /\b(podes|puedes|podrias|tenes\s+que|tienes\s+que|debes|deberias|necesitas|intenta|proba)\b/
const RECOMMENDATION = /\b(recomiend\w*|recomendad\w*|aconsej\w*|sugier\w*|suger\w*)\b/
const PROFESSIONAL_AGENT = /\b(taller|mecanico|mecanica|profesional|especialista|electricista|concesionari\w*|tecnico)\b/

/** True when at least one electrical-handling match is not preceded (3 tokens) by a negator. */
function hasAffirmativeElectricalMatch(normalized: string): boolean {
  for (const re of ELECTRICAL_PATTERNS) {
    for (const m of normalized.matchAll(re)) {
      const before = normalized.slice(0, m.index).trim().split(' ').filter(Boolean).slice(-3)
      if (!before.some((t) => NEGATORS.has(t))) return true
    }
  }
  return false
}

function isUnsafeElectricalCheck(s: Sentence): boolean {
  if (!hasAffirmativeElectricalMatch(s.normalized)) return false
  const directive = DIY_IMPERATIVE_RAW.test(s.raw) || DIRECTIVE_MODAL.test(s.normalized)
  if (directive) return true
  if (s.interrogative) return false // descriptive question ("¿Alguien desconectó la batería?")
  if (RECOMMENDATION.test(s.normalized)) return true // "algunos / muchos mecánicos recomiendan…"
  if (PROFESSIONAL_AGENT.test(s.normalized)) return false // performed by a named professional
  return true // impersonal / infinitive / gerund suggestion
}

interface Sentence {
  raw: string
  normalized: string
  interrogative: boolean
}

function toSentences(text: string): Sentence[] {
  const unquoted = text.replace(/["“”«»][^"“”«»]{0,300}["“”«»]/g, ' ')
  return unquoted
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => ({
      raw,
      normalized: normalizeText(raw),
      interrogative: raw.startsWith('¿') || raw.endsWith('?'),
    }))
}

/** A match counts only if none of the 3 tokens immediately before it is a negator. */
function matchesAffirmatively(normalized: string, patterns: readonly RegExp[]): boolean {
  for (const re of patterns) {
    const m = re.exec(normalized)
    if (!m) continue
    const before = normalized.slice(0, m.index).trim().split(' ').filter(Boolean).slice(-3)
    if (!before.some((t) => NEGATORS.has(t))) return true
  }
  return false
}

function isDiyInstruction(s: Sentence): boolean {
  if (!SAFETY_SYSTEM_OBJECT.test(s.normalized)) return false
  const self = DIY_SELF.test(s.normalized)
  if (!self && DELEGATED_TO_PROFESSIONAL.test(s.normalized)) return false
  if (DIY_IMPERATIVE_RAW.test(s.raw)) {
    const idx = s.raw.search(DIY_IMPERATIVE_RAW)
    const before = normalizeText(s.raw.slice(0, idx)).split(' ').filter(Boolean).slice(-3)
    if (!before.some((t) => NEGATORS.has(t))) return true
  }
  if (matchesAffirmatively(s.normalized, [DIY_MODAL, DIY_IMPERATIVE_USTED])) return true
  return false
}

export function validateDiagnosisOutput(
  candidate: DiagnosisOutputCandidate,
  ctx: OutputSafetyContext,
): OutputSafetyResult {
  const parsed = CandidateSchema.safeParse(candidate)
  if (!parsed.success) return { safe: false, violations: ['STRUCTURE_INVALID'] }

  const data = parsed.data
  const texts: string[] = [
    ...data.facts,
    ...data.hypotheses.flatMap((h) => [h.statement, ...h.caveats]),
    ...data.questions,
  ]
  const violations = scanUnsafeTexts(texts, ctx)
  return { safe: violations.length === 0, violations }
}

/**
 * Text-level scan without the structural limits (6.4F). Used for every user-visible text of a valid
 * answer and for text removed by schema normalization, so that removing an over-length item can
 * never hide an unsafe recommendation.
 */
export function scanUnsafeTexts(texts: readonly string[], ctx: OutputSafetyContext): OutputSafetyViolation[] {
  const riskRecognized = ctx.severityLevel === 'high' || ctx.severityLevel === 'critical'
  const violations = new Set<OutputSafetyViolation>()

  for (const sentence of texts.flatMap(toSentences)) {
    if (ATTRIBUTION.test(sentence.normalized)) continue // reported speech / citation

    if (isDiyInstruction(sentence)) violations.add('DIY_INSTRUCTION_SAFETY_SYSTEM')
    if (isUnsafeElectricalCheck(sentence)) violations.add('UNSAFE_ELECTRICAL_CHECK')

    if (!riskRecognized || sentence.interrogative) continue
    if (matchesAffirmatively(sentence.normalized, DRIVING_PATTERNS)) violations.add('DRIVING_ENCOURAGED_UNDER_RISK')
    if (matchesAffirmatively(sentence.normalized, MINIMIZATION_PATTERNS)) violations.add('RISK_MINIMIZED_UNDER_RISK')
    if (matchesAffirmatively(sentence.normalized, PROFESSIONAL_DISCOURAGED_PATTERNS)) {
      violations.add('PROFESSIONAL_DISCOURAGED_UNDER_RISK')
    }
  }

  return [...violations]
}
