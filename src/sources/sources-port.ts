import { z } from 'zod'

export const SourceEvidenceSchema = z.object({
  sourceId: z.string(),
  excerpt: z.string(),
  reliability: z.enum(['verified', 'unverified']),
  title: z.string(),
  url: z.string().url().optional(),
})

export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>

export const SearchContextSchema = z.object({
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().optional(),
})

export type SearchContext = z.infer<typeof SearchContextSchema>

export interface DocumentSourcePort {
  search(query: string, context: SearchContext): Promise<SourceEvidence[]>
}
