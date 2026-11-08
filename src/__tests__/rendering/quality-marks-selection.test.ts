import { describe, expect, it, vi } from "vitest"

// The shipped pack is empty by default; mock two marks so the selection logic
// is exercised against real pack ids.
vi.mock("@/data/quality-badge-pack.json", () => ({
  default: {
    version: "test",
    marks: [
      {
        id: "remux",
        label: "REMUX",
        icon: "quality-badges/pack/remux.svg",
        mode: "tintable",
        inkBox: { x: 25.9, y: 14.9, w: 149.5, h: 29.5 },
      },
      {
        id: "tenbit",
        label: "10-BIT",
        icon: "quality-badges/pack/tenbit.svg",
        mode: "tintable",
        inkBox: { x: 43.12, y: 14.42, w: 134.42, h: 30.28 },
      },
    ],
  },
}))

import { resolveEffectiveQualityMarks } from "@/lib/quality-marks-selection"
import { MAX_QUALITY_MARKS, PACK_MARK_IDS, QUALITY_MARK_OPTIONS } from "@/lib/quality-badge-pack"
import { KNOWN_VIDEO_FORMATS, VIDEO_FORMAT_OPTIONS } from "@/lib/av-specs"

const AVAILABLE = ["dv", "atmos", "hdr"] as const
const PACK = PACK_MARK_IDS[0]
const PACK_2 = PACK_MARK_IDS[1]

describe("resolveEffectiveQualityMarks", () => {
  it("senza selezione: solo i built-in disponibili, nessun pack inventato", () => {
    expect(resolveEffectiveQualityMarks({
      availableFormats: AVAILABLE,
      requestedFormats: null,
      allowedFormats: null,
    })).toEqual(["dv", "atmos", "hdr"])
  })

  it("la selezione esplicita filtra i built-in e aggiunge i pack selezionati", () => {
    expect(resolveEffectiveQualityMarks({
      availableFormats: AVAILABLE,
      requestedFormats: ["dv", PACK],
      allowedFormats: null,
    })).toEqual(["dv", PACK])
  })

  it("i default non vuoti valgono come selezione (pack incluso)", () => {
    expect(resolveEffectiveQualityMarks({
      availableFormats: AVAILABLE,
      requestedFormats: null,
      allowedFormats: ["hdr", PACK_2],
    })).toEqual(["hdr", PACK_2])
  })

  it("formats=none ([]) non dipinge nulla, nemmeno i pack", () => {
    expect(resolveEffectiveQualityMarks({
      availableFormats: AVAILABLE,
      requestedFormats: [],
      allowedFormats: ["dv"],
    })).toEqual([])
  })

  it("un pack selezionato appare anche se il titolo non ha specifiche A/V", () => {
    expect(resolveEffectiveQualityMarks({
      availableFormats: [],
      requestedFormats: [PACK],
      allowedFormats: null,
    })).toEqual([PACK])
  })

  it("id sconosciuti scartati e cap deterministico", () => {
    const ids = ["dv", ...PACK_MARK_IDS, ...PACK_MARK_IDS, "not-a-mark"]
    const result = resolveEffectiveQualityMarks({
      availableFormats: ["dv"],
      requestedFormats: ids,
      allowedFormats: null,
    })
    expect(result[0]).toBe("dv")
    expect(result.length).toBeLessThanOrEqual(MAX_QUALITY_MARKS)
    expect(result).not.toContain("not-a-mark")
    expect(new Set(result).size).toBe(result.length)
  })

  it("selector restores built-in UI order and appends pack marks after them", () => {
    const ids = QUALITY_MARK_OPTIONS.map((option) => option.id)
    expect(ids.slice(0, KNOWN_VIDEO_FORMATS.length)).toEqual(VIDEO_FORMAT_OPTIONS.map((option) => option.id))
    expect(ids.slice(KNOWN_VIDEO_FORMATS.length)).toEqual([...PACK_MARK_IDS])
  })
})
