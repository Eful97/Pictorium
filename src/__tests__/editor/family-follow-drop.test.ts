/**
 * G2 — per-title "Follow settings" drop (client-only staged marker).
 *
 * The staged per-title draft gains a third state per family: absent (follow
 * saved), null/binding (Standard/preset), `__follow__` (delete the saved key
 * at save so the family follows the space settings). The marker is
 * client-only: never persisted, never in `bp`, never a validated id.
 */
import { describe, expect, it } from "vitest"
import {
  FAMILY_FOLLOW_SENTINEL,
  applyFollowDrops,
  droppedOwnedFamilies,
  isEmptyFamilyDraft,
  isFamilyFollowDrop,
  mergeFamilyDraftForSave,
  sanitizeFamilyDraft,
} from "@/lib/family-preset-follow"
import { encodeFamilyBpParam } from "@/lib/badge-preset-family-transport"
import { mergeFamilyMapForSave } from "@/lib/family-preset-save"

const A = { id: "Abc123-_XyZ", rev: "deadbeef" }
const B = { id: "Qwerty12-34", rev: "cafef00d" }

describe("sanitizeFamilyDraft", () => {
  it("preserves bindings, clears and follow-drops, normalizes rev", () => {
    expect(
      sanitizeFamilyDraft({ genre: { ...A }, rank: null, extra: FAMILY_FOLLOW_SENTINEL }),
    ).toEqual({ genre: { ...A }, rank: null, extra: FAMILY_FOLLOW_SENTINEL })
    expect(sanitizeFamilyDraft({ genre: { id: A.id } })).toEqual({
      genre: { id: A.id, rev: null },
    })
  })

  it("drops malformed entries, never throws on garbage", () => {
    expect(
      sanitizeFamilyDraft({ genre: { id: "short" }, nope: { ...A }, rank: "__follow__x" }),
    ).toEqual({})
    expect(sanitizeFamilyDraft(null)).toEqual({})
    expect(sanitizeFamilyDraft("junk")).toEqual({})
  })

  it("never persists the sentinel as an id (not a valid preset id)", () => {
    expect(isFamilyFollowDrop(FAMILY_FOLLOW_SENTINEL)).toBe(true)
    expect(isFamilyFollowDrop(null)).toBe(false)
    expect(isFamilyFollowDrop({ ...A })).toBe(false)
  })
})

describe("merge drops delete the stored key", () => {
  it("mergeFamilyMapForSave: drop deletes, siblings preserved, absent untouched", () => {
    const out = mergeFamilyMapForSave(
      { genre: { ...A }, rank: { ...B } },
      { genre: FAMILY_FOLLOW_SENTINEL, extra: null },
    )
    expect(out).toEqual({ rank: { ...B }, extra: null })
  })

  it("mergeFamilyDraftForSave: same contract for the draft form", () => {
    const out = mergeFamilyDraftForSave({ genre: { ...A } }, { genre: FAMILY_FOLLOW_SENTINEL })
    expect(out).toEqual({})
  })

  it("drops on absent keys are no-ops (byte-identical save)", () => {
    expect(mergeFamilyMapForSave(null, { genre: FAMILY_FOLLOW_SENTINEL })).toEqual({})
    expect(
      mergeFamilyMapForSave({ rank: { ...B } }, { genre: FAMILY_FOLLOW_SENTINEL }),
    ).toEqual({ rank: { ...B } })
  })

  it("droppedOwnedFamilies reports only staged drops on owned keys", () => {
    expect(
      droppedOwnedFamilies({ genre: { ...A }, rank: { ...B } }, { genre: FAMILY_FOLLOW_SENTINEL, extra: FAMILY_FOLLOW_SENTINEL }),
    ).toEqual(["genre"])
    expect(droppedOwnedFamilies(null, { genre: FAMILY_FOLLOW_SENTINEL })).toEqual([])
  })

  it("isEmptyFamilyDraft mirrors the map emptiness (drop counts as staged)", () => {
    expect(isEmptyFamilyDraft(null)).toBe(true)
    expect(isEmptyFamilyDraft({})).toBe(true)
    expect(isEmptyFamilyDraft({ genre: FAMILY_FOLLOW_SENTINEL })).toBe(false)
  })
})

describe("encodeFamilyBpParam omits drops (follow = fall through)", () => {
  it("drop keys never travel in bp; clears still do", () => {
    expect(
      encodeFamilyBpParam({ genre: FAMILY_FOLLOW_SENTINEL, rank: null, extra: { ...A } }),
    ).toBe(`rank:-,extra:${A.id}.${A.rev}`)
    expect(encodeFamilyBpParam({ genre: FAMILY_FOLLOW_SENTINEL })).toBeNull()
  })
})

describe("applyFollowDrops legacy singleton handling", () => {
  it("no legacy pair: only deletes the dropped keys", () => {
    const out = applyFollowDrops({
      base: { genre: { ...A }, rank: { ...B } },
      drops: ["genre"],
      legacyId: null,
      legacyTarget: null,
    })
    expect(out).toEqual({
      familyMap: { rank: { ...B } },
      clearLegacy: false,
      materialized: {},
    })
  })

  it("legacy top + drop rank: clears the pair, materializes extra, genre untouched", () => {
    const out = applyFollowDrops({
      base: { genre: { ...A } },
      drops: ["rank"],
      legacyId: A.id,
      legacyRev: A.rev,
      legacyTarget: "top",
    })
    expect(out.clearLegacy).toBe(true)
    expect(out.familyMap).toEqual({
      genre: { ...A },
      extra: { id: A.id, rev: A.rev },
    })
    expect(out.materialized).toEqual({ extra: { id: A.id, rev: A.rev } })
  })

  it("legacy top + drop genre (not covered): pair kept, only the key deleted", () => {
    const out = applyFollowDrops({
      base: { genre: { ...A } },
      drops: ["genre"],
      legacyId: A.id,
      legacyRev: A.rev,
      legacyTarget: "top",
    })
    expect(out.clearLegacy).toBe(false)
    expect(out.familyMap).toEqual({})
    expect(out.materialized).toEqual({})
  })

  it("explicit family target covers itself (drop clears the pair)", () => {
    const out = applyFollowDrops({
      base: { genre: { ...A } },
      drops: ["genre"],
      legacyId: B.id,
      legacyRev: B.rev,
      legacyTarget: "genre",
    })
    expect(out.clearLegacy).toBe(true)
    expect(out.familyMap).toEqual({})
  })

  it("unknown target or invalid id: never guesses the pair away", () => {
    for (const args of [
      { legacyId: A.id, legacyTarget: undefined },
      { legacyId: A.id, legacyTarget: "nope" },
      { legacyId: "short", legacyTarget: "top" },
      { legacyId: null, legacyTarget: "top" },
    ]) {
      const out = applyFollowDrops({ base: { genre: { ...A } }, drops: ["genre"], legacyRev: A.rev, ...args })
      expect(out.clearLegacy, JSON.stringify(args)).toBe(false)
      expect(out.familyMap, JSON.stringify(args)).toEqual({})
    }
  })

  it("already-materialized sibling wins over the legacy freeze", () => {
    const out = applyFollowDrops({
      base: { extra: { ...B } },
      drops: ["rank"],
      legacyId: A.id,
      legacyRev: A.rev,
      legacyTarget: "top",
    })
    expect(out.clearLegacy).toBe(true)
    expect(out.familyMap).toEqual({ extra: { ...B } })
    expect(out.materialized).toEqual({})
  })
})
