
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  normalizeRow,
  resolveIdentities,
  parseCuratedNumbers,
  diffAgainstCurated,
  extractItemListBlock,
  parseEmmyItemList,
  normalizeVerificationLevel,
  parseYearsSpec,
  clampTimeoutMs,
  clampRetries,
  clampConcurrency,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
} from "../../scripts/awards-updater-lib.mjs"

function norm(raw: unknown) {
  const n = normalizeRow(raw)
  if (!n.ok) throw new Error(`expected ok row: ${(n as { reason: string }).reason}`)
  return (n as { row: Record<string, unknown> }).row
}

const DEXTER_NOMINEE = {
  source: "https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-drama-series",
  year: 2008,
  family: "emmy",
  category: "Outstanding Drama Series",
  org: "Emmy",
  media: "tv",
  status: "nominee",
  title: "Dexter",
  tmdbId: 1405,
  imdbId: "tt0773262",
  verificationLevel: "official-nominee-listed",
}

describe("awards updater correction1: identity merges only on stable evidence", () => {
  it("conflicting IMDb ids for one title+org+media: conflict, no merge", () => {
    const rows = [
      norm(DEXTER_NOMINEE),
      norm({ ...DEXTER_NOMINEE, year: 2009, imdbId: "tt9999999" }),
    ]
    const { candidates, findings } = resolveIdentities(rows)
    expect(candidates).toEqual([])
    expect(findings).toHaveLength(1)
    expect(findings[0].detail).toMatch(/^conflicting-imdb-ids:/)
  })

  it("conflicting QIDs for one title+org+media: conflict, no merge", () => {
    const rows = [
      norm({ ...DEXTER_NOMINEE, wikidataQid: "Q23577" }),
      norm({ ...DEXTER_NOMINEE, year: 2009, wikidataQid: "Q123456" }),
    ]
    const { candidates, findings } = resolveIdentities(rows)
    expect(candidates).toEqual([])
    expect(findings).toHaveLength(1)
    expect(findings[0].detail).toMatch(/^conflicting-qids:/)
  })

  it("same-TMDB aliases (title spelling variants) merge; winner beats noms across aliases", () => {
    const rows = [
      norm({ ...DEXTER_NOMINEE, title: "DEXTER" }),
      norm({ ...DEXTER_NOMINEE, year: 2009, title: "Dexter", status: "winner" }),
    ]
    const { candidates, findings } = resolveIdentities(rows)
    expect(findings).toEqual([])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].status).toBe("winner")
    expect(candidates[0].tmdbId).toBe(1405)
    expect(candidates[0].titles.sort()).toEqual(["DEXTER", "Dexter"])
  })

  it("film/tv same numeric id stay isolated", () => {
    const rows = [
      norm(DEXTER_NOMINEE),
      norm({
        source: "https://www.oscars.org/oscars/ceremonies/2024",
        year: 2024, family: "oscar", category: "Best Picture", org: "Oscar",
        media: "movie", status: "nominee", title: "Dexter", tmdbId: 1405,
        verificationLevel: "fixture",
      }),
    ]
    const { candidates, findings } = resolveIdentities(rows)
    expect(findings).toEqual([])
    expect(candidates).toHaveLength(2)
  })
})

describe("awards updater correction1: diff never overlaps a known-good win", () => {
  function curatedWith(winnerIds: number[], nomineeIds: number[]) {
    const src = `const EMMY_WINNER_TV_IDS: ReadonlySet<number> = new Set([${winnerIds.join(",")}]);
const EMMY_NOMINEE_TV_IDS: ReadonlySet<number> = new Set([${nomineeIds.join(",")}]);`
    return parseCuratedNumbers(src)
  }

  it("nominee candidate already in curated WINNER set: no nominee addition (winner wins)", () => {
    const { candidates } = resolveIdentities([norm(DEXTER_NOMINEE)])
    const diff = diffAgainstCurated(curatedWith([1405], []), candidates)
    expect(diff.additions).toEqual([])
    expect(diff.alreadyPresent).toHaveLength(1)
    expect(diff.alreadyPresent[0]).toMatchObject({ setName: "EMMY_WINNER_TV_IDS", tmdbId: 1405, note: "winner-beats-nomination" })
  })

  it("winner candidate sitting in curated NOMINEE set: explicit reviewed move, no overlap", () => {
    const { candidates } = resolveIdentities([norm({ ...DEXTER_NOMINEE, status: "winner" })])
    const diff = diffAgainstCurated(curatedWith([], [1405]), candidates)
    expect(diff.additions).toEqual([])
    expect(diff.alreadyPresent).toEqual([])
    expect(diff.proposedMoves).toHaveLength(1)
    expect(diff.proposedMoves[0]).toMatchObject({ fromSet: "EMMY_NOMINEE_TV_IDS", toSet: "EMMY_WINNER_TV_IDS", tmdbId: 1405 })
  })

  it("winner candidate in neither set: addition to the winner set", () => {
    const { candidates } = resolveIdentities([norm({ ...DEXTER_NOMINEE, status: "winner" })])
    const diff = diffAgainstCurated(curatedWith([], []), candidates)
    expect(diff.additions).toHaveLength(1)
    expect(diff.additions[0]).toMatchObject({ setName: "EMMY_WINNER_TV_IDS", tmdbId: 1405 })
    expect(diff.proposedMoves).toEqual([])
  })
})

