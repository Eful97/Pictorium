import { describe, it, expect } from "vitest"
import { computeBadge, computeAbsoluteCinema, getAllBadgeOptions } from "@/lib/badge-priority"
import { computeTopBadge, getNewSeasonLabel, isKDramaOrigin, resolveSavedBadgeExtra } from "@/lib/poster-badge"
import { getUpcomingReleaseLabel, parseDateFormat } from "@/lib/release-badge"
import { mappingSchema } from "@/lib/validation"
import { createT } from "@/lib/i18n"

const t = createT("it")

describe("computeBadge", () => {
  const base = {
    mediaType: "movie" as const,
    upcomingRelease: null,
    isNewMovie: false, isNewSeries: false,
    animeRank: null, trendRank: null,
    award: null, nomination: null,
    studio: null, director: null, extra: null,
  }

  it("prioritizes upcoming release over new movie", () => {
    const badge = computeBadge({
      ...base,
      upcomingRelease: "In uscita 18.12.26",
      isNewMovie: true,
    }, t)
    expect(badge).toEqual({ type: "extra", label: "In uscita 18.12.26" })
  })

  it("prioritizes upcoming release over trend", () => {
    const badge = computeBadge({
      ...base,
      upcomingRelease: "In uscita 18.12.26",
      trendRank: 1,
    })
    expect(badge).toEqual({ type: "extra", label: "In uscita 18.12.26" })
  })

  it("prioritizes new movie over everything else", () => {
    expect(computeBadge({ ...base, isNewMovie: true, award: "Vincitore Oscar" }, t)?.label).toBe("Nuovo film")
  })

  it("prioritizes new series over award", () => {
    expect(computeBadge({ ...base, isNewSeries: true, award: "Vincitore Oscar" }, t)?.label).toBe("Nuova serie")
  })

  it("prioritizes anime rank over trend rank", () => {
    expect(computeBadge({ ...base, animeRank: 5, trendRank: 10 }, t)?.type).toBe("rank")
    expect(computeBadge({ ...base, animeRank: 5, trendRank: 10 }, t)?.rank).toBe(5)
    expect(computeBadge({ ...base, animeRank: 5, trendRank: 10 }, t)?.label).toBe("Anime")
  })

  it("caps anime rank badge at top 20 (rank 21+ falls through)", () => {
    expect(computeBadge({ ...base, animeRank: 20 }, t)?.rank).toBe(20)
    // Oltre la Top 20 niente badge rank: cade al bucket successivo (qui trend).
    expect(computeBadge({ ...base, animeRank: 21, trendRank: 3 }, t)?.rank).toBe(3)
    expect(computeBadge({ ...base, animeRank: 50 }, t)).toBeNull()
  })

  it("prioritizes trend rank over award", () => {
    expect(computeBadge({ ...base, trendRank: 3, award: "Vincitore Oscar" }, t)?.type).toBe("rank")
    expect(computeBadge({ ...base, trendRank: 3 }, t)?.rank).toBe(3)
    // Label del rank: il periodo della chart ("Oggi") per entrambi i media type
    expect(computeBadge({ ...base, trendRank: 3 }, t)?.label).toBe("Oggi")
    expect(computeBadge({ ...base, mediaType: "tv", trendRank: 3 }, t)?.label).toBe("Oggi")
    // Il nastro mostra il periodo ("Oggi", anche per gli anime), non la label per media type
    expect(computeBadge({ ...base, trendRank: 3 }, t)?.ribbonLabel).toBe("Oggi")
    expect(computeBadge({ ...base, mediaType: "tv", trendRank: 3 }, t)?.ribbonLabel).toBe("Oggi")
    expect(computeBadge({ ...base, animeRank: 5 }, t)?.ribbonLabel).toBe("Oggi")
  })

  it("prioritizes nomination over subgenre", () => {
    expect(computeBadge({ ...base, nomination: "Candidato Oscar", subGenre: "Viaggi nel Tempo" }, t)?.label).toBe("Candidato Oscar")
  })

  it("prioritizes subgenre over director", () => {
    expect(computeBadge({ ...base, subGenre: "Viaggi nel Tempo", director: "Di Christopher Nolan" }, t)?.label).toBe("Viaggi nel Tempo")
  })

  it("prioritizes imdbTop250 before generic extra", () => {
    expect(computeBadge({ ...base, imdbTop250: true, extra: "Da divorare" }, t)?.label).toBe("Absolute Cinema")
  })

  it("award beats imdbTop250 in priority (original hierarchy)", () => {
    expect(computeBadge({ ...base, imdbTop250: true, award: "Vincitore Oscar" }, t)?.label).toBe("Vincitore Oscar")
  })

  it("imdbTop250 beats nomination in priority", () => {
    expect(computeBadge({ ...base, imdbTop250: true, nomination: "Candidato Oscar" }, t)?.label).toBe("Absolute Cinema")
  })

  it("does not show imdbTop250 for TV", () => {
    // The imdbTop250 flag works for both media types, but IMDb chart is movie-only
    const badge = computeBadge({ ...base, imdbTop250: true }, t)
    expect(badge?.label).toBe("Absolute Cinema")
  })

  it("falls back to extra when nothing else matches", () => {
    expect(computeBadge({ ...base, extra: "Da divorare" }, t)?.label).toBe("Da divorare")
  })

  it("returns null when nothing matches", () => {
    expect(computeBadge({ ...base }, t)).toBeNull()
  })

  it("returns key when no t function provided", () => {
    expect(computeBadge({ ...base, isNewMovie: true })?.label).toBe("badge.newMovie")
  })

  it("prioritizes new season over award (dopo nuova serie)", () => {
    expect(computeBadge({ ...base, newSeason: "Nuova stagione S2", award: "Vincitore Oscar" }, t)?.label).toBe("Nuova stagione S2")
  })

  it("prioritizes new series over new season", () => {
    expect(computeBadge({ ...base, isNewSeries: true, newSeason: "Nuova stagione S2" }, t)?.label).toBe("Nuova serie")
  })

  it("prioritizes subgenre over kdrama, kdrama over director and studio", () => {
    expect(computeBadge({ ...base, subGenre: "Giallo", isKDrama: true }, t)?.label).toBe("Giallo")
    expect(computeBadge({ ...base, isKDrama: true, director: "Di Christopher Nolan" }, t)?.label).toBe("K-Drama")
    expect(computeBadge({ ...base, isKDrama: true, studio: "A24" }, t)?.label).toBe("K-Drama")
  })

  it("auto miniseries/returning in coda all'extra", () => {
    const tv = { ...base, mediaType: "tv" as const }
    expect(computeBadge({ ...tv, miniseries: "Miniserie" }, t)?.label).toBe("Miniserie")
    expect(computeBadge({ ...tv, returning: "Ritorna" }, t)?.label).toBe("Ritorna")
    // Una sola placca: miniserie vince su returning.
    expect(computeBadge({ ...tv, miniseries: "Miniserie", returning: "Ritorna" }, t)?.label).toBe("Miniserie")
    // Coda confermata: tutto ciò che sta sopra vince.
    expect(computeBadge({ ...tv, award: "Vincitore Oscar", returning: "Ritorna" }, t)?.label).toBe("Vincitore Oscar")
    expect(computeBadge({ ...tv, director: "Di Christopher Nolan", returning: "Ritorna" }, t)?.label).toBe("Di Christopher Nolan")
    expect(computeBadge({ ...tv, studio: "A24", miniseries: "Miniserie" }, t)?.label).toBe("A24")
    expect(computeBadge({ ...tv, returning: "Ritorna", extra: "Da divorare" }, t)?.label).toBe("Ritorna")
  })

  it("sash senza extra spegne miniseries/returning (opt-out rispettato)", () => {
    const tv = { ...base, mediaType: "tv" as const, returning: "Ritorna", miniseries: "Miniserie" }
    expect(computeBadge(tv, t, ["upcoming", "rank", "new", "award"])).toBeNull()
  })
})

