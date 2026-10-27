/**
 * Effective availability + tab ownership (phase 2 slice).
 * - Pure shared gates (SettingsElementAvailability) follow renderer truth:
 *   bottom suppression via resolveSeparateDisplayState, per-shape effective
 *   flags, Card scope "all", custom provider never gated on runtime counts.
 * - Integration: Badge appearance owns genre/extra/separate/age/quality
 *   styles (reachable, no visibility toggles, no duplicate layout);
 *   Transform geometry gates both shapes with active-first DOM order and
 *   completely hidden inactive groups (no disabled disclosure, no hints).
 *   Inactive elements re-appear immediately when enabled in
 *   Information/Rankings with staged tuning preserved. No mock hiding —
 *   real components, real DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { act, createElement } from "react"
import { BadgeDefaultsSection } from "@/components/settings/BadgeDefaultsSection"
import { SettingsPanel } from "@/components/SettingsPanel"
import { TransformPanel } from "@/components/settings/TransformPanel"
import {
  AvailabilityGate,
  availabilityDisplayState,
  effectiveFlag,
  isAgeStyleActive,
  isBadgeFontActive,
  isBottomActive,
  isCardAllDefaults,
  isCustomRatingsActive,
  isExtraStyleActive,
  isGenreStyleActive,
  isGeometryLocked,
  isNetworkGeometryActive,
  isQualityStyleActive,
  isRankStyleActive,
  isSeparateStyleActive,
  orderActiveFirst,
  type EffectiveBadgeFlags,
} from "@/components/settings/SettingsElementAvailability"
import { isBottomSeparateActive, resolveSeparateDisplayState } from "@/lib/poster-config"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { renderWithCtx } from "@/__tests__/test-utils"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
  class FakeXHR {
    onload: (() => void) | null = null
    responseType = ""
    timeout = 0
    status = 0
    response: unknown = null
    open() {}
    send() {}
    abort() {}
    setRequestHeader() {}
  }
  vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest)
  vi.useFakeTimers()
})

const ON: EffectiveBadgeFlags = {
  globalBadges: true,
  badgeGenre: true,
  badgeYear: true,
  badgeRating: true,
  separateRatings: false,
  separateRatingsStyle: "column",
  rankingBadges: true,
  sashOrder: ["upcoming", "rank", "new", "award", "extra"],
  badgeQuality: true,
  customRatings: true,
  ageBadge: true,
  networkLogo: true,
  preRelease: false,
}

describe("pure effective gates (renderer truth)", () => {
  it("bottom suppression hides genre/year/rating styles but keeps the separate picker", () => {
    const bottom: EffectiveBadgeFlags = {
      ...ON,
      separateRatings: true,
      separateRatingsStyle: "bottom-pills",
    }
    expect(isBottomActive(bottom)).toBe(true)
    expect(isBottomSeparateActive({
      badgesEnabled: true,
      badgeRating: true,
      separateRatings: true,
      separateRatingsStyle: "bottom-pills",
    })).toBe(true)
    // Genre style suppressed (render-suppressed, values kept).
    expect(isGenreStyleActive(bottom)).toBe(false)
    // Column mode: no suppression, genre style live.
    expect(isGenreStyleActive({ ...ON, separateRatings: true, separateRatingsStyle: "column" })).toBe(true)
    // The separate picker stays reachable in bottom (it owns the way back).
    expect(isSeparateStyleActive(bottom)).toBe(true)
    // The custom provider row is suppressed in bottom (renderer truth).
    expect(isCustomRatingsActive(bottom)).toBe(false)
    expect(isCustomRatingsActive({ ...ON, separateRatings: true, separateRatingsStyle: "column" })).toBe(true)
  })

  it("master + sash gate rank/extra (preRelease keeps extra reachable)", () => {
    expect(isRankStyleActive(ON)).toBe(true)
    expect(isExtraStyleActive(ON)).toBe(true)
    // Master off kills both.
    expect(isRankStyleActive({ ...ON, rankingBadges: false })).toBe(false)
    expect(isExtraStyleActive({ ...ON, rankingBadges: false })).toBe(false)
    // Rank bucket off kills rank only.
    const noRank: EffectiveBadgeFlags = { ...ON, sashOrder: ["upcoming", "new", "award", "extra"] }
    expect(isRankStyleActive(noRank)).toBe(false)
    expect(isExtraStyleActive(noRank)).toBe(true)
    // Only rank left (no upcoming/new/award/extra) kills the extra style —
    // unless preRelease (Coming Soon, independent of the rank master).
    const noExtra: EffectiveBadgeFlags = { ...ON, sashOrder: ["rank"] }
    expect(isExtraStyleActive(noExtra)).toBe(false)
    expect(isExtraStyleActive({ ...noExtra, preRelease: true })).toBe(true)
  })

  it("extra style follows upcoming/new/award buckets under the rank master; Coming Soon stays independent", () => {
    // Each non-rank extra-type bucket keeps the extra look reachable.
    for (const only of ["upcoming", "new", "award", "extra"] as const) {
      const order = [only] as unknown as EffectiveBadgeFlags["sashOrder"]
      expect(isExtraStyleActive({ ...ON, sashOrder: order })).toBe(true)
    }
    // Rank alone never styles the extra badge.
    expect(isExtraStyleActive({ ...ON, sashOrder: ["rank"] as unknown as EffectiveBadgeFlags["sashOrder"] })).toBe(false)
    // Coming Soon is independent of the rank master.
    expect(isExtraStyleActive({ ...ON, rankingBadges: false, preRelease: true })).toBe(true)
    expect(isExtraStyleActive({ ...ON, rankingBadges: false, preRelease: false })).toBe(false)
  })

  it("nullable sash preserves the default order; explicit [] stays all-off", () => {
    // Never edited (null/undefined) = canonical default order = extra on.
    expect(isExtraStyleActive({ ...ON, sashOrder: null })).toBe(true)
    expect(isExtraStyleActive({ ...ON, sashOrder: undefined })).toBe(true)
    expect(isRankStyleActive({ ...ON, sashOrder: null })).toBe(true)
    // Explicit [] = everything off, never coerced back to default.
    expect(isExtraStyleActive({ ...ON, sashOrder: [] })).toBe(false)
    expect(isRankStyleActive({ ...ON, sashOrder: [] })).toBe(false)
  })

  it("genre style needs global + unsuppressed + combined-meta or year-only", () => {
    // Combined meta.
    expect(isGenreStyleActive(ON)).toBe(true)
    // Year-only still styles the shared badge.
    expect(isGenreStyleActive({ ...ON, badgeGenre: false, badgeYear: true, badgeRating: false })).toBe(true)
    // All meta off: nothing to style.
    expect(isGenreStyleActive({ ...ON, badgeGenre: false, badgeYear: false, badgeRating: false })).toBe(false)
    // Master off: nothing to style.
    expect(isGenreStyleActive({ ...ON, globalBadges: false })).toBe(false)
    // Separated rating alone does not keep the genre badge alive.
    expect(isGenreStyleActive({
      ...ON,
      badgeGenre: false,
      badgeYear: false,
      badgeRating: true,
      separateRatings: true,
      separateRatingsStyle: "column",
    })).toBe(false)
  })

  it("quality is renderer-independent, age needs global + age", () => {
    expect(isQualityStyleActive({ ...ON, globalBadges: false })).toBe(true)
    expect(isQualityStyleActive({ ...ON, badgeQuality: false })).toBe(false)
    expect(isAgeStyleActive(ON)).toBe(true)
    expect(isAgeStyleActive({ ...ON, globalBadges: false })).toBe(false)
    expect(isAgeStyleActive({ ...ON, ageBadge: false })).toBe(false)
    expect(isNetworkGeometryActive(ON)).toBe(true)
    expect(isNetworkGeometryActive({ ...ON, networkLogo: false })).toBe(false)
  })

  it("common font needs at least one effectively active text consumer", () => {
    // Any single consumer keeps the shared font reachable.
    expect(isBadgeFontActive(ON)).toBe(true)
    expect(isBadgeFontActive({ ...ON, globalBadges: false })).toBe(true) // rank/extra/quality stay
    expect(isBadgeFontActive({ ...ON, rankingBadges: false, badgeQuality: false, badgeGenre: false, badgeYear: false, badgeRating: false, separateRatings: false, customRatings: false, ageBadge: false })).toBe(false)
    // All-off: no supported consumer renders text — the whole group hides.
    const allOff: EffectiveBadgeFlags = {
      globalBadges: false,
      badgeGenre: false,
      badgeYear: false,
      badgeRating: false,
      separateRatings: false,
      rankingBadges: false,
      sashOrder: [],
      badgeQuality: false,
      customRatings: false,
      ageBadge: false,
      networkLogo: false,
      preRelease: false,
    }
    expect(isBadgeFontActive(allOff)).toBe(false)
    // Quality alone (renderer-independent) still consumes the font.
    expect(isBadgeFontActive({ ...allOff, badgeQuality: true })).toBe(true)
  })

  it("unknown runtime providers never disable a potentially active feature", () => {
    const flags = { ...ON, separateRatings: true, separateRatingsStyle: "column" as const }
    // Zero items at settings time: the column cannot render *now*, but the
    // style picker and the custom row stay enabled (provider may resolve).
    const displayZero = resolveSeparateDisplayState({
      badgesEnabled: true,
      badgeGenre: true,
      badgeYear: true,
      badgeRating: true,
      separateRatings: true,
      separateRatingsStyle: "column",
      sepItemCount: 0,
    })
    expect(displayZero.useSeparate).toBe(false)
    expect(isSeparateStyleActive(flags)).toBe(true)
    expect(isCustomRatingsActive(flags)).toBe(true)
    // The shared helper agrees (assumes a potential item, bottom stays exact).
    expect(availabilityDisplayState(flags).bottomActive).toBe(false)
  })

  it("Card locks apply only with scope all; effectiveFlag reads land ?? flat", () => {
    expect(isCardAllDefaults("stremio", "all")).toBe(true)
    expect(isCardAllDefaults("stremio", "ranked")).toBe(false)
    expect(isCardAllDefaults("standard", "all")).toBe(false)
    expect(isGeometryLocked("nuvio", "all")).toBe(true)
    expect(isGeometryLocked("fresh", "all")).toBe(false)
    expect(effectiveFlag(true, false, "landscape")).toBe(false)
    expect(effectiveFlag(true, null, "landscape")).toBe(true)
    expect(effectiveFlag(true, undefined, "landscape")).toBe(true)
    expect(effectiveFlag(true, false, "portrait")).toBe(true)
  })

  it("orderActiveFirst is stable and DOM-safe (never CSS order alone)", () => {
    const out = orderActiveFirst([
      { active: false, value: "a" },
      { active: true, value: "b" },
      { active: false, value: "c" },
      { active: true, value: "d" },
    ])
    expect(out).toEqual(["b", "d", "a", "c"])
  })
})

function renderBadgeAppearance(seed?: Record<string, unknown>) {
  if (seed) localStorage.setItem("badgeDefaults", JSON.stringify(seed))
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement("div", null,
      createElement(BadgeDefaultsSection, { active: true, shape: "portrait", mode: "appearance" }),
      createElement(Probe)),
  )
  return { ctx: () => ctx as PosterEditorCtx }
}

function renderTransformPortrait() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement("div", null,
      createElement(TransformPanel, { active: true, geometryOnly: true }),
      createElement(Probe)),
  )
  return { ctx: () => ctx as PosterEditorCtx }
}

function renderTransformLandscape() {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  renderWithCtx(
    createElement("div", null,
      createElement(TransformPanel, { active: true, previewShape: "landscape", geometryOnly: true }),
      createElement(Probe)),
  )
  return { ctx: () => ctx as PosterEditorCtx }
}

describe("Badge appearance owns styles (no visibility toggles, no duplicates)", () => {
  it("separate picker lives in appearance when enabled (hidden when off), never in information; root card in both", async () => {
    const { ctx } = renderBadgeAppearance({ defaultGlobalBadges: true, defaultBadgeRating: true, defaultSeparateRatings: true })
    await act(async () => {})
    // Appearance: picker reachable with real controls, no visibility toggles.
    expect(screen.getByTestId("badge-separate-style-picker")).toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "ui.badgeRating" })).toBeNull()
    expect(screen.queryByRole("switch", { name: "ui.separateRatings" })).toBeNull()
    // Genre + quality styles reachable (active by default).
    expect(screen.getByTestId("badge-genre-style")).toBeInTheDocument()
    expect(screen.getByTestId("badge-quality-style")).toBeInTheDocument()
    // No duplicate layout picker in the appearance tab.
    const layout = screen.queryByTestId("poster-layout-card")
    expect(layout === null || layout.hasAttribute("hidden")).toBe(true)
    expect(ctx().defaultBadgeStyle).toBe("shadow")
    // Disabling in Information hides the picker completely (no gate, no
    // hint) with staged tuning preserved; re-enabling exposes it again.
    const scaleBefore = ctx().defaultSeparateBadgeScale
    await act(async () => { ctx().setDefaultSeparateRatings(false) })
    expect(screen.queryByTestId("badge-separate-style")).toBeNull()
    expect(screen.queryByTestId("badge-separate-style-inactive")).toBeNull()
    expect(screen.queryByTestId("badge-separate-style-picker")).toBeNull()
    expect(screen.queryByTestId("badge-separate-style-wrap")).toBeNull()
    expect(ctx().defaultSeparateBadgeScale).toBe(scaleBefore)
    await act(async () => { ctx().setDefaultSeparateRatings(true) })
    expect(screen.getByTestId("badge-separate-style-picker")).toBeInTheDocument()
  })

  it("information mode keeps visibility only (picker absent, switches present)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    let ctx: PosterEditorCtx | null = null
    function Probe() {
      ctx = usePosterEditor()
      return null
    }
    renderWithCtx(
      createElement("div", null,
        createElement(BadgeDefaultsSection, { active: true, shape: "portrait", mode: "information" }),
        createElement(Probe)),
    )
    await act(async () => {})
    expect(screen.queryByTestId("badge-separate-style-picker")).toBeNull()
    // Own wrapper stays mounted + hidden (no state loss); picker unmounted.
    expect(screen.getByTestId("badge-separate-style-wrap")).toHaveAttribute("hidden")
    expect(screen.getByRole("switch", { name: "ui.badgeRating" })).toBeInTheDocument()
    expect(ctx).not.toBeNull()
  })

  it("inactive styles hide completely (no gate, no hint), values preserved", async () => {
    const { ctx } = renderBadgeAppearance({ defaultGlobalBadges: false })
    await act(async () => {})
    // Genre style inactive: no group, no disclosure, no hint anywhere.
    expect(screen.queryByTestId("badge-genre-style")).toBeNull()
    expect(screen.queryByTestId("badge-genre-style-inactive")).toBeNull()
    expect(screen.queryByTestId("badge-genre-style-wrap")).toBeNull()
    expect(screen.queryByText("ui.activateInInformationHint", { exact: false })).toBeNull()
    // Common font lives OUTSIDE the genre gate: enabled on its own card.
    expect(screen.getByTestId("badge-common-font")).toBeInTheDocument()
    // The common font card is never inside a disabled fieldset.
    expect(screen.getByTestId("badge-common-font").querySelector("fieldset[disabled]")).toBeNull()
    // Only one font selector on screen (moved, never duplicated).
    expect(screen.getAllByText("ui.badgeFont")).toHaveLength(1)
    // Quality (renderer-independent) stays active on its own gate.
    expect(screen.getByTestId("badge-quality-style")).toBeInTheDocument()
    // Staged tuning preserved while hidden; re-enabling exposes the style.
    expect(ctx().defaultBadgeGenre).toBe(true)
    await act(async () => { ctx().setDefaultGlobalBadges(true) })
    expect(screen.getByTestId("badge-genre-style")).toBeInTheDocument()
  })

  it("all-off hides the common font group and the age card entirely (no shells)", async () => {
    renderBadgeAppearance({
      defaultGlobalBadges: false,
      defaultRankingBadges: false,
      defaultBadgeQuality: false,
      defaultBadgeRating: false,
      defaultSeparateRatings: false,
      defaultCustomRatings: false,
      defaultAgeBadge: false,
      defaultNetworkLogo: false,
      defaultPreRelease: false,
    })
    await act(async () => {})
    // No supported font consumer: the whole font group (wrapper included).
    expect(screen.queryByTestId("badge-common-font")).toBeNull()
    expect(screen.queryByTestId("badge-common-font-wrap")).toBeNull()
    // Age style inactive: the whole age card unmounts, never an empty shell.
    expect(screen.queryByTestId("badge-age-card")).toBeNull()
    expect(screen.queryByTestId("badge-age-style")).toBeNull()
    expect(screen.queryByTestId("badge-age-style-inactive")).toBeNull()
    // Sibling style wraps follow the same no-shell rule.
    expect(screen.queryByTestId("badge-quality-style-wrap")).toBeNull()
    expect(screen.queryByTestId("badge-separate-style-wrap")).toBeNull()
    expect(screen.queryByTestId("badge-genre-style-wrap")).toBeNull()
    expect(screen.queryByTestId("badge-extra-style-wrap")).toBeNull()
    // No orphan disclosures, hints, or lone labels anywhere.
    expect(screen.queryByText("ui.activateInTabHint", { exact: false })).toBeNull()
    expect(screen.queryByText("ui.activateInInformationHint", { exact: false })).toBeNull()
  })

  it("standalone behavior preserved (legacy disclosure, untouched)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    renderWithCtx(createElement(BadgeDefaultsSection, { active: true, shape: "portrait" }))
    await act(async () => {})
    expect(screen.getByTestId("badge-advanced-toggle")).toBeInTheDocument()
    expect(screen.queryByTestId("badge-genre-style")).toBeNull()
  })
})

describe("Transform geometry gates both shapes (active-first, hidden inactive)", () => {
  it("portrait: only active groups render (inactive hidden, no hints); logo/position/gradient stay", async () => {
    const { ctx } = renderTransformPortrait()
    await act(async () => {})
    // Logo/position/gradient independent: always present.
    expect(screen.getByTestId("transform-geo-logo")).toBeInTheDocument()
    expect(screen.getByTestId("transform-geo-position")).toBeInTheDocument()
    expect(screen.getByTestId("transform-geo-gradient")).toBeInTheDocument()
    // Rank/extra/meta/quality/network active by default; separate off -> hidden.
    const order = ["transform-geo-rank", "transform-geo-extra", "transform-geo-meta", "transform-geo-quality", "transform-geo-network"]
    for (const id of order) expect(screen.getByTestId(id)).toBeInTheDocument()
    expect(screen.queryByTestId("transform-geo-separate")).toBeNull()
    expect(screen.queryByTestId("transform-geo-separate-inactive")).toBeNull()
    expect(screen.queryByText("ui.activateInTabHint", { exact: false })).toBeNull()
    // Active-first DOM order preserved among the visible groups.
    for (let i = 0; i < order.length - 1; i++) {
      const a = screen.getByTestId(order[i])
      const b = screen.getByTestId(order[i + 1])
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // Staged values untouched while hidden.
    expect(ctx().defaultSeparateBadgeScale).toBe(130)
    // No visibility/style/layout duplicates inside geometry.
    expect(screen.queryByTestId("poster-layout-card")).toBeNull()
    expect(screen.queryByRole("switch", { name: "ui.badgeRating" })).toBeNull()
    // Enabling in Information immediately exposes the geometry; disabling
    // hides it again with tuning preserved (no persistence round-trip).
    await act(async () => { ctx().setDefaultSeparateRatings(true) })
    expect(screen.getByTestId("transform-geo-separate")).toBeInTheDocument()
    await act(async () => { ctx().setDefaultSeparateRatings(false) })
    expect(screen.queryByTestId("transform-geo-separate")).toBeNull()
    expect(ctx().defaultSeparateBadgeScale).toBe(130)
  })

  it("portrait: rank sash-off hides rank geometry with values kept; extra stays", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultRankingBadges: true,
      defaultSashOrder: ["upcoming", "new", "award", "extra"],
    }))
    const { ctx } = renderTransformPortrait()
    await act(async () => {})
    // Rank hidden (master on, bucket off); extra stays active.
    expect(screen.queryByTestId("transform-geo-rank")).toBeNull()
    expect(screen.queryByTestId("transform-geo-rank-inactive")).toBeNull()
    expect(screen.getByTestId("transform-geo-extra")).toBeInTheDocument()
    expect(ctx().defaultTopBadgeScale).toBe(100)
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    // Re-enabling the rank bucket immediately exposes its geometry.
    await act(async () => { ctx().setDefaultSashOrder(["upcoming", "rank", "new", "award", "extra"]) })
    expect(screen.getByTestId("transform-geo-rank")).toBeInTheDocument()
    expect(ctx().defaultTopBadgeScale).toBe(100)
  })

  it("portrait: network off hides network geometry + position with values kept; logo shell stays", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultNetworkLogo: false }))
    const { ctx } = renderTransformPortrait()
    await act(async () => {})
    expect(screen.queryByTestId("transform-geo-network")).toBeNull()
    expect(screen.queryByTestId("transform-geo-network-inactive")).toBeNull()
    expect(screen.queryByTestId("transform-netpos-inactive")).toBeNull()
    expect(screen.queryByText("ui.activateInTabHint", { exact: false })).toBeNull()
    // Title logo + background stay reachable; the Auto-only Position card
    // (network-position only) renders nothing while the network is off.
    expect(screen.getByTestId("transform-geo-logo")).toBeInTheDocument()
    expect(screen.queryByTestId("transform-geo-position")).toBeNull()
    expect(screen.queryByText("ui.networkLogoPosition", { exact: false })).toBeNull()
    expect(screen.getByTestId("transform-geo-gradient")).toBeInTheDocument()
    expect(ctx().defaultNetworkLogo).toBe(false)
    expect(ctx().defaultNetworkLogoPosition).toBe("auto")
    // Re-enabling immediately exposes geometry + position.
    await act(async () => { ctx().setDefaultNetworkLogo(true) })
    expect(screen.getByTestId("transform-geo-network")).toBeInTheDocument()
  })

  it("portrait: Card all keeps offsets live without rewriting values", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      defaultPosterLayout: "stremio",
      defaultPosterFreshScope: "all",
    }))
    const { ctx } = renderTransformPortrait()
    await act(async () => {})
    const rank = screen.getByTestId("transform-geo-rank")
    const sliders = Array.from(rank.querySelectorAll('input[type="range"]'))
    expect(sliders.length).toBeGreaterThan(0)
    // User transforms are live on every layout (authorized contract): the
    // shared compositor applies the same offsets/scales, so no slider locks.
    for (const s of sliders) expect(s).not.toBeDisabled()
    // Raw values unchanged (no hidden rewrite behind the live controls).
    expect(ctx().defaultTopBadgeScale).toBe(100)
    expect(ctx().defaultGenreBadgeOffsetX).toBe(0)
    // No dimmed-container opacity anywhere on the geometry groups.
    for (const el of Array.from(rank.querySelectorAll("div"))) {
      expect(el.className).not.toMatch(/opacity-60/)
    }
  })

  it("landscape: effective gates hide network with profile overrides, flats intact; enabling exposes", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({
      landscape: { networkLogo: false },
    }))
    const { ctx } = renderTransformLandscape()
    await act(async () => {})
    expect(screen.getByTestId("landscape-geo-rank")).toBeInTheDocument()
    expect(screen.queryByTestId("landscape-geo-network")).toBeNull()
    expect(screen.queryByTestId("landscape-geo-network-inactive")).toBeNull()
    expect(screen.queryByTestId("landscape-netpos-inactive")).toBeNull()
    expect(screen.queryByText("ui.activateInTabHint", { exact: false })).toBeNull()
    // Flat untouched, profile wins per key.
    expect(ctx().defaultNetworkLogo).toBe(true)
    expect(ctx().landscape.networkLogo).toBe(false)
    expect(screen.queryByTestId("poster-layout-card")).toBeNull()
    // Enabling the landscape override immediately exposes the geometry.
    await act(async () => { ctx().setLandscape({ networkLogo: true }) })
    expect(screen.getByTestId("landscape-geo-network")).toBeInTheDocument()
    expect(ctx().defaultNetworkLogo).toBe(true)
  })

  it("standalone Transform preserved (legacy master-only conditionals)", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({}))
    renderWithCtx(createElement(TransformPanel, { active: true }))
    await act(async () => {})
    expect(screen.queryByTestId("transform-geo-rank")).toBeNull()
    expect(screen.getByText("ui.rankFamily")).toBeInTheDocument()
  })
})

describe("AvailabilityGate retains controls (no mock hiding)", () => {
  it("inactive gate mounts the real children disabled", async () => {    renderWithCtx(
      <AvailabilityGate active={false} name="Style" hint="Turn it on" testId="demo-gate"><button type="button">real-control</button></AvailabilityGate>,
    )
    await act(async () => {})
    const gate = screen.getByTestId("demo-gate-inactive")
    const btn = gate.querySelector("button")
    expect(btn).not.toBeNull()
    expect(btn!.textContent).toBe("real-control")
    expect(btn).toBeDisabled()
  })

  it("controlled disclosure opens with the open attribute and keeps real disabled children", async () => {
    renderWithCtx(
      <AvailabilityGate active={false} name="Style" hint="Turn it on" testId="demo-gate"><button type="button">real-control</button></AvailabilityGate>,
    )
    await act(async () => {})
    const gate = screen.getByTestId("demo-gate-inactive")
    // Closed by default: controlled, native navigation cancelled.
    expect(gate.hasAttribute("open")).toBe(false)
    const summary = gate.querySelector("summary") as HTMLElement
    fireEvent.click(summary)
    // Open after explicit press: controlled open attribute present and the
    // real children retained disabled (never unmounted, never enabled).
    expect(gate.hasAttribute("open")).toBe(true)
    const btn = gate.querySelector("button") as HTMLButtonElement
    expect(btn.textContent).toBe("real-control")
    expect(btn).toBeDisabled()
    fireEvent.click(summary)
    expect(gate.hasAttribute("open")).toBe(false)
  })
})

/**
 * End-to-end availability through the REAL five-tab SettingsPanel (both edit
 * targets). Every enable/disable below clicks the actual Information/Rankings
 * switches — never direct setter probes. Presence/absence covers the
 * appearance groups AND the geometry groups including the network-position
 * label (whole subgroup, never a lone label) and the age/font containers.
 * Zero PUT and zero defaults-storage mutation before the global Save; staged
 * tuning survives hide/show round-trips and lands in the single PUT.
 */
