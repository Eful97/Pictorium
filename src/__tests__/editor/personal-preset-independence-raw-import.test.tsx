/**
 * Personal raw-import null-profile inheritance (cycle 1).
 *
 * Stored preset parsed STRICTLY (valid API new strict schema): flats own
 * Fresh/Card + ranked scope + extra Colored + age ON + nullable font/video
 * quality, while the landscape profile is null/absent (inherit). Applying
 * must resolve those inherit keys against the STORED snapshot, never the
 * live previous look — in both shapes, thumb = post-apply, stored bytes
 * never rewritten on render, legacy v1 still canonical, explicit concrete /
 * follow-rank / logo-auto nulls preserved, other format frozen, no persist
 * before Save (localStorage + PUT).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { APPLE_VISUAL_DEFAULTS } from "@/lib/default-visual-presets"
import {
  applyPersonalLandscapeIsolated,
  normalizePersonalPreset,
  personalLandscapeProfilePatch,
  resolveEffectiveLandscape,
  visualPresetInputSchema,
  type VisualPresetValues,
} from "@/lib/visual-presets"
import { buildPresetFile, parsePresetFileText, planVisualImport } from "@/lib/preset-file"
import { buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { resetGuestGuardForTests } from "@/lib/guest-guard"
import { __resetAdminTokenForTests } from "@/lib/admin-token"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

function baseValues(): VisualPresetValues {
  return structuredClone(APPLE_VISUAL_DEFAULTS)
}

/** Stored imported look: flats own the recipe, profile inherits (null/absent). */
function importedRawValues(): Record<string, unknown> {
  const v = baseValues() as unknown as Record<string, unknown>
  return {
    ...v,
    defaultPosterLayout: "fresh",
    defaultPosterFreshScope: "ranked",
    defaultExtraBadgeStyle: "colored",
    defaultAgeBadge: true,
    defaultAgeCountry: "GB",
    defaultAgeBadgeStyle: "knockout",
    defaultBadgeFont: "oswald",
    defaultQualityBadgeStyle: "mono",
    defaultVideoFormats: ["dv", "hdr"],
    defaultLogoScale: 100,
    defaultLogoOffsetX: 10,
    defaultLogoOffsetY: -5,
    landscape: {
      posterLayout: null,
      posterFreshScope: null,
      extraBadgeStyle: null,
      ageBadge: null,
      ageCountry: null,
      ageBadgeStyle: null,
      badgeFont: null,
      qualityBadgeStyle: null,
      videoFormats: null,
      // Explicit auto/zero shape-local contract: must stay null (wins).
      logoScale: null,
      logoOffsetX: null,
      logoOffsetY: null,
    },
  }
}

function strictParseImported(raw: Record<string, unknown>): VisualPresetValues {
  const parsed = visualPresetInputSchema.parse({
    name: "ImportedWide",
    shape: "landscape",
    values: raw,
  })
  return parsed.values
}