describe("computeAbsoluteCinema (replaces old computeExtraFallback)", () => {
  it("returns Absolute Cinema for movies in IMDb Top 250", () => {
    expect(computeAbsoluteCinema({ mediaType: "movie", imdbTop250: true }, t)).toBe("Absolute Cinema")
  })

  it("returns null for movies NOT in IMDb Top 250", () => {
    expect(computeAbsoluteCinema({ mediaType: "movie", imdbTop250: false }, t)).toBeNull()
  })

  it("returns null for TV even if imdbTop250 is true (chart is movie-only)", () => {
    expect(computeAbsoluteCinema({ mediaType: "tv", imdbTop250: true }, t)).toBeNull()
  })

  it("returns key when no t function provided", () => {
    expect(computeAbsoluteCinema({ mediaType: "movie", imdbTop250: true })).toBe("badge.absoluteCinema")
  })
})

describe("mappingSchema", () => {
  it("validates a correct mapping", () => {
    const result = mappingSchema.safeParse({
      tmdbId: 12345,
      mediaType: "movie",
      title: "Test Movie",
      posterPath: "/abc.jpg",
    })
    expect(result.success).toBe(true)
  })

  it("rejects missing required fields", () => {
    const result = mappingSchema.safeParse({ tmdbId: 12345 })
    expect(result.success).toBe(false)
  })

  it("rejects invalid mediaType", () => {
    const result = mappingSchema.safeParse({
      tmdbId: 12345,
      mediaType: "invalid",
      title: "Test",
      posterPath: "/abc.jpg",
    })
    expect(result.success).toBe(false)
  })

  it("accepts optional fields", () => {
    const result = mappingSchema.safeParse({
      tmdbId: 12345,
      mediaType: "tv",
      title: "Test Series",
      posterPath: "/def.jpg",
      genreName: "Drama",
      voteAverage: 8.5,
      trendRank: 3,
      logoPath: "/logo.png",
      logoScale: 75,
      badgeExtra: "Vincitore Emmy",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.genreName).toBe("Drama")
      expect(result.data.voteAverage).toBe(8.5)
      expect(result.data.trendRank).toBe(3)
    }
  })

  it("accepts wikidataId and rejects garbage QIDs", () => {
    const base = { tmdbId: 1405, mediaType: "tv", title: "Dexter", posterPath: "/d.jpg" }
    const ok = mappingSchema.safeParse({ ...base, wikidataId: "Q23577" })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.wikidataId).toBe("Q23577")
    // Mapping vecchi senza campo: restano validi (SPARQL-fallback).
    expect(mappingSchema.safeParse(base).success).toBe(true)
    expect(mappingSchema.safeParse({ ...base, wikidataId: "nope" }).success).toBe(false)
  })

  it("preserves landscape tintStrength/topShade (no Zod strip)", () => {
    const base = { tmdbId: 1405, mediaType: "tv", title: "Dexter", posterPath: "/d.jpg" }
    const r = mappingSchema.safeParse({
      ...base,
      landscape: { gradientHeight: 20, blurFade: 70, tintStrength: 80, topShade: 10 },
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.landscape?.tintStrength).toBe(80)
      expect(r.data.landscape?.topShade).toBe(10)
    }
  })
})

