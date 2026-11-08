/**
 * Time-based RPM limiter for LLM API calls.
 *
 * Tracks the timestamp of the last real API call and inserts the minimum
 * required delay before the next one based on the configured RPM limit.
 *
 * Separation of concerns:
 * - `RpmLimiter` handles inter-call timing (real latency aware).
 * - `scenarioDelayMs` in BenchmarkRunConfig is a fixed artificial delay (latency-unaware).
 * Both can be combined: scenarioDelayMs applies unconditionally; RPM limiting
 * only applies when the inter-call interval has not elapsed naturally.
 */

export class RpmLimiter {
  private readonly maxIntervalMs: number
  private lastRealCallTs: number | null = null
  private _totalDelayAppliedMs = 0

  constructor(rpm: number) {
    if (rpm <= 0) throw new RangeError(`rpm must be positive, got: ${rpm}`)
    this.maxIntervalMs = Math.ceil(60_000 / rpm)
  }

  /**
   * Waits the remaining interval if the last real call was recent.
   * Returns the actual wait time in ms (0 if no wait was needed).
   * Pass `hadRealCall=false` to skip the wait (e.g. safety-blocked scenarios).
   */
  async waitIfNeeded(hadRealCall: boolean): Promise<number> {
    if (!hadRealCall || this.lastRealCallTs === null) return 0
    const elapsed = Date.now() - this.lastRealCallTs
    const waitMs = Math.max(0, this.maxIntervalMs - elapsed)
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
      this._totalDelayAppliedMs += waitMs
    }
    return waitMs
  }

  /** Record that a real API call just happened (call after the scenario completes). */
  recordCall(): void {
    this.lastRealCallTs = Date.now()
  }

  /** Total milliseconds spent waiting due to RPM limiting. */
  get totalDelayAppliedMs(): number {
    return this._totalDelayAppliedMs
  }
}