describe("awards updater correction1: strict curated parser fails closed", () => {
  const wrap = (body: string) => `const EMMY_WINNER_TV_IDS: ReadonlySet<number> = new Set([${body}]);`

  it("rejects expressions, spreads, strings, holes, duplicates, zero", () => {
    expect(() => parseCuratedNumbers(wrap("1405+1"))).toThrow(/unsupported-grammar/)
    expect(() => parseCuratedNumbers(wrap("...REST"))).toThrow(/unsupported-grammar/)
    expect(() => parseCuratedNumbers(wrap('"1405"'))).toThrow(/unsupported-grammar/)
    expect(() => parseCuratedNumbers(wrap("1405,,1406"))).toThrow(/unsupported-grammar/)
    expect(() => parseCuratedNumbers(wrap("1405,1405"))).toThrow(/duplicate-id:1405/)
    expect(() => parseCuratedNumbers(wrap("0"))).toThrow(/invalid-id/)
  })

  it("missing required set throws (never proposes all additions from a misparsed source)", () => {
    expect(() => parseCuratedNumbers(wrap("1405"), { required: ["EMMY_NOMINEE_TV_IDS"] })).toThrow(/missing-required-set:EMMY_NOMINEE_TV_IDS/)
  })

  it("empty set and trailing comma are legal", () => {
    const parsed = parseCuratedNumbers(wrap("") + "\nconst EMMY_NOMINEE_TV_IDS: ReadonlySet<number> = new Set([1405,]);")
    expect([...(parsed.get("EMMY_WINNER_TV_IDS") ?? [])]).toEqual([])
    expect([...(parsed.get("EMMY_NOMINEE_TV_IDS") ?? [])]).toEqual([1405])
  })

  it("real award-ids.ts: no phantom comment-year ids; Dexter set is exactly {1405}", () => {
    const src = fs.readFileSync(path.resolve("src/lib/award-ids.ts"), "utf-8")
    const parsed = parseCuratedNumbers(src, { required: ["EMMY_WINNER_TV_IDS", "EMMY_NOMINEE_TV_IDS"] })
    expect([...(parsed.get("EMMY_NOMINEE_TV_IDS") ?? [])]).toEqual([1405])
    // The old digit-regex swallowed comment years (e.g. `// 2015 Spotlight`)
    // as ids: those ceremony years must not appear as curated Oscar winners.
    const oscarWinners = parsed.get("OSCAR_WINNER_MOVIE_IDS") ?? new Set()
    for (let y = 2015; y <= 2024; y++) expect(oscarWinners.has(y)).toBe(false)
  })
})

describe("awards updater correction1: explicit bounds", () => {
  it("parseYearsSpec enforces range width, total width, and realistic window", () => {
    expect(parseYearsSpec("2008-2011")).toEqual([2008, 2009, 2010, 2011])
    expect(() => parseYearsSpec("2000-2035")).toThrow(/too wide/)
    expect(() => parseYearsSpec("1997-2007,2008-2018,2019-2027")).toThrow(/total too wide/)
    expect(() => parseYearsSpec("1900")).toThrow(/realistic window/)
    expect(() => parseYearsSpec("3000")).toThrow(/realistic window/)
    expect(() => parseYearsSpec("")).toThrow(/required/)
    expect(MAX_TIMEOUT_MS).toBe(30000)
    expect(MIN_TIMEOUT_MS).toBe(1000)
  })

  it("clamps have both min and max", () => {
    expect(clampTimeoutMs(999999)).toBe(30000)
    expect(clampTimeoutMs(10)).toBe(1000)
    expect(clampRetries(9)).toBe(2)
    expect(clampConcurrency(9)).toBe(4)
    expect(clampConcurrency(0)).toBe(1)
  })
})