describe("getUpcomingReleaseLabel", () => {
  it("returns formatted date for future movie", () => {
    expect(getUpcomingReleaseLabel({
      mediaType: "movie",
      releaseDate: "2099-12-18",
      locale: "it",
    })).toBe("In uscita 18.12.99")
  })

  it("returns null for past release date", () => {
    expect(getUpcomingReleaseLabel({
      mediaType: "movie",
      releaseDate: "2020-01-01",
      locale: "it",
    })).toBeNull()
  })

  it("returns label for TV shows with future firstAirDate", () => {
    expect(getUpcomingReleaseLabel({
      mediaType: "tv",
      releaseDate: "2099-12-18",
      firstAirDate: "2099-12-18",
      locale: "it",
    })).toBe("In uscita 18.12.99")
  })

  it("returns null when no date provided", () => {
    expect(getUpcomingReleaseLabel({
      mediaType: "movie",
      locale: "it",
    })).toBeNull()
  })

  it("locale=en renders month-first (US order)", () => {
    // NB: setup.ts mocca i18n (label sempre italiana) — qui conta l'ordine della data.
    expect(getUpcomingReleaseLabel({
      mediaType: "movie",
      releaseDate: "2099-12-18",
      locale: "en",
      t: createT("en"),
    })).toMatch(/ 12\.18\.99$/)
  })

  it("dmy forces day-first regardless of locale", () => {
    expect(getUpcomingReleaseLabel({
      mediaType: "movie",
      releaseDate: "2099-12-18",
      locale: "en",
      dateFormat: "dmy",
      t: createT("en"),
    })).toMatch(/ 18\.12\.99$/)
  })

  it("mdy forces month-first regardless of locale", () => {
    const tIt = createT("it")
    expect(getUpcomingReleaseLabel({
      mediaType: "movie",
      releaseDate: "2099-12-18",
      locale: "it",
      dateFormat: "mdy",
      t: tIt,
    })).toBe("In uscita 12.18.99")
  })

  it("iso renders unambiguous YYYY-MM-DD", () => {
    expect(getUpcomingReleaseLabel({
      mediaType: "movie",
      releaseDate: "2099-12-18",
      locale: "ar",
      dateFormat: "iso",
      t: createT("ar"),
    })).toMatch(/^.+ 2099-12-18$/)
  })

  it("computeTopBadge honors dateFormat", () => {
    const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const base = {
      mediaType: "tv" as const,
      releaseDate: null,
      firstAirDate: inDays(30),
      lastAirDate: null as string | null,
      seasonCount: null as number | null,
      originCountries: [] as string[],
      voteAverage: 8,
      trendRank: null,
      animeRank: null,
      awards: [] as string[],
      nominations: [] as string[],
      studios: [] as string[],
      director: null,
      tvType: null,
      tvStatus: "Returning Series",
      keywords: [] as string[],
      imdbTop250: false,
    }
    const c = computeTopBadge(base, t, "it", null, "iso")
    expect(c.upcomingRelease).toMatch(/^In uscita \d{4}-\d{2}-\d{2}$/)
    expect(c.badge?.label).toBe(c.upcomingRelease)
  })
})

