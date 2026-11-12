/**
 * text-normalization.ts — Stage 1 of the Safety Gate (lowercase, no accents, no punctuation).
 * Extracted in 6.4D so the hazard catalog, the Safety Gate and the Severity Assessor share ONE
 * normalization without importing each other. Re-exported by safety-policy.ts (public API unchanged).
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
