import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  REVIEWED_APPROVED,
  REVIEWED_DB_BASELINE_SHA256,
  REVIEWED_DB_KEYS,
  REVIEWED_EXCLUDED,
  REVIEWED_SNAPSHOT_BYTES,
  REVIEWED_SNAPSHOT_SHA256,
  parseArgs,
  runReviewedApply,
} from "../../../scripts/torrentio-av-import.mjs"

const REVIEWED_IDS = REVIEWED_APPROVED.map((e) => e.id)
const EXCLUDED_10 = [
  "tt0087332",
  "tt0090605",
  "tt0104694",
  "tt0138704",
  "tt0325980",
  "tt0369610",
  "tt0383574",
  "tt0425379",
  "tt0816692",
  "tt1130884",
]

describe("reviewed offline scope pins (105 approved, user-accepted declared labels)", () => {
  it("binds exactly 105 approved ids: 104 hdr10plus + 1 atmos (tt1535109)", () => {
    expect(REVIEWED_APPROVED).toHaveLength(105)
    expect(new Set(REVIEWED_IDS).size).toBe(105)
    for (const id of REVIEWED_IDS) expect(id).toMatch(/^tt\d{7,10}$/)
    const hdr10 = REVIEWED_APPROVED.filter((e) => JSON.stringify(e.added) === JSON.stringify(["hdr10plus"]))
    const atmos = REVIEWED_APPROVED.filter((e) => JSON.stringify(e.added) === JSON.stringify(["atmos"]))
    expect(hdr10).toHaveLength(104)
    expect(atmos.map((e) => e.id)).toEqual(["tt1535109"])
  })

  it("excludes exactly the 10 conflicting curated ids, nothing more", () => {
    expect([...REVIEWED_EXCLUDED].sort()).toEqual([...EXCLUDED_10].sort())
    for (const id of EXCLUDED_10) expect(REVIEWED_IDS).not.toContain(id)
  })

  it("pins the reviewed snapshot and db baseline (full SHA, byte size, key count)", () => {
    expect(REVIEWED_SNAPSHOT_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(REVIEWED_DB_BASELINE_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(REVIEWED_SNAPSHOT_BYTES).toBeGreaterThan(0)
    expect(REVIEWED_DB_KEYS).toBe(1430)
  })
})

describe("parseArgs reviewed offline gating (no live, no generic writer)", () => {
  it("accepts --apply-reviewed without --live", () => {
    const parsed = parseArgs(["--apply-reviewed"])
    expect(parsed.ok).toBe(true)
  })

  it("rejects --apply-reviewed combined with --live/--only/--limit", () => {
    expect(parseArgs(["--live", "--apply-reviewed"]).ok).toBe(false)
    expect(parseArgs(["--apply-reviewed", "--only", "tt1535109"]).ok).toBe(false)
    expect(parseArgs(["--apply-reviewed", "--limit", "1"]).ok).toBe(false)
  })

  it("keeps the original live --apply path disabled", () => {
    const parsed = parseArgs(["--live", "--apply"])
    expect(parsed.ok).toBe(false)
  })
})

function sha256Bytes(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex")
}

interface ReviewedFixtureOverrides {
  ids?: string[];
  dbExtra?: Record<string, { quality: string; formats: string[] }>;
  approved?: Array<{ id: string; added: string[] }>;
  skipCheckpoint?: string[];
  classification?: Record<string, string>;
  observedAt?: Record<string, string>;
  recordExtra?: Record<string, Record<string, unknown>>;
  extraRecords?: Record<string, unknown>;
}

function makeReviewedFixture(overrides: ReviewedFixtureOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-avimport-reviewed-"))
  const ids = overrides.ids ?? ["tt0000007", "tt0000008", "tt0000009"]
  const db: Record<string, { quality: string; formats: string[] }> = {}
  for (const id of ids) db[id] = { quality: "4K", formats: ["dv"] }
  if (overrides.dbExtra) Object.assign(db, overrides.dbExtra)
  const dbPath = path.join(dir, "av-specs.json")
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2) + "\n", "utf-8")
  const checkpointIds: Record<string, unknown> = {}
  const approved = (overrides.approved ?? ids.map((id) => ({ id, added: ["hdr10plus"] }))).map((e) => ({
    id: e.id,
    added: e.added,
  }))
  for (const { id, added } of approved) {
    if (overrides.skipCheckpoint?.includes(id)) continue
    checkpointIds[id] = {
      stage: "done",
      classification: overrides.classification?.[id] ?? "movie",
      decision: "mutated",
      added,
      movieResults: 1,
      tvResults: 0,
      candidate: { quality: "4K", formats: ["hdr10plus"] },
      observedAt: overrides.observedAt?.[id] ?? "2026-10-21T09:00:00.000Z",
      ...(overrides.recordExtra?.[id] ?? {}),
    }
  }
  for (const [id, rec] of Object.entries(overrides.extraRecords ?? {})) checkpointIds[id] = rec
  const checkpointPath = path.join(dir, "checkpoint.json")
  fs.writeFileSync(checkpointPath, JSON.stringify({ ids: checkpointIds }, null, 2) + "\n", "utf-8")
  const provenancePath = path.join(dir, "av-specs-torrentio-provenance.json")
  const dbBytes = fs.readFileSync(dbPath)
  const cpBytes = fs.readFileSync(checkpointPath)
  const pins = {
    snapshotSha256: sha256Bytes(cpBytes),
    snapshotBytes: cpBytes.length,
    dbBaselineSha256: sha256Bytes(dbBytes),
    dbKeys: Object.keys(db).length,
    approved,
  }
  return { dir, dbPath, provenancePath, checkpointPath, pins, dbText: dbBytes.toString("utf-8") }
}

