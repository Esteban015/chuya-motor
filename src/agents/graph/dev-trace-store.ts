// Dev-only in-memory trace store.
// Never instantiated or populated in production — the analyze route
// guards writes with `process.env.NODE_ENV !== 'production'`.
// Module-level singleton so traces persist across requests in the dev server.
// Bounded to MAX_ENTRIES to prevent unbounded memory growth.
import type { SafeTraceData } from './trace-sanitizer'

const MAX_ENTRIES = 100

class DevTraceStoreImpl {
  private readonly entries = new Map<string, SafeTraceData[]>()

  store(caseId: string, traces: SafeTraceData[]): void {
    if (this.entries.size >= MAX_ENTRIES) {
      // Drop oldest entry when full
      const firstKey = this.entries.keys().next().value
      if (firstKey !== undefined) this.entries.delete(firstKey)
    }
    this.entries.set(caseId, traces)
  }

  get(caseId: string): SafeTraceData[] | null {
    return this.entries.get(caseId) ?? null
  }

  size(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }
}

export const devTraceStore = new DevTraceStoreImpl()
