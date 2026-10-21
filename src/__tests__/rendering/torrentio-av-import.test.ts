import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  ALLOWED_MERGE_FORMATS,
  classifyFindResult,
  existingSnapshot,
  mergeAdditive,
  mergeCheckpoint,
  parseArgs,
  parseTorrentioRecord,
  sanitizeProvenanceEntry,
  selectCandidate,
  shouldStopOnHttpStatus,
} from "../../../scripts/torrentio-av-import.mjs"

describe("parseArgs", () => {
  it("defaults to dry-run: no live, no apply", () => {
    const parsed = parseArgs([])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error("expected ok")
    expect(parsed.args.live).toBe(false)
    expect(parsed.args.apply).toBe(false)
    expect(parsed.args.limit).toBeNull()
    expect(parsed.args.only).toBeNull()
  })

  it("rejects unknown flags before anything else", () => {
    const parsed = parseArgs(["--outpt"])
    expect(parsed.ok).toBe(false)
  })

  it("rejects duplicate flags", () => {
    const parsed = parseArgs(["--live", "--live"])
    expect(parsed.ok).toBe(false)
  })

  it("rejects --apply without --live", () => {
    const parsed = parseArgs(["--apply"])
    expect(parsed.ok).toBe(false)
  })

  it("rejects --live --apply as disabled pending curated-data reconciliation", () => {
    const parsed = parseArgs(["--live", "--apply"])
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error("expected rejection")
    expect(parsed.error).toContain("apply disabled pending curated-data reconciliation")
  })

  it("rejects --limit below 1 and non-numeric", () => {
    expect(parseArgs(["--live", "--limit", "0"]).ok).toBe(false)
    expect(parseArgs(["--live", "--limit", "abc"]).ok).toBe(false)
    expect(parseArgs(["--live", "--limit"]).ok).toBe(false)
  })

  it("rejects malformed --only ids", () => {
    expect(parseArgs(["--live", "--only", "tt15239678,batman"]).ok).toBe(false)
    expect(parseArgs(["--live", "--only", "15239678"]).ok).toBe(false)
  })

  it("accepts a well-formed live preflight selection", () => {
    const parsed = parseArgs(["--live", "--only", "tt15239678,tt0133093"])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error("expected ok")
    expect(parsed.args.live).toBe(true)
    expect(parsed.args.only).toEqual(["tt15239678", "tt0133093"])
  })

  it("rejects --spacing-ms below the 1000ms floor", () => {
    expect(parseArgs(["--live", "--spacing-ms", "250"]).ok).toBe(false)
    const parsed = parseArgs(["--live", "--spacing-ms", "1500"])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error("expected ok")
    expect(parsed.args.spacingMs).toBe(1500)
  })
})

