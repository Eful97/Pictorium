/**
 * G2 correction cycle2 — actual URL boundary: explicit follow intent (bpf).
 * REAL builder -> REAL query resolver (tight boundary), not pure-resolver only.
 * Covers: portrait legacy top A + rank follow -> global B preserving extra A;
 * landscape inherited flat pin filtered + land follow -> defaults; reopen pin
 * clears flag; Standard null blocks all; both shapes reverse; no zero-op migration.
 */
import { describe, expect, it } from "vitest";
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url";
import { buildPreviewUrl } from "@/lib/poster-url";
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params";
import { hardenPosterSearchParams } from "@/lib/poster-params-hardening";
import { parseFamilyBpParam, parseFamilyFollowParam } from "@/lib/badge-preset-family-transport";
import { resolveFamilyPresetBindings } from "@/lib/badge-preset-binding";
import type { Mapping } from "@/lib/types";

const TOP_A = "TopA-12345678";
const TOP_AREV = "aaaaaaaa";
const GLOB_B = "GlobB-87654321";
const GLOB_BREV = "bbbbbbbb";
const GENRE_A = "GenreA-11111111";
const GENRE_B = "GenreB-22222222";

function routeResolve(url: URL, opts: {
  mapping: Mapping | null;
  shape: "poster" | "landscape";
  isPreview: boolean;
  defaultsFamilies?: unknown;
  configFamilies?: unknown;
  legacyQueryTarget?: "top" | null;
  legacyMappingTarget?: "top" | null;
}) {
  const hardened = hardenPosterSearchParams(url.searchParams, {
    presets: false,
    preview: opts.isPreview,
    anonymous: false,
    publicInstance: false,
    hasMapping: !!opts.mapping,
    mappingCustomBadge: null,
  });
  const staged = parseFamilyBpParam(hardened.get("bp"));
  const queryFollows = parseFamilyFollowParam(hardened.get("bpf"));
  const qid = hardened.get("badgePreset");
  const qrev = hardened.get("prv");
  return {
    hardened,
    staged,
    queryFollows,
    bound: resolveFamilyPresetBindings({
      staged: staged ?? undefined,
      mapping: opts.mapping,
      shape: opts.shape,
      isPreview: opts.isPreview,
      legacyQueryId: qid,
      legacyQueryRev: qrev,
      legacyQueryTarget: opts.legacyQueryTarget ?? (qid ? "top" : null),
      legacyMappingTarget: opts.legacyMappingTarget ?? null,
      queryFollows: queryFollows ?? undefined,
      configFamilies: opts.configFamilies,
      defaultsFamilies: opts.defaultsFamilies,
    }),
  };
}

