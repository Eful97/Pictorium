import { describe, it, expect, afterEach } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  emmyLimitedSlugForYear,
  officialSourcePages,
  extractOscarBestPictureBlock,
  parseOscarCeremony,
  parseGlobeNominations,
  decodeHtmlEntities,
  unsortGlobeTitle,
  GLOBE_AWARD_NAME_FOR,
  EMMY_CATEGORY_ALIASES,
} from "../../scripts/awards-updater-lib.mjs"
import { liveCollect } from "../../scripts/collect-award-candidates.mjs"

const fix = (n: string) => fs.readFileSync(path.resolve(`scripts/awards-updater/fixtures/${n}`), "utf-8")

const OSCAR_2024 = fix("oscar-2024-bestpicture.html")
const OSCAR_2009 = fix("oscar-2009-bestpicture.html")
const GLOBE_BP_2024 = fix("globe-2024-bestpicture-drama.json")
const GLOBE_TV_2008 = fix("globe-2008-tvdrama.json")
const GLOBE_LTD_2008 = fix("globe-2008-limited.json")
const EMMY_LTD_2008 = fix("emmy-2008-limited-itemlist.json")
const EMMY_LTD_2024 = fix("emmy-2024-limited-itemlist.json")

const oscarPage = (section: string, year: number) =>
  `<html><head><link rel="canonical" href="https://www.oscars.org/oscars/ceremonies/${year}" /></head><body>${section}</body></html>`

const GLOBE_BP_CTX = {
  url: "https://goldenglobes.com/wp-json/awdb/v1/nominations/?page=1&year=2024&award=x",
  year: 2024,
  award: "Best Motion Picture - Drama",
  family: "globe-film",
  category: "Best Motion Picture - Drama",
  media: "movie",
  page: 1,
  totalPages: 1,
}

type FetchFn = typeof globalThis.fetch
function stubFetch(fn: (url: unknown) => Promise<Response>): FetchFn {
  return (async (input: unknown) => fn(input)) as unknown as FetchFn
}

describe("source adapters: Emmy limited per-year slug (verified site history)", () => {
  it("uses outstanding-miniseries-or-movie through 2013, outstanding-miniseries after", () => {
    expect(emmyLimitedSlugForYear(2008)).toBe("outstanding-miniseries-or-movie")
    expect(emmyLimitedSlugForYear(2009)).toBe("outstanding-miniseries-or-movie")
    expect(emmyLimitedSlugForYear(2013)).toBe("outstanding-miniseries-or-movie")
    expect(emmyLimitedSlugForYear(2014)).toBe("outstanding-miniseries")
    expect(emmyLimitedSlugForYear(2024)).toBe("outstanding-miniseries")
  })

  it("officialSourcePages emits the verified slug per year", () => {
    const u2008 = officialSourcePages("emmy", 2008).find((p) => p.category === "Outstanding Limited Series")?.url
    const u2024 = officialSourcePages("emmy", 2024).find((p) => p.category === "Outstanding Limited Series")?.url
    expect(u2008).toBe("https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-miniseries-or-movie")
    expect(u2024).toBe("https://www.televisionacademy.com/awards/nominees-winners/2024/outstanding-miniseries")
  })

  it("accepts the anthology-era list name for the limited alias", () => {
    expect(EMMY_CATEGORY_ALIASES["outstanding limited series"]).toContain("outstanding limited or anthology series")
  })
})

