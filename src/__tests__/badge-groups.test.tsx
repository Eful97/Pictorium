/**
 * T3 badge macro-groups: Stile & Preset, Contenuti Base, Overlay Speciali,
 * Qualità & Formati.
 * - Groups are presentational disclosures (style/base open, overlay/quality
 *   collapsed); bodies stay mounted and hide via `hidden`.
 * - Setters, scope and preview families are untouched: real toggles inside
 *   disclosures write the same values, per-target isolation holds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen } from "@testing-library/react"
import { createElement } from "react"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.useFakeTimers()
})

function renderBadge(shape: "portrait" | "landscape" = "portrait") {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)))
  return { ctx: () => ctx as PosterEditorCtx }
}

function toggle(id: string): HTMLElement {
  return screen.getByTestId(`badge-group-${id}-toggle`)
}

function openGroup(id: string) {
  const t = toggle(id)
  if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
}

function groupBody(id: string): HTMLElement {
  const t = toggle(id)
  const bodyId = t.getAttribute("aria-controls")
  expect(bodyId).toBeTruthy()
  return document.getElementById(bodyId!) as HTMLElement
}

describe("macro-group layout", () => {
  it("renders four groups: style/base open, overlay/quality collapsed but mounted", async () => {
    renderBadge()
    await act(async () => {})
    for (const id of ["style", "base", "overlay", "quality"]) {
      expect(screen.getByTestId(`badge-group-${id}`)).toBeInTheDocument()
    }
    expect(toggle("style")).toHaveAttribute("aria-expanded", "true")
    expect(toggle("base")).toHaveAttribute("aria-expanded", "true")
    expect(toggle("overlay")).toHaveAttribute("aria-expanded", "false")
    expect(toggle("quality")).toHaveAttribute("aria-expanded", "false")
    // Collapsed bodies stay mounted (state preserved) and hide via `hidden`.
    expect(groupBody("overlay").hasAttribute("hidden")).toBe(true)
    expect(groupBody("quality").hasAttribute("hidden")).toBe(true)
    expect(groupBody("style").hasAttribute("hidden")).toBe(false)
    expect(groupBody("base").hasAttribute("hidden")).toBe(false)
    // Collapsed content is unreachable but present for state.
    expect(screen.queryByRole("switch", { name: "ui.topBadge" })).toBeNull()
  })

  it("group toggles expand/collapse with 44px touch targets", async () => {
    renderBadge()
    await act(async () => {})
    const t = toggle("overlay")
    expect(t.className).toContain("min-h-[44px]")
    fireEvent.click(t)
    expect(t).toHaveAttribute("aria-expanded", "true")
    expect(groupBody("overlay").hasAttribute("hidden")).toBe(false)
    expect(screen.getByRole("switch", { name: "ui.topBadge" })).toBeInTheDocument()
    fireEvent.click(t)
    expect(t).toHaveAttribute("aria-expanded", "false")
    expect(groupBody("overlay").hasAttribute("hidden")).toBe(true)
  })
})

describe("real toggles inside disclosures", () => {
  it("overlay master off/on writes the same values as before", async () => {
    const { ctx } = renderBadge()
    await act(async () => {})
    openGroup("overlay")
    fireEvent.click(screen.getByRole("switch", { name: "ui.topBadge" }))
    expect(ctx().defaultSashOrder).toEqual([])
    fireEvent.click(screen.getByRole("switch", { name: "ui.topBadge" }))
    expect(ctx().defaultSashOrder.length).toBeGreaterThan(0)
  })

  it("quality toggle and network stay in their groups with untouched scope", async () => {
    const { ctx } = renderBadge()
    await act(async () => {})
    openGroup("quality")
    fireEvent.click(screen.getByRole("switch", { name: "ui.badgeQuality" }))
    expect(ctx().defaultBadgeQuality).toBe(false)
    openGroup("overlay")
    fireEvent.click(screen.getByRole("switch", { name: "ui.networkLogo" }))
    expect(ctx().defaultNetworkLogo).toBe(false)
  })

  it("landscape edits through disclosures touch only the profile", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    openGroup("overlay")
    fireEvent.click(screen.getByRole("switch", { name: "ui.sash_rank" }))
    expect(ctx().landscape.sashOrder ?? []).not.toContain("rank")
    expect(ctx().defaultSashOrder).toContain("rank")
    expect(ctx().defaultPosterShape).toBe("poster")
  })
})

describe("families stay on the child cards", () => {
  it("overlay keeps rank + info, style keeps auto/genre/info, base info/ratings, quality quality", async () => {
    renderBadge()
    await act(async () => {})
    const fams = (id: string) =>
      Array.from(groupBody(id).querySelectorAll("[data-preview-family]")).map((el) =>
        el.getAttribute("data-preview-family"),
      )
    // Bodies stay mounted when collapsed, so families are queryable any time.
    expect(fams("overlay")).toContain("rank")
    expect(fams("overlay")).toContain("info")
    expect(fams("overlay")).toContain("quality")
    expect(fams("style")).toEqual(expect.arrayContaining(["auto", "genre", "info"]))
    expect(fams("base")).toEqual(expect.arrayContaining(["info", "ratings"]))
    expect(fams("quality")).not.toContain("rank")
    for (const f of fams("quality")) expect(f).toBe("quality")
  })
})

describe("t3 i18n (18 lingue)", () => {
  it("every dictionary defines the group keys with non-empty values", async () => {
    const mods = await Promise.all([
      import("@/lib/translations/ar.json"),
      import("@/lib/translations/cs.json"),
      import("@/lib/translations/de.json"),
      import("@/lib/translations/en.json"),
      import("@/lib/translations/es-419.json"),
      import("@/lib/translations/es.json"),
      import("@/lib/translations/fr.json"),
      import("@/lib/translations/he.json"),
      import("@/lib/translations/it.json"),
      import("@/lib/translations/ja.json"),
      import("@/lib/translations/ko.json"),
      import("@/lib/translations/nl.json"),
      import("@/lib/translations/pl.json"),
      import("@/lib/translations/pt.json"),
      import("@/lib/translations/ro.json"),
      import("@/lib/translations/sv.json"),
      import("@/lib/translations/tr.json"),
      import("@/lib/translations/vi.json"),
    ])
    const langs = ["ar","cs","de","en","es-419","es","fr","he","it","ja","ko","nl","pl","pt","ro","sv","tr","vi"] as const
    const keys = ["ui.badgeGroupStyle","ui.badgeGroupBase","ui.badgeGroupOverlay","ui.badgeGroupQuality"] as const
    expect(mods).toHaveLength(18)
    mods.forEach((mod, i) => {
      const dict = (mod as { default: Record<string, string> }).default ?? (mod as unknown as Record<string, string>)
      for (const key of keys) {
        expect(dict[key]?.trim(), `${langs[i]}:${key}`).toBeTruthy()
      }
    })
  })
})