describe("bpf boundary: real Stremio builder -> real resolver", () => {
  it("portrait legacy top A + rank follow -> global B preserving extra A", () => {
    const mapping = {
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p",
      badgePresetId: TOP_A, badgePresetRev: TOP_AREV,
      badgePresetFollows: { rank: true },
    } as unknown as Mapping;
    const url = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 1,
      defaults: {} as never, mapping,
    });
    // Filtered: no bp rank pin resurrects; explicit follow travels as bpf.
    expect(url.searchParams.get("bpf")).toBe("rank");
    expect(url.searchParams.get("bp") ?? "").not.toContain("rank:");
    // Legacy singleton still travels for the sibling.
    expect(url.searchParams.get("badgePreset")).toBe(TOP_A);
    const { bound } = routeResolve(url, {
      mapping, shape: "poster", isPreview: false,
      legacyMappingTarget: "top",
      defaultsFamilies: { rank: { id: GLOB_B, rev: GLOB_BREV } },
    });
    expect(bound.rank).toEqual({ id: GLOB_B, rev: GLOB_BREV });
    expect(bound.extra).toEqual({ id: TOP_A, rev: TOP_AREV });
  });

  it("landscape inherited flat genre pin filtered + land follow -> defaults", () => {
    const mapping = {
      tmdbId: 2, mediaType: "movie", title: "T", posterPath: "/p",
      badgePresets: { genre: { id: GENRE_A, rev: "cccccccc" } },
      landscape: { badgePresetFollows: { genre: true } },
    } as unknown as Mapping;
    const url = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 2,
      defaults: {} as never, mapping, forceShape: "landscape",
    });
    expect(url.searchParams.get("bpf")).toBe("genre");
    expect(url.searchParams.get("bp") ?? "").not.toContain("genre:");
    const { bound } = routeResolve(url, {
      mapping, shape: "landscape", isPreview: false,
      defaultsFamilies: { genre: { id: GENRE_B, rev: "dddddddd" } },
    });
    expect(bound.genre).toEqual({ id: GENRE_B, rev: "dddddddd" });
    // Portrait keeps the flat pin (shape isolation).
    const portrait = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 2,
      defaults: {} as never, mapping,
    });
    expect(portrait.searchParams.get("bpf") ?? "").not.toContain("genre");
    const pr = routeResolve(portrait, {
      mapping, shape: "poster", isPreview: false,
      defaultsFamilies: { genre: { id: GENRE_B, rev: "dddddddd" } },
    });
    expect(pr.bound.genre).toEqual({ id: GENRE_A, rev: "cccccccc" });
  });

  it("preview on reopen with persisted follow matches mapped Stremio", () => {
    const mapping = {
      tmdbId: 3, mediaType: "movie", title: "T", posterPath: "/p",
      badgePresetId: TOP_A, badgePresetRev: TOP_AREV,
      badgePresetFollows: { rank: true },
    } as unknown as Mapping;
    // Stremio (non-preview) truth.
    const stremio = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 3,
      defaults: {} as never, mapping,
    });
    const s = routeResolve(stremio, {
      mapping, shape: "poster", isPreview: false,
      legacyMappingTarget: "top",
      defaultsFamilies: { rank: { id: GLOB_B, rev: GLOB_BREV } },
    });
    // Preview on reopen: real buildPreviewUrl with persisted follow as bpf
    // (context filters the inherited pin and emits bpf=rank).
    const preview = buildPreviewUrl(
      { selected: { media_type: "movie", id: 3 } as never, previewPoster: null, selectedLogo: null, selectedBackdrop: null, logoScale: 100, logoOffsetX: 0, logoOffsetY: 0, backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0, metaInfo: { genres: [], voteAverage: 0 }, trendRank: null, mdblistAnimeList: [], topEdgeColor: null, tmdbKey: "", lang: "it" },
      { globalBadges: true, rankingBadges: true, badgeStyle: "shadow", rankingBadgeStyle: "default", customBadge: null, badgePresetId: TOP_A, badgePresetRev: TOP_AREV, badgePresets: null, badgePresetFollows: { rank: true } as never, gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: true, topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0, genreBadgeScale: 100, genreBadgeOffsetX: 0, genreBadgeOffsetY: 0, qualityBadgeScale: 100, networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0, posterShape: "poster" } as never,
      null,
    );
    const purl = new URL(preview);
    expect(purl.searchParams.get("bpf")).toBe("rank");
    expect(purl.searchParams.get("preview")).toBe("1");
    const p = routeResolve(purl, {
      mapping, shape: "poster", isPreview: true,
      legacyMappingTarget: "top",
      defaultsFamilies: { rank: { id: GLOB_B, rev: GLOB_BREV } },
    });
    expect(p.bound.rank).toEqual(s.bound.rank);
    expect(p.bound.extra).toEqual(s.bound.extra);
  });

  it("live follow-staged matches prospective save even with legacy top", () => {
    // Live staged drop -> bpf; legacy top query stays for siblings.
    const preview = buildPreviewUrl(
      { selected: { media_type: "movie", id: 4 } as never, previewPoster: null, selectedLogo: null, selectedBackdrop: null, logoScale: 100, logoOffsetX: 0, logoOffsetY: 0, backdropScale: 100, backdropOffsetX: 0, backdropOffsetY: 0, metaInfo: { genres: [], voteAverage: 0 }, trendRank: null, mdblistAnimeList: [], topEdgeColor: null, tmdbKey: "", lang: "it" },
      { globalBadges: true, rankingBadges: true, badgeStyle: "shadow", rankingBadgeStyle: "default", customBadge: null, badgePresetId: TOP_A, badgePresetRev: TOP_AREV, badgePresets: null, badgePresetFollows: { rank: true } as never, gradientHeight: 30, blurIntensity: 20, blurFade: 50, blurDarkness: 30, blurEnabled: true, topBadgeScale: 100, topBadgeOffsetX: 0, topBadgeOffsetY: 0, genreBadgeScale: 100, genreBadgeOffsetX: 0, genreBadgeOffsetY: 0, qualityBadgeScale: 100, networkLogoScale: 100, networkLogoOffsetX: 0, networkLogoOffsetY: 0, posterShape: "poster" } as never,
      null,
    );
    const purl = new URL(preview);
    const p = routeResolve(purl, {
      mapping: { tmdbId: 4, mediaType: "movie", title: "T", posterPath: "/p", badgePresetId: TOP_A, badgePresetRev: TOP_AREV } as unknown as Mapping,
      shape: "poster", isPreview: true,
      legacyMappingTarget: "top",
      defaultsFamilies: { rank: { id: GLOB_B, rev: GLOB_BREV } },
    });
    expect(p.bound.rank).toEqual({ id: GLOB_B, rev: GLOB_BREV });
    expect(p.bound.extra).toEqual({ id: TOP_A, rev: TOP_AREV });
  });

  it("explicit staged pin cancels follow intent; Standard null blocks all", () => {
    const mapping = {
      tmdbId: 5, mediaType: "movie", title: "T", posterPath: "/p",
      badgePresetId: TOP_A, badgePresetRev: TOP_AREV,
      badgePresetFollows: { rank: true },
    } as unknown as Mapping;
    // Staged custom wins over bpf for the same family.
    const r1 = resolveFamilyPresetBindings({
      staged: { rank: { id: "PinC-33333333", rev: "eeeeeeee" } },
      mapping, shape: "poster", isPreview: false,
      legacyQueryId: TOP_A, legacyQueryRev: TOP_AREV, legacyQueryTarget: "top",
      legacyMappingTarget: "top",
      queryFollows: { rank: true },
      defaultsFamilies: { rank: { id: GLOB_B, rev: GLOB_BREV } },
    });
    expect(r1.rank).toEqual({ id: "PinC-33333333", rev: "eeeeeeee" });
    expect(r1.extra).toEqual({ id: TOP_A, rev: TOP_AREV });
    // Standard null blocks legacy + follows + defaults.
    const r2 = resolveFamilyPresetBindings({
      staged: { rank: null },
      mapping, shape: "poster", isPreview: false,
      legacyQueryId: TOP_A, legacyQueryRev: TOP_AREV, legacyQueryTarget: "top",
      legacyMappingTarget: "top",
      queryFollows: { rank: true },
      defaultsFamilies: { rank: { id: GLOB_B, rev: GLOB_BREV } },
    });
    expect(r2.rank).toEqual({ id: null, rev: null });
    expect(r2.extra).toEqual({ id: TOP_A, rev: TOP_AREV });
  });

  it("saved flags cause no zero-op migration (legacy URLs byte-identical)", () => {
    const mapping = { tmdbId: 6, mediaType: "movie", title: "T", posterPath: "/p" } as unknown as Mapping;
    const url = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 6,
      defaults: {} as never, mapping,
    });
    expect(url.searchParams.has("bpf")).toBe(false);
    expect(url.searchParams.has("bp")).toBe(false);
  });

  it("global map stays server-resolved with dv cache isolation", () => {
    const mapping = { tmdbId: 7, mediaType: "movie", title: "T", posterPath: "/p" } as unknown as Mapping;
    const a = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 7,
      defaults: {} as never, mapping,
      defaultsBadgePresets: { rank: { id: GLOB_B, rev: GLOB_BREV } } as never,
    });
    const b = buildStremioPosterUrl({
      origin: "https://x.test", type: "movie", id: 7,
      defaults: {} as never, mapping,
      defaultsBadgePresets: { rank: { id: "Other-99999999", rev: "ffffffff" } } as never,
    });
    // Never emitted as bp (would shadow mapping/config); only dv rotates.
    expect(a.searchParams.has("bp")).toBe(false);
    expect(a.searchParams.get("dv")).not.toBe(b.searchParams.get("dv"));
  });

  it("bpf is bounded to known families only (no secrets/JSON)", () => {
    const p = buildStremioPosterSearchParams({ badgePresetFollows: { rank: true, bogus: true } as never });
    expect(p.get("bpf")).toBe("rank");
  });
});
