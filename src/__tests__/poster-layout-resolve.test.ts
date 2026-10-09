import { describe, expect, it } from "vitest"
import {
  effectiveShapeDefaultLayout,
  resolveOpenPosterLayout,
} from "@/lib/poster-layout-resolve"
import type { Mapping } from "@/lib/types"

function mapping(over: Partial<Mapping> = {}): Mapping {
  return {
    tmdbId: 1,
    mediaType: "movie",
    title: "T",
    posterPath: "/p.jpg",
    logoPath: null,
    originalPosterPath: null,
    language: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  }
}

describe("effectiveShapeDefaultLayout (land ?? flat)", () => {
  it("portrait always follows the flat", () => {
    expect(effectiveShapeDefaultLayout("standard", { posterLayout: "fresh" }, "poster")).toBe("standard")
    expect(effectiveShapeDefaultLayout("fresh", { posterLayout: "standard" }, "poster")).toBe("fresh")
  })

  it("landscape prefers the profile, absent keys follow the flat", () => {
    expect(effectiveShapeDefaultLayout("standard", { posterLayout: "fresh" }, "landscape")).toBe("fresh")
    expect(effectiveShapeDefaultLayout("fresh", { posterLayout: "standard" }, "landscape")).toBe("standard")
    expect(effectiveShapeDefaultLayout("standard", {}, "landscape")).toBe("standard")
    expect(effectiveShapeDefaultLayout("fresh", null, "landscape")).toBe("fresh")
  })

  it("fails closed to standard on garbage", () => {
    expect(
      effectiveShapeDefaultLayout("bogus" as unknown as "standard", { posterLayout: "bogus" } as never, "landscape"),
    ).toBe("standard")
    expect(effectiveShapeDefaultLayout("fresh", { posterLayout: "bogus" } as never, "landscape")).toBe("fresh")
  })
})

describe("resolveOpenPosterLayout (mapping effective > effective shape default)", () => {
  it("effective mapping wins over both defaults", () => {
    const m = mapping({ posterLayout: "fresh", landscape: { posterLayout: "standard" } })
    expect(resolveOpenPosterLayout(m, "landscape", "standard", { posterLayout: "fresh" })).toBe("standard")
    expect(resolveOpenPosterLayout(m, "poster", "standard", { posterLayout: "fresh" })).toBe("fresh")
  })

  it("legacy mapping without layout follows the land profile in landscape", () => {
    const legacy = mapping({ posterShape: "landscape" })
    expect(resolveOpenPosterLayout(legacy, "landscape", "standard", { posterLayout: "fresh" })).toBe("fresh")
    expect(resolveOpenPosterLayout(legacy, "landscape", "fresh", { posterLayout: "standard" })).toBe("standard")
    expect(resolveOpenPosterLayout(legacy, "poster", "standard", { posterLayout: "fresh" })).toBe("standard")
  })

  it("flat mapping layout is the landscape fallback when the profile is absent", () => {
    const m = mapping({ posterLayout: "fresh" })
    expect(resolveOpenPosterLayout(m, "landscape", "standard", null)).toBe("fresh")
  })

  it("null mapping follows the effective shape default", () => {
    expect(resolveOpenPosterLayout(null, "landscape", "standard", { posterLayout: "fresh" })).toBe("fresh")
    expect(resolveOpenPosterLayout(null, "poster", "standard", { posterLayout: "fresh" })).toBe("standard")
  })
})

const COVER_LAYOUTS = ["provider-glass", "nuvio", "stremio"] as const

describe("cover layouts contract-only (portrait + landscape)", () => {
  it.each(COVER_LAYOUTS)("portrait follows the flat default for %s", (layout) => {
    expect(effectiveShapeDefaultLayout(layout, {}, "poster")).toBe(layout)
    expect(effectiveShapeDefaultLayout(layout, { posterLayout: "fresh" }, "poster")).toBe(layout)
  })

  it.each(COVER_LAYOUTS)("landscape prefers the profile, absent keys follow the flat for %s", (layout) => {
    expect(effectiveShapeDefaultLayout("standard", { posterLayout: layout }, "landscape")).toBe(layout)
    expect(effectiveShapeDefaultLayout(layout, { posterLayout: "standard" }, "landscape")).toBe("standard")
    expect(effectiveShapeDefaultLayout(layout, null, "landscape")).toBe(layout)
  })

  it.each(COVER_LAYOUTS)("open resolution keeps %s per shape independently", (layout) => {
    const other = layout === "nuvio" ? "stremio" : "nuvio"
    const m = mapping({ posterLayout: layout, landscape: { posterLayout: other } })
    expect(resolveOpenPosterLayout(m, "poster", "standard", null)).toBe(layout)
    expect(resolveOpenPosterLayout(m, "landscape", "standard", null)).toBe(other)
  })

  it.each(COVER_LAYOUTS)("flat mapping %s is the landscape fallback when the profile is absent", (layout) => {
    const m = mapping({ posterLayout: layout })
    expect(resolveOpenPosterLayout(m, "landscape", "standard", null)).toBe(layout)
    expect(resolveOpenPosterLayout(m, "poster", "standard", null)).toBe(layout)
  })

  it.each(COVER_LAYOUTS)("null mapping follows the effective shape default for %s", (layout) => {
    expect(resolveOpenPosterLayout(null, "poster", layout, { posterLayout: "fresh" })).toBe(layout)
    expect(resolveOpenPosterLayout(null, "landscape", "standard", { posterLayout: layout })).toBe(layout)
  })
})
