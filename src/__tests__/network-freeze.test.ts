/**
 * Pure network freeze: geometry URL, stale guard, effective scale, response
 * parsing, disable conditions, neutral ON offsets. No providers.
 */
import { describe, expect, it } from "vitest"
import {
  buildNetGeoUrl,
  clampLogoScale,
  effectiveFrozenScale,
  isFollowOffDisabled,
  isFreezeStale,
  neutralFollowOffsets,
  parseNetGeoResponse,
} from "@/lib/network-freeze"

describe("buildNetGeoUrl", () => {
  it("appends debug=1&netgeo=1 to the exact preview URL", () => {
    expect(buildNetGeoUrl("http://x/api/poster/movie/1?rv=9&scale=60"))
      .toBe("http://x/api/poster/movie/1?rv=9&scale=60&debug=1&netgeo=1")
    expect(buildNetGeoUrl("")).toBe("")
    expect(buildNetGeoUrl("http://x/api/poster/movie/1")).toContain("?debug=1&netgeo=1")
  })

  it("never duplicates the flags", () => {
    const once = buildNetGeoUrl("http://x/api/poster/movie/1?rv=9")
    expect(buildNetGeoUrl(once)).toBe(once)
  })
})

describe("isFreezeStale", () => {
  const snap = { titleKey: "movie:1", shape: "poster", url: "http://x/?a=1" }
  it("matches only identical title+shape+url", () => {
    expect(isFreezeStale(snap, { ...snap })).toBe(false)
    expect(isFreezeStale(snap, { ...snap, titleKey: "movie:2" })).toBe(true)
    expect(isFreezeStale(snap, { ...snap, shape: "landscape" })).toBe(true)
    expect(isFreezeStale(snap, { ...snap, url: "http://x/?a=2" })).toBe(true)
  })
})

describe("effectiveFrozenScale", () => {
  it("keeps scale without shrink and rescales after shrink", () => {
    expect(effectiveFrozenScale(100, 80, 80)).toBe(100)
    expect(effectiveFrozenScale(100, 60, 80)).toBe(75)
    expect(effectiveFrozenScale(200, 40, 80)).toBe(100)
  })

  it("clamps to the server contract and guards bad inputs", () => {
    expect(effectiveFrozenScale(100, 800, 80)).toBe(200)
    expect(effectiveFrozenScale(100, 1, 800)).toBe(10)
    expect(effectiveFrozenScale(100, 60, 0)).toBe(100)
    expect(effectiveFrozenScale(100, 60, -5)).toBe(100)
    expect(clampLogoScale(5000)).toBe(200)
    expect(clampLogoScale(-3)).toBe(10)
  })
})

describe("parseNetGeoResponse", () => {
  it("accepts full geometry and defaults nominals", () => {
    expect(parseNetGeoResponse({
      network: { top: 34, left: 24, w: 90, h: 30, nominalW: 120, nominalH: 40, followTitle: true },
    })).toEqual({ top: 34, left: 24, w: 90, h: 30, nominalW: 120, nominalH: 40 })
    expect(parseNetGeoResponse({ network: { top: 0, left: 0, w: 10, h: 10 } }))
      .toEqual({ top: 0, left: 0, w: 10, h: 10, nominalW: 10, nominalH: 10 })
  })

  it("rejects missing network, partial numbers and empty boxes", () => {
    expect(parseNetGeoResponse({})).toBeNull()
    expect(parseNetGeoResponse({ network: null })).toBeNull()
    expect(parseNetGeoResponse({ network: { top: 1, left: 2 } })).toBeNull()
    expect(parseNetGeoResponse({ network: { top: 1, left: 2, w: 0, h: 3 } })).toBeNull()
    expect(parseNetGeoResponse({ network: { top: "34", left: 2, w: 3, h: 4 } })).toBeNull()
    expect(parseNetGeoResponse(null)).toBeNull()
  })
})

describe("neutralFollowOffsets", () => {
  it("returns 0,0 for fixed layers, never stored absolutes", () => {
    expect(neutralFollowOffsets({ fixed: true, relativeX: 200, relativeY: 500 }))
      .toEqual({ x: 0, y: 0 })
    expect(neutralFollowOffsets({ fixed: true })).toEqual({ x: 0, y: 0 })
  })

  it("keeps relative offsets (clamped) when not fixed", () => {
    expect(neutralFollowOffsets({ fixed: false, relativeX: 12, relativeY: -7 }))
      .toEqual({ x: 12, y: -7 })
    expect(neutralFollowOffsets({ fixed: false })).toEqual({ x: 0, y: 0 })
    expect(neutralFollowOffsets({ fixed: false, relativeX: 99999, relativeY: NaN }))
      .toEqual({ x: 2000, y: 0 })
  })
})

describe("isFollowOffDisabled", () => {
  it("disables without network, preview, title or while freezing", () => {
    const ok = { networkLogo: true, hasPreviewUrl: true, hasTitle: true, freezing: false }
    expect(isFollowOffDisabled(ok)).toBe(false)
    expect(isFollowOffDisabled({ ...ok, networkLogo: false })).toBe(true)
    expect(isFollowOffDisabled({ ...ok, hasPreviewUrl: false })).toBe(true)
    expect(isFollowOffDisabled({ ...ok, hasTitle: false })).toBe(true)
    expect(isFollowOffDisabled({ ...ok, freezing: true })).toBe(true)
  })

  it("disables while geometry loads or when the network is not rendered", () => {
    const ok = { networkLogo: true, hasPreviewUrl: true, hasTitle: true, freezing: false }
    expect(isFollowOffDisabled({ ...ok, geometryLoading: true })).toBe(true)
    expect(isFollowOffDisabled({ ...ok, hasGeometry: false })).toBe(true)
    expect(isFollowOffDisabled({ ...ok, geometryLoading: false, hasGeometry: true })).toBe(false)
  })
})
