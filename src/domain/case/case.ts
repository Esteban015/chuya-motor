import { z } from 'zod'

// Schema mínimo de CaseState para Incremento 0 (stubs y contratos).
// Se expande con Vehicle, Budget, Safety, etc. en Incremento 1.
export const CaseStateSchema = z.object({
  caseId: z.string().uuid(),
})

export type CaseState = z.infer<typeof CaseStateSchema>
