/**
 * engine-light-signals.ts — Deterministic reading of the engine warning light (check engine / MIL)
 * in a symptom description (bugfix 7B, safety review). No LLM.
 *
 * States:
 *   blinking               — the light blinks/flashes ("parpadea", "titila", "destella").
 *   ambiguous_intermittent — "intermitente" next to the engine light: blinking OR appears sometimes.
 *   steady                 — "fija", "queda encendida", "se enciende siempre".
 *   occasional             — "a veces", "de vez en cuando", or the wizard occurrence "Intermitente".
 *   unspecified            — the engine light is mentioned without a state.
 *   null                   — no engine-light context (turn signals, other lights, other symptoms).
 *
 * The /demo/falla wizard appends `Condición de ocurrencia: <opción>.` to the text. That suffix
 * describes WHEN the problem happens ("Intermitente" = sometimes, "Siempre" = always): it is read
 * separately and never taken as the state of the light.
 *
 * LIMITATION: phrase list (Spanish, Argentina). Unknown phrasings fall back to "unspecified".
 */
import { normalizeText } from './text-normalization'

export type EngineLightState = 'blinking' | 'ambiguous_intermittent' | 'steady' | 'occasional' | 'unspecified'

const OCCURRENCE_SUFFIX = /\bcondicion de ocurrencia\s+(.*)$/

/** Splits the wizard suffix off a normalized text. */
export function splitOccurrence(normalized: string): { body: string; occurrence: string | null } {
  const m = OCCURRENCE_SUFFIX.exec(normalized)
  if (!m) return { body: normalized, occurrence: null }
  return { body: normalized.slice(0, m.index).trim(), occurrence: m[1]!.trim() || null }
}

const ENGINE_LIGHT =
  /\bcheck\s*engine\b|\bservice engine\b|\b(luz|luces|testigo|lampara|indicador)( amarill[oa])? (de|del) (motor|check|falla|averia|inyeccion)\b|\bmil\b/
/** Turn signals / hazard lights: never the engine light. Removed before reading the state. */
const TURN_SIGNALS = /\b(luz|luces) (de )?giro\b|\bintermitentes? de giro\b|\b(el|los|la|las|un|unos) intermitentes\b|\bbalizas?\b|\b(pongo|pone|activo|uso|prendo|enciendo) (el|los|la|las) intermitentes?\b/g
const NEGATED_BLINK = /\bno (esta |estaba )?(parpade\w*|titil\w*|destell\w*|flashe\w*)/g
const BLINK = /\b(parpade\w*|titil\w*|destell\w*|flashe\w*)\b/
const INTERMITTENT = /\bintermitente\w*\b/
const STEADY = /\bfij[oa]s?\b|\bqueda (prendid|encendid)[oa]\b|\b(se enciende|se prende|esta prendida|esta encendida) siempre\b|\bsiempre (prendid|encendid)[oa]\b/
const OCCASIONAL = /\ba veces\b|\bde vez en cuando\b|\bocasional\w*\b|\bcada tanto\b|\bpor momentos\b/

export function detectEngineLightState(userText: string): EngineLightState | null {
  const { body, occurrence } = splitOccurrence(normalizeText(userText))
  const text = body.replace(TURN_SIGNALS, ' ')
  if (!ENGINE_LIGHT.test(text)) return null
  const unnegated = text.replace(NEGATED_BLINK, ' ')
  if (BLINK.test(unnegated)) return 'blinking'
  if (INTERMITTENT.test(text)) return 'ambiguous_intermittent'
  if (STEADY.test(text)) return 'steady'
  if (OCCASIONAL.test(text) || occurrence === 'intermitente') return 'occasional'
  return 'unspecified'
}
