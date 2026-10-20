/**
 * Task B — real staged → preview → save → reload chain per family and shape.
 *
 * Uses the REAL PosterEditorProvider staged state (no hook mocks): staging a
 * family flows into the canonical `bp` preview param, the full-replace save
 * persists it per shape, and the reload (effectiveMappingForShape) honors it
 * per shape while the other shape stays verbatim. Also covers the shared
 * exclusion-autosave stash carrying the staged family map under the same
 * `otherShapeStash` contract.
 */
import { beforeEach, describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { PosterEditorProvider, usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePosterSave } from "@/lib/usePosterSave"
import { perTitleDraftKey, useSharedShapeStash } from "@/lib/shape-draft"
import { buildPreviewUrl } from "@/lib/poster-url"
import { effectiveMappingForShape } from "@/lib/types"
import {
  baseSaveDeps,
  mappingPosts,
  stubMappingPost,
  testMapping,
  type PostedCall,
} from "./family-preset-save-harness"

const A = "Abc123-_XyZ"
const REV = "deadbeef"
const B = "Qwerty12-34"
const REV_B = "cafef00d"

const psBase = {
  selected: { id: 1, media_type: "movie", title: "T", poster_path: "/p.jpg" },
  previewPoster: null,
  selectedLogo: null,
  selectedBackdrop: null,
  logoScale: 75,
  logoOffsetX: 0,
  logoOffsetY: 0,
  backdropScale: 100,
  backdropOffsetX: 0,
  backdropOffsetY: 0,
  metaInfo: { genres: [], voteAverage: 0 },
  trendRank: null,
  mdblistAnimeList: [],
  topEdgeColor: null,
  bottomEdgeColor: null,
  accentColor: null,
  autoAccentColor: null,
  lang: "it",
  tmdbKey: "",
}

const bpBase = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  gradientHeight: 30,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  blurEnabled: true,
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  genreBadgeScale: 100,
  genreBadgeOffsetX: 0,
  genreBadgeOffsetY: 0,
  qualityBadgeScale: 100,
  qualityBadgeOffsetX: 0,
  qualityBadgeOffsetY: 0,
  networkLogoScale: 100,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
  posterShape: "poster",
}

function wrapper({ children }: { children: ReactNode }) {
  return <PosterEditorProvider>{children}</PosterEditorProvider>
}

let posted: PostedCall[]
beforeEach(() => {
  posted = []
  stubMappingPost(posted)
})

describe("staged family flows into preview, save and reload", () => {
  it("picker staged state renders the canonical bp preview param", () => {
    const { result } = renderHook(() => usePosterEditor(), { wrapper })
    act(() => {
      result.current.setFamilyPreset("quality", { id: A, rev: REV })
    })
    expect(result.current.badgePresets).toEqual({ quality: { id: A, rev: REV } })
    const url = new URL(
      buildPreviewUrl(psBase as never, { ...bpBase, badgePresets: result.current.badgePresets } as never),
    )
    expect(url.searchParams.get("bp")).toBe(`quality:${A}.${REV}`)
    // Clearing stages the explicit Standard token for that family only.
    act(() => {
      result.current.setFamilyPreset("quality", null)
    })
    const cleared = new URL(
      buildPreviewUrl(psBase as never, { ...bpBase, badgePresets: result.current.badgePresets } as never),
    )
    expect(cleared.searchParams.get("bp")).toBe("quality:-")
  })

  it("portrait staged save reloads per shape with the other shape verbatim", async () => {
    const prev = testMapping({ badgePresets: { rank: { id: A, rev: REV } } })
    const staged = { quality: { id: B, rev: REV_B } }
    const { result } = renderHook(
      () => usePosterSave(baseSaveDeps({
        posterShape: "poster",
        badgePresets: staged,
        mappingsMap: new Map([["movie:1", prev]]),
      })),
      { wrapper },
    )
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    const saved = { ...prev, ...posts[0].body } as ReturnType<typeof testMapping>
    // Portrait reload: staged binding persisted, saved sibling kept.
    expect(effectiveMappingForShape(saved, "poster")?.badgePresets).toEqual({
      rank: { id: A, rev: REV },
      quality: { id: B, rev: REV_B },
    })
    // Landscape reload: the new portrait binding does NOT leak through
    // inheritance; the previous effective look is frozen instead.
    expect(effectiveMappingForShape(saved, "landscape")?.badgePresets).toEqual({
      rank: { id: A, rev: REV },
      quality: null,
    })
  })

  it("landscape staged save keeps both shapes independent", async () => {
    const prev = testMapping({ badgePresets: { rank: { id: A, rev: REV } } })
    const staged = { quality: { id: B, rev: REV_B } }
    const { result } = renderHook(
      () => usePosterSave(baseSaveDeps({
        posterShape: "landscape",
        badgePresets: staged,
        mappingsMap: new Map([["movie:1", prev]]),
      })),
      { wrapper },
    )
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    const saved = { ...prev, ...posts[0].body } as ReturnType<typeof testMapping>
    // Flat untouched by the landscape edit …
    expect(effectiveMappingForShape(saved, "poster")?.badgePresets).toEqual({
      rank: { id: A, rev: REV },
    })
    // … while the landscape profile carries the staged family.
    expect(effectiveMappingForShape(saved, "landscape")?.badgePresets).toEqual({
      rank: { id: A, rev: REV },
      quality: { id: B, rev: REV_B },
    })
  })
})

describe("shared exclusion-autosave stash carries staged families", () => {
  it("attaches the other-shape draft under the same save contract", () => {
    const key = perTitleDraftKey("user-1", "movie", 1)
    const draft = { badgePresets: { quality: { id: A, rev: REV } } }
    const { result } = renderHook(
      () => useSharedShapeStash<Record<string, unknown>>({
        selected: { media_type: "movie", id: 1 },
        userId: "user-1",
        shape: "poster",
        readDraft: (titleKey, shape) => (titleKey === key && shape === "landscape" ? draft : null) as never,
      }),
    )
    const out = result.current({ silent: true })
    expect(out.otherShapeStash).toEqual(draft)
    // An explicit stash wins (manual Save precedence, never merged).
    const explicit = { otherShapeStash: { badgePresets: { rank: null } } }
    expect(result.current(explicit)).toEqual(explicit)
  })

  it("is identity-scoped (no cross-title draft leak)", () => {
    const { result } = renderHook(
      () => useSharedShapeStash<Record<string, unknown>>({
        selected: { media_type: "movie", id: 2 },
        userId: "user-1",
        shape: "poster",
        readDraft: () => null,
      }),
    )
    expect(result.current({ silent: true })).toEqual({ silent: true })
  })
})
