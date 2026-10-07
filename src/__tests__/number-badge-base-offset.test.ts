/**
 * U3 — baseline X di stile del badge NUMERO (`number`, solo rank).
 *
 * - Solo i rank `number` rendono a -20 canvas px dall'anchor condiviso
 *   (`cornerAnchoredLeft`), su entrambi i lati e entrambi i formati; `tox`
 *   resta l'aggiustamento utente relativo alla baseline (raw salvati intatti,
 *   nessun nuovo parametro).
 * - Extra in fallback legacy `rs=number` e tutti gli altri stili invariati.
 * - URL preview/Stremio emettono il `tox` raw (mai doppio conteggio).
 * - Gli slider X mostrano l'effettivo (-20 a stored 0) solo con `number`
 *   selezionato e convertono l'edit in aggiustamento; reset/dblclick
 *   ripristinano lo stored 0 (= baseline visiva -20) senza toccare altro.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, within } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import {
  NUMBER_BADGE_BASE_OFFSET_X,
  resolveNumberBadgeBaseOffsetX,
} from "@/lib/badge-styles"
import { buildRankingNumberSvg } from "@/lib/badge-svg-shared"
import { cornerAnchoredLeft, resolveTopBadgeStyle } from "@/lib/poster-service"
import { buildPreviewUrl, buildDefaultsPreviewUrl } from "@/lib/poster-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { TransformPanel } from "@/components/settings/TransformPanel"
import { TransformControls } from "@/components/TransformControls"
import { renderWithCtx } from "@/__tests__/test-utils"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

/** Formula del call-site in poster-service.ts (baseline + tox). */
function effLeft(
  canvasW: number,
  badgeW: number,
  mirrorRight: boolean,
  tox: number,
  topBadgeType: "rank" | "extra" | null,
  effectiveStyle: string,
): number {
  return cornerAnchoredLeft({
    canvasW,
    badgeW,
    mirrorRight,
    offsetX: tox + resolveNumberBadgeBaseOffsetX(topBadgeType, effectiveStyle),
  })
}

function historicLeft(canvasW: number, badgeW: number, mirrorRight: boolean, tox = 0): number {
  return cornerAnchoredLeft({ canvasW, badgeW, mirrorRight, offsetX: tox })
}

describe("resolveNumberBadgeBaseOffsetX", () => {
  it("is exactly -20 for rank numerals, 0 everywhere else", () => {
    expect(NUMBER_BADGE_BASE_OFFSET_X).toBe(-20)
    expect(resolveNumberBadgeBaseOffsetX("rank", "number")).toBe(-20)
    for (const style of ["default", "pill", "colored", "bordo", "vetro", "netflix", "corner", null, undefined, "garbage"]) {
      expect(resolveNumberBadgeBaseOffsetX("rank", style)).toBe(0)
    }
    // Extra badges on the legacy rs=number fallback keep the historic anchor.
    expect(resolveNumberBadgeBaseOffsetX("extra", "number")).toBe(0)
    expect(resolveNumberBadgeBaseOffsetX("extra", "corner")).toBe(0)
    expect(resolveNumberBadgeBaseOffsetX(null, "number")).toBe(0)
    expect(resolveNumberBadgeBaseOffsetX(undefined, "number")).toBe(0)
  })

  it("legacy extra fallback resolves to number but still gets no baseline", () => {
    // resolveTopBadgeStyle maps extra+xbs-absent to rs — the baseline helper
    // must key on the badge TYPE, not on the resolved style alone.
    const eff = resolveTopBadgeStyle({
      topBadgeType: "extra",
      rankingBadgeStyle: "number",
      extraBadgeStyle: null,
    })
    expect(eff).toBe("number")
    expect(resolveNumberBadgeBaseOffsetX("extra", eff)).toBe(0)
  })
})

