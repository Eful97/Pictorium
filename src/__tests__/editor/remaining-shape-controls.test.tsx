/**
 * Task 3B2: remaining concrete shape-isolation gaps.
 *
 * - Standalone extra style legacy fallback: an owned landscape profile key —
 *   including the explicit `null` "follow my own rank" marker — shadows the
 *   portrait flat at every resolution layer (server poster-config, defaults
 *   preview builder, Stremio URL builder, Badge tab scoped read), so a
 *   portrait extra edit can no longer resurrect across shapes. The marker is
 *   the only pixel-safe freeze: legacy extra with rs=number renders the
 *   numeral itself (extra-badge-style.test.ts), so materializing a mapped
 *   subset style (e.g. `corner`) would change pixels.
 * - logoAlign per-shape: profile field + snapshot + resolution + preview +
 *   Stremio + Badge tab scoped read/write/reset. Flat `null` keeps meaning
 *   per-shape auto (portrait "center", landscape "left").
 * - followTitle: verified already wired per shape (Transform portrait flat +
 *   Orizzontale profile freeze) — mechanism assertion only, no new UI.
 * - minQuality: server profile key exists with no UI — stays global by
 *   design (no new selector invented here).
 *
 * Source-backed throughout (real useDefaults/update, real PUT route, real
 * URL builders, real BadgeDefaultsSection wiring — never hand-built params).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import type { NextRequest } from "next/server"
import { renderHook } from "@testing-library/react"
import { useDefaults } from "@/lib/useDefaults"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import {
  SHAPE_FLAT_TO_LANDSCAPE,
  SHAPE_BARE_TO_LANDSCAPE,
  isLandscapeKeyPresent,
  snapshotMissingLandscape,
  independentLandscapeDefaults,
} from "@/lib/visual-presets"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { effectiveDefaultsForShape, type ServerDefaults } from "@/lib/server-defaults"
import type { Mapping } from "@/lib/types"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/guest-guard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guest-guard")>()
  return { ...mod, shouldSkipServerSync: vi.fn(async () => false) }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-shape-remaining-test`,
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

function baseInput(overrides: Partial<PosterRenderConfigInput> = {}): PosterRenderConfigInput {
  return {
    searchParams: new URLSearchParams(),
    mapping: null,
    configOverride: null,
    sd: {},
    hasQuery: true,
    showBadges: true,
    rankingBadges: true,
    animeRank: null,
    rankingResult: null,
    finalRank: null,
    ...overrides,
  }
}

const mapping = (partial: Partial<Mapping> = {}): Mapping => ({
  tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  ...partial,
})

const TEST_ADMIN_TOKEN = "remaining-shape-admin-token"

function mockPutRequest(body: unknown, url = "http://localhost:3000/api/defaults"): Request {
  return new Request(url, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": TEST_ADMIN_TOKEN },
    body: JSON.stringify(body),
  })
}

async function freshRoute() {
  const fs = await import("node:fs")
  fs.rmSync(`${process.cwd()}/test-results/data-shape-remaining-test`, {
    recursive: true,
    force: true,
  })
  vi.resetModules()
  return await import("@/app/api/defaults/route")
}

describe("extra legacy follow-own-rank (canonical map + snapshot)", () => {
  it("shape map carries the standalone extra style with a bare mirror", () => {
    expect(SHAPE_FLAT_TO_LANDSCAPE.defaultExtraBadgeStyle).toBe("extraBadgeStyle")
    expect(SHAPE_BARE_TO_LANDSCAPE.extraBadgeStyle).toBe("extraBadgeStyle")
  })

  it("profile follow-rank extra is present (explicit follow-own-rank), never re-frozen; legacy null inherits", () => {
    expect(isLandscapeKeyPresent({ extraBadgeStyle: "follow-rank" }, "extraBadgeStyle")).toBe(true)
    expect(isLandscapeKeyPresent({ extraBadgeStyle: null }, "extraBadgeStyle")).toBe(false)
    expect(isLandscapeKeyPresent({}, "extraBadgeStyle")).toBe(false)
    // A portrait extra edit over an owned follow-rank marker freezes nothing.
    const adds = snapshotMissingLandscape(
      { defaultExtraBadgeStyle: "pill" },
      { extraBadgeStyle: "follow-rank" },
      ["defaultExtraBadgeStyle"],
    )
    expect("extraBadgeStyle" in adds).toBe(false)
    // Legacy null still inherits: a portrait edit freezes the pre-edit flat.
    const legacyAdds = snapshotMissingLandscape(
      { defaultExtraBadgeStyle: "pill" },
      { extraBadgeStyle: null },
      ["defaultExtraBadgeStyle"],
    )
    expect(legacyAdds.extraBadgeStyle).toBe("pill")
  })

  it("legacy flat extra snapshots the follow-rank sentinel; concrete flat copies verbatim", () => {
    const legacy = snapshotMissingLandscape(
      { defaultExtraBadgeStyle: null },
      {},
      ["defaultExtraBadgeStyle"],
    )
    expect(legacy.extraBadgeStyle).toBe("follow-rank")
    const concrete = snapshotMissingLandscape(
      { defaultExtraBadgeStyle: "corner" },
      {},
      ["defaultExtraBadgeStyle"],
    )
    expect(concrete.extraBadgeStyle).toBe("corner")
  })

  it("independent defaults materialize follow-rank for legacy flats", () => {
    const full = independentLandscapeDefaults({
      defaultExtraBadgeStyle: null,
      defaultLogoAlign: null,
    })
    expect(full.extraBadgeStyle).toBe("follow-rank")
    expect(full.logoAlign).toBe("left")
  })
})

describe("logoAlign per-shape (canonical map + snapshot)", () => {
  it("shape map carries logoAlign with a bare mirror", () => {
    expect(SHAPE_FLAT_TO_LANDSCAPE.defaultLogoAlign).toBe("logoAlign")
    expect(SHAPE_BARE_TO_LANDSCAPE.logoAlign).toBe("logoAlign")
  })

  it("profile null logoAlign follows the flat; snapshot freezes the landscape auto", () => {
    expect(isLandscapeKeyPresent({ logoAlign: null }, "logoAlign")).toBe(false)
    expect(isLandscapeKeyPresent({ logoAlign: "center" }, "logoAlign")).toBe(true)
    const auto = snapshotMissingLandscape({ defaultLogoAlign: null }, {}, ["defaultLogoAlign"])
    expect(auto.logoAlign).toBe("left")
    const concrete = snapshotMissingLandscape({ defaultLogoAlign: "center" }, {}, ["defaultLogoAlign"])
    expect(concrete.logoAlign).toBe("center")
  })
})

describe("server resolution owns-profile guards (poster-config)", () => {
  it("landscape follow-rank extra shadows a later portrait flat (own rank survives); legacy null inherits", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      sd: {
        extraBadgeStyle: "pill",
        rankingBadgeStyle: "number",
        landscape: { extraBadgeStyle: "follow-rank", rankingBadgeStyle: "number" },
      },
    }))
    expect(r.extraBadgeStyle).toBeNull()
    expect(r.rankingBadgeStyle).toBe("number")
    const legacy = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      sd: {
        extraBadgeStyle: "pill",
        rankingBadgeStyle: "number",
        landscape: { extraBadgeStyle: null, rankingBadgeStyle: "number" },
      },
    }))
    expect(legacy.extraBadgeStyle).toBe("pill")
  })

  it("landscape absent extra still follows the flat (legacy URLs byte-identical)", () => {
    const r = resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      sd: { extraBadgeStyle: "pill", landscape: {} },
    }))
    expect(r.extraBadgeStyle).toBe("pill")
    const portrait = resolvePosterRenderConfig(baseInput({
      sd: { extraBadgeStyle: "pill", landscape: { extraBadgeStyle: null } },
    }))
    expect(portrait.extraBadgeStyle).toBe("pill")
  })

  it("query and mapping precedence over the profile sentinel is unchanged", () => {
    const sd: ServerDefaults = { extraBadgeStyle: "pill", landscape: { extraBadgeStyle: "follow-rank" } }
    expect(resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape", xbs: "corner" }),
      sd,
    })).extraBadgeStyle).toBe("corner")
    expect(resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      mapping: mapping({ extraBadgeStyle: "vetro" }),
      sd,
    })).extraBadgeStyle).toBe("vetro")
  })

  it("logoAlign: profile wins, null/absent follows flat, flat null stays landscape-left", () => {
    const land = (sd: Record<string, unknown>) => resolvePosterRenderConfig(baseInput({
      searchParams: new URLSearchParams({ shape: "landscape" }),
      sd: sd as never,
    })).logoAlign
    expect(land({ logoAlign: null, landscape: { logoAlign: "center" } })).toBe("center")
    expect(land({ logoAlign: "center", landscape: { logoAlign: null } })).toBe("center")
    expect(land({ logoAlign: "center", landscape: {} })).toBe("center")
    expect(land({ logoAlign: null, landscape: {} })).toBe("left")
    expect(land({ landscape: { logoAlign: "left" } })).toBe("left")
    // Portraits stay centered by contract whatever the stored values.
    expect(resolvePosterRenderConfig(baseInput({
      sd: { logoAlign: "left", landscape: { logoAlign: "left" } },
    })).logoAlign).toBe("center")
    // Effective-defaults helper already merges the profile for other consumers.
    expect(effectiveDefaultsForShape(
      { logoAlign: null, landscape: { logoAlign: "center" } } as never,
      "landscape",
    ).logoAlign).toBe("center")
  })
})

describe("defaults preview ownership (poster-url)", () => {
  it("landscape follow-rank extra emits xbs=follow-rank; legacy null/absent follows flat", () => {
    const owned = new URL(buildDefaultsPreviewUrl({
      defaultExtraBadgeStyle: "pill",
      landscape: { extraBadgeStyle: "follow-rank" },
      previewShape: "landscape",
    }))
    expect(owned.searchParams.get("xbs")).toBe("follow-rank")
    const legacyNull = new URL(buildDefaultsPreviewUrl({
      defaultExtraBadgeStyle: "pill",
      landscape: { extraBadgeStyle: null },
      previewShape: "landscape",
    }))
    expect(legacyNull.searchParams.get("xbs")).toBe("pill")
    const absent = new URL(buildDefaultsPreviewUrl({
      defaultExtraBadgeStyle: "pill",
      landscape: {},
      previewShape: "landscape",
    }))
    expect(absent.searchParams.get("xbs")).toBe("pill")
  })

  it("logoAlign preview: profile wins, follow reads flat, auto stays omitted, portrait never emits", () => {
    const profile = new URL(buildDefaultsPreviewUrl({
      defaultLogoAlign: null,
      landscape: { logoAlign: "center" },
      previewShape: "landscape",
    }))
    expect(profile.searchParams.get("align")).toBe("center")
    const follow = new URL(buildDefaultsPreviewUrl({
      defaultLogoAlign: "center",
      landscape: {},
      previewShape: "landscape",
    }))
    expect(follow.searchParams.get("align")).toBe("center")
    const auto = new URL(buildDefaultsPreviewUrl({
      defaultLogoAlign: null,
      landscape: {},
      previewShape: "landscape",
    }))
    expect(auto.searchParams.has("align")).toBe(false)
    const portrait = new URL(buildDefaultsPreviewUrl({
      defaultLogoAlign: "center",
      landscape: { logoAlign: "center" },
      previewShape: "portrait",
    }))
    expect(portrait.searchParams.has("align")).toBe(false)
  })

  it("preview-to-server roundtrip keeps the owned follow-rank sentinel (real saved-state sd)", () => {
    const sd = {
      extraBadgeStyle: "pill",
      rankingBadgeStyle: "number",
      logoAlign: null,
      landscape: { extraBadgeStyle: "follow-rank", rankingBadgeStyle: "number", logoAlign: null },
    } as never
    const url = new URL(buildDefaultsPreviewUrl({
      defaultExtraBadgeStyle: "pill",
      defaultRankingBadgeStyle: "default",
      defaultLogoAlign: null,
      landscape: { extraBadgeStyle: "follow-rank", rankingBadgeStyle: "number", logoAlign: null },
      previewShape: "landscape",
    }))
    expect(url.searchParams.get("xbs")).toBe("follow-rank")
    const back = resolvePosterRenderConfig(baseInput({ searchParams: url.searchParams, sd }))
    expect(back.extraBadgeStyle).toBeNull()
    expect(back.rankingBadgeStyle).toBe("number")
    expect(back.logoAlign).toBe("left")
  })
})

describe("Stremio URL per-shape extra (stremio-poster-url)", () => {
  it("landscape follow-rank emits the sentinel; legacy null inherits the flat; portrait still carries it", () => {
    const land = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: { extraBadgeStyle: "pill", landscape: { extraBadgeStyle: "follow-rank" } },
      forceShape: "landscape",
    })
    expect(land.searchParams.get("xbs")).toBe("follow-rank")
    const legacy = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: { extraBadgeStyle: "pill", landscape: { extraBadgeStyle: null } },
      forceShape: "landscape",
    })
    expect(legacy.searchParams.get("xbs")).toBe("pill")
    const port = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: { extraBadgeStyle: "pill", landscape: { extraBadgeStyle: "follow-rank" } },
      forceShape: "poster",
    })
    expect(port.searchParams.get("xbs")).toBe("pill")
  })

  it("concrete landscape profile still travels; legacy absent stays omitted", () => {
    const shaped = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: { landscape: { extraBadgeStyle: "corner" } },
      forceShape: "landscape",
    })
    expect(shaped.searchParams.get("xbs")).toBe("corner")
    const legacy = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: {},
      forceShape: "landscape",
    })
    expect(legacy.searchParams.has("xbs")).toBe(false)
  })
})

describe("useDefaults shape independence for the 3B2 keys (hook)", () => {
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

  async function settle(ms = 1200) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it("portrait extra edit freezes the follow-rank sentinel, later edits never move it", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultExtraBadgeStyle: "pill" })
    })
    expect(result.current.defaultExtraBadgeStyle).toBe("pill")
    expect(result.current.landscape.extraBadgeStyle).toBe("follow-rank")
    act(() => {
      result.current.update({ defaultExtraBadgeStyle: "vetro" })
    })
    expect(result.current.landscape.extraBadgeStyle).toBe("follow-rank")
    expect(result.current.defaultExtraBadgeStyle).toBe("vetro")
  })

  it("portrait extra edit copies a concrete pre-edit flat verbatim", async () => {
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultExtraBadgeStyle: "corner", landscape: {} }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultExtraBadgeStyle: "pill" })
    })
    expect(result.current.landscape.extraBadgeStyle).toBe("corner")
  })

  it("portrait logoAlign edit freezes the pre-edit effective (auto null -> left)", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({ defaultLogoAlign: "center" })
    })
    expect(result.current.defaultLogoAlign).toBe("center")
    expect(result.current.landscape.logoAlign).toBe("left")
    act(() => {
      result.current.update({ defaultLogoAlign: "left" })
    })
    expect(result.current.landscape.logoAlign).toBe("left")
  })

  it("landscape writes to the 3B2 keys never touch the portrait flats", async () => {
    storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
    const { result } = renderHook(() => useDefaults())
    await settle()
    act(() => {
      result.current.update({
        landscape: { ...result.current.landscape, extraBadgeStyle: "corner", logoAlign: "center" },
      })
    })
    expect(result.current.landscape.extraBadgeStyle).toBe("corner")
    expect(result.current.landscape.logoAlign).toBe("center")
    expect(result.current.defaultExtraBadgeStyle).toBeNull()
    expect(result.current.defaultLogoAlign).toBeNull()
  })
})

describe("PUT /api/defaults backfill for the 3B2 keys", () => {
  beforeEach(() => {
    // Le route admin sono fail-closed: il PUT presenta un ADMIN_TOKEN reale.
    process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN
  })

  afterEach(() => {
    delete process.env.ADMIN_TOKEN
  })

  it("flat-only PUT snapshots the follow-rank sentinel and the align auto, then holds", async () => {
    const { PUT, GET } = await freshRoute()
    const get = async () =>
      (await (
        await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
      ).json()) as Record<string, unknown>

    expect((await PUT(mockPutRequest({ extraBadgeStyle: "pill" }) as unknown as NextRequest)).status).toBe(200)
    let stored = await get()
    expect(stored.extraBadgeStyle).toBe("pill")
    expect((stored.landscape as Record<string, unknown>).extraBadgeStyle).toBe("follow-rank")

    expect((await PUT(mockPutRequest({ logoAlign: "center" }) as unknown as NextRequest)).status).toBe(200)
    stored = await get()
    expect(stored.logoAlign).toBe("center")
    expect((stored.landscape as Record<string, unknown>).logoAlign).toBe("left")

    // Later portrait edits never rebase the frozen profile.
    expect((await PUT(mockPutRequest({ extraBadgeStyle: "vetro" }) as unknown as NextRequest)).status).toBe(200)
    stored = await get()
    expect((stored.landscape as Record<string, unknown>).extraBadgeStyle).toBe("follow-rank")
    expect((stored.landscape as Record<string, unknown>).logoAlign).toBe("left")
  })

  it("scoped PUT snapshots independently; global namespace untouched", async () => {
    const { PUT, GET } = await freshRoute()
    const uuid = "44444444-4444-4333-8333-444444444444"
    expect(
      (
        await PUT(
          mockPutRequest(
            { extraBadgeStyle: "pill", logoAlign: "center" },
            `http://localhost:3000/api/defaults?u=${uuid}`,
          ) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200)
    const userStored = (await (
      await GET(
        new Request(`http://localhost:3000/api/defaults?u=${uuid}`) as unknown as NextRequest,
      )
    ).json()) as Record<string, unknown>
    expect((userStored.landscape as Record<string, unknown>).extraBadgeStyle).toBe("follow-rank")
    expect((userStored.landscape as Record<string, unknown>).logoAlign).toBe("left")
    const globalStored = (await (
      await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    ).json()) as Record<string, unknown>
    expect(globalStored.extraBadgeStyle).toBeUndefined()
    expect(globalStored.landscape).toBeUndefined()
  })

  it("landscape schema accepts an explicit logoAlign override and the follow-rank sentinel", async () => {
    const { PUT, GET } = await freshRoute()
    expect(
      (
        await PUT(
          mockPutRequest({ landscape: { logoAlign: "center", extraBadgeStyle: "corner" } }) as unknown as NextRequest,
        )
      ).status,
    ).toBe(200)
    const stored = (await (
      await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)
    ).json()) as Record<string, unknown>
    expect((stored.landscape as Record<string, unknown>).logoAlign).toBe("center")
    expect((stored.landscape as Record<string, unknown>).extraBadgeStyle).toBe("corner")
  })
})

describe("Badge tab scoped UI (real wiring)", () => {
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

  function renderBadge(shape: "portrait" | "landscape") {
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    renderWithCtx(
      createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)),
    )
    return { ctx: () => ctx as PosterEditorCtx }
  }

  it("landscape follow-rank shows the own-rank inherited look, not the portrait flat; legacy null follows the flat", async () => {
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultExtraBadgeStyle: "pill",
        defaultRankingBadgeStyle: "pill",
        landscape: { rankingBadgeStyle: "number", extraBadgeStyle: "follow-rank" },
      }),
    )
    renderBadge("landscape")
    await act(async () => {})
    // Owned follow-rank sentinel: the inherited hint reads the LANDSCAPE rank
    // (number -> corner pill), never the portrait "pill" flat.
    expect(screen.getByText(`ui.inherited: ui.corner`)).toBeInTheDocument()
  })

  it("landscape legacy null inherits the portrait flat (byte-identical)", async () => {
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({
        defaultExtraBadgeStyle: "pill",
        defaultRankingBadgeStyle: "pill",
        landscape: { rankingBadgeStyle: "number", extraBadgeStyle: null },
      }),
    )
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    expect(ctx().landscape.extraBadgeStyle).toBeNull()
  })

  it("logoAlign has no selector in either shape (Auto-only); style controls remain", async () => {
    for (const shape of ["portrait", "landscape"] as const) {
      storage.setItem("badgeDefaults", JSON.stringify({ landscape: {} }))
      renderBadge(shape)
      await act(async () => {})
      const adv = screen.getByTestId("badge-advanced-toggle")
      if (adv.getAttribute("aria-expanded") !== "true") fireEvent.click(adv)
      const g = screen.getByTestId("badge-group-style-toggle")
      if (g.getAttribute("aria-expanded") !== "true") fireEvent.click(g)
      // Auto-only: no alignment group and no alignment label anywhere.
      expect(screen.queryByRole("group", { name: "ui.logoAlign" })).toBeNull()
      expect(screen.queryByText("ui.logoAlign")).toBeNull()
      // The style group itself stays reachable.
      expect(screen.getByTestId("badge-group-style")).toBeInTheDocument()
      cleanup()
    }
  })

  it("Badge tab reset materializes independent logoAlign (portrait copy, never clear-to-follow)", async () => {
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({ defaultLogoAlign: "center", landscape: { logoAlign: "left" } }),
    )
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    const adv = screen.getByTestId("badge-advanced-toggle")
    if (adv.getAttribute("aria-expanded") !== "true") fireEvent.click(adv)
    const badgePanel = screen.getByRole("tabpanel", { name: "ui.badgeSection" })
    const reset = within(badgePanel).getByRole("button", {
      name: "ui.reset · ui.posterShapeLandscape",
    })
    fireEvent.click(reset)
    expect(ctx().landscape.logoAlign).toBe("center")
    expect(ctx().defaultLogoAlign).toBe("center")
  })
})

describe("remaining visual inventory (3B2)", () => {
  it("minQuality, rating sources and region stay global (no snapshot, no UI invented)", () => {
    const lands = new Set(Object.values(SHAPE_FLAT_TO_LANDSCAPE))
    for (const k of ["ratingSources", "region", "minQuality"]) {
      expect(lands, `must stay global: ${k}`).not.toContain(k)
    }
    // The server profile type still carries the landscape minQuality key for
    // API compatibility — snapshots never write it.
    const adds = snapshotMissingLandscape(
      { defaultGlobalBadges: false },
      {},
      ["defaultGlobalBadges"],
    )
    expect("minQuality" in adds).toBe(false)
  })

  it("followTitle keeps its per-shape binding (flat + profile, no new UI)", () => {
    expect(SHAPE_FLAT_TO_LANDSCAPE.defaultNetworkLogoFollowTitle).toBe("networkLogoFollowTitle")
    expect(SHAPE_BARE_TO_LANDSCAPE.networkLogoFollowTitle).toBe("networkLogoFollowTitle")
    // Explicit fixed landscape layers are never snapshotted over.
    const adds = snapshotMissingLandscape(
      { defaultNetworkLogoFollowTitle: false },
      { networkLogoFollowTitle: false },
      ["defaultNetworkLogoFollowTitle"],
    )
    expect("networkLogoFollowTitle" in adds).toBe(false)
  })
})
