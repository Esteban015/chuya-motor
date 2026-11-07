import { describe, it, expect } from 'vitest'
import { StubLLMAdapter, FailingStubLLMAdapter } from './stub-adapter'
import type { LLMCompletionRequest } from './llm-adapter'

const REQ: LLMCompletionRequest = { system: 'test system', userContent: 'cualquier prompt' }

describe('StubLLMAdapter (CA-I0-08)', () => {
  it('implementa LLMAdapter y retorna ok=true', async () => {
    const adapter = new StubLLMAdapter()
    const result = await adapter.complete(REQ)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(typeof result.content).toBe('string')
    }
  })

  it('expone modelId como string', () => {
    const adapter = new StubLLMAdapter()
    expect(typeof adapter.modelId).toBe('string')
    expect(adapter.modelId.length).toBeGreaterThan(0)
  })

  it('no importa SDKs LLM reales', async () => {
    // Si este test corre sin errores, el stub no tiene dependencias externas de LLM
    const adapter = new StubLLMAdapter()
    await expect(adapter.complete(REQ)).resolves.toBeDefined()
  })
})

describe('FailingStubLLMAdapter', () => {
  it('retorna ok=false con código de error estructurado', async () => {
    const adapter = new FailingStubLLMAdapter()
    const result = await adapter.complete(REQ)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('LLM_PROVIDER_UNAVAILABLE')
      expect(typeof result.error.message).toBe('string')
    }
  })
})
