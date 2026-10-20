/**
 * Per-family Badge Lab save helpers (task B): sanitize / merge / landscape
 * inheritance guard / emptiness.
 *
 * Contract under test:
 * - staged keys win per family (null = explicit Standard clear, preserved);
 * - malformed ids/revs, unknown families and prototype keys are dropped
 *   fail-closed (never written, never resurrect siblings);
 * - the landscape guard freezes the OLD effective look only for families the
 *   save moved while the landscape side does not own them; owned keys are
 *   never rebased; a previously-absent effective look freezes as explicit null
 *   (native) so the other shape never inherits a new edit accidentally.
 */
import { describe, expect, it } from "vitest"
import {
  backfillLandscapeFamilyGuard,
  isEmptyFamilyMap,
  mergeFamilyMapForSave,
  sanitizeFamilyMap,
} from "@/lib/family-preset-save"

const A = { id: "Abc123-_XyZ", rev: "deadbeef" }
const B = { id: "Qwerty12-34", rev: "cafef00d" }

describe("sanitizeFamilyMap", () => {
  it("keeps valid bindings and explicit clears, normalizes missing rev to null", () => {
    expect(sanitizeFamilyMap({ rank: A, genre: null, quality: { id: "Qwerty12-34" } })).toEqual({
      rank: { id: A.id, rev: A.rev },
      genre: null,
      quality: { id: "Qwerty12-34", rev: null },
    })
  })

  it("drops malformed ids/revs, unknown families and prototype keys", () => {
    expect(
      sanitizeFamilyMap({
        rank: { id: "nope", rev: "deadbeef" },
        extra: { id: A.id, rev: "xyz" },
        sideways: { id: A.id, rev: A.rev },
        __proto__: { id: A.id },
        genre: { id: A.id, rev: A.rev, extra: 1 },
      }),
    ).toEqual({})
  })

  it("never throws on non-objects", () => {
    expect(sanitizeFamilyMap(null)).toEqual({})
    expect(sanitizeFamilyMap("rank:x")).toEqual({})
    expect(sanitizeFamilyMap([{ rank: A }])).toEqual({})
  })
})

describe("mergeFamilyMapForSave", () => {
  it("merges staged over stored per family, siblings verbatim", () => {
    expect(mergeFamilyMapForSave({ rank: A, genre: B }, { rank: null })).toEqual({
      rank: null,
      genre: { id: B.id, rev: B.rev },
    })
  })

  it("keeps stored when staged is empty and drops staged garbage", () => {
    expect(mergeFamilyMapForSave({ rank: A }, { rank: { id: "bad" } })).toEqual({
      rank: { id: A.id, rev: A.rev },
    })
    expect(mergeFamilyMapForSave({ rank: A }, null)).toEqual({ rank: { id: A.id, rev: A.rev } })
  })

  it("starts from staged on a new mapping", () => {
    expect(mergeFamilyMapForSave(null, { quality: { id: B.id } })).toEqual({
      quality: { id: B.id, rev: null },
    })
  })
})

describe("backfillLandscapeFamilyGuard", () => {
  it("freezes the old effective look for moved families, leaves the rest alone", () => {
    expect(
      backfillLandscapeFamilyGuard({
        prevFlat: { rank: A, genre: B },
        newFlat: { rank: { id: B.id, rev: B.rev }, genre: { id: B.id, rev: B.rev } },
        mergedProfile: {},
      }),
    ).toEqual({ rank: { id: A.id, rev: A.rev } })
  })

  it("never rebases landscape-owned keys", () => {
    expect(
      backfillLandscapeFamilyGuard({
        prevFlat: { rank: A },
        newFlat: { rank: { id: B.id, rev: B.rev } },
        mergedProfile: { rank: { id: "Owned000-00", rev: null } },
      }),
    ).toEqual({})
  })

  it("freezes explicit null (native) when the new flat introduces a binding the landscape never had", () => {
    expect(
      backfillLandscapeFamilyGuard({
        prevFlat: null,
        newFlat: { rank: { id: A.id, rev: A.rev } },
        mergedProfile: {},
      }),
    ).toEqual({ rank: null })
  })

  it("preserves an explicit clear through the guard (never resurrects)", () => {
    expect(
      backfillLandscapeFamilyGuard({
        prevFlat: { rank: A },
        newFlat: { rank: null },
        mergedProfile: {},
      }),
    ).toEqual({ rank: { id: A.id, rev: A.rev } })
  })

  it("is empty when nothing moved", () => {
    expect(
      backfillLandscapeFamilyGuard({
        prevFlat: { rank: A },
        newFlat: { rank: { id: A.id, rev: A.rev } },
        mergedProfile: {},
      }),
    ).toEqual({})
  })

  it("freezes the effective legacy singleton for a moved family with unknown target (conservative)", () => {
    // A portrait edit introduces a genre binding the landscape never had;
    // the old landscape look came from a legacy singleton of unknown target.
    expect(
      backfillLandscapeFamilyGuard({
        prevFlat: null,
        newFlat: { genre: { id: B.id, rev: B.rev } },
        mergedProfile: {},
        prevLegacy: { id: A.id, rev: A.rev },
      }),
    ).toEqual({ genre: { id: A.id, rev: A.rev } })
  })

  it("freezes the legacy singleton only for covered families when the target is known", () => {
    const top = { id: A.id, rev: A.rev }
    expect(
      backfillLandscapeFamilyGuard({
        prevFlat: null,
        newFlat: { rank: { id: B.id, rev: B.rev }, genre: { id: B.id, rev: B.rev } },
        mergedProfile: {},
        prevLegacy: top,
        prevLegacyFamilies: ["rank", "extra"],
      }),
    ).toEqual({ rank: { id: A.id, rev: A.rev }, genre: null })
  })

  it("ignores an invalid legacy id (fail-closed: native freeze, never garbage)", () => {
    expect(
      backfillLandscapeFamilyGuard({
        prevFlat: null,
        newFlat: { genre: { id: B.id, rev: B.rev } },
        mergedProfile: {},
        prevLegacy: { id: "bad!!", rev: "deadbeef" },
      }),
    ).toEqual({ genre: null })
  })

  it("normalizes an absent legacy rev to unpinned", () => {
    expect(
      backfillLandscapeFamilyGuard({
        prevFlat: null,
        newFlat: { genre: { id: B.id, rev: B.rev } },
        mergedProfile: {},
        prevLegacy: { id: A.id, rev: "xyz" },
      }),
    ).toEqual({ genre: { id: A.id, rev: null } })
  })

  it("still never rebases a landscape-owned key when a legacy singleton exists", () => {
    expect(
      backfillLandscapeFamilyGuard({
        prevFlat: null,
        newFlat: { rank: { id: B.id, rev: B.rev } },
        mergedProfile: { rank: { id: "Owned000-00", rev: null } },
        prevLegacy: { id: A.id, rev: A.rev },
      }),
    ).toEqual({})
  })
})

describe("isEmptyFamilyMap", () => {
  it("treats null/undefined/empty as empty", () => {
    expect(isEmptyFamilyMap(null)).toBe(true)
    expect(isEmptyFamilyMap(undefined)).toBe(true)
    expect(isEmptyFamilyMap({})).toBe(true)
    expect(isEmptyFamilyMap({ rank: null })).toBe(false)
  })
})
