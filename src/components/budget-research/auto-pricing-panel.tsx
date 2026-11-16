'use client'

/**
 * auto-pricing-panel.tsx — Optional automatic search of PUBLISHED offers for the identified parts
 * (Incremento 7C, behind the server feature flag). Rendered only when the server enabled it.
 *
 * - Runs only on an explicit click (never on render / effect): no repeated searches on rerender.
 *   The same set of parts is not searched twice in a row; one request at a time.
 * - Shows up to 5 listings per part with price (ARS), merchant, link and date, ALWAYS labeled
 *   "Compatibilidad no verificada", plus the data missing to confirm equivalence.
 * - Never shows averages, differences or overpricing verdicts. The manual search and the person's
 *   own references (part cards) remain the fallback.
 * - Nothing is sent to Analytics (no part names, codes, prices or vehicle).
 */
import { useId, useRef, useState } from 'react'
import { formatArs } from '@/domain/budget/research/ars-amount'
import {
  ITEM_REASON_LABEL,
  MAX_AUTO_PARTS,
  MISSING_DATA_LABEL,
  MISSING_SHORT_LABEL,
  safeOfferUrl,
  type ClientOffer,
  type ClientPricedItem,
  type MissingData,
  type PartsPricesResponse,
} from '@/domain/budget/research/parts-prices-contract'
import type { ResearchLine, VehicleInfo } from '@/domain/budget/research/types'
import { ProvenanceBadge } from './badges'

const ENDPOINT = '/api/budget/parts-prices'
const CLIENT_TIMEOUT_MS = 25_000

type View =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; items: ClientPricedItem[] }
  | { kind: 'error'; message: string }

const ERROR_TEXT = {
  unavailable: 'La búsqueda automática no está disponible en este momento. Usá la búsqueda manual de cada repuesto.',
  slow: 'La búsqueda tardó demasiado en responder. Esto no significa que no haya publicaciones: usá la búsqueda manual de cada repuesto o probá más tarde.',
  rate_limited: 'Hiciste varias búsquedas seguidas. Probá más tarde o usá la búsqueda manual de cada repuesto.',
  invalid: 'No pudimos buscar estos repuestos. Revisá los nombres o usá la búsqueda manual.',
} as const

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'fecha desconocida'
  return d.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' })
}

