/**
 * benchmark/catalog/catalog-latency.ts — Vehicle catalog performance (Incremento 7D.2).
 *
 *   npm run bench:catalog                                   # in-process provider (no server)
 *   npm run bench:catalog -- --url http://localhost:3100 --requests 3000 --concurrency 20
 *
 * In-process: cold load + integrity check + indexing of the real dataset, then random dependent
 * walks (types → brands → models → years → versions) through the provider.
 * HTTP: the same walks against GET /api/vehicle-catalog of a running PRODUCTION server (`next
 * start`), with N concurrent virtual users. Each virtual user sends its own x-forwarded-for so the
 * per-client rate limit (120/min) measures a realistic per-user load, not one user hammering.
 * Local only: no external calls. Prints hardware / environment and p50 / p95 / p99 / max.
 */
import { cpus, totalmem, platform, release, arch } from 'node:os'
import { performance } from 'node:perf_hooks'
import { loadDnrpaCatalog } from '../../src/server/vehicle-catalog/datasets'
import type { VehicleCatalogProvider } from '../../src/domain/vehicle/vehicle-catalog'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN
function summary(label: string, samples: number[]) {
  const s = [...samples].sort((a, b) => a - b)
  const f = (n: number) => n.toFixed(2).padStart(8)
  console.log(`${label.padEnd(10)} n=${String(s.length).padStart(5)}  p50 ${f(pct(s, 50))} ms  p95 ${f(pct(s, 95))} ms  p99 ${f(pct(s, 99))} ms  max ${f(s[s.length - 1] ?? NaN)} ms`)
  return { n: s.length, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s[s.length - 1] }
}

let seed = 42
const rand = (n: number) => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31
  return seed % n
}
const pick = <T,>(list: T[]): T | undefined => (list.length ? list[rand(list.length)] : undefined)

type Timings = Record<'types' | 'brands' | 'models' | 'years' | 'versions', number[]>
const newTimings = (): Timings => ({ types: [], brands: [], models: [], years: [], versions: [] })

async function inProcess(p: VehicleCatalogProvider, walks: number) {
  const t = newTimings()
  const time = async <T,>(bucket: number[], fn: () => Promise<T>) => {
    const s = performance.now()
    const r = await fn()
    bucket.push(performance.now() - s)
    return r
  }
  for (let i = 0; i < walks; i++) {
    const types = await time(t.types, () => p.listTypes())
    const type = types.ok ? pick(types.data) : undefined
    if (!type) continue
    const brands = await time(t.brands, () => p.listBrands(type.id))
    const brand = brands.ok ? pick(brands.data) : undefined
    if (!brand) continue
    const models = await time(t.models, () => p.listModels(type.id, brand.id))
    const model = models.ok ? pick(models.data) : undefined
    if (!model) continue
    const years = await time(t.years, () => p.listYears(model.id))
    const year = years.ok && years.data ? (pick(years.data) ?? null) : null
    await time(t.versions, () => p.listVersions(model.id, year))
  }
  return t
}

async function overHttp(base: string, requests: number, concurrency: number) {
  const t = newTimings()
  const errors: Record<string, number> = {}
  let sent = 0
  const get = async (ip: string, bucket: number[], qs: string) => {
    const s = performance.now()
    const res = await fetch(`${base}/api/vehicle-catalog?${qs}`, { headers: { 'x-forwarded-for': ip } })
    const body = res.ok ? ((await res.json()) as { data: unknown }) : null
    bucket.push(performance.now() - s)
    sent++
    if (!res.ok) errors[res.status] = (errors[res.status] ?? 0) + 1
    return body?.data as Array<{ id: string }> | number[] | null | undefined
  }
  const user = async (u: number) => {
    const ip = `10.200.${Math.floor(u / 250)}.${(u % 250) + 1}`
    while (sent < requests) {
      const types = (await get(ip, t.types, 'level=types')) as Array<{ id: string }> | undefined
      const type = types && pick(types)
      if (!type) continue
      const brands = (await get(ip, t.brands, `level=brands&typeId=${encodeURIComponent(type.id)}`)) as Array<{ id: string }> | undefined
      const brand = brands && pick(brands)
      if (!brand) continue
      const models = (await get(ip, t.models, `level=models&typeId=${encodeURIComponent(type.id)}&brandId=${encodeURIComponent(brand.id)}`)) as Array<{ id: string }> | undefined
      const model = models && pick(models)
      if (!model) continue
      const years = (await get(ip, t.years, `level=years&modelId=${encodeURIComponent(model.id)}`)) as number[] | null | undefined
      const year = Array.isArray(years) ? pick(years) : undefined
      await get(ip, t.versions, `level=versions&modelId=${encodeURIComponent(model.id)}${year ? `&year=${year}` : ''}`)
    }
  }
  const start = performance.now()
  await Promise.all(Array.from({ length: concurrency }, (_, u) => user(u)))
  return { t, errors, seconds: (performance.now() - start) / 1000, sent }
}

async function main() {
  const cpu = cpus()[0]
  console.log(`Hardware: ${cpu?.model ?? 'unknown CPU'} × ${cpus().length} · RAM ${(totalmem() / 2 ** 30).toFixed(1)} GiB`)
  console.log(`Entorno: Node ${process.version} · ${platform()} ${release()} ${arch()}`)

  const t0 = performance.now()
  const p = loadDnrpaCatalog()
  const loadMs = performance.now() - t0
  if (!p) throw new Error('Real catalog not available (data/vehicle-catalog/dnrpa-…/dataset.json).')
  console.log(`Catálogo ${p.meta.source} ${p.meta.version} · carga en frío + integridad + índices: ${loadMs.toFixed(0)} ms`)

  const url = arg('url')
  if (!url) {
    const walks = Number(arg('walks', '2000'))
    console.log(`\nEn proceso: ${walks} recorridos aleatorios (semilla fija)`)
    const t = await inProcess(p, walks)
    for (const [k, v] of Object.entries(t)) summary(k, v)
    summary('total', Object.values(t).flat())
    return
  }
  const requests = Number(arg('requests', '3000'))
  const concurrency = Number(arg('concurrency', '20'))
  console.log(`\nHTTP ${url} · ${requests} solicitudes · ${concurrency} usuarios concurrentes`)
  await fetch(`${url}/api/vehicle-catalog?level=types`, { headers: { 'x-forwarded-for': '10.250.0.1' } }) // warm-up (first load)
  const { t, errors, seconds, sent } = await overHttp(url, requests, concurrency)
  for (const [k, v] of Object.entries(t)) summary(k, v)
  summary('total', Object.values(t).flat())
  console.log(`Rendimiento: ${(sent / seconds).toFixed(0)} req/s · errores: ${JSON.stringify(errors)}`)
}

void main()
