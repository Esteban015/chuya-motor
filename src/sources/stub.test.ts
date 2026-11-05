import { describe, it, expect } from 'vitest'
import { StubDocumentSource } from './stub'
import { SourceEvidenceSchema } from './sources-port'

describe('StubDocumentSource (CA-I0-06)', () => {
  const source = new StubDocumentSource()

  it('implementa DocumentSourcePort y retorna array de SourceEvidence', async () => {
    const results = await source.search('ruido al frenar', {})
    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBeGreaterThan(0)
  })

  it('cada resultado cumple el schema SourceEvidence', async () => {
    const results = await source.search('cualquier consulta', { make: 'Toyota', year: 2020 })
    for (const item of results) {
      const parsed = SourceEvidenceSchema.safeParse(item)
      expect(parsed.success, `SourceEvidence inválida: ${JSON.stringify(parsed)}`).toBe(true)
    }
  })

  it('los datos sintéticos están etiquetados como no verificados', async () => {
    const results = await source.search('test', {})
    for (const item of results) {
      expect(item.reliability).toBe('unverified')
    }
  })
})
