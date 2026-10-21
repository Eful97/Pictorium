import { describe, expect, it, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest"
import {
  parseSingleStreamQuality,
  parseStreamQualityFromStreams,
  extractRawQualityTokens,
} from "@/lib/stream-quality"

describe("parseStreamQualityFromStreams", () => {
  it("returns null for empty array or invalid inputs", () => {
    expect(parseStreamQualityFromStreams([])).toBeNull()
  })

  it("identifies 4K / 2160p streams", () => {
    const streams = [
      { name: "Torrentio\n1080p", title: "Movie.1080p.BluRay" },
      { name: "Torrentio\n4k", title: "Movie.2160p.UHD.Remux" },
    ]
    expect(parseStreamQualityFromStreams(streams)).toBe("4K")
  })

  it("identifies FHD streams when no 4K is present", () => {
    const streams = [
      { name: "Torrentio\n720p", title: "Movie.720p.HD" },
      { name: "Torrentio\n1080p", title: "Movie.1080p.BluRay.x264" },
    ]
    expect(parseStreamQualityFromStreams(streams)).toBe("FHD")
  })

  it("identifies HD streams", () => {
    const streams = [
      { name: "Torrentio\n720p", title: "Movie.720p.HDTV" },
    ]
    expect(parseStreamQualityFromStreams(streams)).toBe("HD")
  })

  it("identifies SD streams", () => {
    const streams = [
      { name: "Torrentio\nSD", title: "Movie.480p.DVDRip" },
    ]
    expect(parseStreamQualityFromStreams(streams)).toBe("SD")
  })
})

describe("resolveStreamQuality", () => {
  // Runtime chain is local-DB-first (poster route) + live JustWatch ONLY.
  // The legacy "torrentio" config value is normalized to JustWatch and must
  // NEVER trigger a live Torrentio fetch — Torrentio feeds only the offline
  // DB import scripts.
  let jw: typeof import("@/lib/stream-quality")
  beforeAll(async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_QUALITY_SOURCE", "torrentio")
    // Even with a legacy Torrentio base configured, runtime must not call it.
    vi.stubEnv("PICTORIUM_TORRENTIO_URL", "https://torrentio.strem.fun")
    vi.stubEnv("TORRENTIO_URL", "https://torrentio.strem.fun")
    jw = await import("@/lib/stream-quality")
  })
  afterAll(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })
  beforeEach(async () => {
    jw.__resetStreamQualityCache()
    // Anche la cache interna JW (keyed per tmdbId) va svuotata: i test
    // riusano tmdbId vicini con body mock diversi per test.
    const { __resetJWRankingsCache } = await import("@/lib/justwatch")
    __resetJWRankingsCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const jwOffers = (tmdbId: number, presentationType = "HD") => ({
    data: {
      popularTitles: {
        edges: [
          {
            node: {
              content: { externalIds: { tmdbId } },
              offers: [{ presentationType }],
            },
          },
        ],
      },
    },
  })
  const jwMiss = {
    data: { popularTitles: { edges: [] } },
  }
  function mockJW(body: unknown) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("justwatch.com")) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      throw new Error(`unexpected fetch ${u}`)
    })
  }

  it("legacy torrentio config: zero Torrentio calls, JustWatch decides (4K)", async () => {
    const fetchSpy = mockJW(jwOffers(550, "4K"))

    const result = await jw.resolveStreamQuality("movie", "tt0499549", 550)
    expect(result.quality).toBe("4K")
    expect(result.status).toBe("resolved")
    expect(result.source).toBe("justwatch")
    // Legacy value normalized: no /stream/ (Torrentio) request at all…
    expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("/stream/"))).toBe(true)
    expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("torrentio"))).toBe(true)
    // …and one JW call only.
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("justwatch.com"))).toHaveLength(1)

    // Caching check: second call reuses the cache, zero new fetches.
    const cached = await jw.resolveStreamQuality("movie", "tt0499549", 550)
    expect(cached.quality).toBe("4K")
    expect(cached.status).toBe("resolved")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("returns resolved-null on genuine JustWatch miss (empty edges)", async () => {
    const fetchSpy = mockJW(jwMiss)
    const result = await jw.resolveStreamQuality("movie", "tt0111161", 550)
    expect(result.quality).toBeNull()
    expect(result.status).toBe("resolved")
    expect(result.source).toBe("justwatch")
    expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("/stream/"))).toBe(true)
  })

  it("no tmdbId: resolved-null without any network (no IMDb lookup)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    // Senza tmdbId: nessun fetch live (né JW né IMDb/external_ids), esito
    // negativo accertato — la catena locale (qQuality > av-specs.json) resta.
    const result = await jw.resolveStreamQuality("movie", "tt0111161")
    expect(result.quality).toBeNull()
    expect(result.status).toBe("resolved")
    expect(result.source).toBe("justwatch")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("returns timeout status when the caller signal aborts (render deadline)", async () => {
    const ctrl = new AbortController()
    ctrl.abort(new DOMException("The operation was aborted", "AbortError"))
    // Real fetch with an aborted signal rejects: the JW layer swallows it to
    // ok=false and resolveStreamQuality maps caller-abort to "timeout".
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if ((init as { signal?: AbortSignal })?.signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError")
      }
      throw new Error(`unexpected fetch ${String(_url)}`)
    })
    const result = await jw.resolveStreamQuality("movie", "tt0133093", 550, null, ctrl.signal)
    expect(result.quality).toBeNull()
    expect(result.status).toBe("timeout")
    expect(result.source).toBe("justwatch")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("bare fetch abort without caller abort is transport error (ephemeral)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new DOMException("The operation was aborted", "AbortError")
    )
    const result = await jw.resolveStreamQuality("movie", "tt0133093", 551)
    expect(result.quality).toBeNull()
    expect(result.status).toBe("error")
    expect(result.source).toBe("justwatch")
  })

  it("returns error status on HTTP 500", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("justwatch.com")) return new Response("boom", { status: 500 })
      throw new Error(`unexpected fetch ${u}`)
    })
    const result = await jw.resolveStreamQuality("movie", "tt0133093", 550)
    expect(result.quality).toBeNull()
    expect(result.status).toBe("error")
    expect(result.source).toBe("justwatch")
  })

  it("keeps error (not fake resolved) when JustWatch transport fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("justwatch.com")) return new Response("boom", { status: 500 })
      throw new Error(`unexpected fetch ${u}`)
    })
    const result = await jw.resolveStreamQuality("movie", "tt0133093", 550)
    expect(result.quality).toBeNull()
    // Non resolved: il composito userà TTL effimero invece di 6h.
    expect(result.status).not.toBe("resolved")
    expect(result.source).toBe("justwatch")
  })

  it("resolves full TTL on JustWatch FHD (quality certain, cached)", async () => {
    const fetchSpy = mockJW(jwOffers(552, "HD"))
    const result = await jw.resolveStreamQuality("movie", "tt0133093", 552)
    expect(result.quality).toBe("FHD")
    expect(result.source).toBe("justwatch")
    // Qualità accertata → resolved con TTL pieno: seconda chiamata riusa la cache.
    expect(result.status).toBe("resolved")
    const cached = await jw.resolveStreamQuality("movie", "tt0133093", 552)
    expect(cached.quality).toBe("FHD")
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("series: single JustWatch call, no S01/last-season Torrentio fetches", async () => {
    const fetchSpy = mockJW(jwOffers(1396, "4K"))
    const result = await jw.resolveStreamQuality("series", "tt0903747", 1396, null, undefined, 3)
    expect(result.quality).toBe("4K")
    expect(result.status).toBe("resolved")
    expect(result.source).toBe("justwatch")
    // Una sola chiamata JW, zero fetch stagionali Torrentio.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("/stream/"))).toBe(true)
  })

  it("series miss: timeout is ephemeral, zero extra season fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes("justwatch.com")) {
        throw new DOMException("The operation was aborted", "AbortError")
      }
      throw new Error(`unexpected fetch ${u}`)
    })
    const result = await jw.resolveStreamQuality("series", "tt0903747", 1396, null, undefined, 3)
    expect(result.quality).toBeNull()
    expect(result.status).not.toBe("resolved")
    // 1 sola chiamata JW, nessun fetch extra sull'ultima stagione.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe("parseSingleStreamQuality — falsi 4K e token attaccati", () => {
  it("1080p da sorgente UHD/4K Remaster → FHD, mai 4K", () => {
    expect(
      parseSingleStreamQuality({ name: "Torrentio\n1080p", title: "The.Godfather.1972.UHD.BluRay.1080p.REMUX" }),
    ).toBe("FHD")
    expect(
      parseSingleStreamQuality({ title: "Raiders.of.the.Lost.Ark.1080p.UHD.Bluray.x264" }),
    ).toBe("FHD")
    expect(parseSingleStreamQuality({ title: "Movie.2020.1080p.4K.Remaster.BluRay" })).toBe("FHD")
    expect(parseSingleStreamQuality({ title: "Movie.2020.1080p.Mastered.in.4K.BluRay" })).toBe("FHD")
    expect(
      parseSingleStreamQuality({
        name: "Torrentio\n1080p",
        title: "Movie.4K.Remaster",
        behaviorHints: { bingeGroup: "torrentio|1080p|..." },
      }),
    ).toBe("FHD")
  })

  it("token 4K attaccati → 4K", () => {
    expect(parseSingleStreamQuality({ title: "Movie.2024.4KHDR.x264" })).toBe("4K")
    expect(parseSingleStreamQuality({ title: "Movie.2024.4kDV.WEB-DL" })).toBe("4K")
    expect(parseSingleStreamQuality({ title: "Movie.2024.2160pHDR.WEB-DL" })).toBe("4K")
    expect(parseSingleStreamQuality({ title: "Movie.2024.4kHEVC.BluRay" })).toBe("4K")
    expect(parseSingleStreamQuality({ title: "Movie.2024.UHDRemux.2160p" })).toBe("4K")
    expect(parseSingleStreamQuality({ title: "Movie.2024.UHD4K.BluRay.2160p" })).toBe("4K")
  })

  it("genuino 4K restoration con 2160p resta 4K", () => {
    expect(parseSingleStreamQuality({ title: "Movie.1979.2160p.4K.Restoration.REMUX" })).toBe("4K")
  })

  it("max su multi-stream: un solo 4K basta", () => {
    expect(
      parseStreamQualityFromStreams([
        { name: "Torrentio\n1080p", title: "Movie.1080p.BluRay" },
        { title: "Movie.2024.4KHDR.x264" },
      ]),
    ).toBe("4K")
  })

  it("extractRawQualityTokens cattura i token attaccati", () => {
    const tokens = extractRawQualityTokens([{ title: "Movie.2024.4KHDR.x264" }])
    expect(tokens).toContain("4k")
  })
})

