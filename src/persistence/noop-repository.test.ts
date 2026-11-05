import { describe, it, expect } from 'vitest'
import { NoopCaseRepository } from './noop-repository'
import type { CaseState } from '@/domain/case/case'

describe('NoopCaseRepository (CA-I0-07)', () => {
  it('save seguido de findById retorna el estado guardado', async () => {
    const repo = new NoopCaseRepository()
    const state: CaseState = { caseId: '123e4567-e89b-12d3-a456-426614174000' }
    await repo.save(state)
    const found = await repo.findById(state.caseId)
    expect(found).toEqual(state)
  })

  it('findById retorna null para un caseId inexistente', async () => {
    const repo = new NoopCaseRepository()
    const result = await repo.findById('123e4567-e89b-12d3-a456-426614174999')
    expect(result).toBeNull()
  })

  it('cada instancia tiene su propio store (sin estado global compartido)', async () => {
    const repo1 = new NoopCaseRepository()
    const repo2 = new NoopCaseRepository()
    const state: CaseState = { caseId: '123e4567-e89b-12d3-a456-426614174001' }
    await repo1.save(state)
    const foundInRepo2 = await repo2.findById(state.caseId)
    expect(foundInRepo2).toBeNull()
  })
})