describe("parseDateFormat", () => {
  it("accepts the four known values", () => {
    expect(parseDateFormat("locale")).toBe("locale")
    expect(parseDateFormat("dmy")).toBe("dmy")
    expect(parseDateFormat("mdy")).toBe("mdy")
    expect(parseDateFormat("iso")).toBe("iso")
  })

  it("is fail-closed on unknown, empty or missing values", () => {
    expect(parseDateFormat("DD/MM/YYYY")).toBeNull()
    expect(parseDateFormat("")).toBeNull()
    expect(parseDateFormat(null)).toBeNull()
    expect(parseDateFormat(undefined)).toBeNull()
  })
})

describe("getNewSeasonLabel", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  it("returns numbered label for recent last air + old first air", () => {
    expect(getNewSeasonLabel({ lastAirDate: daysAgo(3), firstAirDate: daysAgo(400), seasonCount: 2, t })).toBe("Nuova S2")
  })

  it("returns generic label without season count", () => {
    expect(getNewSeasonLabel({ lastAirDate: daysAgo(3), firstAirDate: daysAgo(400), seasonCount: null, t })).toBe("Nuova stagione")
  })

  it("returns generic label for season 1 (no suffix)", () => {
    expect(getNewSeasonLabel({ lastAirDate: daysAgo(3), firstAirDate: daysAgo(400), seasonCount: 1, t })).toBe("Nuova stagione")
  })

  it("returns null for old last air date", () => {
    expect(getNewSeasonLabel({ lastAirDate: daysAgo(60), firstAirDate: daysAgo(400), seasonCount: 3, t })).toBeNull()
  })

  it("returns null for new series (è Nuova serie, non nuova stagione)", () => {
    expect(getNewSeasonLabel({ lastAirDate: daysAgo(3), firstAirDate: daysAgo(3), seasonCount: 1, t })).toBeNull()
  })

  it("returns null for future last air date", () => {
    expect(getNewSeasonLabel({ lastAirDate: inDays(5), firstAirDate: daysAgo(400), seasonCount: 2, t })).toBeNull()
  })

  it("returns null without last air date", () => {
    expect(getNewSeasonLabel({ lastAirDate: null, firstAirDate: daysAgo(400), seasonCount: 2, t })).toBeNull()
  })
})

describe("isKDramaOrigin", () => {
  it("matches KR case-insensitively", () => {
    expect(isKDramaOrigin(["KR"])).toBe(true)
    expect(isKDramaOrigin(["kr"])).toBe(true)
    expect(isKDramaOrigin(["US", "KR"])).toBe(true)
  })

  it("rejects non-KR origins", () => {
    expect(isKDramaOrigin(["US"])).toBe(false)
    expect(isKDramaOrigin([])).toBe(false)
    expect(isKDramaOrigin(null)).toBe(false)
    expect(isKDramaOrigin(undefined)).toBe(false)
  })
})

