/**
 * guidance.ts — Fixed, deterministic purchase guidance and workshop questions (Incremento 7B).
 * No prices, no opinions about prices, no repair instructions. Safety-critical parts (brakes,
 * steering, suspension, airbag, fuel) recommend professional installation.
 */
import { normalizeForMatch } from './line-parser'

const GENERIC = [
  'Que sea compatible con tu modelo, año y motor (no solo con la marca del auto).',
  'El código de la pieza original o el equivalente que indique el fabricante del repuesto.',
  'La marca del repuesto y la garantía que ofrece el vendedor.',
  'Si es nuevo, usado o reacondicionado, y si el precio incluye envío.',
]

const SPECIFIC: Array<[RegExp, string]> = [
  [/\bmanguera/, 'Diámetro, largo, forma (curvas) y tipo de conexiones de la manguera.'],
  [/\bfiltro/, 'El código del filtro y, si corresponde, la medida de rosca y de la junta.'],
  [/\b(pastilla|disco|freno|campana|zapata|caliper|mordaza)/, 'Si es para el eje delantero o trasero, si viene el juego completo y las medidas del disco.'],
  [/\bbujia/, 'Tipo de rosca, grado térmico y código indicado para tu motor.'],
  [/\b(correa|distribucion)/, 'Cantidad de dientes o largo, y si el kit incluye tensor y rodillos.'],
  [/\baceite/, 'Viscosidad y norma que recomienda el fabricante del vehículo, y cantidad de litros.'],
  [/\bbateria/, 'Voltaje, amperaje (Ah), corriente de arranque, polaridad y medidas.'],
  [/\b(amortiguador|espiral|resorte)/, 'Posición (delantero o trasero, izquierdo o derecho) y tipo (gas u aceite).'],
  [/\b(lampara|foco)/, 'Tipo de base (por ejemplo H4 o H7), voltaje y potencia.'],
  [/\b(bomba|termostato|radiador|refrigera)/, 'Que coincidan las conexiones, la junta y el código de la pieza.'],
]

const PROFESSIONAL = /\b(fren\w*|pastilla\w*|disco\w*|campana\w*|zapata\w*|caliper\w*|mordaza\w*|direccion|extremo\w*|rotula\w*|axial\w*|cremallera|amortiguador\w*|suspension|parrilla\w*|airbag|combustible|nafta|gnc|gas|inyector\w*|bomba de nafta|tanque)\b/

export const PROFESSIONAL_INSTALL_NOTE =
  'Es una pieza de un sistema de seguridad: conviene que la instalación la haga un taller.'

export function needsProfessionalInstall(description: string): boolean {
  return PROFESSIONAL.test(normalizeForMatch(description))
}

export function purchaseChecklist(description: string): string[] {
  const n = normalizeForMatch(description)
  const specific = SPECIFIC.filter(([re]) => re.test(n)).map(([, text]) => text)
  const out = [...GENERIC.slice(0, 2), ...specific.slice(0, 2), ...GENERIC.slice(2)]
  if (needsProfessionalInstall(description)) out.push(PROFESSIONAL_INSTALL_NOTE)
  return out.slice(0, 7)
}

export function laborQuestions(): string[] {
  return [
    '¿Qué tareas incluye exactamente la mano de obra?',
    '¿Incluye insumos (líquidos, juntas, descartables) o se cobran aparte?',
    '¿Qué garantía tiene el trabajo y por cuánto tiempo?',
    '¿Cuánto tiempo estiman que lleva el trabajo?',
  ]
}

export function partsQuestions(): string[] {
  return [
    '¿Qué marca y código tiene cada repuesto presupuestado?',
    '¿Los repuestos son originales o alternativos, y qué garantía tienen?',
    'Si consigo el repuesto por mi cuenta, ¿pueden colocarlo? ¿Cambia la garantía del trabajo?',
  ]
}
