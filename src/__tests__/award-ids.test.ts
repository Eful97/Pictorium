import { describe, it, expect } from "vitest"
import { isAwardListsReviewDue, lookupAwardIds, withIdAwards, withIdNoms } from "@/lib/award-ids"
import { checkAwardFreshness, readAwardMaintenance } from "../../scripts/check-award-lists.mjs"
import fs from "node:fs"
import path from "node:path"
import { computeTopBadge } from "@/lib/poster-badge"
import { createT } from "@/lib/i18n"

const t = createT("it")

describe("lookupAwardIds", () => {
  it("Oscar winner beats everything (Oppenheimer: anche Globe, Oscar primo)", () => {
    expect(lookupAwardIds(872585, "movie")).toEqual({ wins: ["Oscar", "Golden Globe"], noms: [] })
  })

  it("Globe winner movie without Oscar (The Revenant)", () => {
    expect(lookupAwardIds(281957, "movie")).toEqual({ wins: ["Golden Globe"], noms: [] })
  })

  it("Oscar nominee without win (Barbie)", () => {
    expect(lookupAwardIds(346698, "movie")).toEqual({ wins: [], noms: ["Oscar"] })
  })

  it("Palma d'Oro winner (Parasite vince anche l'Oscar: Oscar primo)", () => {
    expect(lookupAwardIds(496243, "movie")).toEqual({ wins: ["Oscar", "Cannes"], noms: [] })
  })

  it("Leone d'Oro winner (Joker)", () => {
    expect(lookupAwardIds(475557, "movie")).toEqual({ wins: ["Venezia"], noms: [] })
  })

  it("TV: Emmy winner (Breaking Bad)", () => {
    expect(lookupAwardIds(1396, "tv")).toEqual({ wins: ["Emmy"], noms: [] })
  })

  it("TV: Globe winner without Emmy (Abbott Elementary)", () => {
    expect(lookupAwardIds(125935, "tv")).toEqual({ wins: ["Golden Globe"], noms: [] })
  })

  it("namespace separati: film/105 non è tv/105", () => {
    // 105 film (Ritorno al futuro) non sta in nessuna lista: resta vuoto
    // anche se un giorno un tv/105 vincesse un Emmy.
    expect(lookupAwardIds(105, "movie")).toEqual({ wins: [], noms: [] })
    // Oppenheimer come serie TV: niente (ID da mondo film).
    expect(lookupAwardIds(872585, "tv")).toEqual({ wins: [], noms: [] })
    // Breaking Bad come film: niente (ID da mondo serie).
    expect(lookupAwardIds(1396, "movie")).toEqual({ wins: [], noms: [] })
  })

  it("sconosciuto/invalido → vuoto (mai un bollino inventato)", () => {
    expect(lookupAwardIds(999999999, "movie")).toEqual({ wins: [], noms: [] })
    expect(lookupAwardIds(null, "movie")).toEqual({ wins: [], noms: [] })
    expect(lookupAwardIds(undefined, "tv")).toEqual({ wins: [], noms: [] })
    expect(lookupAwardIds(NaN, "movie")).toEqual({ wins: [], noms: [] })
    expect(lookupAwardIds(-5, "movie")).toEqual({ wins: [], noms: [] })
  })
})

describe("isAwardListsReviewDue (tracciabilità verifica)", () => {
  const NOW = Date.parse("2026-10-03T00:00:00Z")

  it("sconosciuta → revisione dovuta (mai finta come verificata)", () => {
    expect(isAwardListsReviewDue("unknown", NOW)).toBe(true)
    expect(isAwardListsReviewDue("", NOW)).toBe(true)
  })

  it("malformata o futura → revisione dovuta", () => {
    expect(isAwardListsReviewDue("27/09/2026", NOW)).toBe(true)
    expect(isAwardListsReviewDue("2026-13-01", NOW)).toBe(true)
    expect(isAwardListsReviewDue("2026-10-04", NOW)).toBe(true)
  })

  it("vecchia oltre soglia → dovuta; recente → fresca", () => {
    expect(isAwardListsReviewDue("2024-01-01", NOW)).toBe(true)
    expect(isAwardListsReviewDue("2026-09-01", NOW)).toBe(false)
  })

  it("date impossibili normalizzate da Date.parse: dovute anche entro soglia", () => {
    // 2026-02-31 non esiste (Date.parse la sposta a marzo): il round-trip
    // deve coincidere con l'input, altrimenti è dovuta anche con soglia ampia.
    expect(isAwardListsReviewDue("2026-02-31", NOW, 10000)).toBe(true)
    expect(isAwardListsReviewDue("2025-02-29", NOW, 10000)).toBe(true)
    // 2024-02-29 esiste (bisestile): con soglia ampia è fresca.
    expect(isAwardListsReviewDue("2024-02-29", NOW, 10000)).toBe(false)
  })
  it("soglia documentata: 365 giorni", () => {
    // Al giorno 365 esatto è ancora fresca (serve "oltre" la soglia).
    expect(isAwardListsReviewDue("2025-10-03", NOW, 365)).toBe(false)
    expect(isAwardListsReviewDue("2025-10-02", NOW, 365)).toBe(true)
  })
})

