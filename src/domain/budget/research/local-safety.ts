/**
 * local-safety.ts — Safety contract of the parts mode (Incremento 7B).
 *
 * WHAT THE PARTS MODE DOES: it runs entirely in the browser, performs NO server operation and
 * calls NO LLM. Its only outputs are fixed texts and a Google search link per part. So the
 * security goal is: a search link is produced only for something that reads as a PART
 * IDENTIFICATION, never for tampering, DIY on safety systems or symptom descriptions.
 * (The quote mode is different: POST /api/analyze is the server operation and the server Safety
 * Gate — unchanged — stays authoritative there. No server decision depends on this file.)
 *
 * Policy (Safety Gate rules unchanged; this file only decides how to apply its result):
 *   1. Whole text through checkSafetyGate. BLOCK when the reason is intent (DIY, symptom, …),
 *      an explicit hazard (fuel / fire / battery / burning smell) or loss of braking.
 *   2. Each line through screenPartDescription. BLOCK if any line is "unsafe": action verbs
 *      (anular, desconectar, puentear, reparar, …), questions or symptom words on a safety system
 *      (the gate flags it or it names brakes / ABS / airbag / steering / fuel / gas / battery).
 *   3. The bare name of a safety-system part ("Pastillas de freno Fiat Palio 2017", "Precio de
 *      bomba de nafta") is allowed: it is a commercial query and generates no text.
 * Lines that are not part names but not unsafe ("Cómo cambiar la correa") are "not_a_part": the UI
 * rejects them as a form error and never builds a search for them.
 * screenPartDescription is also enforced when a card renders, so descriptions added or edited after
 * the check (or injected into the state) can never produce a search link.
 */
import type { SafetyBlockPayload } from '@/app/api/analyze/schema'
import { checkSafetyGate } from '@/domain/safety/safety-policy'
import { detectExplicitHazardInText } from '@/domain/safety/hazard-signals'
import { detectsBrakeCapacityLoss, resolveUserFacingSeverity } from '@/domain/safety/severity-assessor'
import { normalizeForMatch, stripInvisible } from './line-parser'
import { MAX_DESCRIPTION } from './types'

/** Same fixed text as reportBuilder (SAFETY.md) — kept in sync by guidance-safety.test.ts. */
export const SAFETY_DERIVATION_MESSAGE =
  'Por seguridad, este tipo de intervención requiere atención profesional. Contactá un taller o mecánico habilitado.'

const INTERROGATIVE = /[¿?]|\b(como|donde|cuando|por que|puedo|se puede|hay que|tengo que|debo)\b/
// Verb forms only: nouns that name a workshop service ("Cambio de pastillas", "Reemplazo de…") are
// legitimate quote lines and must stay searchable.
const ACTION =
  /\b(anul\w*|desactiv\w*|desconect\w*|puente\w*|bypass\w*|sacar|saco|sacarle|quitar|quito|eliminar|elimino|reparar|reparo|arreglar|arreglo|desarmar|desarmo|purgar|purgo|ajustar|ajusto|regular|manipul\w*|modificar|modifico|trucar|truco|cortar|corto|soldar|cambiar|reemplazar|instalar|instalo|colocar|coloco|hacer)\b/
const SYMPTOM = /\b(pierde\w*|perdida|fuga\w*|gotea\w*|goteo|olor|humo|fuego|incendio|quema\w*|chispa\w*|no frena|no anda|falla\w*|ruido\w*|vibra\w*)\b/
const SAFETY_SYSTEM = /\b(fren\w*|abs|pastilla\w*|disco\w*|airbag\w*|direccion|rotula\w*|extremo\w*|nafta|combustible|gnc|gas|inyector\w*|bateria\w*|cable\w* de alta|alta tension)\b/

export type PartScreen = { ok: true } | { ok: false; reason: 'empty' | 'too_long' | 'unsafe' | 'not_a_part' }

export function screenPartDescription(description: string): PartScreen {
  const clean = stripInvisible(description).replace(/\s+/g, ' ').trim()
  if (!clean || !/[\p{L}\p{N}]/u.test(clean)) return { ok: false, reason: 'empty' }
  if (clean.length > MAX_DESCRIPTION) return { ok: false, reason: 'too_long' }
  const n = normalizeForMatch(clean)
  if (!INTERROGATIVE.test(n) && !ACTION.test(n) && !SYMPTOM.test(n)) return { ok: true }
  if (checkSafetyGate(clean).blocked || SAFETY_SYSTEM.test(n)) return { ok: false, reason: 'unsafe' }
  return { ok: false, reason: 'not_a_part' }
}

export const PART_SCREEN_TEXT: Record<Exclude<PartScreen, { ok: true }>['reason'], string> = {
  empty: 'Escribí el nombre del repuesto.',
  too_long: 'La descripción es demasiado larga (máximo 200 caracteres).',
  unsafe: 'Por seguridad, no generamos búsquedas para esta descripción. Si necesitás una reparación, consultá con un taller.',
  not_a_part: 'No parece el nombre de un repuesto. Escribí solo la pieza (por ejemplo «Correa de distribución»).',
}

export type LocalSafetyResult = { blocked: false } | { blocked: true; payload: SafetyBlockPayload }

function block(text: string, policyVersion: string, coverageDisclaimer: string): LocalSafetyResult {
  return {
    blocked: true,
    payload: {
      error: 'SAFETY_BLOCKED',
      safetyBlocked: true,
      safetyDerivationMessage: SAFETY_DERIVATION_MESSAGE,
      policyVersion,
      coverageDisclaimer,
      severity: resolveUserFacingSeverity({ userText: text, safetyBlocked: true, route: null }),
    },
  }
}

export function localSafetyCheck(text: string): LocalSafetyResult {
  const gate = checkSafetyGate(text)
  if (gate.blocked) {
    const partNameOnly =
      gate.intentClassification === 'ambiguous' && detectExplicitHazardInText(text) === null && !detectsBrakeCapacityLoss(text)
    if (!partNameOnly) return block(text, gate.policyVersion, gate.coverageDisclaimer)
  }
  const unsafeLine = text.split(/\r?\n/).some((line) => {
    const s = screenPartDescription(line)
    return !s.ok && s.reason === 'unsafe'
  })
  if (unsafeLine) return block(text, gate.policyVersion, gate.coverageDisclaimer)
  return { blocked: false }
}
