import type { CaseState } from '@/domain/case/case'

export interface CaseRepository {
  save(state: CaseState): Promise<void>
  findById(caseId: string): Promise<CaseState | null>
}
