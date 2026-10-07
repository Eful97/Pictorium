import { describe, expect, it, beforeEach, afterAll, vi } from "vitest"
import fsp from "node:fs/promises"
import path from "node:path"
import { NextRequest } from "next/server"
import { act, renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"

const mocks = vi.hoisted(() => ({
  mode: "file",
  auth: true,
  multi: true,
  kvData: new Map<string, Record<string, unknown>>(),
}))
vi.mock("@/lib/data-dir", () => ({ DATA_DIR: path.join(process.cwd(), "test-results", "visual-presets-test") }))
vi.mock("@/lib/kv", () => ({
  getStorageMode: () => mocks.mode,
  getKv: () => ({
    hgetall: async (key: string) => mocks.kvData.get(key) ?? null,
    hset: async (key: string, values: Record<string, unknown>) => { mocks.kvData.set(key, { ...mocks.kvData.get(key), ...values }) },
    hdel: async (key: string, id: string) => { delete mocks.kvData.get(key)?.[id] },
  }),
}))
vi.mock("@/lib/user-auth", () => ({
  sanitizeUserId: (value: string) => /^[a-f0-9-]{36}$/.test(value) ? value : null,
  extractUserParam: (req: NextRequest) => req.nextUrl.searchParams.get("u"),
  getScopedUserId: (value: string | null) => mocks.multi ? value : null,
  isMultiUserEnabled: () => mocks.multi,
  checkUserAuth: async () => mocks.auth,
  invalidUserResponse: () => Response.json({}, { status: 400 }),
  userAuthResponse: () => Response.json({}, { status: 401 }),
}))
vi.mock("@/lib/auth", () => ({
  checkAdminToken: () => mocks.auth,
  adminAuthResponse: () => Response.json({}, { status: 401 }),
  isSameOrigin: (req: NextRequest) => req.headers.get("origin") === "http://localhost",
  originMismatchResponse: () => Response.json({}, { status: 403 }),
}))
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: async () => ({ ok: true }), rateLimitKey: () => "test", rateLimitResponse: () => new Response(null, { status: 429 }),
}))

import { captureVisualPreset, visualPresetSchema, visualPresetValuesSchema, portraitPresetPatch, landscapeProfilePatch, applyPortraitIsolated, applyLandscapeIsolated, resolveEffectiveLandscape } from "@/lib/visual-presets"
import { effectiveDefaultsForShape, type ServerDefaults } from "@/lib/server-defaults"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { listVisualPresets, mutateVisualPreset } from "@/lib/visual-preset-store"
import { GET, POST, DELETE } from "@/app/api/defaults/presets/route"
import { useDefaults } from "@/lib/useDefaults"
import type { VisualPresetValues } from "@/lib/visual-presets"
import { PosterEditorProvider, usePosterEditor } from "@/lib/contexts/PosterEditorContext"

const USER = "123e4567-e89b-12d3-a456-426614174000"
const OTHER = "123e4567-e89b-12d3-a456-426614174001"
const root = path.join(process.cwd(), "test-results", "visual-presets-test")
let currentValues: VisualPresetValues
const values = () => captureVisualPreset(currentValues)
const request = (method: string, body?: unknown, user = USER, origin = "http://localhost", query = "") => new NextRequest(`http://localhost/api/defaults/presets?u=${user}${query}`, {
  method, headers: { origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
})

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
  const hook = renderHook(useDefaults)
  currentValues = captureVisualPreset(hook.result.current)
  hook.unmount()
  mocks.auth = true
  mocks.multi = true
  mocks.mode = "file"
  mocks.kvData.clear()
  for (const user of [USER, OTHER]) await fsp.unlink(path.join(root, "users", user, "visual-presets.json")).catch(() => {})
})
afterAll(async () => {
  for (const user of [USER, OTHER]) await fsp.unlink(path.join(root, "users", user, "visual-presets.json")).catch(() => {})
})

