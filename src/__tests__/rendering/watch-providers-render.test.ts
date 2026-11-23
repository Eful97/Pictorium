import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { renderWatchProviderRow } from "@/lib/watch-providers-render"
import type { WatchProvider } from "@/lib/watch-providers"

const ICON = 40
const GAP = Math.round(ICON * 0.18)

const mk = (n: number): WatchProvider[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, logoPath: `/p${i + 1}.jpg` }))

async function solid(): Promise<Buffer> {
  return sharp({ create: { width: 92, height: 92, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer()
}
const load = async () => solid()

describe("renderWatchProviderRow", () => {
  it("returns null for an empty list", async () => {
    expect(await renderWatchProviderRow([], ICON, load)).toBeNull()
  })

  it("3 providers: 3 icons + 2 gaps, no counter", async () => {
    const row = await renderWatchProviderRow(mk(3), ICON, load)
    expect(row).not.toBeNull()
    expect(row!.w).toBe(3 * ICON + 2 * GAP)
    expect(row!.h).toBe(ICON)
  })

  it("renders exactly the icons it is given (caller truncates to wpm): no '+N' chip", async () => {
    const four = await renderWatchProviderRow(mk(4), ICON, load)
    expect(four!.w).toBe(4 * ICON + 3 * GAP)
  })

  it("skips a provider whose logo fails to load (no empty box)", async () => {
    const flaky = async (p: string) => (p === "/p2.jpg" ? null : solid())
    const row = await renderWatchProviderRow(mk(3), ICON, flaky)
    expect(row!.w).toBe(2 * ICON + GAP)
  })

  it("returns null when every logo fails", async () => {
    expect(await renderWatchProviderRow(mk(2), ICON, async () => null)).toBeNull()
  })

  it("paints opaque pixels inside the first icon", async () => {
    const row = await renderWatchProviderRow(mk(1), ICON, load)
    const { data, info } = await sharp(row!.png).raw().toBuffer({ resolveWithObject: true })
    const i = (Math.floor(ICON / 2) * info.width + Math.floor(ICON / 2)) * info.channels
    expect(data[i + 3]).toBe(255)
  })
})
