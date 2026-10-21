import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { lookupAVSpecs } from "@/lib/av-specs"
import {
  MANUAL_ALGORITHM_SERIES,
  MANUAL_IDENTITY_METHOD,
  MANUAL_SEMANTICS,
  MANUAL_SOURCE,
  MANUAL_VERIFICATION,
  buildManualProvenanceEntry,
  parseManualArgs,
  runManualInsert,
  sameStorePath,
  validateManualInsert,
} from "../../../scripts/torrentio-manual-insert.mjs"

// Historic post-union baseline for the original 1430-row set (same constant
// as torrentio-av-import-union832.test.ts; kept as history, never re-pinned).
const POST_UNION_DB_SHA256 = "099560c0eec8e28369fe8839462760653b15aedd8e726544715294c3bca44058"

const ROOT = path.resolve(__dirname, "../../..")

const REACHER_SPEC = {
  id: "tt9288030",
  tmdbId: 108978,
  type: "series",
  quality: "4K",
  formats: ["dv", "hdr", "hdr10plus", "atmos"],
  season: 2,
  episode: 4,
  airDate: "2023-12-22",
  observedAt: "2026-10-21",
  scope: "manual-insert:series,operator-selected-s02e4",
  // Two separate S02E04 sample observations (same episode): the declared
  // union is their set union, never a single-file tuple claim.
  samples: [
    { quality: "4K", formats: ["dv", "hdr", "atmos"] },
    { quality: "4K", formats: ["dv", "hdr10plus"] },
  ],
}

function sha256Hex(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex")
}

describe("torrentio-manual-insert arg parsing (offline, dry-run by default)", () => {
  it("defaults to dry-run and rejects unknown/duplicate flags", () => {
    const parsed = parseManualArgs([])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error("expected ok")
    expect(parsed.args.apply).toBe(false)
    expect(parseManualArgs(["--bogus"]).ok).toBe(false)
    expect(parseManualArgs(["--apply", "--apply"]).ok).toBe(false)
    expect(parseManualArgs(["--id", "tt9288030", "--id", "tt9288030"]).ok).toBe(false)
  })

  it("rejects non-integer numeric ids", () => {
    expect(parseManualArgs(["--tmdb-id", "abc"]).ok).toBe(false)
    expect(parseManualArgs(["--season", "2.5"]).ok).toBe(false)
  })
})

