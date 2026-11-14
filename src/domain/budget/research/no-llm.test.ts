/**
 * no-llm.test.ts — Incremento 7B: the parts research / comparison core is local and deterministic.
 * It must never import LLM adapters, the graph, server code or network helpers.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'src/domain/budget/research')
const sources = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

describe('research core has no LLM / network dependency', () => {
  it.each(sources)('%s', (file) => {
    const code = readFileSync(join(DIR, file), 'utf8')
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!)
    for (const spec of imports) {
      expect(spec).not.toMatch(/agents|llm|server|groq|gemini|anthropic|upstash/i)
    }
    expect(code).not.toMatch(/\bfetch\(|XMLHttpRequest|navigator\.sendBeacon/)
  })
})
