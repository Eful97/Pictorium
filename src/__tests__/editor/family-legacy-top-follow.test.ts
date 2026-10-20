/**
 * G2 correction c1 — per-title follow-drop save boundary with the legacy top
 * singleton (replaces the G2 global legacy-break contract).
 *
 * A drop on a family covered by the legacy singleton (`top` fans out to
 * rank + extra) persists a per-shape `badgePresetFollows` flag for THAT shape
 * only: the resolver then skips the saved map AND the singleton for that
 * family/shape and falls through to config > defaults. The singleton pair
 * itself is preserved verbatim (no global clear, no sibling materialization,
 * no store fetch, no abort): the untouched shape keeps rendering it, the
 * dropped shape follows the space settings, siblings keep riding the pair.
 * Drops on uncovered families only delete the map key (pair kept), as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { usePosterSave } from "@/lib/usePosterSave"
import { FAMILY_FOLLOW_SENTINEL } from "@/lib/family-preset-follow"
import { resolveFamilyPresetBindings } from "@/lib/badge-preset-binding"
import type { Mapping } from "@/lib/types"
import {
  baseSaveDeps,
  mappingPosts,
  stubMappingPost,
  testMapping as mapping,
  type PostedCall,
} from "./family-preset-save-harness"

vi.mock("@/lib/presets-client", () => ({
  resolveLegacyPresetTarget: vi.fn(),
}))

const TOP = { id: "TopMap-66666", rev: "12345678" }
const GENRE = { id: "Default3-ccc", rev: "ccccdddd" }

let posted: PostedCall[]
beforeEach(() => {
  posted = []
  stubMappingPost(posted)
})

describe("portrait save with a follow-drop on a legacy-covered family", () => {
  it("persists a flat follow flag and preserves the singleton pair (no clear, no materialize)", async () => {
    const prev = mapping({ badgePresetId: TOP.id, badgePresetRev: TOP.rev })
    const { result } = renderHook(() =>
      usePosterSave(
        baseSaveDeps({
          posterShape: "poster",
          badgePresetId: TOP.id,
          badgePresetRev: TOP.rev,
          badgePresets: { rank: FAMILY_FOLLOW_SENTINEL },
          legacyPresetTarget: "top",
          mappingsMap: new Map([["movie:1", prev]]),
        }),
      ),
    )
    await act(async () => {
      await result.current.saveConfig({ silent: true })
    })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    // The pair is preserved verbatim on both sides (never cleared globally).
    expect(posts[0].body.badgePresetId).toBe(TOP.id)
    expect(posts[0].body.badgePresetRev).toBe(TOP.rev)
    // Dropped rank follows the settings (flag, absent from the map); the
    // surviving extra is NOT materialized — it keeps riding the pair.
    expect(posts[0].body.badgePresets).toBeUndefined()
    expect(posts[0].body.badgePresetFollows).toEqual({ rank: true })
    const land = posts[0].body.landscape as Record<string, unknown>
    // Landscape keeps the pair via the existing backfill (portrait save never
    // moves the other shape): byte-identical look, no cross-shape clear.
    expect(land.badgePresetId).toBe(TOP.id)
    // Reload parity: dropped rank follows the new global, sibling rides legacy.
    const saved = posts[0].body as unknown as Mapping
    const reloaded: Mapping = { ...prev, ...saved }
    const bound = resolveFamilyPresetBindings({
      mapping: reloaded,
      shape: "poster",
      isPreview: false,
      legacyMappingTarget: "top",
      defaultsFamilies: { rank: { id: "NewGlob-11", rev: "bbbbbbbb" }, extra: { id: "OthrGlob-22", rev: "cccccccc" } },
    })
    expect(bound.rank).toEqual({ id: "NewGlob-11", rev: "bbbbbbbb" })
    expect(bound.extra).toEqual({ id: TOP.id, rev: TOP.rev })
  })

  it("drop on an uncovered family keeps the pair and only deletes the key", async () => {
    const prev = mapping({
      badgePresetId: TOP.id,
      badgePresetRev: TOP.rev,
      badgePresets: { genre: { ...GENRE } },
    })
    const { result } = renderHook(() =>
      usePosterSave(
        baseSaveDeps({
          posterShape: "poster",
          badgePresetId: TOP.id,
          badgePresetRev: TOP.rev,
          badgePresets: { genre: FAMILY_FOLLOW_SENTINEL },
          legacyPresetTarget: "top",
          mappingsMap: new Map([["movie:1", prev]]),
        }),
      ),
    )
    await act(async () => {
      await result.current.saveConfig({ silent: true })
    })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    expect(posts[0].body.badgePresetId).toBe(TOP.id)
    expect(posts[0].body.badgePresetRev).toBe(TOP.rev)
    expect(posts[0].body.badgePresets).toEqual({})
  })

  it("needs no store fallback: the drop persists without resolving the target", async () => {
    const prev = mapping({ badgePresetId: TOP.id, badgePresetRev: TOP.rev })
    const { result } = renderHook(() =>
      usePosterSave(
        baseSaveDeps({
          posterShape: "poster",
          badgePresetId: TOP.id,
          badgePresetRev: TOP.rev,
          badgePresets: { extra: FAMILY_FOLLOW_SENTINEL },
          mappingsMap: new Map([["movie:1", prev]]),
        }),
      ),
    )
    let ok: unknown = false
    await act(async () => {
      ok = await result.current.saveConfig({ silent: true })
    })
    expect(ok).toBe(true)
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    // Pair preserved; extra follows via the flag (no materialized rank).
    expect(posts[0].body.badgePresetId).toBe(TOP.id)
    expect(posts[0].body.badgePresetFollows).toEqual({ extra: true })
    expect(posts[0].body.badgePresets).toBeUndefined()
  })

  it("never aborts on an unresolvable target (no POST skipped, no guess)", async () => {
    const prev = mapping({ badgePresetId: TOP.id, badgePresetRev: TOP.rev })
    const { result } = renderHook(() =>
      usePosterSave(
        baseSaveDeps({
          posterShape: "poster",
          badgePresetId: TOP.id,
          badgePresetRev: TOP.rev,
          badgePresets: { rank: FAMILY_FOLLOW_SENTINEL },
          mappingsMap: new Map([["movie:1", prev]]),
        }),
      ),
    )
    let ok: unknown = false
    await act(async () => {
      ok = await result.current.saveConfig({ silent: true })
    })
    expect(ok).toBe(true)
    expect(mappingPosts(posted)).toHaveLength(1)
  })

  it("independent families and the other shape stay verbatim on a drop", async () => {
    const prev = mapping({
      badgePresetId: TOP.id,
      badgePresetRev: TOP.rev,
      badgePresets: { genre: { ...GENRE } },
      landscape: { badgePresets: { quality: null } } as never,
    })
    const { result } = renderHook(() =>
      usePosterSave(
        baseSaveDeps({
          posterShape: "poster",
          badgePresetId: TOP.id,
          badgePresetRev: TOP.rev,
          badgePresets: { rank: FAMILY_FOLLOW_SENTINEL },
          legacyPresetTarget: "top",
          mappingsMap: new Map([["movie:1", prev]]),
        }),
      ),
    )
    await act(async () => {
      await result.current.saveConfig({ silent: true })
    })
    const posts = mappingPosts(posted)
    expect(posts).toHaveLength(1)
    // Mapped genre entry untouched by the rank drop (no legacy mix).
    expect(posts[0].body.badgePresets).toEqual({ genre: { ...GENRE } })
    expect(posts[0].body.badgePresetFollows).toEqual({ rank: true })
    const land = posts[0].body.landscape as Record<string, unknown>
    // Owned landscape quality entry verbatim; no materialized extra, no flag.
    expect(land.badgePresets).toMatchObject({ quality: null })
    expect(land.badgePresetFollows).toBeUndefined()
  })
})
