import type { CaseRepository } from './case-repository'
import type { CaseState } from '@/domain/case/case'

// Repositorio en memoria para MVP_01 (single-request, sin persistencia cross-request).
// Cada instancia tiene su propio Map; no hay singleton global entre requests serverless.
// Reemplazar por PostgresCaseRepository en Fase 2.
export class NoopCaseRepository implements CaseRepository {
  private readonly store = new Map<string, CaseState>()

  async save(state: CaseState): Promise<void> {
    this.store.set(state.caseId, state)
  }

  async findById(caseId: string): Promise<CaseState | null> {
    return this.store.get(caseId) ?? null
  }
}
