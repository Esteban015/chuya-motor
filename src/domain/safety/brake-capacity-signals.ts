/**
 * brake-capacity-signals.ts — shared, deterministic signal catalog (Incremento 6.4B/6.4C).
 *
 * "Loss or possible absence of braking capacity". Pure data + matcher on ALREADY-NORMALIZED text
 * (normalizeText output: lowercase, no accents, no punctuation). It has no imports on purpose, so
 * the Safety Gate (blocking) and the Severity Assessor (banner) can both use it while remaining
 * separate components with no dependency on each other.
 *
 * - Severity Assessor: first CRITICAL rule + the only rule applied to blocked queries (D-02).
 * - Safety Gate (v1.4.0): a brake-capacity-loss signal disables the descriptive-noise exemption,
 *   so "hace ruido y casi no frena" stays blocked (D-03).
 *
 * Patterns require adjacency so negations like "el pedal no se hunde" do not match. The list is
 * finite: no list of expressions guarantees detecting every risk.
 */
export const BRAKE_CAPACITY_LOSS_PATTERNS: readonly RegExp[] = [
  // "no frena", "casi no frena", "ya no frenaba", "no me frenan" (the vehicle does not brake)
  /\bno\s+(me\s+)?fren(a|an|aba|aban)\b/,
  // "apenas frena" (barely brakes). NOT "apenas freno" (rioplatense: "as soon as I brake").
  /\bapenas\s+(si\s+)?fren(a|an)\b/,
  /\bfren(a|an)\s+apenas\b/,
  // "frena (muy) poco" — NOT "frenan un poco"
  /\bfren(a|an)\s+(muy\s+|re\s+)?poco\b/,
  // "sin frenos", "me quedé sin frenos" — NOT "sin frenos ABS"
  /\bsin\s+(los\s+)?frenos?\b(?!\s+abs)/,
  // "no tengo frenos" (6.4C)
  /\bno\s+tengo\s+(mas\s+)?frenos?\b/,
  // "los frenos no responden / no funcionan / no agarran / no se accionan"
  /\bfrenos?\s+(ya\s+)?no\s+(responde|responden|funciona|funcionan|anda|andan|agarra|agarran|actua|actuan|se\s+accionan?)\b/,
  /\bno\s+(me\s+)?(responde|responden|funciona|funcionan|anda|andan|agarra|agarran)\s+(el\s+|los\s+)?frenos?\b/,
  // "pérdida (total) de frenos / de frenado", "falla de frenos", "se me fueron los frenos"
  /\bperdida\s+(total\s+|parcial\s+)?de\s+(los\s+)?fren(o|os|ado)\b/,
  /\bfall(a|o)\s+(total\s+)?(de|en)\s+(los\s+)?frenos?\b/,
  /\bse\s+(me\s+)?(fueron|fue|perdieron)\s+(los\s+|el\s+)?frenos?\b/,
  // Pedal sinking / reaching the floor / spongy
  /\bpedal(\s+del?\s+freno)?\s+se\s+(hunde|hundio|hunden)\b/,
  /\bse\s+hunde\s+el\s+pedal\b/,
  /\bpedal(\s+del?\s+freno)?\s+(se\s+)?(va|fue|llega|llego|baja|bajo|toca|queda)\s+(hasta\s+)?(al|el)\s+(piso|fondo)\b/,
  /\bse\s+(va|fue)\s+el\s+pedal\s+(hasta\s+)?(al|el)\s+(piso|fondo)\b/,
  /\bpedal(\s+del?\s+freno)?\s+(al|hasta\s+el)\s+(piso|fondo)\b/,
  /\bpedal(\s+del?\s+freno)?\s+(esta\s+|se\s+siente\s+|se\s+puso\s+|quedo\s+|muy\s+|re\s+)*(blando|esponjoso)\b/,
]

/** True when the normalized text describes loss or possible absence of braking capacity. */
export function matchesBrakeCapacityLoss(normalized: string): boolean {
  return BRAKE_CAPACITY_LOSS_PATTERNS.some((re) => re.test(normalized))
}