describe("personal raw-import null-profile resolves against stored snapshot (helper)", () => {
  it("strict parse accepts null-profile import; stored bytes frozen on render", () => {
    const raw = importedRawValues()
    const parsed = strictParseImported(raw)
    expect(parsed.defaultPosterLayout).toBe("fresh")
    expect(parsed.defaultExtraBadgeStyle).toBe("colored")
    const before = JSON.stringify(parsed)
    // Render-only resolutions must not rewrite the stored snapshot.
    void normalizePersonalPreset(parsed)
    void resolveEffectiveLandscape(parsed)
    void personalLandscapeProfilePatch(parsed)
    expect(JSON.stringify(parsed)).toBe(before)
  })

  it("legacy v1 missing appearance stays canonical deterministic standard", () => {
    const modern = importedRawValues() as unknown as VisualPresetValues
    const legacy: Record<string, unknown> = { ...(modern as unknown as Record<string, unknown>) }
    for (const k of [
      "defaultPosterLayout",
      "defaultPosterFreshScope",
      "defaultExtraBadgeStyle",
      "defaultAgeBadge",
      "defaultAgeCountry",
      "defaultAgeBadgeStyle",
    ]) delete legacy[k]
    const land = { ...((legacy.landscape ?? {}) as Record<string, unknown>) }
    for (const k of ["posterLayout", "posterFreshScope", "extraBadgeStyle", "ageBadge", "ageCountry", "ageBadgeStyle"]) delete land[k]
    legacy.landscape = land
    const parsed = visualPresetInputSchema.parse({ name: "Old", values: legacy })
    expect(parsed.values.defaultPosterLayout).toBe("standard")
    expect(parsed.values.defaultPosterFreshScope).toBe("ranked")
    expect(parsed.values.defaultExtraBadgeStyle).toBeNull()
    expect(parsed.values.defaultAgeBadge).toBe(false)
    expect(parsed.values.defaultAgeCountry).toBe("IT")
    expect(parsed.values.defaultAgeBadgeStyle).toBe("standard")
  })

  it("null-profile import converges from Apple/Full/Standard/tuned seeds (landscape)", () => {
    const stored = strictParseImported(importedRawValues())
    const storedJson = JSON.stringify(stored)
    const seeds: VisualPresetValues[] = [
      { ...baseValues(), defaultPosterLayout: "standard", defaultExtraBadgeStyle: "pill", landscape: {} } as unknown as VisualPresetValues,
      { ...baseValues(), defaultPosterLayout: "standard", defaultBadgeStyle: "colored", defaultAgeBadge: false, landscape: {} } as unknown as VisualPresetValues,
      { ...baseValues(), defaultPosterLayout: "nuvio", defaultBadgeStyle: "shadow", defaultExtraBadgeStyle: "vetro", landscape: {} } as unknown as VisualPresetValues,
      { ...baseValues(), defaultPosterLayout: "fresh", defaultPosterFreshScope: "all", defaultExtraBadgeStyle: "bordo", defaultAgeBadge: true, landscape: {} } as unknown as VisualPresetValues,
    ]
    const patches: string[] = []
    for (const live of seeds) {
      const next = applyPersonalLandscapeIsolated(live, stored)
      const land = next.landscape as unknown as Record<string, unknown>
      // Owned recipe resolved from STORED snapshot, never the live seed.
      expect(land.posterLayout, "posterLayout follows stored fresh").toBe("fresh")
      expect(land.posterFreshScope, "scope follows stored ranked").toBe("ranked")
      expect(land.extraBadgeStyle, "extra follows stored colored").toBe("colored")
      expect(land.ageBadge, "age follows stored on").toBe(true)
      expect(land.ageCountry, "country follows stored GB").toBe("GB")
      expect(land.ageBadgeStyle, "age style follows stored knockout").toBe("knockout")
      expect(land.badgeFont, "font follows stored oswald").toBe("oswald")
      expect(land.qualityBadgeStyle, "quality follows stored mono").toBe("mono")
      expect(land.videoFormats, "formats follow stored").toEqual(["dv", "hdr"])
      // Explicit logo auto/zero nulls stay null (own-shape wins, never rebased).
      expect(land.logoScale).toBeNull()
      expect(land.logoOffsetX).toBeNull()
      expect(land.logoOffsetY).toBeNull()
      // Portrait flats + globals frozen (no leak into the other format).
      expect(next.defaultPosterLayout).toBe((live as unknown as Record<string, unknown>).defaultPosterLayout)
      expect(next.defaultBadgeStyle).toBe((live as unknown as Record<string, unknown>).defaultBadgeStyle)
      // Effective identity: applied resolves exactly like the stored snapshot.
      expect(resolveEffectiveLandscape(next)).toEqual(resolveEffectiveLandscape(normalizePersonalPreset(stored)))
      patches.push(JSON.stringify(land, Object.keys(land).sort()))
      // Stored snapshot bytes never rewritten by the apply.
      expect(JSON.stringify(stored)).toBe(storedJson)
    }
    expect(new Set(patches).size, "identical staged profile from every seed").toBe(1)
  })

  it("thumb = post-apply preview for the null-profile import", () => {
    const stored = strictParseImported(importedRawValues())
    const live = { ...baseValues(), defaultPosterLayout: "standard", landscape: {} } as unknown as VisualPresetValues
    const staged = applyPersonalLandscapeIsolated(live, stored)
    const urlOf = (v: VisualPresetValues) =>
      new URL(
        buildDefaultsPreviewUrl({ ...(v as unknown as Record<string, never>), previewShape: "landscape" } as never),
        "http://localhost",
      ).searchParams
    const a = urlOf(staged)
    const b = urlOf({ ...live, landscape: resolveEffectiveLandscape(normalizePersonalPreset(stored)) } as unknown as VisualPresetValues)
    expect(a.get("layout")).toBe("fresh")
    expect(a.get("layout")).toBe(b.get("layout"))
    expect(a.get("xbs")).toBe("colored")
    expect(a.get("xbs")).toBe(b.get("xbs"))
    expect(a.get("age")).toBe("1")
    expect(a.toString()).toBe(b.toString())
  })

  it("explicit concrete + follow-rank sentinels preserved, logo null untouched", () => {
    const stored = strictParseImported({
      ...importedRawValues(),
      landscape: {
        posterLayout: "nuvio",
        extraBadgeStyle: "follow-rank",
        badgeFont: "oswald",
        logoScale: null,
        logoOffsetX: null,
        logoOffsetY: null,
      },
    })
    const live = { ...baseValues(), defaultPosterLayout: "standard", landscape: {} } as unknown as VisualPresetValues
    const next = applyPersonalLandscapeIsolated(live, stored)
    const land = next.landscape as unknown as Record<string, unknown>
    expect(land.posterLayout).toBe("nuvio")
    expect(land.extraBadgeStyle).toBe("follow-rank")
    expect(land.badgeFont).toBe("oswald")
    expect(land.logoScale).toBeNull()
    expect(land.logoOffsetX).toBeNull()
    expect(land.logoOffsetY).toBeNull()
  })
})