function buildRequest(parts: ResearchLine[], vehicle: VehicleInfo) {
  const t = (s: string | undefined, max: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const year = t(vehicle.year, 4)
  return {
    vehicle: { make: t(vehicle.make, 40), model: t(vehicle.model, 40), year: /^(19|20)\d{2}$/.test(year) ? year : '', engine: t(vehicle.engine, 40) },
    lines: parts.slice(0, MAX_AUTO_PARTS).map((p) => ({
      id: p.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'x',
      description: t(p.description, 200),
      presentation: p.presentation,
      quantity: Math.min(999, Math.max(1, Math.trunc(p.quantity) || 1)),
      partBrand: t(p.partBrand, 40),
      partCode: t(p.partCode, 40),
    })),
  }
}

function OfferCard({ offer }: { offer: ClientOffer }) {
  const url = safeOfferUrl(offer.url)
  return (
    <li className="rounded-xl border border-brand-border-light bg-white p-3" data-testid="auto-offer" data-decision={offer.decision}>
      <p className="break-words text-sm font-medium leading-snug text-brand-text">{offer.title}</p>
      {/* Price · merchant · date on one compact line (wraps on narrow screens). Order is never by price. */}
      <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-brand-text-muted">
        <div>
          <dt className="sr-only">Precio publicado</dt>
          <dd className="text-base font-bold tabular-nums text-brand-text">{formatArs(offer.priceMinor)}</dd>
        </div>
        <div className="min-w-0 max-w-full">
          <dt className="inline">Comercio: </dt>
          <dd className="inline break-words">{offer.merchant}</dd>
        </div>
        <div>
          <dt className="inline">Consultado: </dt>
          <dd className="inline">{formatDate(offer.retrievedAt)}</dd>
        </div>
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ProvenanceBadge kind="unverified" label="Compatibilidad no verificada" />
        {offer.decision === 'needs_review' && <ProvenanceBadge kind="missing" label="Pocos datos en la publicación" />}
        {offer.codeMatch && <ProvenanceBadge kind="declared" label="Código igual al que cargaste (a confirmar)" />}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4">
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" className="inline-flex min-h-[40px] items-center text-sm font-semibold text-brand-primary underline hover:no-underline">
            Ver publicación<span className="sr-only"> de {offer.title} (se abre en otra pestaña)</span>
          </a>
        )}
        {offer.missing.length > 0 && (
          <details className="group w-full text-xs min-[400px]:w-auto" data-testid="auto-offer-details">
            <summary className="inline-flex min-h-[40px] cursor-pointer list-none items-center gap-1 font-semibold text-brand-text underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span>
              Qué falta confirmar ({offer.missing.length})<span className="sr-only"> de {offer.title}</span>
            </summary>
            <ul className="mb-1 list-disc space-y-0.5 pl-5 text-brand-text-muted" data-testid="auto-offer-missing">
              {offer.missing.map((m) => (
                <li key={m}>{MISSING_DATA_LABEL[m]}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  )
}

/** Missing data shared by EVERY shown offer of a part: stated once in the part summary. */
function commonMissing(offers: ClientOffer[]): MissingData[] {
  if (offers.length < 2) return []
  return offers[0]!.missing.filter((m) => offers.every((o) => o.missing.includes(m)))
}

function ItemResult({ item, label }: { item: ClientPricedItem; label: string }) {
  const offers = item.status === 'ok' ? item.offers.slice(0, 5) : []
  const coherent = offers.filter((o) => o.decision === 'candidate').length
  const shared = commonMissing(offers)
  return (
    <li className="space-y-2" data-testid="auto-item" data-status={item.status}>
      <div>
        <h4 className="break-words text-sm font-bold text-brand-text">{label}</h4>
        {offers.length > 0 && (
          <p className="text-xs text-brand-text-muted" data-testid="auto-item-summary">
            {offers.length === 1 ? '1 publicación' : `${offers.length} publicaciones`}
            {coherent > 0 && ` · ${coherent} con título coherente con tu vehículo`}
            {offers.length - coherent > 0 && ` · ${offers.length - coherent} con pocos datos`}
            . Ordenadas por coincidencia del título, no por precio.
          </p>
        )}
        {shared.length > 0 && (
          <p className="mt-1 text-xs text-brand-text-muted" data-testid="auto-item-common-missing">
            En todas falta confirmar: {shared.map((m) => MISSING_SHORT_LABEL[m]).join(', ')}.
          </p>
        )}
      </div>
      {offers.length > 0 && (
        <ul className="space-y-2">
          {offers.map((o, i) => (
            <OfferCard key={`${o.url}-${i}`} offer={o} />
          ))}
        </ul>
      )}
      {item.status === 'no_results' && (
        <p className="rounded-xl bg-white px-3 py-2 text-xs text-brand-text-muted">
          No encontramos publicaciones que mencionen este repuesto para tu vehículo. Usá la búsqueda manual.
        </p>
      )}
      {(item.status === 'unavailable' || item.status === 'skipped') && (
        <p className="rounded-xl bg-white px-3 py-2 text-xs text-brand-text-muted">
          {ITEM_REASON_LABEL[item.reason ?? ''] ?? 'No se pudo buscar este repuesto automáticamente. Usá la búsqueda manual.'}
        </p>
      )}
      {item.hidden > 0 && (
        <p className="text-2xs text-brand-text-muted">
          {item.hidden === 1
            ? 'Ocultamos 1 publicación que no menciona el modelo de tu vehículo.'
            : `Ocultamos ${item.hidden} publicaciones que no mencionan el modelo de tu vehículo.`}
        </p>
      )}
    </li>
  )
}

/** Announced in the live region. Parts that could not be searched are never counted as "0 results". */
function doneSummary(items: ClientPricedItem[]): string {
  const offers = items.reduce((n, i) => n + i.offers.length, 0)
  const failed = items.filter((i) => i.status === 'unavailable').length
  const base = `Búsqueda terminada. ${offers === 1 ? '1 publicación' : `${offers} publicaciones`} para revisar.`
  if (failed === 0) return base
  return `${base} ${failed === 1 ? 'No pudimos consultar 1 repuesto' : `No pudimos consultar ${failed} repuestos`}: usá la búsqueda manual.`
}

/** 7F: what the panel shows, so the Chuya Informe can include it (no new search is ever made). */
export interface PricingResultsSnapshot {
  items: Array<{ partLabel: string; item: ClientPricedItem }>
}

export function AutoPricingPanel({ parts, vehicle, onResults }: { parts: ResearchLine[]; vehicle: VehicleInfo; onResults?: (snapshot: PricingResultsSnapshot) => void }) {
  const uid = useId()
  const [view, setView] = useState<View>({ kind: 'idle' })
  const [lastSignature, setLastSignature] = useState<string | null>(null)
  const inFlight = useRef(false)

  const request = buildRequest(parts, vehicle)
  const signature = JSON.stringify(request)
  const alreadySearched = view.kind === 'done' && lastSignature === signature
  const labels = new Map(parts.map((p) => [p.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'x', p.description]))

  async function search() {
    if (inFlight.current || alreadySearched || request.lines.length === 0) return
    inFlight.current = true
    setView({ kind: 'loading' })
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: signature,
        cache: 'no-store',
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      })
      const body = (await res.json().catch(() => null)) as PartsPricesResponse | null
      if (res.status === 429) setView({ kind: 'error', message: ERROR_TEXT.rate_limited })
      else if (res.status === 504) setView({ kind: 'error', message: ERROR_TEXT.slow })
      else if (res.status === 400 || res.status === 413 || res.status === 415) setView({ kind: 'error', message: ERROR_TEXT.invalid })
      else if (!res.ok || !body || body.status !== 'ok' || !Array.isArray(body.items)) setView({ kind: 'error', message: ERROR_TEXT.unavailable })
      else {
        setView({ kind: 'done', items: body.items })
        setLastSignature(signature)
        onResults?.({ items: body.items.map((item) => ({ partLabel: labels.get(item.lineId) ?? 'Repuesto', item })) })
      }
    } catch (e) {
      // Browser-side timeout → "slow", any other failure → "unavailable". Never retried by itself.
      setView({ kind: 'error', message: (e as { name?: string })?.name === 'TimeoutError' ? ERROR_TEXT.slow : ERROR_TEXT.unavailable })
    } finally {
      inFlight.current = false
    }
  }

  if (parts.length === 0) return null

  return (
    <section aria-labelledby={`${uid}-title`} className="space-y-3 rounded-2xl border border-brand-border-light bg-brand-bg p-4" data-testid="auto-pricing-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${uid}-title`} className="font-display text-base font-extrabold text-brand-text">Publicaciones encontradas automáticamente</h3>
        <span className="rounded-full bg-brand-primary-tint px-2 py-0.5 text-2xs font-semibold text-brand-primary">Beta</span>
      </div>
      <p className="text-xs leading-relaxed text-brand-text-muted">
        Buscamos en Google Shopping precios <strong>publicados</strong> por comercios. No verificamos que sean compatibles con tu vehículo, no los comparamos con el presupuesto y no indican cuánto debería costar la reparación (no incluyen mano de obra ni envío).
      </p>
      <div>
        <p className="text-xs font-semibold text-brand-text">Repuestos a buscar{parts.length > MAX_AUTO_PARTS ? ` (los primeros ${MAX_AUTO_PARTS})` : ''}:</p>
        <ul className="mt-1 flex flex-wrap gap-1.5" data-testid="auto-parts">
          {request.lines.map((l) => (
            <li key={l.id} className="max-w-full break-words rounded-full bg-white px-2.5 py-1 text-xs text-brand-text ring-1 ring-brand-border">
              {l.description}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={search}
        disabled={view.kind === 'loading' || alreadySearched}
        aria-describedby={`${uid}-status`}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2 disabled:opacity-60 sm:w-auto"
      >
        {view.kind === 'loading' ? 'Buscando publicaciones…' : alreadySearched ? 'Búsqueda realizada' : 'Buscar publicaciones'}
      </button>
      <div id={`${uid}-status`} role="status" aria-live="polite" className="text-xs text-brand-text-muted">
        {view.kind === 'loading' && 'Buscando publicaciones. Puede tardar unos segundos.'}
        {view.kind === 'done' && doneSummary(view.items)}
      </div>
      {view.kind === 'error' && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="auto-pricing-error">
          {view.message}
        </p>
      )}
      {view.kind === 'done' && (
        <>
          <ul className="space-y-4" data-testid="auto-results">
            {view.items.map((item) => (
              <ItemResult key={item.lineId} item={item} label={labels.get(item.lineId) ?? 'Repuesto'} />
            ))}
          </ul>
          <p className="text-2xs leading-relaxed text-brand-text-muted">
            Confirmá con el comercio o con tu taller el código, la presentación (unidad o juego) y el estado antes de comparar. Si encontrás una equivalente, cargala como referencia en el repuesto para calcular la diferencia.
          </p>
        </>
      )}
    </section>
  )
}
