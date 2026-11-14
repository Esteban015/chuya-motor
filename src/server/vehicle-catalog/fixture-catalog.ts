/**
 * fixture-catalog.ts — SYNTHETIC vehicle catalog (schema v2) for tests and flag-gated demos.
 *
 * Every brand, model, version, year, body and engine below is FICTITIOUS. Nothing here describes a
 * real vehicle or the Argentine market, and the UI says so whenever this dataset is served
 * (source.isFixture, license "synthetic"). It exercises the contract: several categories, a brand
 * under two types, brand / registry aliases, discontinued models, a model without year data,
 * versions with and without engine data, diesel / GNC / hybrid, a version the source lists
 * inconsistently (source_conflict), retired IDs from a previous catalog version and empty
 * categories.
 *
 * Never served in public production (catalog-config.ts).
 */
import type { MissingField } from '@/domain/vehicle/vehicle-catalog'
import type { CatalogDataset, DatasetVersion } from './catalog-dataset'

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const prov = (id: string, rawText: string) => ({ sourceRecordIds: [`fixture:${id}`], rawText })

type VersionInput = Omit<DatasetVersion, 'missing' | 'verification' | 'provenance'> & { verification?: DatasetVersion['verification'] }

/** Fills `missing` from what is actually absent (never the other way round) and the provenance. */
function version(v: VersionInput): DatasetVersion {
  const missing: MissingField[] = []
  if (v.years === null) missing.push('years')
  if (v.body === null) missing.push('body')
  if (v.engine?.displacementL === undefined) missing.push('displacement')
  if (v.engine?.fuel === undefined) missing.push('fuel')
  return { ...v, missing, verification: v.verification ?? 'source_listed', provenance: prov(v.id, `${v.label} ${v.body ?? ''}`.trim()) }
}