describe("number baseline placement (both sides, portrait + landscape widths)", () => {
  const widths = [380, 500, 768]
  const badgeW = 80

  it("shifts rank number exactly -20 vs the historic anchor, left and right", () => {
    for (const canvasW of widths) {
      for (const mirrorRight of [false, true]) {
        expect(effLeft(canvasW, badgeW, mirrorRight, 0, "rank", "number")).toBe(
          historicLeft(canvasW, badgeW, mirrorRight) - 20,
        )
      }
    }
  })

  it("leaves non-number rank styles and extra badges on the historic anchor", () => {
    for (const canvasW of widths) {
      for (const mirrorRight of [false, true]) {
        for (const style of ["default", "pill", "corner", "colored", "bordo", "vetro"]) {
          expect(effLeft(canvasW, badgeW, mirrorRight, 0, "rank", style)).toBe(
            historicLeft(canvasW, badgeW, mirrorRight),
          )
        }
        // Extra badges: explicit corner style and legacy rs=number fallback.
        expect(effLeft(canvasW, badgeW, mirrorRight, 0, "extra", "corner")).toBe(
          historicLeft(canvasW, badgeW, mirrorRight),
        )
        expect(effLeft(canvasW, badgeW, mirrorRight, 0, "extra", "number")).toBe(
          historicLeft(canvasW, badgeW, mirrorRight),
        )
      }
    }
  })

  it("explicit tox=20 restores the old baseline for rank numerals", () => {
    for (const canvasW of widths) {
      for (const mirrorRight of [false, true]) {
        expect(effLeft(canvasW, badgeW, mirrorRight, 20, "rank", "number")).toBe(
          historicLeft(canvasW, badgeW, mirrorRight),
        )
      }
    }
  })

  it("keeps numeral ink on-canvas at the shifted left anchor (no clipping)", () => {
    // buildRankingNumberSvg pads ink with pad = max(8, round(pw*0.03)) on every
    // side; bitmap left may dip slightly below 0 but ink must stay intact.
    for (const [canvasW, pw] of [[380, 380], [768, 768]] as const) {
      const numW = buildRankingNumberSvg(3, pw).w
      const left = effLeft(canvasW, numW, false, 0, "rank", "number")
      const pad = Math.max(8, Math.round(pw * 0.03))
      expect(left + pad).toBeGreaterThan(0)
    }
  })
})

describe("preview/Stremio URL equality (raw tox, single application)", () => {
  const posterState = {
    selected: { id: 123, media_type: "movie" as const, title: "T", poster_path: "/p.jpg" },
    previewPoster: { file_path: "/p.jpg", iso_639_1: "it", vote_average: 7.5, width: 500, height: 750 },
    selectedLogo: null,
    selectedBackdrop: null,
    logoScale: 75,
    logoOffsetX: 0,
    logoOffsetY: 0,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    metaInfo: { genres: [{ id: 1, name: "A" }], voteAverage: 7.5 },
    trendRank: null,
    mdblistAnimeList: [],
    topEdgeColor: null,
    lang: "it",
    tmdbKey: "test-key",
  }
  const badgeParams = {
    globalBadges: true,
    rankingBadges: true,
    badgeStyle: "shadow" as const,
    rankingBadgeStyle: "number" as const,
    customBadge: null,
    gradientHeight: 30,
    blurIntensity: 5,
    blurFade: 60,
    blurDarkness: 40,
    blurEnabled: true,
    topBadgeScale: 100,
    topBadgeOffsetX: 0,
    topBadgeOffsetY: 0,
    genreBadgeScale: 100,
    qualityBadgeScale: 100,
    networkLogoScale: 100,
    genreBadgeOffsetX: 0,
    genreBadgeOffsetY: 0,
    qualityBadgeOffsetX: 0,
    qualityBadgeOffsetY: 0,
    networkLogoOffsetX: 0,
    networkLogoOffsetY: 0,
  }

  it("both URLs carry the raw adjustment (no baked baseline, no double shift)", () => {
    const previewTox = new URL(buildPreviewUrl(posterState as never, badgeParams as never), "http://localhost").searchParams.get("tox")
    const stremioTox = buildStremioPosterSearchParams({
      rankingBadgeStyle: "number",
      topBadgeOffsetX: 0,
    } as never).get("tox")
    expect(previewTox).toBe("0")
    expect(stremioTox).toBe("0")
    expect(previewTox).toBe(stremioTox)
  })
})

// ---------------------------------------------------------------------------
// UI: effective-X sliders (defaults portrait, landscape profile, per-title)
// ---------------------------------------------------------------------------

function seedDefaults(obj: Record<string, unknown>) {
  localStorage.setItem("badgeDefaults", JSON.stringify(obj))
}

const RANK_NUMBER_DEFAULTS = {
  defaultRankingBadges: true,
  defaultRankingBadgeStyle: "number",
  defaultTopBadgeScale: 100,
  defaultTopBadgeOffsetX: 0,
  defaultTopBadgeOffsetY: 0,
}

function renderWithProbe(ui: ReactNode) {
  let ctx: PosterEditorCtx | null = null
  function Probe() {
    ctx = usePosterEditor()
    return null
  }
  const view = renderWithCtx(createElement("div", null, ui, createElement(Probe)))
  return { view, ctx: () => ctx as PosterEditorCtx }
}

function topCard(): HTMLElement {
  const title = screen.getByText("ui.rankFamily")
  const card = title.closest("div.rounded-xl")
  expect(card).not.toBeNull()
  return card as HTMLElement
}

