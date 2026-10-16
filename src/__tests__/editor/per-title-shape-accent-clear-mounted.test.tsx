/**
 * Correction 1/3 (mounted): explicit manual->auto accent clear through the
 * REAL EditView shape-switch handler + REAL save boundary.
 *
 * Unlike the hook-boundary suite (per-title-shape-accent-clear), nothing here
 * is hand-injected where it matters:
 * - the explicit-auto action goes through the REAL BadgeControls Reset button
 *   (same `setAccentColor(autoAccentColor ?? null)` statement as production);
 * - the portrait stash is produced by the REAL handleShapeChange click
 *   (`isManualAccent(...) ? accentColor : null` — never fabricated);
 * - the save crosses the REAL usePosterSave boundary, both via the
 *   production `useSharedShapeStash` bridge (exclusion-autosave entry, same
 *   wiring as context.tsx) and via the shared draft read API (the normal-Save
 *   entry reads the mirrored local stash; same object content by construction,
 *   see shape-draft.ts).
 * - accent live state is a real useState pair in the host (manual/auto
 *   provenance observable), not a stub setter.
 */
import { useEffect, useState } from "react"
import { render, act, screen, waitFor } from "@testing-library/react"
import { describe, it, expect, beforeEach, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { PictoriumProvider, useP } from "@/lib/context"
import { PosterEditorProvider, usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import { usePosterSave } from "@/lib/usePosterSave"
import { perTitleDraftKey, otherShapeOf, useSharedShapeStash } from "@/lib/shape-draft"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import { mappingSchema } from "@/lib/validation"
import EditView from "@/components/EditView"
import type { SearchResult, TMDBImage } from "@/lib/types"

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", poster_path: "/a.jpg" }
const ITEM_B: SearchResult = { id: 202, media_type: "movie", title: "Beta", poster_path: "/b.jpg" }

const noop = () => {}
const MANUAL = "#a1b2c3"
const AUTO = "#000000"

let posted: { url: string; body: Record<string, unknown> }[]
beforeEach(() => {
  localStorage.clear()
  posted = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: unknown) => {
      const body = (init as { body?: string })?.body
      posted.push({ url: String(url), body: body ? JSON.parse(body) : {} })
      return { ok: true, status: 200, text: async () => "", json: async () => ({}) }
    }),
  )
})

function mappingPosts() {
  return posted.filter((p) => String(p.url).includes("/api/mappings"))
}

const savedManual = (id: number, accent: string | null): Mapping => ({
  tmdbId: id, mediaType: "movie", title: id === 101 ? "Alpha" : "Beta", posterPath: "/a.jpg",
  logoPath: null, originalPosterPath: null, language: null, updatedAt: "2026-01-01",
  accentColor: accent,
})

const capture: {
  ed: PosterEditorCtx | null
  saveConfig: ((o?: Record<string, unknown>) => Promise<unknown>) | null
  withShared: ((o?: Record<string, unknown>) => Record<string, unknown>) | null
  accent: () => { accent: string | null; auto: string | null }
} = { ed: null, saveConfig: null, withShared: null, accent: () => ({ accent: null, auto: null }) }

