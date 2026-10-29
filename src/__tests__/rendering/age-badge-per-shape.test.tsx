/**
 * Task3A: per-shape AGE settings (portrait flats + landscape profile).
 *
 * Contract: an explicit portrait age ON must NOT activate landscape.
 * Migration "preserve current appearance": the legacy effective trio is
 * snapshotted into the landscape profile BEFORE subsequent edits (load-time
 * seed + setter snapshot + PUT backfill for direct API clients) — never
 * re-seeded after a user update. Fresh states materialize independent
 * OFF/IT/standard on both shapes. Explicit false/null/invalid stay
 * fail-closed; reset restores independent original defaults (never
 * clear-to-follow).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { createElement } from "react"
import type { NextRequest } from "next/server"
import { renderHook } from "@testing-library/react"
import { useDefaults } from "@/lib/useDefaults"
import { shouldSkipServerSync } from "@/lib/guest-guard"
import { USER_UNLOCK_EVENT } from "@/lib/user-token"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { effectiveDefaultsForShape } from "@/lib/server-defaults"
import { resolveAgeBadgeRequest } from "@/lib/poster-config"
import { normalizePosterCacheParams } from "@/lib/poster-runtime-cache"
import { createWrapper, renderWithCtx } from "@/__tests__/test-utils"

vi.mock("@/lib/guest-guard", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/guest-guard")>()
  return { ...mod, shouldSkipServerSync: vi.fn(async () => false) }
})

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// Same isolated file store as the other defaults tests: PUTs here must not
// touch the instance data/defaults.json.
vi.mock("@/lib/data-dir", () => ({
  DATA_DIR: `${process.cwd()}/test-results/data-age-pershape-test`,
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

describe("resolveAgeBadgeRequest per-shape", () => {
  it("landscape explicit OFF wins over a portrait ON flat", () => {
    const sd = {
      ageBadge: true,
      ageCountry: "US",
      ageBadgeStyle: "knockout",
      landscape: { ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard" },
    } as never
    const land = resolveAgeBadgeRequest(
      new URLSearchParams(),
      null,
      effectiveDefaultsForShape(sd, "landscape"),
      sd,
    )
    expect(land).toEqual({ ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard" })
    const portrait = resolveAgeBadgeRequest(
      new URLSearchParams(),
      null,
      effectiveDefaultsForShape(sd, "poster"),
      sd,
    )
    expect(portrait).toEqual({ ageBadge: true, ageCountry: "US", ageBadgeStyle: "knockout" })
  })

  it("absent landscape keys follow the portrait flat", () => {
    const sd = { ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout", landscape: {} } as never
    const land = resolveAgeBadgeRequest(
      new URLSearchParams(),
      null,
      effectiveDefaultsForShape(sd, "landscape"),
      sd,
    )
    expect(land).toEqual({ ageBadge: true, ageCountry: "FR", ageBadgeStyle: "knockout" })
  })

  it("invalid landscape values fail closed onto the flat, invalid flat onto OFF/IT/standard", () => {
    const sd = {
      ageBadge: true,
      ageCountry: "US",
      ageBadgeStyle: "knockout",
      landscape: { ageBadge: null, ageCountry: "GLOBAL", ageBadgeStyle: "garbage" },
    } as never
    const land = resolveAgeBadgeRequest(
      new URLSearchParams(),
      null,
      effectiveDefaultsForShape(sd, "landscape"),
      sd,
    )
    // null counts as absent (inherits via ??); an invalid landscape value
    // shadows the flat in the effective merge and then fails closed onto the
    // hard defaults — same rule as badgeStyle/badgeFont (never garbage in
    // render, never an arbitrary fetch).
    expect(land).toEqual({ ageBadge: true, ageCountry: "IT", ageBadgeStyle: "standard" })

    const bad = { ageCountry: "GLOBAL", ageBadgeStyle: "garbage" } as never
    const fallback = resolveAgeBadgeRequest(new URLSearchParams(), null, bad, null)
    expect(fallback).toEqual({ ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard" })
  })

  it("explicit query beats everything; the token stays shared transport", () => {
    const sd = {
      ageBadge: false,
      landscape: { ageBadge: true, ageCountry: "DE", ageBadgeStyle: "knockout" },
    } as never
    // Query OFF wins over a landscape ON profile (shape override travels in query).
    const qOff = resolveAgeBadgeRequest(
      new URLSearchParams({ age: "0" }),
      null,
      effectiveDefaultsForShape(sd, "landscape"),
      sd,
    )
    expect(qOff.ageBadge).toBe(false)
    // Absent query inherits the shared token (no silent divergence the other way).
    const tokOn = resolveAgeBadgeRequest(
      new URLSearchParams(),
      { ageBadge: true } as never,
      effectiveDefaultsForShape({ landscape: { ageBadge: false } } as never, "landscape"),
      { landscape: { ageBadge: false } } as never,
    )
    expect(tokOn.ageBadge).toBe(true)
  })

  it("landscape age OFF needs no fetch: early gating stays false", () => {
    const sd = {
      ageBadge: true,
      landscape: { ageBadge: false },
    } as never
    const early = resolveAgeBadgeRequest(
      new URLSearchParams(),
      null,
      effectiveDefaultsForShape(sd, "landscape"),
      sd,
    )
    // The route computes ageFetchEnabledEarly = badgesEnabled !== false &&
    // ageBadgeEnabledEarly: false here means zero extra TMDB calls.
    expect(early.ageBadge).toBe(false)
  })
})

describe("useDefaults per-shape age hydration", () => {
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
        // Hydration GET: empty server state, local storage wins the merge.
        return { ok: true, status: 200, json: async () => ({}) }
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

  it("fresh states materialize independent OFF/IT/standard on both shapes", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultAgeBadge).toBe(false)
    expect(result.current.defaultAgeCountry).toBe("IT")
    expect(result.current.defaultAgeBadgeStyle).toBe("standard")
    expect(result.current.landscape.ageBadge).toBe(false)
    expect(result.current.landscape.ageCountry).toBe("IT")
    expect(result.current.landscape.ageBadgeStyle).toBe("standard")
  })

  it("legacy stored trio without a profile seeds the landscape (appearance preserved)", async () => {
    storage.setItem(
      "badgeDefaults",
      JSON.stringify({ ageBadge: true, ageCountry: "US", ageBadgeStyle: "knockout" }),
    )
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.defaultAgeBadge).toBe(true)
    expect(result.current.defaultAgeCountry).toBe("US")
    expect(result.current.defaultAgeBadgeStyle).toBe("knockout")
    // Seeded, not followed: later portrait edits cannot move these.
    expect(result.current.landscape.ageBadge).toBe(true)
    expect(result.current.landscape.ageCountry).toBe("US")
    expect(result.current.landscape.ageBadgeStyle).toBe("knockout")
  })

  it("portrait edits do not move the landscape snapshot and vice versa", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()

    act(() => {
      result.current.update({ defaultAgeBadge: true, defaultAgeCountry: "FR", defaultAgeBadgeStyle: "knockout" })
    })
    expect(result.current.defaultAgeBadge).toBe(true)
    expect(result.current.defaultAgeCountry).toBe("FR")
    expect(result.current.defaultAgeBadgeStyle).toBe("knockout")
    expect(result.current.landscape.ageBadge).toBe(false)
    expect(result.current.landscape.ageCountry).toBe("IT")
    expect(result.current.landscape.ageBadgeStyle).toBe("standard")

    act(() => {
      result.current.update({
        landscape: { ...result.current.landscape, ageBadge: true, ageCountry: "DE", ageBadgeStyle: "knockout" },
      })
    })
    expect(result.current.landscape.ageBadge).toBe(true)
    expect(result.current.landscape.ageCountry).toBe("DE")
    expect(result.current.landscape.ageBadgeStyle).toBe("knockout")
    expect(result.current.defaultAgeBadge).toBe(true)
    expect(result.current.defaultAgeCountry).toBe("FR")
    expect(result.current.defaultAgeBadgeStyle).toBe("knockout")

    // The seeded landscape persists through the auto-save payload.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(putBodies).toHaveLength(1)
    expect((putBodies[0].landscape as Record<string, unknown>).ageBadge).toBe(true)
    expect((putBodies[0].landscape as Record<string, unknown>).ageCountry).toBe("DE")
    expect(putBodies[0].ageBadge).toBe(true)
    expect(putBodies[0].ageCountry).toBe("FR")
  })

  it("hydration refresh after a portrait edit does not reseed from the updated portrait", async () => {
    const { result } = renderHook(() => useDefaults())
    await settle()
    expect(result.current.landscape.ageBadge).toBe(false)

    act(() => {
      result.current.update({ defaultAgeBadge: true })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    // Post-unlock refresh: the server still has no landscape age, but the
    // device copy (seeded OFF + auto-persisted) wins the merge — no reseed.
    await act(async () => {
      window.dispatchEvent(new Event(USER_UNLOCK_EVENT))
      await vi.advanceTimersByTimeAsync(1200)
    })
    expect(result.current.defaultAgeBadge).toBe(true)
    expect(result.current.landscape.ageBadge).toBe(false)
    expect(result.current.landscape.ageCountry).toBe("IT")
    expect(result.current.landscape.ageBadgeStyle).toBe("standard")
  })
})

describe("PUT /api/defaults per-shape age", () => {
  function mockPutRequest(body: unknown): Request {
    return new Request("http://localhost:3000/api/defaults", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  it("accepts valid landscape age keys", async () => {
    delete process.env.ADMIN_TOKEN
    const { PUT, GET } = await import("@/app/api/defaults/route")
    const res = await PUT(mockPutRequest({
      landscape: { ageBadge: true, ageCountry: "US", ageBadgeStyle: "knockout" },
    }) as unknown as NextRequest)
    expect(res.status).toBe(200)
    const stored = await (await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)).json() as Record<string, unknown>
    expect((stored.landscape as Record<string, unknown>).ageBadge).toBe(true)
    expect((stored.landscape as Record<string, unknown>).ageCountry).toBe("US")
    expect((stored.landscape as Record<string, unknown>).ageBadgeStyle).toBe("knockout")
  })

  it("rejects an invalid landscape style", async () => {
    delete process.env.ADMIN_TOKEN
    const { PUT } = await import("@/app/api/defaults/route")
    const res = await PUT(mockPutRequest({
      landscape: { ageBadgeStyle: "garbage" },
    }) as unknown as NextRequest)
    expect(res.status).toBe(400)
  })

  it("accepts the additive age styles in the landscape profile", async () => {
    delete process.env.ADMIN_TOKEN
    const { PUT, GET } = await import("@/app/api/defaults/route")
    for (const ageBadgeStyle of ["mono", "color", "premium"] as const) {
      expect((await PUT(mockPutRequest({
        landscape: { ageBadge: true, ageCountry: "US", ageBadgeStyle },
      }) as unknown as NextRequest)).status).toBe(200)
      const stored = await (await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)).json() as Record<string, unknown>
      expect((stored.landscape as Record<string, unknown>).ageBadgeStyle, ageBadgeStyle).toBe(ageBadgeStyle)
    }
  })

  it("flat-only portrait edits never move an explicit profile (no leak, no reseed, no wipe)", async () => {
    delete process.env.ADMIN_TOKEN
    const { PUT, GET } = await import("@/app/api/defaults/route")
    const get = async () =>
      (await (await GET(new Request("http://localhost:3000/api/defaults") as unknown as NextRequest)).json()) as Record<string, unknown>

    // 3B1: the landscape profile deep-merges (never a wholesale replace), so
    // an explicit `landscape: {}` patch no longer wipes it. Establish the
    // pre-state explicitly instead of relying on a wipe.
    expect((await PUT(mockPutRequest({
      ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard",
    }) as unknown as NextRequest)).status).toBe(200)
    const before = ((await get()).landscape ?? {}) as Record<string, unknown>

    // Partial portrait edit with no landscape keys: explicit profile values
    // are never clobbered, missing keys freeze the pre-merge flats.
    expect((await PUT(mockPutRequest({ ageBadge: true }) as unknown as NextRequest)).status).toBe(200)
    let stored = await get()
    expect(stored.ageBadge).toBe(true)
    expect(stored.landscape).toEqual(before)

    // A later portrait country edit does not reseed the profile either.
    expect((await PUT(mockPutRequest({ ageCountry: "FR" }) as unknown as NextRequest)).status).toBe(200)
    stored = await get()
    expect(stored.ageCountry).toBe("FR")
    expect(stored.landscape).toEqual(before)

    // An explicit landscape value is never clobbered by portrait edits.
    expect((await PUT(mockPutRequest({ landscape: { ageBadge: true } }) as unknown as NextRequest)).status).toBe(200)
    expect((await PUT(mockPutRequest({ ageBadge: false }) as unknown as NextRequest)).status).toBe(200)
    stored = await get()
    expect(stored.ageBadge).toBe(false)
    expect((stored.landscape as Record<string, unknown>).ageBadge).toBe(true)
  })
})

describe("BadgeDefaultsSection per-shape age UI", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    vi.useFakeTimers()
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
    renderWithCtx(createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)))
    const adv = screen.getByTestId("badge-advanced-toggle")
    if (adv.getAttribute("aria-expanded") !== "true") fireEvent.click(adv)
    const t = screen.getByTestId("badge-group-quality-toggle")
    if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
    return { ctx: () => ctx as PosterEditorCtx }
  }

  it("portrait toggle/country/style do not move the landscape snapshot", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    fireEvent.click(screen.getByRole("switch", { name: "ui.ageBadge" }))
    expect(ctx().defaultAgeBadge).toBe(true)
    expect(ctx().landscape.ageBadge).toBe(false)

    fireEvent.change(screen.getByLabelText("ui.ageBadgeCountry"), { target: { value: "US" } })
    expect(ctx().defaultAgeCountry).toBe("US")
    expect(ctx().landscape.ageCountry).toBe("IT")

    const label = screen.getByText("ui.ageBadgeStyle")
    fireEvent.click(within(label.parentElement!).getByRole("button", { name: "ui.qbsKnockout" }))
    expect(ctx().defaultAgeBadgeStyle).toBe("knockout")
    expect(ctx().landscape.ageBadgeStyle).toBe("standard")
  })

  it("landscape edits do not move the portrait flats", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(screen.getByRole("switch", { name: "ui.ageBadge" }))
    expect(ctx().landscape.ageBadge).toBe(true)
    expect(ctx().defaultAgeBadge).toBe(false)

    fireEvent.change(screen.getByLabelText("ui.ageBadgeCountry"), { target: { value: "US" } })
    expect(ctx().landscape.ageCountry).toBe("US")
    expect(ctx().defaultAgeCountry).toBe("IT")

    const label = screen.getByText("ui.ageBadgeStyle")
    fireEvent.click(within(label.parentElement!).getByRole("button", { name: "ui.qbsKnockout" }))
    expect(ctx().landscape.ageBadgeStyle).toBe("knockout")
    expect(ctx().defaultAgeBadgeStyle).toBe("standard")
  })

  it("tab reset restores independent original age defaults (never clear-to-follow)", async () => {
    localStorage.setItem(
      "badgeDefaults",
      JSON.stringify({ ageBadge: true, ageCountry: "US", ageBadgeStyle: "knockout" }),
    )
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    // Seeded legacy appearance: the profile follows the old ON/US/knockout.
    expect(ctx().landscape.ageBadge).toBe(true)

    fireEvent.click(screen.getByTitle("ui.formatTargetHint"))
    expect(ctx().landscape.ageBadge).toBe(false)
    expect(ctx().landscape.ageCountry).toBe("IT")
    expect(ctx().landscape.ageBadgeStyle).toBe("standard")
    // Portrait flats untouched by the landscape reset.
    expect(ctx().defaultAgeBadge).toBe(true)
    expect(ctx().defaultAgeCountry).toBe("US")
    expect(ctx().defaultAgeBadgeStyle).toBe("knockout")
  })
})

describe("PosterEditor age setters + resetLandscape", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function renderProbe() {
    const box: { ed: PosterEditorCtx | null } = { ed: null }
    function Probe() {
      box.ed = usePosterEditor()
      return null
    }
    render(createElement(Probe), { wrapper: createWrapper() })
    return box
  }

  it("first portrait edit snapshots the pre-edit flat (setter safety net)", async () => {
    const box = renderProbe()
    await act(async () => {})
    expect(box.ed!.landscape.ageBadge).toBe(false)
    await act(async () => {
      box.ed!.setDefaultAgeBadge(true)
    })
    expect(box.ed!.defaultAgeBadge).toBe(true)
    expect(box.ed!.landscape.ageBadge).toBe(false)

    // Legacy ON preserved: turning portrait OFF keeps landscape ON.
    localStorage.setItem("badgeDefaults", JSON.stringify({ ageBadge: true, ageCountry: "US" }))
    const legacy = renderProbe()
    await act(async () => {})
    expect(legacy.ed!.landscape.ageBadge).toBe(true)
    await act(async () => {
      legacy.ed!.setDefaultAgeBadge(false)
    })
    expect(legacy.ed!.defaultAgeBadge).toBe(false)
    expect(legacy.ed!.landscape.ageBadge).toBe(true)
    expect(legacy.ed!.landscape.ageCountry).toBe("US")
  })

  it("resetLandscape restores explicit independent age defaults", async () => {
    const box = renderProbe()
    await act(async () => {})
    await act(async () => {
      box.ed!.setLandscape({ ageBadge: true, ageCountry: "DE", ageBadgeStyle: "knockout" })
    })
    expect(box.ed!.landscape.ageBadge).toBe(true)
    await act(async () => {
      box.ed!.resetLandscape()
    })
    expect(box.ed!.landscape.ageBadge).toBe(false)
    expect(box.ed!.landscape.ageCountry).toBe("IT")
    expect(box.ed!.landscape.ageBadgeStyle).toBe("standard")
  })
})

describe("per-shape age URL roundtrip (preview = Stremio)", () => {
  it("defaults preview resolves the landscape profile, portrait ignores it", () => {
    const conflicting = {
      defaultAgeBadge: true,
      defaultAgeCountry: "US",
      defaultAgeBadgeStyle: "knockout" as const,
      landscape: { ageBadge: false, ageCountry: "IT", ageBadgeStyle: "standard" as const },
    }
    const land = new URL(buildDefaultsPreviewUrl({ ...conflicting, previewShape: "landscape" }))
    expect(land.searchParams.get("age")).toBe("0")
    expect(land.searchParams.get("agecountry")).toBe("IT")
    expect(land.searchParams.get("agebs")).toBe("standard")
    const portrait = new URL(buildDefaultsPreviewUrl({ ...conflicting, previewShape: "portrait" }))
    expect(portrait.searchParams.get("age")).toBe("1")
    expect(portrait.searchParams.get("agecountry")).toBe("US")
    expect(portrait.searchParams.get("agebs")).toBe("knockout")
  })

  it("stremio URLs carry the selected shape effective values, explicit over a conflicting token", () => {
    const defaults = {
      ageBadge: false,
      ageCountry: "IT",
      ageBadgeStyle: "standard" as const,
      landscape: { ageBadge: true, ageCountry: "US", ageBadgeStyle: "knockout" as const },
    }
    const land = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, config: "tok",
      defaults, forceShape: "landscape",
    })
    expect(land.searchParams.get("shape")).toBe("landscape")
    expect(land.searchParams.get("age")).toBe("1")
    expect(land.searchParams.get("agecountry")).toBe("US")
    expect(land.searchParams.get("agebs")).toBe("knockout")
    const portrait = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1, config: "tok",
      defaults,
    })
    expect(portrait.searchParams.get("age")).toBe("0")
  })

  it("cache key stays shape- and age-query-scoped", () => {
    const params = normalizePosterCacheParams(
      new URLSearchParams({ shape: "landscape", age: "1", agecountry: "us", agebs: "knockout" }),
    )
    expect(params.get("shape")).toBe("landscape")
    expect(params.get("age")).toBe("1")
    expect(params.get("agecountry")).toBe("US")
    expect(params.get("agebs")).toBe("knockout")
  })
})
