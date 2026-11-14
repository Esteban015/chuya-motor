/**
 * question-audience.ts — Who a question is for: the driver or the workshop (bugfix 7B).
 *
 * Root cause of the bug: the diagnosis prompt asked for a single "questions" list whose rules
 * mixed "ask the person for missing data" with "questions for the workshop", and the UI labeled
 * the whole list "Preguntas para el taller". Questions only the driver can answer ("¿Desde cuándo
 * notás…?", "¿Te hicieron alguna revisión?") ended up presented as questions for the mechanic.
 *
 * This module is deterministic (no LLM, no network) and only reorganizes or adds fixed texts:
 *   - classifyQuestionAudience: phrase-based audience detection (driver / workshop / unknown).
 *   - arrangeSymptomQuestions: moves misplaced questions to the right list (never drops them),
 *     prepends driver clarifications for ambiguous descriptions and guarantees a few
 *     mechanic-directed questions per topic (check engine, brakes, noise, temperature).
 *   - buildBudgetWorkshopQuestions: fixed questions about a quote, from the server-side totals.
 *
 * Content rules for the fixed workshop questions: they ask the professional for checks and
 * explanations, never assume a hypothesis is confirmed, never recommend a repair and never ask
 * for data only the driver knows. They are interrogative, so they never tell anyone to drive.
 *
 * LIMITATION: the classifier is a phrase list (Spanish, Argentina). Unknown phrasings keep the
 * list the model put them in. It reduces the observed defect; it does not understand language.
 */

import { splitOccurrence } from '@/domain/safety/engine-light-signals'

export const QUESTION_POLICY_VERSION = '1.1.0'
export const MAX_QUESTIONS_PER_AUDIENCE = 5

export type QuestionAudience = 'driver' | 'workshop' | 'unknown'

function norm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:()«»"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Classifier ───────────────────────────────────────────────────────────────

/** The driver is the grammatical subject or the owner: only they can answer. Checked first. */
const DRIVER_SUBJECT =
  /\b(notas|notaste|sentis|sentiste|escuchas|escuchaste|oiste|ves|viste|percibis|percibiste|tenes|tuviste|hiciste|usas|usaste|manejas|manejaste|conducis|condujiste|recorris|recorriste|cargaste|cambiaste|llevaste|sabes|recordas|observaste|observas|probaste|decis|dijiste|podes llevar|podes describir)\b|\bte (hicieron|cambiaron|revisaron|paso|pasa|ocurre|dijeron|aparece|parece)\b|\btu (auto|vehiculo|coche|camioneta|moto)\b/

/** Explicit requests to the professional. Wins over the contextual driver phrases below. */
const WORKSHOP_STRONG =
  /^(me|nos) (podes|podrias|podrian|puede|pueden|podria)\b|^(pueden|podrian|podes|podrias) (revisar|verificar|explicar|mostrar|detallar|confirmar|indicar)\b|\b(codigos?|escaner|obd|obd-ii)\b|^que pruebas?\b|^es seguro (circular|manejar|seguir|conducir)\b|\b(repuestos?|garantia|mano de obra|presupuesto|partidas?)\b|\b(revisaron|verificaron|midieron|encontraron|confirmaron|diagnosticaron)\b|\bque (incluye|implica)\b/

/** Questions about when/how the symptom happens: answered from the driver's experience. */
const DRIVER_CONTEXT =
  /^desde cuando\b|\bcon que frecuencia\b|\bcada cuanto\b|\baparecen? otros sintomas\b|^cuando (empezo|comenzo|ocurre|pasa|aparece|sucede|se (enciende|prende|escucha|siente))\b|\ben que momento\b|^(el|la) (ruido|sintoma|olor|problema|golpe|humo|chirrido|zumbido|vibracion|luz|testigo|falla)\b|\bes (constante|intermitente)\b|\bcuantos? (kilometros|km)\b/

const WORKSHOP_SOFT = /\b(pruebas?|verific\w*|confirm\w*|medicion\w*|reemplaz\w*|reparacion\w*|alternativ\w*|urgente|esperar|causa|seguro)\b/

export function classifyQuestionAudience(question: string): QuestionAudience {
  const n = norm(question)
  if (!n) return 'unknown'
  if (DRIVER_SUBJECT.test(n)) return 'driver'
  if (WORKSHOP_STRONG.test(n)) return 'workshop'
  if (DRIVER_CONTEXT.test(n)) return 'driver'
  if (WORKSHOP_SOFT.test(n)) return 'workshop'
  return 'unknown'
}

// ── Driver clarifications (ambiguous descriptions) ───────────────────────────

