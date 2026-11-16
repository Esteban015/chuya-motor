/**
 * export-url.ts — URLs written into an exported or shared Chuya Informe (7G).
 *
 * Starts from the 7B rule (sanitizeExternalUrl: http(s) only, public host, no credentials, bounded
 * length) and then removes what should not travel inside a document handed to third parties:
 *   - the fragment (#...), which can carry tokens and is never needed to open a product page;
 *   - query parameters that identify a person, a session or a campaign (tokens, keys, e-mail,
 *     phone, user ids, click ids, utm_*...), matched by name, case-insensitively.
 * Parameters needed to open the page (e.g. Google Shopping "prds", MercadoLibre item ids) stay.
 */
import { sanitizeExternalUrl } from '@/domain/budget/research/external-url'

const SENSITIVE_PARAM = new RegExp(
  [
    '^utm_',
    '^(?:gclid|gbraid|wbraid|dclid|fbclid|msclkid|yclid|ttclid|twclid|igshid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|ref_src|si)$',
    '(?:^|_)(?:token|access_token|id_token|refresh_token|auth|authorization|session|sessionid|session_id|sid|jsessionid|phpsessid|apikey|api_key|key|secret|signature|sig|password|passwd|pwd|otp)$',
    '^(?:email|e-mail|mail|phone|tel|telefono|celular|whatsapp|dni|cuit|cuil|user|username|user_id|userid|uid|customer|customer_id|client_id|name|nombre|address|direccion)$',
  ].join('|'),
  'i',
)

export function sanitizeExportUrl(raw: string | null | undefined): string | null {
  const safe = sanitizeExternalUrl(raw)
  if (!safe) return null
  const url = new URL(safe)
  url.hash = ''
  for (const name of [...new Set(url.searchParams.keys())]) if (SENSITIVE_PARAM.test(name)) url.searchParams.delete(name)
  return url.toString()
}
