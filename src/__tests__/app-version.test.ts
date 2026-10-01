import { describe, expect, it } from "vitest"
import { APP_COMMIT, APP_VERSION } from "@/generated/app-version"

describe("app version", () => {
  it("tracks the latest vX.Y.Z tag (package.json fallback without tags/git)", () => {
    expect(/^\d+\.\d+\.\d+$/.test(APP_VERSION)).toBe(true)
  })

  it("exposes the running commit SHA (or unknown without git)", () => {
    // Widen: il generato esporta un literal type (lo SHA del momento in cui
    // è stato generato), il confronto diretto col fallback fallirebbe il typecheck.
    const commit: string = APP_COMMIT
    expect(commit === "unknown" || /^[0-9a-f]{4,40}$/i.test(commit)).toBe(true)
  })
})
