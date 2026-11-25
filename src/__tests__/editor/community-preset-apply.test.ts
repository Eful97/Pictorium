import { describe, expect, it } from "vitest"
import { consumePresetApply, requestPresetApply } from "@/lib/community-preset-apply"
import type { VisualPresetValues } from "@/lib/visual-presets"

const preset = { id: "a", name: "Look", shape: "landscape" as const, values: {} as VisualPresetValues }

describe("community preset apply bridge", () => {
  it("is not consumed by the other shape, then consumed exactly once", () => {
    requestPresetApply(preset)
    expect(consumePresetApply("portrait")).toBeNull()
    expect(consumePresetApply("landscape")).toEqual(preset)
    expect(consumePresetApply("landscape")).toBeNull()
  })
})