describe("personal visual presets", () => {
  it("captures a detached visual snapshot without keys, provider config or catalogs", () => {
    const source = { ...values(), tmdbKey: "secret", defaultCustomRatingEndpoint: "https://provider.test" }
    const saved = captureVisualPreset(source)
    expect(saved).not.toHaveProperty("tmdbKey")
    expect(saved).not.toHaveProperty("defaultCustomRatingEndpoint")
    saved.defaultRatingSources.push("test")
    expect(source.defaultRatingSources).not.toContain("test")
    expect(visualPresetValuesSchema.safeParse({ ...saved, tmdbKey: "secret" }).success).toBe(false)
  })

  it("applies all visual defaults atomically without changing provider configuration", () => {
    const hook = renderHook(usePosterEditor, { wrapper: ({ children }: { children: ReactNode }) => createElement(PosterEditorProvider, null, children) })
    const preset = captureVisualPreset(hook.result.current)
    act(() => {
      hook.result.current.setDefaultLogoScale(40)
      hook.result.current.setDefaultBadgeRating(!preset.defaultBadgeRating)
      hook.result.current.setLandscape({ logoScale: 55 })
      hook.result.current.setDefaultCustomRatingEndpoint("https://provider.test")
    })
    act(() => hook.result.current.applyVisualPreset(preset))
    expect(captureVisualPreset(hook.result.current)).toEqual(preset)
    expect(hook.result.current.defaultCustomRatingEndpoint).toBe("https://provider.test")
    hook.unmount()
  })

  it("round-trips separateBadgeScale via capture/apply; legacy presets default to 130", () => {
    const hook = renderHook(usePosterEditor, { wrapper: ({ children }: { children: ReactNode }) => createElement(PosterEditorProvider, null, children) })
    act(() => {
      hook.result.current.setDefaultSeparateBadgeScale(150)
      hook.result.current.setLandscape({ separateBadgeScale: 130 })
    })
    const preset = captureVisualPreset(hook.result.current)
    expect(preset.defaultSeparateBadgeScale).toBe(150)
    expect(preset.landscape.separateBadgeScale).toBe(130)
    act(() => {
      hook.result.current.setDefaultSeparateBadgeScale(100)
      hook.result.current.setLandscape({ separateBadgeScale: undefined })
    })
    act(() => hook.result.current.applyVisualPreset(preset))
    expect(hook.result.current.defaultSeparateBadgeScale).toBe(150)
    expect(hook.result.current.landscape.separateBadgeScale).toBe(130)
    hook.unmount()
    // Preset salvati prima del campo: parsing tollerante → 130 (nuovo default unico).
    const legacy = {
      ...preset,
      defaultSeparateBadgeScale: undefined,
      landscape: { ...preset.landscape, separateBadgeScale: undefined },
    }
    const parsed = visualPresetValuesSchema.parse(legacy)
    expect(parsed.defaultSeparateBadgeScale).toBe(130)
    expect(parsed.landscape.separateBadgeScale).toBeUndefined()
  })

  for (const mode of ["file", "kv"]) {
    it(`overwrites the same trimmed name and preserves its id using ${mode}`, async () => {
      mocks.mode = mode
      const saved = await mutateVisualPreset(USER, "save", { name: "Cinema", values: values() })
      const changed = { ...values(), defaultLogoScale: 42 }
      const updated = await mutateVisualPreset(USER, "save", { name: " Cinema ", values: changed })
      expect(updated).toHaveLength(1)
      expect(updated[0]).toEqual({ id: saved[0].id, name: "Cinema", shape: "portrait", values: changed })
      expect(await listVisualPresets(USER)).toEqual(updated)
    })

    it(`allows overwriting when all preset slots are occupied using ${mode}`, async () => {
      mocks.mode = mode
      for (let i = 0; i < 20; i++) await mutateVisualPreset(USER, "save", { name: `Style ${i}`, values: values() })
      const updated = await mutateVisualPreset(USER, "save", { name: "Style 0", values: { ...values(), defaultLogoScale: 42 } })
      expect(updated).toHaveLength(20)
      expect(updated.find((preset) => preset.name === "Style 0")!.values.defaultLogoScale).toBe(42)
      await expect(mutateVisualPreset(USER, "save", { name: "New", values: values() })).rejects.toThrow("Preset limit reached")
    })

    it(`persists, lists and deletes only the owner's presets using ${mode}`, async () => {
      mocks.mode = mode
      const saved = await mutateVisualPreset(USER, "save", { name: "Cinema", values: values() })
      expect(saved[0].name).toBe("Cinema")
      expect(await listVisualPresets(USER)).toEqual(saved)
      expect(await listVisualPresets(OTHER)).toEqual([])
      await mutateVisualPreset(OTHER, "delete", { id: saved[0].id })
      expect(await listVisualPresets(USER)).toEqual(saved)
      expect(await mutateVisualPreset(USER, "delete", { id: saved[0].id })).toEqual([])
    })
  }

  it("serializes simultaneous saves without losing a preset", async () => {
    await Promise.all(["First", "Second"].map((name) => mutateVisualPreset(USER, "save", { name, values: values() })))
    expect(await listVisualPresets(USER)).toHaveLength(2)
  })

  it("requires owner auth and a namespace on multi-user instances", async () => {
    mocks.auth = false
    expect((await GET(request("GET"))).status).toBe(401)
    expect((await POST(request("POST", { name: "Cinema", values: values() }))).status).toBe(401)
    mocks.auth = true
    expect((await GET(request("GET", undefined, ""))).status).toBe(400)
  })

  it("rejects cross-origin mutations and non-visual fields", async () => {
    expect((await POST(request("POST", { name: "Cinema", values: values() }, USER, "https://evil.test"))).status).toBe(403)
    expect((await POST(request("POST", { name: "Cinema", values: { ...values(), tmdbKey: "secret" } }))).status).toBe(400)
  })

  it("returns a saved preset to another authenticated session and supports deletion", async () => {
    const savedResponse = await POST(request("POST", { name: "Cinema", values: values() }))
    expect(savedResponse.status).toBe(200)
    const { presets } = await savedResponse.json()
    const secondSession = await GET(request("GET"))
    expect(await secondSession.json()).toEqual({ presets })
    const deleted = await DELETE(request("DELETE", { id: presets[0].id }))
    expect(await deleted.json()).toEqual({ presets: [] })
  })
})

