/**
 * Task 3B1: strict independence foundation for ALL shape-supported visual
 * defaults (styles/toggles/fonts/layout/formats/sash/network/pre/ribbon/age
 * + numeric scale/offset/blur/tint/gradient).
 *
 * Contract:
 * - absent landscape keys follow the portrait EFFECTIVE value at rest
 *   (legacy appearance byte-identical until an edit);
 * - the FIRST portrait edit atomically snapshots the pre-edit value into the
 *   profile (client `update`, editor setters, manual save payload, debounced
 *   PUT, server PUT backfill incl. scoped namespaces + env defaults);
 * - never reseeded/rebased after an edit (storage, hydration, unlock);
 * - resets restore independent shape-appropriate defaults (never
 *   clear-to-follow);
 * - explicit `false`/`0`/`[]` and logo/extra `null`s are real values and
 *   survive; arrays snapshot by copy (no aliasing).
 * Out of scope (still global by design, reported in the 3B2 inventory):
 * rating sources, region, date format, endpoints, delivery shape, fit flags
 * and minQuality (server profile key exists, no UI — never invented here).
 * followTitle was already wired per shape (Transform portrait flat +
 * Orizzontale profile freeze) — verified, not built.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, fireEvent, within } from "@testing-library/react"
import { createElement } from "react"
import type { NextRequest } from "next/server"
import { renderHook } from "@testing-library/react"
import { useDefaults, defaultsStorageKey } from "@/lib/useDefaults"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { USER_UNLOCK_EVENT } from "@/lib/user-token"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { saveDefaults } from "@/lib/save-defaults"
import { effectiveDefaultsForShape } from "@/lib/server-defaults"
import {
  SHAPE_FLAT_TO_LANDSCAPE,
  SHAPE_BARE_TO_LANDSCAPE,
  SHAPE_NULL_INHERIT_KEYS,
  canonicalInheritFreeze,
  isLandscapeKeyPresent,
  snapshotMissingLandscape,
  independentLandscapeDefaults,
} from "@/lib/visual-presets"
import { createWrapper, renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/guest-guard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guest-guard")>()
  return { ...mod, shouldSkipServerSync: vi.fn(async () => false) }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-shape-foundation-test`,
}))

vi.mock("@/lib/user-auth", () => ({
  checkUserAuth: vi.fn(async () => true),
  getScopedUserId: vi.fn((raw: string | null) => raw),
  extractUserParam: vi.fn((req: Request) => new URL(req.url).searchParams.get("u")),
  invalidUserResponse: () => new Response("bad user", { status: 400 }),
  isMultiUserEnabled: () => true,
  userAuthResponse: () => new Response("auth", { status: 401 }),
  userRateLimitKey: (req: Request) => `test:${req.url}`,
}))

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

const TEST_UUID = "11111111-1111-4111-8111-111111111111"

describe("shape key inventory (canonical map)", () => {
  it("covers every visual family and stays out of globals", () => {
    const lands = new Set(Object.values(SHAPE_FLAT_TO_LANDSCAPE))
    for (const k of [
      "badgeStyle", "rankingBadgeStyle", "extraBadgeStyle", "badgeFont",
      "qualityBadgeStyle", "videoFormats", "globalBadges", "rankingBadges",
      "badgeGenre", "badgeYear", "badgeRating", "badgeQuality", "ageBadge",
      "ageCountry", "ageBadgeStyle", "customRatings", "separateRatings",
      "separateRatingsStyle", "posterLayout", "posterFreshScope", "sashOrder",
      "networkLogo", "networkLogoPosition", "networkLogoFollowTitle",
      "logoAlign",
      "preRelease", "ribbonSide", "ribbonEnabled",
      "gradientHeight", "blurEnabled", "blurIntensity", "blurFade",
      "blurDarkness", "tintStrength", "topShade", "logoScale", "logoOffsetX",
      "logoOffsetY", "topBadgeScale", "topBadgeOffsetX", "topBadgeOffsetY",
      "extraBadgeScale", "extraBadgeOffsetX", "extraBadgeOffsetY",
      "genreBadgeScale", "genreBadgeOffsetX", "genreBadgeOffsetY",
      "qualityBadgeScale", "qualityBadgeOffsetX", "qualityBadgeOffsetY",
      "separateBadgeScale", "separateBadgeOffsetX", "separateBadgeOffsetY",
      "networkLogoScale", "networkLogoOffsetX", "networkLogoOffsetY",
    ]) {
      expect(lands, `missing ${k}`).toContain(k)
    }
    // Global-only by design: no profile counterpart here (minQuality keeps
    // its server profile key with no UI and no snapshot — never claimed).
    for (const k of ["ratingSources", "region", "minQuality"]) {
      expect(lands, `must stay global: ${k}`).not.toContain(k)
    }
    expect(SHAPE_BARE_TO_LANDSCAPE.logoAlign).toBe("logoAlign")
    // Bare map mirrors the flat map one-to-one.
    expect(Object.keys(SHAPE_BARE_TO_LANDSCAPE)).toHaveLength(
      Object.keys(SHAPE_FLAT_TO_LANDSCAPE).length,
    )
    expect(SHAPE_BARE_TO_LANDSCAPE.badgeStyle).toBe("badgeStyle")
    expect(SHAPE_BARE_TO_LANDSCAPE.ageBadge).toBe("ageBadge")
  })

  it("presence keeps false/0/[] and logo/extra nulls; inherit nulls follow", () => {
    expect(isLandscapeKeyPresent({ globalBadges: false }, "globalBadges")).toBe(true)
    expect(isLandscapeKeyPresent({ topBadgeOffsetX: 0 }, "topBadgeOffsetX")).toBe(true)
    expect(isLandscapeKeyPresent({ sashOrder: [] }, "sashOrder")).toBe(true)
    expect(isLandscapeKeyPresent({ logoScale: null }, "logoScale")).toBe(true)
    expect(isLandscapeKeyPresent({ logoOffsetX: null }, "logoOffsetX")).toBe(true)
    expect(isLandscapeKeyPresent({ extraBadgeScale: null }, "extraBadgeScale")).toBe(true)
    // Explicit "follow-rank" sentinel is the shape-local "follow my own rank"
    // marker — present, never re-frozen, never falling through to the
    // portrait flat. Legacy profile `null` inherits the flat (old contract).
    expect(isLandscapeKeyPresent({ extraBadgeStyle: "follow-rank" }, "extraBadgeStyle")).toBe(true)
    expect(isLandscapeKeyPresent({ extraBadgeStyle: null }, "extraBadgeStyle")).toBe(false)
    expect(isLandscapeKeyPresent({ extraBadgeStyle: "pill" }, "extraBadgeStyle")).toBe(true)
    // Recovery 3B1: a profile `null` on inherit keys is NOT an explicit
    // choice — every render chain (`??` in poster-url/poster-config, route
    // `??`, network-follow merges) normalizes it to "follow the flat", so it
    // counts as missing and the independence boundary freezes the pre-edit
    // effective value into it. Treating it as explicit was the leak: later
    // portrait edits kept moving the landscape.
    for (const k of SHAPE_NULL_INHERIT_KEYS) {
      expect(isLandscapeKeyPresent({ [k]: null }, k), `${k} null inherits`).toBe(false)
    }
    // Any other `null` is an explicit shape-local stored marker (logo
    // auto/zero, extra own-rank): never treated as missing, never frozen.
    expect(isLandscapeKeyPresent({ ageBadge: null }, "ageBadge")).toBe(true)
    expect(isLandscapeKeyPresent({ ageCountry: "GLOBAL" }, "ageCountry")).toBe(false)
    expect(isLandscapeKeyPresent({ ageCountry: "US" }, "ageCountry")).toBe(true)
    expect(isLandscapeKeyPresent({ ageBadgeStyle: "garbage" }, "ageBadgeStyle")).toBe(false)
  })

  it("snapshot copies values, clones arrays, skips fixed-flat absolutes", () => {
    const src = ["rank", "new"]
    const adds = snapshotMissingLandscape(
      {
        defaultGlobalBadges: false,
        defaultSashOrder: src,
        defaultNetworkLogoFollowTitle: false,
        defaultNetworkLogoOffsetX: 200,
        defaultTopBadgeScale: 150,
      },
      { globalBadges: true },
      ["defaultGlobalBadges", "defaultSashOrder", "defaultNetworkLogoOffsetX", "defaultTopBadgeScale", "defaultBadgeStyle"],
    )
    expect(Object.keys(adds).sort()).toEqual(["sashOrder", "topBadgeScale"])
    expect(JSON.stringify(adds.sashOrder)).toBe('["rank","new"]')
    expect(adds.topBadgeScale).toBe(150)
    // Array snapshot is a copy, never an alias of the live flat: mutating
    // the source after the snapshot leaves the frozen value intact.
    src.push("extra")
    expect(JSON.stringify(adds.sashOrder)).toBe('["rank","new"]')
  })

  it("canonicalInheritFreeze mirrors the renderer chains (no invented defaults)", () => {
    // Concrete flats freeze exact (pixel-identical by construction).
    expect(canonicalInheritFreeze("badgeFont", "oswald")).toEqual({ freeze: true, value: "oswald" })
    expect(canonicalInheritFreeze("qualityBadgeStyle", "color")).toEqual({ freeze: true, value: "color" })
    expect(canonicalInheritFreeze("networkLogoFollowTitle", false)).toEqual({ freeze: true, value: false })
    expect(canonicalInheritFreeze("ageBadgeStyle", "knockout")).toEqual({ freeze: true, value: "knockout" })
    expect(canonicalInheritFreeze("extraBadgeStyle", "pill")).toEqual({ freeze: true, value: "pill" })
    // Raw null/absent/garbage freeze the canonical historic default each
    // render chain falls back to (poster-config fail-closed, resolver
    // `?? true`, route allow-all): exactly what the pre-edit pixels show.
    for (const raw of [null, undefined, "garbage", 42]) {
      expect(canonicalInheritFreeze("badgeFont", raw)).toEqual({ freeze: true, value: "inter" })
      expect(canonicalInheritFreeze("qualityBadgeStyle", raw)).toEqual({ freeze: true, value: "standard" })
      expect(canonicalInheritFreeze("ageBadgeStyle", raw)).toEqual({ freeze: true, value: "standard" })
      expect(canonicalInheritFreeze("networkLogoFollowTitle", raw)).toEqual({ freeze: true, value: true })
    }
    expect(canonicalInheritFreeze("videoFormats", null)).toEqual({
      freeze: true, value: ["dv", "hdr", "hdr10plus", "atmos", "imax"],
    })
    expect(canonicalInheritFreeze("videoFormats", undefined)).toEqual({
      freeze: true, value: ["dv", "hdr", "hdr10plus", "atmos", "imax"],
    })
    // Arrays freeze sanitized (same filter as hydration): explicit [] (all
    // off) survives as [], garbage tokens drop.
    expect(canonicalInheritFreeze("videoFormats", [])).toEqual({ freeze: true, value: [] })
    expect(canonicalInheritFreeze("videoFormats", ["dv", "xx"])).toEqual({ freeze: true, value: ["dv"] })
    // Extra-style legacy fallback freezes the explicit "follow-rank"
    // sentinel (follow own rank — pixel-identical today, since the flat is
    // legacy too — and leak-proof later). A `corner` materialization would
    // change number-ribbon pixels (extra-badge-style.test.ts: legacy extra
    // with rs=number renders the numeral, not the corner pill), so the
    // sentinel — not a mapped style — is the only pixel-safe freeze.
    expect(canonicalInheritFreeze("extraBadgeStyle", null)).toEqual({ freeze: true, value: "follow-rank" })
    expect(canonicalInheritFreeze("extraBadgeStyle", undefined)).toEqual({ freeze: true, value: "follow-rank" })
    expect(canonicalInheritFreeze("extraBadgeStyle", "garbage")).toEqual({ freeze: true, value: "follow-rank" })
    expect(canonicalInheritFreeze("extraBadgeStyle", "follow-rank")).toEqual({ freeze: true, value: "follow-rank" })
    // Logo alignment freezes verbatim, else the landscape auto ("left" =
    // exactly what a null flat renders on the horizontal canvas).
    expect(canonicalInheritFreeze("logoAlign", "center")).toEqual({ freeze: true, value: "center" })
    expect(canonicalInheritFreeze("logoAlign", "left")).toEqual({ freeze: true, value: "left" })
    for (const raw of [null, undefined, "garbage", 42]) {
      expect(canonicalInheritFreeze("logoAlign", raw)).toEqual({ freeze: true, value: "left" })
    }
    expect(canonicalInheritFreeze("badgeStyle", "pill")).toEqual({ freeze: false })
  })

  it("snapshot freezes inherit-null profiles AND null flats to canonical; logo nulls stay explicit, extra follow-rank stays", () => {
    const adds = snapshotMissingLandscape(
      {
        defaultBadgeFont: "oswald",
        defaultQualityBadgeStyle: null,
        defaultVideoFormats: null,
        defaultNetworkLogoFollowTitle: null,
        defaultAgeBadgeStyle: null,
        defaultExtraBadgeStyle: null,
        defaultLogoScale: null,
        defaultTopBadgeScale: 150,
      },
      {
        badgeFont: null,
        qualityBadgeStyle: null,
        videoFormats: null,
        networkLogoFollowTitle: null,
        ageBadgeStyle: null,
        extraBadgeStyle: null,
        logoScale: null,
      },
      [
        "defaultBadgeFont", "defaultQualityBadgeStyle", "defaultVideoFormats",
        "defaultNetworkLogoFollowTitle", "defaultAgeBadgeStyle", "defaultExtraBadgeStyle",
        "defaultLogoScale", "defaultTopBadgeScale",
      ],
    )
    // Inherit-null profiles freeze the pre-edit effective: concrete flat
    // where present, canonical historic default where the flat is raw null.
    expect(adds.badgeFont).toBe("oswald")
    expect(adds.qualityBadgeStyle).toBe("standard")
    expect(adds.videoFormats).toEqual(["dv", "hdr", "hdr10plus", "atmos", "imax"])
    expect(adds.networkLogoFollowTitle).toBe(true)
    expect(adds.ageBadgeStyle).toBe("standard")
    // Extra legacy null profile inherits (missing), so it freezes the
    // canonical follow-rank sentinel for the legacy flat (leak-proof);
    // an owned follow-rank sentinel is never re-frozen (see below). Logo
    // nulls stay explicit (already present, never frozen); concrete
    // non-inherit values freeze exact as before.
    expect(adds.extraBadgeStyle).toBe("follow-rank")
    expect("logoScale" in adds).toBe(false)
    expect(adds.topBadgeScale).toBe(150)
    const owned = snapshotMissingLandscape(
      { defaultExtraBadgeStyle: "pill" },
      { extraBadgeStyle: "follow-rank" },
      ["defaultExtraBadgeStyle"],
    )
    expect("extraBadgeStyle" in owned).toBe(false)
  })

  it("independentLandscapeDefaults: canonical quality 0/0 + age trio, rest copied", () => {
    const full = independentLandscapeDefaults({
      defaultBadgeStyle: "pill",
      defaultGlobalBadges: false,
      defaultQualityBadgeOffsetX: -10,
      defaultGradientHeight: 45,
      defaultAgeBadge: true,
      defaultSashOrder: ["rank"],
      defaultLogoScale: null,
      defaultExtraBadgeScale: null,
    })
    expect(full.qualityBadgeOffsetX).toBe(0)
    expect(full.qualityBadgeOffsetY).toBe(0)
    expect(full.ageBadge).toBe(false)
    expect(full.ageCountry).toBe("IT")
    expect(full.ageBadgeStyle).toBe("standard")
    expect(full.badgeStyle).toBe("pill")
    expect(full.globalBadges).toBe(false)
    expect(full.gradientHeight).toBe(45)
    expect(full.logoScale).toBeNull()
    expect(full.extraBadgeScale).toBeNull()
    expect(full.sashOrder).toEqual(["rank"])
  })
})

describe("useDefaults shape independence (hook)", () => {
  let putBodies: Record<string, unknown>[]
  let storage: StorageStub

  beforeEach(() => {
    storage = createStorageStub()
    vi.stubGlobal("localStorage", storage)
    putBodies = []
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        if (init?.method === "PUT") {
          putBodies.push(JSON.parse(init.body as string))
          return { ok: true, status: 200, json: async () => ({}) }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )
    vi.mocked(shouldSkipServerSync).mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function settle(ms = 1200) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it("new users start fully independent (flat look frozen per shape)", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultBadgeStyle).toBe("shadow")
    expect(result.current.landscape.badgeStyle).toBe("shadow")
    expect(result.current.landscape.globalBadges).toBe(true)
    expect(result.current.landscape.posterLayout).toBe("standard")
    expect(result.current.landscape.sashOrder).toEqual(result.current.defaultSashOrder)
    expect(result.current.landscape.qualityBadgeOffsetX).toBe(0)
    expect(result.current.landscape.qualityBadgeOffsetY).toBe(0)
    expect(result.current.landscape.ageBadge).toBe(false)
  })

  it("legacy sparse profile follows at rest, snapshots pre-edit on portrait edit", async () => {
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({ badgeStyle: "pill", topBadgeScale: 150, landscape: {} }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultBadgeStyle).toBe("pill")
    // At rest the effective landscape still follows (appearance preserved).
    expect(result.current.landscape.badgeStyle).toBeUndefined()
    expect(
      (result.current.landscape.badgeStyle ?? result.current.defaultBadgeStyle),
    ).toBe("pill")
    expect(
      effectiveDefaultsForShape(
        { badgeStyle: "pill", landscape: {} } as never,
        "landscape",
      ).badgeStyle,
    ).toBe("pill")

    act(() => {
      result.current.update({ defaultBadgeStyle: "minimal", defaultTopBadgeScale: 120 })
    })
    // Pre-edit values frozen; new flats do not leak across.
    expect(result.current.defaultBadgeStyle).toBe("minimal")
    expect(result.current.landscape.badgeStyle).toBe("pill")
    expect(result.current.landscape.topBadgeScale).toBe(150)

    act(() => {
      result.current.update({ defaultBadgeStyle: "bar" })
    })
    expect(result.current.landscape.badgeStyle).toBe("pill")
  })

  it("bidirectional: booleans, fonts, layout/scope, numerics, arrays, age", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({
        defaultGlobalBadges: false,
        defaultBadgeFont: "oswald",
        defaultPosterLayout: "fresh",
        defaultPosterFreshScope: "all",
        defaultSeparateBadgeScale: 100,
        defaultGradientHeight: 45,
        defaultBlurFade: 60,
        defaultTintStrength: 33,
        defaultNetworkLogoScale: 80,
        defaultSashOrder: ["rank"],
        defaultVideoFormats: ["dv"],
        defaultAgeBadge: true,
      })
    })
    const land = result.current.landscape as unknown as Record<string, unknown>
    expect(land.globalBadges).toBe(true)
    expect(land.badgeFont).toBe("inter")
    expect(land.posterLayout).toBe("standard")
    expect(land.posterFreshScope).toBe("ranked")
    expect(land.separateBadgeScale).toBe(130)
    expect(land.gradientHeight).toBe(30)
    expect(land.blurFade).toBe(50)
    expect(land.tintStrength).toBe(20)
    expect(land.networkLogoScale).toBe(100)
    expect(land.sashOrder).toEqual(["upcoming", "rank", "new", "award", "extra"])
    expect(land.videoFormats).toEqual(["dv", "hdr", "hdr10plus", "atmos", "imax"])
    expect(land.ageBadge).toBe(false)
    // Flats carry the new values.
    expect(result.current.defaultGlobalBadges).toBe(false)
    expect(result.current.defaultSashOrder).toEqual(["rank"])

    // Landscape edits never touch the flats.
    act(() => {
      result.current.update({
        landscape: { ...result.current.landscape, globalBadges: true, topBadgeScale: 150 },
      })
    })
    expect(result.current.defaultGlobalBadges).toBe(false)
    expect(result.current.landscape.globalBadges).toBe(true)
    expect(result.current.landscape.topBadgeScale).toBe(150)
  })

  it("array snapshots never alias the live flat", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultSashOrder: ["rank"] })
    })
    expect(result.current.landscape.sashOrder).toEqual(
      ["upcoming", "rank", "new", "award", "extra"],
    )
    act(() => {
      result.current.update({ defaultSashOrder: ["new"] })
    })
    expect(result.current.landscape.sashOrder).toEqual(
      ["upcoming", "rank", "new", "award", "extra"],
    )
    expect(result.current.defaultSashOrder).toEqual(["new"])
  })

  it("explicit logo/extra nulls are never overwritten by snapshots", async () => {
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({
        landscape: { logoScale: null, extraBadgeScale: null, topBadgeScale: 150 },
      }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultLogoScale: 80, defaultExtraBadgeScale: 120, defaultTopBadgeScale: 110 })
    })
    expect(result.current.landscape.logoScale).toBeNull()
    expect(result.current.landscape.extraBadgeScale).toBeNull()
    expect(result.current.landscape.topBadgeScale).toBe(150)
  })

  it("stored inherit-nulls freeze pre-edit effective on first portrait edit, then stop following", async () => {
    // Legacy stored profile where every inherit key is an explicit `null`
    // (still following the flat at rest — appearance preserved).
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultBadgeFont: "oswald",
        defaultQualityBadgeStyle: "color",
        defaultVideoFormats: ["dv"],
        defaultNetworkLogoFollowTitle: true,
        defaultAgeBadgeStyle: "knockout",
        landscape: {
          badgeFont: null,
          qualityBadgeStyle: null,
          videoFormats: null,
          networkLogoFollowTitle: null,
          ageBadgeStyle: null,
        },
      }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    // At rest the nulls still follow (client preview rule `land ?? flat`).
    expect(result.current.landscape.badgeFont).toBeNull()
    expect(
      result.current.landscape.badgeFont ?? result.current.defaultBadgeFont,
    ).toBe("oswald")

    act(() => {
      result.current.update({
        defaultBadgeFont: "barlow-condensed",
        defaultQualityBadgeStyle: "mono",
        defaultVideoFormats: ["hdr"],
        defaultNetworkLogoFollowTitle: false,
        defaultAgeBadgeStyle: "standard",
      })
    })
    // Pre-edit values frozen; the new flats do not leak across.
    expect(result.current.landscape.badgeFont).toBe("oswald")
    expect(result.current.landscape.qualityBadgeStyle).toBe("color")
    expect(result.current.landscape.videoFormats).toEqual(["dv"])
    expect(result.current.landscape.networkLogoFollowTitle).toBe(true)
    expect(result.current.landscape.ageBadgeStyle).toBe("knockout")

    // A second portrait edit never rebases the frozen values.
    act(() => {
      result.current.update({ defaultBadgeFont: "inter", defaultAgeBadgeStyle: "knockout" })
    })
    expect(result.current.landscape.badgeFont).toBe("oswald")
    expect(result.current.landscape.ageBadgeStyle).toBe("knockout")
    expect(result.current.defaultBadgeFont).toBe("inter")
  })

  it("storage + debounced PUT persist snapshot atomically", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(putBodies).toHaveLength(0)
    act(() => {
      result.current.update({ defaultBadgeStyle: "pill" })
    })
    const stored = JSON.parse(storage.getItem(defaultsStorageKey()) ?? "{}")
    expect(stored.badgeStyle).toBe("pill")
    expect((stored.landscape as Record<string, unknown>).badgeStyle).toBe("shadow")
    await settle(600)
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0].badgeStyle).toBe("pill")
    expect((putBodies[0].landscape as Record<string, unknown>).badgeStyle).toBe("shadow")
  })

  it("manual save carries the full profile", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    await settle()
    act(() => {
      box.ed!.setDefaultBadgeStyle("pill")
    })
    const posted: { method?: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { method?: string; body?: string }) => {
        posted.push({
          method: init?.method,
          body: JSON.parse((init?.body as string) ?? "{}"),
        })
        return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
      }),
    )
    let ok = false
    await act(async () => {
      ok = await saveDefaults(box.ed!)
    })
    expect(ok).toBe(true)
    const puts = posted.filter((p) => p.method === "PUT")
    expect(puts).toHaveLength(1)
    expect(puts[0].body.badgeStyle).toBe("pill")
    expect((puts[0].body.landscape as Record<string, unknown>).badgeStyle).toBe("shadow")
  })

  it("hydration/unlock never reseeds the snapshot", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultBadgeStyle: "pill" })
    })
    await settle(600)
    await act(async () => {
      window.dispatchEvent(new Event(USER_UNLOCK_EVENT))
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(result.current.defaultBadgeStyle).toBe("pill")
    expect(result.current.landscape.badgeStyle).toBe("shadow")
  })

  it("landscape writes never touch the portrait flats", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultBadgeStyle: "pill", defaultGradientHeight: 45 })
    })
    act(() => {
      result.current.update({
        landscape: { ...result.current.landscape, badgeStyle: "minimal", gradientHeight: 5 },
      })
    })
    // Portrait custom stays; the last landscape write wins the profile.
    expect(result.current.landscape.badgeStyle).toBe("minimal")
    expect(result.current.defaultBadgeStyle).toBe("pill")
  })
})

describe("editor setters + Badge tab reset", () => {
  let storage: StorageStub

  beforeEach(() => {
    storage = createStorageStub()
    vi.stubGlobal("localStorage", storage)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
    )
    vi.useFakeTimers()
    vi.mocked(shouldSkipServerSync).mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function renderProbe() {
    storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    return box
  }

  it("flat setters snapshot; landscape setters never touch flats", async () => {
    const box = renderProbe()
    await act(async () => {})
    act(() => {
      box.ed!.setDefaultBadgeStyle("pill")
    })
    expect(box.ed!.defaultBadgeStyle).toBe("pill")
    expect(box.ed!.landscape.badgeStyle).toBe("shadow")
    act(() => {
      box.ed!.setLandscape({ badgeStyle: "minimal" })
    })
    expect(box.ed!.landscape.badgeStyle).toBe("minimal")
    expect(box.ed!.defaultBadgeStyle).toBe("pill")
  })

  it("resetLandscape materializes independence (quality 0/0, age trio, portrait copies)", async () => {
    const box = renderProbe()
    await act(async () => {})
    act(() => {
      box.ed!.setDefaultBadgeStyle("pill")
      box.ed!.setDefaultGradientHeight(45)
    })
    act(() => {
      box.ed!.resetLandscape()
    })
    expect(box.ed!.landscape.badgeStyle).toBe("pill")
    expect(box.ed!.landscape.gradientHeight).toBe(45)
    expect(box.ed!.landscape.qualityBadgeOffsetX).toBe(0)
    expect(box.ed!.landscape.qualityBadgeOffsetY).toBe(0)
    expect(box.ed!.landscape.ageBadge).toBe(false)
    expect(box.ed!.landscape.ageCountry).toBe("IT")
    expect(box.ed!.landscape.ageBadgeStyle).toBe("standard")
    expect(box.ed!.defaultBadgeStyle).toBe("pill")
    expect(box.ed!.defaultGradientHeight).toBe(45)
  })

  it("Badge tab reset restores portrait effective + age trio, keeps Transform numerics", async () => {
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({ landscape: { topBadgeScale: 130, badgeStyle: "minimal" } }),
    )
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    renderWithCtx(
      createElement(
        "div",
        null,
        createElement(BadgeDefaultsSection, { active: true, shape: "landscape" }),
        createElement(Probe),
      ),
    )
    await act(async () => {})
    const adv = screen.getByTestId("badge-advanced-toggle")
    if (adv.getAttribute("aria-expanded") !== "true") fireEvent.click(adv)
    const badgePanel = screen.getByRole("tabpanel", { name: "ui.badgeSection" })
    const reset = within(badgePanel).getByRole("button", {
      name: "ui.reset · ui.posterShapeLandscape",
    })
    fireEvent.click(reset)
    expect(ctx!.landscape.badgeStyle).toBe("shadow")
    expect(ctx!.landscape.ageBadge).toBe(false)
    expect(ctx!.landscape.ageCountry).toBe("IT")
    expect(ctx!.landscape.ageBadgeStyle).toBe("standard")
    // Transform-owned numerics stay intact.
    expect(ctx!.landscape.topBadgeScale).toBe(130)
    expect(ctx!.defaultBadgeStyle).toBe("shadow")
  })
})

describe("PUT /api/defaults shape independence (global + scoped user)", () => {
  const TEST_ADMIN_TOKEN = "shape-foundation-admin-token"

  beforeEach(() => {
    // Le route admin sono fail-closed: il PUT presenta un ADMIN_TOKEN reale.
    process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN
  })

  afterEach(() => {
    delete process.env.ADMIN_TOKEN
  })

  function mockPutRequest(body: unknown, url = "http://localhost:3000/api/defaults"): Request {
    return new Request(url, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-admin-token": TEST_ADMIN_TOKEN },
      body: JSON.stringify(body),
    })
  }

  // Hermetic per test (the isolated DATA_DIR persists across runs, and the
  // server module caches in memory): wipe disk + reload modules so every
  // test starts from a clean store however often the file re-runs.
  async function freshRoute() {
    const fs = await import("node:fs")
    fs.rmSync(`${process.cwd()}/test-results/data-shape-foundation-test`, {
      recursive: true,
      force: true,
    })
    vi.resetModules()
    return await import("@/app/api/defaults/route")
  }

  it("global flat-only PUT snapshots pre-merge; partial landscape PUT never discards", async () => {
    const { PUT, GET } = await freshRoute()
    const get = async () =>
      (await (
        await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
      ).json()) as Record<string, unknown>

    // Full portrait baseline first (real clients always send full bodies;
    // pre-merge effective values exist for every key below).
    expect(
      (
        await PUT(
          mockPutRequest({
            badgeStyle: "shadow",
            topBadgeScale: 100,
            globalBadges: true,
            gradientHeight: 30,
            sashOrder: ["upcoming", "rank", "new", "award", "extra"],
            videoFormats: ["dv", "hdr", "hdr10plus", "atmos", "imax"],
            landscape: { topBadgeScale: 150 },
          }) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200)

    // Partial portrait edit: every touched flat freezes pre-merge, the
    // explicit profile value survives, arrays snapshot by copy.
    expect(
      (
        await PUT(
          mockPutRequest({
            badgeStyle: "pill",
            topBadgeScale: 120,
            globalBadges: false,
            gradientHeight: 40,
            sashOrder: ["rank"],
            videoFormats: ["dv"],
          }) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200)
    let stored = await get()
    expect(stored.badgeStyle).toBe("pill")
    expect(stored.topBadgeScale).toBe(120)
    const land = stored.landscape as Record<string, unknown>
    expect(land.topBadgeScale).toBe(150)
    expect(land.badgeStyle).toBe("shadow")
    expect(land.globalBadges).toBe(true)
    expect(land.gradientHeight).toBe(30)
    expect(land.sashOrder).toEqual(["upcoming", "rank", "new", "award", "extra"])
    expect(land.videoFormats).toEqual(["dv", "hdr", "hdr10plus", "atmos", "imax"])

    // A later portrait edit never rebases the snapshot.
    expect((await PUT(mockPutRequest({ badgeStyle: "minimal" }) as unknown as NextRequest)).status).toBe(200)
    stored = await get()
    expect(stored.badgeStyle).toBe("minimal")
    expect((stored.landscape as Record<string, unknown>).badgeStyle).toBe("shadow")

    // Partial landscape patch merges per key (no wholesale replace).
    expect(
      (await PUT(mockPutRequest({ landscape: { badgeStyle: "vetro" } }) as unknown as NextRequest)).status,
    ).toBe(200)
    stored = await get()
    expect((stored.landscape as Record<string, unknown>).badgeStyle).toBe("vetro")
    expect((stored.landscape as Record<string, unknown>).topBadgeScale).toBe(150)
    expect(stored.badgeStyle).toBe("minimal")
  })

  it("global flat-null PUT freezes canonical effective, later edits do not leak", async () => {
    const { PUT, GET } = await freshRoute()
    const get = async () =>
      (await (
        await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
      ).json()) as Record<string, unknown>

    // Baseline: concrete font + formats, sparse profile.
    expect(
      (
        await PUT(
          mockPutRequest({
            badgeFont: "oswald",
            videoFormats: ["dv"],
            landscape: {},
          }) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200)

    // Direct API edit writing raw `null` flats: the profile freezes the
    // canonical pre-edit effective (what the renderer showed), not the null.
    expect(
      (
        await PUT(
          mockPutRequest({
            qualityBadgeStyle: null,
            ageBadgeStyle: null,
          }) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200)
    let stored = await get()
    expect(stored.qualityBadgeStyle).toBeNull()
    expect(stored.ageBadgeStyle).toBeNull()
    const land = stored.landscape as Record<string, unknown>
    expect(land.qualityBadgeStyle).toBe("standard")
    expect(land.ageBadgeStyle).toBe("standard")

    // A later portrait edit must not move the frozen landscape.
    expect(
      (await PUT(mockPutRequest({ qualityBadgeStyle: "knockout" }) as unknown as NextRequest)).status,
    ).toBe(200)
    stored = await get()
    expect(stored.qualityBadgeStyle).toBe("knockout")
    expect((stored.landscape as Record<string, unknown>).qualityBadgeStyle).toBe("standard")
  })

  it("scoped user PUT snapshots independently; namespaces stay isolated", async () => {
    const { PUT, GET } = await freshRoute()
    const uget = async () =>
      (await (
        await GET(
          new Request(
            `http://localhost:3000/api/defaults?u=${TEST_UUID}`,
          ) as unknown as NextRequest,
        )
      ).json()) as Record<string, unknown>

    expect(
      (
        await PUT(
          mockPutRequest({ badgeStyle: "pill" }, `http://localhost:3000/api/defaults?u=${TEST_UUID}`) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200)
    const userStored = await uget()
    expect(userStored.badgeStyle).toBe("pill")
    expect((userStored.landscape as Record<string, unknown>).badgeStyle).toBeUndefined()
    // Fresh user namespace: no profile yet, so nothing to freeze (effective
    // follows the just-written flat, byte-identical to legacy behavior).
    // The global namespace is untouched by the scoped write (isolation).
    const globalStored = await (
      await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    ).json() as Record<string, unknown>
    expect(globalStored.badgeStyle).toBeUndefined()
    expect(globalStored.landscape).toBeUndefined()

    // Second scoped edit freezes the first scoped value, not the global one.
    expect(
      (
        await PUT(
          mockPutRequest({ badgeStyle: "minimal" }, `http://localhost:3000/api/defaults?u=${TEST_UUID}`) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200)
    const userStored2 = await uget()
    expect(userStored2.badgeStyle).toBe("minimal")
    expect((userStored2.landscape as Record<string, unknown>).badgeStyle).toBe("pill")
  })

  it("scoped snapshot preserves server env defaults in the freeze", async () => {
    vi.stubEnv("PICTORIUM_GRADIENT_HEIGHT", "44")
    // freshRoute() already reset modules; the stubbed env is read at import.
    const fs = await import("node:fs")
    fs.rmSync(`${process.cwd()}/test-results/data-shape-foundation-test`, {
      recursive: true,
      force: true,
    })
    vi.resetModules()
    try {
      const sd = await import("@/lib/server-defaults")
      expect(sd.getInstanceEnvDefaults().gradientHeight).toBe(44)
      const { PUT, GET } = await import("@/app/api/defaults/route")
      const uuid = "22222222-2222-4222-8222-222222222222"
      expect(
        (
          await PUT(
            new Request(`http://localhost:3000/api/defaults?u=${uuid}`, {
              method: "PUT",
              headers: { "content-type": "application/json", "x-admin-token": TEST_ADMIN_TOKEN },
              body: JSON.stringify({ blurIntensity: 5, gradientHeight: 30 }),
            }) as unknown as NextRequest,
          )
        ).status,
      ).toBe(200)
      const stored = (await (
        await GET(
          new Request(`http://localhost:3000/api/defaults?u=${uuid}`) as unknown as NextRequest,
        )
      ).json()) as Record<string, unknown>
      // The env-covered flat was never stored, yet the freeze carries the
      // effective (env) value instead of losing the operator default.
      // blurIntensity had no pre-merge value anywhere, so it stays
      // inheriting (effective follows the just-written flat).
      expect((stored.landscape as Record<string, unknown>).gradientHeight).toBe(44)
      expect("blurIntensity" in (stored.landscape as Record<string, unknown>)).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("scoped flat-null PUT freezes canonical effective without touching globals", async () => {
    const { PUT, GET } = await freshRoute()
    const uuid = "33333333-3333-4333-8333-333333333333"
    const uget = async () =>
      (await (
        await GET(
          new Request(`http://localhost:3000/api/defaults?u=${uuid}`) as unknown as NextRequest,
        )
      ).json()) as Record<string, unknown>

    // Scoped baseline with a concrete follow toggle, sparse profile.
    expect(
      (
        await PUT(
          mockPutRequest(
            { networkLogoFollowTitle: true },
            `http://localhost:3000/api/defaults?u=${uuid}`,
          ) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200)
    // Direct API edit writing a raw `null` follow: the scoped profile freezes
    // the canonical pre-edit effective (`true`), not the null.
    expect(
      (
        await PUT(
          mockPutRequest(
            { networkLogoFollowTitle: null },
            `http://localhost:3000/api/defaults?u=${uuid}`,
          ) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200)
    const userStored = await uget()
    expect(userStored.networkLogoFollowTitle).toBeNull()
    expect((userStored.landscape as Record<string, unknown>).networkLogoFollowTitle).toBe(true)
    // Global namespace untouched by the scoped null write.
    const globalStored = await (
      await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    ).json() as Record<string, unknown>
    expect(globalStored.networkLogoFollowTitle).toBeUndefined()
    expect(globalStored.landscape).toBeUndefined()
  })
})
