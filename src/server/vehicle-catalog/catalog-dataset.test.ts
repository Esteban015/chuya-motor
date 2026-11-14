/**
 * catalog-dataset.test.ts — Versioned catalog format: integrity, license, hash, retired IDs and
 * diff between catalog versions (Incremento 7D.2). Synthetic data only.
 */
import { describe, expect, it } from 'vitest'
import { FIXTURE_CATALOG } from './fixture-catalog'
import { checkCatalogIntegrity, computeDatasetHash, diffCatalogs, withDatasetHash, type CatalogDataset } from './catalog-dataset'
import { StaticCatalogProvider } from './static-catalog-provider'

const clone = (): CatalogDataset => JSON.parse(JSON.stringify(FIXTURE_CATALOG)) as CatalogDataset
const problemsAfter = (mutate: (d: CatalogDataset) => void) => {
  const d = clone()
  mutate(d)
  return checkCatalogIntegrity(d)
}

describe('DS-01: the synthetic fixture is a valid, distributable v2 dataset', () => {
  it('no integrity problems; license synthetic; every version has provenance and explicit missing fields', () => {
    expect(checkCatalogIntegrity(FIXTURE_CATALOG)).toEqual([])
    expect(FIXTURE_CATALOG.manifest.source.license.status).toBe('synthetic')
    for (const v of FIXTURE_CATALOG.versions) expect(v.provenance.sourceRecordIds.length).toBeGreaterThan(0)
    const especial = FIXTURE_CATALOG.versions.find((v) => v.id === 'v:sedan-a-especial')!
    expect(especial.missing).toEqual(['body', 'displacement', 'fuel'])
  })
})

describe('DS-02: integrity rules', () => {
  it.each<[string, (d: CatalogDataset) => void, RegExp]>([
    ['repeated brand under another ID', (d) => d.brands.push({ id: 'b:ficticia-autos-2', name: 'FICTICIA AUTOS', aliases: [], typeIds: ['t:auto'] }), /^duplicate_brand_name:/],
    ['brand alias colliding with another brand', (d) => d.brands[1]!.aliases.push('Ficticia Automotores'), /^duplicate_brand_name:/],
    ['model alias colliding with another model of the brand', (d) => d.models[1]!.aliases.push('Sedán A'), /^duplicate_model_name:/],
    ['duplicate record (same id)', (d) => d.versions.push({ ...d.versions[0]! }), /^duplicate_version:/],
    ['duplicate version label for the same model and body', (d) => d.versions.push({ ...d.versions[0]!, id: 'v:sedan-a-14-nafta-bis' }), /^duplicate_version_label:/],
    ['version years outside the model (inconsistent version)', (d) => (d.versions[0]!.years = [1999]), /^version_years_outside_model:/],
    ['reference to a non-existent model', (d) => (d.versions[0]!.modelId = 'm:no-existe'), /^version_unknown_model:/],
    ['reference to a non-existent brand', (d) => (d.models[0]!.brandId = 'b:no-existe'), /^model_unknown_brand:/],
    ['model under a type its brand is not listed for', (d) => (d.models[0]!.typeId = 't:moto'), /^model_type_not_listed_for_brand:/],
    ['missing years not declared', (d) => (d.versions[0]!.years = null), /^missing_fields_mismatch:/],
    ['unknown engine declared as known', (d) => (d.versions.find((v) => v.id === 'v:sedan-a-especial')!.missing = []), /^missing_fields_mismatch:/],
    ['empty engine object instead of null', (d) => {
      const v = d.versions.find((x) => x.id === 'v:sedan-a-especial')!
      v.engine = { evidence: 'label' }
    }, /^empty_engine:/],
    ['retired ID still live', (d) => (d.retired['m:ficticia-sedan-a'] = null), /^retired_id_still_live:/],
    ['retired replacement that does not exist', (d) => (d.retired['m:ficticia-sedan-viejo'] = 'm:no-existe'), /^retired_replacement_unknown:/],
    ['retired replacement at another level', (d) => (d.retired['m:ficticia-sedan-viejo'] = 'b:ficticia-autos'), /^retired_replacement_other_level:/],
  ])('%s', (_name, mutate, expected) => {
    expect(problemsAfter(mutate).some((p) => expected.test(p))).toBe(true)
  })
})

describe('DS-03: license and tampering', () => {
  it('pending / denied licenses are never served (a public document is not a license)', async () => {
    for (const status of ['pending', 'denied'] as const) {
      const d = clone()
      d.manifest.source = { ...d.manifest.source, isFixture: false, license: { status } }
      expect(checkCatalogIntegrity(d)).toContain('license_not_distributable')
      expect(await new StaticCatalogProvider(d).listTypes()).toEqual({ ok: false, error: 'INVALID_DATA' })
    }
  })

  it('authorized needs a reference; a fixture must be synthetic', () => {
    expect(problemsAfter((d) => (d.manifest.source = { ...d.manifest.source, isFixture: false, license: { status: 'authorized' } }))).toContain('license_reference_missing')
    expect(problemsAfter((d) => (d.manifest.source = { ...d.manifest.source, isFixture: true, license: { status: 'authorized', reference: 'nota 1' } }))).toContain('fixture_license_mismatch')
  })

  it('content hash: a valid hash passes; any edit after hashing is detected and not served', async () => {
    const hashed = withDatasetHash(clone())
    expect(hashed.manifest.sha256).toBe(computeDatasetHash(hashed))
    expect(checkCatalogIntegrity(hashed)).toEqual([])
    hashed.versions[0]!.label = 'Editado a mano'
    expect(checkCatalogIntegrity(hashed)).toContain('hash_mismatch')
    expect((await new StaticCatalogProvider(hashed).listTypes()).ok).toBe(false)
  })
})

describe('DS-04: changes between catalog versions', () => {
  it('diff lists added, removed (with / without retirement), renamed and changed years / engines', () => {
    const prev = clone()
    const next = clone()
    next.manifest.catalogVersion = 'fixture-2026-12-01.1'
    next.versions = next.versions.filter((v) => v.id !== 'v:furgon-f-15-diesel' && v.id !== 'v:hatch-e-10-turbo')
    next.retired['v:furgon-f-15-diesel'] = null
    next.versions.find((v) => v.id === 'v:sedan-a-14-nafta')!.label = '1.4 8V Nafta (renombrada)'
    next.versions.find((v) => v.id === 'v:pickup-p-20-nafta')!.years = [2018, 2019]
    next.versions.push({ ...next.versions[0]!, id: 'v:sedan-a-nueva', label: 'Nueva' })
    const diff = diffCatalogs(prev, next)
    expect(diff.added).toEqual(['v:sedan-a-nueva'])
    expect(diff.removed.sort()).toEqual(['v:furgon-f-15-diesel', 'v:hatch-e-10-turbo'])
    expect(diff.removedWithoutRetirement).toEqual(['v:hatch-e-10-turbo'])
    expect(diff.renamed).toEqual([{ id: 'v:sedan-a-14-nafta', from: '1.4 8V Nafta', to: '1.4 8V Nafta (renombrada)' }])
    expect(diff.yearsChanged).toEqual(['v:pickup-p-20-nafta'])
  })

  it('provider exposes retired replacements', () => {
    const p = new StaticCatalogProvider(FIXTURE_CATALOG)
    expect(p.retiredReplacement('m:ficticia-sedan-viejo')).toBe('m:ficticia-sedan-a')
    expect(p.retiredReplacement('v:sedan-a-13-retirada')).toBeNull()
    expect(p.retiredReplacement('m:ficticia-sedan-a')).toBeUndefined()
  })
})