describe("shaped visual presets (portrait|landscape)", () => {
  it("reads legacy entries without shape as portrait without data loss", async () => {
    const saved = await mutateVisualPreset(USER, "save", { name: "Cinema", values: values() })
    expect(saved[0].shape).toBe("portrait")
    expect(await listVisualPresets(USER)).toEqual(saved)
    expect(await listVisualPresets(USER, "landscape")).toEqual([])
    // Raw legacy payload without `shape` still parses, values byte-identical.
    const legacy = { id: saved[0].id, name: saved[0].name, values: saved[0].values }
    const parsed = visualPresetSchema.parse(legacy)
    expect(parsed.shape).toBe("portrait")
    expect(parsed.values).toEqual(saved[0].values)
  })

  for (const mode of ["file", "kv"]) {
    it(`namespaces names and quotas per shape using ${mode}`, async () => {
      mocks.mode = mode
      const portrait = await mutateVisualPreset(USER, "save", { name: "Cinema", values: values() })
      const landscape = await mutateVisualPreset(USER, "save", { name: "Cinema", values: values(), shape: "landscape" })
      expect(portrait[0].id).not.toBe(landscape[0].id)
      expect(await listVisualPresets(USER, "portrait")).toHaveLength(1)
      expect(await listVisualPresets(USER, "landscape")).toHaveLength(1)
      for (let i = 0; i < 19; i++) {
        await mutateVisualPreset(USER, "save", { name: `P${i}`, values: values() })
        await mutateVisualPreset(USER, "save", { name: `L${i}`, values: values(), shape: "landscape" })
      }
      expect(await listVisualPresets(USER, "portrait")).toHaveLength(20)
      expect(await listVisualPresets(USER, "landscape")).toHaveLength(20)
      await expect(mutateVisualPreset(USER, "save", { name: "Overflow", values: values() })).rejects.toThrow("Preset limit reached")
      await expect(mutateVisualPreset(USER, "save", { name: "Overflow", values: values(), shape: "landscape" })).rejects.toThrow("Preset limit reached")
      const updated = await mutateVisualPreset(USER, "save", { name: "Cinema", values: { ...values(), defaultLogoScale: 42 } })
      expect(updated).toHaveLength(20)
      expect(updated.find((preset) => preset.name === "Cinema")!.values.defaultLogoScale).toBe(42)
      expect(updated.find((preset) => preset.name === "Cinema")!.id).toBe(portrait[0].id)
      // Same-name landscape entry untouched by the portrait overwrite.
      expect((await listVisualPresets(USER, "landscape")).find((preset) => preset.name === "Cinema")!.id).toBe(landscape[0].id)
    })
  }

  it("GET defaults to portrait, filters landscape, rejects garbage shape", async () => {
    await mutateVisualPreset(USER, "save", { name: "Cinema", values: values() })
    await mutateVisualPreset(USER, "save", { name: "Wide", values: values(), shape: "landscape" })
    const legacy = await GET(request("GET"))
    expect((await legacy.json()).presets.map((preset: { name: string }) => preset.name)).toEqual(["Cinema"])
    const land = await GET(request("GET", undefined, USER, "http://localhost", "&shape=landscape"))
    expect((await land.json()).presets.map((preset: { name: string }) => preset.name)).toEqual(["Wide"])
    expect((await GET(request("GET", undefined, USER, "http://localhost", "&shape=nope"))).status).toBe(400)
  })

  it("POST defaults to portrait; landscape POST leaves portrait untouched", async () => {
    const first = await POST(request("POST", { name: "Cinema", values: values() }))
    expect((await first.json()).presets[0].shape).toBe("portrait")
    const second = await POST(request("POST", { name: "Cinema", values: values(), shape: "landscape" }))
    const land = await second.json()
    expect(land.presets).toHaveLength(1)
    expect(land.presets[0].shape).toBe("landscape")
    expect((await (await GET(request("GET"))).json()).presets).toHaveLength(1)
  })

  it("DELETE enforces shape membership with portrait default", async () => {
    const portrait = await mutateVisualPreset(USER, "save", { name: "Cinema", values: values() })
    const landscape = await mutateVisualPreset(USER, "save", { name: "Cinema", values: values(), shape: "landscape" })
    // Wrong-shape delete is a no-op returning the target shape list.
    const noop = await DELETE(request("DELETE", { id: landscape[0].id, shape: "portrait" }))
    expect((await noop.json()).presets).toHaveLength(1)
    expect(await listVisualPresets(USER, "landscape")).toHaveLength(1)
    // Legacy delete without shape targets portrait.
    const deleted = await DELETE(request("DELETE", { id: portrait[0].id }))
    expect(await deleted.json()).toEqual({ presets: [] })
    expect(await listVisualPresets(USER, "landscape")).toHaveLength(1)
    const deletedLand = await DELETE(request("DELETE", { id: landscape[0].id, shape: "landscape" }))
    expect(await deletedLand.json()).toEqual({ presets: [] })
  })

  it("landscape schema accepts the full supported profile; legacy narrow still parses", () => {
    const full = {
      ...values(),
      landscape: {
        ...values().landscape,
        globalBadges: false, rankingBadges: false,
        badgeGenre: false, badgeYear: false, badgeRating: false, badgeQuality: false,
        customRatings: true, separateRatings: true,
        badgeStyle: "pill", rankingBadgeStyle: "number", extraBadgeStyle: "corner",
        badgeFont: "oswald", qualityBadgeStyle: "color",
        videoFormats: ["dv", "atmos"], sashOrder: ["rank", "extra"],
        networkLogo: false, networkLogoPosition: "top",
        preRelease: true, ribbonEnabled: false, ribbonSide: "right",
      },
    }
    expect(visualPresetValuesSchema.safeParse(full).success).toBe(true)
    const nulled = { ...values(), landscape: { badgeFont: null, extraBadgeStyle: null, videoFormats: null } }
    expect(visualPresetValuesSchema.safeParse(nulled).success).toBe(true)
    expect(visualPresetValuesSchema.safeParse({ ...values(), landscape: { badgeStyle: "nope" } }).success).toBe(false)
  })

  it("portrait patch strips landscape and delivery; landscape patch is profile-only", () => {
    const snapshot = { ...values(), defaultPosterShape: "landscape" as const, landscape: { ...values().landscape, badgeStyle: "pill" as const } }
    const patch = portraitPresetPatch(snapshot)
    expect(patch).not.toHaveProperty("landscape")
    expect(patch).not.toHaveProperty("defaultPosterShape")
    expect(patch.defaultBadgeStyle).toBe(snapshot.defaultBadgeStyle)
    const profile = landscapeProfilePatch(snapshot)
    expect(profile.badgeStyle).toBe("pill")
    expect(profile.globalBadges).toBe(snapshot.defaultGlobalBadges)
    expect(profile).not.toHaveProperty("ratingSources")
    expect(profile).not.toHaveProperty("logoAlign")
    expect(profile).not.toHaveProperty("posterShape")
    // Snapshot landscape wins over flat-derived keys.
    expect(landscapeProfilePatch({ ...values(), defaultTopBadgeScale: 111, landscape: { topBadgeScale: 122 } }).topBadgeScale).toBe(122)
  })
})

