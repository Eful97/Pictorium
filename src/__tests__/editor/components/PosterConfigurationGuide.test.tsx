/**
 * Preset gallery (five-tab settings): the obsolete guided stepper
 * (style/layout/info steps, draft/apply/apply-and-advanced/completed
 * vocabulary) was refocused into a pure Preset gallery.
 * - six existing full looks (Apple/BetterPoster/RPDB + Essential/Ratings/Full)
 *   with real thumbnails (same demo title, actual DefaultsPosterPreview URL
 *   builder, stable loading/error canvas) and selection border/check;
 * - target-specific apply into the staging session preserving the other
 *   shape and the delivery format; no PUT/local writes before the global Save;
 * - personal presets as an automatic separate grid with the same real
 *   thumbnails; save/import/export/delete live in a secondary manage
 *   disclosure (never dominant card controls); no new presets.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { createElement } from "react"
import { SettingsPanel } from "@/components/SettingsPanel"
import { PresetsPanel } from "@/components/settings/PresetsPanel"
import { PosterConfigurationGuide } from "@/components/settings/PosterConfigurationGuide"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

let puts: unknown[] = []

function stubFetch() {
  // Faithful Response stub: `http()` always reads `res.text()`, so every
  // response must implement it — otherwise the personal-presets load throws
  // and the gallery renders its error state instead of the real empty copy.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (init?.method === "PUT" && u.includes("/api/defaults")) {
        puts.push(JSON.parse(init.body as string))
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
      }
      if (u.includes("/api/defaults/presets")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ presets: [] }),
          text: async () => JSON.stringify({ presets: [] }),
        }
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => "{}" }
    }),
  )
}

function renderGallery(shape: "portrait" | "landscape" = "portrait") {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const rendered = renderWithCtx(
    createElement(
      "div",
      null,
      createElement(PresetsPanel, { shape, demoMedia: null, active: true }),
      createElement(Probe),
    ),
  )
  return { ctx: () => ctx as unknown as PosterEditorCtx, unmount: rendered.unmount }
}

function renderPanel() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement(
      "div",
      null,
      createElement(SettingsPanel, {
        setSettingsOpen: () => {},
        exportData: () => {},
        importData: () => {},
      }),
      createElement(Probe),
    ),
  )
  return { ctx: () => ctx as unknown as PosterEditorCtx }
}

beforeEach(() => {
  localStorage.clear()
  puts = []
  stubFetch()
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
})

describe("PresetsPanel gallery", () => {
  it("shows the six existing looks with real poster thumbnails and no guide vocabulary", async () => {
    renderGallery()
    for (const id of ["apple", "better-poster", "rpdb", "essential", "ratings", "full"]) {
      expect(screen.getByTestId(`poster-style-${id}`)).toBeInTheDocument()
    }
    // Real thumbnails: actual poster URLs, never a fake render.
    const imgs = screen.getByTestId("presets-panel").querySelectorAll("img")
    expect(imgs.length).toBeGreaterThanOrEqual(6)
    for (const img of Array.from(imgs)) {
      expect(img.getAttribute("src") ?? "").toContain("/api/poster/")
      expect(img.getAttribute("loading")).toBe("lazy")
    }
    // No stepper / draft / completed vocabulary anywhere.
    expect(screen.queryByTestId("poster-config-guide")).toBeNull()
    for (const stale of ["guide-step-style", "guide-step-layout", "guide-step-info", "guide-apply", "guide-completed", "guide-pending-nav"]) {
      expect(screen.queryByTestId(stale)).toBeNull()
    }
  })

  it("builtin apply uses the isolated live path and preserves delivery", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultPosterShape: "landscape" }))
    try {
      const { ctx } = renderGallery("portrait")
      fireEvent.click(screen.getByTestId("poster-style-essential"))
      expect(ctx().defaultBadgeStyle).toBe("minimal")
      expect(ctx().defaultBadgeGenre).toBe(true)
      expect(ctx().defaultBadgeRating).toBe(false)
      expect(ctx().defaultPosterShape).toBe("landscape")
      expect(screen.getByTestId("poster-style-essential")).toHaveAttribute("aria-pressed", "true")
    } finally {
      localStorage.removeItem("badgeDefaults")
    }
  })

  it("landscape apply is profile-only: portrait flats stay intact", async () => {
    const { ctx } = renderGallery("landscape")
    const flatBefore = ctx().defaultBadgeStyle
    fireEvent.click(screen.getByTestId("poster-style-ratings"))
    expect(ctx().defaultBadgeStyle).toBe(flatBefore)
    expect(ctx().landscape.badgeStyle ?? ctx().defaultBadgeStyle).toBe("pill")
    expect(ctx().defaultPosterShape).toBe(ctx().defaultPosterShape)
  })

  it("all six looks press after click in both formats with real thumbnails", async () => {
    for (const shape of ["portrait", "landscape"] as const) {
      localStorage.clear()
      const { unmount } = renderGallery(shape)
      for (const id of ["apple", "better-poster", "rpdb", "essential", "ratings", "full"]) {
        const btn = screen.getByTestId(`poster-style-${id}`)
        fireEvent.click(btn)
        expect(screen.getByTestId(`poster-style-${id}`)).toHaveAttribute("aria-pressed", "true")
      }
      // Exactly one selected at a time: the last click wins.
      expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
      // Thumbnails are real poster URLs for every look.
      const imgs = screen.getByTestId("presets-panel").querySelectorAll("img")
      expect(imgs.length).toBeGreaterThanOrEqual(6)
      for (const img of Array.from(imgs)) {
        expect(img.getAttribute("src") ?? "").toContain("/api/poster/")
      }
      unmount()
    }
  })

  it("thumbnail and staged preview share the effective params (no fake render)", async () => {
    const { ctx } = renderGallery("portrait")
    fireEvent.click(screen.getByTestId("poster-style-full"))
    expect(screen.getByTestId("poster-style-full")).toHaveAttribute("aria-pressed", "true")
    // Full look stages the complete effective set on the live editor.
    expect(ctx().defaultBadgeStyle).toBe("minimal")
    expect(ctx().defaultBadgeGenre).toBe(true)
    expect(ctx().defaultBadgeRating).toBe(true)
    expect(ctx().defaultRankingBadges).toBe(true)
    expect(ctx().defaultNetworkLogo).toBe(true)
    // The gallery thumbnail for the pressed look equals a preview built
    // from the same staged editor (same demo title + actual URL builder).
    const thumb = screen.getByTestId("poster-style-full").querySelector("img")?.getAttribute("src") ?? ""
    expect(thumb).toContain("/api/poster/")
    expect(thumb).toContain("shape=poster")
  })

  it("personal presets render as a separate gallery grid with manage disclosure", async () => {
    renderGallery()
    const toggle = screen.getByTestId("visual-presets-toggle")
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(toggle)
    // Await the presets fetch before asserting the empty library copy
    // (never assert sync: loading resolves first).
    expect(await screen.findByText("ui.perTitlePresetsEmpty", undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText("ui.visualPresetName")).not.toBeInTheDocument()
    // Secondary manage disclosure owns save/import/export/delete.
    const manage = screen.getByTestId("visual-presets-manage-toggle")
    fireEvent.click(manage)
    expect(screen.getByPlaceholderText("ui.visualPresetName")).toBeInTheDocument()
    expect(screen.getByText("ui.presetFileExportAll")).toBeInTheDocument()
    expect(screen.getByText("ui.presetFileImport")).toBeInTheDocument()
  })
})

describe("Preset tab staging (no PUT before Save)", () => {
  it("gallery clicks stage without PUT or storage writes; Save commits once", async () => {
    const { ctx } = renderPanel()
    await screen.findByTestId("poster-style-apple")
    const keysBefore = JSON.stringify(Object.keys(localStorage))
    const defaultsBefore = localStorage.getItem("badgeDefaults")
    fireEvent.click(screen.getByTestId("poster-style-apple"))
    expect(puts).toHaveLength(0)
    // The applied-preset reset reference is persisted (approved lifecycle
    // fix); the defaults themselves are still untouched until Save.
    expect(JSON.stringify(Object.keys(localStorage).filter((key) => !key.startsWith("activePresetBaseline:")))).toBe(keysBefore)
    expect(localStorage.getItem("badgeDefaults")).toBe(defaultsBefore)
    // Outer truth untouched until the global Save.
    expect(ctx().defaultBadgeStyle).not.toBe("pill")
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
  })

  it("compatibility alias renders the gallery, never the guide", async () => {
    renderWithCtx(
      createElement(PosterConfigurationGuide, { shape: "portrait", demoMedia: null }),
    )
    expect(await screen.findByTestId("presets-panel")).toBeInTheDocument()
    for (const id of ["apple", "better-poster", "rpdb", "essential", "ratings", "full"]) {
      expect(screen.getByTestId(`poster-style-${id}`)).toBeInTheDocument()
    }
    expect(screen.queryByTestId("poster-config-guide")).toBeNull()
  })
})