export const FIXTURE_CATALOG: CatalogDataset = {
  schemaVersion: 2,
  manifest: {
    catalogVersion: 'fixture-2026-11-14.2',
    generatedAt: '2026-11-14T00:00:00.000Z',
    generator: 'hand-written-fixture',
    source: {
      id: 'fixture',
      name: 'Catálogo sintético de pruebas',
      version: 'synthetic-2',
      publishedAt: '2026-11-14',
      kind: 'fixture',
      isFixture: true,
      license: { status: 'synthetic' },
    },
  },
  types: [
    { id: 't:auto', category: 'auto', label: 'Auto' },
    { id: 't:moto', category: 'moto', label: 'Moto' },
    { id: 't:pickup', category: 'pickup', label: 'Pick-up' },
    { id: 't:suv', category: 'suv', label: 'SUV' },
    { id: 't:utilitario', category: 'utilitario', label: 'Utilitario' },
    { id: 't:camion', category: 'camion', label: 'Camión' },
    { id: 't:otro', category: 'otro', label: 'Otro' },
  ],
  brands: [
    { id: 'b:ficticia-autos', name: 'Ficticia Autos', aliases: ['Ficticia Automotores'], typeIds: ['t:auto', 't:pickup', 't:suv'] },
    { id: 'b:ejemplo-motors', name: 'Ejemplo Motors', aliases: [], typeIds: ['t:auto', 't:moto'] },
    { id: 'b:prueba-motos', name: 'Prueba Motos', aliases: [], typeIds: ['t:moto'] },
    { id: 'b:demo-utilitarios', name: 'Demo Utilitarios', aliases: [], typeIds: ['t:utilitario'] },
  ],
  models: [
    { id: 'm:ficticia-sedan-a', brandId: 'b:ficticia-autos', typeId: 't:auto', name: 'Sedán A', aliases: [], discontinued: false, years: range(2015, 2025), provenance: prov('m1', 'SEDAN A') },
    { id: 'm:ficticia-compacto-b', brandId: 'b:ficticia-autos', typeId: 't:auto', name: 'Compacto B', aliases: [], discontinued: true, years: range(2008, 2016), provenance: prov('m2', 'COMPACTO B') },
    { id: 'm:ficticia-clasico-c', brandId: 'b:ficticia-autos', typeId: 't:auto', name: 'Clásico C', aliases: [], discontinued: true, years: null, provenance: prov('m3', 'CLASICO C') },
    { id: 'm:ficticia-pickup-p', brandId: 'b:ficticia-autos', typeId: 't:pickup', name: 'Pick-up P', aliases: [], discontinued: false, years: range(2018, 2025), provenance: prov('m4', 'PICK-UP P') },
    { id: 'm:ficticia-suv-s', brandId: 'b:ficticia-autos', typeId: 't:suv', name: 'SUV S', aliases: [], discontinued: false, years: range(2020, 2025), provenance: prov('m5', 'SUV S') },
    { id: 'm:ejemplo-hatch-e', brandId: 'b:ejemplo-motors', typeId: 't:auto', name: 'Hatch E', aliases: [], discontinued: false, years: range(2019, 2024), provenance: prov('m6', 'HATCH E') },
    { id: 'm:ejemplo-moto-m', brandId: 'b:ejemplo-motors', typeId: 't:moto', name: 'Moto M 150', aliases: [], discontinued: false, years: range(2016, 2025), provenance: prov('m7', 'MOTO M 150') },
    { id: 'm:prueba-scooter-x', brandId: 'b:prueba-motos', typeId: 't:moto', name: 'Scooter X 110', aliases: ['SX110'], discontinued: true, years: range(2012, 2020), provenance: prov('m8', 'SX110') },
    { id: 'm:demo-furgon-f', brandId: 'b:demo-utilitarios', typeId: 't:utilitario', name: 'Furgón F', aliases: [], discontinued: false, years: range(2010, 2025), provenance: prov('m9', 'FURGON F') },
  ],
  versions: [
    version({ id: 'v:sedan-a-14-nafta', modelId: 'm:ficticia-sedan-a', label: '1.4 8V Nafta', body: 'SEDAN 5 PUERTAS', years: range(2015, 2020), engine: { displacementL: 1.4, fuel: 'nafta', evidence: 'structured' } }),
    version({ id: 'v:sedan-a-14-gnc', modelId: 'm:ficticia-sedan-a', label: '1.4 8V GNC de fábrica', body: 'SEDAN 5 PUERTAS', years: range(2016, 2019), engine: { displacementL: 1.4, fuel: 'gnc', evidence: 'structured' } }),
    version({ id: 'v:sedan-a-16-diesel', modelId: 'm:ficticia-sedan-a', label: '1.6 Turbodiésel', body: 'SEDAN 5 PUERTAS', years: range(2018, 2025), engine: { displacementL: 1.6, fuel: 'diesel', evidence: 'structured' } }),
    version({ id: 'v:sedan-a-especial', modelId: 'm:ficticia-sedan-a', label: 'Edición Especial', body: null, years: range(2021, 2025), engine: null }),
    version({ id: 'v:compacto-b-12', modelId: 'm:ficticia-compacto-b', label: '1.2 Base', body: 'SEDAN 3 PUERTAS', years: range(2008, 2016), engine: { displacementL: 1.2, fuel: 'nafta', evidence: 'structured' } }),
    version({ id: 'v:compacto-b-13-dudosa', modelId: 'm:ficticia-compacto-b', label: '1.3 Full', body: 'SEDAN 3 PUERTAS', years: range(2010, 2012), engine: { displacementL: 1.3, evidence: 'label' }, verification: 'source_conflict' }),
    version({ id: 'v:clasico-c-estandar', modelId: 'm:ficticia-clasico-c', label: 'Estándar', body: null, years: null, engine: null }),
    version({ id: 'v:pickup-p-28-diesel', modelId: 'm:ficticia-pickup-p', label: '2.8 TD 4x4', body: 'PICK-UP', years: range(2018, 2025), engine: { displacementL: 2.8, fuel: 'diesel', evidence: 'structured' } }),
    version({ id: 'v:pickup-p-20-nafta', modelId: 'm:ficticia-pickup-p', label: '2.0 4x2', body: 'PICK-UP', years: range(2018, 2022), engine: { displacementL: 2.0, fuel: 'nafta', evidence: 'structured' } }),
    version({ id: 'v:suv-s-18-hibrido', modelId: 'm:ficticia-suv-s', label: '1.8 Híbrido', body: 'TODO TERRENO', years: range(2020, 2025), engine: { displacementL: 1.8, fuel: 'hibrido', evidence: 'structured' } }),
    version({ id: 'v:hatch-e-10-turbo', modelId: 'm:ejemplo-hatch-e', label: '1.0 Turbo', body: 'SEDAN 5 PUERTAS', years: range(2019, 2024), engine: { displacementL: 1.0, fuel: 'nafta', evidence: 'structured' } }),
    version({ id: 'v:moto-m-150', modelId: 'm:ejemplo-moto-m', label: '150 cc', body: 'MOTOCICLETA', years: range(2016, 2025), engine: { displacementL: 0.15, fuel: 'nafta', evidence: 'structured' } }),
    version({ id: 'v:scooter-x-110', modelId: 'm:prueba-scooter-x', label: '110 cc', body: 'MOTOCICLETA', years: range(2012, 2020), engine: { displacementL: 0.11, evidence: 'label' } }),
    version({ id: 'v:furgon-f-16', modelId: 'm:demo-furgon-f', label: '1.6 Furgón', body: 'FURGON', years: range(2010, 2025), engine: { displacementL: 1.6, fuel: 'nafta', evidence: 'structured' } }),
    version({ id: 'v:furgon-f-15-diesel', modelId: 'm:demo-furgon-f', label: '1.5 Diésel', body: 'FURGON', years: range(2012, 2020), engine: { displacementL: 1.5, fuel: 'diesel', evidence: 'structured' } }),
  ],
  retired: {
    // Synthetic examples of a previous catalog version: a merged model and a dropped version.
    'm:ficticia-sedan-viejo': 'm:ficticia-sedan-a',
    'v:sedan-a-13-retirada': null,
  },
}
