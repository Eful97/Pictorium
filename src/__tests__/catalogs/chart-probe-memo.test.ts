import { afterEach, describe, expect, it, vi } from "vitest"

// Probe memo is off under NODE_ENV=test (suites pin strict revalidation):
// load a fresh module copy with it on.
describe("pinChartFamily probe memo", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it("coalesces concurrent probes and re-probes after the window", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.resetModules()
    const m = await import("@/lib/chart-generation")
    m.__resetChartGenerationForTest()
    let probes = 0
    m.__setChartGenerationPersistForTest({
      ...m.__inMemoryChartGenerationPersist(),
      async loadPublishedToken() { probes++; return "t1" },
    })
    const input = { regionCode: "IT", regionLang: "it-IT", family: "jw:movie:charts" }
    let now = 1_000_000
    vi.spyOn(Date, "now").mockImplementation(() => now)

    await Promise.all(Array.from({ length: 20 }, () => m.pinChartFamily(input)))
    expect(probes).toBe(1)

    now += 1001
    await m.pinChartFamily(input)
    expect(probes).toBe(2)
    m.__setChartGenerationPersistForTest(null)
  })
})