describe("awards updater correction1: verification labels are explicit, never trusted", () => {
  it("unknown input labels collapse to unverified-input", () => {
    expect(normalizeVerificationLevel("verified")).toBe("unverified-input")
    expect(normalizeVerificationLevel("official-nominee-listed")).toBe("official-nominee-listed")
    const n = normalizeRow({ ...DEXTER_NOMINEE, verificationLevel: "verified" })
    expect(n.ok).toBe(true)
    if (n.ok) expect(n.row.verificationLevel).toBe("unverified-input")
  })
})

describe("awards updater correction1: Emmy ItemList parser vs real captured pages", () => {
  const dramaBlock = fs.readFileSync(
    path.resolve("scripts/awards-updater/fixtures/emmy-2008-drama-itemlist.json"), "utf-8",
  )
  const comedyBlock = fs.readFileSync(
    path.resolve("scripts/awards-updater/fixtures/emmy-2008-comedy-itemlist.json"), "utf-8",
  )
  const ctx = { url: "https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-drama-series", year: 2008, category: "Outstanding Drama Series" }

  it("parses the real 2008 drama page: 6 rows, Mad Men winner, Dexter nominee", () => {
    const parsed = parseEmmyItemList(dramaBlock, ctx)
    expect(parsed.ok).toBe(true)
    expect(parsed.rows).toHaveLength(6)
    expect(parsed.meta.winnerCount).toBe(1)
    const winner = parsed.rows.find((r) => r.status === "winner")
    expect(winner?.title).toBe("Mad Men")
    const dexter = parsed.rows.find((r) => r.title === "Dexter")
    expect(dexter).toMatchObject({ status: "nominee", year: 2008, family: "emmy", media: "tv" })
  })

  it("parses the real 2008 comedy page with exactly one winner", () => {
    const parsed = parseEmmyItemList(comedyBlock, {
      url: "https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-comedy-series",
      year: 2008, category: "Outstanding Comedy Series",
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.rows.length).toBeGreaterThan(0)
    expect(parsed.meta.winnerCount).toBe(1)
  })

  it("extractItemListBlock returns null when the markup changed (no ItemList)", () => {
    expect(extractItemListBlock("<html><body>redesign</body></html>")).toBeNull()
  })

  it("malformed/changed markup fails closed with reasons, never invents rows", () => {
    expect(parseEmmyItemList("not json", ctx).ok).toBe(false)
    expect(parseEmmyItemList('{"@type":"WebSite"}', ctx)).toMatchObject({ ok: false, reason: "itemlist-shape" })
    // Correction2 hard-reject: a missing/unknown list header yields zero rows
    // with the precise header reason (still fail-closed, never invented rows).
    const noName = parseEmmyItemList('{"@type":"ItemList","itemListElement":[]}', ctx)
    expect(noName).toMatchObject({ ok: false, reason: "list-name-unexpected" })
    expect(noName.rows).toEqual([])
    const missing = parseEmmyItemList(
      '{"@type":"ItemList","name":"2008 Emmy Awards - Outstanding Drama Series","itemListElement":[{"position":1,"item":{"@type":"TVSeries"}}]}',
      ctx,
    )
    expect(missing.ok).toBe(false)
    expect(missing.reason).toBe("itemlist-no-rows")
    expect(missing.findings.some((f) => f.kind === "item-skipped")).toBe(true)
    const unknown = parseEmmyItemList(
      '{"@type":"ItemList","name":"2008 Emmy Awards - Outstanding Drama Series","itemListElement":[{"position":1,"item":{"@type":"TVSeries","name":"X","award":"Outstanding Drama Series - 2008 Emmy Awards Finalist"}}]}',
      ctx,
    )
    expect(unknown.ok).toBe(false)
    expect(unknown.findings.some((f) => f.kind === "award-status-unknown")).toBe(true)
  })
})