describe("validateManualInsert (fail-closed, new ids only, allowlisted enums)", () => {
  it("accepts the authorized Reacher series spec", () => {
    expect(validateManualInsert(REACHER_SPEC)).toBeNull()
  })

  it("rejects malformed identities and types", () => {
    expect(validateManualInsert({ ...REACHER_SPEC, id: "9288030" })).toContain("invalid IMDb id")
    expect(validateManualInsert({ ...REACHER_SPEC, id: "tt123" })).toContain("invalid IMDb id")
    expect(validateManualInsert({ ...REACHER_SPEC, tmdbId: 0 })).toContain("invalid tmdb id")
    expect(validateManualInsert({ ...REACHER_SPEC, type: "anime" })).toContain("invalid type")
  })

  it("rejects imax/unknown/duplicate/empty formats from declared streams", () => {
    expect(validateManualInsert({ ...REACHER_SPEC, formats: ["dv", "imax"] })).toContain("not insertable")
    expect(validateManualInsert({ ...REACHER_SPEC, formats: ["dv", "nope"] })).toContain("known vocabulary")
    expect(validateManualInsert({ ...REACHER_SPEC, formats: ["dv", "dv"] })).toContain("duplicate")
    expect(validateManualInsert({ ...REACHER_SPEC, formats: [] })).toContain("non-empty")
  })

  it("requires strict prior observation dates and allowlisted scopes", () => {
    expect(validateManualInsert({ ...REACHER_SPEC, observedAt: "not-a-date" })).toContain("observedAt")
    expect(validateManualInsert({ ...REACHER_SPEC, observedAt: "2024-02-30" })).toContain("observedAt")
    expect(validateManualInsert({ ...REACHER_SPEC, scope: "" })).toContain("scope")
    expect(validateManualInsert({ ...REACHER_SPEC, scope: "has spaces" })).toContain("allowlisted slug")
  })

  it("rejects future observedAt (prior observation only, deterministic today)", () => {
    expect(
      validateManualInsert({ ...REACHER_SPEC, observedAt: "2999-01-01" }, { today: "2026-10-21" }),
    ).toContain("in the future")
    // The authorized entry (observed 2026-10-21) is valid on that same day.
    expect(validateManualInsert(REACHER_SPEC, { today: "2026-10-21" })).toBeNull()
  })

  it("rejects series air-date after the observation date (no future-aired claims)", () => {
    expect(
      validateManualInsert(
        { ...REACHER_SPEC, airDate: "2026-10-22", observedAt: "2026-10-21" },
        { today: "2026-10-21" },
      ),
    ).toContain("no future-aired claims")
    // Same-day airing is allowed; the authorized S02E04 aired long before.
    expect(
      validateManualInsert(
        { ...REACHER_SPEC, airDate: "2026-10-21", observedAt: "2026-10-21" },
        { today: "2026-10-21" },
      ),
    ).toBeNull()
    expect(validateManualInsert(REACHER_SPEC, { today: "2026-10-21" })).toBeNull()
  })

  it("validates optional pure-field samples (set union, quality match, no raw text)", () => {
    // No samples is valid (optional).
    expect(validateManualInsert({ ...REACHER_SPEC, samples: undefined }, { today: "2026-10-21" })).toBeNull()
    // Union must equal the declared formats as a set.
    expect(
      validateManualInsert(
        {
          ...REACHER_SPEC,
          samples: [
            { quality: "4K", formats: ["dv", "hdr"] },
            { quality: "4K", formats: ["dv", "hdr"] },
          ],
        },
        { today: "2026-10-21" },
      ),
    ).toContain("sample union must equal")
    // Each sample quality must match the declared quality.
    expect(
      validateManualInsert(
        {
          ...REACHER_SPEC,
          samples: [
            { quality: "FHD", formats: ["dv", "hdr", "hdr10plus", "atmos"] },
          ],
        },
        { today: "2026-10-21" },
      ),
    ).toContain("must match the declared quality")
    // No raw-text smuggling: only quality/formats keys allowed.
    expect(
      validateManualInsert(
        {
          ...REACHER_SPEC,
          samples: [{ quality: "4K", formats: ["dv", "hdr", "hdr10plus", "atmos"], note: "raw" }],
        },
        { today: "2026-10-21" },
      ),
    ).toContain("non-allowlisted keys")
    // imax stays curated-only, including inside samples.
    expect(
      validateManualInsert(
        {
          ...REACHER_SPEC,
          formats: ["dv", "hdr", "hdr10plus", "imax"],
          samples: [{ quality: "4K", formats: ["dv", "hdr", "hdr10plus", "imax"] }],
        },
        { today: "2026-10-21" },
      ),
    ).toContain("not insertable")
  })

  it("requires explicit episode evidence for series and forbids it for movies", () => {
    expect(validateManualInsert({ ...REACHER_SPEC, season: null })).toContain("--season")
    expect(validateManualInsert({ ...REACHER_SPEC, episode: 0 })).toContain("--episode")
    expect(validateManualInsert({ ...REACHER_SPEC, airDate: "12/22/2023" })).toContain("--air-date")
    const movie = { ...REACHER_SPEC, type: "movie", season: null, episode: null, airDate: null }
    expect(validateManualInsert(movie)).toBeNull()
    expect(validateManualInsert({ ...movie, season: 2 })).toContain("must not carry --season")
    expect(validateManualInsert({ ...movie, episode: 4 })).toContain("must not carry --episode")
    expect(validateManualInsert({ ...movie, airDate: "2023-12-22" })).toContain("must not carry --air-date")
  })
})

describe("buildManualProvenanceEntry (allowlist-only companion record)", () => {
  it("builds the exact Reacher operator-selected episode-proxy record", () => {
    const entry = buildManualProvenanceEntry(REACHER_SPEC)
    expect(entry.source).toBe(MANUAL_SOURCE)
    expect(entry.verification).toBe(MANUAL_VERIFICATION)
    expect(entry.userAccepted).toBe(true)
    expect(entry.decision).toBe("inserted")
    expect(entry.classification).toBe("series")
    expect(entry.tmdbId).toBe(108978)
    expect(entry.season).toBe(2)
    expect(entry.episode).toBe(4)
    expect(entry.airDate).toBe("2023-12-22")
    // Operator-selected S02E04: never a median claim, no invented timing
    // (prior observation date recorded as given).
    expect(entry.algorithm).toBe(MANUAL_ALGORITHM_SERIES)
    expect(entry.observedAt).toBe("2026-10-21")
    // Identity is operator-provided (format-validated ids only): no fabricated
    // TMDB /find counts are recorded here (see MANUAL_IDENTITY_METHOD).
    expect(entry.identityMethod).toBe(MANUAL_IDENTITY_METHOD)
    expect(entry.identityMethod).toBe("operator-provided-imdb-tmdb")
    expect("tvResults" in entry).toBe(false)
    expect("movieResults" in entry).toBe(false)
    expect(entry.declared).toEqual({ quality: "4K", formats: ["dv", "hdr", "hdr10plus", "atmos"] })
    expect(entry.added).toEqual(["dv", "hdr", "hdr10plus", "atmos"])
    // Two separate S02E04 sample observations (same episode): the declared
    // union is their set union, never a single-file tuple claim.
    expect(entry.samples).toEqual([
      { quality: "4K", formats: ["dv", "hdr", "atmos"] },
      { quality: "4K", formats: ["dv", "hdr10plus"] },
    ])
    expect(entry.semantics).toBe(MANUAL_SEMANTICS)
    expect(entry.scope).toBe("manual-insert:series,operator-selected-s02e4")
    const text = JSON.stringify(entry)
    for (const needle of ["magnet", "infohash", "http", "filename", ".mkv", "api_key", "token"]) {
      expect(text.toLowerCase()).not.toContain(needle)
    }
  })

  it("throws on invalid specs instead of building", () => {
    expect(() => buildManualProvenanceEntry({ ...REACHER_SPEC, id: "bad" })).toThrow()
  })
})