/** Landscape profile: all scaleGroups share one outer card — scope to the
 *  title's own group (flex head row -> group div). */
function topGroup(): HTMLElement {
  const title = screen.getByText("ui.rankFamily")
  const headRow = title.closest("div.flex")
  expect(headRow?.parentElement).not.toBeNull()
  return headRow!.parentElement as HTMLElement
}

function xSlider(card: HTMLElement): HTMLInputElement {
  return within(card).getByLabelText("X") as HTMLInputElement
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })))
})

describe("TransformPanel default X slider (number baseline)", () => {
  it("reads -20 with no write when number is selected at stored 0", () => {
    seedDefaults(RANK_NUMBER_DEFAULTS)
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    expect(xSlider(topCard()).value).toBe("-20")
    // Read-only mapping: the stored raw is untouched.
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
  })

  it("shows the raw value for other styles", () => {
    seedDefaults({ ...RANK_NUMBER_DEFAULTS, defaultRankingBadgeStyle: "corner" })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    expect(xSlider(topCard()).value).toBe("0")
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
  })

  it("slider edit -10 stores adjustment +10 (relative to baseline)", () => {
    seedDefaults(RANK_NUMBER_DEFAULTS)
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    fireEvent.change(xSlider(topCard()), { target: { value: "-10" } })
    expect(ctx().defaultTopBadgeOffsetX).toBe(10)
    expect(xSlider(topCard()).value).toBe("-10")
  })

  it("typed edit -10 stores adjustment +10 via the text field", () => {
    seedDefaults(RANK_NUMBER_DEFAULTS)
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    const card = topCard()
    fireEvent.click(within(card).getByRole("button", { name: "X: -20px" }))
    // The open text editor (range inputs also carry the display value, so
    // scope to the editor field, not getByDisplayValue).
    const editor = card.querySelector("input.editor-input") as HTMLInputElement | null
    expect(editor).not.toBeNull()
    fireEvent.change(editor!, { target: { value: "-10" } })
    fireEvent.blur(editor!)
    expect(ctx().defaultTopBadgeOffsetX).toBe(10)
  })

  it("double-click reset stores 0 (visual baseline -20), other settings intact", () => {
    seedDefaults({ ...RANK_NUMBER_DEFAULTS, defaultTopBadgeOffsetX: 10, defaultTopBadgeScale: 120 })
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    expect(xSlider(topCard()).value).toBe("-10")
    fireEvent.doubleClick(xSlider(topCard()))
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    expect(xSlider(topCard()).value).toBe("-20")
    // Only the X adjustment resets — scale and Y are preserved.
    expect(ctx().defaultTopBadgeScale).toBe(120)
    expect(ctx().defaultTopBadgeOffsetY).toBe(0)
  })

  it("switching styles never rewrites the stored raw adjustment", () => {
    seedDefaults(RANK_NUMBER_DEFAULTS)
    const { ctx } = renderWithProbe(createElement(TransformPanel, { active: true }))
    fireEvent.change(xSlider(topCard()), { target: { value: "-10" } })
    expect(ctx().defaultTopBadgeOffsetX).toBe(10)
    act(() => { ctx().setDefaultRankingBadgeStyle("corner") })
    expect(ctx().defaultTopBadgeOffsetX).toBe(10)
    expect(xSlider(topCard()).value).toBe("10")
    act(() => { ctx().setDefaultRankingBadgeStyle("number") })
    expect(ctx().defaultTopBadgeOffsetX).toBe(10)
    expect(xSlider(topCard()).value).toBe("-10")
  })
})

