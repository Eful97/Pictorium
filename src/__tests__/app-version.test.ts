import { describe, expect, it } from "vitest"
import packageJson from "../../package.json"
import { APP_COMMIT, APP_VERSION } from "@/generated/app-version"

describe("app version", () => {
  it("derives from package.json major.minor with commit-count patch (auto version)", () => {
    const [major, minor] = packageJson.version.split(".")
    expect(APP_VERSION.startsWith(`${major}.${minor}.`)).toBe(true)
    // When git is unavailable version equals package.json, otherwise patch is numeric commit count
    if (APP_VERSION !== packageJson.version) {
      const patch = APP_VERSION.split(".")[2]
      expect(/^\d+$/.test(patch)).toBe(true)
    }
  })

  it("exposes the running commit SHA (or unknown without git)", () => {
    // Widen: il generato esporta un literal type (lo SHA del momento in cui
    // è stato generato), il confronto diretto col fallback fallirebbe il typecheck.
    const commit: string = APP_COMMIT
    expect(commit === "unknown" || /^[0-9a-f]{4,40}$/i.test(commit)).toBe(true)
  })
})
