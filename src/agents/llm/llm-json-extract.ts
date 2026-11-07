/**
 * Extracts JSON from LLM responses that may contain markdown code blocks or preamble text.
 *
 * Many LLMs (including Gemini Flash) wrap JSON in ```json...``` code blocks even when
 * the system prompt instructs pure JSON output. This utility strips those wrappers before
 * JSON.parse is called.
 *
 * Invariants:
 *  - Never throws.
 *  - Caller is responsible for JSON.parse and all error handling.
 */
export function extractJSON(raw: string): string {
  const trimmed = raw.trim()

  // Case 1: Fenced code block — ```json\n{...}\n``` or ```\n{...}\n```
  // Gemini Flash and similar models frequently add these blocks.
  const fenced = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(trimmed)
  if (fenced?.[1] !== undefined) {
    return fenced[1].trim()
  }

  // Case 2: JSON embedded in text (preamble and/or trailing text).
  // Always use balanced-bracket extraction — this handles pure JSON (startIndex=0)
  // AND JSON with trailing prose (e.g. "Here is the result:\n{...}\nHope this helps!").
  const startIndex = trimmed.search(/[{[]/)
  if (startIndex === -1) return trimmed

  const sub = trimmed.slice(startIndex)
  const openChar = sub[0] as '{' | '['
  const closeChar = openChar === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escape = false

  for (let i = 0; i < sub.length; i++) {
    const c = sub[i]
    if (escape) { escape = false; continue }
    if (c === '\\' && inString) { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === openChar) depth++
    if (c === closeChar) {
      depth--
      if (depth === 0) return sub.slice(0, i + 1)
    }
  }

  // Unbalanced braces — return from start and let JSON.parse fail naturally
  return sub
}
