import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  __clearTMDBCache,
  getDetails,
  getDetailsWithExternalIds,
  getFullDetails,
  getGenreList,
  getImages,
  getPopularMovies,
  getPopularTV,
  getTVEpisodeGroup,
  getTVSeason,
  personMovieCredits,
  personTvCredits,
  searchMovies,
  searchMulti,
  searchPerson,
  searchTV,
  toImageLanguages,
  toProviderLanguage,
} from "@/lib/tmdb"
import { logoBestLogoFallbackReason, selectBestLogo, selectLogoTier } from "@/lib/logo-selection"
import type { TMDBImage } from "@/lib/types"

/**
 * es-419 provider wiring: the UI-only locale must never reach TMDB.
 * Details/search/episode endpoints receive canonical es-MX, image
 * endpoints receive the ISO 639-1 base es, logo matching hits the es
 * tier. Every other locale/country passes through untouched and keeps
 * its own cache entries.
 */
function logo(iso: string | null, path: string): TMDBImage {
  return { file_path: path, iso_639_1: iso } as TMDBImage
}

async function requestedUrls(fn: () => Promise<unknown>): Promise<string[]> {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}) as Response)
  __clearTMDBCache()
  try {
    await fn()
  } catch {
    // Parse errors are irrelevant here: only the request URL is asserted.
  }
  const urls = spy.mock.calls.map((call) => String(call[0]))
  spy.mockRestore()
  return urls
}

