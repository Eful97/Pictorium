import { describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import { renderFirstMatchingNetworkLogoBadgeHybrid, renderFirstMatchingNetworkRawBadgeHybrid } from "@/lib/network-svgs"
import { fetchImg } from "@/lib/poster-render-helpers"

vi.mock("@/lib/poster-render-helpers", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/poster-render-helpers")>()
  return { ...mod, fetchImg: vi.fn() }
})

describe("TMDB fallback network colors", () => {
  for (const [kind, render] of [
    ["normal", renderFirstMatchingNetworkLogoBadgeHybrid],
    ["raw", renderFirstMatchingNetworkRawBadgeHybrid],
  ] as const) {
    it.each([false, true])(`${kind} preserves original colors and black shadow (topLight=%s)`, async (topLight) => {
      const source = await sharp(Buffer.from(
        '<svg width="120" height="60"><rect x="20" y="20" width="40" height="20" fill="#e02040"/><rect x="60" y="20" width="40" height="20" fill="#2080e0"/></svg>',
      )).png().toBuffer()
      vi.mocked(fetchImg).mockResolvedValue(source)
      const result = await render([{ name: "Unlisted Color Test Studio", logoPath: `/color-${kind}-${topLight}.png` }], 500, topLight)
      expect(result).not.toBeNull()
      const { data, info } = await sharp(result!.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)]
      // Area-fit source is 84 x 42 with the unchanged 5px shadow padding.
      expect([result!.w, result!.h]).toEqual([94, 55])
      expect(pixel(33, 26)).toEqual([224, 32, 64, 255])
      expect(pixel(61, 26)).toEqual([32, 128, 224, 255])
      // Below the colored artwork: only the soft black drop shadow remains.
      const shadow = pixel(33, 36)
      expect(shadow.slice(0, 3)).toEqual([0, 0, 0])
      expect(shadow[3]).toBeGreaterThan(0)
      expect(shadow[3]).toBeLessThan(141)
      expect(pixel(0, 0)[3]).toBe(0)
    })
  }
})
