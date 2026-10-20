/**
 * Per-title other-shape drafts across ALL full-save entry points.
 *
 * Shared-stash boundary (see `src/lib/shape-draft.ts`): the EditView shape
 * stash is mirrored into PosterEditorContext keyed by the actual selected
 * title (+ user namespace). The normal Save passes its local stash
 * explicitly (wins); exclusion autosaves resolve the shared draft through
 * the production `useSharedShapeStash` hook — same full-save contract, same
 * `otherShapeStash`. Cover-only saves intentionally carry no draft.
 *
 * All tests drive the REAL EditView shape-switch handler (button clicks) and
 * the REAL usePosterSave boundary; the stash under test is produced by the
 * handler (never hand-injected), bridged to the save by the production hook
 * exactly as context.tsx wires the real autosaves.
 */
import { useEffect } from "react"
import { render, act, screen, waitFor } from "@testing-library/react"
import { describe, it, expect, beforeEach, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { MOCK_CTX } from "@/__tests__/test-utils"
import { PictoriumProvider } from "@/lib/context"
import { PosterEditorProvider, usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
import { ThemeProvider } from "@/lib/contexts/ThemeContext"
import { usePosterSave } from "@/lib/usePosterSave"
import {
  perTitleDraftKey,
  otherShapeOf,
  cloneShapeDraft,
  useSharedShapeStash,
} from "@/lib/shape-draft"
import EditView from "@/components/EditView"
import type { SearchResult, TMDBImage, Mapping } from "@/lib/types"

function img(path: string, lang: string | null): TMDBImage {
  return { file_path: path, iso_639_1: lang, vote_average: 0, width: 500, height: 750 }
}

const ITEM_A: SearchResult = { id: 101, media_type: "movie", title: "Alpha", poster_path: "/a.jpg" }
const ITEM_B: SearchResult = { id: 202, media_type: "movie", title: "Beta", poster_path: "/b.jpg" }

const noop = () => {}

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

const capture: {
  ed: PosterEditorCtx | null
  saveConfig: ((o?: Record<string, unknown>) => Promise<unknown>) | null
  saveCoverOnly: (() => Promise<unknown>) | null
  withShared: ((o?: Record<string, unknown>) => Record<string, unknown>) | null
} = { ed: null, saveConfig: null, saveCoverOnly: null, withShared: null }

function Probes(props: {
  selected: SearchResult
  previewPoster: TMDBImage
  mappingsMap: Map<string, Mapping>
  userId: string | null
}) {
  const ed = usePosterEditor()
  // Production autosave bridge (same wiring as context.tsx): explicit
  // otherShapeStash wins, otherwise the shared draft for the current
  // title+other-shape is attached.
  const withShared = useSharedShapeStash<Record<string, unknown>>({
    selected: props.selected,
    userId: props.userId,
    shape: ed.posterShape,
    readDraft: ed.readShapeDraft,
  })
  // Full-save boundary wired like context.tsx: live editor values, static
  // fixtures for the rest. Mirrors the production usePosterSave call-site.
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
    customBadge: null,
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
    accentColor: null,
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
    capture.saveConfig = saver.saveConfig as never
    capture.saveCoverOnly = saver.saveCoverOnly as never
    capture.withShared = withShared as never
  })
  return null
}

function renderAutosaveEditor(first: Record<string, unknown>) {
  function Host({ over }: { over: Record<string, unknown> }) {
    const value = { ...MOCK_CTX, ...over }
    return (
      <ThemeProvider>
        <PosterEditorProvider>
          <PictoriumProvider value={value}>
            <EditView />
            <Probes
              selected={value.selected as SearchResult}
              previewPoster={value.previewPoster as TMDBImage}
              mappingsMap={value.mappingsMap as Map<string, Mapping>}
              userId={(value.currentUserId as string | null) ?? null}
            />
          </PictoriumProvider>
        </PosterEditorProvider>
      </ThemeProvider>
    )
  }
  const view = render(<Host over={first} />)
  return {
    ...view,
    show: (over: Record<string, unknown>) => view.rerender(<Host over={over} />),
    editor: () => capture.ed as PosterEditorCtx,
    save: () => capture.saveConfig as (o?: Record<string, unknown>) => Promise<unknown>,
    saveCoverOnly: () => capture.saveCoverOnly as () => Promise<unknown>,
    shared: () => capture.withShared as (o?: Record<string, unknown>) => Record<string, unknown>,
  }
}

