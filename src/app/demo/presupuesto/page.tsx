/**
 * /demo/presupuesto — server entry (Incremento 7C, 7D.1). Reads the automatic parts pricing flag
 * and the vehicle catalog flag from SERVER env at request time (never baked into the client bundle,
 * never taken from the URL) and renders the client page. Both flags off (default) → 7B behavior.
 */
import { isPartsPricingEnabled } from '@/server/parts-pricing/pricing-config'
import { isVehicleCatalogEnabled } from '@/server/vehicle-catalog/catalog-config'
import { PresupuestoClient } from './presupuesto-client'

export const dynamic = 'force-dynamic'

export default function DemoPresupuestoPage() {
  return <PresupuestoClient autoPricingEnabled={isPartsPricingEnabled()} vehicleSelectorEnabled={isVehicleCatalogEnabled()} />
}
