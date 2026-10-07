/**
 * Extra/classifica materialization rule (pure helper): editing CLASSIFICA
 * first freezes the previous independent EXTRA before the rank change;
 * editing EXTRA never touches the classifica.
 */
import { describe, expect, it } from "vitest"
import { materializeExtraTuning, clearedExtraForPresetApply } from "@/lib/extra-materialize"

const RANK = { scale: 100, offsetX: 0, offsetY: 0 }

describe("materializeExtraTuning", () => {
  it("freezes all axes from rank when extra is unmigrated and rank changes", () => {
    expect(materializeExtraTuning({
      rank: RANK,
      nextRank: { scale: 150 },
      extra: { scale: null, offsetX: null, offsetY: null },
    })).toEqual({ scale: 100, offsetX: 0, offsetY: 0 })
  })

  it("returns null when the incoming rank value equals the current one", () => {
    expect(materializeExtraTuning({
      rank: RANK,
      nextRank: { scale: 100 },
      extra: { scale: null, offsetX: null, offsetY: null },
    })).toBeNull()
  })

  it("returns null when extra is already independent (own layer)", () => {
    expect(materializeExtraTuning({
      rank: RANK,
      nextRank: { scale: 150 },
      extra: { scale: 120, offsetX: 5, offsetY: -5 },
    })).toBeNull()
  })

  it("returns null when the fallback layer already holds explicit extra", () => {
    expect(materializeExtraTuning({
      rank: RANK,
      nextRank: { scale: 150 },
      extra: { scale: null, offsetX: null, offsetY: null },
      fallbackExtra: { scale: 130, offsetX: null, offsetY: null },
    })).toBeNull()
  })

  it("fills only still-following axes, keeps explicit ones", () => {
    expect(materializeExtraTuning({
      rank: { scale: 150, offsetX: 5, offsetY: 5 },
      nextRank: { offsetY: 9 },
      extra: { scale: 120, offsetX: null, offsetY: null },
    })).toEqual({ scale: 120, offsetX: 5, offsetY: 5 })
  })

  it("ignores axes absent from the incoming patch", () => {
    // Only scale changes: offset axes are not even considered.
    expect(materializeExtraTuning({
      rank: RANK,
      nextRank: { scale: 150 },
      extra: { scale: null, offsetX: 7, offsetY: null },
    })).toEqual({ scale: 100, offsetX: 7, offsetY: 0 })
  })
})

describe("clearedExtraForPresetApply", () => {
  it("clears missing/null axes to null when the patch carries rank keys", () => {
    expect(clearedExtraForPresetApply(
      { scale: 100, offsetX: 0, offsetY: 0 },
      { scale: null, offsetX: null, offsetY: null },
    )).toEqual({ scale: null, offsetX: null, offsetY: null })
    expect(clearedExtraForPresetApply(
      { scale: 100, offsetX: 0, offsetY: 0 },
      {},
    )).toEqual({ scale: null, offsetX: null, offsetY: null })
  })

  it("keeps explicit values, leaves layers without rank keys alone", () => {
    expect(clearedExtraForPresetApply(
      { scale: 100, offsetX: 0, offsetY: 0 },
      { scale: 130, offsetX: 20, offsetY: 30 },
    )).toBeNull()
    expect(clearedExtraForPresetApply({}, { scale: null })).toBeNull()
    expect(clearedExtraForPresetApply(null, { scale: null })).toBeNull()
  })

  it("clears only missing axes (partial explicit preserved)", () => {
    expect(clearedExtraForPresetApply(
      { scale: 100, offsetX: 0, offsetY: 0 },
      { scale: 130, offsetX: null, offsetY: null },
    )).toEqual({ scale: 130, offsetX: null, offsetY: null })
  })
})