describe("SettingsPanel real-switch availability (both shapes, staged)", () => {
  let puts: { url: string; body: Record<string, unknown> }[]

  beforeEach(() => {
    vi.useRealTimers()
    puts = []
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
        const u = String(url)
        if (init?.method === "PUT" && u.includes("/api/defaults")) {
          puts.push({ url: u, body: JSON.parse(init.body as string) })
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }
        }
        if (u.includes("/api/defaults/presets")) {
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ presets: [] }) }
        }
        if (u.includes("/api/custom-rating/test")) {
          return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, status: 200, ms: 3, ratings: [] }) }
        }
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }
      }),
    )
  })

  afterEach(() => {
    vi.useFakeTimers()
  })

  function storageSnapshot(): string {
    const out: Record<string, string | null> = {}
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)!
      if (k.includes("badgeDefaults") || k.includes("pictorium")) out[k] = localStorage.getItem(k)
    }
    return JSON.stringify(out)
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
        createElement(SettingsPanel, { setSettingsOpen: () => {}, exportData: () => {}, importData: () => {} }),
        createElement(Probe),
      ),
    )
    return { ctx: () => ctx as unknown as PosterEditorCtx }
  }

  function clickTab(name: string) {
    fireEvent.click(screen.getByRole("tab", { name }))
  }

  function setShape(shape: "portrait" | "landscape") {
    const label = shape === "portrait" ? "ui.posterShapePortrait" : "ui.posterShapeLandscape"
    fireEvent.click(within(screen.getByTestId("format-target-selector")).getByText(label))
  }

  function switchByName(name: string): HTMLElement {
    return screen.getByRole("switch", { name })
  }

  function ensureOn(name: string) {
    const s = switchByName(name)
    if (s.getAttribute("aria-checked") !== "true") fireEvent.click(s)
  }

  function ensureOff(name: string) {
    const s = switchByName(name)
    if (s.getAttribute("aria-checked") !== "false") fireEvent.click(s)
  }

  function transformPanel(): HTMLElement {
    return screen.getByRole("tabpanel", { name: "ui.transform" })
  }

  // The visible Badge tabpanel (rankings/information/appearance mount
  // simultaneously with siblings hidden): scopes testid queries to the
  // active tab so hidden duplicates never false-positive.
  function badgePanel(): HTMLElement {
    return screen.getByRole("tabpanel", { name: "ui.badgeSection" })
  }

  it("portrait: Information network switch hides the whole position subgroup + geometry, tuning persists to Save", async () => {
    renderPanel()
    await screen.findByTestId("presets-panel")
    const before = storageSnapshot()
    // Baseline on: network geometry + the full position subgroup with label.
    clickTab("ui.settingsTabInformation")
    ensureOn("ui.networkLogo")
    clickTab("ui.settingsTabTransform")
    expect(within(transformPanel()).getByText("ui.networkLogoPosition")).toBeInTheDocument()
    expect(within(transformPanel()).getByTestId("transform-netpos-group")).toBeInTheDocument()
    expect(within(transformPanel()).getByTestId("transform-geo-network")).toBeInTheDocument()
    // Stage tuning through the real position buttons (top), then hide.
    fireEvent.click(within(transformPanel()).getByText("ui.networkLogoPositionTop"))
    clickTab("ui.settingsTabInformation")
    ensureOff("ui.networkLogo")
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(before)
    // Whole subgroup gone (label included), geometry gone, no hints anywhere.
    clickTab("ui.settingsTabTransform")
    expect(within(transformPanel()).queryByText("ui.networkLogoPosition")).toBeNull()
    expect(within(transformPanel()).queryByTestId("transform-netpos-group")).toBeNull()
    expect(within(transformPanel()).queryByTestId("transform-geo-network")).toBeNull()
    expect(within(transformPanel()).queryByTestId("transform-geo-network-inactive")).toBeNull()
    expect(screen.queryByText("ui.activateInTabHint", { exact: false })).toBeNull()
    // Independent groups stay: title logo, background. The Auto-only Position
    // card (network-position only) renders nothing while the network is off.
    expect(within(transformPanel()).getByTestId("transform-geo-logo")).toBeInTheDocument()
    expect(within(transformPanel()).queryByTestId("transform-geo-position")).toBeNull()
    expect(within(transformPanel()).getByTestId("transform-geo-gradient")).toBeInTheDocument()
    // Re-enabling through the real switch exposes everything again.
    clickTab("ui.settingsTabInformation")
    ensureOn("ui.networkLogo")
    clickTab("ui.settingsTabTransform")
    expect(within(transformPanel()).getByText("ui.networkLogoPosition")).toBeInTheDocument()
    expect(within(transformPanel()).getByTestId("transform-geo-network")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(before)
    // Single Save persists the staged master + the staged position tuning.
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(puts[0].body["networkLogo"]).toBe(true)
    expect(puts[0].body["networkLogoPosition"]).toBe("top")
  })

  it("portrait: Information age switch hides the whole appearance age card, font stays on other consumers", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultAgeBadge: true }))
    renderPanel()
    await screen.findByTestId("presets-panel")
    const before = storageSnapshot()
    clickTab("ui.settingsTabInformation")
    ensureOn("ui.ageBadge")
    clickTab("ui.settingsTabBadge")
    expect(within(badgePanel()).getByTestId("badge-age-card")).toBeInTheDocument()
    expect(within(badgePanel()).getByTestId("badge-age-style")).toBeInTheDocument()
    expect(within(badgePanel()).getByTestId("badge-common-font")).toBeInTheDocument()
    // Hide through the real Information switch: zero persistence traffic.
    clickTab("ui.settingsTabInformation")
    ensureOff("ui.ageBadge")
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(before)
    clickTab("ui.settingsTabBadge")
    expect(within(badgePanel()).queryByTestId("badge-age-card")).toBeNull()
    expect(within(badgePanel()).queryByTestId("badge-age-style")).toBeNull()
    expect(within(badgePanel()).queryByTestId("badge-age-style-inactive")).toBeNull()
    // Rank/extra/quality still consume the shared font: group stays.
    expect(within(badgePanel()).getByTestId("badge-common-font-wrap")).toBeInTheDocument()
    expect(within(badgePanel()).getByTestId("badge-common-font")).toBeInTheDocument()
    expect(screen.queryByText("ui.activateInTabHint", { exact: false })).toBeNull()
    // Re-enabling restores the card; off again stages the Save payload.
    clickTab("ui.settingsTabInformation")
    ensureOn("ui.ageBadge")
    clickTab("ui.settingsTabBadge")
    expect(within(badgePanel()).getByTestId("badge-age-card")).toBeInTheDocument()
    clickTab("ui.settingsTabInformation")
    ensureOff("ui.ageBadge")
    expect(puts).toHaveLength(0)
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(puts[0].body["ageBadge"]).toBe(false)
  })

  it("portrait: Information separate switch hides the appearance picker + geometry, Rankings rank bucket gates rank geometry", async () => {
    localStorage.setItem("badgeDefaults", JSON.stringify({ defaultBadgeRating: true, defaultSeparateRatings: true }))
    renderPanel()
    await screen.findByTestId("presets-panel")
    const before = storageSnapshot()
    // Separate on through the real switches: picker + geometry appear.
    clickTab("ui.settingsTabInformation")
    ensureOn("ui.badgeRating")
    ensureOn("ui.separateRatings")
    expect(puts).toHaveLength(0)
    clickTab("ui.settingsTabBadge")
    expect(within(badgePanel()).getByTestId("badge-separate-style-picker")).toBeInTheDocument()
    clickTab("ui.settingsTabTransform")
    expect(within(transformPanel()).getByTestId("transform-geo-separate")).toBeInTheDocument()
    // Separate off: picker fully gone (no wrap, no gate), geometry gone.
    clickTab("ui.settingsTabInformation")
    ensureOff("ui.separateRatings")
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(before)
    clickTab("ui.settingsTabBadge")
    expect(within(badgePanel()).queryByTestId("badge-separate-style-picker")).toBeNull()
    expect(within(badgePanel()).queryByTestId("badge-separate-style-wrap")).toBeNull()
    expect(within(badgePanel()).queryByTestId("badge-separate-style")).toBeNull()
    clickTab("ui.settingsTabTransform")
    expect(within(transformPanel()).queryByTestId("transform-geo-separate")).toBeNull()
    // Rankings rank bucket off: rank geometry hides, extra stays live.
    clickTab("ui.settingsTabRankings")
    ensureOff("ui.sash_rank")
    expect(puts).toHaveLength(0)
    clickTab("ui.settingsTabTransform")
    expect(within(transformPanel()).queryByTestId("transform-geo-rank")).toBeNull()
    expect(within(transformPanel()).getByTestId("transform-geo-extra")).toBeInTheDocument()
    // Bucket back on: geometry returns with tuning intact; separate stays
    // staged off so the single Save has a deterministic payload.
    clickTab("ui.settingsTabRankings")
    ensureOn("ui.sash_rank")
    clickTab("ui.settingsTabTransform")
    expect(within(transformPanel()).getByTestId("transform-geo-rank")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(puts[0].body["separateRatings"]).toBe(false)
  })

  it("landscape: Information network switch gates landscape geometry + position through the profile, flats intact", async () => {
    const { ctx } = renderPanel()
    await screen.findByTestId("presets-panel")
    const before = storageSnapshot()
    setShape("landscape")
    clickTab("ui.settingsTabInformation")
    ensureOn("ui.networkLogo")
    clickTab("ui.settingsTabTransform")
    expect(within(transformPanel()).getByText("ui.networkLogoPosition")).toBeInTheDocument()
    expect(within(transformPanel()).getByTestId("landscape-netpos-group")).toBeInTheDocument()
    expect(within(transformPanel()).getByTestId("landscape-geo-network")).toBeInTheDocument()
    // Stage landscape position tuning through the real override buttons.
    fireEvent.click(within(transformPanel()).getByText("ui.networkLogoPositionTop"))
    // Off through the real switch: profile override, zero persistence traffic.
    clickTab("ui.settingsTabInformation")
    ensureOff("ui.networkLogo")
    expect(puts).toHaveLength(0)
    expect(storageSnapshot()).toBe(before)
    clickTab("ui.settingsTabTransform")
    expect(within(transformPanel()).queryByText("ui.networkLogoPosition")).toBeNull()
    expect(within(transformPanel()).queryByTestId("landscape-netpos-group")).toBeNull()
    expect(within(transformPanel()).queryByTestId("landscape-geo-network")).toBeNull()
    expect(within(transformPanel()).queryByTestId("landscape-geo-network-inactive")).toBeNull()
    expect(screen.queryByText("ui.activateInTabHint", { exact: false })).toBeNull()
    // Rank geometry stays; the portrait flat is untouched by the override.
    expect(within(transformPanel()).getByTestId("landscape-geo-rank")).toBeInTheDocument()
    expect(ctx().defaultNetworkLogo).toBe(true)
    // Back on: geometry returns with the staged position tuning intact.
    clickTab("ui.settingsTabInformation")
    ensureOn("ui.networkLogo")
    clickTab("ui.settingsTabTransform")
    expect(within(transformPanel()).getByTestId("landscape-geo-network")).toBeInTheDocument()
    expect(puts).toHaveLength(0)
    fireEvent.click(screen.getByTestId("settings-save"))
    await screen.findByText("ui.synced")
    expect(puts).toHaveLength(1)
    expect(ctx().defaultNetworkLogo).toBe(true)
    const land = puts[0].body["landscape"] as Record<string, unknown>
    expect(land["networkLogo"]).toBe(true)
    expect(land["networkLogoPosition"]).toBe("top")
  })
})