function Probes(props: {
  selected: SearchResult
  previewPoster: TMDBImage
  mappingsMap: Map<string, Mapping>
  accentColor: string | null
  autoAccentColor: string | null
  userId: string | null
}) {
  const ed = usePosterEditor()
  const p = useP()
  const withShared = useSharedShapeStash<Record<string, unknown>>({
    selected: props.selected,
    userId: props.userId,
    shape: ed.posterShape,
    readDraft: ed.readShapeDraft,
  })
  const saver = usePosterSave({
    selected: props.selected,
    previewPoster: props.previewPoster,
    selectedLogo: null,
    setSelectedLogo: noop,
    setPreviewPoster: noop,
    setPreviewId: noop,
    posters: [props.previewPoster],
    metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5 },
    trendRank: null,
    mdblistAnimeList: [],
    mappingsMap: props.mappingsMap,
    loadMappings: async () => {},
    logoScale: ed.logoScale,
    logoOffsetX: ed.logoOffsetX,
    logoOffsetY: ed.logoOffsetY,
    selectedBackdrop: null,
    setSelectedBackdrop: noop,
    backdropScale: 100,
    backdropOffsetX: 0,
    backdropOffsetY: 0,
    setBackdropScale: noop,
    setBackdropOffsetX: noop,
    setBackdropOffsetY: noop,
    globalBadges: ed.globalBadges,
    rankingBadges: ed.rankingBadges,
    badgeGenre: ed.badgeGenre,
    badgeYear: ed.badgeYear,
    badgeRating: ed.badgeRating,
    badgeQuality: ed.badgeQuality,
    customRatings: ed.customRatings,
    ratingSources: ["imdb", "tmdb"],
    separateRatings: ed.separateRatings,
    separateRatingsStyle: ed.separateRatingsStyle,
    customBadge: ed.customBadge,
    badgePresetId: ed.badgePresetId,
    badgePresetRev: ed.badgePresetRev,
    badgeStyle: ed.badgeStyle,
    rankingBadgeStyle: ed.rankingBadgeStyle,
    extraBadgeStyle: ed.extraBadgeStyle,
    badgeFont: ed.badgeFont,
    qualityBadgeStyle: ed.qualityBadgeStyle,
    videoFormats: ed.videoFormats,
    defaultBadgeStyle: "shadow",
    defaultRankingBadgeStyle: "default",
    defaultExtraBadgeStyle: null,
    blurEnabled: true,
    blurIntensity: 20,
    blurFade: 50,
    blurDarkness: 30,
    landscapeBlur: ed.landscapeBlur,
    landscapeBlurDirty: ed.landscapeBlurDirty,
    setLandscapeBlur: noop,
    defaultLogoScale: null,
    defaultLogoOffsetX: null,
    defaultLogoOffsetY: null,
    landscapeDefaults: null,
    tintStrength: 20,
    topShade: 50,
    topShadeHeight: 25,
    gradientHeight: 30,
    setGradientHeight: noop,
    setBlurFade: noop,
    topBadgeScale: ed.topBadgeScale,
    topBadgeOffsetX: ed.topBadgeOffsetX,
    topBadgeOffsetY: ed.topBadgeOffsetY,
    extraBadgeScale: ed.extraBadgeScale,
    extraBadgeOffsetX: ed.extraBadgeOffsetX,
    extraBadgeOffsetY: ed.extraBadgeOffsetY,
    genreBadgeScale: ed.genreBadgeScale,
    qualityBadgeScale: ed.qualityBadgeScale,
    networkLogoScale: ed.networkLogoScale,
    separateBadgeScale: ed.separateBadgeScale,
    separateBadgeOffsetX: ed.separateBadgeOffsetX,
    separateBadgeOffsetY: ed.separateBadgeOffsetY,
    genreBadgeOffsetX: ed.genreBadgeOffsetX,
    genreBadgeOffsetY: ed.genreBadgeOffsetY,
    qualityBadgeOffsetX: ed.qualityBadgeOffsetX,
    qualityBadgeOffsetY: ed.qualityBadgeOffsetY,
    networkLogoOffsetX: ed.networkLogoOffsetX,
    networkLogoOffsetY: ed.networkLogoOffsetY,
    rotationPosters: [],
    autoRotateClean: false,
    defaultAutoRotateClean: false,
    excludedPosters: [],
    // Production wiring (context.tsx): the save boundary reads the live
    // outer-context accent pair, never a fixture.
    accentColor: props.accentColor,
    autoAccentColor: props.autoAccentColor,
    logoDisabled: false,
    setLogoDisabled: noop,
    setLogoScale: noop,
    setLogoOffsetX: noop,
    setLogoOffsetY: noop,
    logoScaleExplicit: ed.logoScaleExplicit,
    rotationBackdrops: [],
    autoRotateBackdrop: false,
    defaultAutoRotateBackdrop: false,
    excludedBackdrops: [],
    backdrops: [],
    networkLogo: ed.networkLogo,
    networkLogoPosition: ed.networkLogoPosition,
    networkLogoFollowTitle: ed.networkLogoFollowTitle,
    ribbonEnabled: ed.ribbonEnabled,
    lang: "it",
    episodeGroupId: null,
    posterShape: ed.posterShape,
    posterLayout: ed.posterLayout,
    posterFreshScope: ed.posterFreshScope,
    defaultSashOrder: null,
  } as never)
  useEffect(() => {
    capture.ed = ed
    capture.saveConfig = saver.saveConfig as unknown as (o?: Record<string, unknown>) => Promise<unknown>
    capture.withShared = withShared as unknown as (o?: Record<string, unknown>) => Record<string, unknown>
    capture.accent = () => ({ accent: p.accentColor, auto: p.autoAccentColor })
  })
  return null
}

