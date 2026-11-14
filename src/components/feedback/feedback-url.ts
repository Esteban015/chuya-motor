/**
 * feedback-url.ts — Incremento 7A. Resolves the public, optional feedback form URL.
 *
 * The URL comes from NEXT_PUBLIC_FEEDBACK_FORM_URL (inlined at build time). It is shown only when
 * it is an https Google Forms link; anything else (unset, empty, http, another host, javascript:)
 * resolves to null so the UI renders no link at all instead of a broken one.
 *
 * Privacy: the URL is used exactly as configured. Nothing from the consultation (symptom, budget,
 * vehicle, case id, LLM output) is ever appended. Pre-filled links (`entry.<id>=` parameters) are
 * rejected, so the form cannot receive answers the person did not type themselves.
 */

const ALLOWED_HOSTS = new Set(['docs.google.com', 'forms.gle'])

export function resolveFeedbackFormUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (!ALLOWED_HOSTS.has(url.hostname)) return null
  if (url.hostname === 'docs.google.com' && !url.pathname.startsWith('/forms/')) return null
  if (url.hostname === 'forms.gle' && url.pathname.length <= 1) return null
  for (const key of url.searchParams.keys()) {
    if (key.startsWith('entry.')) return null
  }
  return url.toString()
}

/** Read at render time so `process.env.NEXT_PUBLIC_*` is inlined by Next and stubbable in tests. */
export function configuredFeedbackFormUrl(): string | null {
  return resolveFeedbackFormUrl(process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL)
}