/* ---------- SettingsPanel: imported personal landscape apply, no persist before Save ---------- */

let puts: { url: string; body: Record<string, unknown> }[]
let presetStore: { id: string; name: string; shape: "portrait" | "landscape"; values: unknown }[]
let presetSeq = 0

beforeEach(() => {
  localStorage.clear()
  puts = []
  presetStore = []
  presetSeq = 0
  vi.clearAllMocks()
  resetGuestGuardForTests()
  __resetAdminTokenForTests()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push({ url: u, body: JSON.parse(init.body as string) })
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
      }
      if (u.includes("/api/defaults/presets")) {
        const ok = (presets: unknown) => ({
          ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ presets }), text: async () => JSON.stringify({ presets }),
        })
        const shapeList = (shape: string) =>
          presetStore.filter((p) => p.shape === shape).map((p) => ({ id: p.id, name: p.name, shape: p.shape, values: p.values }))
        if (init?.method === "POST" || init?.method === "DELETE") {
          const body = JSON.parse(init.body as string) as { name?: string; shape?: string; values?: unknown; id?: string }
          const target = body.shape === "landscape" ? "landscape" : "portrait"
          if (init.method === "POST" && body.name && body.values) {
            const existing = presetStore.find((p) => p.shape === target && p.name === body.name)
            if (existing) existing.values = body.values
            else presetStore.push({ id: `p-${++presetSeq}`, name: body.name, shape: target, values: body.values })
          } else if (init.method === "DELETE" && body.id) {
            presetStore = presetStore.filter((p) => !(p.id === body.id && p.shape === target))
          }
          return ok(shapeList(target))
        }
        const parsed = new URL(u, "http://localhost")
        const shape = parsed.searchParams.get("shape") === "landscape" ? "landscape" : "portrait"
        return ok(shapeList(shape))
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
    }),
  )
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function renderPanel() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const rendered = renderWithCtx(
    createElement("div", null, createElement(SettingsPanel, { setSettingsOpen: () => {}, exportData: () => {}, importData: () => {} }), createElement(Probe)),
  )
  // Fresh open lands on Preferenze (secondary): the gallery + format target
  // used below live on primary tabs.
  fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
  return { ctx: () => ctx as unknown as PosterEditorCtx, unmount: rendered.unmount }
}

function seedStorage(payload: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify({ defaultPosterShape: "poster", defaultRatingSources: ["imdb", "tmdb"], ...payload }))
}