const LIGHT = /\b(luz|luces|testigo|check engine|check|tablero|lampara)\b/
const BLINK_EXPLICIT = /\b(parpade\w*|titil\w*|destell\w*)\b/
const NOISE = /\b(ruido\w*|golpe\w*|chirri\w*|zumbido\w*|traqueteo\w*|chill\w*|cruj\w*|silbid\w*)\b/
const NOISE_QUALIFIED =
  /\bal (frenar|acelerar|girar|doblar|arrancar|pasar|cambiar|encender|desacelerar|estacionar|soltar)\b|\ben (frio|caliente|bajada|subida|ralenti|marcha|velocidad|curvas?|pozos?)\b|\bcuando\b|\bsiempre\b|\b(metalic\w*|agud\w*|grave)\b/

export const CLARIFY_INTERMITTENT_LIGHT =
  'Cuando decís que la luz está intermitente, ¿parpadea (se prende y se apaga rápido) con el motor en marcha, o queda fija y aparece solo algunas veces?'
export const CLARIFY_ALWAYS_LIGHT =
  '¿La luz queda encendida fija todo el tiempo con el motor en marcha, o se enciende siempre en un momento puntual (por ejemplo al arrancar) y después se apaga?'
export const CLARIFY_SOMETIMES_LIGHT = 'Cuando aparece, ¿la luz queda fija o parpadea? ¿En qué situación se enciende?'
export const CLARIFY_BLINKING_LIGHT = '¿La luz parpadea todo el tiempo o solo en algunas situaciones, por ejemplo al acelerar?'
export const CLARIFY_LIGHT_STATE = '¿La luz queda fija, parpadea o aparece solo algunas veces?'
export const CLARIFY_NOISE_MOMENT = '¿En qué momento aparece el ruido: al arrancar, al acelerar, al frenar, al girar o con el auto detenido?'

/**
 * Fixed questions for the driver when the description admits more than one reading. It never
 * picks an interpretation; warnings (Safety Gate / Severity Assessor) are computed elsewhere and
 * are not affected by this ambiguity.
 */
export function detectDriverClarifications(userText: string): string[] {
  const n = norm(userText)
  // 1.1.0: the wizard suffix "Condición de ocurrencia: X" says WHEN the problem happens. It is never
  // read as the state of the light ("Intermitente" there means "sometimes", not "blinking").
  const { body, occurrence } = splitOccurrence(n)
  const out: string[] = []
  if (LIGHT.test(body)) {
    const blink = BLINK_EXPLICIT.test(body)
    if (blink) out.push(CLARIFY_BLINKING_LIGHT)
    else if (/\bintermitente\w*/.test(body)) out.push(CLARIFY_INTERMITTENT_LIGHT)
    else if (/\bsiempre\b/.test(body)) out.push(CLARIFY_ALWAYS_LIGHT)
    else if (/\b(a veces|de vez en cuando|ocasional\w*|cada tanto|por momentos)\b/.test(body) || occurrence === 'intermitente') {
      out.push(CLARIFY_SOMETIMES_LIGHT)
    } else out.push(CLARIFY_LIGHT_STATE)
  }
  // The occurrence does qualify a noise ("Al frenar", "Siempre").
  if (NOISE.test(body) && !NOISE_QUALIFIED.test(n)) out.push(CLARIFY_NOISE_MOMENT)
  return out
}

// ── Workshop questions per topic ─────────────────────────────────────────────

export const WS_OBD_CODES = '¿Qué códigos de falla registró el escáner OBD-II y qué indica cada uno?'
export const WS_BLINKING_SAFETY = '¿Es seguro circular hasta el taller si la luz parpadea, o conviene trasladar el vehículo de otra forma?'
export const WS_BRAKES_STATE = '¿En qué estado están las pastillas, los discos y el líquido de frenos, y cómo lo midieron?'
export const WS_NOISE_SOURCE = '¿De qué zona proviene el ruido y qué prueba hicieron para ubicarlo?'
export const WS_COOLING = '¿Qué revisaron del sistema de refrigeración y qué encontraron?'
export const WS_CONFIRM_BEFORE_REPLACING = '¿Qué pruebas permiten confirmar la causa antes de reemplazar componentes?'
export const WS_SAFE_TO_DRIVE = '¿Es seguro circular con este síntoma hasta la reparación?'
export const WS_NOW_OR_LATER = '¿Qué reparación es necesaria ahora y cuál puede esperar? ¿Por qué?'

interface Requirement {
  text: string
  /** Already covered by a model question → not added. */
  covered: RegExp
}