describe("computeTopBadge (nuovi badge)", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const baseInput = {
    mediaType: "tv" as const,
    releaseDate: null,
    firstAirDate: daysAgo(400),
    lastAirDate: null as string | null,
    seasonCount: null as number | null,
    originCountries: [] as string[],
    voteAverage: 8,
    trendRank: null,
    animeRank: null,
    awards: [] as string[],
    nominations: [] as string[],
    studios: [] as string[],
    director: null,
    tvType: null,
    tvStatus: "Returning Series",
    keywords: [] as string[],
    imdbTop250: false,
  }

  it("computes Nuova S3 for returning series with recent last air", () => {
    const c = computeTopBadge({ ...baseInput, lastAirDate: daysAgo(3), seasonCount: 3 }, t, "it")
    expect(c.newSeason).toBe("Nuova S3")
    expect(c.badge).toEqual({ type: "extra", label: "Nuova S3" })
  })

  it("computes K-Drama for KR origin without stronger badges", () => {
    const c = computeTopBadge({ ...baseInput, originCountries: ["KR"] }, t, "it")
    expect(c.badge).toEqual({ type: "extra", label: "K-Drama" })
  })

  it("computes upcoming release for tv with future first air", () => {
    const c = computeTopBadge({ ...baseInput, firstAirDate: inDays(30) }, t, "it")
    expect(c.upcomingRelease).toMatch(/^In uscita /)
    expect(c.badge?.label).toBe(c.upcomingRelease)
  })

  it("upcoming release wins over new season", () => {
    // Serie annunciata: first_air futura → upcoming, anche con last_air valorizzata
    const c = computeTopBadge({ ...baseInput, firstAirDate: inDays(30), lastAirDate: daysAgo(3), seasonCount: 2 }, t, "it")
    expect(c.badge?.label).toBe(c.upcomingRelease)
  })

  it("auto Ritorna per serie returning senza badge più forti", () => {
    // baseInput ha già tvStatus "Returning Series" e date vecchie: niente
    // upcoming/new/rank/award → cade nel returning.
    const c = computeTopBadge({ ...baseInput }, t, "it")
    expect(c.badge).toEqual({ type: "extra", label: "Ritorna" })
  })

  it("auto Miniserie per tvType miniseries, vince su returning", () => {
    const c = computeTopBadge({ ...baseInput, tvType: "Miniseries" }, t, "it")
    expect(c.badge).toEqual({ type: "extra", label: "Miniserie" })
  })

  it("mai miniseries/returning sui film (guardia mediaType)", () => {
    const c = computeTopBadge({ ...baseInput, mediaType: "movie", tvType: "Miniseries", tvStatus: "Returning Series" }, t, "it")
    expect(c.badge).toBeNull()
  })

  it("award vince su returning auto", () => {
    const c = computeTopBadge({ ...baseInput, awards: ["Emmy"] }, t, "it")
    expect(c.badge?.label).toBe("Emmy")
  })

  it("Just Added per film con digitale recente (dato pre-release)", () => {
    const movieBase = { ...baseInput, mediaType: "movie" as const, releaseDate: daysAgo(400), tvStatus: null as string | null }
    const c = computeTopBadge({ ...movieBase, digitalReleaseDate: daysAgo(3) }, t, "it")
    expect(c.justAdded).toBe("Appena aggiunto")
    expect(c.badge).toEqual({ type: "extra", label: "Appena aggiunto" })
  })

  it("Just Added: futuro, vecchio, assente o serie → null", () => {
    const movieBase = { ...baseInput, mediaType: "movie" as const, releaseDate: daysAgo(400), tvStatus: null as string | null }
    expect(computeTopBadge({ ...movieBase, digitalReleaseDate: inDays(3) }, t, "it").justAdded).toBeNull()
    expect(computeTopBadge({ ...movieBase, digitalReleaseDate: daysAgo(30) }, t, "it").justAdded).toBeNull()
    expect(computeTopBadge({ ...movieBase }, t, "it").justAdded).toBeNull()
    expect(computeTopBadge({ ...baseInput, digitalReleaseDate: daysAgo(3) }, t, "it").justAdded).toBeNull()
  })

  it("Nuovo film vince su Just Added", () => {
    const c = computeTopBadge({
      ...baseInput, mediaType: "movie" as const, releaseDate: daysAgo(3),
      tvStatus: null as string | null, digitalReleaseDate: daysAgo(3),
    }, t, "it")
    expect(c.badge?.label).toBe("Nuovo film")
  })

  it("Serie conclusa con ultima puntata recente (sopprime Nuova stagione)", () => {
    const c = computeTopBadge({ ...baseInput, tvStatus: "Ended", lastAirDate: daysAgo(3), seasonCount: 5 }, t, "it")
    expect(c.seriesEnded).toBe("Serie conclusa")
    expect(c.newSeason).toBeNull()
    expect(c.badge).toEqual({ type: "extra", label: "Serie conclusa" })
  })

  it("Serie conclusa: vecchia → null; miniserie vince; mai sui film", () => {
    expect(computeTopBadge({ ...baseInput, tvStatus: "Ended", lastAirDate: daysAgo(30) }, t, "it").seriesEnded).toBeNull()
    // Miniserie (formato permanente) vince sulla conclusione recente.
    expect(computeTopBadge({ ...baseInput, tvStatus: "Ended", tvType: "Miniseries", lastAirDate: daysAgo(3) }, t, "it").badge?.label).toBe("Miniserie")
    // Mai sui film.
    expect(computeTopBadge({ ...baseInput, mediaType: "movie" as const, tvStatus: "Ended", lastAirDate: daysAgo(3) }, t, "it").seriesEnded).toBeNull()
  })
})

