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
import { DEFAULT_SASH_ORDER } from "@/lib/badge-priority"
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

function openAdvanced() {
  const t = screen.getByTestId("badge-advanced-toggle")
  if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
}

function openGroup(id: string) {
  openAdvanced()
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
    expect(screen.queryByRole("switch", { name: "ui.rankingsToggle" })).toBeNull()
  })

  it("group toggles expand/collapse with 44px touch targets", async () => {
    renderBadge()
    await act(async () => {})
    openAdvanced()
    const t = toggle("overlay")
    expect(t.className).toContain("min-h-[44px]")
    fireEvent.click(t)
    expect(t).toHaveAttribute("aria-expanded", "true")
    expect(groupBody("overlay").hasAttribute("hidden")).toBe(false)
    expect(screen.getByRole("switch", { name: "ui.rankingsToggle" })).toBeInTheDocument()
    fireEvent.click(t)
    expect(t).toHaveAttribute("aria-expanded", "false")
    expect(groupBody("overlay").hasAttribute("hidden")).toBe(true)
  })
})

describe("real toggles inside disclosures", () => {
  it("extras master hides every non-rank bucket and never touches the classification", async () => {
    const { ctx } = renderBadge()
    await act(async () => {})
    openAdvanced()
    // OFF: awards/extras/upcoming/new/next-episode gone, rank bucket intact
    // and the shared plate gate untouched (classification follows its switch).
    fireEvent.click(screen.getByRole("switch", { name: "ui.badgeExtraToggle" }))
    expect(ctx().defaultRankingBadges).toBe(true)
    expect(ctx().defaultSashOrder).toEqual(["rank"])
    fireEvent.click(screen.getByRole("switch", { name: "ui.badgeExtraToggle" }))
    expect(ctx().defaultRankingBadges).toBe(true)
    expect(ctx().defaultSashOrder).toEqual([...DEFAULT_SASH_ORDER])
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
    fireEvent.click(screen.getByRole("switch", { name: "ui.rankingsToggle" }))
    expect(ctx().landscape.sashOrder ?? []).not.toContain("rank")
    expect(ctx().defaultSashOrder).toContain("rank")
    expect(ctx().defaultPosterShape).toBe("poster")
  })
})

describe("families stay on the child cards", () => {
  it("Classifica card comes first; overlay keeps info+quality, style genre/extra, base info/ratings", async () => {
    renderBadge()
    await act(async () => {})
    const fams = (id: string) =>
      Array.from(groupBody(id).querySelectorAll("[data-preview-family]")).map((el) =>
        el.getAttribute("data-preview-family"),
      )
    // The Classifica card moved OUT of the overlay group and now sits above
    // every macro-group (first position in the Badge tab).
    const classifica = screen.getByTestId("badge-classifica-card")
    expect(classifica.getAttribute("data-preview-family")).toBe("rank")
    expect(fams("overlay")).not.toContain("rank")
    // Bodies stay mounted when collapsed, so families are queryable any time.
    expect(fams("overlay")).toContain("info")
    expect(fams("overlay")).toContain("quality")
    // Preset-first: the builtin preset card (auto family) sits above the
    // groups; the style group keeps its genre card plus the standalone extra
    // style card, which reports the dedicated `extra` family (never the
    // generic `info`) so the preview shows the extra-bucket sample.
    expect(fams("style")).toEqual(expect.arrayContaining(["genre", "extra"]))
    expect(fams("style")).not.toContain("info")
    expect(fams("style")).not.toContain("auto")
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
