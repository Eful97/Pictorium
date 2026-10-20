/**
 * G2 correction c1 — per-shape follow flags (persisted opt-in inheritance).
 *
 * Contract under test:
 * - `badgePresetFollows` (flat + landscape profile) is a sparse `true`-only
 *   map: present `true` = that shape follows the space settings for the
 *   family, bypassing stored pins AND the legacy singleton. Absent = legacy
 *   semantics (old mappings byte-identical).
 * - A portrait-only drop preserves the entire landscape side (map + legacy
 *   pair verbatim); a landscape-only drop never clears the flat pin.
 * - Save -> reload -> global change parity: a portrait-pinned family stays
 *   pinned while the following shape tracks the new global; reverse holds.
 * - Validation: only literal `true` persists; `__follow__`/ids/null/false
 *   fail the write; prototype/unknown families fail closed.
 */
import { beforeEach, describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { effectiveFamilyFollows, effectiveMappingForShape, type Mapping } from "@/lib/types"
import { resolveFamilyPresetBindings } from "@/lib/badge-preset-binding"
import {
  mergeFamilyFollowsForSave,
  sanitizeFamilyFollows,
} from "@/lib/family-preset-save"
import { mappingSchema } from "@/lib/validation"
import { usePosterSave } from "@/lib/usePosterSave"
import {
  baseSaveDeps,
  mappingPosts,
  stubMappingPost,
  testMapping as mapping,
  type PostedCall,
} from "./family-preset-save-harness"

const A = { id: "Abc123-_XyZ", rev: "deadbeef" }
const B = { id: "Qwerty12-34", rev: "cafef00d" }
const C = { id: "Zxcvbn12-90", rev: "01234567" }
const LEGACY_TOP = { id: "TopTop12-34", rev: "aaaaaaaa" }

let posted: PostedCall[]
beforeEach(() => {
  posted = []
  stubMappingPost(posted)
})

describe("sanitize/merge follow flags", () => {
  it("keeps only literal true, drops everything else fail-closed", () => {
    expect(sanitizeFamilyFollows({ rank: true, genre: false, quality: null, extra: { id: A.id } })).toEqual({
      rank: true,
    })
    expect(sanitizeFamilyFollows({ __proto__: true, sideways: true } as never)).toEqual({})
    expect(sanitizeFamilyFollows(null)).toEqual({})
  })

  it("sets true on drop, clears the flag on explicit pin", () => {
    expect(mergeFamilyFollowsForSave({ rank: true }, { rank: false })).toEqual({})
    expect(mergeFamilyFollowsForSave(null, { rank: true })).toEqual({ rank: true })
    expect(mergeFamilyFollowsForSave({ rank: true, genre: true }, null)).toEqual({ rank: true, genre: true })
  })
})

describe("effectiveFamilyFollows", () => {
  it("portrait reads the flat set; landscape inherits flat unless the profile pins", () => {
    const m = mapping({ badgePresetFollows: { rank: true } }) as Mapping
    expect(effectiveFamilyFollows(m, "poster")).toEqual({ rank: true })
    expect(effectiveFamilyFollows(m, "landscape")).toEqual({ rank: true })
    const pinned = mapping({
      badgePresetFollows: { rank: true },
      landscape: { badgePresets: { rank: { ...A } } },
    }) as Mapping
    expect(effectiveFamilyFollows(pinned, "landscape")).toEqual({})
  })

  it("profile true wins even over a profile pin-shaped absence; old maps yield empty", () => {
    const m = mapping({
      badgePresets: { rank: { ...A } },
      landscape: { badgePresetFollows: { rank: true } },
    }) as Mapping
    expect(effectiveFamilyFollows(m, "landscape")).toEqual({ rank: true })
    expect(effectiveFamilyFollows(mapping({}), "landscape")).toEqual({})
    expect(effectiveFamilyFollows(null, "poster")).toEqual({})
  })
})

describe("resolver honors persisted follows (non-preview)", () => {
  it("landscape follow bypasses the flat pin; portrait stays pinned", () => {
    const m = mapping({
      badgePresets: { rank: { ...A } },
      landscape: { badgePresetFollows: { rank: true } },
    }) as Mapping
    const portrait = resolveFamilyPresetBindings({
      mapping: m,
      shape: "poster",
      isPreview: false,
      defaultsFamilies: { rank: { ...B } },
    })
    const landscape = resolveFamilyPresetBindings({
      mapping: m,
      shape: "landscape",
      isPreview: false,
      defaultsFamilies: { rank: { ...B } },
    })
    expect(portrait.rank).toEqual({ id: A.id, rev: A.rev })
    expect(landscape.rank).toEqual({ id: B.id, rev: B.rev })
  })

  it("follow shadows the legacy singleton for that shape only", () => {
    const m = mapping({
      badgePresetId: LEGACY_TOP.id,
      badgePresetRev: LEGACY_TOP.rev,
      badgePresetFollows: { rank: true },
    }) as Mapping
    const portrait = resolveFamilyPresetBindings({
      mapping: m,
      shape: "poster",
      isPreview: false,
      legacyMappingTarget: "top",
      defaultsFamilies: { rank: { ...B }, extra: { ...C } },
    })
    expect(portrait.rank).toEqual({ id: B.id, rev: B.rev })
    // Sibling still rides the legacy singleton (no wipe, no materialize).
    expect(portrait.extra).toEqual({ id: LEGACY_TOP.id, rev: LEGACY_TOP.rev })
  })
})

describe("portrait drop preserves the entire landscape side (real hook)", () => {
  it("rank drop on portrait writes a flat flag; landscape map + legacy pair verbatim", async () => {
    const prev = mapping({
      badgePresets: { rank: { ...A }, genre: { ...B } },
      badgePresetId: LEGACY_TOP.id,
      badgePresetRev: LEGACY_TOP.rev,
      landscape: {
        badgePresets: { genre: { ...B } },
        badgePresetId: "LandPair-12",
        badgePresetRev: "bbbbbbbb",
      },
    })
    const { result } = renderHook(() =>
      usePosterSave(
        baseSaveDeps({
          posterShape: "poster",
          badgePresets: { rank: "__follow__" },
          badgePresetId: LEGACY_TOP.id,
          badgePresetRev: LEGACY_TOP.rev,
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
    // Flat: dropped key deleted, follow flag persisted — sibling untouched.
    expect(posts[0].body.badgePresets).toEqual({ genre: { id: B.id, rev: B.rev } })
    expect(posts[0].body.badgePresetFollows).toEqual({ rank: true })
    // Legacy pair preserved verbatim (no global clear, correct id kept).
    expect(posts[0].body.badgePresetId).toBe(LEGACY_TOP.id)
    // Landscape profile keeps its own pair + map (no leak from portrait).
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgePresetId).toBe("LandPair-12")
    expect(land.badgePresets).toEqual({ genre: { id: B.id, rev: B.rev } })
    expect(land.badgePresetFollows).toBeUndefined()
  })
})

describe("landscape-only drop never clears the flat pin", () => {
  it("writes a profile flag; flat A intact; save validates", async () => {
    const prev = mapping({ badgePresets: { rank: { ...A } } })
    const { result } = renderHook(() =>
      usePosterSave(
        baseSaveDeps({
          posterShape: "landscape",
          badgePresets: { rank: "__follow__" },
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
    expect(posts[0].body.badgePresets).toEqual({ rank: { id: A.id, rev: A.rev } })
    expect(posts[0].body.badgePresetFollows).toBeUndefined()
    const land = posts[0].body.landscape as Record<string, unknown>
    expect(land.badgePresetFollows).toEqual({ rank: true })
    expect(mappingSchema.safeParse(posts[0].body).success).toBe(true)
  })
})

describe("save -> reload -> new global change parity", () => {
  it("portrait pinned A stays; landscape follow tracks B -> C", async () => {
    const prev = mapping({ badgePresets: { rank: { ...A } } })
    const { result } = renderHook(() =>
      usePosterSave(
        baseSaveDeps({
          posterShape: "landscape",
          badgePresets: { rank: "__follow__" },
          mappingsMap: new Map([["movie:1", prev]]),
        }),
      ),
    )
    await act(async () => {
      await result.current.saveConfig({ silent: true })
    })
    const saved = mappingPosts(posted)[0].body as unknown as Mapping
    const reloaded: Mapping = { ...prev, ...saved, landscape: saved.landscape }
    for (const global of [B, C]) {
      const portrait = resolveFamilyPresetBindings({
        mapping: reloaded,
        shape: "poster",
        isPreview: false,
        defaultsFamilies: { rank: { ...global } },
      })
      const landscape = resolveFamilyPresetBindings({
        mapping: reloaded,
        shape: "landscape",
        isPreview: false,
        defaultsFamilies: { rank: { ...global } },
      })
      expect(portrait.rank).toEqual({ id: A.id, rev: A.rev })
      expect(landscape.rank).toEqual({ id: global.id, rev: global.rev })
    }
  })

  it("flat follow tracks globals; owned landscape A stays pinned", async () => {
    const prev = mapping({ landscape: { badgePresets: { rank: { ...A } } } })
    const { result } = renderHook(() =>
      usePosterSave(
        baseSaveDeps({
          posterShape: "poster",
          badgePresets: { rank: "__follow__" },
          mappingsMap: new Map([["movie:1", prev]]),
        }),
      ),
    )
    await act(async () => {
      await result.current.saveConfig({ silent: true })
    })
    const saved = mappingPosts(posted)[0].body as unknown as Mapping
    const reloaded: Mapping = { ...prev, ...saved }
    for (const global of [B, C]) {
      const portrait = resolveFamilyPresetBindings({
        mapping: reloaded,
        shape: "poster",
        isPreview: false,
        defaultsFamilies: { rank: { ...global } },
      })
      const landscape = resolveFamilyPresetBindings({
        mapping: reloaded,
        shape: "landscape",
        isPreview: false,
        defaultsFamilies: { rank: { ...global } },
      })
      expect(portrait.rank).toEqual({ id: global.id, rev: global.rev })
      expect(landscape.rank).toEqual({ id: A.id, rev: A.rev })
    }
  })
})

describe("validation boundary", () => {
  it("accepts sparse true flags flat + profile, rejects sentinels/ids", () => {
    expect(
      mappingSchema.safeParse({ ...mapping({}), badgePresetFollows: { rank: true } }).success,
    ).toBe(true)
    expect(
      mappingSchema.safeParse({
        ...mapping({}),
        landscape: { badgePresetFollows: { rank: true }, badgePresets: { rank: { ...A } } },
      }).success,
    ).toBe(true)
    expect(
      mappingSchema.safeParse({ ...mapping({}), badgePresetFollows: { rank: "__follow__" } }).success,
    ).toBe(false)
    expect(
      mappingSchema.safeParse({ ...mapping({}), badgePresetFollows: { rank: { id: A.id } } }).success,
    ).toBe(false)
  })

  it("no-op reads stay sparse: old mappings without the field resolve legacy-identical", () => {
    const old = mapping({ badgePresets: { rank: { ...A } } })
    expect(effectiveMappingForShape(old, "landscape")?.badgePresets).toEqual({ rank: { id: A.id, rev: A.rev } })
    expect(effectiveFamilyFollows(old, "landscape")).toEqual({})
  })
})