describe("source adapters: Emmy limited real fixtures parse", () => {
  it("2008 limited (or-movie slug): 4 rows, John Adams winner", async () => {
    const { parseEmmyItemList } = await import("../../scripts/awards-updater-lib.mjs")
    const parsed = parseEmmyItemList(EMMY_LTD_2008, {
      url: "https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-miniseries-or-movie",
      year: 2008,
      category: "Outstanding Limited Series",
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(4)
    expect(parsed.meta.winnerCount).toBe(1)
    expect(parsed.rows.find((r: { status: string }) => r.status === "winner")?.title).toBe("John Adams")
  })

  it("2024 limited: 5 rows, Baby Reindeer winner (anthology alias)", async () => {
    const { parseEmmyItemList } = await import("../../scripts/awards-updater-lib.mjs")
    const parsed = parseEmmyItemList(EMMY_LTD_2024, {
      url: "https://www.televisionacademy.com/awards/nominees-winners/2024/outstanding-miniseries",
      year: 2024,
      category: "Outstanding Limited Series",
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.rows.find((r: { status: string }) => r.status === "winner")?.title).toBe("Baby Reindeer")
  })
})

describe("source adapters: Oscar ceremony parser vs real fixtures", () => {
  const CTX = { url: "https://www.oscars.org/oscars/ceremonies/2024", year: 2024, category: "Best Picture" }

  it("2024: 10 rows, Oppenheimer winner (captured official block)", () => {
    const parsed = parseOscarCeremony(oscarPage(OSCAR_2024, 2024), CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(10)
    expect(parsed.meta.winnerCount).toBe(1)
    expect(parsed.rows.find((r: { status: string }) => r.status === "winner")?.title).toBe("Oppenheimer")
    expect(parsed.rows.every((r: { year: number; family: string; media: string }) => r.year === 2024 && r.family === "oscar" && r.media === "movie")).toBe(true)
  })

  it("2009: 5 rows, Slumdog Millionaire winner (same template, pre-expansion era)", () => {
    const parsed = parseOscarCeremony(oscarPage(OSCAR_2009, 2009), {
      url: "https://www.oscars.org/oscars/ceremonies/2009",
      year: 2009,
      category: "Best Picture",
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.rows.find((r: { status: string }) => r.status === "winner")?.title).toBe("Slumdog Millionaire")
  })

  it("canonical year mismatch: HARD reject, 0 rows", () => {
    const parsed = parseOscarCeremony(oscarPage(OSCAR_2024, 2023), { ...CTX, year: 2024 })
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toBe("ceremony-year-mismatch")
    expect(parsed.rows).toEqual([])
  })

  it("missing Best Picture block: 0 rows, no invention", () => {
    const noBP = oscarPage(
      '<div class="field field--name-field-award-category-oscars field--type-entity-reference field--label-hidden field__item">Best Cinematography</div>',
      2024,
    )
    expect(extractOscarBestPictureBlock(noBP)).toBeNull()
    const parsed = parseOscarCeremony(noBP, CTX)
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toBe("category-missing")
    expect(parsed.rows).toEqual([])
  })

  it("duplicate Best Picture blocks: HARD reject, 0 rows", () => {
    const dup = oscarPage(`${OSCAR_2024}${OSCAR_2024}`, 2024)
    const parsed = parseOscarCeremony(dup, CTX)
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toBe("category-duplicate")
    expect(parsed.rows).toEqual([])
  })

  it("acting blocks are structurally excluded (no person names as film rows)", () => {
    const acting =
      '<div class="field field--name-field-award-category-oscars field--type-entity-reference field--label-hidden field__item">Actor in a Leading Role</div>' +
      '<div class="field field--name-field-honoree-type winner">Winner</div>' +
      '<div class="field field--name-field-award-entities field--type-entity-reference field--label-hidden field__items"><div class="field__item">Cillian Murphy</div></div>' +
      '<div class="field field--name-field-award-film field--type-entity-reference field--label-hidden field__item">Oppenheimer</div>' +
      '<div class="field field--name-field-honoree-type nominee">Nominees</div>' +
      '<div class="field field--name-field-award-entities field--type-entity-reference field--label-hidden field__items"><div class="field__item">Paul Giamatti</div></div>' +
      '<div class="field field--name-field-award-film field--type-entity-reference field--label-hidden field__item">The Holdovers</div>'
    const parsed = parseOscarCeremony(oscarPage(`${acting}${OSCAR_2024}`, 2024), CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(10)
    const titles = parsed.rows.map((r: { title: string }) => r.title)
    expect(titles).not.toContain("Cillian Murphy")
    expect(titles).not.toContain("Paul Giamatti")
  })

  it("honoree type/label conflict is skipped, never counted", () => {
    const bad = OSCAR_2024.replace(
      'field--name-field-honoree-type winner">Winner',
      'field--name-field-honoree-type winner">Nominees',
    )
    const parsed = parseOscarCeremony(oscarPage(bad, 2024), CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows.every((r: { title: string }) => r.title !== "Oppenheimer")).toBe(true)
    expect(parsed.meta.winnerCount).toBe(0)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "honoree-type-mismatch")).toBe(true)
  })

  it("reworded film field: honoree marker unparsed → PARTIAL, never COMPLETE", () => {
    // One nominee's film field renamed (source markup change): the regex no
    // longer matches that entry but its honoree-type marker is still there.
    const reworded = OSCAR_2024.replace(
      "field--name-field-award-film",
      "field--name-field-award-motion-picture",
    )
    const parsed = parseOscarCeremony(oscarPage(reworded, 2024), CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(9)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "honoree-unparsed")).toBe(true)
    expect(parsed.meta.skippedCount).toBeGreaterThan(0)
    expect(parsed.meta.totalHonorees).toBe(10)
    // The downstream completeness gate (winner==1 && skipped==0) must fail.
    expect(parsed.meta.winnerCount === 1 && parsed.meta.skippedCount === 0).toBe(false)
  })

  it("removed film value: honoree marker unparsed → PARTIAL, never COMPLETE", () => {
    // One nominee's film title emptied (field present, value gone): the entry
    // is skipped AND the marker gap is still detected — one path cannot hide it.
    const emptied = OSCAR_2024.replace(
      ">Poor Things</div>",
      "></div>",
    )
    expect(emptied).not.toBe(OSCAR_2024)
    const parsed = parseOscarCeremony(oscarPage(emptied, 2024), CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(9)
    expect(parsed.rows.every((r: { title: string }) => r.title !== "Poor Things")).toBe(true)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "honoree-unparsed")).toBe(true)
    expect(parsed.meta.winnerCount === 1 && parsed.meta.skippedCount === 0).toBe(false)
  })

  it("nested HTML in film title: unparsed → PARTIAL, never COMPLETE", () => {
    const nested = OSCAR_2024.replace(
      ">Oppenheimer</div>",
      "><em>Oppenheimer</em></div>",
    )
    expect(nested).not.toBe(OSCAR_2024)
    const parsed = parseOscarCeremony(oscarPage(nested, 2024), CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows.every((r: { title: string }) => r.title !== "Oppenheimer")).toBe(true)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "honoree-unparsed")).toBe(true)
    expect(parsed.meta.winnerCount).toBe(0)
    expect(parsed.meta.winnerCount === 1 && parsed.meta.skippedCount === 0).toBe(false)
  })

  it("duplicate honoree title: kept once, duplicate reported (PARTIAL)", () => {
    // Append one more nominee honoree block repeating an existing title (no
    // extra category block): 11 markers, the repeat is skipped, first kept.
    const repeat =
      '<div class="field field--name-field-honoree-type nominee">Nominees</div>' +
      '<div class="field"><div class="field field--name-field-award-film field--type-entity-reference field--label-hidden field__item">Poor Things</div></div>'
    const parsed = parseOscarCeremony(oscarPage(`${OSCAR_2024}${repeat}`, 2024), CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.meta.totalHonorees).toBe(11)
    expect(parsed.rows).toHaveLength(10)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "duplicate-source-entry")).toBe(true)
    expect(parsed.meta.skippedCount).toBeGreaterThan(0)
  })

  it("non-Best-Picture requested category is rejected", () => {
    const parsed = parseOscarCeremony(oscarPage(OSCAR_2024, 2024), { ...CTX, category: "Best Actor" })
    expect(parsed.ok).toBe(false)
    expect(parsed.rows).toEqual([])
  })
})

