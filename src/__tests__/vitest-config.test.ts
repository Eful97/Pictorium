import { describe, expect, it } from "vitest"

// Guards the vitest collection scope against generated build output: the
// standalone build (NEXT_DIST_DIR ".next-verify") copies the whole app,
// e2e specs included, and vitest collected them as repo suites (Playwright
// APIs fail at collection: `test.beforeEach() called here`). Generated
// output is never canonical tests, so every known build-output dir must be
// covered by `test.exclude` — while real suites keep getting collected.
import config from "../../vitest.config"

const exclude = (config as unknown as { test?: { exclude?: unknown } }).test?.exclude

// Only the repo's own glob conventions (see vitest.config.ts): `dir/**`
// prefix matches and `**/x` contains matches. Anything else fails loudly so
// the matcher below is extended deliberately, never silently permissive.
function covers(pattern: string, sample: string): boolean {
  if (pattern.endsWith("/**")) {
    const base = pattern.slice(0, -3)
    return sample === base || sample.startsWith(base + "/")
  }
  if (pattern.startsWith("**/")) {
    const rest = pattern.slice(3)
    if (rest.endsWith("/**")) {
      return sample.split("/").includes(rest.slice(0, -3))
    }
    return sample === rest || sample.endsWith("/" + rest)
  }
  if (!pattern.includes("*")) return sample === pattern
  throw new Error(`unsupported glob convention in vitest exclude: ${pattern} (update this test)`)
}

describe("vitest collection scope", () => {
  it("has a non-empty exclude list", () => {
    expect(Array.isArray(exclude) && exclude.length > 0).toBe(true)
  })

  it("excludes generated build output (never canonical tests)", () => {
    const patterns = (exclude as unknown[]).filter((p): p is string => typeof p === "string")
    // Proven pollution shape: standalone copies of the e2e specs plus
    // Next/Turbopack chunks must never be collected as suites.
    const generated = [
      ".next-verify/standalone/e2e/theme.spec.ts",
      ".next-verify/standalone/e2e/pictorium-streaming-catalogs.spec.ts",
      ".next-verify/static/chunks/0c44jgug7qywa.js",
      "e2e/pictorium-visual.spec.ts",
    ]
    for (const sample of generated) {
      expect(
        patterns.some((p) => covers(p, sample)),
        `${sample} must be excluded from vitest collection`,
      ).toBe(true)
    }
  })

  it("still collects real repo tests (no over-ignoring)", () => {
    const patterns = (exclude as unknown[]).filter((p): p is string => typeof p === "string")
    const real = [
      "src/__tests__/rendering/poster-fresh-layout.test.ts",
      "src/__tests__/auth-security/secure-poster-url.test.tsx",
      "src/__tests__/eslint-config.test.ts",
    ]
    for (const sample of real) {
      expect(
        patterns.some((p) => covers(p, sample)),
        `${sample} must stay collected`,
      ).toBe(false)
    }
  })
})
