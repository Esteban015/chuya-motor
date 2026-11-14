/**
 * /demo/falla — server entry (Incremento 7D.1). Reads the vehicle catalog flag from SERVER env at
 * request time (never baked into the client bundle, never taken from the URL) and renders the
 * existing client page. Flag off (default) → identical behavior to before 7D (free-text fields).
 */
import { isVehicleCatalogEnabled } from '@/server/vehicle-catalog/catalog-config'
import { FallaClient } from './falla-client'

export const dynamic = 'force-dynamic'

export default function DemoFallaPage() {
  return <FallaClient vehicleSelectorEnabled={isVehicleCatalogEnabled()} />
}