function baseFirst(extra: Record<string, unknown> = {}) {
  return {
    selected: ITEM_A,
    posters: [img("/a.jpg", null)],
    previewPoster: img("/a.jpg", null),
    logos: [],
    selectedLogo: null,
    mappingsMap: new Map<string, Mapping>(),
    ...extra,
  }
}

/** Portrait edit (pill) -> real switch to landscape -> landscape edit. */
async function stageBothShapes(u: ReturnType<typeof userEvent.setup>, editor: () => PosterEditorCtx) {
  await act(async () => {
    editor().setDefaultBadgeStyle("shadow")
    editor().setLandscape({ badgeStyle: "vetro" })
    editor().setBadgeStyle("pill")
  })
  await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
  await waitFor(() => expect(editor().posterShape).toBe("landscape"))
  await act(async () => {
    editor().setBadgeStyle("colored")
  })
}

describe("shared per-title other-shape draft boundary (real handler + production hook)", () => {
  it("landscape exclusion-save keeps the staged portrait look for a new title", async () => {
    const u = userEvent.setup()
    const { editor, save, shared } = renderAutosaveEditor(baseFirst())
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await stageBothShapes(u, editor)
    // Exclusion-style full save through the production autosave bridge
    // (silent + exclusion overrides, stash resolved from the shared store).
    await act(async () => {
      await save()(shared()({ excludedPosters: ["/x.jpg"], rotationPosters: [], silent: true }))
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.excludedPosters).toEqual(["/x.jpg"])
    // The staged portrait draft survives the full-replace POST.
    expect(posts[0].body.badgeStyle).toBe("pill")
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgeStyle).toBe("colored")
  })

  it("portrait exclusion-save keeps the staged landscape look for a new title", async () => {
    const u = userEvent.setup()
    const { editor, save, shared } = renderAutosaveEditor(baseFirst())
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await stageBothShapes(u, editor)
    // Back to portrait (stashes the landscape colored), then save there.
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    expect(editor().badgeStyle).toBe("pill")
    await act(async () => {
      await save()(shared()({ excludedBackdrops: ["/b.jpg"], silent: true }))
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgeStyle).toBe("pill")
    const land = posts[0].body.landscape as Record<string, unknown>
    // The staged landscape draft wins over the pre-edit backfill.
    expect(land.badgeStyle).toBe("colored")
  })

  it("backdrop-style autosave overrides keep the draft (second autosave contract)", async () => {
    const u = userEvent.setup()
    const { editor, save, shared } = renderAutosaveEditor(baseFirst())
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await stageBothShapes(u, editor)
    // Same override shape autoSaveExcludedBackdrops sends (backdrop + lists).
    await act(async () => {
      await save()(
        shared()({
          excludedBackdrops: ["/old.jpg"],
          rotationBackdrops: [],
          selectedBackdrop: img("/bd.jpg", null),
          silent: true,
        }),
      )
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.backdropPath).toBe("/bd.jpg")
    expect(posts[0].body.badgeStyle).toBe("pill")
  })

  it("saved title: staged draft wins over stale saved flats on exclusion-save", async () => {
    const u = userEvent.setup()
    const prev: Mapping = {
      tmdbId: 101,
      mediaType: "movie",
      title: "Alpha",
      posterPath: "/a.jpg",
      logoPath: null,
      originalPosterPath: null,
      language: null,
      updatedAt: "2026-01-01",
      badgeStyle: "shadow",
    }
    const { editor, save, shared } = renderAutosaveEditor(
      baseFirst({ mappingsMap: new Map([["movie:101", prev]]) }),
    )
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await stageBothShapes(u, editor)
    await act(async () => {
      await save()(shared()({ excludedPosters: ["/x.jpg"], silent: true }))
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    // The staged portrait edit (newer than the saved mapping) wins; the
    // untouched saved flat is still preserved verbatim elsewhere.
    expect(posts[0].body.badgeStyle).toBe("pill")
  })

  it("explicit otherShapeStash wins over the shared draft (no silent conversion)", async () => {
    const u = userEvent.setup()
    const { editor, save, shared } = renderAutosaveEditor(baseFirst())
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await stageBothShapes(u, editor)
    await act(async () => {
      await save()(shared()({ otherShapeStash: { badgeStyle: "minimal" }, silent: true }))
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgeStyle).toBe("minimal")
  })

  it("explicit false/zero/empty-array/follow-rank drafts survive verbatim", async () => {
    const u = userEvent.setup()
    const { editor, save, shared } = renderAutosaveEditor(baseFirst())
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await act(async () => {
      editor().setDefaultBadgeStyle("shadow")
      editor().setLandscape({ badgeStyle: "vetro" })
      // Falsy-but-meaningful staged portrait values.
      editor().setBadgeGenre(false)
      editor().setExtraBadgeStyle("follow-rank")
      editor().setVideoFormats([])
    })
    await u.click(screen.getByRole("button", { name: "ui.posterShapeLandscape" }))
    await waitFor(() => expect(editor().posterShape).toBe("landscape"))
    await act(async () => {
      await save()(shared()({ excludedPosters: ["/x.jpg"], silent: true }))
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect("badgeGenre" in posts[0].body).toBe(true)
    expect(posts[0].body.badgeGenre).toBe(false)
    expect(posts[0].body.extraBadgeStyle).toBe("follow-rank")
    expect(posts[0].body.videoFormats).toEqual([])
  })

  it("no draft leak across titles: new title B saves clean after A staged", async () => {
    const u = userEvent.setup()
    const { editor, save, shared, show } = renderAutosaveEditor(baseFirst())
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await stageBothShapes(u, editor)
    // Open a different title (honest open init to the flat defaults, as the
    // real open flow initializes live state for the new title).
    show(baseFirst({ selected: ITEM_B, previewPoster: img("/b.jpg", null) }))
    await act(async () => {
      editor().setBadgeStyle("shadow")
    })
    // Back to portrait first (the switcher is in landscape from title A).
    await u.click(screen.getByRole("button", { name: "ui.posterShapePortrait" }))
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await act(async () => {
      await save()(shared()({ excludedPosters: ["/x.jpg"], silent: true }))
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    // Title B's own look only: nothing from A's pill/colored may surface.
    expect(posts[0].body.badgeStyle).toBe("shadow")
    expect(JSON.stringify(posts[0].body)).not.toMatch(/pill|colored/)
  })

  it("no draft leak across users: same title under another namespace saves clean", async () => {
    const u = userEvent.setup()
    const { editor, save, shared, show } = renderAutosaveEditor(baseFirst())
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await stageBothShapes(u, editor)
    // Same title opened under another user namespace: honest open init to
    // the flat defaults, then save through that namespace's bridge.
    show(baseFirst({ currentUserId: "user-2" }))
    await act(async () => {
      editor().setBadgeStyle("shadow")
    })
    await act(async () => {
      await save()(shared()({ excludedPosters: ["/x.jpg"], silent: true }))
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    expect(JSON.stringify(posts[0].body)).not.toMatch(/pill|colored/)
  })

  it("cover-only intentionally carries no styling even with staged drafts", async () => {
    const u = userEvent.setup()
    const { editor, saveCoverOnly } = renderAutosaveEditor(baseFirst())
    await waitFor(() => expect(editor().posterShape).toBe("poster"))
    await stageBothShapes(u, editor)
    await act(async () => {
      await saveCoverOnly()()
    })
    const posts = mappingPosts()
    expect(posts).toHaveLength(1)
    // Intentional clear-customization contract: no frozen styling, no
    // landscape profile — the title follows the global defaults again.
    expect("badgeStyle" in posts[0].body).toBe(false)
    expect("rankingBadgeStyle" in posts[0].body).toBe(false)
    expect("landscape" in posts[0].body).toBe(false)
    expect(posts[0].body.posterPath).toBe("/a.jpg")
  })
})

describe("shape-draft key/ownership/clone units", () => {
  it("keys qualify title identity with the user namespace", () => {
    expect(perTitleDraftKey(null, "movie", 101)).toBe("anon:movie:101")
    expect(perTitleDraftKey("u1", "movie", 101)).toBe("u1:movie:101")
    expect(perTitleDraftKey("u1", "tv", 101)).toBe("u1:tv:101")
    expect(otherShapeOf("poster")).toBe("landscape")
    expect(otherShapeOf("landscape")).toBe("poster")
  })

  it("clone preserves falsy values and breaks array aliasing", () => {
    const src = { badgeGenre: false, topBadgeOffsetX: 0, videoFormats: [] } as never
    const copy = cloneShapeDraft(src as never) as Record<string, unknown>
    expect(copy.badgeGenre).toBe(false)
    expect(copy.topBadgeOffsetX).toBe(0)
    expect(copy.videoFormats).toEqual([])
    expect(copy.videoFormats).not.toBe((src as Record<string, unknown>).videoFormats)
  })
})
