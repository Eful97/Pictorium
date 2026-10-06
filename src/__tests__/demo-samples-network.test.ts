import { describe, expect, it } from "vitest"
import {
  renderFirstMatchingNetworkLogoBadgeHybrid,
  renderFirstMatchingNetworkRawBadgeHybrid,
} from "@/lib/network-svgs"
import { DEMO_SAMPLE_NETWORK } from "@/lib/demo-samples"

/**
 * The demo-samples network fallback resolves through the shared production
 * renderer with real bundled assets (no mocks): the sample candidate must
 * produce a renderable pill, while genuinely unknown studios must miss (this
 * miss is exactly what arms the service-level fallback without reordering
 * real brands).
 */
describe("demo samples network fallback (shared resolver, real assets)", () => {
  it("renders the bundled brand pill for the sample candidate", async () => {
    const pill = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: DEMO_SAMPLE_NETWORK.name, logoPath: DEMO_SAMPLE_NETWORK.logoPath }],
      500,
      false,
    )
    expect(pill).not.toBeNull()
    expect(pill?.networkKey).toBe("netflix")
    expect(pill?.png.byteLength).toBeGreaterThan(0)
    const raw = await renderFirstMatchingNetworkRawBadgeHybrid(
      [{ name: DEMO_SAMPLE_NETWORK.name, logoPath: DEMO_SAMPLE_NETWORK.logoPath }],
      500,
      false,
    )
    expect(raw).not.toBeNull()
  })

  it("misses on unknown studios (fallback trigger, order untouched)", async () => {
    const pill = await renderFirstMatchingNetworkLogoBadgeHybrid(
      [{ name: "Unknown Studio XYZ", logoPath: null }],
      500,
      false,
    )
    expect(pill).toBeNull()
  })
})
