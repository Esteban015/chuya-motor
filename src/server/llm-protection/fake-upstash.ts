/**
 * fake-upstash.ts — Test double of the Upstash REST endpoint (Incremento 6.4D). Test-only.
 *
 * Emulates the Redis semantics the store relies on: every command (including EVAL of our three
 * Lua scripts) runs to completion before the next one, like Redis' single-threaded execution.
 * Network latency is simulated with a random delay BEFORE execution, so concurrent clients
 * interleave at the command level exactly as real serverless instances would.
 */
import { ADJUST_SCRIPT, METRIC_SCRIPT, RESERVE_SCRIPT } from './upstash-quota-store'

interface Value {
  v: string | Map<string, number>
  exp: number | null
}

export class FakeUpstash {
  readonly data = new Map<string, Value>()
  commands: unknown[][] = []
  failNext: null | 'network' | 'http500' | 'error-body' | 'timeout' = null
  now: () => number
  /** When set, requests with another bearer token get HTTP 401 (like Upstash). */
  expectedToken: string | null = null

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  #get(key: string): Value | undefined {
    const e = this.data.get(key)
    if (e && e.exp !== null && e.exp <= this.now()) {
      this.data.delete(key)
      return undefined
    }
    return e
  }

  #num(key: string): number {
    const e = this.#get(key)
    return e && typeof e.v === 'string' ? Number(e.v) : 0
  }

  #pttl(key: string): number {
    const e = this.#get(key)
    if (!e) return -2
    return e.exp === null ? -1 : e.exp - this.now()
  }

  #incrby(key: string, by: number): number {
    const e = this.#get(key)
    const n = (e && typeof e.v === 'string' ? Number(e.v) : 0) + by
    this.data.set(key, { v: String(n), exp: e?.exp ?? null })
    return n
  }

  #expire(key: string, ms: number): void {
    const e = this.#get(key)
    if (e) e.exp = this.now() + ms
  }

  execute(cmd: unknown[]): unknown {
    this.commands.push(cmd)
    const [op, ...a] = cmd as [string, ...Array<string | number>]
    switch (op) {
      case 'GET': {
        const e = this.#get(String(a[0]))
        return e && typeof e.v === 'string' ? e.v : null
      }
      case 'SET': {
        const exp = a[2] === 'PX' ? this.now() + Number(a[3]) : null
        this.data.set(String(a[0]), { v: String(a[1]), exp })
        return 'OK'
      }
      case 'DEL':
        return a.reduce<number>((n, key) => n + (this.data.delete(String(key)) ? 1 : 0), 0)
      case 'SCAN': {
        // Single-pass SCAN: cursor 0 → all matching keys, next cursor 0. MATCH supports "prefix*".
        const i = a.indexOf('MATCH')
        const pattern = i >= 0 ? String(a[i + 1]) : '*'
        const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
        const keys = [...this.data.keys()].filter((key) => this.#get(key) && (pattern.endsWith('*') ? key.startsWith(prefix) : key === prefix))
        return ['0', keys]
      }
      case 'EXISTS':
        return this.#get(String(a[0])) ? 1 : 0
      case 'HGETALL': {
        const e = this.#get(String(a[0]))
        if (!e || typeof e.v === 'string') return []
        return [...e.v.entries()].flatMap(([k, v]) => [k, String(v)])
      }
      case 'EVAL': {
        const [script, , key, ...args] = a
        const k = String(key)
        if (script === RESERVE_SCRIPT) {
          const [amount, limit, ttl, refresh] = args.map(String)
          const cur = this.#num(k)
          if (cur + Number(amount) > Number(limit)) return [0, cur]
          const n = this.#incrby(k, Number(amount))
          if (refresh === '1' || this.#pttl(k) < 0) this.#expire(k, Number(ttl))
          return [1, n]
        }
        if (script === ADJUST_SCRIPT) {
          let n = this.#incrby(k, Number(args[0]))
          if (n < 0) {
            this.#get(k)!.v = '0'
            n = 0
          }
          if (this.#pttl(k) < 0) this.#expire(k, Number(args[1]))
          return n
        }
        if (script === METRIC_SCRIPT) {
          let e = this.#get(k)
          if (!e || typeof e.v === 'string') {
            e = { v: new Map(), exp: null }
            this.data.set(k, e)
          }
          const m = e.v as Map<string, number>
          m.set(String(args[0]), (m.get(String(args[0])) ?? 0) + Number(args[1]))
          if (e.exp === null) e.exp = this.now() + Number(args[2])
          return 1
        }
        throw new Error('unknown script')
      }
      default:
        throw new Error(`unsupported command ${op}`)
    }
  }

  /** fetch-compatible handler. */
  readonly fetch: typeof fetch = async (_url, init) => {
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)))
    if (init?.signal?.aborted) {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    }
    if (this.expectedToken !== null) {
      const auth = new Headers(init?.headers).get('authorization')
      if (auth !== `Bearer ${this.expectedToken}`) return new Response('Unauthorized', { status: 401 })
    }
    const mode = this.failNext
    this.failNext = null
    if (mode === 'network') throw new TypeError('fetch failed')
    if (mode === 'timeout') {
      const e = new Error('aborted')
      e.name = 'AbortError'
      throw e
    }
    if (mode === 'http500') return new Response('oops', { status: 500 })
    if (mode === 'error-body') return Response.json({ error: 'ERR something' })
    const cmd = JSON.parse(String(init?.body)) as unknown[]
    return Response.json({ result: this.execute(cmd) })
  }
}