describe("parseTorrentioRecord (strict per-record declared labels)", () => {
  it("numeric resolution beats UHD label in the same record", () => {
    const r = parseTorrentioRecord({ title: "Film.UHD.Bluray.1080p.x264" })
    expect(r.quality).toBe("FHD")
  })

  it("detects 2160p as 4K and 4K/UHD labels without digits as 4K", () => {
    expect(parseTorrentioRecord({ title: "Film.2160p.UHD.Remux" }).quality).toBe("4K")
    expect(parseTorrentioRecord({ title: "Film.4K.HDR" }).quality).toBe("4K")
    expect(parseTorrentioRecord({ title: "Film.UHD.WEBDL" }).quality).toBe("4K")
  })

  it("maps 1080p/fhd to FHD, 720p/hd to HD, 480p/dvdrip to SD", () => {
    expect(parseTorrentioRecord({ title: "Film.1080p.BluRay" }).quality).toBe("FHD")
    expect(parseTorrentioRecord({ title: "Film.720p.HDTV" }).quality).toBe("HD")
    expect(parseTorrentioRecord({ title: "Film.480p.DVDRip" }).quality).toBe("SD")
    expect(parseTorrentioRecord({ title: "Film.HDTS.CAM" }).quality).toBe("SD")
  })

  it("prioritizes filename numerics over title labels", () => {
    const r = parseTorrentioRecord({
      title: "Film.2160p.UHD.BluRay",
      behaviorHints: { filename: "Film.1080p.BluRay.x264.mkv" },
    })
    expect(r.quality).toBe("FHD")
  })

  it("keeps HDR10+ distinct from HDR10/HDR", () => {
    expect(parseTorrentioRecord({ title: "Film.2160p.HDR10Plus" }).formats).toEqual(["hdr10plus"])
    expect(parseTorrentioRecord({ title: "Film.2160p.HDR10+" }).formats).toEqual(["hdr10plus"])
    expect(parseTorrentioRecord({ title: "Film.2160p.HDR10" }).formats).toEqual(["hdr"])
    expect(parseTorrentioRecord({ title: "Film.2160p.HDR" }).formats).toEqual(["hdr"])
  })

  it("detects Dolby Vision without matching DVD rip labels", () => {
    expect(parseTorrentioRecord({ title: "Film.2160p.DV.HDR" }).formats).toContain("dv")
    expect(parseTorrentioRecord({ title: "Film.Dolby.Vision.2160p" }).formats).toContain("dv")
    const dvd = parseTorrentioRecord({ title: "Film.DVDRip.XviD" })
    expect(dvd.formats).not.toContain("dv")
  })

  it("never treats TrueHD or DTS-HD alone as Atmos", () => {
    expect(parseTorrentioRecord({ title: "Film.1080p.BluRay.TrueHD.5.1" }).formats).not.toContain("atmos")
    expect(parseTorrentioRecord({ title: "Film.1080p.BluRay.DTS.HD.MA.5.1" }).formats).not.toContain("atmos")
  })

  it("treats an explicit Atmos token (even beside TrueHD) as Atmos", () => {
    const r = parseTorrentioRecord({ title: "Film.2160p.BluRay.TrueHD.Atmos.7.1" })
    expect(r.formats).toContain("atmos")
  })

  it("never emits DTS:X (not in local schema)", () => {
    const r = parseTorrentioRecord({ title: "Film.2160p.DTS.X.7.1.HDR" })
    expect(r.formats).not.toContain("dtsx")
    expect(r.formats).toContain("hdr")
    for (const f of r.formats) {
      expect(["dv", "hdr", "hdr10plus", "atmos", "imax"]).toContain(f)
    }
  })

  it("returns null quality and no formats for unknown text", () => {
    const r = parseTorrentioRecord({ title: "Some Random Release GROUP" })
    expect(r.quality).toBeNull()
    expect(r.formats).toEqual([])
  })

  it("detects explicit IMAX tokens (merge step decides, never the parser)", () => {
    const r = parseTorrentioRecord({ title: "Film.2160p.IMAX.HDR" })
    expect(r.formats).toContain("imax")
  })
})

describe("selectCandidate (one deterministic same-release record, never a cross-release tuple)", () => {
  const rec = (title: string) => ({ title })

  it("picks the highest tier record verbatim instead of unioning formats", () => {
    const streams = [
      rec("Film.1080p.BluRay.DV.x264"),
      rec("Film.2160p.UHD.ATMOS.x265"),
    ]
    const c = selectCandidate(streams)
    expect(c).not.toBeNull()
    expect(c?.quality).toBe("4K")
    // Single-record candidate: DV from the 1080p release must NOT leak in.
    expect(c?.formats).toEqual(["atmos"])
    expect(c?.index).toBe(1)
  })

  it("breaks tier ties by explicit numerics, then by first index", () => {
    const streams = [rec("Film.UHD.WEBDL.HDR"), rec("Film.2160p.UHD.ATMOS")]
    const c = selectCandidate(streams)
    expect(c?.index).toBe(1)
    const tie = [rec("Film.2160p.DV"), rec("Film.2160p.ATMOS")]
    expect(selectCandidate(tie)?.index).toBe(0)
  })

  it("returns null when no record carries an explicit resolution", () => {
    expect(selectCandidate([rec("Some GROUP release"), rec("Another GROUP")])).toBeNull()
    expect(selectCandidate([])).toBeNull()
  })
})