function makeManualFixture(extraDb: Record<string, { quality: string; formats: string[] }> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-manual-insert-"))
  const db = { tt0000001: { quality: "4K", formats: ["dv"] }, ...extraDb }
  const dbPath = path.join(dir, "av-specs.json")
  fs.writeFileSync(dbPath, `${JSON.stringify(sortedCopy(db), null, 2)}\n`, "utf-8")
  const provenancePath = path.join(dir, "av-specs-series-provenance.json")
  return { dir, dbPath, provenancePath, dbText: fs.readFileSync(dbPath, "utf-8") }
}

function sortedCopy(obj: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) out[key] = obj[key]
  return out
}

const FIXTURE_SPEC = {
  id: "tt9288030",
  tmdbId: 108978,
  type: "series",
  quality: "4K",
  formats: ["dv", "hdr"],
  season: 2,
  episode: 4,
  airDate: "2023-12-22",
  observedAt: "2026-10-21",
  scope: "manual-insert:test-fixture",
}

describe("runManualInsert fixtures (offline, tmp files only)", () => {
  it("dry-runs with no writes", () => {
    const f = makeManualFixture()
    const res = runManualInsert({ dbPath: f.dbPath, provenancePath: f.provenancePath }, FIXTURE_SPEC)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error("expected ok")
    expect(res.dryRun).toBe(true)
    expect(res.plan?.dbEntry).toEqual({ quality: "4K", formats: ["dv", "hdr"] })
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(f.provenancePath)).toBe(false)
  })

  it("applies the insert canonically and refuses repeats with no file change", () => {
    const f = makeManualFixture()
    const first = runManualInsert(
      { dbPath: f.dbPath, provenancePath: f.provenancePath },
      FIXTURE_SPEC,
      { apply: true },
    )
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error("expected ok")
    expect(first.applied).toBe(1)
    const db = JSON.parse(fs.readFileSync(f.dbPath, "utf-8"))
    expect(db["tt9288030"]).toEqual({ quality: "4K", formats: ["dv", "hdr"] })
    expect(Object.keys(db)).toHaveLength(2)
    const prov = JSON.parse(fs.readFileSync(f.provenancePath, "utf-8"))
    expect(Object.keys(prov)).toEqual(["tt9288030"])
    const dbAfter = fs.readFileSync(f.dbPath, "utf-8")
    const provAfter = fs.readFileSync(f.provenancePath, "utf-8")
    const second = runManualInsert(
      { dbPath: f.dbPath, provenancePath: f.provenancePath },
      FIXTURE_SPEC,
      { apply: true },
    )
    expect(second.ok).toBe(false)
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(dbAfter)
    expect(fs.readFileSync(f.provenancePath, "utf-8")).toBe(provAfter)
  })

  it("refuses an already-present id with no writes", () => {
    const f = makeManualFixture({ tt9288030: { quality: "4K", formats: ["dv"] } })
    const res = runManualInsert(
      { dbPath: f.dbPath, provenancePath: f.provenancePath },
      FIXTURE_SPEC,
      { apply: true },
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected refusal")
    expect(res.error).toContain("already exists")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(f.provenancePath)).toBe(false)
  })

  it("refuses identical --db/--provenance paths (exact, relative alias) with no writes", () => {
    const f = makeManualFixture()
    // Exact same path: the provenance write would otherwise overwrite the DB.
    const same = runManualInsert(
      { dbPath: f.dbPath, provenancePath: f.dbPath },
      FIXTURE_SPEC,
      { apply: true },
    )
    expect(same.ok).toBe(false)
    if (same.ok) throw new Error("expected refusal")
    expect(same.error).toContain("same file")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(`${f.dbPath}.tmp-${process.pid}`)).toBe(false)
    // Relative alias of the same file (./ and ../ segments).
    const alias = path.join(f.dir, "sub", "..", path.basename(f.dbPath))
    expect(sameStorePath(f.dbPath, alias)).toBe(true)
    const aliased = runManualInsert(
      { dbPath: f.dbPath, provenancePath: alias },
      FIXTURE_SPEC,
      { apply: true },
    )
    expect(aliased.ok).toBe(false)
    if (aliased.ok) throw new Error("expected refusal")
    expect(aliased.error).toContain("same file")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    // Sanity: distinct stores are not aliases.
    expect(sameStorePath(f.dbPath, f.provenancePath)).toBe(false)
    // Dry-run refuses too (pre-I/O guard, before any read).
    const dry = runManualInsert({ dbPath: f.dbPath, provenancePath: f.dbPath }, FIXTURE_SPEC)
    expect(dry.ok).toBe(false)
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(f.provenancePath)).toBe(false)
  })

  it("rolls back the db write when provenance persistence fails", () => {
    const f = makeManualFixture()
    fs.mkdirSync(f.provenancePath)
    const res = runManualInsert(
      { dbPath: f.dbPath, provenancePath: f.provenancePath },
      FIXTURE_SPEC,
      { apply: true },
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected refusal")
    // Explicit outcome: rolled back (not a silent or misreported rollback).
    expect(res.error).toContain("database rolled back")
    expect(res.error).not.toContain("rollback failed")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(`${f.provenancePath}.tmp-${process.pid}`)).toBe(false)
  })
})

