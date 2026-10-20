/**
 * Task B — per-title per-shape family preset save boundary (real hook).
 *
 * Contract under test (full-replace POST /api/mappings):
 * - portrait save merges live staged over the stored flat per family; the
 *   landscape profile freezes the OLD effective look only for moved families
 *   (other shape VERBATIM, siblings untouched);
 * - explicit Standard clear (staged null) persists as null and never
 *   resurrects the saved binding or the legacy singleton;
 * - landscape save preserves the flat VERBATIM (or merges the portrait staged
 *   stash) and carries the live staged map in the profile;
 * - with no staged entries and no stored map the body carries no badgePresets
 *   key (legacy URLs byte-identical);
 * - cover-only payloads omit the family map AND the legacy pair (cleared).
 */
import { beforeEach, describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { usePosterSave } from "@/lib/usePosterSave"
import { effectiveMappingForShape, type Mapping } from "@/lib/types"
import { mappingSchema } from "@/lib/validation"
import { buildCoverOnlyPayload } from "@/lib/cover-only-save"
import {
  baseSaveDeps,
  mappingPosts,
  stubMappingPost,
  testMapping as mapping,
  type PostedCall,
} from "./family-preset-save-harness"

const A = { id: "Abc123-_XyZ", rev: "deadbeef" }
const B = { id: "Qwerty12-34", rev: "cafef00d" }

const baseDeps = baseSaveDeps

let posted: PostedCall[]
beforeEach(() => {
  posted = []
  stubMappingPost(posted)
})

describe("portrait save merges staged families, guards the other shape", () => {
  it("writes the staged binding to the flat, freezes the old look in the landscape profile", async () => {
    const prev = mapping({ badgePresets: { quality: { ...A } } })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgePresets: { quality: { ...B } },
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgePresets).toEqual({ quality: { id: B.id, rev: B.rev } })
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgePresets).toEqual({ quality: { id: A.id, rev: A.rev } })
  })

  it("persists an explicit Standard clear without resurrecting the saved binding", async () => {
    const prev = mapping({ badgePresets: { rank: { ...A } } })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgePresets: { rank: null },
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    // Flat carries the explicit clear …
    expect(posts[0].body.badgePresets).toEqual({ rank: null })
    // … the other shape keeps its previous look, siblings untouched …
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgePresets).toEqual({ rank: { id: A.id, rev: A.rev } })
    // … and the effective reload shadows the legacy singleton (never resurrect).
    const saved = { ...prev, badgePresets: { rank: null } } as Mapping
    expect(effectiveMappingForShape(saved, "poster")?.badgePresets).toEqual({ rank: null })
  })

  it("leaves unmoved families and the legacy singleton alone", async () => {
    const prev = mapping({
      badgePresets: { rank: { ...A }, genre: { id: B.id, rev: B.rev } },
      badgePresetId: A.id,
      badgePresetRev: A.rev,
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgePresets: { rank: { ...B } },
      // Live singleton mirrors the title-open restore (effective mapping).
      badgePresetId: A.id,
      badgePresetRev: A.rev,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgePresets).toEqual({
      rank: { id: B.id, rev: B.rev },
      genre: { id: B.id, rev: B.rev },
    })
    const land = posts[0].body.landscape as Record<string, unknown>
    // Only the moved family is frozen; the unmoved sibling stays inherited.
    expect(land.badgePresets).toEqual({ rank: { id: A.id, rev: A.rev } })
    // Legacy singleton untouched by family edits.
    expect(posts[0].body.badgePresetId).toBe(A.id)
    expect(posts[0].body.badgePresetRev).toBe(A.rev)
  })

  it("omits the key entirely when nothing is staged and nothing is stored", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({ posterShape: "poster" })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    expect("badgePresets" in posts[0].body).toBe(false)
    expect(posts[0].body.landscape == null).toBe(true)
  })

  it("new-mapping portrait save freezes native (null) in the profile for introduced bindings", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgePresets: { quality: { ...B } },
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgePresets).toEqual({ quality: { id: B.id, rev: B.rev } })
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgePresets).toEqual({ quality: null })
  })
})