describe("QUALITY_SOURCE + regione JW (v1.23.0)", () => {
  const jwFhd = (tmdbId: number) => ({
    data: {
      popularTitles: {
        edges: [{ node: { content: { externalIds: { tmdbId } }, offers: [{ presentationType: "HD" }] } }],
      },
    },
  })

  it("none: nessun provider, resolved-null, zero fetch", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_QUALITY_SOURCE", "none")
    try {
      const mod = await import("@/lib/stream-quality")
      const fetchSpy = vi.spyOn(globalThis, "fetch")
      const r = await mod.resolveStreamQuality("movie", "tt0111161", 550, "Test")
      expect(r).toMatchObject({ quality: null, status: "resolved", source: "none" })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it("default (unset): JustWatch-only, zero Torrentio calls", async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    delete process.env.PICTORIUM_QUALITY_SOURCE
    delete process.env.POSTERIUM_QUALITY_SOURCE
    try {
      const mod = await import("@/lib/stream-quality")
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        const u = String(url)
        if (u.includes("justwatch.com")) {
          return new Response(JSON.stringify(jwFhd(550)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        throw new Error(`unexpected fetch ${u} ${String((init as { body?: unknown })?.body)}`)
      })
      const r = await mod.resolveStreamQuality("movie", "tt0133093", 550, "Test")
      expect(r).toMatchObject({ quality: "FHD", status: "resolved", source: "justwatch" })
      // Default = no Torrentio: no calls to /stream/ endpoints.
      expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("/stream/"))).toBe(true)
    } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it("justwatch: salta Torrentio e passa la regione della richiesta", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_QUALITY_SOURCE", "justwatch")
    try {
      const mod = await import("@/lib/stream-quality")
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        const u = String(url)
        if (u.includes("justwatch.com")) {
          return new Response(JSON.stringify(jwFhd(550)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        throw new Error(`unexpected fetch ${u} ${String((init as { body?: unknown })?.body)}`)
      })
      const r = await mod.resolveStreamQuality("movie", "tt0133093", 550, "Test", undefined, null, "US")
      expect(r).toMatchObject({ quality: "FHD", status: "resolved", source: "justwatch" })
      // Zero chiamate Torrentio…
      expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("torrentio"))).toBe(true)
      // …e la query JW porta il paese richiesto nel body.
      const jwCall = fetchSpy.mock.calls.find(([u]) => String(u).includes("justwatch.com"))
      expect(jwCall).toBeDefined()
      expect(String((jwCall![1] as { body?: unknown })?.body)).toContain('"country":"US"')
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it("unknown value: normalized to justwatch, zero Torrentio, one-time warning", async () => {
    vi.resetModules()
    vi.stubEnv("PICTORIUM_QUALITY_SOURCE", "bogus-source")
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const mod = await import("@/lib/stream-quality")
      // One-time module-level warning describing the safe fallback.
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toContain('normalized to "justwatch"')
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        const u = String(url)
        if (u.includes("justwatch.com")) {
          return new Response(JSON.stringify(jwFhd(550)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        throw new Error(`unexpected fetch ${u}`)
      })
      const r = await mod.resolveStreamQuality("movie", "tt0133093", 550, "Test")
      expect(r).toMatchObject({ quality: "FHD", status: "resolved", source: "justwatch" })
      // Fallback is JustWatch-only: zero Torrentio calls.
      expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("torrentio"))).toBe(true)
      expect(fetchSpy.mock.calls.every(([u]) => !String(u).includes("/stream/"))).toBe(true)
    } finally {
      warnSpy.mockRestore()
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
