import { describe, it, expect } from 'vitest'
import { extractJSON } from './llm-json-extract'

// ── JSON-01: Pure JSON — fast path ────────────────────────────────────────────

describe('JSON-01: Pure JSON input — returned unchanged', () => {
  it('JSON-01-A: JSON object starting with { — no extraction', () => {
    const input = '{"facts":["fact1"],"hypotheses":[]}'
    expect(extractJSON(input)).toBe(input)
  })

  it('JSON-01-B: JSON array starting with [ — no extraction', () => {
    const input = '[{"status":"confirmed","description":"Aceite"}]'
    expect(extractJSON(input)).toBe(input)
  })

  it('JSON-01-C: JSON with leading/trailing whitespace — trimmed and returned', () => {
    const input = '  {"key":"value"}  '
    expect(extractJSON(input)).toBe('{"key":"value"}')
  })
})

// ── JSON-02: Markdown code blocks (Gemini Flash frequently wraps JSON) ────────

describe('JSON-02: Markdown-fenced code blocks', () => {
  it('JSON-02-A: ```json block → JSON extracted', () => {
    const inner = '{"facts":["fact"],"hypotheses":[],"questions":[]}'
    const input = '```json\n' + inner + '\n```'
    expect(extractJSON(input)).toBe(inner)
  })

  it('JSON-02-B: ``` block without json label → JSON extracted', () => {
    const inner = '{"lines":[],"declaredTotalMinorUnit":null,"currency":null}'
    const input = '```\n' + inner + '\n```'
    expect(extractJSON(input)).toBe(inner)
  })

  it('JSON-02-C: fenced block with trailing whitespace → JSON extracted', () => {
    const inner = '{"key":"value"}'
    const input = '```json\n' + inner + '\n```  '
    expect(extractJSON(input)).toBe(inner)
  })

  it('JSON-02-D: Windows CRLF line endings in code block → JSON extracted', () => {
    const inner = '{"key":"value"}'
    const input = '```json\r\n' + inner + '\r\n```'
    expect(extractJSON(input)).toBe(inner)
  })

  it('JSON-02-E: nested objects in fenced block → outer object correctly extracted', () => {
    const inner = '{"a":{"b":{"c":1}}}'
    const input = '```json\n' + inner + '\n```'
    expect(extractJSON(input)).toBe(inner)
  })
})

// ── JSON-03: JSON embedded in text ────────────────────────────────────────────

describe('JSON-03: JSON embedded in text (preamble or trailing text)', () => {
  it('JSON-03-A: preamble text before JSON → JSON extracted', () => {
    const json = '{"confidence":"low"}'
    const input = 'Aquí está el resultado:\n' + json
    expect(extractJSON(input)).toBe(json)
  })

  it('JSON-03-B: JSON followed by trailing text → only JSON extracted', () => {
    const json = '{"key":"value"}'
    const input = json + '\nEspero que esto ayude.'
    // extractJSON returns from first { to its balanced }
    const result = extractJSON(input)
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result)).toEqual({ key: 'value' })
  })

  it('JSON-03-C: JSON with preamble and trailing text → JSON extracted', () => {
    const json = '{"ok":true}'
    const input = 'Result: ' + json + '. Done.'
    const result = extractJSON(input)
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

// ── JSON-04: Edge cases ───────────────────────────────────────────────────────

describe('JSON-04: Edge cases', () => {
  it('JSON-04-A: empty string → returned as-is', () => {
    expect(extractJSON('')).toBe('')
  })

  it('JSON-04-B: plain text without JSON → returned as-is', () => {
    const input = 'No JSON here, sorry.'
    expect(extractJSON(input)).toBe(input)
  })

  it('JSON-04-C: JSON with string values containing braces → correctly extracted', () => {
    const input = '{"message":"Use {curly} braces carefully"}'
    expect(extractJSON(input)).toBe(input)
  })

  it('JSON-04-D: JSON with escaped quotes in string values → correctly extracted', () => {
    const input = '{"key":"he said \\"hello\\""}'
    expect(extractJSON(input)).toBe(input)
  })

  it('JSON-04-E: extractJSON is safe even on untrusted input — does not throw', () => {
    const malicious = '{"key": null, "__proto__": {"polluted": true}}'
    expect(() => extractJSON(malicious)).not.toThrow()
  })
})

// ── JSON-05: Integration — JSON.parse after extractJSON ───────────────────────

describe('JSON-05: JSON.parse succeeds after extractJSON', () => {
  it('JSON-05-A: diagnosis response in markdown → extractJSON + JSON.parse succeeds', () => {
    const payload = {
      facts: ['Ruido al arrancar'],
      hypotheses: [{ statement: 'Hip. orientativa', confidence: 'low', caveats: [], evidenceIds: [] }],
      questions: ['¿Cuándo empezó?'],
    }
    const wrapped = '```json\n' + JSON.stringify(payload) + '\n```'
    const result = JSON.parse(extractJSON(wrapped)) as unknown
    expect(result).toEqual(payload)
  })

  it('JSON-05-B: budget response in markdown → extractJSON + JSON.parse succeeds', () => {
    const payload = {
      lines: [{ status: 'confirmed', description: 'Aceite', amountMinorUnit: 450000, currency: 'ARS' }],
      declaredTotalMinorUnit: 450000,
      currency: 'ARS',
    }
    const wrapped = '```json\n' + JSON.stringify(payload) + '\n```'
    const result = JSON.parse(extractJSON(wrapped)) as unknown
    expect(result).toEqual(payload)
  })
})
