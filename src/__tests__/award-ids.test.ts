import { describe, it, expect } from "vitest"
import ts from "typescript"
import { isAwardListsReviewDue, lookupAwardIds, withIdAwards, withIdNoms } from "@/lib/award-ids"
import { checkAwardFreshness, readAwardMaintenance } from "../../scripts/check-award-lists.mjs"
import fs from "node:fs"
import path from "node:path"
import { computeTopBadge } from "@/lib/poster-badge"
import { createT } from "@/lib/i18n"

const t = createT("it")

describe("lookupAwardIds", () => {
  it("Oscar winner beats everything (Oppenheimer: anche BAFTA e Globe, Oscar primo)", () => {
    expect(lookupAwardIds(872585, "movie")).toEqual({ wins: ["Oscar", "BAFTA", "Golden Globe"], noms: [] })
  })

  it("Globe winner movie without Oscar (The Revenant: anche BAFTA, BAFTA prima)", () => {
    expect(lookupAwardIds(281957, "movie")).toEqual({ wins: ["BAFTA", "Golden Globe"], noms: [] })
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

  it("BAFTA Best Film winner (Conclave 2024: BAFTA win + Oscar nom)", () => {
    // Cross-org overlap legittimo (come Oscar vs Globe): Conclave è anche
    // tra i candidati Oscar 2024 (OSCAR_NOMINEE_MOVIE_IDS). La win vince.
    expect(lookupAwardIds(974576, "movie")).toEqual({ wins: ["BAFTA"], noms: ["Oscar"] })
  })

  it("BAFTA multi-win ordering follows badge-labels priority (Roma: Venezia + BAFTA; 1917: BAFTA + Globe)", () => {
    // Roma (426426): Venezia 2018 + BAFTA 2018 → Venezia prima (priority 2 < 3).
    expect(lookupAwardIds(426426, "movie")).toEqual({ wins: ["Venezia", "BAFTA"], noms: [] })
    // 1917 (530915): BAFTA 2019 + Globe 2019 → BAFTA prima (priority 3 < 5).
    expect(lookupAwardIds(530915, "movie")).toEqual({ wins: ["BAFTA", "Golden Globe"], noms: [] })
  })

  it("namespace isolation: BAFTA movie win never leaks into tv", () => {
    expect(lookupAwardIds(872585, "tv")).toEqual({ wins: [], noms: [] })
    expect(lookupAwardIds(974576, "tv")).toEqual({ wins: [], noms: [] })
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
    expect(c.awardBadge).toBe("Vincitore Oscar")
    expect(c.badge?.label).toBe("Vincitore Oscar")
  })

  it("Barbie da ID: nomination senza vittoria", () => {
    const c = computeTopBadge({ ...base, tmdbId: 346698 }, t, "it")
    expect(c.badge?.label).toBe("Candidato Oscar")
  })

  it("senza tmdbId: comportamento invariato (solo Wikidata)", () => {
    const c = computeTopBadge({ ...base, awards: ["Emmy"] }, t, "it")
    expect(c.awardBadge).toBe("Vincitore Emmy")
  })

  it("Breaking Bad: Emmy batte Golden Globe anche con entrambe le label", () => {
    const tvBase = { ...base, mediaType: "tv" as const }
    const c = computeTopBadge({ ...tvBase, tmdbId: 1396, awards: ["Golden Globe", "Emmy"] }, t, "it")
    expect(c.awardBadge).toBe("Vincitore Emmy")
    expect(c.badge?.label).toBe("Vincitore Emmy")
  })
})

describe("Oscar Best Picture nominee backfill (2022/2024)", () => {
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

  it("backfilled nominees resolve as Oscar noms in the movie namespace, never tv", () => {
    // 2022 All Quiet on the Western Front (NOT the 1930 film),
    // 2022 Women Talking, 2024 I'm Still Here / Ainda Estou Aqui
    // (NOT the 2010 mockumentary): Best Picture non-winners.
    // 49046 è anche BAFTA winner 2022 (cross-org legittimo): la win BAFTA
    // viaggia con la nom Oscar.
    expect(lookupAwardIds(49046, "movie")).toEqual({ wins: ["BAFTA"], noms: ["Oscar"] })
    expect(lookupAwardIds(777245, "movie")).toEqual({ wins: [], noms: ["Oscar"] })
    expect(lookupAwardIds(1000837, "movie")).toEqual({ wins: [], noms: ["Oscar"] })
    expect(lookupAwardIds(49046, "tv")).toEqual({ wins: [], noms: [] })
    expect(lookupAwardIds(777245, "tv")).toEqual({ wins: [], noms: [] })
    expect(lookupAwardIds(1000837, "tv")).toEqual({ wins: [], noms: [] })
  })

  it("backfilled nominees yield the candidate fallback without generic awards", () => {
    for (const tmdbId of [777245, 1000837]) {
      const c = computeTopBadge({ ...base, tmdbId }, t, "it")
      expect(c.awardBadge).toBeNull()
      expect(c.badge?.label).toBe("Candidato Oscar")
    }
  })

  it("backfilled Oscar nom with a curated BAFTA win renders the BAFTA winner badge", () => {
    // 49046 (All Quiet 2022): la win curata BAFTA batte il fallback candidato.
    const c = computeTopBadge({ ...base, tmdbId: 49046 }, t, "it")
    expect(c.badge?.label).toBe("BAFTA")
  })

  it("a generic Oscar win is never downgraded by a curated Best Picture nom", () => {
    // All three won Oscars in OTHER categories: a generic Wikidata "Oscar"
    // win (winner semantics beat nominee) must still render the explicit
    // winner badge, not the candidate fallback.
    for (const tmdbId of [49046, 777245, 1000837]) {
      const c = computeTopBadge({ ...base, tmdbId, awards: ["Oscar"] }, t, "it")
      expect(c.awardBadge).toBe("Vincitore Oscar")
      expect(c.badge?.label).toBe("Vincitore Oscar")
    }
  })
})

describe("award-ids curated literal guards (raw source, AST)", () => {
  const SOURCE_PATH = path.resolve("src/lib/award-ids.ts")

  /** Closed inventory of curated sets: every entry declares its own namespace. */
  const CURATED_SET_NAMES = [
    "OSCAR_WINNER_MOVIE_IDS",
    "OSCAR_NOMINEE_MOVIE_IDS",
    "GLOBE_WINNER_MOVIE_IDS",
    "GLOBE_NOMINEE_MOVIE_IDS",
    "GLOBE_WINNER_TV_IDS",
    "GLOBE_NOMINEE_TV_IDS",
    "EMMY_WINNER_TV_IDS",
    "EMMY_NOMINEE_TV_IDS",
    "CANNES_TOP_IDS",
    "VENICE_TOP_IDS",
    "BAFTA_WINNER_MOVIE_IDS",
  ] as const
  type CuratedSetName = (typeof CURATED_SET_NAMES)[number]

  /**
   * Same organization + same namespace only: a title cannot be both winner
   * and nominee of the same award. Cross-org (Oscar vs Globe) and cross-media
   * (movie vs TV: separate TMDB namespaces) sharing is legitimate.
   */
  const SAME_ORG_WIN_NOM_PAIRS: ReadonlyArray<readonly [CuratedSetName, CuratedSetName]> = [
    ["OSCAR_WINNER_MOVIE_IDS", "OSCAR_NOMINEE_MOVIE_IDS"],
    ["GLOBE_WINNER_MOVIE_IDS", "GLOBE_NOMINEE_MOVIE_IDS"],
    ["GLOBE_WINNER_TV_IDS", "GLOBE_NOMINEE_TV_IDS"],
    ["EMMY_WINNER_TV_IDS", "EMMY_NOMINEE_TV_IDS"],
  ]

  /** Raw entries of one curated set literal, before Set dedup hides anything. */
  interface CuratedEntries {
    ids: number[]
    invalid: string[]
  }

  /**
   * Inspect one array-literal element. Only numeric literals whose value is a
   * finite positive safe integer are accepted — decimal, hex, scientific, or
   * separator forms alike, since they evaluate to the same TMDB id. Everything
   * else (omitted holes, spreads, strings, negatives, fractions, zero,
   * identifiers such as Infinity/NaN) is reported as invalid.
   */
  function inspectEntry(
    el: ts.Expression,
    sf: ts.SourceFile,
  ): { id: number | null; invalid: string | null } {
    if (ts.isOmittedExpression(el)) return { id: null, invalid: "<omitted hole>" }
    if (ts.isNumericLiteral(el)) {
      const value = Number(el.text.replace(/_/g, ""))
      if (Number.isSafeInteger(value) && value > 0) return { id: value, invalid: null }
      return { id: null, invalid: el.getText(sf) }
    }
    return { id: null, invalid: el.getText(sf) }
  }

  /**
   * Parse curated `const NAME = new Set([...])` declarations with the
   * TypeScript compiler AST: comments/years are trivia and never become
   * entries, and commented-out declarations do not exist as statements.
   * Fail-closed: parse diagnostics, shape mismatches, missing sets, duplicate
   * declarations, or unguarded extra Set literals all throw.
   */
  function parseCuratedSource(source: string): Map<CuratedSetName, CuratedEntries> {
    const sf = ts.createSourceFile("award-ids.ts", source, ts.ScriptTarget.Latest, false)
    // parseDiagnostics is present at runtime but no longer on the public
    // SourceFile type: access it through a narrow structural cast instead.
    const syntaxErrors: readonly ts.DiagnosticWithLocation[] =
      (sf as unknown as { parseDiagnostics: readonly ts.DiagnosticWithLocation[] })
        .parseDiagnostics ?? []
    if (syntaxErrors.length > 0) {
      const details = syntaxErrors
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
        .join("; ")
      throw new Error(`award-ids source has parse diagnostics: ${details}`)
    }
    const arrays = new Map<string, ts.ArrayLiteralExpression>()
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const init = decl.initializer
        if (!ts.isNewExpression(init)) continue
        if (!ts.isIdentifier(init.expression) || init.expression.text !== "Set") continue
        if (!init.arguments || init.arguments.length !== 1) {
          throw new Error(`curated set with unexpected Set() shape: ${decl.name.text}`)
        }
        const arg = init.arguments[0]
        if (!arg || !ts.isArrayLiteralExpression(arg)) {
          throw new Error(`curated set without array literal: ${decl.name.text}`)
        }
        if (arrays.has(decl.name.text)) {
          throw new Error(`duplicate declaration: ${decl.name.text}`)
        }
        arrays.set(decl.name.text, arg)
      }
    }
    for (const name of CURATED_SET_NAMES) {
      if (!arrays.has(name)) throw new Error(`curated set missing or commented out: ${name}`)
    }
    for (const name of arrays.keys()) {
      if (!(CURATED_SET_NAMES as readonly string[]).includes(name)) {
        throw new Error(`unguarded curated set literal: ${name}`)
      }
    }
    const out = new Map<CuratedSetName, CuratedEntries>()
    for (const name of CURATED_SET_NAMES) {
      const ids: number[] = []
      const invalid: string[] = []
      const elements = (arrays.get(name) as ts.ArrayLiteralExpression).elements
      for (const el of elements) {
        const checked = inspectEntry(el, sf)
        if (checked.id !== null) ids.push(checked.id)
        else if (checked.invalid !== null) invalid.push(checked.invalid)
      }
      out.set(name, { ids, invalid })
    }
    return out
  }

  /** Read all curated sets from source; throw on invalid entries or duplicates. */
  function readCuratedLiterals(source: string): Map<CuratedSetName, number[]> {
    const out = new Map<CuratedSetName, number[]>()
    for (const [name, entries] of parseCuratedSource(source)) {
      if (entries.invalid.length > 0) {
        throw new Error(`invalid entries in ${name}: ${entries.invalid.join(", ")}`)
      }
      const dups = findDuplicates(entries.ids)
      if (dups.length > 0) throw new Error(`duplicates in ${name}: ${dups.join(", ")}`)
      out.set(name, entries.ids)
    }
    return out
  }

  /** In-memory module fixture: all 11 sets declared; overrides replace bodies. */
  function fixtureSource(overrides: Partial<Record<CuratedSetName, string>> = {}): string {
    return (
      CURATED_SET_NAMES.map(
        (name) => `const ${name}: ReadonlySet<number> = new Set([${overrides[name] ?? ""}]);`,
      ).join("\n") + "\n"
    )
  }

  function findDuplicates(ids: readonly number[]): number[] {
    const seen = new Set<number>()
    const dups = new Set<number>()
    for (const id of ids) {
      if (seen.has(id)) dups.add(id)
      else seen.add(id)
    }
    return [...dups].sort((a, b) => a - b)
  }

  function findOverlap(a: readonly number[], b: readonly number[]): number[] {
    const inB = new Set(b)
    return [...new Set(a.filter((id) => inB.has(id)))].sort((x, y) => x - y)
  }

  function checkWinNomOverlaps(
    literals: ReadonlyMap<string, readonly number[]>,
  ): string[] {
    const findings: string[] = []
    for (const [winners, nominees] of SAME_ORG_WIN_NOM_PAIRS) {
      const w = literals.get(winners) ?? []
      const n = literals.get(nominees) ?? []
      for (const id of findOverlap(w, n)) findings.push(`${winners} ∩ ${nominees}: ${id}`)
    }
    return findings
  }

  it("sensitivity: duplicate numeric entries are detected (Set would hide them)", () => {
    const parsed = parseCuratedSource(
      fixtureSource({ OSCAR_WINNER_MOVIE_IDS: "314365, 376867, 314365" }),
    )
    const entries = parsed.get("OSCAR_WINNER_MOVIE_IDS") as CuratedEntries
    expect(entries.invalid).toEqual([])
    // Set dedups silently: this is why the guard reads the raw literal.
    expect(new Set(entries.ids).size).toBeLessThan(entries.ids.length)
    expect(findDuplicates(entries.ids)).toEqual([314365])
  })

  it("sensitivity: the omitted-element hole ([1,,2]) is detected", () => {
    const parsed = parseCuratedSource(fixtureSource({ OSCAR_WINNER_MOVIE_IDS: "1, , 2" }))
    const entries = parsed.get("OSCAR_WINNER_MOVIE_IDS") as CuratedEntries
    // At runtime new Set([1,,2]) contains undefined: never silently clean.
    expect(entries.ids).toEqual([1, 2])
    expect(entries.invalid).toEqual(["<omitted hole>"])
  })

  it("sensitivity: string/negative/fraction/zero/non-finite entries are rejected", () => {
    const parsed = parseCuratedSource(
      fixtureSource({ OSCAR_WINNER_MOVIE_IDS: "'abc', -3, 12.5, 0, NaN, Infinity" }),
    )
    const entries = parsed.get("OSCAR_WINNER_MOVIE_IDS") as CuratedEntries
    expect(entries.ids).toEqual([])
    expect(entries.invalid).toHaveLength(6)
  })

  it("sensitivity: spread elements are rejected", () => {
    const parsed = parseCuratedSource(
      fixtureSource({ OSCAR_WINNER_MOVIE_IDS: "...BASE, 1" }),
    )
    const entries = parsed.get("OSCAR_WINNER_MOVIE_IDS") as CuratedEntries
    expect(entries.ids).toEqual([1])
    expect(entries.invalid).toEqual(["...BASE"])
  })

  it("hex and scientific forms evaluating to valid positive integers are accepted", () => {
    const parsed = parseCuratedSource(
      fixtureSource({ OSCAR_WINNER_MOVIE_IDS: "0x10, 1e3" }),
    )
    const entries = parsed.get("OSCAR_WINNER_MOVIE_IDS") as CuratedEntries
    expect(entries.invalid).toEqual([])
    expect(entries.ids).toEqual([16, 1000])
  })

  it("sensitivity: same-org winner/nominee overlap is detected with context", () => {
    const literals = readCuratedLiterals(
      fixtureSource({
        OSCAR_WINNER_MOVIE_IDS: "1, 2",
        OSCAR_NOMINEE_MOVIE_IDS: "2, 3",
      }),
    )
    expect(checkWinNomOverlaps(literals)).toEqual([
      "OSCAR_WINNER_MOVIE_IDS ∩ OSCAR_NOMINEE_MOVIE_IDS: 2",
    ])
  })

  it("closed inventory: every declared Set literal is guarded, none missing", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf-8")
    const literals = readCuratedLiterals(source) // throws on invalid entries/duplicates
    expect([...literals.keys()].sort()).toEqual([...CURATED_SET_NAMES].sort())
  })

  it("every raw entry is a finite positive safe integer (no Set hiding anything)", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf-8")
    expect(readCuratedLiterals(source).size).toBe(CURATED_SET_NAMES.length)
  })

  it("no same-org winner/nominee overlap in the real source", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf-8")
    expect(checkWinNomOverlaps(readCuratedLiterals(source))).toEqual([])
  })

  it("cross-org and cross-media sharing are allowed (same guard, parsed fixture)", () => {
    const literals = readCuratedLiterals(
      fixtureSource({
        OSCAR_WINNER_MOVIE_IDS: "1, 2",
        OSCAR_NOMINEE_MOVIE_IDS: "3",
        GLOBE_WINNER_MOVIE_IDS: "1, 2", // cross-org: same id, other org -> allowed
        GLOBE_WINNER_TV_IDS: "1", // cross-media: same number, other namespace -> allowed
      }),
    )
    expect(checkWinNomOverlaps(literals)).toEqual([])
  })

  it("guard covers every winner/nominee sibling pair (fail-closed on removals)", () => {
    const pairKeys = new Set(
      SAME_ORG_WIN_NOM_PAIRS.map(([winners, nominees]) => `${winners}|${nominees}`),
    )
    const nominees = new Set<string>(CURATED_SET_NAMES.filter((n) => n.includes("NOMINEE")))
    for (const w of CURATED_SET_NAMES.filter((n) => n.includes("WINNER"))) {
      const sibling = w.replace("WINNER", "NOMINEE")
      if (nominees.has(sibling)) {
        expect(pairKeys.has(`${w}|${sibling}`)).toBe(true)
      }
    }
  })

  it("comments/years/whitespace never become entries (parser trivia)", () => {
    const parsed = parseCuratedSource(
      fixtureSource({
        OSCAR_WINNER_MOVIE_IDS:
          "// 2024 comment holding 999999 and 12.5\n314365, // 2015 Spotlight\n/* block 777 */ 376867,",
      }),
    )
    const entries = parsed.get("OSCAR_WINNER_MOVIE_IDS") as CuratedEntries
    expect(entries.invalid).toEqual([])
    expect(entries.ids).toEqual([314365, 376867])
  })

  it("commented-out decoy declarations are not inventoried", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf-8")
    const withDecoy = `${source}// const DECOY_IDS = new Set([999999]);\n`
    expect(readCuratedLiterals(withDecoy).size).toBe(CURATED_SET_NAMES.length)
  })

  it("sensitivity: missing, commented-out, or unguarded sets fail closed", () => {
    expect(() => parseCuratedSource("const X = 1;")).toThrow(/missing or commented out/)
    const commented = fixtureSource().replace(
      "const OSCAR_WINNER_MOVIE_IDS",
      "// const OSCAR_WINNER_MOVIE_IDS",
    )
    expect(() => parseCuratedSource(commented)).toThrow(/missing or commented out/)
    expect(() =>
      parseCuratedSource(`${fixtureSource()}const EXTRA_IDS = new Set([1]);\n`),
    ).toThrow(/unguarded/)
    expect(() => readCuratedLiterals("")).toThrow(/missing or commented out/)
  })
})
