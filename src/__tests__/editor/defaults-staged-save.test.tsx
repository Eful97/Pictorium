/**
 * Phase 1 staged save foundation (useDefaults.saveStagedDefaults):
 * - same defaultsToPayload serializer + syncSend sequence/status machinery;
 * - exactly one PUT, no subsequent auto-effect duplicate;
 * - failure leaves outer defaults AND durable local storage unchanged;
 * - server ack installs the exact staged default fields, open per-title bare
 *   state preserved;
 * - intentional guest skip counts as local success with truthful local-only;
 * - storage/namespace/hydration guards respected; stale GET/send safe;
 * - legacy auto-persist preserved for other consumers.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useDefaults, type DefaultsState } from "@/lib/useDefaults"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { resetGuestGuardForTests } from "@/lib/guest-guard"

vi.mock("@/lib/guest-guard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guest-guard")>()
  return { ...mod, shouldSkipServerSync: vi.fn(async () => false) }
})

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

type StorageStub = ReturnType<typeof createStorageStub>

describe("saveStagedDefaults", () => {
  let putBodies: unknown[]
  let storage: StorageStub
  let putImpl: () => { ok: boolean; status: number }
  let failWrites = false

  beforeEach(() => {
    resetGuestGuardForTests()
    window.history.pushState({}, "", "/")
    storage = createStorageStub()
    vi.stubGlobal("localStorage", storage)
    putBodies = []
    putImpl = () => ({ ok: true, status: 200 })
    failWrites = false
    const origSet = storage.setItem.bind(storage)
    storage.setItem = (k: string, v: string) => {
      if (failWrites && k === "badgeDefaults") throw new Error("quota")
      origSet(k, v)
    }
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ...putImpl(), json: async () => ({}) }
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
      }),
    )
    vi.mocked(shouldSkipServerSync).mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200)
    })
  }

  function stagedFrom(current: DefaultsState, patch: Partial<DefaultsState>): DefaultsState {
    return { ...current, ...patch }
  }

  it("sends one PUT with all default-backed fields + raw landscape, no auto-effect duplicate", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(putBodies).toEqual([])
    const staged = stagedFrom(result.current, {
      defaultBadgeYear: false,
      defaultBadgeFont: "oswald",
      defaultAgeBadge: true,
      defaultAgeCountry: "US",
      defaultPosterLayout: "fresh",
      defaultPosterFreshScope: "all",
      defaultRegion: "US",
      defaultLogoScale: 80,
      landscape: { ...result.current.landscape, topBadgeScale: 150 },
    })
    let res: unknown
    await act(async () => {
      res = await result.current.saveStagedDefaults(staged)
    })
    expect(res).toMatchObject({ ok: true })
    expect(putBodies).toHaveLength(1)
    const body = putBodies[0] as Record<string, unknown>
    // Flat (portrait) format preserved…
    expect(body.badgeYear).toBe(false)
    expect(body.badgeFont).toBe("oswald")
    expect(body.ageBadge).toBe(true)
    expect(body.ageCountry).toBe("US")
    expect(body.posterLayout).toBe("fresh")
    expect(body.posterFreshScope).toBe("all")
    expect(body.region).toBe("US")
    expect(body.logoScale).toBe(80)
    // …and the landscape shape retained alongside.
    expect(body.landscape).toMatchObject({ topBadgeScale: 150 })
    // The install converges with the persisted truth: no follow-up PUT.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultBadgeYear).toBe(false)
    expect(result.current.landscape.topBadgeScale).toBe(150)
  })

  it("server ack installs staged defaults while open per-title bare state survives", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    // Bare-only edits never enter the defaults payload (dedup: no PUT); a
    // default edit alongside the bare draft exercises the legacy path once.
    act(() => {
      result.current.update({ topBadgeScale: 200 })
    })
    await settle()
    expect(putBodies).toEqual([])
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    await settle()
    expect(putBodies).toHaveLength(1)
    expect(result.current.topBadgeScale).toBe(200)
    const staged = stagedFrom(result.current, { defaultGradientHeight: 45 })
    await act(async () => {
      await result.current.saveStagedDefaults(staged)
    })
    expect(putBodies).toHaveLength(2)
    // Default installed, live bare draft untouched.
    expect(result.current.defaultBadgeYear).toBe(false)
    expect(result.current.defaultGradientHeight).toBe(45)
    expect(result.current.topBadgeScale).toBe(200)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(putBodies).toHaveLength(2)
  })

  it("rejoining the LAST correction is sent as an explicit null clear with the moved group geometry", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    // Real Settings state after the user moved the quality group and nudged one
    // badge, then rejoined that last badge (the map becomes empty).
    // PUT /api/defaults merges over the stored defaults, so the wire MUST carry
    // `badgeItemTransforms: null`: omitting the key left the old server offsets
    // alive and the Test URL kept the nudge. Group geometry still travels.
    const staged = stagedFrom(result.current, {
      defaultBadgeItemTransforms: null,
      defaultQualityBadgeScale: 80,
      defaultQualityBadgeOffsetX: 21,
      defaultQualityBadgeOffsetY: -13,
      landscape: { ...result.current.landscape, qualityBadgeScale: 120, qualityBadgeOffsetX: -4 },
    })
    let res: unknown
    await act(async () => {
      res = await result.current.saveStagedDefaults(staged)
    })
    expect(res).toMatchObject({ ok: true })
    expect(putBodies).toHaveLength(1)
    const body = putBodies[0] as Record<string, unknown>
    expect(body).toHaveProperty("badgeItemTransforms", null)
    expect(body.qualityBadgeScale).toBe(80)
    expect(body.qualityBadgeOffsetX).toBe(21)
    expect(body.qualityBadgeOffsetY).toBe(-13)
    // The landscape profile keeps its own group geometry (no clobber by the
    // portrait rejoin).
    expect(body.landscape).toMatchObject({ qualityBadgeScale: 120, qualityBadgeOffsetX: -4 })
    // Install converges on the persisted truth: no follow-up PUT resurrects it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultBadgeItemTransforms).toBeNull()
    expect(result.current.defaultQualityBadgeScale).toBe(80)
  })

  it("server failure leaves outer defaults and durable storage exactly as found", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    putImpl = () => ({ ok: false, status: 500 })
    const beforeStorage = storage.getItem("badgeDefaults")
    const staged = stagedFrom(result.current, { defaultBadgeYear: false, defaultGradientHeight: 45 })
    let res = { ok: true }
    await act(async () => {
      res = await result.current.saveStagedDefaults(staged)
    })
    expect(res.ok).toBe(false)
    expect(result.current.defaultBadgeYear).toBe(true)
    expect(result.current.defaultGradientHeight).toBe(30)
    expect(storage.getItem("badgeDefaults")).toBe(beforeStorage)
    expect(result.current.defaultSyncStatus).toBe("failed")
    // No late duplicate from the failed save either.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(putBodies).toHaveLength(1)
  })

  it("identical staged saves each send one PUT (no dedup shortcut)", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let first: unknown
    await act(async () => {
      first = await result.current.saveStagedDefaults(staged)
    })
    expect(first).toMatchObject({ ok: true })
    expect(putBodies).toHaveLength(1)
    // Same payload again is a real second save, not a duplicate shortcut
    // (Save is disabled while clean at the UI layer, so the API never
    // assumes a matching payload needs no PUT).
    let second: unknown
    await act(async () => {
      second = await result.current.saveStagedDefaults(staged)
    })
    expect(second).toMatchObject({ ok: true })
    expect(putBodies).toHaveLength(2)
    expect(result.current.defaultBadgeYear).toBe(false)
  })

  it("guest skip is local success with truthful local-only status and no PUT", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    vi.mocked(shouldSkipServerSync).mockResolvedValue(true)
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let res: unknown
    await act(async () => {
      res = await result.current.saveStagedDefaults(staged)
    })
    expect(res).toMatchObject({ ok: true, localOnly: true })
    expect(putBodies).toEqual([])
    expect(result.current.defaultSyncStatus).toBe("local-only")
    expect(result.current.defaultBadgeYear).toBe(false)
    expect(JSON.parse(storage.getItem("badgeDefaults")!).badgeYear).toBe(false)
  })

  it("device write failure after server ACK reports local-failed and leaves outer state untouched", async () => {
    // No optimistic write exists anymore, so the PUT goes first: the server
    // may hold the update while only the durable write fails, reported
    // truthfully with live state never installed.
    const { result } = renderHook(() => useDefaults())
    await settle()
    failWrites = true
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let res = { ok: true }
    await act(async () => {
      res = await result.current.saveStagedDefaults(staged)
    })
    expect(res).toMatchObject({ ok: false, status: "local-failed", error: "storage" })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultBadgeYear).toBe(true)
    expect(result.current.defaultSyncStatus).toBe("local-failed")
  })

  it("failed save never touches storage; the next save succeeds cleanly", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    const storageBefore = storage.getItem("badgeDefaults")
    putImpl = () => ({ ok: false, status: 500 })
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    await act(async () => {
      await result.current.saveStagedDefaults(staged)
    })
    expect(putBodies).toHaveLength(1)
    // No optimistic write ever happened, so there is nothing to roll back:
    // durable storage is exactly as found.
    expect(storage.getItem("badgeDefaults")).toBe(storageBefore)
    // Server recovers: the untouched truth makes this a real save.
    putImpl = () => ({ ok: true, status: 200 })
    let res = { ok: false }
    await act(async () => {
      res = await result.current.saveStagedDefaults(staged)
    })
    expect(res.ok).toBe(true)
    expect(putBodies).toHaveLength(2)
    expect(result.current.defaultBadgeYear).toBe(false)
    expect(result.current.defaultSyncStatus).toBe("synced")
  })

  it("save while the hydration GET is pending succeeds and survives the late GET", async () => {
    let resolveGet!: (v: unknown) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ...putImpl(), json: async () => ({}) }
        }
        return new Promise((res) => {
          resolveGet = res as (v: unknown) => void
        })
      }),
    )
    const { result } = renderHook(() => useDefaults())
    // Local hydration is mounted (hydrated gate open) while the server GET
    // is still outstanding: the explicit save proceeds like an explicit retry.
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let res = { ok: false }
    await act(async () => {
      res = await result.current.saveStagedDefaults(staged)
    })
    expect(res.ok).toBe(true)
    expect(putBodies).toHaveLength(1)
    // The late GET merges under local precedence: the save is never reset.
    await act(async () => {
      resolveGet({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) })
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(result.current.defaultBadgeYear).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(result.current.defaultBadgeYear).toBe(false)
    expect(putBodies).toHaveLength(1)
  })

  it("concurrent staged save refuses busy; the first save wins alone", async () => {
    // Prior supersede semantics (newest aborts the first) are intentionally
    // replaced: a concurrent staged call refuses busy and never aborts the
    // inflight first save, so an attempted double-submit cannot turn a
    // success into a false pending.
    const resolvers: Array<(v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((res) => {
            resolvers.push(res)
          })
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
      }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    const first = stagedFrom(result.current, { defaultBadgeYear: false })
    const second = stagedFrom(result.current, { defaultBadgeYear: false, defaultGradientHeight: 45 })
    let firstRes: unknown
    let secondRes: unknown
    let p1: Promise<unknown> | null = null
    let p2: Promise<unknown> | null = null
    await act(async () => {
      p1 = result.current.saveStagedDefaults(first)
      p2 = result.current.saveStagedDefaults(second)
      // Flush the async identity guard: the second call refuses busy while
      // the first payload is the only one ever PUT.
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(putBodies).toHaveLength(1)
    expect((putBodies[0] as Record<string, unknown>).gradientHeight).toBe(30)
    await act(async () => {
      secondRes = await p2
    })
    expect(secondRes).toMatchObject({ ok: false, error: "busy" })
    await act(async () => {
      resolvers[0]({ ok: true, status: 200, json: async () => ({}) })
      firstRes = await p1
    })
    expect(firstRes).toMatchObject({ ok: true })
    expect(result.current.defaultBadgeYear).toBe(false)
    expect(result.current.defaultGradientHeight).toBe(30)
    expect(result.current.defaultSyncStatus).toBe("synced")
  })

  it("legacy auto-persist debounce preserved: rapid edits send one deferred PUT", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(putBodies).toEqual([])
    act(() => {
      result.current.update({ defaultBadgeYear: false })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    // Still inside the 500ms debounce: nothing sent yet.
    expect(putBodies).toEqual([])
    act(() => {
      result.current.update({ defaultGradientHeight: 45 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    // Both edits coalesced into a single deferred PUT.
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0] as Record<string, unknown>).toMatchObject({
      badgeYear: false,
      gradientHeight: 45,
    })
  })

  it("hydration GET resolving during a failed save never overwrites state or storage", async () => {
    const getResolvers: Array<(v: unknown) => void> = []
    const putResolvers: Array<(v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((res) => {
            putResolvers.push(res)
          })
        }
        if (!String(_url).includes("/api/defaults")) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
        return new Promise((res) => {
          getResolvers.push(res as (v: unknown) => void)
        })
      }),
    )
    const { result } = renderHook(() => useDefaults())
    const storageBefore = storage.getItem("badgeDefaults")
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let savePromise: Promise<unknown> | null = null
    await act(async () => {
      savePromise = result.current.saveStagedDefaults(staged)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(putBodies).toHaveLength(1)
    // Stale hydration GET lands mid-save: the save invalidated its
    // generation at entry, so it resolves silent.
    await act(async () => {
      getResolvers[0]({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ defaultGradientHeight: 45 }) })
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(result.current.defaultGradientHeight).toBe(30)
    expect(result.current.defaultBadgeYear).toBe(true)
    let res: unknown
    await act(async () => {
      putResolvers[0]({ ok: false, status: 500, json: async () => ({}) })
      res = await savePromise
    })
    expect(res).toMatchObject({ ok: false })
    expect(result.current.defaultBadgeYear).toBe(true)
    expect(result.current.defaultGradientHeight).toBe(30)
    expect(storage.getItem("badgeDefaults")).toBe(storageBefore)
    expect(result.current.defaultSyncStatus).toBe("failed")
  })

  it("namespace switch during the guard aborts with no PUT, write, or install", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    const storageBefore = storage.getItem("badgeDefaults")
    let resolveGuard!: (v: boolean) => void
    vi.mocked(shouldSkipServerSync).mockImplementationOnce(
      () => new Promise<boolean>((res) => { resolveGuard = res }),
    )
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let savePromise: Promise<unknown> | null = null
    await act(async () => {
      savePromise = result.current.saveStagedDefaults(staged)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(putBodies).toEqual([])
    // Profile switch mid-guard: the captured namespace no longer owns state.
    window.history.pushState({}, "", "/u/11111111-1111-4111-8111-111111111111")
    let res: unknown
    await act(async () => {
      resolveGuard(false)
      res = await savePromise
    })
    expect(res).toMatchObject({ ok: false, error: "namespace" })
    expect(putBodies).toEqual([])
    expect(result.current.defaultBadgeYear).toBe(true)
    expect(storage.getItem("badgeDefaults")).toBe(storageBefore)
  })

  it("namespace switch during the PUT ignores the ACK with no write or install", async () => {
    const resolvers: Array<(v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((res) => {
            resolvers.push(res)
          })
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
      }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    const storageBefore = storage.getItem("badgeDefaults")
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let savePromise: Promise<unknown> | null = null
    await act(async () => {
      savePromise = result.current.saveStagedDefaults(staged)
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(putBodies).toHaveLength(1)
    // Profile switch mid-PUT: the ACK belongs to the old namespace.
    window.history.pushState({}, "", "/u/11111111-1111-4111-8111-111111111111")
    let res: unknown
    await act(async () => {
      resolvers[0]({ ok: true, status: 200, json: async () => ({}) })
      res = await savePromise
    })
    expect(res).toMatchObject({ ok: false, error: "namespace" })
    expect(result.current.defaultSyncStatus).not.toBe("synced")
    expect(result.current.defaultBadgeYear).toBe(true)
    expect(storage.getItem("badgeDefaults")).toBe(storageBefore)
  })

  it("absent storage stays absent on server failure", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    putImpl = () => ({ ok: false, status: 500 })
    storage.removeItem("badgeDefaults")
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let res = { ok: true }
    await act(async () => {
      res = await result.current.saveStagedDefaults(staged)
    })
    expect(res.ok).toBe(false)
    expect(storage.getItem("badgeDefaults")).toBeNull()
    expect(result.current.defaultBadgeYear).toBe(true)
  })

  it("noncanonical stored bytes are preserved byte-exact on server failure", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    putImpl = () => ({ ok: false, status: 500 })
    storage.setItem("badgeDefaults", "not-json{")
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let res = { ok: true }
    await act(async () => {
      res = await result.current.saveStagedDefaults(staged)
    })
    expect(res.ok).toBe(false)
    expect(storage.getItem("badgeDefaults")).toBe("not-json{")
    expect(result.current.defaultBadgeYear).toBe(true)
  })

  it("storage failure after server ACK reports local-failed with no install; retry succeeds", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    failWrites = true
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let res = { ok: true, status: "" }
    await act(async () => {
      res = await result.current.saveStagedDefaults(staged) as unknown as typeof res
    })
    // The PUT was sent (the server may hold the update); only the durable
    // write failed, reported truthfully with the draft retained for retry.
    expect(res).toMatchObject({ ok: false, status: "local-failed", error: "storage" })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultBadgeYear).toBe(true)
    expect(result.current.defaultSyncStatus).toBe("local-failed")
    failWrites = false
    let retry = { ok: false }
    await act(async () => {
      retry = await result.current.saveStagedDefaults(staged)
    })
    expect(retry.ok).toBe(true)
    expect(putBodies).toHaveLength(2)
    expect(result.current.defaultBadgeYear).toBe(false)
    expect(result.current.defaultSyncStatus).toBe("synced")
  })

  it("guard rejection at the first await releases the lock; retry succeeds", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    vi.mocked(shouldSkipServerSync).mockRejectedValueOnce(new Error("guard down"))
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let first: unknown
    await act(async () => {
      first = await result.current.saveStagedDefaults(staged)
    })
    expect(first).toMatchObject({ ok: false, status: "failed" })
    expect(putBodies).toEqual([])
    expect(result.current.defaultBadgeYear).toBe(true)
    // Lock released: the retained draft retries cleanly (no busy).
    let second: unknown
    await act(async () => {
      second = await result.current.saveStagedDefaults(staged)
    })
    expect(second).toMatchObject({ ok: true })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultBadgeYear).toBe(false)
  })

  it("guard rejection at the second await (syncSend) releases the lock; retry succeeds", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    // First call (staged entry guard) passes, second call (syncSend guard)
    // rejects: the PUT never goes out but the lock must still release.
    vi.mocked(shouldSkipServerSync)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("guard down"))
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    let first: unknown
    await act(async () => {
      first = await result.current.saveStagedDefaults(staged)
    })
    expect(first).toMatchObject({ ok: false })
    expect(putBodies).toEqual([])
    expect(result.current.defaultBadgeYear).toBe(true)
    let second: unknown
    await act(async () => {
      second = await result.current.saveStagedDefaults(staged)
    })
    expect(second).toMatchObject({ ok: true })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultBadgeYear).toBe(false)
  })

  it("rejected staged PUT + bare update sends no stale old-defaults PUT", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    putImpl = () => ({ ok: false, status: 500 })
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    await act(async () => {
      await result.current.saveStagedDefaults(staged)
    })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultSyncStatus).toBe("failed")
    // Bare per-title draft changes no default payload: with the prior live
    // dedup ref preserved, this must not rewrite old defaults server-side.
    act(() => {
      result.current.update({ topBadgeScale: 200 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(putBodies).toHaveLength(1)
    expect(result.current.topBadgeScale).toBe(200)
    expect(result.current.defaultBadgeYear).toBe(true)
  })

  it("ACK storage failure + bare update sends no old PUT; explicit retry works", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    failWrites = true
    const staged = stagedFrom(result.current, { defaultBadgeYear: false })
    await act(async () => {
      await result.current.saveStagedDefaults(staged)
    })
    expect(putBodies).toHaveLength(1)
    expect(result.current.defaultSyncStatus).toBe("local-failed")
    act(() => {
      result.current.update({ topBadgeScale: 200 })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    // Server may hold the ACK: never overwrite it with old live defaults.
    expect(putBodies).toHaveLength(1)
    expect(result.current.topBadgeScale).toBe(200)
    expect(result.current.defaultBadgeYear).toBe(true)
    // Explicit retained retry still sends the staged payload.
    failWrites = false
    let retry = { ok: false }
    await act(async () => {
      retry = await result.current.saveStagedDefaults(staged)
    })
    expect(retry.ok).toBe(true)
    expect(putBodies).toHaveLength(2)
    expect(result.current.defaultBadgeYear).toBe(false)
  })
})
