import { describe, expect, it, vi } from "vitest"

/**
 * Manifest drift at the write boundary.
 *
 * A vendored pack can be replaced between two saves: stored selections may
 * still carry ids that no longer exist in the manifest. The write boundary
 * (mapping, defaults, preset) must drop them/cap the list instead of rejecting
 * the save — the renderer already fails closed on unknown ids.
 *
 * The shipped pack is empty (5 built-in A/V ids), so this file mocks the
 * manifest with a synthetic pack to exercise both drift and the 8-mark cap.
 * `vi.hoisted` keeps the fixture available to the hoisted `vi.mock` factory.
 */
const fakePack = vi.hoisted(() => ({
  version: "test",
  source: "test",
  marks: ["packa", "packb", "packc", "packd", "packe", "packf"].map((id) => ({
    id,
    label: id.toUpperCase(),
    icon: `quality-badges/pack/${id}.svg`,
    mode: "opaque",
    aspect: 2,
  })),
}))

vi.mock("@/data/quality-badge-pack.json", () => ({ default: fakePack }))

import { mappingSchema } from "@/lib/validation"
import { visualPresetValuesSchema } from "@/lib/visual-presets"
import { MAX_QUALITY_MARKS, QUALITY_MARK_IDS, QUALITY_MARK_OPTIONS } from "@/lib/quality-badge-pack"

const BASE_MAPPING = { tmdbId: 1, mediaType: "movie", title: "T", posterPath: "/p.jpg" } as const

/** More selectable ids than the cap (built-ins + synthetic pack). */
const OVER_CAP_IDS = QUALITY_MARK_IDS.slice(0, MAX_QUALITY_MARKS + 2)

describe("quality pack drift at the write boundary", () => {
  it("the synthetic pack pushes the option list past the cap (fixture sanity)", () => {
    expect(QUALITY_MARK_OPTIONS.length).toBeGreaterThan(MAX_QUALITY_MARKS)
    expect(OVER_CAP_IDS.length).toBeGreaterThan(MAX_QUALITY_MARKS)
    expect(new Set(OVER_CAP_IDS).size).toBe(OVER_CAP_IDS.length)
  })

  it("mapping save drops a stale pack id instead of rejecting", () => {
    const parsed = mappingSchema.safeParse({
      ...BASE_MAPPING,
      videoFormats: ["dv", "retired-pack-mark", "atmos"],
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.videoFormats).toEqual(["dv", "atmos"])
  })

  it("mapping save drops a stale id in the landscape profile too", () => {
    const parsed = mappingSchema.safeParse({
      ...BASE_MAPPING,
      landscape: { videoFormats: ["hdr", "gone-after-pack-swap", "imax"] },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.landscape?.videoFormats).toEqual(["hdr", "imax"])
  })

  it("mapping save with more than the cap keeps the first MAX ids in order", () => {
    const parsed = mappingSchema.safeParse({ ...BASE_MAPPING, videoFormats: OVER_CAP_IDS })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.videoFormats).toEqual(OVER_CAP_IDS.slice(0, MAX_QUALITY_MARKS))
  })

  it("preset values drop stale ids and cap the list like the API boundary", () => {
    const presetFormats = visualPresetValuesSchema.pick({ defaultVideoFormats: true })

    const stale = presetFormats.safeParse({
      defaultVideoFormats: ["dv", "retired-pack-mark", "hdr"],
    })
    expect(stale.success).toBe(true)
    if (!stale.success) return
    expect(stale.data.defaultVideoFormats).toEqual(["dv", "hdr"])

    const overCap = presetFormats.safeParse({ defaultVideoFormats: OVER_CAP_IDS })
    expect(overCap.success).toBe(true)
    if (!overCap.success) return
    expect(overCap.data.defaultVideoFormats).toEqual(OVER_CAP_IDS.slice(0, MAX_QUALITY_MARKS))
  })
})
