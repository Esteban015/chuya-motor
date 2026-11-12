/**
 * public-ai-mode.ts — Public site mode for the UI badge (Incremento 6.4E).
 * Reads only LLM_PROVIDER (server-side). No secrets, no SDK imports, no quota store access.
 */
export type PublicAiMode = 'pilot' | 'demo'

export function publicAiMode(env: Record<string, string | undefined> = process.env): PublicAiMode {
  return (env['LLM_PROVIDER'] || 'stub') === 'stub' ? 'demo' : 'pilot'
}