describe("source adapters: Globe awdb parser vs real fixtures", () => {
  it("2024 film drama: 6 rows, Oppenheimer winner", () => {
    const parsed = parseGlobeNominations(GLOBE_BP_2024, GLOBE_BP_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(6)
    expect(parsed.meta.winnerCount).toBe(1)
    expect(parsed.rows.find((r: { status: string }) => r.status === "winner")?.title).toBe("Oppenheimer")
  })

  it("2008 tv drama: 6 rows, Mad Men winner, entity decoded + sort-order unsorted", () => {
    const parsed = parseGlobeNominations(GLOBE_TV_2008, {
      ...GLOBE_BP_CTX,
      url: "https://goldenglobes.com/wp-json/awdb/v1/nominations/?page=1&year=2008&award=y",
      year: 2008,
      award: "Best Television Series - Drama",
      family: "globe-tv",
      category: "Best Television Series - Drama",
      media: "tv",
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(6)
    expect(parsed.rows.find((r: { status: string }) => r.status === "winner")?.title).toBe("Mad Men")
    const titles = parsed.rows.map((r: { title: string }) => r.title)
    expect(titles).toContain("Grey's Anatomy")
    expect(titles).toContain("The Tudors")
    expect(titles).not.toContain("Tudors, The")
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "title-unsorted")).toBe(true)
  })

  it("2008 limited: 5 rows, Longford winner, official award name exact", () => {
    const award = "Best Television Limited Series, Anthology Series, or Motion Picture Made for Television"
    const parsed = parseGlobeNominations(GLOBE_LTD_2008, {
      ...GLOBE_BP_CTX,
      url: "https://goldenglobes.com/wp-json/awdb/v1/nominations/?page=1&year=2008&award=z",
      year: 2008,
      award,
      family: "globe-tv",
      category: "Best Limited or Anthology Series or TV Film",
      media: "tv",
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.rows.find((r: { status: string }) => r.status === "winner")?.title).toBe("Longford")
    expect(parsed.rows.every((r: { media: string }) => r.media === "tv")).toBe(true)
  })

  it("award-name mismatch rows are skipped, never accepted under requested award", () => {
    const doc = JSON.parse(GLOBE_BP_2024) as Array<Record<string, unknown>>
    doc[0].award = "Best Motion Picture - Musical or Comedy"
    const parsed = parseGlobeNominations(JSON.stringify(doc), GLOBE_BP_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "award-mismatch")).toBe(true)
  })

  it("year-mismatch rows are skipped, never accepted under requested year", () => {
    const doc = JSON.parse(GLOBE_BP_2024) as Array<Record<string, unknown>>
    doc[2].year = "2023"
    const parsed = parseGlobeNominations(JSON.stringify(doc), GLOBE_BP_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows.every((r: { title: string }) => r.title !== "Oppenheimer")).toBe(true)
    expect(parsed.meta.winnerCount).toBe(0)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "year-mismatch")).toBe(true)
  })

  it("non-boolean winner flag is skipped, never invented", () => {
    const doc = JSON.parse(GLOBE_BP_2024) as Array<Record<string, unknown>>
    doc[2].winner = "yes"
    const parsed = parseGlobeNominations(JSON.stringify(doc), GLOBE_BP_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows.every((r: { title: string }) => r.title !== "Oppenheimer")).toBe(true)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "winner-flag-unknown")).toBe(true)
  })

  it("multi-nominee entries are skipped (no invented single title)", () => {
    const doc = JSON.parse(GLOBE_BP_2024) as Array<Record<string, unknown>>
    const nominees = doc[0].nominees as Array<Record<string, unknown>>
    doc[0].nominees = [...nominees, { ...nominees[0], title: "Second Title" }]
    const parsed = parseGlobeNominations(JSON.stringify(doc), GLOBE_BP_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "nominees-shape")).toBe(true)
  })

  it("duplicate source titles: kept once, duplicate reported (PARTIAL)", () => {
    const doc = JSON.parse(GLOBE_BP_2024) as Array<Record<string, unknown>>
    doc.push(JSON.parse(JSON.stringify(doc[0])))
    const parsed = parseGlobeNominations(JSON.stringify(doc), GLOBE_BP_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(6)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "duplicate-source-entry")).toBe(true)
    expect(parsed.meta.skippedCount).toBe(1)
  })

  it("malformed JSON and non-array bodies yield 0 rows", () => {
    expect(parseGlobeNominations("not json", GLOBE_BP_CTX)).toMatchObject({ ok: false, reason: "globe-not-json-array", rows: [] })
    expect(parseGlobeNominations('{"a":1}', GLOBE_BP_CTX)).toMatchObject({ ok: false, reason: "globe-not-json-array", rows: [] })
    expect(parseGlobeNominations("[]", GLOBE_BP_CTX)).toMatchObject({ ok: false, reason: "globe-no-rows", rows: [] })
  })

  it("film-typed row under a tv drama category is skipped; under limited it is review-required, never coerced to tv", () => {
    const doc = JSON.parse(GLOBE_TV_2008) as Array<Record<string, unknown>>
    doc[0].nominee_type = "film"
    const drama = parseGlobeNominations(JSON.stringify(doc), {
      ...GLOBE_BP_CTX,
      year: 2008,
      award: "Best Television Series - Drama",
      family: "globe-tv",
      category: "Best Television Series - Drama",
      media: "tv",
    })
    expect(drama.rows).toHaveLength(5)
    expect(drama.findings.some((f: { kind: string }) => f.kind === "nominee-type-unexpected")).toBe(true)
    const ltdDoc = JSON.parse(GLOBE_LTD_2008) as Array<Record<string, unknown>>
    ltdDoc[0].nominee_type = "film"
    const award = "Best Television Limited Series, Anthology Series, or Motion Picture Made for Television"
    const ltd = parseGlobeNominations(JSON.stringify(ltdDoc), {
      ...GLOBE_BP_CTX,
      year: 2008,
      award,
      family: "globe-tv",
      category: "Best Limited or Anthology Series or TV Film",
      media: "tv",
    })
    // No namespace coercion: the film-typed entry is skipped review-required,
    // never emitted as a tv row (a TV film is often a TMDB MOVIE).
    expect(ltd.ok).toBe(true)
    expect(ltd.rows).toHaveLength(4)
    expect(ltd.rows.every((r: { media: string }) => r.media === "tv")).toBe(true)
    expect(ltd.rows.every((r: { title: string }) => r.title !== "Bury My Heart at Wounded Knee")).toBe(true)
    expect(ltd.findings.some((f: { kind: string }) => f.kind === "limited-film-review-required")).toBe(true)
    expect(ltd.findings.some((f: { kind: string }) => f.kind === "media-coerced")).toBe(false)
    expect(ltd.meta.skippedCount).toBe(1)
  })

  it("real Longford2008: official nominee_type preserved as evidence; movie/tv numeric collision never merges", async () => {
    const award = "Best Television Limited Series, Anthology Series, or Motion Picture Made for Television"
    const parsed = parseGlobeNominations(GLOBE_LTD_2008, {
      ...GLOBE_BP_CTX,
      url: "https://goldenglobes.com/wp-json/awdb/v1/nominations/?page=1&year=2008&award=z",
      year: 2008,
      award,
      family: "globe-tv",
      category: "Best Limited or Anthology Series or TV Film",
      media: "tv",
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(5)
    expect(parsed.rows.find((r: { status: string }) => r.status === "winner")?.title).toBe("Longford")
    // Official source media preserved verbatim on every row (evidence, not identity).
    expect(parsed.rows.every((r: { sourceNomineeType: string }) => r.sourceNomineeType === "tv-show")).toBe(true)
    // Same numeric TMDB id in MOVIE vs TV namespaces: distinct candidates,
    // distinct curated sets — never merged, never cross-attached.
    const { normalizeRow, resolveIdentities, diffAgainstCurated, parseCuratedNumbers } =
      await import("../../scripts/awards-updater-lib.mjs")
    const tvNorm = normalizeRow({
      family: "globe-tv", category: "Best Limited or Anthology Series or TV Film",
      status: "winner", year: 2008, title: "Longford", media: "tv",
      tmdbId: 12345, source: "official", verificationLevel: "official-listed",
    })
    const movieNorm = normalizeRow({
      family: "globe-film", category: "Best Motion Picture - Drama",
      status: "nominee", year: 2008, title: "Longford", media: "movie",
      tmdbId: 12345, source: "official", verificationLevel: "official-listed",
    })
    expect(tvNorm.ok).toBe(true)
    expect(movieNorm.ok).toBe(true)
    if (!tvNorm.ok || !movieNorm.ok) throw new Error("Longford collision fixture rows must normalize")
    const { candidates, findings } = resolveIdentities([tvNorm.row, movieNorm.row])
    expect(findings).toEqual([])
    expect(candidates).toHaveLength(2)
    expect(candidates.map((c: { media: string }) => c.media).sort()).toEqual(["movie", "tv"])
    const byMedia = new Map(candidates.map((c: { media: string; tmdbId: number | null }): [string, { media: string; tmdbId: number | null }] => [c.media, c]))
    expect(byMedia.get("tv")?.tmdbId).toBe(12345)
    expect(byMedia.get("movie")?.tmdbId).toBe(12345)
    // Curated-set routing stays namespace-local: the tv id never lands in a
    // movie set and vice versa (winner tv -> GLOBE_WINNER_TV_IDS only).
    const curated = parseCuratedNumbers("const GLOBE_WINNER_TV_IDS: number[] = new Set([1]);\nconst GLOBE_NOMINEE_TV_IDS: number[] = new Set([]);\nconst GLOBE_WINNER_MOVIE_IDS: number[] = new Set([]);\nconst GLOBE_NOMINEE_MOVIE_IDS: number[] = new Set([]);\n")
    const diff = diffAgainstCurated(curated, candidates)
    const tvAdd = diff.additions.find((a: { media: string }) => a.media === "tv")
    const movieAdd = diff.additions.find((a: { media: string }) => a.media === "movie")
    expect(tvAdd?.setName).toBe("GLOBE_WINNER_TV_IDS")
    expect(movieAdd?.setName).toBe("GLOBE_NOMINEE_MOVIE_IDS")
  })

  it("film-typed Longford is never emitted as a tv row (no source-driven namespace coercion)", () => {
    const ltdDoc = JSON.parse(GLOBE_LTD_2008) as Array<Record<string, unknown>>
    const longford = ltdDoc.find((e) => (e.nominees as Array<Record<string, unknown>>)[0].title === "Longford")
    expect(longford).toBeDefined()
    longford!.nominee_type = "film"
    const award = "Best Television Limited Series, Anthology Series, or Motion Picture Made for Television"
    const parsed = parseGlobeNominations(JSON.stringify(ltdDoc), {
      ...GLOBE_BP_CTX,
      year: 2008,
      award,
      family: "globe-tv",
      category: "Best Limited or Anthology Series or TV Film",
      media: "tv",
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.rows.every((r: { title: string }) => r.title !== "Longford")).toBe(true)
    expect(parsed.findings.some((f: { kind: string; detail: string }) => f.kind === "limited-film-review-required" && f.detail.includes("Longford"))).toBe(true)
    // Winner lost with the skipped entry: winner-count is reported, never hidden.
    expect(parsed.meta.winnerCount).toBe(0)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "winner-count")).toBe(true)
  })

  it("duplicate winners keep rows but raise winner-count (human review)", () => {
    const doc = JSON.parse(GLOBE_BP_2024) as Array<Record<string, unknown>>
    doc[0].winner = true
    const parsed = parseGlobeNominations(JSON.stringify(doc), GLOBE_BP_CTX)
    expect(parsed.ok).toBe(true)
    expect(parsed.meta.winnerCount).toBe(2)
    expect(parsed.findings.some((f: { kind: string }) => f.kind === "winner-count")).toBe(true)
  })

  it("GLOBE_AWARD_NAME_FOR matches the official /filters award names", () => {
    const filters = JSON.parse(fix("globe-filters-2026-10-22.json")) as { awards: string[] }
    for (const name of Object.values(GLOBE_AWARD_NAME_FOR)) {
      expect(filters.awards).toContain(name)
    }
  })

  it("entity decoder + title unsort basics", () => {
    expect(decodeHtmlEntities("Grey&#x27;s Anatomy")).toBe("Grey's Anatomy")
    expect(decodeHtmlEntities("A &amp; B")).toBe("A & B")
    expect(unsortGlobeTitle("Tudors, The")).toEqual({ title: "The Tudors", unsorted: true })
    expect(unsortGlobeTitle("Mad Men")).toEqual({ title: "Mad Men", unsorted: false })
  })
})

