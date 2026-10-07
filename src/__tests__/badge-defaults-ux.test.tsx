/**
 * T5a defaults UX: Classifica vs Informazioni vs Valutazioni vs Qualita.
 * - Rank toggle is a surgical sashOrder bucket (never the rankingBadges master).
 * - Single rank appearance (Nastro/Numero/Badge) writes canonical rs+ribbon;
 *   no duplicated ribbon switch lives in the Classifica card.
 * - Extra style (xbs) is independent from rs; null legacy is never migrated
 *   on mount/read (inherited hint shown); the first user rank change freezes
 *   the legacy extra look into xbs so extras keep their pixels.
 * - Landscape edits touch only the profile; delivery shape + portrait flats
 *   stay intact. Priorities (sash order) survive master off/on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement } from "react"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { DefaultsPosterPreview } from "@/components/settings/DefaultsPosterPreview"
import {
  resolveRankingAppearance,
  resolveRankVariant,
  resolveRibbonVariant,
  rankingAppearanceValue,
  rankVariantValue,
  ribbonVariantValue,
  legacyExtraStyleForRank,
} from "@/components/RankingAppearanceSelector"
import { resolvePosterRenderConfig, type PosterRenderConfigInput } from "@/lib/poster-config"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { DEFAULT_SASH_ORDER } from "@/lib/badge-priority"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  vi.useFakeTimers()
})

function renderBadge(shape: "portrait" | "landscape") {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(createElement("div", null, createElement(BadgeDefaultsSection, { active: true, shape }), createElement(Probe)))
  openBadgeGroup("overlay")
  return { ctx: () => ctx as PosterEditorCtx }
}

function badgeSwitch(name: string): HTMLElement {
  return screen.getByRole("switch", { name })
}

// T3 macro-groups: overlay/quality start collapsed (bodies mounted + hidden).
// Open disclosures before touching their controls; assertions unchanged.
function openBadgeGroup(...ids: Array<"style" | "base" | "overlay" | "quality">) {
  for (const id of ids) {
    const t = screen.getByTestId(`badge-group-${id}-toggle`)
    if (t.getAttribute("aria-expanded") !== "true") fireEvent.click(t)
  }
}

function appearanceGroup(): HTMLElement {
  return screen.getByRole("radiogroup", { name: "ui.rankFamily" })
}

function clickRadio(group: HTMLElement, name: string) {
  fireEvent.click(within(group).getByRole("radio", { name }))
}

describe("rank bucket toggle", () => {
  it("rank OFF keeps new/extra buckets and the master ON", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    expect(ctx().defaultSashOrder).toContain("rank")
    fireEvent.click(badgeSwitch("ui.sash_rank"))
    expect(ctx().defaultSashOrder).not.toContain("rank")
    expect(ctx().defaultSashOrder).toContain("new")
    expect(ctx().defaultSashOrder).toContain("extra")
    // Master untouched: still renders every other top badge.
    expect(badgeSwitch("ui.topBadge").getAttribute("aria-checked")).toBe("true")
    expect(ctx().defaultRankingBadges).toBe(true)
    // Back ON reinserts rank at its canonical slot.
    fireEvent.click(badgeSwitch("ui.sash_rank"))
    expect(ctx().defaultSashOrder).toEqual([...DEFAULT_SASH_ORDER])
  })
})

describe("single rank appearance", () => {
  it("choices write canonical rs+ribbon and never a second ribbon switch", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    const group = appearanceGroup()
    // Three choices, no duplicated ribbon toggle in the Classifica card.
    expect(within(group).getAllByRole("radio")).toHaveLength(3)
    expect(screen.queryByRole("switch", { name: "ui.ribbon" })).toBeNull()
    // The generic style panel holds no rank switch either.
    expect(screen.queryByText("ui.styleRankingDefault")).toBeNull()

    clickRadio(group, "ui.number")
    expect(ctx().defaultRankingBadgeStyle).toBe("number")
    expect(ctx().defaultRibbonEnabled).toBe(true)

    clickRadio(group, "ui.ribbon")
    expect(ctx().defaultRankingBadgeStyle).toBe("netflix")
    expect(ctx().defaultRibbonEnabled).toBe(true)

    clickRadio(group, "ui.badgeSection")
    expect(ctx().defaultRankingBadgeStyle).toBe("pill")
    expect(ctx().defaultRibbonEnabled).toBe(true)
  })

  it("pure mapping helpers stay canonical (renderer truth)", () => {
    // Ribbon styles (netflix/netflix-color/colored) read Nastro with the
    // ribbon on — colored included — and Badge with it off.
    expect(resolveRankingAppearance({ rankingBadgeStyle: "default", ribbonEnabled: true })).toBe("nastro")
    expect(resolveRankingAppearance({ rankingBadgeStyle: "default", ribbonEnabled: false })).toBe("badge")
    expect(resolveRankingAppearance({ rankingBadgeStyle: "netflix", ribbonEnabled: true })).toBe("nastro")
    expect(resolveRankingAppearance({ rankingBadgeStyle: "netflix", ribbonEnabled: false })).toBe("badge")
    expect(resolveRankingAppearance({ rankingBadgeStyle: "netflix-color", ribbonEnabled: true })).toBe("nastro")
    expect(resolveRankingAppearance({ rankingBadgeStyle: "netflix-color", ribbonEnabled: false })).toBe("badge")
    expect(resolveRankingAppearance({ rankingBadgeStyle: "colored", ribbonEnabled: true })).toBe("nastro")
    expect(resolveRankingAppearance({ rankingBadgeStyle: "colored", ribbonEnabled: false })).toBe("badge")
    expect(resolveRankingAppearance({ rankingBadgeStyle: "number", ribbonEnabled: false })).toBe("numero")
    expect(resolveRankingAppearance({ rankingBadgeStyle: "pill", ribbonEnabled: false })).toBe("badge")
    expect(resolveRankingAppearance({ rankingBadgeStyle: "corner", ribbonEnabled: true })).toBe("badge")
    expect(rankingAppearanceValue("nastro")).toEqual({ rankingBadgeStyle: "netflix", ribbonEnabled: true })
    expect(rankingAppearanceValue("numero")).toEqual({ rankingBadgeStyle: "number", ribbonEnabled: true })
    expect(rankingAppearanceValue("badge")).toEqual({ rankingBadgeStyle: "pill", ribbonEnabled: true })
    // Variant reads: explicit centered styles read themselves, legacy
    // ribbon-shaped/default values read standard (never a false pill).
    expect(resolveRankVariant("pill")).toBe("pill")
    expect(resolveRankVariant("colored")).toBe("colored")
    expect(resolveRankVariant("bordo")).toBe("bordo")
    expect(resolveRankVariant("vetro")).toBe("vetro")
    expect(resolveRankVariant("corner")).toBe("corner")
    expect(resolveRankVariant("default")).toBe("standard")
    expect(resolveRankVariant("netflix")).toBe("standard")
    expect(resolveRankVariant("netflix-color")).toBe("standard")
    expect(resolveRankVariant(null)).toBe("standard")
    // Variant writes: colored/standard switch the ribbon off (otherwise the
    // renderer would raise the Nastro); opaque centered variants keep it on.
    expect(rankVariantValue("pill")).toEqual({ rankingBadgeStyle: "pill", ribbonEnabled: true })
    expect(rankVariantValue("bordo")).toEqual({ rankingBadgeStyle: "bordo", ribbonEnabled: true })
    expect(rankVariantValue("vetro")).toEqual({ rankingBadgeStyle: "vetro", ribbonEnabled: true })
    expect(rankVariantValue("corner")).toEqual({ rankingBadgeStyle: "corner", ribbonEnabled: true })
    expect(rankVariantValue("colored")).toEqual({ rankingBadgeStyle: "colored", ribbonEnabled: false })
    expect(rankVariantValue("standard")).toEqual({ rankingBadgeStyle: "default", ribbonEnabled: false })
    // Legacy extra look frozen bitmap-equivalently.
    expect(legacyExtraStyleForRank("default")).toBe("default")
    expect(legacyExtraStyleForRank("netflix")).toBe("default")
    expect(legacyExtraStyleForRank("number")).toBe("corner")
    expect(legacyExtraStyleForRank("pill")).toBe("pill")
  })

  it("variant clicks write renderer-truth pairs (colored switches ribbon off)", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    const group = appearanceGroup()
    clickRadio(group, "ui.badgeSection")
    const variants = screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })
    fireEvent.click(within(variants).getByRole("radio", { name: "ui.colored" }))
    expect(ctx().defaultRankingBadgeStyle).toBe("colored")
    expect(ctx().defaultRibbonEnabled).toBe(false)
    expect(resolveRankingAppearance({ rankingBadgeStyle: "colored", ribbonEnabled: false })).toBe("badge")
    fireEvent.click(within(variants).getByRole("radio", { name: "ui.qbsStandard" }))
    expect(ctx().defaultRankingBadgeStyle).toBe("default")
    expect(ctx().defaultRibbonEnabled).toBe(false)
    fireEvent.click(within(variants).getByRole("radio", { name: "ui.pill" }))
    expect(ctx().defaultRankingBadgeStyle).toBe("pill")
    expect(ctx().defaultRibbonEnabled).toBe(true)
  })

  it("legacy default without ribbon reads Badge with standard selected (no false pill)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultRankingBadgeStyle: "default", defaultRibbonEnabled: false }))
    renderBadge("portrait")
    await act(async () => {})
    expect(appearanceGroup()).toBeInTheDocument()
    const variants = screen.getByRole("radiogroup", { name: "ui.styleRankingDefault" })
    expect(within(variants).getByRole("radio", { name: "ui.qbsStandard" })).toHaveAttribute("aria-checked", "true")
    expect(within(variants).getByRole("radio", { name: "ui.pill" })).toHaveAttribute("aria-checked", "false")
  })

  it("side control is Posizione Sinistra/Destra, never Nuvio/Stremio", async () => {
    renderBadge("portrait")
    await act(async () => {})
    const group = appearanceGroup()
    // Nastro selected by default (legacy default + ribbon): side row visible.
    expect(screen.getByRole("radiogroup", { name: "ui.position" })).toBeInTheDocument()
    expect(within(group).queryByText("Nuvio")).toBeNull()
    expect(within(group).queryByText("Stremio")).toBeNull()
    clickRadio(screen.getByRole("radiogroup", { name: "ui.position" }), "ui.sideRight")
  })
})

describe("extra style independence + legacy freeze", () => {
  it("read shows the inherited look without writing; explicit choice sticks", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    expect(ctx().defaultExtraBadgeStyle).toBeNull()
    // No migration write on mount/read.
    const stored = JSON.parse(localStorage.getItem("badgeDefaults") ?? "{}")
    expect(stored.defaultExtraBadgeStyle ?? null).toBeNull()
    expect(stored.extraBadgeStyle ?? null).toBeNull()
    // Honest hint: the effective inherited style, no fake selection.
    expect(screen.getByText("ui.inherited", { exact: false })).toBeInTheDocument()
    // Explicit user choice persists independently from rs.
    const extraBlock = screen.getByText("ui.extraBadgeStyle").closest("div") as HTMLElement
    fireEvent.click(within(extraBlock).getByText("ui.vetro"))
    expect(ctx().defaultExtraBadgeStyle).toBe("vetro")
    clickRadio(appearanceGroup(), "ui.number")
    expect(ctx().defaultRankingBadgeStyle).toBe("number")
    expect(ctx().defaultExtraBadgeStyle).toBe("vetro")
  })

  it("first rank change materializes the legacy extra look (extras keep pixels)", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    expect(ctx().defaultExtraBadgeStyle).toBeNull()
    clickRadio(appearanceGroup(), "ui.badgeSection")
    expect(ctx().defaultRankingBadgeStyle).toBe("pill")
    // Legacy default look frozen before rs moved it.
    expect(ctx().defaultExtraBadgeStyle).toBe(legacyExtraStyleForRank("default"))
  })
})

describe("landscape scope + priorities", () => {
  it("landscape rank toggle touches only the profile; delivery + portrait intact", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(badgeSwitch("ui.sash_rank"))
    expect(ctx().landscape.sashOrder ?? []).not.toContain("rank")
    expect(ctx().defaultSashOrder).toContain("rank")
    expect(ctx().defaultPosterShape).toBe("poster")
    expect(ctx().landscape.rankingBadgeStyle).toBeUndefined()
  })

  it("master OFF/ON preserves the global priority order", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    fireEvent.click(badgeSwitch("ui.topBadge"))
    expect(ctx().defaultSashOrder).toEqual([])
    fireEvent.click(badgeSwitch("ui.topBadge"))
    expect(ctx().defaultSashOrder).toEqual([...DEFAULT_SASH_ORDER])
  })
})

describe("roundtrip UI -> resolvePosterRenderConfig (rank present)", () => {
  function effective(rs: string, ribbon: boolean): { style: string; accent: boolean } {
    const input: PosterRenderConfigInput = {
      searchParams: new URLSearchParams({ rank: "3" }),
      mapping: null,
      configOverride: null,
      sd: { rankingBadgeStyle: rs as never, ribbonEnabled: ribbon },
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    }
    const r = resolvePosterRenderConfig(input)
    return { style: r.rankingBadgeStyle, accent: r.rankingBadgeAccent }
  }

  it("every appearance writes an effective style that matches what it shows", () => {
    // Nastro -> satin ribbon; Numero -> standalone numeral.
    expect(effective(...Object.values(rankingAppearanceValue("nastro")) as [string, boolean])).toEqual({ style: "netflix", accent: false })
    expect(effective(...Object.values(rankingAppearanceValue("numero")) as [string, boolean])).toEqual({ style: "number", accent: false })
    // Badge variants -> centered plates; colored keeps the accent tint.
    expect(effective(...Object.values(rankVariantValue("pill")) as [string, boolean])).toEqual({ style: "pill", accent: false })
    expect(effective(...Object.values(rankVariantValue("bordo")) as [string, boolean])).toEqual({ style: "bordo", accent: false })
    expect(effective(...Object.values(rankVariantValue("vetro")) as [string, boolean])).toEqual({ style: "vetro", accent: false })
    expect(effective(...Object.values(rankVariantValue("corner")) as [string, boolean])).toEqual({ style: "corner", accent: false })
    expect(effective(...Object.values(rankVariantValue("colored")) as [string, boolean])).toEqual({ style: "default", accent: true })
    expect(effective(...Object.values(rankVariantValue("standard")) as [string, boolean])).toEqual({ style: "default", accent: false })
  })

  it("legacy pairs resolve without writes (colored + ribbon reads Nastro)", () => {
    expect(effective("default", true)).toEqual({ style: "netflix", accent: false })
    expect(effective("default", false)).toEqual({ style: "default", accent: false })
    expect(effective("netflix", true)).toEqual({ style: "netflix", accent: false })
    expect(effective("netflix", false)).toEqual({ style: "default", accent: false })
    expect(effective("netflix-color", true)).toEqual({ style: "netflix-color", accent: false })
    expect(effective("netflix-color", false)).toEqual({ style: "default", accent: false })
    expect(effective("colored", true)).toEqual({ style: "colored", accent: false })
    expect(effective("colored", false)).toEqual({ style: "default", accent: true })
  })
})

describe("extra/category gating (independent from the genre master)", () => {
  it("portrait: genre master OFF hides genre/year only; extra controls stay", async () => {
    renderBadge("portrait")
    await act(async () => {})
    expect(screen.getByText("ui.badgeGenre")).toBeInTheDocument()
    fireEvent.click(badgeSwitch("ui.genreRatingBadge"))
    expect(screen.queryByText("ui.badgeGenre")).toBeNull()
    expect(screen.queryByText("ui.badgeYear")).toBeNull()
    // Extra family stays reachable with the top badge master on.
    expect(screen.getByText("ui.extraBadgeStyle")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.sash_rank" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.sash_extra" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.preRelease" })).toBeInTheDocument()
    expect(screen.getByText("ui.advancedBadgePriority")).toBeInTheDocument()
  })

  it("landscape follows the scoped flag; extra ignores profile and flat", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultGlobalBadges: true, landscape: { globalBadges: false } }))
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    // Scoped land=false hides genre/year even with the flat on (no root leak).
    expect(screen.queryByText("ui.badgeGenre")).toBeNull()
    expect(screen.getByText("ui.extraBadgeStyle")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "ui.sash_extra" })).toBeInTheDocument()
    expect(ctx().defaultGlobalBadges).toBe(true)
    expect(ctx().landscape.globalBadges).toBe(false)
  })

  it("landscape flat false + profile true shows genre (flat intact)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultGlobalBadges: false, landscape: { globalBadges: true } }))
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    expect(screen.getByText("ui.badgeGenre")).toBeInTheDocument()
    expect(ctx().defaultGlobalBadges).toBe(false)
    expect(ctx().landscape.globalBadges).toBe(true)
  })

  it("preview extra rendering is unaffected by the genre master", async () => {
    const opened: string[] = []
    class FakeXHR {
      onload: (() => void) | null = null
      responseType = ""
      timeout = 0
      status = 0
      response: unknown = null
      open(_method: string, url: string) {
        opened.push(String(url))
      }
      send() {}
      abort() {}
      setRequestHeader() {}
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultExtraBadgeStyle: "corner", defaultGlobalBadges: false }))
    renderWithCtx(createElement(DefaultsPosterPreview, { previewShape: "portrait" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(opened.length).toBeGreaterThan(0)
    expect(new URL(opened[opened.length - 1]).searchParams.get("xbs")).toBe("corner")
    // Config level: the effective extra style ignores the genre master.
    const r = resolvePosterRenderConfig({
      searchParams: new URLSearchParams(),
      mapping: null,
      configOverride: null,
      sd: { globalBadges: false, rankingBadges: true, extraBadgeStyle: "corner" },
      hasQuery: true,
      showBadges: false,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    })
    expect(r.extraBadgeStyle).toBe("corner")
  })
})

describe("no independent Coming Soon ribbon switch", () => {
  it("preRelease never touches the shared ribbon flag (legacy value preserved)", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    expect(screen.queryByRole("switch", { name: "ui.comingSoonRibbon" })).toBeNull()
    const before = ctx().defaultRibbonEnabled
    fireEvent.click(badgeSwitch("ui.preRelease"))
    expect(ctx().defaultPreRelease).toBe(true)
    expect(ctx().defaultRibbonEnabled).toBe(before)
  })
})

describe("rank restore keeps the custom position (per target, master-independent)", () => {
  const custom = ["extra", "rank", "new", "award"]
  it("custom off->on restores the exact order (both switches share the stash)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: custom }))
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    expect(ctx().defaultSashOrder).toEqual(custom)
    // OFF via the advanced list, ON via the Classifica switch.
    fireEvent.click(screen.getByText("ui.advancedBadgePriority"))
    const switches = screen.getAllByRole("switch", { name: "ui.sash_rank" })
    expect(switches).toHaveLength(2)
    fireEvent.click(switches[1])
    expect(ctx().defaultSashOrder).toEqual(["extra", "new", "award"])
    expect(JSON.parse(localStorage.getItem("pictorium_rank_sash_stash") ?? "null")).toEqual(custom)
    fireEvent.click(switches[0])
    expect(ctx().defaultSashOrder).toEqual(custom)
  })

  it("rank stash is per target and independent from the master stash", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: custom }))
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    fireEvent.click(badgeSwitch("ui.sash_rank")) // rank OFF
    expect(ctx().defaultSashOrder).toEqual(["extra", "new", "award"])
    expect(localStorage.getItem("pictorium_rank_sash_stash")).not.toBeNull()
    expect(localStorage.getItem("pictorium_trend_sash_stash")).toBeNull()
    fireEvent.click(badgeSwitch("ui.topBadge")) // master OFF (own stash)
    expect(ctx().defaultSashOrder).toEqual([])
    expect(localStorage.getItem("pictorium_trend_sash_stash")).not.toBeNull()
    // Rank stash survived the master cycle untouched.
    expect(JSON.parse(localStorage.getItem("pictorium_rank_sash_stash") ?? "null")).toEqual(custom)
    fireEvent.click(badgeSwitch("ui.topBadge")) // master ON restores rank-less stash
    expect(ctx().defaultSashOrder).toEqual(["extra", "new", "award"])
    fireEvent.click(badgeSwitch("ui.sash_rank")) // rank ON restores exact custom order
    expect(ctx().defaultSashOrder).toEqual(custom)
  })

  it("landscape rank cycle touches only the profile", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultSashOrder: custom }))
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(badgeSwitch("ui.sash_rank"))
    expect(ctx().landscape.sashOrder).toEqual(["extra", "new", "award"])
    expect(ctx().defaultSashOrder).toEqual(custom)
    expect(localStorage.getItem("pictorium_rank_sash_stash:landscape")).not.toBeNull()
    expect(localStorage.getItem("pictorium_rank_sash_stash")).toBeNull()
    fireEvent.click(badgeSwitch("ui.sash_rank"))
    expect(ctx().landscape.sashOrder).toEqual(custom)
    expect(ctx().defaultSashOrder).toEqual(custom)
  })
})

describe("t5a i18n (18 lingue)", () => {
  it("every dictionary defines the new keys with non-empty values", async () => {
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
    const keys = ["ui.rankFamily","ui.titleInfoFamily","ui.ratingsFamily","ui.extraBadgeStyle","ui.inherited","ui.singleBadgeHint","ui.advancedBadgePriority","ui.comingSoonRibbon","ui.sideLeft","ui.sideRight","ui.position"] as const
    expect(mods).toHaveLength(18)
    mods.forEach((mod, i) => {
      const dict = (mod as { default: Record<string, string> }).default ?? (mod as unknown as Record<string, string>)
      for (const key of keys) {
        expect(dict[key]?.trim(), `${langs[i]}:${key}`).toBeTruthy()
      }
    })
  })
})

describe("nastro standard/colorato (U1)", () => {
  function ribbonGroup(): HTMLElement {
    // Distinct a11y group from the appearance (ui.rankFamily) and badge
    // variant (ui.styleRankingDefault) groups.
    return screen.getByRole("radiogroup", { name: "ui.ribbon" })
  }

  function ribbonRadio(group: HTMLElement, name: string): HTMLElement {
    return within(group).getByRole("radio", { name })
  }

  function effective(rs: string, ribbon: boolean): { style: string; accent: boolean } {
    const input: PosterRenderConfigInput = {
      searchParams: new URLSearchParams({ rank: "3" }),
      mapping: null,
      configOverride: null,
      sd: { rankingBadgeStyle: rs as never, ribbonEnabled: ribbon },
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    }
    const r = resolvePosterRenderConfig(input)
    return { style: r.rankingBadgeStyle, accent: r.rankingBadgeAccent }
  }

  it("pure ribbon helpers stay canonical (renderer truth)", () => {
    // Only explicit colored reads Colorato; netflix + legacy default +
    // legacy netflix-color read Standard (no migration, stored value kept).
    expect(resolveRibbonVariant("colored")).toBe("colored")
    expect(resolveRibbonVariant("netflix")).toBe("standard")
    expect(resolveRibbonVariant("netflix-color")).toBe("standard")
    expect(resolveRibbonVariant("default")).toBe("standard")
    expect(resolveRibbonVariant(null)).toBe("standard")
    // Canonical writes: Standard rs=netflix, Colorato rs=colored, ribbon on.
    expect(ribbonVariantValue("standard")).toEqual({ rankingBadgeStyle: "netflix", ribbonEnabled: true })
    expect(ribbonVariantValue("colored")).toEqual({ rankingBadgeStyle: "colored", ribbonEnabled: true })
  })

  it("ribbon row offers Standard/Colorato under Nastro and writes canonical pairs", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    // Nastro selected by default (legacy default + ribbon): sub-row visible.
    const ribbon = ribbonGroup()
    expect(within(ribbon).getAllByRole("radio")).toHaveLength(2)
    expect(ribbonRadio(ribbon, "ui.qbsStandard")).toHaveAttribute("aria-checked", "true")
    fireEvent.click(ribbonRadio(ribbon, "ui.colored"))
    expect(ctx().defaultRankingBadgeStyle).toBe("colored")
    expect(ctx().defaultRibbonEnabled).toBe(true)
    expect(ribbonRadio(ribbon, "ui.colored")).toHaveAttribute("aria-checked", "true")
    fireEvent.click(ribbonRadio(ribbon, "ui.qbsStandard"))
    expect(ctx().defaultRankingBadgeStyle).toBe("netflix")
    expect(ctx().defaultRibbonEnabled).toBe(true)
  })

  it("colored+ribbon reads Nastro/Colorato; legacy reads Nastro/Standard without migration", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultRankingBadgeStyle: "colored", defaultRibbonEnabled: true }))
    const colored = renderBadge("portrait")
    await act(async () => {})
    expect(within(appearanceGroup()).getByRole("radio", { name: "ui.ribbon" })).toHaveAttribute("aria-checked", "true")
    expect(ribbonRadio(ribbonGroup(), "ui.colored")).toHaveAttribute("aria-checked", "true")
    // Read never migrates the stored value.
    expect(colored.ctx().defaultRankingBadgeStyle).toBe("colored")
    expect(colored.ctx().defaultExtraBadgeStyle).toBeNull()
  })

  it.each(["netflix", "netflix-color", "default"] satisfies string[])(
    "legacy %s+ribbon reads Nastro/Standard and keeps the stored value",
    async (rs) => {
      localStorage.setItem("badgeDefaults", JSON.stringify({ defaultRankingBadgeStyle: rs, defaultRibbonEnabled: true }))
      const { ctx } = renderBadge("portrait")
      await act(async () => {})
      expect(within(appearanceGroup()).getByRole("radio", { name: "ui.ribbon" })).toHaveAttribute("aria-checked", "true")
      expect(ribbonRadio(ribbonGroup(), "ui.qbsStandard")).toHaveAttribute("aria-checked", "true")
      expect(ctx().defaultRankingBadgeStyle).toBe(rs)
      expect(ctx().defaultExtraBadgeStyle).toBeNull()
    },
  )

  it("ribbon variant change materializes the legacy extra look; explicit extra sticks", async () => {
    const { ctx } = renderBadge("portrait")
    await act(async () => {})
    expect(ctx().defaultExtraBadgeStyle).toBeNull()
    fireEvent.click(ribbonRadio(ribbonGroup(), "ui.colored"))
    expect(ctx().defaultRankingBadgeStyle).toBe("colored")
    expect(ctx().defaultExtraBadgeStyle).toBe(legacyExtraStyleForRank("default"))
    const extraBlock = screen.getByText("ui.extraBadgeStyle").closest("div") as HTMLElement
    fireEvent.click(within(extraBlock).getByText("ui.vetro"))
    expect(ctx().defaultExtraBadgeStyle).toBe("vetro")
    fireEvent.click(ribbonRadio(ribbonGroup(), "ui.qbsStandard"))
    expect(ctx().defaultRankingBadgeStyle).toBe("netflix")
    expect(ctx().defaultExtraBadgeStyle).toBe("vetro")
  })

  it("ribbon variants roundtrip through the actual render config", () => {
    // Standard -> satin ribbon; Colorato -> accent ribbon (accent comes from
    // the scene/accent color at render time, not from a new param).
    expect(effective(...Object.values(ribbonVariantValue("standard")) as [string, boolean])).toEqual({ style: "netflix", accent: false })
    expect(effective(...Object.values(ribbonVariantValue("colored")) as [string, boolean])).toEqual({ style: "colored", accent: false })
  })

  it("landscape ribbon variant touches only the profile", async () => {
    const { ctx } = renderBadge("landscape")
    await act(async () => {})
    fireEvent.click(ribbonRadio(ribbonGroup(), "ui.colored"))
    expect(ctx().landscape.rankingBadgeStyle).toBe("colored")
    expect(ctx().landscape.ribbonEnabled).toBe(true)
    expect(ctx().defaultRankingBadgeStyle).not.toBe("colored")
    expect(ctx().defaultPosterShape).toBe("poster")
  })

  it("u1 i18n (18 lingue): ribbon group + options reuse existing keys", async () => {
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
    const keys = ["ui.ribbon","ui.qbsStandard","ui.colored"] as const
    expect(mods).toHaveLength(18)
    mods.forEach((mod, i) => {
      const dict = (mod as { default: Record<string, string> }).default ?? (mod as unknown as Record<string, string>)
      for (const key of keys) {
        expect(dict[key]?.trim(), `${langs[i]}:${key}`).toBeTruthy()
      }
    })
  })
})
