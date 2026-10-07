/**
 * Hydration must not wipe live per-title draft edits.
 *
 * Regression: opening a title and clicking Numero/Angolo while the initial
 * GET /api/defaults is still in flight loses the clicks once hydration
 * resolves -- buildFromStored recomputes every bare editing key from
 * server+localStorage, and per-title drafts are never persisted there.
 * Untouched keys (globals and fresh drafts) must still hydrate normally.
 */
import { StrictMode } from "react"
import { render, act } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  PosterEditorProvider,
  usePosterEditor,
  type PosterEditorCtx,
} from "@/lib/contexts/PosterEditorContext"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

const SERVER_DEFAULTS = {
  rankingBadgeStyle: "pill",
  extraBadgeStyle: null,
  defaultGradientHeight: 45,
  defaultRankingBadgeStyle: "pill",
}

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

describe("hydration preserves live per-title draft", () => {
  let getCount = 0
  let resolveQueue: Array<(v: unknown) => void>
  let storageGet: (k: string) => string | null = () => null

  beforeEach(() => {
    resetGuestGuardForTests()
    const storage = createStorageStub()
    storageGet = (k: string) => storage.getItem(k)
    vi.stubGlobal("localStorage", storage)
    getCount = 0
    resolveQueue = []
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") return { ok: true, json: async () => ({}) }
        if (!String(url).includes("/api/defaults")) return { ok: true, json: async () => ({}) }
        getCount += 1
        return new Promise((resolve) => {
          resolveQueue.push(resolve as (v: unknown) => void)
        })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function resolveNext(data: unknown) {
    await act(async () => {
      resolveQueue.shift()?.({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => data,
      })
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  function mountEditor() {
    let latest: PosterEditorCtx | null = null
    function Probe() {
      latest = usePosterEditor()
      return null
    }
    const utils = render(
      <PosterEditorProvider>
        <Probe />
      </PosterEditorProvider>,
    )
    return {
      get latest() {
        return latest as unknown as PosterEditorCtx
      },
      unmount: utils.unmount,
    }
  }

  it("clicks during pending hydration survive it (Numero + Angolo)", async () => {
    const ed = mountEditor()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // Simulate the Numero + Angolo clicks while hydration is in flight.
    act(() => {
      ed.latest.setRankingBadgeStyle("number")
      ed.latest.setExtraBadgeStyle("corner")
    })
    expect(ed.latest.rankingBadgeStyle).toBe("number")
    // Late hydration resolves after the clicks.
    await resolveNext(SERVER_DEFAULTS)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    // Live draft wins; untouched globals hydrate from the server.
    expect(ed.latest.rankingBadgeStyle).toBe("number")
    expect(ed.latest.extraBadgeStyle).toBe("corner")
    expect(ed.latest.defaultGradientHeight).toBe(45)
    ed.unmount()
  })

  it("429 then draft edit then 200: draft kept, server round trip intact", async () => {
    // Stateful stub server: PUTs merge like production, GETs return stored
    // state. A fixed-response stub would be unfaithful: the app persists
    // edits via PUT and re-reads them, so only a tracking stub reproduces
    // the real round trip.
    let serverState: Record<string, unknown> = {
      rankingBadgeStyle: "pill",
      extraBadgeStyle: null,
      gradientHeight: 45,
    }
    let calls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          serverState = { ...serverState, ...JSON.parse(init.body as string) }
          return { ok: true, json: async () => ({}) }
        }
        if (!String(url).includes("/api/defaults")) return { ok: true, json: async () => ({}) }
        calls += 1
        if (calls === 1) {
          return {
            ok: false,
            status: 429,
            headers: { get: (n: string) => (n === "Retry-After" ? "1" : null) },
            json: async () => ({}),
          }
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => serverState,
        }
      }),
    )
    const ed = mountEditor()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(calls).toBe(1)
    // Live draft plus a true global edit while the retry is pending.
    act(() => {
      ed.latest.setRankingBadgeStyle("number")
      ed.latest.setDefaultBlurIntensity(7)
    })
    expect(ed.latest.defaultBlurIntensity).toBe(7)
    // Payload schema carries defaults under bare names (blurIntensity, not
    // defaultBlurIntensity): the dual read in buildFromStored resolves it.
    expect(JSON.parse(storageGet("badgeDefaults")!).blurIntensity).toBe(7)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(calls).toBe(2)
    // Live draft preserved; the global edit round-tripped through the
    // debounced autosave PUT and the retry GET (existing merge semantics).
    expect(ed.latest.rankingBadgeStyle).toBe("number")
    expect(ed.latest.defaultBlurIntensity).toBe(7)
    ed.unmount()
  })

  it("unedited initial load applies server values including bare fallbacks", async () => {
    const ed = mountEditor()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await resolveNext(SERVER_DEFAULTS)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(ed.latest.rankingBadgeStyle).toBe("pill")
    expect(ed.latest.extraBadgeStyle).toBe(null)
    expect(ed.latest.defaultGradientHeight).toBe(45)
    expect(ed.latest.defaultSyncStatus).not.toBe("idle")
    ed.unmount()
  })

  it("a reset after the draft is honored, not shadowed by stale values", async () => {
    const ed = mountEditor()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      ed.latest.setTopBadgeScale(200)
    })
    expect(ed.latest.topBadgeScale).toBe(200)
    // Reset flow writes new draft values through the same update path.
    act(() => {
      ed.latest.setTopBadgeScale(100)
    })
    await resolveNext(SERVER_DEFAULTS)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(ed.latest.topBadgeScale).toBe(100)
    expect(ed.latest.defaultGradientHeight).toBe(45)
    ed.unmount()
  })

  it("unrelated per-title field and server field coexist", async () => {
    const ed = mountEditor()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      ed.latest.setTopBadgeScale(150)
    })
    await resolveNext({ ...SERVER_DEFAULTS, defaultBlurIntensity: 9 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(ed.latest.topBadgeScale).toBe(150)
    expect(ed.latest.defaultBlurIntensity).toBe(9)
    ed.unmount()
  })

  it("StrictMode remount keeps the draft with bounded fetches", async () => {
    let latest: PosterEditorCtx | null = null
    function Probe() {
      latest = usePosterEditor()
      return null
    }
    const { unmount } = render(
      <StrictMode>
        <PosterEditorProvider>
          <Probe />
        </PosterEditorProvider>
      </StrictMode>,
    )
    const ctx = () => latest as unknown as PosterEditorCtx
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      ctx().setRankingBadgeStyle("number")
    })
    // Resolve every pending hydration GET with the same server data.
    await act(async () => {
      while (resolveQueue.length > 0) {
        resolveQueue.shift()?.({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => SERVER_DEFAULTS,
        })
        await vi.advanceTimersByTimeAsync(0)
      }
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(ctx().rankingBadgeStyle).toBe("number")
    expect(ctx().defaultGradientHeight).toBe(45)
    // Mount(s) plus no retry storm: bounded hydration traffic only.
    expect(getCount).toBeLessThanOrEqual(3)
    unmount()
  })
})
