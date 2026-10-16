import { createLogger } from "@/lib/logger"

export interface CircuitBreakerOptions {
  /** Log source (defaults to "circuit-breaker"). Pass the owner's name
   *  (e.g. "awards") to keep existing log filters/dashboards working. */
  readonly name?: string
  /** Consecutive failures that open the breaker (must be >= 1). */
  readonly failureThreshold: number
  /** How long requests are rejected before a single trial is allowed (ms). */
  readonly backoffMs: number
}

export interface CircuitBreaker {
  /** True when requests must be rejected immediately (fail-open). */
  isOpen(): boolean
  recordSuccess(): void
  /**
   * Records a failure. When the threshold is reached the backoff window
   * opens; `customBackoffMs` overrides the window once (e.g. an upstream
   * Retry-After) without changing the configured default.
   */
  recordFailure(customBackoffMs?: number): void
  /**
   * Opens the breaker immediately, without waiting for the threshold —
   * for hard blocks (e.g. HTTP 403 anti-bot) where retrying is pointless.
   * Extends the window when already open.
   */
  trip(customBackoffMs?: number): void
  /** Test-only: reset all state. */
  reset(): void
  /**
   * Relinquishes an admitted half-open trial WITHOUT recording an outcome —
   * for the trial owner whose caller aborted before or while the upstream
   * request executed. The `token` must be the value returned by
   * `currentTrial()` captured synchronously when this request was admitted;
   * a request admitted while CLOSED captures null and is never the trial.
   * Clears the in-flight trial flag ONLY when the token still identifies the
   * currently held trial: a stale abort (older CLOSED-state request, or an
   * older trial superseded by a new trip + trial) is a no-op and can never
   * release a newer live trial. The failure count and backoff window are
   * untouched, so a genuine outage keeps its cooldown and the next request
   * may admit a fresh trial.
   */
  releaseTrial(token: number | null): void
  /**
   * Token of the currently held half-open trial, or null when no trial is
   * held (CLOSED breaker, open window, or trial already settled/released).
   * Request paths must capture this SYNCHRONOUSLY right after `isOpen()`
   * admits them (no await in between) and hand it to `releaseTrial()` on
   * caller abort — that pairing is what makes a non-trial abort a safe
   * no-op instead of clearing a newer live trial.
   */
  currentTrial(): number | null
  /**
   * Read-only status: true when requests would currently be rejected,
   * WITHOUT admitting a half-open trial. Telemetry/status surfaces must use
   * this: isOpen() admits exactly one trial and must only be called by paths
   * that will actually run the trial and record its outcome, otherwise the
   * admitted trial is orphaned and the breaker wedges open.
   */
  peekOpen(): boolean
}

/**
 * Retry-After (seconds) → ms for a breaker's custom backoff. Cap 5min: the
 * value is upstream-controlled and must never freeze a provider for hours.
 * Returns undefined when absent/unparseable (use the default backoff).
 */
export function parseRetryAfterMs(getHeader: (name: string) => string | null): number | undefined {
  const raw = getHeader("Retry-After")
  if (!raw) return undefined
  const s = parseInt(raw, 10)
  if (!Number.isFinite(s) || s < 0) return undefined
  return Math.min(s * 1000, 300_000)
}

/**
 * Generic fail-open circuit breaker with half-open trial (extracted from
 * awards.ts — the Wikidata SPARQL breaker, the battle-tested reference).
 *
 * Closed: requests pass, failures counted. At `failureThreshold` a backoff
 * window opens and every request is rejected. When the window expires, ONE
 * trial request passes (half-open) while the rest stay rejected until the
 * trial succeeds (closed) or fails (new backoff window).
 */
export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreaker {
  const threshold = Number.isFinite(options.failureThreshold) && options.failureThreshold >= 1
    ? Math.floor(options.failureThreshold)
    : 5
  const backoffMs = Number.isFinite(options.backoffMs) && options.backoffMs >= 0
    ? options.backoffMs
    : 60_000
  const log = createLogger(options.name || "circuit-breaker")

  let failures = 0
  let openUntil = 0
  let halfOpen = false
  // Monotonic id of the currently held half-open trial. Incremented on every
  // admission, never reused: a token captured by an older request (or an
  // older trial superseded by a new trip) can never equal the live one, so a
  // stale caller abort cannot release a newer trial.
  let trialId = 0

  function effectiveBackoff(customBackoffMs?: number): number {
    return typeof customBackoffMs === "number"
      && Number.isFinite(customBackoffMs) && customBackoffMs >= 0
      ? customBackoffMs
      : backoffMs
  }

  return {
    isOpen(): boolean {
      const now = Date.now()
      if (openUntil > now) return true
      if (failures >= threshold) {
        if (halfOpen) return true // a trial is already in flight → reject
        halfOpen = true
        trialId++
        log.info("Circuit breaker half-open: one trial request allowed")
        return false
      }
      return false
    },

    recordSuccess(): void {
      failures = 0
      halfOpen = false
    },

    recordFailure(customBackoffMs?: number): void {
      failures++
      halfOpen = false
      // The backoff window opens only at the threshold: the first N failures
      // reject nothing yet. A failed half-open trial (already at threshold)
      // imposes another wait before the next trial.
      if (failures >= threshold) {
        const effective = effectiveBackoff(customBackoffMs)
        openUntil = Date.now() + effective
        log.warn(`Circuit breaker failure #${failures} — backoff ${effective}ms`)
      }
    },

    trip(customBackoffMs?: number): void {
      failures = threshold
      halfOpen = false
      const effective = effectiveBackoff(customBackoffMs)
      openUntil = Date.now() + effective
      log.warn(`Circuit breaker tripped — backoff ${effective}ms`)
    },

    reset(): void {
      failures = 0
      openUntil = 0
      halfOpen = false
    },

    releaseTrial(token: number | null): void {
      // Owner-guarded: only the request still holding the live trial may
      // relinquish it. A null token (admitted while CLOSED — never the
      // trial) and a stale token (older trial after a new trip/admission)
      // are no-ops, so neither wedges nor double-admits the breaker.
      if (token !== null && halfOpen && trialId === token) {
        halfOpen = false
      }
    },

    currentTrial(): number | null {
      return halfOpen ? trialId : null
    },

    peekOpen(): boolean {
      const now = Date.now()
      if (openUntil > now) return true
      if (failures >= threshold) {
        // A trial already in flight still rejects the rest; an expired
        // window with no trial held simply reports recoverable — admission
        // stays exclusively with isOpen().
        return halfOpen
      }
      return false
    },
  }
}
