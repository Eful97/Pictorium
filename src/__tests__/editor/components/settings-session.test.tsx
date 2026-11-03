/**
 * Phase 1 settings draft session (useSettingsSession, no UI yet):
 * - draft edits (incl. font/age/layout/scope/raw landscape) never write
 *   localStorage, never PUT, never touch live outer state;
 * - atomic global save: exactly one PUT with all default-backed fields +
 *   raw extras/font in both formats (flat + nested landscape);
 * - success stays on the page (draft visible, clean); error retains local
 *   modifications with the outer truth untouched;
 * - functional batching merges back-to-back setter calls;
 * - clean outer hydration rebases; dirty outer change flags a conflict and
 *   keeps the draft; guest/local-storage failures stay truthful.
 */
import type { ReactNode } from "react"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { act, render, renderHook } from "@testing-library/react"
import { PosterEditorProvider, PosterEditorValueOverride, usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { useSettingsSession, type SettingsSessionResult } from "@/components/settings/useSettingsSession"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import type { VisualPresetValues } from "@/lib/visual-presets"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

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

function wrapper({ children }: { children: ReactNode }) {
  return <PosterEditorProvider>{children}</PosterEditorProvider>
}

describe("useSettingsSession draft foundation", () => {
  let putBodies: unknown[]
  let storage: StorageStub
  let putImpl: () => { ok: boolean; status: number }
  let writes: string[]
  let failWrites = false

  beforeEach(() => {
    resetGuestGuardForTests()
    window.history.pushState({}, "", "/")
    storage = createStorageStub()
    writes = []
    failWrites = false
    const origSet = storage.setItem.bind(storage)
    storage.setItem = (k: string, v: string) => {
      if (k === "badgeDefaults") writes.push(String(v))
      if (failWrites && k === "badgeDefaults") throw new Error("quota")
      origSet(k, v)
    }
    vi.stubGlobal("localStorage", storage)
    putBodies = []
    putImpl = () => ({ ok: true, status: 200 })
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

  function editDraft(session: SettingsSessionResult) {
    act(() => {
      session.value.setDefaultBadgeFont("oswald")
      session.value.setDefaultAgeBadge(true)
      session.value.setDefaultAgeCountry("US")
      session.value.setDefaultPosterLayout("fresh")
      // Ranked-only scope: even an explicit "all" write stages as "ranked".
      session.value.setDefaultPosterFreshScope("all")
      session.value.setDefaultRegion("US")
      session.value.setDefaultLogoScale(80)
      session.value.setLandscape({ topBadgeScale: 150 })
    })
  }

  it("draft edits never write localStorage, PUT, or live outer state", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    expect(result.current.dirty).toBe(false)
    writes.length = 0
    const outerBefore = {
      font: result.current.value.defaultBadgeFont,
      age: result.current.value.defaultAgeBadge,
      layout: result.current.value.defaultPosterLayout,
    }
    editDraft(result.current)
    // Session shows the draft (scope coerced ranked-only)…
    expect(result.current.value.defaultBadgeFont).toBe("oswald")
    expect(result.current.value.defaultAgeBadge).toBe(true)
    expect(result.current.value.defaultPosterLayout).toBe("fresh")
    expect(result.current.value.defaultPosterFreshScope).toBe("ranked")
    expect(result.current.value.landscape.topBadgeScale).toBe(150)
    expect(result.current.dirty).toBe(true)
    // …but nothing leaked: no durable write, no PUT even after the debounce.
    await settle()
    expect(writes).toEqual([])
    expect(putBodies).toEqual([])
    expect(outerBefore).toEqual({ font: "inter", age: false, layout: "standard" })
  })

  it("override provider previews the draft while the outer truth stays live", async () => {
    let outerSeen: PosterEditorCtx | null = null
    let draftSeen: PosterEditorCtx | null = null
    function OuterProbe() {
      outerSeen = usePosterEditor()
      return null
    }
    function DraftProbe() {
      draftSeen = usePosterEditor()
      return null
    }
    function SessionBridge({ children }: { children: ReactNode }) {
      const session = useSettingsSession()
      ;(SessionBridge as unknown as { session?: SettingsSessionResult }).session = session
      return (
        <PosterEditorValueOverride value={session.value}>{children}</PosterEditorValueOverride>
      )
    }
    render(
      <PosterEditorProvider>
        <OuterProbe />
        <SessionBridge>
          <DraftProbe />
        </SessionBridge>
      </PosterEditorProvider>,
    )
    await settle()
    const bridge = SessionBridge as unknown as { session?: SettingsSessionResult }
    act(() => {
      bridge.session!.value.setDefaultBadgeYear(false)
    })
    // Value-only override: draft visible inside, outer untouched outside.
    expect(draftSeen!.defaultBadgeYear).toBe(false)
    expect(outerSeen!.defaultBadgeYear).toBe(true)
    expect(putBodies).toEqual([])
  })

  it("rotation-scope toggle stays a local draft edit (no phantom conflict)", async () => {
    // Regression: the automation toggles live in PrefsPanel inside the staged
    // session override. A defaults setter missing from the session-local set
    // falls through to the OUTER provider, writing live truth under the draft
    // and flagging the "settings changed elsewhere" banner on a purely local
    // edit. The rotation scope (Solo clean / Clean+lingua) must behave like
    // every other default toggle.
    let outerSeen: PosterEditorCtx | null = null
    let draftSeen: PosterEditorCtx | null = null
    function OuterProbe() {
      outerSeen = usePosterEditor()
      return null
    }
    function SessionBridge({ children }: { children: ReactNode }) {
      const session = useSettingsSession()
      ;(SessionBridge as unknown as { session?: SettingsSessionResult }).session = session
      return <PosterEditorValueOverride value={session.value}>{children}</PosterEditorValueOverride>
    }
    function DraftProbe() {
      draftSeen = usePosterEditor()
      return null
    }
    render(
      <PosterEditorProvider>
        <OuterProbe />
        <SessionBridge>
          <DraftProbe />
        </SessionBridge>
      </PosterEditorProvider>,
    )
    await settle()
    const bridge = SessionBridge as unknown as { session?: SettingsSessionResult }
    // A real local edit first: the reported flow has a draft in progress.
    act(() => {
      bridge.session!.value.setDefaultBadgeYear(false)
      bridge.session!.value.setDefaultAutoRotateClean(true)
      draftSeen!.setDefaultRotationIncludeNonClean(true)
    })
    await settle()
    expect(draftSeen!.defaultRotationIncludeNonClean).toBe(true)
    expect(bridge.session!.value.defaultRotationIncludeNonClean).toBe(true)
    // Local only: outer truth untouched, no phantom conflict, no live PUT.
    expect(outerSeen!.defaultRotationIncludeNonClean).toBe(false)
    expect(bridge.session!.dirty).toBe(true)
    expect(bridge.session!.conflict).toBe(false)
    expect(putBodies).toEqual([])
    // Rapid rotation ON->OFF->ON keeps the scope value (hidden, never lost).
    act(() => {
      bridge.session!.value.setDefaultAutoRotateClean(false)
      bridge.session!.value.setDefaultAutoRotateClean(true)
    })
    expect(bridge.session!.value.defaultRotationIncludeNonClean).toBe(true)
    expect(bridge.session!.conflict).toBe(false)
  })

  it("atomic save: one PUT with every default-backed field in both formats, then quiet", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    writes.length = 0
    editDraft(result.current)
    let res: unknown
    await act(async () => {
      res = await result.current.save()
    })
    expect(res).toMatchObject({ ok: true })
    expect(putBodies).toHaveLength(1)
    const body = putBodies[0] as Record<string, unknown>
    // Flat format: font/age/layout/scope/region/logo…
    expect(body.badgeFont).toBe("oswald")
    expect(body.ageBadge).toBe(true)
    expect(body.ageCountry).toBe("US")
    expect(body.posterLayout).toBe("fresh")
    expect(body.posterFreshScope).toBe("ranked")
    expect(body.region).toBe("US")
    expect(body.logoScale).toBe(80)
    // …and the landscape shape retained alongside (flat rank untouched).
    expect(body.landscape).toMatchObject({ topBadgeScale: 150 })
    expect(body.topBadgeScale).toBe(100)
    // Success stays on the page: draft visible, clean, outer converged.
    expect(result.current.value.defaultBadgeFont).toBe("oswald")
    expect(result.current.dirty).toBe(false)
    expect(result.current.conflict).toBe(false)
    await settle()
    expect(putBodies).toHaveLength(1)
  })

  it("functional batching merges back-to-back setter calls into the single PUT", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    act(() => {
      result.current.value.setDefaultGradientHeight(40)
      result.current.value.setDefaultGradientHeight((prev) => prev + 5)
      result.current.value.setDefaultBadgeYear(false)
      result.current.value.setLandscape({ blurFade: 70 })
      result.current.value.setLandscape({ topBadgeScale: 150 })
    })
    expect(result.current.value.defaultGradientHeight).toBe(45)
    expect(result.current.value.landscape).toMatchObject({ blurFade: 70, topBadgeScale: 150 })
    await act(async () => {
      await result.current.save()
    })
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0] as Record<string, unknown>).toMatchObject({
      gradientHeight: 45,
      badgeYear: false,
      landscape: { blurFade: 70, topBadgeScale: 150 },
    })
  })

  it("server error retains local modifications and leaves outer truth + storage intact", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    editDraft(result.current)
    const storageBefore = storage.getItem("badgeDefaults")
    putImpl = () => ({ ok: false, status: 500 })
    let res = { ok: true }
    await act(async () => {
      res = await result.current.save()
    })
    expect(res.ok).toBe(false)
    // Draft retained, still dirty, error exposed…
    expect(result.current.value.defaultBadgeFont).toBe("oswald")
    expect(result.current.value.landscape.topBadgeScale).toBe(150)
    expect(result.current.dirty).toBe(true)
    expect(result.current.result?.ok).toBe(false)
    // …outer truth and durable storage exactly as found.
    expect(result.current.value.defaultBadgeYear).toBe(true)
    expect(storage.getItem("badgeDefaults")).toBe(storageBefore)
    await settle()
    expect(putBodies).toHaveLength(1)
  })

  it("rank edit materializes the following extra; legacy preset apply clears the target extra", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    // Rank-only edit freezes the previous independent extra (rank 100/0/0).
    act(() => {
      result.current.value.setDefaultTopBadgeScale(150)
    })
    expect(result.current.value.defaultTopBadgeScale).toBe(150)
    expect(result.current.value.defaultExtraBadgeScale).toBe(100)
    expect(result.current.value.defaultExtraBadgeOffsetX).toBe(0)
    expect(result.current.value.defaultExtraBadgeOffsetY).toBe(0)
    expect(result.current.dirty).toBe(true)
    expect(putBodies).toEqual([])
    // Legacy full-look preset without extra clears the TARGET extra to null.
    act(() => {
      result.current.value.applyVisualPreset(
        { defaultTopBadgeScale: 140, defaultTopBadgeOffsetX: 5, defaultTopBadgeOffsetY: 6 } as unknown as VisualPresetValues,
        "portrait",
      )
    })
    expect(result.current.value.defaultTopBadgeScale).toBe(140)
    expect(result.current.value.defaultExtraBadgeScale).toBeNull()
    expect(result.current.value.defaultExtraBadgeOffsetX).toBeNull()
    expect(result.current.value.defaultExtraBadgeOffsetY).toBeNull()
  })

  it("flat edit snapshots the inherited landscape key (shape isolation)", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    // Sparse profile: gradientHeight still inherits the flat (30).
    expect(result.current.value.landscape.gradientHeight).toBeUndefined()
    act(() => {
      result.current.value.setDefaultGradientHeight(45)
    })
    // Pre-edit effective value frozen — later flat edits cannot leak across.
    expect(result.current.value.defaultGradientHeight).toBe(45)
    expect(result.current.value.landscape.gradientHeight).toBe(30)
    expect(putBodies).toEqual([])
  })

  it("clean outer hydration rebases; dirty outer change flags conflict and keeps the draft", async () => {
    let resolveGet!: (v: unknown) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ...putImpl(), json: async () => ({}) }
        }
        if (!String(_url).includes("/api/defaults")) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
        return new Promise((res) => {
          resolveGet = res as (v: unknown) => void
        })
      }),
    )
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    // Clean rebase: server truth adopted, still clean, no conflict.
    await act(async () => {
      resolveGet({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ defaultGradientHeight: 45 }) })
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(result.current.value.defaultGradientHeight).toBe(45)
    expect(result.current.dirty).toBe(false)
    expect(result.current.conflict).toBe(false)
    expect(putBodies).toEqual([])
  })

  it("dirty outer live change flags conflict and keeps the draft; discard recovers", async () => {
    let outerSeen: PosterEditorCtx | null = null
    function OuterProbe() {
      outerSeen = usePosterEditor()
      return null
    }
    function SessionProbe() {
      const session = useSettingsSession()
      ;(SessionProbe as unknown as { session?: SettingsSessionResult }).session = session
      return null
    }
    render(
      <PosterEditorProvider>
        <OuterProbe />
        <SessionProbe />
      </PosterEditorProvider>,
    )
    await settle()
    const probe = SessionProbe as unknown as { session?: SettingsSessionResult }
    act(() => {
      probe.session!.value.setDefaultBadgeYear(false)
    })
    expect(probe.session!.dirty).toBe(true)
    // Outer live change underneath the dirty draft (legacy auto-persist path).
    act(() => {
      outerSeen!.setDefaultBlurIntensity(9)
    })
    await settle()
    expect(probe.session!.conflict).toBe(true)
    expect(probe.session!.value.defaultBadgeYear).toBe(false)
    expect(probe.session!.dirty).toBe(true)
    // Discard drops the draft and converges on the outer truth.
    act(() => {
      probe.session!.discard()
    })
    expect(probe.session!.conflict).toBe(false)
    expect(probe.session!.dirty).toBe(false)
    expect(probe.session!.value.defaultBadgeYear).toBe(true)
    expect(probe.session!.value.defaultBlurIntensity).toBe(9)
  })

  it("guest save is local success with truthful local-only status and no PUT", async () => {
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    vi.mocked(shouldSkipServerSync).mockResolvedValue(true)
    editDraft(result.current)
    let res: unknown
    await act(async () => {
      res = await result.current.save()
    })
    expect(res).toMatchObject({ ok: true, localOnly: true })
    expect(putBodies).toEqual([])
    expect(result.current.dirty).toBe(false)
    expect(JSON.parse(storage.getItem("badgeDefaults")!).badgeFont).toBe("oswald")
  })

  it("device write failure after server ACK keeps the draft dirty with the outer truth untouched", async () => {
    // No optimistic write exists anymore: the PUT goes first and only the
    // post-ACK durable write can fail here, reported truthfully while the
    // draft stays dirty and the outer truth is never installed.
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    editDraft(result.current)
    failWrites = true
    let res = { ok: true }
    await act(async () => {
      res = await result.current.save()
    })
    expect(res.ok).toBe(false)
    expect(putBodies).toHaveLength(1)
    expect(result.current.dirty).toBe(true)
    expect(result.current.value.defaultBadgeFont).toBe("oswald")
    expect(result.current.value.defaultBadgeYear).toBe(true)
  })

  it("writes during an inflight save are frozen; only pre-save edits persist", async () => {
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
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    act(() => {
      result.current.value.setDefaultBadgeYear(false)
    })
    let savePromise: Promise<unknown> | null = null
    await act(async () => {
      savePromise = result.current.save()
      // Flush the async identity guard so the single PUT is inflight.
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.saving).toBe(true)
    expect(putBodies).toHaveLength(1)
    // Frozen mid-save: ignored, never staged.
    act(() => {
      result.current.value.setDefaultGradientHeight(45)
    })
    expect(result.current.value.defaultGradientHeight).toBe(30)
    await act(async () => {
      resolvers[0]({ ok: true, status: 200, json: async () => ({}) })
      await savePromise
    })
    expect(result.current.saving).toBe(false)
    expect(result.current.dirty).toBe(false)
    expect((putBodies[0] as Record<string, unknown>).gradientHeight).toBe(30)
    expect((putBodies[0] as Record<string, unknown>).badgeYear).toBe(false)
  })

  it("save under a dirty conflict refuses before any PUT and retains the draft", async () => {
    let outerSeen: PosterEditorCtx | null = null
    function OuterProbe() {
      outerSeen = usePosterEditor()
      return null
    }
    function SessionProbe() {
      const session = useSettingsSession()
      ;(SessionProbe as unknown as { session?: SettingsSessionResult }).session = session
      return null
    }
    render(
      <PosterEditorProvider>
        <OuterProbe />
        <SessionProbe />
      </PosterEditorProvider>,
    )
    await settle()
    const probe = SessionProbe as unknown as { session?: SettingsSessionResult }
    act(() => {
      probe.session!.value.setDefaultBadgeYear(false)
    })
    expect(probe.session!.dirty).toBe(true)
    // Outer live change underneath the dirty draft (legacy auto-persist path).
    act(() => {
      outerSeen!.setDefaultBlurIntensity(9)
    })
    await settle()
    expect(probe.session!.conflict).toBe(true)
    const putsAfterOuter = putBodies.length
    expect(putsAfterOuter).toBeGreaterThan(0)
    // The save refuses synchronously: no PUT, draft retained and dirty.
    let res: unknown
    await act(async () => {
      res = await probe.session!.save()
    })
    expect(res).toMatchObject({ ok: false, error: "conflict" })
    expect(putBodies).toHaveLength(putsAfterOuter)
    expect(probe.session!.dirty).toBe(true)
    expect(probe.session!.value.defaultBadgeYear).toBe(false)
  })

  it("save after a namespace switch refuses with namespace error and rebases", async () => {
    // The save refuses synchronously (no cross-namespace PUT), then the
    // pre-existing identity guard rebases the session onto the new
    // profile's truth — an old-profile draft must never persist under a
    // new namespace, so clean rebase (not dirty retention) is correct here.
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    act(() => {
      result.current.value.setDefaultBadgeYear(false)
    })
    expect(result.current.dirty).toBe(true)
    // Profile switch before save: path identity no longer matches.
    window.history.pushState({}, "", "/u/11111111-1111-4111-8111-111111111111")
    let res: unknown
    await act(async () => {
      res = await result.current.save()
    })
    expect(res).toMatchObject({ ok: false, error: "namespace" })
    expect(putBodies).toEqual([])
    expect(result.current.dirty).toBe(false)
    expect(result.current.value.defaultBadgeYear).toBe(true)
  })

  it("concurrent save while inflight returns busy with a single PUT", async () => {
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
    const { result } = renderHook(() => useSettingsSession(), { wrapper })
    await settle()
    act(() => {
      result.current.value.setDefaultBadgeYear(false)
    })
    let first: Promise<unknown> | null = null
    await act(async () => {
      first = result.current.save()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(putBodies).toHaveLength(1)
    let busyRes: unknown
    await act(async () => {
      busyRes = await result.current.save()
    })
    expect(busyRes).toMatchObject({ ok: false, error: "busy" })
    expect(putBodies).toHaveLength(1)
    let firstRes: unknown
    await act(async () => {
      resolvers[0]({ ok: true, status: 200, json: async () => ({}) })
      firstRes = await first
    })
    expect(firstRes).toMatchObject({ ok: true })
    expect(result.current.dirty).toBe(false)
  })
})