describe("classifyFindResult (authoritative movie/series gate)", () => {
  it("accepts movie-only results", () => {
    expect(classifyFindResult({ movie_results: [{ id: 1 }], tv_results: [] })).toBe("movie")
  })

  it("routes tv-only results to series (skip)", () => {
    expect(classifyFindResult({ movie_results: [], tv_results: [{ id: 2 }] })).toBe("series")
  })

  it("marks movie+tv results ambiguous (skip, never guessed)", () => {
    expect(classifyFindResult({ movie_results: [{ id: 1 }], tv_results: [{ id: 2 }] })).toBe("ambiguous")
  })

  it("marks empty/malformed results unknown (skip)", () => {
    expect(classifyFindResult({ movie_results: [], tv_results: [] })).toBe("unknown")
    expect(classifyFindResult(null)).toBe("unknown")
    expect(classifyFindResult({})).toBe("unknown")
  })
})

describe("mergeAdditive (curated values are never downgraded or replaced)", () => {
  it("adds only absent allowlisted formats and preserves order", () => {
    const m = mergeAdditive({ quality: "4K", formats: ["dv"] }, { quality: "4K", formats: ["dv", "atmos"] })
    expect(m.decision).toBe("mutated")
    expect(m.entry).toEqual({ quality: "4K", formats: ["dv", "atmos"] })
    expect(m.added).toEqual(["atmos"])
  })

  it("reports nochange when the candidate adds nothing", () => {
    const m = mergeAdditive({ quality: "4K", formats: ["dv", "atmos"] }, { quality: "4K", formats: ["atmos"] })
    expect(m.decision).toBe("nochange")
    expect(m.entry).toEqual({ quality: "4K", formats: ["dv", "atmos"] })
  })

  it("never changes quality and never drops curated formats", () => {
    const m = mergeAdditive({ quality: "4K", formats: ["imax", "hdr"] }, { quality: "FHD", formats: ["dv"] })
    expect(m.entry.quality).toBe("4K")
    expect(m.entry.formats).toContain("imax")
    expect(m.entry.formats).toContain("hdr")
  })

  it("never adds imax from declared streams (stays curated)", () => {
    const m = mergeAdditive({ quality: "4K", formats: ["dv"] }, { quality: "4K", formats: ["imax", "atmos"] })
    expect(m.entry.formats).not.toContain("imax")
    expect(m.entry.formats).toEqual(["dv", "atmos"])
  })

  it("fills quality only when absent, never downgrades", () => {
    const m = mergeAdditive({ formats: ["dv"] }, { quality: "4K", formats: [] })
    expect(m.entry.quality).toBe("4K")
  })

  it("exposes the merge allowlist without imax", () => {
    expect([...ALLOWED_MERGE_FORMATS].sort()).toEqual(["atmos", "dv", "hdr", "hdr10plus"])
  })
})

describe("shouldStopOnHttpStatus (no retries on source restrictions)", () => {
  it("stops on 429, 403, 401 and Retry-After", () => {
    expect(shouldStopOnHttpStatus(429)).toBe(true)
    expect(shouldStopOnHttpStatus(403)).toBe(true)
    expect(shouldStopOnHttpStatus(401)).toBe(true)
    expect(shouldStopOnHttpStatus(200, { "retry-after": "5" })).toBe(true)
    expect(shouldStopOnHttpStatus(503, { "retry-after": "120" })).toBe(true)
  })

  it("continues past per-id failures without stopping the run", () => {
    expect(shouldStopOnHttpStatus(404)).toBe(false)
    expect(shouldStopOnHttpStatus(500)).toBe(false)
    expect(shouldStopOnHttpStatus(200)).toBe(false)
  })
})

describe("mergeCheckpoint (resume without reprocessing)", () => {
  it("keeps completed ids and adds new ones", () => {
    const prev = { ids: { tt1: { stage: "done" } } }
    const next = { ids: { tt2: { stage: "done" } } }
    expect(mergeCheckpoint(prev, next)).toEqual({ ids: { tt1: { stage: "done" }, tt2: { stage: "done" } } })
  })

  it("rebuilds provenance from stored records and refuses invented evidence", () => {
    const snap = existingSnapshot({
      stage: "done",
      classification: "movie",
      decision: "mutated",
      movieResults: 1,
      tvResults: 0,
      candidate: { quality: "4K", formats: ["atmos"] },
      observedAt: "2026-10-21T00:00:00.000Z",
    })
    expect(snap?.declared).toEqual({ quality: "4K", formats: ["atmos"] })
    expect(snap?.evidence).toEqual({ classification: "movie", movieResults: 1, tvResults: 0, via: "tmdb-find" })
    expect(existingSnapshot({ stage: "done", decision: "mutated" })).toBeNull()
  })
})