describe("preset orientation isolation", () => {
  // Sparse landscape: only topBadgeScale is an explicit override, everything
  // else inherits flats (the risky case for cross-format leaks).
  const sparseCurrent = () => ({
    ...values(),
    defaultBadgeStyle: "shadow" as const,
    defaultTopBadgeScale: 100,
    defaultGenreBadgeScale: 100,
    defaultQualityBadgeScale: 100,
    defaultRatingSources: ["imdb", "tmdb"],
    defaultLogoAlign: "center" as const,
    defaultPortraitFitEnabled: false,
    defaultLandscapeFitEnabled: false,
    defaultPosterShape: "poster" as const,
    landscape: { topBadgeScale: 150 },
  })

  it("portrait apply freezes effective landscape and never touches globals/delivery", () => {
    const current = sparseCurrent()
    const before = resolveEffectiveLandscape(current)
    const preset = {
      ...values(),
      defaultBadgeStyle: "pill" as const,
      defaultTopBadgeScale: 120,
      defaultGenreBadgeScale: 130,
      defaultQualityBadgeScale: 100,
      defaultRatingSources: ["letterboxd"],
      defaultLogoAlign: "left" as const,
      defaultPortraitFitEnabled: true,
      defaultLandscapeFitEnabled: true,
      defaultPosterShape: "landscape" as const,
      landscape: { badgeStyle: "colored" as const },
    }
    const next = applyPortraitIsolated(current, preset)
    // Portrait look applied (mapped flats only).
    expect(next.defaultBadgeStyle).toBe("pill")
    expect(next.defaultTopBadgeScale).toBe(120)
    expect(next.defaultGenreBadgeScale).toBe(130)
    // Globals and delivery byte-identical: isolated presets cannot leak.
    expect(next.defaultRatingSources).toEqual(["imdb", "tmdb"])
    expect(next.defaultLogoAlign).toBe("center")
    expect(next.defaultPortraitFitEnabled).toBe(false)
    expect(next.defaultLandscapeFitEnabled).toBe(false)
    expect(next.defaultPosterShape).toBe("poster")
    // Stored landscape of the preset ignored; explicit override preserved.
    expect(next.landscape.topBadgeScale).toBe(150)
    // Inherited keys the preset changes are frozen at the old effective.
    expect(next.landscape.badgeStyle).toBe("shadow")
    expect(next.landscape.genreBadgeScale).toBe(100)
    // Keys the preset leaves equal keep inheriting (surgical sparsity).
    expect(next.landscape.qualityBadgeScale).toBeUndefined()
    // Effective landscape output is bit-identical.
    expect(resolveEffectiveLandscape(next)).toEqual(before)
  })

  it("portrait apply materializes null flats (logo auto contract)", () => {
    const current = { ...values(), defaultLogoScale: null, landscape: {} }
    const next = applyPortraitIsolated(current, { ...values(), defaultLogoScale: 80 })
    expect(next.defaultLogoScale).toBe(80)
    expect(next.landscape.logoScale).toBeNull()
  })

  it("landscape apply is profile-only: portrait flats, globals and delivery unchanged", () => {
    const current = { ...sparseCurrent(), landscape: { topBadgeScale: 150, extraBadgeStyle: "corner" as const } }
    const preset = {
      ...values(),
      defaultBadgeStyle: "colored" as const,
      defaultTopBadgeScale: 200,
      defaultRatingSources: ["letterboxd"],
      defaultPosterShape: "landscape" as const,
      landscape: { badgeStyle: "vetro" as const, topBadgeScale: 180 },
    }
    const next = applyLandscapeIsolated(current, preset)
    // All 40 mapped portrait flats untouched, so portrait output cannot move.
    expect(portraitPresetPatch(next)).toEqual(portraitPresetPatch(current))
    expect(next.defaultRatingSources).toEqual(current.defaultRatingSources)
    expect(next.defaultPosterShape).toBe("poster")
    // Snapshot wins on top, pre-existing landscape-only extras preserved.
    expect(next.landscape.badgeStyle).toBe("vetro")
    expect(next.landscape.topBadgeScale).toBe(180)
    expect(next.landscape.extraBadgeStyle).toBe("corner")
  })

  it("resolveEffectiveLandscape prefers overrides, falls back to flats, keeps landscape-only raw", () => {
    const effective = resolveEffectiveLandscape({
      ...values(),
      defaultBadgeStyle: "shadow" as const,
      landscape: { topBadgeScale: 150, extraBadgeStyle: "corner" as const },
    })
    expect(effective.badgeStyle).toBe("shadow")
    expect(effective.topBadgeScale).toBe(150)
    expect(effective.extraBadgeStyle).toBe("corner")
  })

  it("preserves raw profile extras outside the preset contract in both directions", () => {
    // Server-supported but never captured (no flat counterpart): strict
    // schemas drop it everywhere, so apply must carry the raw profile.
    const current = {
      ...values(),
      defaultBadgeStyle: "shadow" as const,
      landscape: { ...values().landscape, minQuality: "4K" },
    }
    const preset = { ...values(), defaultBadgeStyle: "pill" as const }
    const nextPortrait = applyPortraitIsolated(current, preset)
    expect(nextPortrait.defaultBadgeStyle).toBe("pill")
    expect((nextPortrait.landscape as unknown as Record<string, unknown>).minQuality).toBe("4K")
    const nextLandscape = applyLandscapeIsolated(current, preset)
    expect(nextLandscape.defaultBadgeStyle).toBe("shadow")
    expect((nextLandscape.landscape as unknown as Record<string, unknown>).minQuality).toBe("4K")
    // Effective resolution ignores out-of-contract keys on both sides.
    expect(resolveEffectiveLandscape(nextPortrait)).toEqual(resolveEffectiveLandscape(current))
  })

  it("freezes null-inheriting profile keys to the old flat when the preset moves it", () => {
    const current: VisualPresetValues = {
      ...values(),
      defaultBadgeFont: "oswald",
      landscape: { badgeFont: null },
    }
    const next = applyPortraitIsolated(current, { ...values(), defaultBadgeFont: "inter" })
    expect(next.defaultBadgeFont).toBe("inter")
    expect(next.landscape.badgeFont).toBe("oswald")
    expect(resolveEffectiveLandscape(next).badgeFont).toBe("oswald")
  })

  it("null inheritance agrees with server effectiveDefaultsForShape", () => {
    const flats = {
      badgeFont: "oswald",
      qualityBadgeStyle: "color",
      videoFormats: ["dv"],
      logoScale: null,
    } as unknown as ServerDefaults
    const effective = effectiveDefaultsForShape(
      { ...flats, landscape: { badgeFont: null, qualityBadgeStyle: null, videoFormats: null, logoScale: null } },
      "landscape",
    )
    // Server spread preserves explicit null (pickDefined skips only undefined)…
    expect(effective.badgeFont).toBeNull()
    expect(effective.qualityBadgeStyle).toBeNull()
    expect(effective.videoFormats).toBeNull()
    expect(effective.logoScale).toBeNull()
    // …while every consumer normalizes inherit-nulls to the flat
    // (poster-url pick `land.x ?? undefined`; `??` chains client+server)…
    const snapshot: VisualPresetValues = {
      ...values(),
      defaultBadgeFont: "oswald",
      defaultQualityBadgeStyle: "color",
      defaultVideoFormats: ["dv"],
      defaultLogoScale: null,
      landscape: { badgeFont: null, qualityBadgeStyle: null, videoFormats: null, logoScale: null },
    }
    const resolved = resolveEffectiveLandscape(snapshot)
    expect(resolved.badgeFont).toBe("oswald")
    expect(resolved.qualityBadgeStyle).toBe("color")
    expect(resolved.videoFormats).toEqual(["dv"])
    // …but logo nulls stay explicit per the auto/zero contract.
    expect(resolved.logoScale).toBeNull()
  })

  it("logo auto freeze holds through the real defaults-preview query (sparse and explicit-null profiles)", () => {
    const logoQuery = (v: VisualPresetValues) => {
      const params = new URL(buildDefaultsPreviewUrl({
        defaultLogoScale: v.defaultLogoScale,
        defaultLogoOffsetX: v.defaultLogoOffsetX,
        defaultLogoOffsetY: v.defaultLogoOffsetY,
        defaultPosterShape: v.defaultPosterShape,
        landscape: v.landscape,
        previewShape: "landscape",
      }), "http://localhost").searchParams
      return { scale: params.get("scale"), ox: params.get("ox"), oy: params.get("oy") }
    }
    for (const profile of [{}, { logoScale: null, logoOffsetX: null, logoOffsetY: null }]) {
      const current: VisualPresetValues = {
        ...values(),
        defaultLogoScale: null,
        defaultLogoOffsetX: null,
        defaultLogoOffsetY: null,
        defaultPosterShape: "poster",
        landscape: profile,
      }
      const preset = { ...values(), defaultLogoScale: 80, defaultLogoOffsetX: 10, defaultLogoOffsetY: -5 }
      const next = applyPortraitIsolated(current, preset)
      // Real builder output bit-identical (null encodes auto/zero, and the
      // server decodes scale=0 back to auto-fit: poster-config.ts).
      expect(logoQuery(next)).toEqual(logoQuery(current))
      expect(logoQuery(next)).toEqual({ scale: "0", ox: "0", oy: "0" })
      // Control: the same builder WOULD move with a sparse profile and an
      // explicit flat (test sensitivity); explicit profile nulls freeze too
      // (logo null = explicit auto/zero contract, unlike inherit-nulls).
      const bare: VisualPresetValues = { ...current, ...portraitPresetPatch(preset), landscape: {} }
      expect(logoQuery(bare).scale).toBe("80")
      expect(logoQuery(bare).ox).toBe("10")
    }
  })

  it("null-inheriting style freeze holds through the real qbs/bfont/formats query", () => {
    const styleQuery = (v: VisualPresetValues) => {
      const params = new URL(buildDefaultsPreviewUrl({
        defaultBadgeFont: v.defaultBadgeFont,
        defaultQualityBadgeStyle: v.defaultQualityBadgeStyle,
        defaultVideoFormats: v.defaultVideoFormats,
        defaultPosterShape: v.defaultPosterShape,
        landscape: v.landscape,
        previewShape: "landscape",
      }), "http://localhost").searchParams
      return { bfont: params.get("bfont"), qbs: params.get("qbs"), formats: params.get("formats") }
    }
    const current: VisualPresetValues = {
      ...values(),
      defaultBadgeFont: "oswald",
      defaultQualityBadgeStyle: "color",
      defaultVideoFormats: ["dv", "atmos"],
      landscape: { badgeFont: null, qualityBadgeStyle: null, videoFormats: null },
    }
    const preset: VisualPresetValues = {
      ...values(),
      defaultBadgeFont: "inter",
      defaultQualityBadgeStyle: "standard",
      defaultVideoFormats: ["hdr"],
    }
    const next = applyPortraitIsolated(current, preset)
    expect(styleQuery(next)).toEqual(styleQuery(current))
    expect(styleQuery(next)).toEqual({ bfont: "oswald", qbs: "color", formats: "dv,atmos" })
    // The profile now carries the frozen concrete values, not nulls.
    expect(next.landscape.badgeFont).toBe("oswald")
    expect(next.landscape.qualityBadgeStyle).toBe("color")
    expect(next.landscape.videoFormats).toEqual(["dv", "atmos"])
    // Control: without the freeze the query WOULD move (test sensitivity).
    const unfrozen = { ...current, ...portraitPresetPatch(preset) }
    expect(styleQuery(unfrozen)).toEqual({ bfont: "inter", qbs: "standard", formats: "hdr" })
  })
})