describe("SettingsPanel imported personal landscape apply (no persist before Save)", () => {
  it("imported null-profile landscape converges from divergent seeds without staging writes", async () => {
    vi.useRealTimers()
    // Simulate a preset-file import through the real strict pipeline.
    const raw = importedRawValues()
    const file = buildPresetFile({ visual: [{ name: "ImportedWide", shape: "landscape", values: raw as unknown as VisualPresetValues }] })
    const round = parsePresetFileText(JSON.stringify(file))
    expect(round.ok).toBe(true)
    if (!round.ok) return
    const planned = planVisualImport({ portrait: [], landscape: [] }, round.visual)
    expect(planned.toAdd).toHaveLength(1)
    const importedValues = planned.toAdd[0].values
    // Server-stored imported preset (as if POSTed by the import flow).
    presetStore.push({ id: "p-1", name: "ImportedWide", shape: "landscape", values: importedValues })

    const seeds: Array<{ name: string; profile: Record<string, unknown> }> = [
      { name: "standard-live", profile: { posterLayout: "standard", extraBadgeStyle: "vetro", badgeFont: "inter" } },
      { name: "fresh-live", profile: { posterLayout: "fresh", extraBadgeStyle: "bordo", ageBadge: true } },
    ]
    const thumbs: string[] = []
    const lands: string[] = []
    for (const { name, profile } of seeds) {
      localStorage.clear()
      puts = []
      seedStorage({ defaultBadgeStyle: "shadow", defaultAgeBadge: false, landscape: profile })
      const { unmount } = renderPanel()
      fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText("ui.posterShapeLandscape"))
      fireEvent.click(screen.getByRole("tab", { name: "ui.settingsTabPreset" }))
      fireEvent.click(within(screen.getByTestId("presets-panel")).getByTestId("visual-presets-toggle"))
      await screen.findByTitle("ImportedWide")
      const tile = screen.getByTitle("ImportedWide").closest("button") as HTMLElement
      // Snapshot defaults-related storage BEFORE any staged apply.
      const storedBefore = localStorage.getItem("badgeDefaults")
      expect(storedBefore, `seed storage present (${name})`).not.toBeNull()
      // Thumbnail already renders the stored imported look (post-apply identity).
      const img = tile.querySelector("img")
      expect(img, `real thumbnail (${name})`).not.toBeNull()
      const thumbBefore = img?.getAttribute("src") ?? ""
      expect(thumbBefore).toContain("/api/poster/")
      fireEvent.click(tile)
      expect(tile).toHaveAttribute("aria-pressed", "true")
      const thumbAfter = (tile.querySelector("img")?.getAttribute("src") ?? "").split("&rv=")[0]
      const thumbKey = (src: string) => {
        const p = new URL(src, "http://localhost").searchParams
        p.delete("rv")
        p.delete("rsrc")
        return p.toString()
      }
      thumbs.push(thumbKey(tile.querySelector("img")?.getAttribute("src") ?? ""))
      // No persist before the explicit Save: neither PUT nor localStorage moves.
      expect(puts, `no writes before Save (${name})`).toHaveLength(0)
      expect(localStorage.getItem("badgeDefaults"), `localStorage frozen before Save (${name})`).toBe(storedBefore)
      void thumbBefore
      void thumbAfter
      fireEvent.click(screen.getByTestId("settings-save"))
      await screen.findByText("ui.synced")
      expect(puts, `single Save (${name})`).toHaveLength(1)
      const land = puts[0].body.landscape as Record<string, unknown>
      expect(land.posterLayout).toBe("fresh")
      expect(land.extraBadgeStyle).toBe("colored")
      expect(land.ageBadge).toBe(true)
      expect(land.badgeFont).toBe("oswald")
      expect(land.logoScale).toBeNull()
      // Portrait flats frozen.
      expect(puts[0].body.badgeStyle).toBe("shadow")
      lands.push(JSON.stringify(land, Object.keys(land).sort()))
      unmount()
      cleanup()
    }
    expect(new Set(thumbs).size, "imported thumb identical from every seed").toBe(1)
    expect(new Set(lands).size, "imported staged profile identical from every seed").toBe(1)
  })
})
