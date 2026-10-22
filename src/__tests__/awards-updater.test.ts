import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  APPROVED_CATEGORIES,
  officialSourceUrls,
  officialSourcePages,
  normalizeRow,
  resolveIdentities,
  parseCuratedNumbers,
  diffAgainstCurated,
  renderReport,
} from "../../scripts/awards-updater-lib.mjs"
import { lookupAwardIds } from "@/lib/award-ids"
import { strictMainCategoryOrgs } from "@/lib/awards"
import { computeTopBadge } from "@/lib/poster-badge"
import { createT } from "@/lib/i18n"

const t = createT("it")

const DEXTER_ROW = {
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

function norm(raw: unknown) {
  const n = normalizeRow(raw)
  if (!n.ok) throw new Error(`expected ok row: ${(n as { reason: string }).reason}`)
  return (n as { row: Record<string, unknown> }).row
}

describe("awards updater: normalization (approved main categories only)", () => {
  it("accepts the authorized Dexter Emmy nominee row with full provenance", () => {
    const n = normalizeRow(DEXTER_ROW)
    expect(n.ok).toBe(true)
    if (n.ok) {
      expect(n.row.tmdbId).toBe(1405)
      expect(n.row.imdbId).toBe("tt0773262")
      expect(n.row.source).toContain("televisionacademy.com")
    }
  })

  it("rejects unknown family/category/status as review-required (never invented)", () => {
    expect(normalizeRow({ ...DEXTER_ROW, family: "grammy" }).ok).toBe(false)
    expect(normalizeRow({ ...DEXTER_ROW, category: "Best Actor" }).ok).toBe(false)
    expect(normalizeRow({ ...DEXTER_ROW, category: "Outstanding Drama" }).ok).toBe(false)
    expect(normalizeRow({ ...DEXTER_ROW, status: "shortlisted" }).ok).toBe(false)
    const bad = normalizeRow({ ...DEXTER_ROW, category: "Best Actor" }) as { ok: boolean; reason: string }
    expect(bad.ok).toBe(false)
    expect(bad.reason).toMatch(/^unknown-category:/)
  })

  it("rejects media mismatch (Emmy top-series is tv-only)", () => {
    const bad = normalizeRow({ ...DEXTER_ROW, media: "movie" }) as { ok: boolean; reason: string }
    expect(bad.ok).toBe(false)
    expect(bad.reason).toMatch(/^media-mismatch:expected-tv/)
  })

  it("rejects invalid identities (never guessed)", () => {
    expect((normalizeRow({ ...DEXTER_ROW, tmdbId: -3 }) as { ok: boolean }).ok).toBe(false)
    expect((normalizeRow({ ...DEXTER_ROW, tmdbId: 14.5 }) as { ok: boolean }).ok).toBe(false)
    expect((normalizeRow({ ...DEXTER_ROW, imdbId: "tt123" }) as { ok: boolean }).ok).toBe(false)
    expect((normalizeRow({ ...DEXTER_ROW, imdbId: "nonsense" }) as { ok: boolean }).ok).toBe(false)
  })

  it("normalizes IMDb ids case-insensitively", () => {
    const row = norm({ ...DEXTER_ROW, imdbId: "TT0773262" })
    expect(row.imdbId).toBe("tt0773262")
  })
})

describe("awards updater: updater category table matches the runtime strict QID gate (no drift)", () => {
  it("every approved entry resolves to its org on the right media and nothing cross-media", () => {
    for (const c of APPROVED_CATEGORIES) {
      expect(strictMainCategoryOrgs(c.qids, c.media as "movie" | "tv")).toContain(c.org)
      const other = c.media === "movie" ? "tv" : "movie"
      expect(strictMainCategoryOrgs(c.qids, other as "movie" | "tv")).toEqual([])
    }
  })

  it("official source builders point at the approved official pages (all live Emmy categories)", () => {
    expect(officialSourceUrls("emmy", 2008)).toEqual([
      "https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-drama-series",
      "https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-comedy-series",
      "https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-miniseries-or-movie",
    ])
  })

  it("official source pages mark Oscar/Globe live adapters SUPPORTED with exact official URLs", () => {
    const oscar = officialSourcePages("oscar", 2024)
    expect(oscar).toHaveLength(1)
    expect(oscar[0]).toMatchObject({
      url: "https://www.oscars.org/oscars/ceremonies/2024",
      year: 2024,
      category: "Best Picture",
      adapter: "oscar-ceremony",
      supported: true,
    })
    const globe = officialSourcePages("globe-film", 2024)
    expect(globe).toHaveLength(2)
    for (const p of globe) {
      expect(p.supported).toBe(true)
      expect(p.adapter).toBe("globe-awdb")
      expect(p.url).toContain("goldenglobes.com/wp-json/awdb/v1/nominations/")
      expect(p.url).toContain("year=2024")
    }
    expect(officialSourcePages("emmy", 2008).map((p) => p.category).sort()).toEqual([
      "Outstanding Comedy Series",
      "Outstanding Drama Series",
      "Outstanding Limited Series",
    ])
    expect(officialSourcePages("emmy", 2008).find((p) => p.category === "Outstanding Limited Series")?.url).toBe(
      "https://www.televisionacademy.com/awards/nominees-winners/2008/outstanding-miniseries-or-movie",
    )
    expect(officialSourcePages("emmy", 2024).find((p) => p.category === "Outstanding Limited Series")?.url).toBe(
      "https://www.televisionacademy.com/awards/nominees-winners/2024/outstanding-miniseries",
    )
  })
})

describe("awards updater: identity resolution", () => {
  it("duplicate title across years: one eligible winner beats nomination (title+org+media)", () => {
    const rows = [
      norm({ ...DEXTER_ROW, year: 2009, status: "nominee" }),
      norm({ ...DEXTER_ROW, year: 2010, status: "nominee" }),
      norm({ ...DEXTER_ROW, year: 2008, status: "winner", source: "https://www.televisionacademy.com/shows/dexter" }),
    ]
    const { candidates, findings } = resolveIdentities(rows)
    expect(findings).toEqual([])
    expect(candidates).toHaveLength(1)
    expect(candidates[0].status).toBe("winner")
    expect(candidates[0].tmdbId).toBe(1405)
    expect(candidates[0].years).toEqual([2008, 2009, 2010])
  })

  it("film/tv same numeric id never merge (media is part of the key)", () => {
    const rows = [
      norm({ ...DEXTER_ROW, title: "Same Number", tmdbId: 1405 }),
      norm({
        source: "https://www.oscars.org/oscars/ceremonies/2024",
        year: 2024, family: "oscar", category: "Best Picture", org: "Oscar",
        media: "movie", status: "nominee", title: "Same Number", tmdbId: 1405,
        verificationLevel: "fixture",
      }),
    ]
    const { candidates, findings } = resolveIdentities(rows)
    expect(findings).toEqual([])
    expect(candidates).toHaveLength(2)
    expect(candidates.map((c) => `${c.org}/${c.media}/${c.tmdbId}`).sort()).toEqual([
      "Emmy/tv/1405",
      "Oscar/movie/1405",
    ])
  })

  it("distinct TMDB ids for one title+org+media: conflict, no candidate (never blind)", () => {
    const rows = [
      norm(DEXTER_ROW),
      norm({ ...DEXTER_ROW, year: 2009, tmdbId: 99999 }),
    ]
    const { candidates, findings } = resolveIdentities(rows)
    expect(candidates).toEqual([])
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe("conflict")
    expect(findings[0].detail).toContain("1405")
    expect(findings[0].detail).toContain("99999")
  })

  it("rows without any stable id are needs-id findings, never auto-imported", () => {
    const rows = [
      norm({ ...DEXTER_ROW, tmdbId: null, imdbId: null, wikidataQid: null }),
    ]
    const { candidates, findings } = resolveIdentities(rows)
    expect(candidates).toEqual([])
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe("needs-id")
  })

  it("IMDb-only rows resolve identity-pending (verified resolution required, never guessed)", () => {
    const rows = [norm({ ...DEXTER_ROW, tmdbId: null })]
    const { candidates } = resolveIdentities(rows)
    expect(candidates).toHaveLength(1)
    expect(candidates[0].tmdbId).toBeNull()
    expect(candidates[0].imdbId).toBe("tt0773262")
    const diff = diffAgainstCurated(new Map(), candidates)
    // No TMDB id: NEVER an addition.
    expect(diff.additions).toEqual([])
    expect(diff.pendingId).toHaveLength(1)
  })
})

describe("awards updater: diff against current curated lists", () => {
  it("parseCuratedNumbers strips year comments (2015 is not an id)", () => {
    const source = `const OSCAR_WINNER_MOVIE_IDS: ReadonlySet<number> = new Set([
      314365, // 2015  Spotlight
      /* 2016 block */ 376867,
    ]);`
    const parsed = parseCuratedNumbers(source)
    const ids = [...(parsed.get("OSCAR_WINNER_MOVIE_IDS") ?? new Set())].sort((a, b) => a - b)
    expect(ids).toEqual([314365, 376867])
  })

  it("Dexter 1405 tv is an addition vs empty curated, already-present vs current source", () => {
    const { candidates } = resolveIdentities([norm(DEXTER_ROW)])
    const vsEmpty = diffAgainstCurated(new Map(), candidates)
    expect(vsEmpty.additions).toHaveLength(1)
    expect(vsEmpty.additions[0]).toMatchObject({ setName: "EMMY_NOMINEE_TV_IDS", tmdbId: 1405, status: "nominee" })

    const realSource = fs.readFileSync(path.resolve("src/lib/award-ids.ts"), "utf-8")
    const vsCurrent = diffAgainstCurated(parseCuratedNumbers(realSource), candidates)
    expect(vsCurrent.additions).toEqual([])
    expect(vsCurrent.alreadyPresent).toHaveLength(1)
    expect(vsCurrent.alreadyPresent[0]).toMatchObject({ setName: "EMMY_NOMINEE_TV_IDS", tmdbId: 1405 })
  })

  it("failure retention: empty/partial upstream never proposes removals", () => {
    const realSource = fs.readFileSync(path.resolve("src/lib/award-ids.ts"), "utf-8")
    const curated = parseCuratedNumbers(realSource)
    const empty = diffAgainstCurated(curated, [])
    expect(empty.additions).toEqual([])
    expect(empty.proposedRemovals).toEqual([])
  })

  it("proposed removals require evidence + explicit human review", () => {
    const curated = parseCuratedNumbers(fs.readFileSync(path.resolve("src/lib/award-ids.ts"), "utf-8"))
    const noEvidence = diffAgainstCurated(curated, [], [{ tmdbId: 1405, setName: "EMMY_NOMINEE_TV_IDS" }])
    expect(noEvidence.proposedRemovals).toEqual([])
    const withEvidence = diffAgainstCurated(curated, [], [
      { tmdbId: 1405, setName: "EMMY_NOMINEE_TV_IDS", evidence: "https://example/retraction-proof", reviewedBy: "human" },
    ])
    expect(withEvidence.proposedRemovals).toHaveLength(1)
  })
})

describe("awards updater: report is explicit and honest", () => {
  it("states provenance, failure retention, manual steps; never claims completeness", () => {
    const { candidates, findings } = resolveIdentities([norm(DEXTER_ROW)])
    const diff = diffAgainstCurated(new Map(), candidates)
    const report = renderReport({
      family: "emmy",
      years: "2008",
      generatedAt: "2026-10-22T00:00:00.000Z",
      liveAttempted: false,
      normalizedCount: 1,
      invalidRows: [{ reason: "unknown-category:Best Actor", raw: {} }],
      candidates,
      findings,
      diff,
    })
    expect(report).toContain("EMMY_NOMINEE_TV_IDS")
    expect(report).toContain("1405")
    expect(report).toContain("televisionacademy.com/awards/nominees-winners/2008/outstanding-drama-series")
    expect(report).toContain("NEVER remove known-good entries")
    expect(report).toContain("INCOMPLETE")
    expect(report).toContain("Manual apply steps")
    expect(report).not.toContain("100%")
  })
})

describe("awards updater: deterministic offline fixture (no credentials, no network)", () => {
  const fixturePath = path.resolve("scripts/awards-updater/fixtures/dexter-2008-2011.json")

  function runFixture() {
    const raw = JSON.parse(fs.readFileSync(fixturePath, "utf-8"))
    const normalized: unknown[] = []
    const invalidRows: unknown[] = []
    for (const r of raw) {
      const n = normalizeRow(r)
      if (n.ok) normalized.push(n.row)
      else invalidRows.push(n)
    }
    return { normalized, invalidRows, ...resolveIdentities(normalized as never[]) }
  }

  it("all fixture rows normalize; Dexter collapses to one nominee, Mad Men stays winner", () => {
    const { normalized, invalidRows, candidates, findings } = runFixture()
    expect(invalidRows).toEqual([])
    expect(normalized).toHaveLength(5)
    expect(findings).toEqual([])
    expect(candidates).toHaveLength(2)
    const dexter = candidates.find((c) => c.tmdbId === 1405)
    expect(dexter).toMatchObject({ org: "Emmy", media: "tv", status: "nominee", years: [2008, 2009, 2010, 2011] })
    const madMen = candidates.find((c) => c.tmdbId === 1104)
    expect(madMen).toMatchObject({ org: "Emmy", media: "tv", status: "winner" })
  })

  it("fixture run is deterministic (repeat identical, no I/O inside the lib)", () => {
    expect(JSON.stringify(runFixture())).toBe(JSON.stringify(runFixture()))
  })
})

describe("Dexter curated Emmy nominee (authorized backfill exception)", () => {
  const base = {
    mediaType: "tv" as const,
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

  it("lookupAwardIds(1405, tv) is an Emmy nomination, never a win; movie is empty", () => {
    expect(lookupAwardIds(1405, "tv")).toEqual({ wins: [], noms: ["Emmy"] })
    expect(lookupAwardIds(1405, "movie")).toEqual({ wins: [], noms: [] })
    expect(lookupAwardIds(null, "tv")).toEqual({ wins: [], noms: [] })
  })

  it("Dexter renders the eligible short label Candidato Emmy (award bucket, default order)", () => {
    const c = computeTopBadge({ ...base, tmdbId: 1405 }, t, "it")
    expect(c.awardBadge).toBeNull()
    expect(c.badge?.label).toBe("Candidato Emmy")
  })

  it("an explicit Emmy win still beats the curated Dexter nomination (precedence preserved)", () => {
    const c = computeTopBadge({ ...base, tmdbId: 1405, awards: ["Emmy"] }, t, "it")
    expect(c.awardBadge).toBe("Vincitore Emmy")
    expect(c.badge?.label).toBe("Vincitore Emmy")
  })
})