describe("Reacher local entry regression (tt9288030 / TMDB tv 108978)", () => {
  it("serves quality 4K with the authorized declared union dv+hdr+hdr10plus+atmos", () => {
    expect(lookupAVSpecs("tt9288030")).toEqual({
      quality: "4K",
      formats: ["dv", "hdr", "hdr10plus", "atmos"],
    })
  })

  it("keeps 1431 rows: original 1430 verbatim plus the single authorized insert", () => {
    const rawText = fs.readFileSync(path.join(ROOT, "src", "data", "av-specs.json"), "utf8")
    const db = JSON.parse(rawText)
    expect(Object.keys(db)).toHaveLength(1431)
    // The original 1430-row set reconstructs the pinned post-union bytes
    // exactly (historic baseline untouched, not re-pinned).
    const minus: Record<string, unknown> = {}
    for (const key of Object.keys(db)) {
      if (key !== "tt9288030") minus[key] = db[key]
    }
    expect(Object.keys(minus)).toHaveLength(1430)
    const minusSorted: Record<string, unknown> = {}
    for (const key of Object.keys(minus).sort()) minusSorted[key] = minus[key]
    expect(sha256Hex(Buffer.from(`${JSON.stringify(minusSorted, null, 2)}\n`, "utf-8"))).toBe(
      POST_UNION_DB_SHA256,
    )
  })

  it("carries the series companion provenance record (movie provenance stays 937)", () => {
    const movieProv = JSON.parse(
      fs.readFileSync(path.join(ROOT, "src", "data", "av-specs-torrentio-provenance.json"), "utf8"),
    )
    expect(Object.keys(movieProv)).toHaveLength(937)
    expect(movieProv["tt9288030"]).toBeUndefined()
    const seriesProv = JSON.parse(
      fs.readFileSync(path.join(ROOT, "src", "data", "av-specs-series-provenance.json"), "utf8"),
    )
    expect(Object.keys(seriesProv)).toEqual(["tt9288030"])
    const entry = seriesProv["tt9288030"]
    expect(entry.source).toBe("torrentio")
    expect(entry.verification).toBe("declared")
    expect(entry.userAccepted).toBe(true)
    expect(entry.classification).toBe("series")
    expect(entry.tmdbId).toBe(108978)
    expect(entry.season).toBe(2)
    expect(entry.episode).toBe(4)
    expect(entry.airDate).toBe("2023-12-22")
    expect(entry.algorithm).toBe("operator-selected-episode")
    expect(entry.observedAt).toBe("2026-10-21")
    expect(entry.decision).toBe("inserted")
    expect(entry.added).toEqual(["dv", "hdr", "hdr10plus", "atmos"])
    expect(entry.identityMethod).toBe("operator-provided-imdb-tmdb")
    expect("tvResults" in entry).toBe(false)
    expect("movieResults" in entry).toBe(false)
    expect(entry.semantics).toContain("title-edition-union")
    expect(entry.semantics).toContain("no single-file tuple claim")
    expect(entry.samples).toEqual([
      { quality: "4K", formats: ["dv", "hdr", "atmos"] },
      { quality: "4K", formats: ["dv", "hdr10plus"] },
    ])
  })
})
