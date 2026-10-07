/**
 * Hydration retry on 429 for useDefaults refreshFromServer.
 *
 * Contract under test (src/lib/useDefaults.ts):
 * - only 429 waits out Retry-After (same semantics as parseRetryAfter:
 *   delta-seconds and HTTP-date, short fallback, 30s cap) and refetches;
 * - at most HYDRATION_MAX_ATTEMPTS total attempts, then current settle;
 * - 401/404/network never retry;
 * - unmount during backoff writes no state and refetches nothing;
 * - a user edit during backoff survives via the localStorage merge;
 * - generation ownership: a newer refresh (StrictMode remount, post-unlock
 *   event) invalidates the older chain — no stale retry, no obsolete data,
 *   no attempts beyond the owner budget.
 */
import { StrictMode, type ReactNode } from "react"
import { renderHook, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { useDefaults } from "@/lib/useDefaults"
import { parseRetryAfter } from "@/lib/http"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { USER_UNLOCK_EVENT } from "@/lib/user-token"

const SERVER_PILL = { rankingBadgeStyle: "pill" }

function createStorageStub() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    clear: () => {
      store.clear()
    },
  }
}

function okGet(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => data,
  }
}

function r429(retryAfter: string | null) {
  return {
    ok: false,
    status: 429,
    headers: { get: (name: string) => (name === "Retry-After" ? retryAfter : null) },
    json: async () => ({}),
  }
}

function failGet(status: number) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({}),
  }
}

describe("parseRetryAfter (hydration backoff)", () => {
  it("delta-seconds, HTTP-date, fallback and cap", () => {
    expect(parseRetryAfter("2")).toBe(2000)
    expect(parseRetryAfter("0")).toBe(0)
    expect(parseRetryAfter(null)).toBe(1000)
    expect(parseRetryAfter("")).toBe(1000)
    expect(parseRetryAfter("garbage")).toBe(1000)
    // Far-future date hits the exact 30s cap (deterministic, no real timing).
    expect(parseRetryAfter(new Date(Date.now() + 3_600_000).toUTCString())).toBe(30_000)
    // Huge delta-seconds are capped too.
    expect(parseRetryAfter("999999")).toBe(30_000)
    // Past date retries immediately.
    expect(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBe(1000)
  })
})

describe("useDefaults hydration retry on 429", () => {
  let getCount = 0

  beforeEach(() => {
    resetGuestGuardForTests()
    const storage = createStorageStub()
    vi.stubGlobal("localStorage", storage)
    // Empty storage: state starts at factory (rs=default), like a fresh
    // profile whose hydration GET hits a 429.
    getCount = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function stubFetch(
    getImpl: () => { ok: boolean; status: number; headers: { get: (n: string) => string | null }; json: () => Promise<unknown> },
  ) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") return { ok: true, json: async () => ({}) }
        // Count the hydration GET only (guest-guard/status fire other fetches).
        if (!String(_url).includes("/api/defaults")) return { ok: true, json: async () => ({}) }
        getCount += 1
        return getImpl()
      }),
    )
  }

  it("429 (Retry-After: 1) then 200: waits ~1s, refetches, applies pill", async () => {
    let first = true
    stubFetch(() => {
      if (first) {
        first = false
        return r429("1")
      }
      return okGet(SERVER_PILL)
    })
    const { result, unmount } = renderHook(() => useDefaults())
    expect(result.current.defaultRankingBadgeStyle).toBe("default")
    // Backoff (1000ms) not elapsed yet: no refetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(getCount).toBe(1)
    expect(result.current.defaultRankingBadgeStyle).toBe("default")
    // Retry-After elapsed: second attempt, server pill applied.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(getCount).toBe(2)
    expect(result.current.defaultRankingBadgeStyle).toBe("pill")
    unmount()
  })

  it("permanent 429: exactly 3 total attempts, then factory and quiet", async () => {
    stubFetch(() => r429("1"))
    const { result, unmount } = renderHook(() => useDefaults())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000)
    })
    expect(getCount).toBe(3)
    expect(result.current.defaultRankingBadgeStyle).toBe("default")
    // No fourth attempt even after a long wait.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(getCount).toBe(3)
    unmount()
  })

  it("401 never retries (current semantics preserved)", async () => {
    stubFetch(() => failGet(401))
    const { result, unmount } = renderHook(() => useDefaults())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(getCount).toBe(1)
    expect(result.current.defaultRankingBadgeStyle).toBe("default")
    unmount()
  })

  it("unmount during backoff: no refetch, no writes", async () => {
    stubFetch(() => r429("5"))
    const { unmount } = renderHook(() => useDefaults())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(getCount).toBe(1)
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(getCount).toBe(1)
  })

  it("user edit during backoff survives (local precedence by design)", async () => {
    let first = true
    stubFetch(() => {
      if (first) {
        first = false
        return r429("1")
      }
      return okGet(SERVER_PILL)
    })
    const { result, unmount } = renderHook(() => useDefaults())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    // Concurrent edit while the retry is pending (synchronous local write).
    act(() => {
      result.current.update({ defaultTopBadgeScale: 150, topBadgeScale: 150 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    // The retry still fired (no wedging) and the edit is preserved: the
    // merge favors local by design, so the server pill stays shadowed by
    // the factory local — what matters is nothing is lost and nothing throws.
    expect(getCount).toBe(2)
    expect(result.current.defaultTopBadgeScale).toBe(150)
    unmount()
  })

  it("StrictMode remount: stale chain schedules nothing, owner wins once", async () => {
    // Mount 1 fires GET#1 (aborted + invalidated by the remount cleanup),
    // mount 2 fires GET#2 (429), owner retry fires GET#3 (200). Without
    // generation ownership the stale chain would schedule its own retry
    // (extra GET) and could apply obsolete data.
    const seen: string[] = []
    stubFetch(() => {
      seen.push("get")
      if (seen.length === 2) return r429("1")
      if (seen.length >= 3) return okGet(SERVER_PILL)
      return r429("1")
    })
    const { result, unmount } = renderHook(() => useDefaults(), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(getCount).toBe(3)
    expect(result.current.defaultRankingBadgeStyle).toBe("pill")
    // No duplicate retry from the invalidated first generation.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(getCount).toBe(3)
    unmount()
  })

  it("unlock event while retry pending: latest refresh wins, budget kept", async () => {
    // GET#1 429s with a long backoff; the unlock refresh (owner) refetches
    // immediately (GET#2, 200) and the stale timer never fires its own retry.
    const seen: string[] = []
    stubFetch(() => {
      seen.push("get")
      if (seen.length === 1) return r429("5")
      return okGet(SERVER_PILL)
    })
    const { result, unmount } = renderHook(() => useDefaults())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(getCount).toBe(1)
    await act(async () => {
      window.dispatchEvent(new Event(USER_UNLOCK_EVENT))
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(getCount).toBe(2)
    expect(result.current.defaultRankingBadgeStyle).toBe("pill")
    // The stale 5s timer was cancelled: no third fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(getCount).toBe(2)
    unmount()
  })
})