describe("landscape save preserves the flat, carries staged in the profile", () => {
  it("keeps the saved flat verbatim and writes live staged to the profile", async () => {
    const prev = mapping({ badgePresets: { quality: { ...A } } })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      badgePresets: { quality: { ...B } },
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgePresets).toEqual({ quality: { id: A.id, rev: A.rev } })
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgePresets).toEqual({ quality: { id: B.id, rev: B.rev } })
  })

  it("merges the portrait staged stash into the flat on a landscape save", async () => {
    const prev = mapping({ badgePresets: { quality: { ...A } } })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "landscape",
      badgePresets: null,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => {
      await result.current.saveConfig({
        silent: true,
        otherShapeStash: { badgePresets: { rank: { ...B } } },
      })
    })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgePresets).toEqual({
      quality: { id: A.id, rev: A.rev },
      rank: { id: B.id, rev: B.rev },
    })
  })

  it("drops staged garbage instead of writing it", async () => {
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgePresets: { rank: { id: "bad!!" } },
    } as never)))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    expect("badgePresets" in posts[0].body).toBe(false)
  })
})

describe("legacy singleton opposite-shape protection (real save path)", () => {
  it("portrait genre edit freezes the legacy genre look in the landscape profile", async () => {
    const prev = mapping({
      badgePresetId: A.id,
      badgePresetRev: A.rev,
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgePresets: { genre: { ...B } },
      badgePresetId: A.id,
      badgePresetRev: A.rev,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    // Flat carries the new family binding …
    expect(posts[0].body.badgePresets).toEqual({ genre: { id: B.id, rev: B.rev } })
    // … while the landscape profile preserves the old legacy look for the
    // moved family instead of clearing it to native.
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgePresets).toEqual({ genre: { id: A.id, rev: A.rev } })
    // Legacy singleton itself untouched by the family edit.
    expect(posts[0].body.badgePresetId).toBe(A.id)
    expect(posts[0].body.badgePresetRev).toBe(A.rev)
  })

  it("portrait rank edit freezes the legacy top look for rank, extra stays inherited", async () => {
    const prev = mapping({
      badgePresetId: A.id,
      badgePresetRev: A.rev,
    })
    const { result } = renderHook(() => usePosterSave(baseDeps({
      posterShape: "poster",
      badgePresets: { rank: { ...B } },
      badgePresetId: A.id,
      badgePresetRev: A.rev,
      mappingsMap: new Map([["movie:1", prev]]),
    })))
    await act(async () => { await result.current.saveConfig({ silent: true }) })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgePresets).toEqual({ rank: { id: B.id, rev: B.rev } })
    // The moved family keeps the old legacy look on the other shape; the
    // unmoved sibling is untouched (still inherits the flat legacy).
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgePresets).toEqual({ rank: { id: A.id, rev: A.rev } })
  })
})

describe("cover-only clears family bindings with the legacy pair", () => {
  it("omits badgePresets, badgePresetId and badgePresetRev from the payload", () => {
    const prev = mapping({
      badgePresets: { rank: { ...A } },
      badgePresetId: A.id,
      badgePresetRev: A.rev,
    })
    const body = buildCoverOnlyPayload({
      selected: { id: 1, media_type: "movie", title: "T", poster_path: "/p.jpg" },
      previewPoster: { file_path: "/p.jpg", iso_639_1: null, vote_average: 0, width: 0, height: 0 },
      selectedBackdrop: null,
      selectedLogo: null,
      logoDisabled: false,
      prevMapping: prev,
      metaInfo: { genres: [{ id: 1, name: "Dramma" }], voteAverage: 7.5 },
      lang: "it",
      episodeGroupId: null,
      posterShape: "poster",
    })
    expect(body).not.toBeNull()
    expect("badgePresets" in body!).toBe(false)
    expect("badgePresetId" in body!).toBe(false)
    expect("badgePresetRev" in body!).toBe(false)
  })

  it("the family map validates at the write boundary (strict, fail-closed)", () => {
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      badgePresets: { rank: { id: A.id, rev: A.rev }, genre: null },
    }).success).toBe(true)
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      badgePresets: { sideways: { id: A.id } },
    }).success).toBe(false)
    expect(mappingSchema.safeParse({
      tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg",
      badgePresets: { rank: { id: "bad", rev: A.rev } },
    }).success).toBe(false)
  })
})