describe("source adapters: liveCollect integration (mocked fetch)", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.PICTORIUM_TMDB_KEY
  })

  const emptySparql = () =>
    new Response(JSON.stringify({ results: { bindings: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })

  it("oscar live: 10 parsed rows, COMPLETE coverage, zero invented ids", async () => {
    globalThis.fetch = stubFetch(async (url) => {
      const u = String(url)
      if (u.includes("oscars.org/oscars/ceremonies/2024")) {
        return new Response(oscarPage(OSCAR_2024, 2024), { status: 200 })
      }
      if (u.includes("query.wikidata.org")) return emptySparql()
      throw new Error(`unexpected fetch ${u}`)
    })
    const out = await liveCollect({ family: "oscar", years: [2024], timeoutMs: 5000, retries: 0, concurrency: 1, keyPresent: false })
    expect(out.parsedRows).toHaveLength(10)
    expect(out.parsedRows.every((r: { tmdbId: null }) => r.tmdbId === null)).toBe(true)
    expect(out.coverage).toHaveLength(1)
    expect(out.coverage[0].line).toContain("COMPLETE for requested scope")
    expect(out.parseFindings.filter((f: { kind: string }) => f.kind === "identity-unresolved")).toHaveLength(10)
  })

  it("globe live blocked (403): INCOMPLETE coverage, 0 rows, nothing invented", async () => {
    globalThis.fetch = stubFetch(async (url) => {
      const u = String(url)
      if (u.includes("nominations/filters")) {
        return new Response(JSON.stringify({ awards_by_year: { 2024: ["Best Motion Picture - Drama", "Best Motion Picture - Musical or Comedy"] } }), { status: 200 })
      }
      if (u.includes("goldenglobes.com/wp-json")) {
        return new Response("blocked", { status: 403 })
      }
      if (u.includes("query.wikidata.org")) return emptySparql()
      throw new Error(`unexpected fetch ${u}`)
    })
    const out = await liveCollect({ family: "globe-film", years: [2024], timeoutMs: 5000, retries: 0, concurrency: 2, keyPresent: false })
    expect(out.parsedRows).toEqual([])
    expect(out.coverage).toHaveLength(2)
    for (const c of out.coverage) expect(c.line).toContain("INCOMPLETE live")
    expect(out.liveResults.filter((r: { outcome: string }) => r.outcome === "http-error")).toHaveLength(2)
  })

  it("globe live pagination truncation: page-1 rows kept, PARTIAL reported", async () => {
    globalThis.fetch = stubFetch(async (url) => {
      const u = String(url)
      if (u.includes("nominations/filters")) {
        return new Response(JSON.stringify({ awards_by_year: { 2024: ["Best Motion Picture - Drama"] } }), { status: 200 })
      }
      if (u.includes("page=1") && u.includes("Drama")) {
        return new Response(GLOBE_BP_2024, { status: 200, headers: { "x-wp-totalpages": "7", "x-wp-total": "42" } })
      }
      if (u.includes("goldenglobes.com/wp-json")) {
        return new Response("boom", { status: 500 })
      }
      if (u.includes("query.wikidata.org")) return emptySparql()
      throw new Error(`unexpected fetch ${u}`)
    })
    const out = await liveCollect({ family: "globe-film", years: [2024], timeoutMs: 5000, retries: 0, concurrency: 2, keyPresent: false })
    const drama = out.coverage.find((c: { category: string }) => c.category === "Best Motion Picture - Drama")
    expect(drama).toBeDefined()
    expect(out.parsedRows.length).toBeGreaterThan(0)
    expect(drama!.line).toContain("INCOMPLETE")
    expect(out.parseFindings.some((f: { kind: string }) => f.kind === "pagination-truncated")).toBe(true)
    expect(out.parseFindings.some((f: { kind: string }) => f.kind === "page-unavailable")).toBe(true)
  })

  it("globe live award-not-offered: skipped with explicit INCOMPLETE line", async () => {
    let pageHits = 0
    globalThis.fetch = stubFetch(async (url) => {
      const u = String(url)
      if (u.includes("nominations/filters")) {
        return new Response(JSON.stringify({ awards_by_year: { 1944: ["Picture"] } }), { status: 200 })
      }
      if (u.includes("goldenglobes.com/wp-json/awdb")) {
        pageHits++
        return new Response("[]", { status: 200 })
      }
      if (u.includes("query.wikidata.org")) return emptySparql()
      throw new Error(`unexpected fetch ${u}`)
    })
    const out = await liveCollect({ family: "globe-film", years: [2024], timeoutMs: 5000, retries: 0, concurrency: 1, keyPresent: false })
    expect(out.parsedRows).toEqual([])
    expect(out.coverage.every((c: { line: string }) => c.line.includes("no \"Best Motion Picture"))).toBe(true)
    expect(pageHits).toBe(2)
  })
})
