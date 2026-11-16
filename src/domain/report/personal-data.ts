/**
 * personal-data.ts — Conservative detection of personal data in free text before it is exported
 * to the Chuya Informe PDF (Incremento 7F). Pure, runs in the browser; nothing is sent anywhere.
 *
 * Budget texts are full of numbers, so number-based detectors need either a distinctive shape
 * (e-mail, +54 phone, 11-2345-6789, Mercosur plate AB123CD, 17-character VIN, 20-12345678-3 CUIT)
 * or an explicit label ("tel", "DNI", "patente", "me llamo"...). A plain amount such as
 * "45000000" or "1.234.567" is never treated as personal data.
 *
 * Detection is a safety net, not a guarantee: the preview tells the person to review the text,
 * and the original free text can be left out of the report entirely.
 */

export type PersonalDataKind = 'email' | 'phone' | 'plate' | 'vin' | 'document' | 'name' | 'address'

export const PERSONAL_DATA_LABEL: Record<PersonalDataKind, string> = {
  email: 'correo electrónico',
  phone: 'teléfono',
  plate: 'patente',
  vin: 'número de chasis (VIN)',
  document: 'DNI, CUIT o CUIL',
  name: 'nombre',
  address: 'dirección',
}

export const REDACTED = '[dato personal omitido]'

interface Detector {
  kind: PersonalDataKind
  re: RegExp
}

// Order matters: longer / more specific shapes first (a CUIT must not be half-eaten by "phone").
// Detectors never cross a line break: "[ \t]" is used instead of "\s" on purpose.
const DETECTORS: Detector[] = [
  { kind: 'email', re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu },
  { kind: 'document', re: /\b(?:dni|d\.n\.i\.?|documento|cuit|cuil)\b[ \t]*(?:n(?:[°ºo.]|ro\.?|úmero)?[ \t]*)?:?[ \t]*[\d. \t-]{7,14}\d/giu },
  { kind: 'document', re: /\b(?:20|23|24|27|30|33|34)-\d{8}-\d\b/g },
  { kind: 'vin', re: /\b(?=[A-HJ-NPR-Z0-9]{17}\b)(?=[A-HJ-NPR-Z0-9]*\d)(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}\b/gi },
  { kind: 'vin', re: /\b(?:vin|chasis|n[°º]?[ \t]*de[ \t]*chasis)\b[ \t]*:?[ \t]*[A-Z0-9-]{6,20}/giu },
  { kind: 'phone', re: /\+[ \t]?54[\d \t()-]{8,16}\d/g },
  { kind: 'phone', re: /\b(?:tel(?:[ée]fono)?|cel(?:ular)?|whats?app|wpp|wsp|m[óo]vil|llam(?:ar|ame|á)(?:[ \t]+al)?)\b\.?[ \t]*:?[ \t]*\(?\d[\d \t()-]{6,16}\d/giu },
  { kind: 'phone', re: /\(?\b0?(?:11|15|2\d{2,3}|3\d{2,3})\)?[ \t-]\d{3,4}-\d{4}\b/g },
  { kind: 'plate', re: /\b[A-Z]{2}[ \t]?\d{3}[ \t]?[A-Z]{2}\b/g },
  { kind: 'plate', re: /\b(?:patente|dominio)\b[ \t]*:?[ \t]*[A-Z]{2,3}[ \t]?\d{3}(?:[ \t]?[A-Z]{2})?\b/giu },
  // Keyword in any case, but the name itself must be capitalized (no /i: it would fold \p{Lu}).
  { kind: 'name', re: /\b(?:[Mm]e [Ll]lamo|[Mm]i [Nn]ombre [Ee]s|[Ss]oy)[ \t]+\p{Lu}[\p{Ll}'-]+(?:[ \t]+\p{Lu}[\p{Ll}'-]+){0,2}/gu },
  { kind: 'name', re: /\b(?:nombre|cliente|titular)[ \t]*:[ \t]*[^\n,;]{2,60}/giu },
  { kind: 'address', re: /\b(?:domicilio|direcci[óo]n|vivo en)\b[ \t]*:?[ \t]*[^\n,;]{3,80}/giu },
]

export interface PersonalDataFinding {
  kind: PersonalDataKind
  start: number
  end: number
}

/** Non-overlapping findings, in text order. */
export function findPersonalData(text: string): PersonalDataFinding[] {
  const found: PersonalDataFinding[] = []
  for (const d of DETECTORS) {
    d.re.lastIndex = 0
    for (const m of text.matchAll(d.re)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (found.some((f) => start < f.end && end > f.start)) continue
      found.push({ kind: d.kind, start, end })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

export function redactPersonalData(text: string): string {
  const findings = findPersonalData(text)
  if (findings.length === 0) return text
  let out = ''
  let at = 0
  for (const f of findings) {
    out += text.slice(at, f.start) + REDACTED
    at = f.end
  }
  return out + text.slice(at)
}

/** Kinds found across several texts (for the preview notice), in a stable order. */
export function personalDataKinds(texts: ReadonlyArray<string | null | undefined>): PersonalDataKind[] {
  const kinds = new Set<PersonalDataKind>()
  for (const t of texts) if (t) for (const f of findPersonalData(t)) kinds.add(f.kind)
  return (Object.keys(PERSONAL_DATA_LABEL) as PersonalDataKind[]).filter((k) => kinds.has(k))
}