describe("sanitizeProvenanceEntry (no raw names, hashes, urls or secrets)", () => {
  it("forwards only the allowlisted evidence shape", () => {
    const entry = sanitizeProvenanceEntry({
      imdbId: "tt15239678",
      observedAt: "2026-10-21T00:00:00.000Z",
      candidate: { quality: "4K", formats: ["dv", "atmos"] },
      decision: "nochange",
      classification: "movie",
      movieResults: 1,
      tvResults: 0,
      filename: "Dune.Part.Two.2160p.WEBDL.DV.ATMOS.x265-XYZ.mkv",
      infoHash: "abc123",
      url: "magnet:?xt=urn:btih:abc123",
      apiKey: "secret",
    })
    expect(entry).toEqual({
      source: "torrentio",
      observedAt: "2026-10-21T00:00:00.000Z",
      declared: { quality: "4K", formats: ["dv", "atmos"] },
      decision: "nochange",
      evidence: { classification: "movie", movieResults: 1, tvResults: 0, via: "tmdb-find" },
    })
    const text = JSON.stringify(entry)
    expect(text).not.toContain("XYZ")
    expect(text).not.toContain("magnet")
    expect(text).not.toContain("secret")
  })
})

describe("CLI subprocess (blocked apply + dry-run, no network, no writes)", () => {
  const scriptPath = path.join(process.cwd(), "scripts", "torrentio-av-import.mjs")

  function strippedEnv() {
    const env = { ...process.env }
    delete env.PICTORIUM_TMDB_KEY
    delete env.POSTERIUM_TMDB_KEY
    delete env.TMDB_KEY
    delete env.TMDB_API_KEY
    delete env.TMDB_BASE_URL
    return env
  }

  function makeFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-avimport-cli-"))
    const dbPath = path.join(dir, "av-specs.json")
    const provenancePath = path.join(dir, "av-specs-torrentio-provenance.json")
    const checkpointPath = path.join(dir, "checkpoint.json")
    const db = {
      tt0000001: { quality: "4K", formats: ["dv"] },
      tt0000002: { formats: [] },
    }
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2) + "\n", "utf-8")
    fs.writeFileSync(provenancePath, "{}\n", "utf-8")
    return { dir, dbPath, provenancePath, checkpointPath, dbText: fs.readFileSync(dbPath, "utf-8") }
  }

  it("--live --apply exits non-zero pre-network with no DB/provenance/checkpoint writes", () => {
    // Proof rests on arg-validation gating (rejection happens before any
    // config read, fetch, or write), not on mock HTTP: the child runs with
    // TMDB keys stripped and fixture paths only, and we assert all fixture
    // files are byte-identical afterwards. Limit: this proves the blocked
    // path performs no writes and never reaches the network stage; it does
    // not exercise fetchJson timeouts, checkpoint resume, or atomic writes
    // (all recorded as unresolved production safeguards, untested here).
    const f = makeFixture()
    const provBefore = fs.readFileSync(f.provenancePath, "utf-8")
    const res = spawnSync(
      process.execPath,
      [scriptPath, "--live", "--apply", "--db", f.dbPath, "--provenance", f.provenancePath, "--checkpoint", f.checkpointPath],
      { env: strippedEnv(), encoding: "utf-8" },
    )
    expect(res.status).not.toBe(0)
    expect(String(res.stderr)).toContain("apply disabled pending curated-data reconciliation")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.readFileSync(f.provenancePath, "utf-8")).toBe(provBefore)
    expect(fs.existsSync(f.checkpointPath)).toBe(false)
  })

  it("default dry-run performs no network and no writes against a fixture DB", () => {
    // Dry-run returns after arg validation + plan print: no fetch, no
    // checkpoint write. Same limit as above: no mock HTTP involved; the
    // assertion is exit 0 + plan output + fixture/checkpoint untouched.
    const f = makeFixture()
    const res = spawnSync(
      process.execPath,
      [scriptPath, "--db", f.dbPath, "--limit", "1", "--checkpoint", f.checkpointPath],
      { env: strippedEnv(), encoding: "utf-8" },
    )
    expect(res.status).toBe(0)
    expect(String(res.stdout)).toContain("dry-run")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(f.checkpointPath)).toBe(false)
  })
})
