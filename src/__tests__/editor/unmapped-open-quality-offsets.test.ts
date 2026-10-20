/**
 * F4 regression: live quality-badge offsets for a title WITHOUT a saved
 * mapping (fresh open) must resolve from the effective space defaults —
 * never from mount-hydration leftovers.
 *
 * Proven E2E root cause (auth full-file pixel comparison, retired with the
 * Badge Lab suite):
 * the no-mapping open branch never initialized live `qualityBadgeOffsetX/Y`,
 * so the live kept whatever mount hydration left — initial 0/0 on a first
 * load, -10/+15 once localStorage had persisted space defaults (factory
 * portrait defaults). Under full-file server load a title open raced the
 * mappings fetch past the 4s settle timeout, opened the already
 * saved title as "unmapped", and the explicit Save froze -10/+15 over the
 * mapping's explicit 0/0. Pixel diff was a ~10px/15px quality-badge shift
 * (top-right bbox x380-499 y16-128), ETags differed, everything else
 * byte-identical. Isolated runs passed because mappings settled fast and
 * the mapped branch (`eff ?? default`) overwrote the leftovers with 0.
 *
 * Quality offsets are the only tuning pair where the live initial (0/0)
 * diverges from the factory space default (-10/+15), which is why only
 * they ever manifested. The resolver below is the single decision function
 * used by the no-mapping open branch; the auth E2E guards the wiring.
 */
import { describe, expect, it } from "vitest"
import {
  DEFAULT_QUALITY_BADGE_OFFSET_X,
  DEFAULT_QUALITY_BADGE_OFFSET_Y,
  resolveUnmappedQualityBadgeOffsets,
} from "@/lib/badge-styles"

describe("resolveUnmappedQualityBadgeOffsets (F4)", () => {
  it("portrait without a landscape profile resolves the flat space defaults (never the 0/0 initial)", () => {
    expect(
      resolveUnmappedQualityBadgeOffsets(
        null,
        DEFAULT_QUALITY_BADGE_OFFSET_X,
        DEFAULT_QUALITY_BADGE_OFFSET_Y,
      ),
    ).toEqual({ qualityBadgeOffsetX: -10, qualityBadgeOffsetY: 15 })
  })

  it("follows custom space defaults instead of the factory pair", () => {
    expect(resolveUnmappedQualityBadgeOffsets(null, 5, -5)).toEqual({
      qualityBadgeOffsetX: 5,
      qualityBadgeOffsetY: -5,
    })
  })

  it("an owned landscape profile wins over the flat defaults", () => {
    expect(
      resolveUnmappedQualityBadgeOffsets(
        { qualityBadgeOffsetX: 3, qualityBadgeOffsetY: 4 },
        DEFAULT_QUALITY_BADGE_OFFSET_X,
        DEFAULT_QUALITY_BADGE_OFFSET_Y,
      ),
    ).toEqual({ qualityBadgeOffsetX: 3, qualityBadgeOffsetY: 4 })
  })

  it("landscape without a profile falls back to the flat defaults", () => {
    expect(
      resolveUnmappedQualityBadgeOffsets(
        undefined,
        DEFAULT_QUALITY_BADGE_OFFSET_X,
        DEFAULT_QUALITY_BADGE_OFFSET_Y,
      ),
    ).toEqual({ qualityBadgeOffsetX: -10, qualityBadgeOffsetY: 15 })
  })

  it("explicit null profile offsets fall back per-axis (never resurrect leftovers)", () => {
    expect(
      resolveUnmappedQualityBadgeOffsets(
        { qualityBadgeOffsetX: null, qualityBadgeOffsetY: 7 },
        DEFAULT_QUALITY_BADGE_OFFSET_X,
        DEFAULT_QUALITY_BADGE_OFFSET_Y,
      ),
    ).toEqual({ qualityBadgeOffsetX: -10, qualityBadgeOffsetY: 7 })
  })
})
