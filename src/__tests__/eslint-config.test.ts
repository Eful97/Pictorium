import { beforeAll, describe, expect, it } from "vitest"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { ESLint } from "eslint"

// Guardia di regressione per la configurazione ESLint:
// `npm run lint` deve restare verde in locale anche dopo i test E2E,
// che generano artefatti di build in `.next-e2e` (distDir di playwright) e
// in `.next-e2e-auth` (distDir isolato di playwright.preset-auth.config.ts,
// NEXT_DIST_DIR ".next-e2e-auth" — stesso pattern di .next-e2e).
// Senza gli ignore qui sotto, eslint lintava quei file generati e falliva
// con centinaia di errori (require() style import, @ts-ignore, ...).
//
// Measured cold cost: the first `isPathIgnored` loads the whole flat config
// (eslint-config-next + `next/dist/compiled/babel`) - roughly 0.9s in an
// isolated Node process - and it is a FIXED startup cost, not logical test
// work. Under the default Vitest pool (11 workers on 12 CPU, 496 files) that
// fixed cost is amplified by contention: measured 1.0s isolated -> 2.0s
// (32 files) -> 22.3s (40 heaviest files, this file first) -> 37.2s in the full
// gate (496 files), where it blew the previous 30s cap. The bound below is 3.2x
// the worst value observed at the full gate: not an arbitrary raise, it covers
// a known fixed cost with the contention multiplier measured at the real worst
// case.
//
// Shared ESLint instance: the resolved config is cached per process, but every
// `new ESLint({})` repeats its own setup (measured: the second isPathIgnored
// still costs ~323ms under contention). A single instance keeps every assertion
// intact while removing that repeated work under the pool.
const ESLINT_TEST_TIMEOUT = 120_000

describe("eslint config", () => {
  // Single instance shared by the three tests: the flat config is resolved once
  // per process instead of once per test.
  let sharedEslint: ESLint
  beforeAll(() => {
    sharedEslint = new ESLint({})
  })

  it("ignores generated build dirs (.next, .next-e2e, .next-e2e-auth, .next-verify)", async () => {
    const eslint = sharedEslint
    for (const file of [".next/dev/build/probe.js", ".next-e2e/dev/build/probe.js", ".next-e2e-auth/dev/build/probe.js", ".next-verify/dev/build/probe.js"]) {
      expect(await eslint.isPathIgnored(file), `${file} should be ignored`).toBe(true)
    }
  }, ESLINT_TEST_TIMEOUT)

  it("does not ignore real source files", async () => {
    const eslint = sharedEslint
    expect(await eslint.isPathIgnored("src/app/layout.tsx")).toBe(false)
  }, ESLINT_TEST_TIMEOUT)

  it("lints clean even when a generated artifact with lint errors sits in .next-e2e", async () => {
    const probeDir = path.join(".next-e2e", "dev", "build")
    const probe = path.join(probeDir, "eslint-guard-probe.js")
    await mkdir(probeDir, { recursive: true })
    // Same patterns that used to break the lint: require() + @ts-ignore
    await writeFile(probe, "const x = require('x')\n// @ts-ignore\nmodule.exports = x\n")
    try {
      const eslint = sharedEslint
      const [result] = await eslint.lintFiles(probe)
      expect(result.errorCount).toBe(0)
    } finally {
      // Removes ONLY this test's probe file. `.next-e2e/dev/build` already
      // exists: the mkdir above created it, so the distDir is left in place.
      await rm(probe, { force: true })
    }
  }, ESLINT_TEST_TIMEOUT)

  it("lints clean even when a generated artifact with lint errors sits in .next-e2e-auth", async () => {
    const probeDir = path.join(".next-e2e-auth", "dev", "build")
    const probe = path.join(probeDir, "eslint-guard-probe.js")
    await mkdir(probeDir, { recursive: true })
    // Same patterns that used to break the lint: require() + @ts-ignore
    await writeFile(probe, "const x = require('x')\n// @ts-ignore\nmodule.exports = x\n")
    try {
      const eslint = sharedEslint
      const [result] = await eslint.lintFiles(probe)
      expect(result.errorCount).toBe(0)
    } finally {
      // Removes ONLY this test's probe file. `.next-e2e-auth/dev/build` already
      // exists: the mkdir above created it, so the distDir is left in place.
      await rm(probe, { force: true })
    }
  }, ESLINT_TEST_TIMEOUT)

  it("lints clean even when a generated artifact with lint errors sits in .next-verify", async () => {
    const probeDir = path.join(".next-verify", "dev", "build")
    // Unique probe name (repo mkdtemp-style uniqueness, see anime-id-map
    // generator tests): never overwrite or delete a pre-existing user file
    // that happens to share this directory. Only the exact path created
    // below is ever removed; a collision aborts loudly instead of clobbering.
    const probe = path.join(probeDir, `eslint-guard-probe-${process.pid}.js`)
    if (existsSync(probe)) throw new Error(`refusing to overwrite pre-existing file: ${probe}`)
    await mkdir(probeDir, { recursive: true })
    // Same patterns that used to break the lint: require() + @ts-ignore
    await writeFile(probe, "const x = require('x')\n// @ts-ignore\nmodule.exports = x\n")
    try {
      const eslint = sharedEslint
      const [result] = await eslint.lintFiles(probe)
      expect(result.errorCount).toBe(0)
    } finally {
      // Removes ONLY this test's probe file (created above, unique per
      // process). The `.next-verify/dev/build` directory itself is left in
      // place, like the real distDir output.
      await rm(probe, { force: true })
    }
  }, ESLINT_TEST_TIMEOUT)
})
