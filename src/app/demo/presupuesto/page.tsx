/**
 * /demo/presupuesto — server entry (Incremento 7C). Reads the automatic parts pricing feature flag
 * from SERVER env at request time (never baked into the client bundle, never taken from the URL)
 * and renders the 7B client page. Flag off (default) → identical behavior to 7B.
 */
import { isPartsPricingEnabled } from '@/server/parts-pricing/pricing-config'
import { PresupuestoClient } from './presupuesto-client'

export const dynamic = 'force-dynamic'

export default function DemoPresupuestoPage() {
  return <PresupuestoClient autoPricingEnabled={isPartsPricingEnabled()} />
}