describe("es-419 provider wiring", () => {
  beforeEach(() => {
    __clearTMDBCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("maps only the es-419 alias to canonical es-MX", () => {
    expect(toProviderLanguage("es-419")).toBe("es-MX")
    expect(toProviderLanguage("ES-419")).toBe("es-MX")
    for (const untouched of ["es", "es-MX", "es-ES", "it-IT", "fr", "en-US", "pt-BR"]) {
      expect(toProviderLanguage(untouched)).toBe(untouched)
    }
  })

  it("collapses only the Spanish tokens to es, preserving all others byte-identically", () => {
    expect(toImageLanguages("es-419,en,null")).toBe("es,en,null")
    expect(toImageLanguages("ES-419,en,null")).toBe("es,en,null")
    expect(toImageLanguages("es-MX,en,null")).toBe("es,en,null")
    expect(toImageLanguages("ES-mx,en,null")).toBe("es,en,null")
    // Restricted scope: every other token (including other full locales
    // and whitespace) is preserved byte-identically.
    for (const untouched of [
      "it,en,null",
      "en,null",
      "it-IT,en,null",
      "en-US,en,null",
      "fr-FR,en,null",
      "pt-BR,en,null",
      "es-419 ,en,null",
      " es,en,null",
    ]) {
      expect(toImageLanguages(untouched)).toBe(untouched)
    }
  })

  it("forwards es-419 details/search/episode calls as es-MX", async () => {
    for (const fn of [
      () => getDetails("movie", 550, "es-419", "k"),
      () => getDetailsWithExternalIds("movie", 550, "es-419", "k"),
      () => getFullDetails("tv", 1396, "es-419", "k"),
      () => getGenreList("movie", "es-419", "k"),
      () => searchMulti("club", "es-419", "k"),
      () => searchMovies("club", "es-419", "k"),
      () => searchTV("club", "es-419", "k"),
      () => searchPerson("brad", "es-419", "k"),
      () => personMovieCredits(1, "es-419", "k"),
      () => personTvCredits(1, "es-419", "k"),
      () => getTVSeason(1396, 1, "es-419", "k"),
      () => getTVEpisodeGroup("group1", "es-419", "k"),
    ]) {
      const urls = await requestedUrls(fn)
      expect(urls.length).toBeGreaterThan(0)
      for (const url of urls) {
        expect(url).toContain("language=es-MX")
        expect(url).not.toContain("es-419")
      }
    }
  })

  it("leaves every other locale untouched (no contract change)", async () => {
    const es = await requestedUrls(() => getDetails("movie", 550, "es", "k"))
    expect(es[0]).toContain("language=es")
    const esMx = await requestedUrls(() => getDetails("movie", 550, "es-MX", "k"))
    expect(esMx[0]).toContain("language=es-MX")
    const it = await requestedUrls(() => getDetails("movie", 550, "it-IT", "k"))
    expect(it[0]).toContain("language=it-IT")
    const imgs = await requestedUrls(() => getImages("movie", 550, "it,en,null", "k"))
    expect(imgs[0]).toContain("include_image_language=it%2Cen%2Cnull")
    // Other full locales pass through byte-identically in both endpoints.
    const fr = await requestedUrls(() => getDetails("movie", 550, "fr-FR", "k"))
    expect(fr[0]).toContain("language=fr-FR")
    const frImgs = await requestedUrls(() => getImages("movie", 550, "fr-FR,en,null", "k"))
    expect(frImgs[0]).toContain("include_image_language=fr-FR%2Cen%2Cnull")
  })

  it("maps es-419 in popular endpoints too, keeping region=IT", async () => {
    const movies = await requestedUrls(() => getPopularMovies(1, "es-419", "k"))
    expect(movies[0]).toContain("language=es-MX")
    expect(movies[0]).toContain("region=IT")
    expect(movies[0]).not.toContain("es-419")
    const tv = await requestedUrls(() => getPopularTV(1, "ES-419", "k"))
    expect(tv[0]).toContain("language=es-MX")
    expect(tv[0]).toContain("region=IT")
    const upper = await requestedUrls(() => getDetails("movie", 550, "ES-419", "k"))
    expect(upper[0]).toContain("language=es-MX")
  })

  it("requests images with the ISO 639-1 base, keeping en/null fallback", async () => {
    const urls = await requestedUrls(() => getImages("movie", 550, "es-419,en,null", "k"))
    expect(urls[0]).toContain("include_image_language=es%2Cen%2Cnull")
    expect(urls[0]).not.toContain("es-419")
  })

  it("shares provider cache between es-419 and es-MX, keeps es separate", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({}) as Response)
    __clearTMDBCache()
    try {
      await getDetails("movie", 550, "es-419", "k").catch(() => null)
      await getDetails("movie", 550, "es-MX", "k").catch(() => null)
      // Same normalized provider URL: one network call, shared entry.
      expect(spy).toHaveBeenCalledTimes(1)
      await getDetails("movie", 550, "es", "k").catch(() => null)
      // Different provider locale: its own entry.
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })

  it("matches logos on the es tier for the Spanish aliases, preserving previous behavior otherwise", () => {
    const logos = [logo("es", "/es.png"), logo("en", "/en.png"), logo("fr", "/fr.png")]
    expect(selectBestLogo(logos, "es-419")?.file_path).toBe("/es.png")
    expect(selectBestLogo(logos, "ES-419")?.file_path).toBe("/es.png")
    expect(selectBestLogo(logos, "es-MX")?.file_path).toBe("/es.png")
    expect(selectBestLogo(logos, "es")?.file_path).toBe("/es.png")
    expect(logoBestLogoFallbackReason(logo("es", "/es.png"), "es-419")).toBeNull()
    expect(logoBestLogoFallbackReason(logo("es", "/es.png"), "es-MX")).toBeNull()
    // No es tier: unchanged fallback to en, then original, then any.
    const noEs = [logo("en", "/en.png"), logo("fr", "/fr.png")]
    expect(selectBestLogo(noEs, "es-419")?.file_path).toBe("/en.png")
    expect(selectLogoTier(noEs, "es-419", "fr").map((l) => l.file_path)).toEqual(["/en.png"])
    expect(selectLogoTier([logo("fr", "/fr.png")], "es-419", "fr").map((l) => l.file_path)).toEqual(["/fr.png"])
    expect(selectLogoTier([], "es-419", "es")).toEqual([])
    // Restricted scope: other full locales keep the previous behavior
    // (no base tier, no base-exact reason).
    const frLogos = [logo("fr", "/fr.png"), logo("en", "/en.png")]
    expect(selectBestLogo(frLogos, "fr-FR")?.file_path).toBe("/en.png")
    expect(logoBestLogoFallbackReason(logo("fr", "/fr.png"), "fr-FR")).toBe("any")
    expect(selectBestLogo(logos, "pt-BR")?.file_path).toBe("/en.png")
  })
})
