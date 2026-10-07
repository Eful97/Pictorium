import { describe, expect, it, vi } from "vitest"
import { retryAfterMs, withDefaultsRetry, type DefaultsAttempt } from "../../e2e/defaults-retry"

function attempt(overrides: Partial<DefaultsAttempt> = {}): DefaultsAttempt {
  return { ok: false, status: 429, body: '{"error":"busy"}', retryAfter: "1", ...overrides }
}

function recorder() {
  const sleeps: number[] = []
  const sleep = vi.fn(async (ms: number) => {
    sleeps.push(ms)
  })
  return { sleeps, sleep }
}

describe("retryAfterMs", () => {
  it("honors delta-seconds", () => {
    expect(retryAfterMs("2")).toBe(2000)
  })

  it("honors HTTP-date", () => {
    const header = new Date(Date.now() + 5000).toUTCString()
    const wait = retryAfterMs(header)
    expect(wait).toBeGreaterThan(4000)
    expect(wait).toBeLessThanOrEqual(5000)
  })

  it("honors large values without a cap (delta-seconds and HTTP-date)", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-10-07T12:00:00.000Z"))
      expect(retryAfterMs("60")).toBe(60_000)
      expect(retryAfterMs(new Date("2026-10-07T12:01:00.000Z").toUTCString())).toBe(60_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it("falls back to 3000ms on missing or invalid headers", () => {
    expect(retryAfterMs(null)).toBe(3000)
    expect(retryAfterMs("not-a-date")).toBe(3000)
  })
})

describe("withDefaultsRetry", () => {
  it("returns the first success with a single call and no sleep", async () => {
    const { sleeps, sleep } = recorder()
    const operation = vi.fn(async () => attempt({ ok: true, status: 200, body: '{"ok":true}' }))
    const res = await withDefaultsRetry(operation, { label: "reset defaults", sleep })
    expect(res.ok).toBe(true)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
  })

  it("retries a 429 and resends through the same operation", async () => {
    const { sleeps, sleep } = recorder()
    const seen: string[] = []
    const operation = vi.fn(async () => {
      seen.push("put")
      return seen.length === 1
        ? attempt({ retryAfter: "2" })
        : attempt({ ok: true, status: 200, body: '{"ok":true}' })
    })
    const res = await withDefaultsRetry(operation, { label: "reset defaults", sleep })
    expect(res.ok).toBe(true)
    expect(seen).toEqual(["put", "put"])
    expect(operation).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([2000])
  })

  it("throws with status and body after exhausting 3 attempts on persistent 429", async () => {
    const { sleeps, sleep } = recorder()
    const operation = vi.fn(async () => attempt({ status: 429, body: "Troppe richieste", retryAfter: "1" }))
    await expect(withDefaultsRetry(operation, { label: "restore defaults", sleep })).rejects.toThrow(
      "restore defaults: 429 Troppe richieste",
    )
    expect(operation).toHaveBeenCalledTimes(3)
    expect(sleeps).toEqual([1000, 1000])
  })

  it("throws immediately on a non-429 status without retrying", async () => {
    const { sleeps, sleep } = recorder()
    const operation = vi.fn(async () => attempt({ ok: false, status: 500, body: "boom", retryAfter: null }))
    await expect(withDefaultsRetry(operation, { label: "setup defaults", sleep })).rejects.toThrow(
      "setup defaults: 500 boom",
    )
    expect(operation).toHaveBeenCalledTimes(1)
    expect(sleeps).toEqual([])
  })
})
