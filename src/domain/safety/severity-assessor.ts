/**
 * severity-assessor.ts — Deterministic severity assessment for non-blocked symptom cases.
 *
 * Purpose: Surface a visual warning for safety-relevant symptoms that passed the Safety Gate
 * (they are not DIY repair requests, but still indicate a potentially dangerous condition).
 *
 * Contract:
 * - Runs ONLY after safetyBlocked=false and route='symptom'.
 * - Fully deterministic: no LLM, no randomness.
 * - Returns null for 'normal' level (no banner needed).
 * - Does NOT block the case or modify the LangGraph output.
 * - Rules are applied in order; first match wins (CRITICAL rules checked before HIGH).
 *
 * Integration point: computed in route.ts → included in ClientAnalyzeOutput → rendered by ReportView.
 */

import { normalizeText } from './safety-policy'

export type SeverityLevel = 'normal' | 'high' | 'critical'

export interface SeverityAssessment {
  level: SeverityLevel
  title: string
  message: string
  action: string
}

type Rule = {
  level: SeverityLevel
  test: (normalized: string) => boolean
  title: string
  message: string
  action: string
}

// ── CRITICAL rules ────────────────────────────────────────────────────────────
// These indicate a potential brake or safety system failure that passed the Safety Gate
// (phrased in ways that don't trigger exact-phrase Stage 2, but still imply a live risk).

const CRITICAL_RULES: readonly Rule[] = [
  // Pedal/brake requires extreme travel to stop — various phrasings not covered by Stage 2 exact phrases.
  // Catches: "pisar el pedal muy a fondo para frenar", "pedal de freno se va al fondo",
  //          "apretar el freno hasta el fondo", "freno al fondo", "frenos al fondo".
  // SV-13 fix: added fren\w{0,2}\s+(al\s+|hasta\s+el\s+)fond to cover "freno al/hasta el fondo"
  //            without requiring "pedal" or "pisar".
  {
    level: 'critical',
    test: (n) =>
      /fren/.test(n) &&
      (
        /pedal.{0,35}fond/.test(n) ||
        /pisar.{0,35}fond.{0,35}fren|pisar.{0,35}fren.{0,35}fond/.test(n) ||
        /fren\w{0,2}\s+(al\s+|hasta\s+el\s+)fond/.test(n)
      ),
    title: 'Atención: síntoma crítico de seguridad',
    message:
      'El problema descripto podría comprometer seriamente el sistema de frenos.',
    action:
      'No conduzcas el vehículo. Solicitá asistencia profesional antes de volver a utilizarlo.',
  },

  // Braking clearly insufficient or barely working — not caught by Safety Gate Stage 2 exact phrases.
  // Catches: "frena muy poco", "casi no frena", "frenado insuficiente", "apenas frena".
  // SV-14 fix: added apenas.{0,15}fren and fren\w{0,2}\s+apenas to cover "apenas frena",
  //            "apenas puedo frenar", "frena apenas".
  {
    level: 'critical',
    test: (n) =>
      /fren/.test(n) &&
      /(poc[ao]\s+fren|fren.{0,25}(muy\s+poc|poc[ao]|casi\s+nad|casi\s+no|insuficien|deficien|no\s+fren.{0,10}bien)|fren.{0,10}mal\b|apenas.{0,15}fren|fren\w{0,2}\s+apenas)/.test(
        n,
      ),
    title: 'Atención: síntoma crítico de seguridad',
    message:
      'El problema descripto podría comprometer seriamente el sistema de frenos.',
    action:
      'No conduzcas el vehículo. Solicitá asistencia profesional antes de volver a utilizarlo.',
  },

  // Smell or fluid seepage explicitly associated with the brake system — passed Safety Gate
  // (phrased without the exact fuel-leak phrases in blocklist.ts).
  {
    level: 'critical',
    test: (n) =>
      /fren/.test(n) &&
      /(olor|fuga|goter|manch|escap|liq).{0,30}fren|fren.{0,30}(olor|fuga|goter|manch|liq)/.test(n),
    title: 'Atención: síntoma crítico de seguridad',
    message:
      'El problema descripto podría comprometer seriamente el sistema de frenos.',
    action:
      'No conduzcas el vehículo. Solicitá asistencia profesional antes de volver a utilizarlo.',
  },
]