function workshopRequirements(userText: string): Requirement[] {
  const n = splitOccurrence(norm(userText)).body
  const reqs: Requirement[] = []
  const light = LIGHT.test(n)
  const checkEngine = /\bcheck( |-)?engine\b|\bcheck\b|\b(luz|testigo) (de|del) (motor|falla|averia|inyeccion)\b|\bmil\b/.test(n)
  if (checkEngine) reqs.push({ text: WS_OBD_CODES, covered: /\b(codigos?|obd|escaner)\b/ })
  if (light && (BLINK_EXPLICIT.test(n) || /\bintermitente\w*/.test(n))) {
    reqs.push({ text: WS_BLINKING_SAFETY, covered: /\bseguro (circular|manejar|seguir|conducir)\b/ })
  }
  if (/\bfren\w*/.test(n)) reqs.push({ text: WS_BRAKES_STATE, covered: /\b(pastillas|discos|liquido de frenos)\b/ })
  if (NOISE.test(n)) reqs.push({ text: WS_NOISE_SOURCE, covered: /\b(zona|proviene|origen|ubicar\w*)\b/ })
  if (/\b(temperatur\w*|calienta\w*|recalent\w*|refrigera\w*)\b/.test(n)) reqs.push({ text: WS_COOLING, covered: /\brefrigera\w*/ })
  reqs.push({ text: WS_CONFIRM_BEFORE_REPLACING, covered: /\b(confirmar la causa|antes de (reemplazar|cambiar))\b/ })
  reqs.push({ text: WS_SAFE_TO_DRIVE, covered: /\bseguro (circular|manejar|seguir|conducir)\b/ })
  return reqs
}

function dedupe(list: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const q of list) {
    const key = norm(q)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(q)
  }
  return out
}

export interface ArrangedQuestions {
  driverQuestions: string[]
  workshopQuestions: string[]
}

/**
 * Splits the model's questions by audience (moving, not dropping — except beyond the 5-item cap,
 * where the fixed clarifications keep priority), adds driver clarifications
 * for ambiguous descriptions and guarantees the topic's mechanic-directed questions.
 * Model-specific workshop questions keep the first places.
 */
export function arrangeSymptomQuestions(input: { userText: string; workshopQuestions: readonly string[]; driverQuestions: readonly string[] }): ArrangedQuestions {
  const toWorkshop: string[] = []
  const toDriver: string[] = []
  for (const q of input.workshopQuestions) (classifyQuestionAudience(q) === 'driver' ? toDriver : toWorkshop).push(q)
  for (const q of input.driverQuestions) (classifyQuestionAudience(q) === 'workshop' ? toWorkshop : toDriver).push(q)

  const modelWorkshop = dedupe(toWorkshop)
  const modelText = modelWorkshop.map(norm).join(' \n ')
  const missing = workshopRequirements(input.userText)
    .filter((r) => !r.covered.test(modelText))
    .map((r) => r.text)
  // A blinking-light safety question already covers the generic one.
  const required = missing.includes(WS_BLINKING_SAFETY) ? missing.filter((t) => t !== WS_SAFE_TO_DRIVE) : missing

  const keepFromModel = Math.max(2, MAX_QUESTIONS_PER_AUDIENCE - required.length)
  let workshop = dedupe([...modelWorkshop.slice(0, keepFromModel), ...required]).slice(0, MAX_QUESTIONS_PER_AUDIENCE)
  if (workshop.length < 3) workshop = dedupe([...workshop, WS_NOW_OR_LATER]).slice(0, MAX_QUESTIONS_PER_AUDIENCE)

  const workshopKeys = new Set(workshop.map(norm))
  const driver = dedupe([...detectDriverClarifications(input.userText), ...toDriver])
    .filter((q) => !workshopKeys.has(norm(q)))
    .slice(0, MAX_QUESTIONS_PER_AUDIENCE)

  return { driverQuestions: driver, workshopQuestions: workshop }
}

// ── Budget ───────────────────────────────────────────────────────────────────

export const WB_REVIEW_SUM = '¿Pueden revisar la suma del presupuesto? El total no coincide con la suma de las partidas.'
export const WB_MISSING_AMOUNTS = '¿Cuál es el importe de las partidas que figuran sin precio?'
export const WB_LABOR_SCOPE = '¿Qué incluye exactamente cada partida de mano de obra?'
export const WB_PARTS_WARRANTY = '¿Los repuestos son originales o alternativos, y qué garantía tienen?'
export const WB_WHY_NEEDED = '¿Qué prueba o revisión confirmó que cada reparación es necesaria? ¿Alguna puede esperar?'

export const WB_ITEMIZE = '¿Pueden detallar cada partida con su importe y la moneda?'

/** Fixed, mechanic-directed questions about a quote. Never judges whether a price is fair. */
export function buildBudgetWorkshopQuestions(budget: {
  completenessStatus?: 'COMPLETE' | 'PARTIAL' | 'INVALID'
  discrepancy: boolean | null
  missingLineCount: number
}): string[] {
  const out: string[] = []
  if (budget.completenessStatus === 'INVALID') out.push(WB_ITEMIZE)
  if (budget.discrepancy === true) out.push(WB_REVIEW_SUM)
  if (budget.missingLineCount > 0) out.push(WB_MISSING_AMOUNTS)
  out.push(WB_LABOR_SCOPE, WB_PARTS_WARRANTY, WB_WHY_NEEDED)
  return out.slice(0, MAX_QUESTIONS_PER_AUDIENCE)
}
