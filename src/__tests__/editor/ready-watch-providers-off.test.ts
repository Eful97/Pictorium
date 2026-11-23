import { describe, expect, it } from "vitest"
import { withReadyPresetWatchProvidersOff } from "@/lib/visual-presets"

describe("withReadyPresetWatchProvidersOff", () => {
  const base = { defaultWatchProviders: true, defaultWatchProvidersLandscape: true, x: 1 }
  it("portrait turns off only the portrait flat", () => {
    expect(withReadyPresetWatchProvidersOff(base, "portrait")).toEqual({ ...base, defaultWatchProviders: false })
  })
  it("landscape turns off only the landscape flat", () => {
    expect(withReadyPresetWatchProvidersOff(base, "landscape")).toEqual({ ...base, defaultWatchProvidersLandscape: false })
  })
})