describe("resolveSavedBadgeExtra (freeze mapping)", () => {
  it("congela i badge permanenti (award, miniserie, custom)", () => {
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Golden Globe" }, upcomingRelease: null, newSeason: null }, t)).toBe("Golden Globe")
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Miniserie" }, upcomingRelease: null, newSeason: null }, t)).toBe("Miniserie")
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Da divorare" }, upcomingRelease: null, newSeason: null }, t)).toBe("Da divorare")
  })

  it("non congela mai i time-bound (upcoming, nuova stagione, Ritorna)", () => {
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "In uscita 18.12.26" }, upcomingRelease: "In uscita 18.12.26", newSeason: null }, t)).toBeUndefined()
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Nuova S2" }, upcomingRelease: null, newSeason: "Nuova S2" }, t)).toBeUndefined()
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Ritorna" }, upcomingRelease: null, newSeason: null }, t)).toBeUndefined()
  })

  it("non congela mai Just Added e Serie conclusa (transitori)", () => {
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Appena aggiunto" }, upcomingRelease: null, newSeason: null, justAdded: "Appena aggiunto" }, t)).toBeUndefined()
    expect(resolveSavedBadgeExtra({ badge: { type: "extra", label: "Serie conclusa" }, upcomingRelease: null, newSeason: null, seriesEnded: "Serie conclusa" }, t)).toBeUndefined()
  })

  it("ignora i badge rank (vanno in badgeRank, non in badgeExtra)", () => {
    expect(resolveSavedBadgeExtra({ badge: { type: "rank", rank: 3, label: "Serie" }, upcomingRelease: null, newSeason: null }, t)).toBeUndefined()
    expect(resolveSavedBadgeExtra({ badge: null, upcomingRelease: null, newSeason: null }, t)).toBeUndefined()
  })
})

describe("getAllBadgeOptions (nuovi badge)", () => {
  it("includes newSeason key and K-Drama literal", () => {
    const options = getAllBadgeOptions({
      upcomingRelease: null, isNewMovie: false, isNewSeries: false,
      newSeason: "Nuova stagione S2", animeRank: null, trendRank: null,
      award: null, nomination: null, studio: null, director: null,
      subGenre: null, isKDrama: true, imdbTop250: false, extra: null,
      mediaType: "tv", voteAverage: 8, tvType: null, tvStatus: null,
    })
    expect(options).toContain("__badge.newSeason")
    expect(options).toContain("K-Drama")
  })

  it("includes justAdded literal and seriesEnded literal", () => {
    const options = getAllBadgeOptions({
      upcomingRelease: null, isNewMovie: false, isNewSeries: false,
      newSeason: null, justAdded: "Appena aggiunto", animeRank: null, trendRank: null,
      award: null, nomination: null, studio: null, director: null,
      subGenre: null, imdbTop250: false, seriesEnded: "Serie conclusa", extra: null,
      mediaType: "tv", voteAverage: 8, tvType: null, tvStatus: "Ended",
    })
    expect(options).toContain("Appena aggiunto")
    expect(options).toContain("Serie conclusa")
  })

  it("includes every win as manual option (ID + Wikidata)", () => {
    const options = getAllBadgeOptions({
      upcomingRelease: null, isNewMovie: false, isNewSeries: false,
      newSeason: null, animeRank: null, trendRank: null,
      award: "Emmy", awardWins: ["Emmy", "Golden Globe", "BAFTA"], nomination: null,
      studio: null, director: null,
      subGenre: null, extra: null,
      mediaType: "tv", voteAverage: 8, tvType: null, tvStatus: null,
    })
    expect(options).toContain("Emmy")
    expect(options).toContain("Golden Globe")
    expect(options).toContain("BAFTA")
  })
})
