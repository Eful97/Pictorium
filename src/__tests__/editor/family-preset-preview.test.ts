/**
 * Task B — preview carries the staged per-family map as the canonical `bp`
 * param (same endpoint Stremio uses, WYSIWYG). Absent staged map = no `bp`
 * param (legacy preview URLs byte-identical); staged null = explicit clear
 * token (`fam:-`); bindings pin id and revision.
 */
import { describe, expect, it } from "vitest"
import { buildPreviewUrl } from "@/lib/poster-url"

const A = "Abc123-_XyZ"
const REV = "deadbeef"

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

describe("buildPreviewUrl family staged map", () => {
  it("emits no bp param without staged entries (legacy URLs unchanged)", () => {
    const url = new URL(buildPreviewUrl(psBase as never, { ...bpBase, badgePresets: null } as never))
    expect(url.searchParams.has("bp")).toBe(false)
    const empty = new URL(buildPreviewUrl(psBase as never, { ...bpBase, badgePresets: {} } as never))
    expect(empty.searchParams.has("bp")).toBe(false)
  })

  it("encodes bindings with revision and explicit clears", () => {
    const url = new URL(
      buildPreviewUrl(
        psBase as never,
        {
          ...bpBase,
          badgePresets: { quality: { id: A, rev: REV }, rank: null },
        } as never,
      ),
    )
    expect(url.searchParams.get("bp")).toBe(`rank:-,quality:${A}.${REV}`)
  })

  it("encodes unpinned bindings without revision", () => {
    const url = new URL(
      buildPreviewUrl(psBase as never, { ...bpBase, badgePresets: { genre: { id: A } } } as never),
    )
    expect(url.searchParams.get("bp")).toBe(`genre:${A}`)
  })
})
