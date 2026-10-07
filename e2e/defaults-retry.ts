import type { Page } from "@playwright/test"

// Shared retry for the E2E /api/defaults setup/restore PUTs.
//
// Root cause (E2E429): GET and PUT share one `defaults` rate-limit bucket
// (30 burst, 3/sec refill), keyed by the Chromium UA fallback in tests, so a
// serial file run legitimately bursts it (boot GETs + debounced UI autosave
// PUTs + helper PUTs). A 429 here is runtime-expected, not an app bug: honor
// the server Retry-After and retry instead of failing the test.
//
// Only 429 is retried (max 3 attempts total). Any other status throws
// immediately, and an exhausted retry loop throws with the same
// `${label}: ${status} ${body}` details — a failed restore never
// silently becomes a pass.

export interface DefaultsAttempt {
  ok: boolean
  status: number
  body: string
  retryAfter: string | null
}

export type DefaultsOperation = () => Promise<DefaultsAttempt>

export interface DefaultsRetryOptions {
  label: string
  maxAttempts?: number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_MAX_ATTEMPTS = 3
const FALLBACK_WAIT_MS = 3000

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date). A positive
 * server value is honored as-is (no cap: a genuine large Retry-After must
 * be respected, and if it exceeds the test timeout the test fails
 * transparently instead of hammering the limiter). Missing, invalid, or
 * non-positive values fall back to 3000ms.
 */
export function retryAfterMs(header: string | null): number {
  const raw = (header ?? "").trim()
  if (/^\d+$/.test(raw)) return Number(raw) * 1000
  const asDate = Date.parse(raw)
  if (Number.isFinite(asDate)) {
    const waitMs = asDate - Date.now()
    return waitMs > 0 ? waitMs : FALLBACK_WAIT_MS
  }
  return FALLBACK_WAIT_MS
}

/**
 * Run a defaults operation, retrying only 429 with the server's Retry-After.
 * Returns the successful attempt; throws `${label}: ${status} ${body}` on a
 * non-429 status or once attempts are exhausted.
 */
export async function withDefaultsRetry(
  operation: DefaultsOperation,
  options: DefaultsRetryOptions,
): Promise<DefaultsAttempt> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const sleep = options.sleep ?? defaultSleep
  let last: DefaultsAttempt | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await operation()
    if (res.ok) return res
    last = res
    if (res.status !== 429 || attempt === maxAttempts) break
    await sleep(retryAfterMs(res.retryAfter))
  }
  const failed = last as DefaultsAttempt
  throw new Error(`${options.label}: ${failed.status} ${failed.body}`)
}

/**
 * PUT a defaults payload via the page's browser fetch (same-origin, same
 * transport/credentials as every spec's inline helper), with 429 retry.
 */
export async function putDefaultsWithRetry(page: Page, label: string, payload: unknown): Promise<void> {
  await withDefaultsRetry(
    () =>
      page.evaluate(async (body) => {
        const r = await fetch("/api/defaults", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        return {
          ok: r.ok,
          status: r.status,
          body: (await r.text()).slice(0, 200),
          retryAfter: r.headers.get("Retry-After"),
        }
      }, payload),
    { label },
  )
}
