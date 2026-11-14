'use client'

/**
 * site-analytics.tsx — Incremento 7A. Vercel Web Analytics (page views only).
 *
 * - Uses the official @vercel/analytics component for Next.js. Page views are counted
 *   automatically per route (/, /demo, /demo/falla, /demo/presupuesto, …). No custom events
 *   (they require a paid Vercel plan) and no identifiers of our own.
 * - Form contents never reach the URL: the wizard and the results are client state. As a
 *   defense in depth, beforeSend drops the query string and the hash of every reported URL.
 * - mode="production" always loads the same-origin /_vercel/insights/script.js (allowed by the
 *   CSP). It only exists on Vercel deployments with Web Analytics enabled; locally it is a
 *   harmless 404 and nothing is sent. The dev debug script (third-party CDN) is never loaded.
 */
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next'

export function sanitizeAnalyticsEvent<T extends BeforeSendEvent>(event: T): T | null {
  try {
    const url = new URL(event.url)
    url.search = ''
    url.hash = ''
    return { ...event, url: url.toString() }
  } catch {
    return null
  }
}

export function SiteAnalytics() {
  return <Analytics mode="production" beforeSend={sanitizeAnalyticsEvent} />
}