function Host(props: {
  selected: SearchResult
  mappingsMap: Map<string, Mapping>
  initialAccent: string | null
  initialAuto: string | null
}) {
  const [accentColor, setAccentColorState] = useState<string | null>(props.initialAccent)
  const [autoAccentColor, setAutoAccentColorState] = useState<string | null>(props.initialAuto)
  const value = {
    ...MOCK_CTX,
    selected: props.selected,
    posters: [img("/a.jpg", null)],
    previewPoster: img("/a.jpg", null),
    logos: [],
    selectedLogo: null,
    mappingsMap: props.mappingsMap,
    previewUrl: "",
    accentColor,
    autoAccentColor,
    setAccentColor: (v: string | null) => setAccentColorState(v),
    // autoAccentColor is sampled, never user-written in this flow.
    setAutoAccentColor: (v: string | null) => setAutoAccentColorState(v),
  }
  return (
    <ThemeProvider>
      <PosterEditorProvider>
        <PictoriumProvider value={value}>
          <EditView />
          <Probes
            selected={props.selected}
            previewPoster={img("/a.jpg", null)}
            mappingsMap={props.mappingsMap}
            accentColor={accentColor}
            autoAccentColor={autoAccentColor}
            userId={null}
          />
        </PictoriumProvider>
      </PosterEditorProvider>
    </ThemeProvider>
  )
}

function renderAccentEditor(opts: {
  selected?: SearchResult
  mappingsMap?: Map<string, Mapping>
  initialAccent?: string | null
  initialAuto?: string | null
}) {
  const view = render(
    <Host
      selected={opts.selected ?? ITEM_A}
      mappingsMap={opts.mappingsMap ?? new Map()}
      initialAccent={opts.initialAccent ?? null}
      initialAuto={opts.initialAuto ?? null}
    />,
  )
  return view
}

async function openBadgeTab(u: ReturnType<typeof userEvent.setup>) {
  await u.click(screen.getByRole("tab", { name: "ui.badgeSection" }))
}