describe("LandscapeDefaultsSection top X slider (number baseline)", () => {
  function renderLandscape() {
    return renderWithProbe(
      createElement(TransformPanel, {
        active: true,
        previewShape: "landscape",
        onPreviewShapeChange: () => {},
      }),
    )
  }

  it("reads -20 from the flat at empty override, edit writes the override adjustment", () => {
    seedDefaults({ ...RANK_NUMBER_DEFAULTS, landscape: {} })
    const { ctx } = renderWithProbe(
      createElement(TransformPanel, {
        active: true,
        previewShape: "landscape",
        onPreviewShapeChange: () => {},
      }),
    )
    expect(xSlider(topGroup()).value).toBe("-20")
    expect(ctx().landscape.topBadgeOffsetX).toBeUndefined()
    fireEvent.change(xSlider(topGroup()), { target: { value: "-10" } })
    expect(ctx().landscape.topBadgeOffsetX).toBe(10)
    // The flat is never touched by the landscape edit.
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
  })

  it("double-click clears the override (follows the flat), other overrides intact", () => {
    seedDefaults({
      ...RANK_NUMBER_DEFAULTS,
      landscape: { topBadgeOffsetX: 10, topBadgeScale: 130 },
    })
    const { ctx } = renderLandscape()
    expect(xSlider(topGroup()).value).toBe("-10")
    fireEvent.doubleClick(xSlider(topGroup()))
    expect(ctx().landscape.topBadgeOffsetX).toBeUndefined()
    expect(xSlider(topGroup()).value).toBe("-20")
    expect(ctx().landscape.topBadgeScale).toBe(130)
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
  })

  it("flat ribbon + land number: baseline follows the ACTIVE (landscape) style", () => {
    seedDefaults({
      ...RANK_NUMBER_DEFAULTS,
      defaultRankingBadgeStyle: "netflix",
      landscape: { rankingBadgeStyle: "number" },
    })
    const { ctx } = renderLandscape()
    // Land style is number -> effective -20, even though the flat is a ribbon.
    expect(xSlider(topGroup()).value).toBe("-20")
    expect(ctx().landscape.topBadgeOffsetX).toBeUndefined()
    fireEvent.change(xSlider(topGroup()), { target: { value: "-10" } })
    // Stored as the land-only adjustment; flat style and flat X untouched.
    expect(ctx().landscape.topBadgeOffsetX).toBe(10)
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
    expect(ctx().defaultRankingBadgeStyle).toBe("netflix")
  })

  it("flat number + land pill: no baseline on the landscape target", () => {
    seedDefaults({
      ...RANK_NUMBER_DEFAULTS,
      landscape: { rankingBadgeStyle: "pill" },
    })
    const { ctx } = renderLandscape()
    // Land style is pill -> raw stored value, no baseline.
    expect(xSlider(topGroup()).value).toBe("0")
    fireEvent.change(xSlider(topGroup()), { target: { value: "10" } })
    expect(ctx().landscape.topBadgeOffsetX).toBe(10)
    expect(xSlider(topGroup()).value).toBe("10")
    expect(ctx().defaultTopBadgeOffsetX).toBe(0)
  })

  it("cleared override follows the inherited flat (style and adjustment)", () => {
    seedDefaults({
      ...RANK_NUMBER_DEFAULTS,
      defaultTopBadgeOffsetX: 5,
      landscape: { topBadgeOffsetX: 10 },
    })
    const { ctx } = renderLandscape()
    // Land override active (flat style number is inherited -> 10 - 20).
    expect(xSlider(topGroup()).value).toBe("-10")
    fireEvent.doubleClick(xSlider(topGroup()))
    // Override cleared: landscape inherits flat number + stored 5 -> -15.
    expect(ctx().landscape.topBadgeOffsetX).toBeUndefined()
    expect(xSlider(topGroup()).value).toBe("-15")
    expect(ctx().defaultTopBadgeOffsetX).toBe(5)
  })

  it("defaults preview URLs carry the raw per-shape tox (no baked baseline)", () => {
    const portrait = new URL(
      buildDefaultsPreviewUrl({
        defaultRankingBadgeStyle: "number",
        defaultTopBadgeOffsetX: 5,
        landscape: { rankingBadgeStyle: "number", topBadgeOffsetX: 10 },
      } as never),
      "http://localhost",
    ).searchParams
    const landscape = new URL(
      buildDefaultsPreviewUrl({
        defaultRankingBadgeStyle: "number",
        defaultTopBadgeOffsetX: 5,
        previewShape: "landscape",
        landscape: { rankingBadgeStyle: "number", topBadgeOffsetX: 10 },
      } as never),
      "http://localhost",
    ).searchParams
    expect(portrait.get("tox")).toBe("5")
    expect(landscape.get("tox")).toBe("10")
  })
})

describe("TransformControls per-title X slider (number baseline)", () => {
  function topTitleCard(): HTMLElement {
    const title = screen.getByText("ui.rankFamily · ui.posterShapePortrait")
    const card = title.closest("div.rounded-xl")
    expect(card).not.toBeNull()
    return card as HTMLElement
  }

  it("reads -20 with number selected, edit stores the relative adjustment", () => {
    seedDefaults({ ...RANK_NUMBER_DEFAULTS, defaultRankingBadges: true })
    const { ctx } = renderWithProbe(createElement(TransformControls))
    expect(ctx().rankingBadgeStyle).toBe("number")
    expect(xSlider(topTitleCard()).value).toBe("-20")
    expect(ctx().topBadgeOffsetX).toBe(0)
    fireEvent.change(xSlider(topTitleCard()), { target: { value: "-10" } })
    expect(ctx().topBadgeOffsetX).toBe(10)
  })
})
