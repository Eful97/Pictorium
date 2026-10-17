import { afterEach, describe, expect, it, vi } from "vitest"
import {
  parseMinQuality,
  isQualityAtLeast,
  applyMinQuality,
} from "@/lib/quality-tiers"
import { resolvePosterRenderConfig } from "@/lib/poster-config"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"

function torrentioFetch(_url: string | URL | Request) {
  return {
    ok: true,
    json: async () => ({ streams: [{ name: "Tracker | 1080p WEB-DL" }] }),
  }
}

describe("qmin — soglia minima qualità streaming", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("parseMinQuality valida i 4 tier (case-insensitive) e rifiuta il resto", () => {
    expect(parseMinQuality("4K")).toBe("4K")
    expect(parseMinQuality("fhd")).toBe("FHD")
    expect(parseMinQuality(" HD ")).toBe("HD")
    expect(parseMinQuality("sd")).toBe("SD")
    expect(parseMinQuality("8K")).toBeNull()
    expect(parseMinQuality("")).toBeNull()
    expect(parseMinQuality(null)).toBeNull()
    expect(parseMinQuality(undefined)).toBeNull()
  })

  it("applyMinQuality sopprime solo i tier sotto soglia (default SD = tutto mostrato)", () => {
    expect(applyMinQuality("FHD", "SD")).toBe("FHD")
    expect(applyMinQuality("FHD", null)).toBe("FHD")
    expect(applyMinQuality("FHD", undefined)).toBe("FHD")
    expect(applyMinQuality("FHD", "HD")).toBe("FHD")
    expect(applyMinQuality("FHD", "FHD")).toBe("FHD")
    expect(applyMinQuality("HD", "FHD")).toBeNull()
    expect(applyMinQuality("SD", "HD")).toBeNull()
    expect(applyMinQuality("4K", "4K")).toBe("4K")
    expect(applyMinQuality(null, "4K")).toBeNull()
  })

  it("isQualityAtLeast ordina SD < HD < FHD < 4K", () => {
    expect(isQualityAtLeast("SD", "SD")).toBe(true)
    expect(isQualityAtLeast("HD", "SD")).toBe(true)
    expect(isQualityAtLeast("SD", "HD")).toBe(false)
    expect(isQualityAtLeast("4K", "FHD")).toBe(true)
    expect(isQualityAtLeast(null, "SD")).toBe(false)
    expect(isQualityAtLeast("FHD", null)).toBe(true)
  })

  it("niente cache pollution: la cache tiene il raw, il filtro è solo all'uscita", async () => {
    // Legacy Torrentio chain pinned (backwards-compatible opt-in),
    // independent of the runtime default (justwatch).
    vi.resetModules()
    vi.stubEnv("PICTORIUM_QUALITY_SOURCE", "torrentio")
    const tio = await import("@/lib/stream-quality")
    try {
      const fetchMock = vi.fn(torrentioFetch)
      vi.stubGlobal("fetch", fetchMock)

      // First request with qmin=4K: badge suppressed…
      const raw = (await tio.resolveStreamQuality("movie", "tt999")).quality
      expect(raw).toBe("FHD")
      expect(applyMinQuality(raw, "4K")).toBeNull()

      // …but the second request (qmin=SD) still sees FHD with ZERO new fetches.
      const raw2 = (await tio.resolveStreamQuality("movie", "tt999")).quality
      expect(raw2).toBe("FHD")
      expect(applyMinQuality(raw2, "SD")).toBe("FHD")
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it("poster-config: catena query > server defaults > SD", () => {
    const base = {
      mapping: null,
      configOverride: null,
      hasQuery: true,
      showBadges: true,
      rankingBadges: true,
      animeRank: null,
      rankingResult: null,
      finalRank: null,
    } as const
    const q = (s: string) => new URLSearchParams(s)

    expect(
      resolvePosterRenderConfig({ ...base, searchParams: q("qmin=HD"), sd: { minQuality: "4K" } }).minQuality,
    ).toBe("HD")
    expect(
      resolvePosterRenderConfig({ ...base, searchParams: q(""), sd: { minQuality: "FHD" } }).minQuality,
    ).toBe("FHD")
    expect(
      resolvePosterRenderConfig({ ...base, searchParams: q(""), sd: {} }).minQuality,
    ).toBe("SD")
    expect(
      resolvePosterRenderConfig({ ...base, searchParams: q("qmin=8K"), sd: {} }).minQuality,
    ).toBe("SD")
  })

  it("stremio params: qmin emesso solo quando non-SD (niente invalidazione cache di default)", () => {
    expect(buildStremioPosterSearchParams({ minQuality: "HD" }).get("qmin")).toBe("HD")
    expect(buildStremioPosterSearchParams({ minQuality: "SD" }).get("qmin")).toBeNull()
    expect(buildStremioPosterSearchParams({}).get("qmin")).toBeNull()
  })
})