describe("mounted manual->auto clear survives switch + save + autosave", () => {
  it("Reset -> switch landscape -> autosave + explicit save drop the saved manual flat", async () => {
    const u = userEvent.setup()
    const mappingsMap = new Map<string, Mapping>([["movie:101", savedManual(101, MANUAL)]])
    renderAccentEditor({ mappingsMap, initialAccent: MANUAL, initialAuto: AUTO })
    const editor = () => capture.ed as PosterEditorCtx
    await waitFor(() => expect(editor().posterShape).toBe("poster"))

    // Live provenance is manual (as a real open of the saved manual produces).
    expect(capture.accent().accent).toBe(MANUAL)

    // REAL explicit-auto control: BadgeControls Reset writes auto, never a fixture.
    await openBadgeTab(u)
    await u.click(screen.getByRole("button", { name: "Reset" }))
    await waitFor(() => expect(capture.accent().accent).toBe(AUTO))

    // REAL shape-switch handler: stashes the portrait look (explicit auto).
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))

    // Entry 1 — exclusion autosave (production shared-stash bridge).
    await act(async () => {
      await capture.saveConfig!(capture.withShared!({ silent: true, excludedPosters: ["/x.jpg"] }))
    })
    // Entry 2 — normal Save (mirrored explicit stash, same content handleSave forwards).
    const key = perTitleDraftKey(null, "movie", 101)
    const portraitDraft = editor().readShapeDraft(key, otherShapeOf("landscape"))
    expect(portraitDraft).not.toBeNull()
    expect((portraitDraft as Record<string, unknown>).accentColor).toBeNull()
    await act(async () => {
      await capture.saveConfig!({ silent: true, otherShapeStash: portraitDraft ?? undefined })
    })

    const posts = mappingPosts()
    expect(posts).toHaveLength(2)
    for (const post of posts) {
      // The saved manual is gone on BOTH entries: flat dropped (= auto).
      expect("accentColor" in post.body).toBe(false)
      // Landscape was never visited: its live inherited the (pre-clear) flat
      // manual, and a landscape save freezes inherit->explicit like every
      // other key — render-equivalent, independence preserved (the landscape
      // look does not follow the portrait clear).
      const land = post.body.landscape as Record<string, unknown>
      expect(land.accentColor).toBe(MANUAL)
    }
    // Reopen read boundary: portrait resolves auto, landscape keeps its own
    // (frozen-inherit) manual — never a cross-shape leak in either direction.
    const parsed = mappingSchema.safeParse(posts[0].body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const saved = parsed.data as unknown as Mapping
    expect(effectiveMappingForShape(saved, "poster")?.accentColor).toBeUndefined()
    expect(effectiveMappingForShape(saved, "landscape")?.accentColor).toBe(MANUAL)
  })

  it("untouched saved manual survives the same switch + save (no explicit clear)", async () => {
    const u = userEvent.setup()
    const mappingsMap = new Map<string, Mapping>([["movie:101", savedManual(101, MANUAL)]])
    renderAccentEditor({ mappingsMap, initialAccent: MANUAL, initialAuto: AUTO })
    const editor = () => capture.ed as PosterEditorCtx
    await waitFor(() => expect(editor().posterShape).toBe("poster"))

    // No Reset: the portrait stash carries the manual on switch.
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))

    await act(async () => {
      await capture.saveConfig!(capture.withShared!({ silent: true, excludedPosters: ["/x.jpg"] }))
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.accentColor).toBe(MANUAL)
  })

  it("reverse: landscape manual -> auto -> switch portrait -> save keeps portrait flat, records landscape auto", async () => {
    const u = userEvent.setup()
    const prev: Mapping = {
      ...savedManual(101, MANUAL),
      landscape: { accentColor: "#d4e5f6" },
    }
    const mappingsMap = new Map<string, Mapping>([["movie:101", prev]])
    renderAccentEditor({ mappingsMap, initialAccent: MANUAL, initialAuto: AUTO })
    const editor = () => capture.ed as PosterEditorCtx
    await waitFor(() => expect(editor().posterShape).toBe("poster"))

    // Move to landscape first (portrait stash = manual), then clear to auto
    // in landscape via the same real Reset control.
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    await openBadgeTab(u)
    // Landscape live shows the saved landscape manual (restored by the real switch).
    expect(capture.accent().accent).toBe("#d4e5f6")
    await u.click(screen.getByRole("button", { name: "Reset" }))
    await waitFor(() => expect(capture.accent().accent).toBe(AUTO))

    // Back to portrait: the landscape stash carries explicit auto.
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(editor().posterShape).toBe("poster"))

    const key = perTitleDraftKey(null, "movie", 101)
    const landDraft = editor().readShapeDraft(key, otherShapeOf("poster"))
    expect((landDraft as Record<string, unknown>).accentColor).toBeNull()
    await act(async () => {
      await capture.saveConfig!({ silent: true, otherShapeStash: landDraft ?? undefined })
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    // Back in portrait the live correctly shows the portrait stash (manual):
    // the portrait flat is untouched by the landscape clear. The landscape
    // stash (explicit auto) lands in the profile as null.
    expect(posts[0].body.accentColor).toBe(MANUAL)
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.accentColor).toBeNull()
    // Reopen read boundary: portrait keeps its manual, landscape resolves
    // auto — per-shape independence in both directions.
    const parsed = mappingSchema.safeParse(posts[0].body)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const saved = parsed.data as unknown as Mapping
    expect(effectiveMappingForShape(saved, "poster")?.accentColor).toBe(MANUAL)
    expect(effectiveMappingForShape(saved, "landscape")?.accentColor).toBeNull()
  })

  it("a second title without any switch keeps its own saved manual (isolation)", async () => {
    const u = userEvent.setup()
    const mappingsMap = new Map<string, Mapping>([
      ["movie:101", savedManual(101, MANUAL)],
      ["movie:202", savedManual(202, "#b2c3d4")],
    ])
    const view = renderAccentEditor({ selected: ITEM_B, mappingsMap, initialAccent: "#b2c3d4", initialAuto: AUTO })
    const editor = () => capture.ed as PosterEditorCtx
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    // Title B never visited the other shape: a portrait save keeps its flat.
    await act(async () => {
      await capture.saveConfig!({ silent: true })
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.accentColor).toBe("#b2c3d4")
    view.unmount()
    void u
  })
})