// ── HIGH rules ────────────────────────────────────────────────────────────────
// These indicate a condition that warrants prompt professional evaluation.

const HIGH_RULES: readonly Rule[] = [
  // Vibration when braking
  {
    level: 'high',
    test: (n) => /vibr.{0,25}fren|fren.{0,25}vibr/.test(n),
    title: 'Síntoma de alta atención',
    message:
      'La vibración al frenar puede ser señal de desgaste o daño en el sistema de frenos.',
    action: 'Consultá con un taller a la brevedad para evaluar el estado del sistema de frenos.',
  },

  // Noise specifically when braking (chirping, grinding, clicking near brakes)
  {
    level: 'high',
    test: (n) =>
      /(chirri|rechin|cruji).{0,30}fren|fren.{0,30}(chirri|rechin|cruji)|ruido.{0,20}fren|fren.{0,20}ruido/.test(
        n,
      ),
    title: 'Síntoma de alta atención',
    message:
      'Los ruidos al frenar pueden indicar desgaste de pastillas, discos u otras piezas del sistema de frenos.',
    action: 'Consultá con un taller a la brevedad para evaluar el estado del sistema de frenos.',
  },

  // Steering hard, stiff, or non-responsive
  {
    level: 'high',
    test: (n) =>
      /direcc.{0,25}(dura|pesad|rigid|bloq|no\s+(gir|funcion|respond))|volante.{0,25}(duro|pesad|rigid|no\s+(gir|funcion|respond))/.test(
        n,
      ),
    title: 'Síntoma de alta atención',
    message:
      'La dirección dura o pesada puede reducir el control del vehículo en situaciones críticas.',
    action:
      'Consultá con un taller para revisar la servodirección antes de continuar circulando.',
  },

  // Steering vibration
  {
    level: 'high',
    test: (n) => /vibr.{0,25}volante|volante.{0,25}vibr/.test(n),
    title: 'Síntoma de alta atención',
    message:
      'La vibración en el volante puede indicar desbalance, desgaste o problemas en la dirección.',
    action: 'Consultá con un taller para diagnóstico.',
  },

  // Elevated engine temperature (without explicit extreme phrases already caught by Safety Gate)
  {
    level: 'high',
    test: (n) =>
      /(temperatur.{0,20}(alt|subi|elevad|rise)|motor.{0,20}se\s+calient|se\s+calient.{0,20}motor|luz\s+de\s+temperatur)/.test(
        n,
      ),
    title: 'Síntoma de alta atención',
    message:
      'La temperatura elevada del motor puede causar daños severos si no se atiende a tiempo.',
    action:
      'Consultá con un taller a la brevedad. Si la temperatura sigue subiendo, detenete y apagá el motor.',
  },

  // Visible fluid loss (oil, coolant, or unidentified liquid dripping)
  {
    level: 'high',
    test: (n) =>
      /(pierde|gotea|escurr|manch).{0,20}(aceite|liquid|agua|refriger|anticongelante)/.test(n),
    title: 'Síntoma de alta atención',
    message:
      'La pérdida de fluidos puede reducir el rendimiento de sistemas críticos del vehículo.',
    action:
      'Revisá los niveles de fluidos y consultá con un taller para identificar el origen de la pérdida.',
  },
]

/**
 * Returns a severity assessment for a non-blocked symptom case, or null if severity is normal.
 *
 * @param userText - The original user input text (as received by the route handler)
 * @param route - The LangGraph route classification
 * @returns SeverityAssessment for levels 'high' or 'critical'; null for 'normal'
 */
export function assessSeverity(
  userText: string,
  route: string | null,
): SeverityAssessment | null {
  if (route !== 'symptom') return null

  const normalized = normalizeText(userText)

  // CRITICAL rules first
  for (const rule of CRITICAL_RULES) {
    if (rule.test(normalized)) {
      return { level: rule.level, title: rule.title, message: rule.message, action: rule.action }
    }
  }

  // HIGH rules
  for (const rule of HIGH_RULES) {
    if (rule.test(normalized)) {
      return { level: rule.level, title: rule.title, message: rule.message, action: rule.action }
    }
  }

  return null
}