describe("scripts/check-award-lists.mjs (comando manuale)", () => {
  it("legge data e soglia dal sorgente reale", () => {
    const source = fs.readFileSync(path.resolve("src/lib/award-ids.ts"), "utf-8")
    const { lastVerified, thresholdDays } = readAwardMaintenance(source)
    expect(typeof lastVerified).toBe("string")
    expect(thresholdDays).toBe(365)
  })

  it("stato attuale: revisione dovuta (ultima verifica sconosciuta)", () => {
    expect(checkAwardFreshness("unknown", Date.now(), 365)).toMatch(/sconosciuta/)
  })

  it("non altera liste né badge: segnala soltanto", () => {
    expect(checkAwardFreshness("2026-09-01", Date.parse("2026-10-03T00:00:00Z"), 365)).toBeNull()
  })

  it("date impossibili: dovute anche entro soglia; bisestile valida: fresca", () => {
    const now = Date.parse("2026-10-03T00:00:00Z")
    expect(checkAwardFreshness("2026-02-31", now, 10000)).toMatch(/impossibile/)
    expect(checkAwardFreshness("2024-02-29", now, 10000)).toBeNull()
  })
})
describe("withIdAwards / withIdNoms", () => {
  it("certi in testa, generici intatti, dedup", () => {
    expect(withIdAwards(872585, "movie", ["BAFTA"])).toEqual(["Oscar", "Golden Globe", "BAFTA"])
    expect(withIdAwards(872585, "movie", ["Oscar", "Golden Globe", "BAFTA"])).toEqual(["Oscar", "Golden Globe", "BAFTA"])
    expect(withIdNoms(346698, "movie", ["BAFTA"])).toEqual(["Oscar", "BAFTA"])
  })

  it("senza match restituisce copia uguale", () => {
    expect(withIdAwards(null, "movie", ["Oscar"])).toEqual(["Oscar"])
    expect(withIdNoms(999999999, "tv", [])).toEqual([])
  })
})

describe("computeTopBadge con liste ID", () => {
  const base = {
    mediaType: "movie" as const,
    releaseDate: null,
    firstAirDate: null,
    lastAirDate: null,
    seasonCount: null,
    originCountries: [] as string[],
    voteAverage: 8,
    trendRank: null,
    animeRank: null,
    awards: [] as string[],
    nominations: [] as string[],
    studios: [] as string[],
    director: null,
    tvType: null,
    tvStatus: null,
    keywords: [] as string[],
    imdbTop250: false,
  }

  it("Oppenheimer da ID: vince l'Oscar anche senza Wikidata", () => {
    const c = computeTopBadge({ ...base, tmdbId: 872585 }, t, "it")
    expect(c.awardBadge).toBe("Oscar")
    expect(c.badge?.label).toBe("Oscar")
  })

  it("Barbie da ID: nomination senza vittoria", () => {
    const c = computeTopBadge({ ...base, tmdbId: 346698 }, t, "it")
    expect(c.badge?.label).toBe("Candidato Oscar")
  })

  it("senza tmdbId: comportamento invariato (solo Wikidata)", () => {
    const c = computeTopBadge({ ...base, awards: ["Emmy"] }, t, "it")
    expect(c.awardBadge).toBe("Emmy")
  })

  it("Breaking Bad: Emmy batte Golden Globe anche con entrambe le label", () => {
    const tvBase = { ...base, mediaType: "tv" as const }
    const c = computeTopBadge({ ...tvBase, tmdbId: 1396, awards: ["Golden Globe", "Emmy"] }, t, "it")
    expect(c.awardBadge).toBe("Emmy")
    expect(c.badge?.label).toBe("Emmy")
  })
})