describe("runReviewedApply offline (fixture, no network)", () => {
  it("applies only the approved delta and writes declared provenance without secrets", () => {
    const f = makeReviewedFixture()
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.applied).toBe(3)
    const db = JSON.parse(fs.readFileSync(f.dbPath, "utf-8"))
    for (const id of ["tt0000007", "tt0000008", "tt0000009"]) {
      expect(db[id]).toEqual({ quality: "4K", formats: ["dv", "hdr10plus"] })
    }
    const prov = JSON.parse(fs.readFileSync(f.provenancePath, "utf-8"))
    expect(Object.keys(prov)).toHaveLength(3)
    const text = fs.readFileSync(f.provenancePath, "utf-8")
    expect(text).not.toContain("magnet")
    expect(text).not.toContain("infoHash")
    expect(text).not.toContain("http")
    expect(text).not.toContain(f.dir)
    for (const id of Object.keys(prov)) {
      expect(prov[id].source).toBe("torrentio")
      expect(prov[id].verification).toBe("declared")
      expect(prov[id].userAccepted).toBe(true)
      expect(prov[id].decision).toBe("mutated")
    }
  })

  it("is idempotent: second apply writes nothing and keeps SHAs identical", () => {
    const f = makeReviewedFixture()
    const first = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(first.ok).toBe(true)
    const dbSha1 = sha256Bytes(fs.readFileSync(f.dbPath))
    const provSha1 = sha256Bytes(fs.readFileSync(f.provenancePath))
    const second = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.error)
    expect(second.idempotent).toBe(true)
    expect(sha256Bytes(fs.readFileSync(f.dbPath))).toBe(dbSha1)
    expect(sha256Bytes(fs.readFileSync(f.provenancePath))).toBe(provSha1)
  })

  it("fails closed on hash mismatch with no writes", () => {
    const f = makeReviewedFixture()
    fs.appendFileSync(f.checkpointPath, " ", "utf-8")
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(false)
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(f.provenancePath)).toBe(false)
  })

  it("fails closed on malformed source, unapproved id, and series record with no writes", () => {
    const malformed = makeReviewedFixture()
    fs.writeFileSync(malformed.checkpointPath, "{not json", "utf-8")
    const malPins = { ...malformed.pins }
    const malBytes = fs.readFileSync(malformed.checkpointPath)
    malPins.snapshotSha256 = sha256Bytes(malBytes)
    malPins.snapshotBytes = malBytes.length
    expect(
      runReviewedApply(
        { dbPath: malformed.dbPath, provenancePath: malformed.provenancePath, checkpointPath: malformed.checkpointPath },
        malPins,
      ).ok,
    ).toBe(false)
    expect(fs.readFileSync(malformed.dbPath, "utf-8")).toBe(malformed.dbText)

    const narrow = makeReviewedFixture({ skipCheckpoint: ["tt0000008"] })
    const narrowRes = runReviewedApply(
      { dbPath: narrow.dbPath, provenancePath: narrow.provenancePath, checkpointPath: narrow.checkpointPath },
      narrow.pins,
    )
    expect(narrowRes.ok).toBe(false)
    expect(fs.readFileSync(narrow.dbPath, "utf-8")).toBe(narrow.dbText)
    expect(fs.existsSync(narrow.provenancePath)).toBe(false)

    const series = makeReviewedFixture({ classification: { tt0000007: "series" } })
    expect(
      runReviewedApply(
        { dbPath: series.dbPath, provenancePath: series.provenancePath, checkpointPath: series.checkpointPath },
        series.pins,
      ).ok,
    ).toBe(false)
    expect(fs.readFileSync(series.dbPath, "utf-8")).toBe(series.dbText)
  })

  it("rolls back the db write when provenance persistence fails", () => {
    const f = makeReviewedFixture()
    fs.mkdirSync(f.provenancePath)
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(false)
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
  })

  it("stays idempotent with untouched unrelated rows present", () => {
    const f = makeReviewedFixture({ dbExtra: { tt9999999: { quality: "4K", formats: ["dv"] } } })
    const first = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(first.ok).toBe(true)
    const second = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.error)
    expect(second.idempotent).toBe(true)
  })

  it("fails closed on non-approved row formats drift with no writes", () => {
    const f = makeReviewedFixture({ dbExtra: { tt9999999: { quality: "4K", formats: ["dv"] } } })
    expect(
      runReviewedApply(
        { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
        f.pins,
      ).ok,
    ).toBe(true)
    const db = JSON.parse(fs.readFileSync(f.dbPath, "utf-8"))
    db["tt9999999"] = { quality: "4K", formats: ["dv", "hdr"] }
    fs.writeFileSync(f.dbPath, JSON.stringify(db, null, 2) + "\n", "utf-8")
    const dbBefore = fs.readFileSync(f.dbPath, "utf-8")
    const provBefore = fs.readFileSync(f.provenancePath, "utf-8")
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on unrelated formats drift")
    expect(res.error).toContain("database changed outside the reviewed batch")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(dbBefore)
    expect(fs.readFileSync(f.provenancePath, "utf-8")).toBe(provBefore)
  })

  it("fails closed on non-approved row quality drift with no writes", () => {
    const f = makeReviewedFixture({ dbExtra: { tt9999999: { quality: "4K", formats: ["dv"] } } })
    expect(
      runReviewedApply(
        { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
        f.pins,
      ).ok,
    ).toBe(true)
    const db = JSON.parse(fs.readFileSync(f.dbPath, "utf-8"))
    db["tt9999999"] = { quality: "FHD", formats: ["dv"] }
    fs.writeFileSync(f.dbPath, JSON.stringify(db, null, 2) + "\n", "utf-8")
    const dbBefore = fs.readFileSync(f.dbPath, "utf-8")
    const provBefore = fs.readFileSync(f.provenancePath, "utf-8")
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on unrelated quality drift")
    expect(res.error).toContain("database changed outside the reviewed batch")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(dbBefore)
    expect(fs.readFileSync(f.provenancePath, "utf-8")).toBe(provBefore)
  })

  it("fails closed on approved quality drift with no writes", () => {
    const f = makeReviewedFixture()
    expect(
      runReviewedApply(
        { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
        f.pins,
      ).ok,
    ).toBe(true)
    const db = JSON.parse(fs.readFileSync(f.dbPath, "utf-8"))
    db["tt0000007"] = { quality: "FHD", formats: ["dv", "hdr10plus"] }
    fs.writeFileSync(f.dbPath, JSON.stringify(db, null, 2) + "\n", "utf-8")
    const dbBefore = fs.readFileSync(f.dbPath, "utf-8")
    const provBefore = fs.readFileSync(f.provenancePath, "utf-8")
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on approved quality drift")
    expect(res.error).toContain("database changed outside the reviewed batch")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(dbBefore)
    expect(fs.readFileSync(f.provenancePath, "utf-8")).toBe(provBefore)
  })
})

describe("CLI reviewed offline gating (subprocess, no network)", () => {
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

  it("refuses a foreign checkpoint hash with no writes and no network", () => {
    const f = makeReviewedFixture()
    const res = spawnSync(
      process.execPath,
      [scriptPath, "--apply-reviewed", "--db", f.dbPath, "--provenance", f.provenancePath, "--checkpoint", f.checkpointPath],
      { env: strippedEnv(), encoding: "utf-8" },
    )
    expect(res.status).not.toBe(0)
    expect(String(res.stderr)).toContain("snapshot")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(f.provenancePath)).toBe(false)
  })

  it("rejects --live --apply-reviewed before any config, network, or write", () => {
    const f = makeReviewedFixture()
    const res = spawnSync(
      process.execPath,
      [scriptPath, "--live", "--apply-reviewed", "--db", f.dbPath, "--checkpoint", f.checkpointPath],
      { env: strippedEnv(), encoding: "utf-8" },
    )
    expect(res.status).not.toBe(0)
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
  })
})
