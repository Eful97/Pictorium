import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  KNOWN_QUALITIES,
  REVIEWED_PHASE3_APPROVED,
  REVIEWED_PHASE3_DB_BASELINE_SHA256,
  REVIEWED_PHASE3_DB_KEYS,
  REVIEWED_PHASE3_OBSERVED_BATCH_PREFIX,
  REVIEWED_PHASE3_PINS,
  REVIEWED_PHASE3_PROVENANCE_FILE,
  REVIEWED_PHASE3_SCOPE,
  REVIEWED_PHASE3_SNAPSHOT_BYTES,
  REVIEWED_PHASE3_SNAPSHOT_SHA256,
  parseArgs,
  runReviewedApply,
} from "../../../scripts/torrentio-av-import.mjs"

const ROOT = path.resolve(__dirname, "../../..")
const PHASE3_IDS = REVIEWED_PHASE3_APPROVED.map((e) => e.id)

function sha256Hex(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex")
}

function canonicalText(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`
}

describe("phase-3 reviewed scope pins (97 approved, 2026-10-31 batch)", () => {
  it("binds exactly 97 approved ids with the authorized token composition", () => {
    expect(REVIEWED_PHASE3_APPROVED).toHaveLength(97)
    expect(new Set(PHASE3_IDS).size).toBe(97)
    for (const id of PHASE3_IDS) expect(id).toMatch(/^tt\d{7,10}$/)
    const withToken = (token: string) => REVIEWED_PHASE3_APPROVED.filter((e) => e.added.includes(token))
    expect(withToken("hdr")).toHaveLength(62)
    expect(withToken("hdr10plus")).toHaveLength(22)
    expect(withToken("atmos")).toHaveLength(14)
    expect(withToken("dv")).toHaveLength(2)
    // Union is additive: only absent allowlisted formats, never imax.
    for (const { added } of REVIEWED_PHASE3_APPROVED) {
      expect(added.length).toBeGreaterThan(0)
      expect(added).not.toContain("imax")
      expect(JSON.stringify(added)).not.toContain("quality")
    }
  })

  it("pins the phase-3 snapshot, db baseline, batch prefix and preserved provenance", () => {
    expect(REVIEWED_PHASE3_PINS.snapshotSha256).toBe(REVIEWED_PHASE3_SNAPSHOT_SHA256)
    expect(REVIEWED_PHASE3_SNAPSHOT_BYTES).toBe(473158)
    expect(REVIEWED_PHASE3_DB_BASELINE_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(REVIEWED_PHASE3_DB_BASELINE_SHA256).not.toBe(REVIEWED_PHASE3_SNAPSHOT_SHA256)
    expect(REVIEWED_PHASE3_DB_KEYS).toBe(1431)
    expect(REVIEWED_PHASE3_SCOPE).toBe(
      "reviewed-fase2b-97:movie-only,62generic-hdr+22hdr10plus+14atmos+2dv",
    )
    expect(REVIEWED_PHASE3_PINS.scope).toBe(REVIEWED_PHASE3_SCOPE)
    expect(REVIEWED_PHASE3_OBSERVED_BATCH_PREFIX).toBe("2026-10-31")
    expect(REVIEWED_PHASE3_PINS.observedBatchPrefix).toBe(REVIEWED_PHASE3_OBSERVED_BATCH_PREFIX)
    // Explicit empty allowlist (the 4 curated-conflict ids are authorized
    // here), never a silently dropped pin.
    expect(REVIEWED_PHASE3_PINS.excluded).toEqual([])
    expect([...REVIEWED_PHASE3_PINS.allowedCandidateQualities].sort()).toEqual([...KNOWN_QUALITIES].sort())
    expect(REVIEWED_PHASE3_PINS.preservedProvenanceBaselineSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(REVIEWED_PHASE3_PINS.preservedProvenanceBaselineBytes).toBe(600490)
    expect(REVIEWED_PHASE3_PROVENANCE_FILE).toBe("av-specs-torrentio-provenance-phase3.json")
  })

  it("keeps the phase-1+2 provenance file byte-identical and pins its canonical bytes", () => {
    const rawText = fs.readFileSync(
      path.join(ROOT, "src", "data", "av-specs-torrentio-provenance.json"),
      "utf8",
    )
    const provenance = JSON.parse(rawText)
    expect(Object.keys(provenance)).toHaveLength(937)
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(provenance).sort()) sorted[key] = provenance[key]
    expect(rawText.replace(/\r\n/g, "\n")).toBe(canonicalText(sorted))
    expect(sha256Hex(Buffer.from(canonicalText(sorted), "utf-8"))).toBe(
      REVIEWED_PHASE3_PINS.preservedProvenanceBaselineSha256,
    )
    expect(Buffer.byteLength(canonicalText(sorted), "utf-8")).toBe(
      REVIEWED_PHASE3_PINS.preservedProvenanceBaselineBytes,
    )
    // No phase-3 id leaked into the preserved file.
    for (const id of PHASE3_IDS) expect(provenance[id]?.scope).not.toBe(REVIEWED_PHASE3_SCOPE)
  })

  it("carries the companion provenance file (97 writer-canonical entries) and the applied rows", () => {
    const companionRaw = fs.readFileSync(
      path.join(ROOT, "src", "data", REVIEWED_PHASE3_PROVENANCE_FILE),
      "utf8",
    )
    const companion = JSON.parse(companionRaw)
    expect(Object.keys(companion).sort()).toEqual([...PHASE3_IDS].sort())
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(companion).sort()) sorted[key] = companion[key]
    expect(companionRaw.replace(/\r\n/g, "\n")).toBe(canonicalText(sorted))
    expect(companionRaw.toLowerCase()).not.toContain("magnet")
    expect(companionRaw.toLowerCase()).not.toContain("http")
  })

  it("the applied database strips back to the pinned pre-phase-3 bytes (no new rows, no quality drift)", () => {
    const db = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "av-specs.json"), "utf8"))
    expect(Object.keys(db)).toHaveLength(REVIEWED_PHASE3_DB_KEYS)
    const addedById = new Map(REVIEWED_PHASE3_APPROVED.map((e) => [e.id, e.added]))
    const preImage: Record<string, unknown> = {}
    for (const key of Object.keys(db)) {
      const entry = db[key] as { quality: string; formats: string[] }
      const added = addedById.get(key)
      preImage[key] = added
        ? { ...entry, formats: entry.formats.filter((f) => !added.includes(f)) }
        : entry
    }
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(preImage).sort()) sorted[key] = preImage[key]
    expect(sha256Hex(Buffer.from(canonicalText(sorted), "utf-8"))).toBe(REVIEWED_PHASE3_DB_BASELINE_SHA256)
    // Only additions: every approved token is present, nothing else moved.
    for (const { id, added } of REVIEWED_PHASE3_APPROVED) {
      expect(db[id].formats, id).toEqual(expect.arrayContaining(added))
      expect(KNOWN_QUALITIES).toContain(db[id].quality)
    }
  })
})

describe("parseArgs phase-3 gating (offline, no live/generic writer)", () => {
  it("accepts --apply-reviewed-phase3 without --live", () => {
    expect(parseArgs(["--apply-reviewed-phase3"]).ok).toBe(true)
  })

  it("rejects phase-3 combined with --live/--only/--limit or another reviewed writer", () => {
    expect(parseArgs(["--live", "--apply-reviewed-phase3"]).ok).toBe(false)
    expect(parseArgs(["--apply-reviewed-phase3", "--only", "tt0133093"]).ok).toBe(false)
    expect(parseArgs(["--apply-reviewed-phase3", "--limit", "1"]).ok).toBe(false)
    expect(parseArgs(["--apply-reviewed", "--apply-reviewed-phase3"]).ok).toBe(false)
    expect(parseArgs(["--apply-reviewed-union", "--apply-reviewed-phase3"]).ok).toBe(false)
  })

  it("keeps the original live --apply path disabled", () => {
    expect(parseArgs(["--live", "--apply"]).ok).toBe(false)
  })
})

const PRIOR_PROVENANCE = {
  tt0000001: { source: "torrentio", scope: "reviewed-test-phase1", note: "preserved" },
}

interface Phase3FixtureOverrides {
  ids?: string[];
  candidateQuality?: string;
  approved?: Array<{ id: string; added: string[] }>;
  companionProvenance?: Record<string, unknown>;
  skipCheckpoint?: string[];
  pinsExtra?: Record<string, unknown>;
}

function makePhase3Fixture(overrides: Phase3FixtureOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-avimport-phase3-"))
  // tt0104694 is one of the 10 ids that phases 1/2 listed as curated
  // conflicts: the explicit empty allowlist must let it through here.
  const ids = overrides.ids ?? ["tt0000011", "tt0000012", "tt0104694"]
  const db: Record<string, { quality: string; formats: string[] }> = {}
  for (const id of ids) db[id] = { quality: "4K", formats: ["dv"] }
  const dbPath = path.join(dir, "av-specs.json")
  fs.writeFileSync(dbPath, canonicalText(db), "utf-8")

  const approved = overrides.approved ?? ids.map((id) => ({ id, added: ["hdr"] }))
  const checkpointIds: Record<string, unknown> = {}
  for (const { id, added } of approved) {
    if (overrides.skipCheckpoint?.includes(id)) continue
    checkpointIds[id] = {
      stage: "done",
      classification: "movie",
      decision: "mutated",
      added,
      movieResults: 1,
      tvResults: 0,
      candidate: { quality: overrides.candidateQuality ?? "4K", formats: ["hdr"] },
      observedAt: "2026-10-31T09:00:00.000Z",
    }
  }
  const checkpointPath = path.join(dir, "checkpoint.json")
  fs.writeFileSync(checkpointPath, canonicalText({ ids: checkpointIds }), "utf-8")

  const preservedProvenancePath = path.join(dir, "av-specs-torrentio-provenance.json")
  fs.writeFileSync(preservedProvenancePath, canonicalText(PRIOR_PROVENANCE), "utf-8")
  const preservedBytes = fs.readFileSync(preservedProvenancePath)

  const provenancePath = path.join(dir, REVIEWED_PHASE3_PROVENANCE_FILE)
  if (overrides.companionProvenance) {
    fs.writeFileSync(provenancePath, canonicalText(overrides.companionProvenance), "utf-8")
  }

  const dbBytes = fs.readFileSync(dbPath)
  const cpBytes = fs.readFileSync(checkpointPath)
  const pins = {
    snapshotSha256: sha256Hex(cpBytes),
    snapshotBytes: cpBytes.length,
    dbBaselineSha256: sha256Hex(dbBytes),
    dbKeys: Object.keys(db).length,
    approved,
    excluded: [],
    allowedCandidateQualities: [...KNOWN_QUALITIES],
    scope: REVIEWED_PHASE3_SCOPE,
    observedBatchPrefix: REVIEWED_PHASE3_OBSERVED_BATCH_PREFIX,
    preservedProvenanceBaselineSha256: sha256Hex(preservedBytes),
    preservedProvenanceBaselineBytes: preservedBytes.length,
    ...(overrides.pinsExtra ?? {}),
  }
  const paths = { dbPath, provenancePath, checkpointPath, preservedProvenancePath }
  return { dir, paths, pins, dbText: dbBytes.toString("utf-8"), preservedBytes }
}

describe("runReviewedApply companion-provenance mode (offline fixtures, no network)", () => {
  it("writes the batch to the companion file and leaves the preserved file byte-identical", () => {
    const f = makePhase3Fixture()
    const res = runReviewedApply(f.paths, f.pins)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.applied).toBe(3)
    expect(res.idempotent).toBe(false)
    const db = JSON.parse(fs.readFileSync(f.paths.dbPath, "utf-8"))
    for (const id of ["tt0000011", "tt0000012", "tt0104694"]) {
      expect(db[id]).toEqual({ quality: "4K", formats: ["dv", "hdr"] })
    }
    const companion = JSON.parse(fs.readFileSync(f.paths.provenancePath, "utf-8"))
    expect(Object.keys(companion).sort()).toEqual(["tt0000011", "tt0000012", "tt0104694"])
    for (const id of Object.keys(companion)) {
      expect(companion[id].source).toBe("torrentio")
      expect(companion[id].verification).toBe("declared")
      expect(companion[id].userAccepted).toBe(true)
      expect(companion[id].scope).toBe(REVIEWED_PHASE3_SCOPE)
      expect(companion[id].observedAt.startsWith("2026-10-31")).toBe(true)
      expect(companion[id].added).toEqual(["hdr"])
    }
    const companionText = fs.readFileSync(f.paths.provenancePath, "utf-8")
    expect(companionText).not.toContain("http")
    expect(companionText).not.toContain("magnet")
    expect(fs.readFileSync(f.paths.preservedProvenancePath)).toEqual(f.preservedBytes)
  })

  it("is idempotent (no writes, same SHAs) and re-verifies the preserved file", () => {
    const f = makePhase3Fixture()
    const first = runReviewedApply(f.paths, f.pins)
    expect(first.ok).toBe(true)
    const dbSha = sha256Hex(fs.readFileSync(f.paths.dbPath))
    const provSha = sha256Hex(fs.readFileSync(f.paths.provenancePath))
    const second = runReviewedApply(f.paths, f.pins)
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.error)
    expect(second.idempotent).toBe(true)
    expect(sha256Hex(fs.readFileSync(f.paths.dbPath))).toBe(dbSha)
    expect(sha256Hex(fs.readFileSync(f.paths.provenancePath))).toBe(provSha)
  })

  it("fails closed when the pinned preserved provenance drifts, with no writes", () => {
    const f = makePhase3Fixture()
    fs.writeFileSync(
      f.paths.preservedProvenancePath,
      canonicalText({ ...PRIOR_PROVENANCE, tt0000001: { note: "tampered" } }),
      "utf-8",
    )
    const before = fs.readFileSync(f.paths.dbPath, "utf-8")
    const res = runReviewedApply(f.paths, f.pins)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on drifted preserved provenance")
    expect(res.error).toContain("preserved provenance")
    expect(fs.readFileSync(f.paths.dbPath, "utf-8")).toBe(before)
    expect(fs.existsSync(f.paths.provenancePath)).toBe(false)
  })

  it("fails closed when the pinned preserved provenance is missing, with no writes", () => {
    const f = makePhase3Fixture()
    fs.rmSync(f.paths.preservedProvenancePath)
    const res = runReviewedApply(f.paths, f.pins)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on missing preserved provenance")
    expect(res.error).toContain("preserved provenance is missing")
    expect(fs.existsSync(f.paths.provenancePath)).toBe(false)
  })

  it("rejects a companion file that holds ids outside this batch", () => {
    const f = makePhase3Fixture({
      companionProvenance: { tt9999999: { source: "torrentio", scope: "foreign" } },
    })
    const before = fs.readFileSync(f.paths.dbPath, "utf-8")
    const res = runReviewedApply(f.paths, f.pins)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on foreign companion ids")
    expect(res.error).toContain("outside this batch")
    expect(fs.readFileSync(f.paths.dbPath, "utf-8")).toBe(before)
  })

  it("rejects drift in the preserved file on an idempotent re-run", () => {
    const f = makePhase3Fixture()
    expect(runReviewedApply(f.paths, f.pins).ok).toBe(true)
    fs.writeFileSync(
      f.paths.preservedProvenancePath,
      canonicalText({ ...PRIOR_PROVENANCE, tt0000001: { note: "tampered" } }),
      "utf-8",
    )
    const dbBefore = fs.readFileSync(f.paths.dbPath, "utf-8")
    const provBefore = fs.readFileSync(f.paths.provenancePath, "utf-8")
    const res = runReviewedApply(f.paths, f.pins)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on drifted preserved provenance")
    expect(res.error).toContain("preserved provenance baseline mismatch")
    expect(fs.readFileSync(f.paths.dbPath, "utf-8")).toBe(dbBefore)
    expect(fs.readFileSync(f.paths.provenancePath, "utf-8")).toBe(provBefore)
  })

  it("accepts a 4K stored row with an FHD declared candidate without touching stored quality", () => {
    const f = makePhase3Fixture({ candidateQuality: "FHD" })
    const res = runReviewedApply(f.paths, f.pins)
    expect(res.ok).toBe(true)
    const db = JSON.parse(fs.readFileSync(f.paths.dbPath, "utf-8"))
    expect(db["tt0000011"]).toEqual({ quality: "4K", formats: ["dv", "hdr"] })
    const companion = JSON.parse(fs.readFileSync(f.paths.provenancePath, "utf-8"))
    expect(companion["tt0000011"].declared).toEqual({ quality: "FHD", formats: ["hdr"] })
  })

  it("rejects a record observed outside the pinned phase-3 batch", () => {
    const f = makePhase3Fixture({ pinsExtra: { observedBatchPrefix: "2026-11-01" } })
    const res = runReviewedApply(f.paths, f.pins)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on observedAt outside the batch")
    expect(res.error).toContain("observedAt outside the pinned observed batch")
    expect(fs.existsSync(f.paths.provenancePath)).toBe(false)
  })

  it("rolls back the db write when companion persistence fails", () => {
    const f = makePhase3Fixture()
    fs.mkdirSync(f.paths.provenancePath)
    const res = runReviewedApply(f.paths, f.pins)
    expect(res.ok).toBe(false)
    expect(fs.readFileSync(f.paths.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.readFileSync(f.paths.preservedProvenancePath)).toEqual(f.preservedBytes)
  })

  it("refuses a preserved path that overlaps another input", () => {
    const f = makePhase3Fixture()
    const res = runReviewedApply({ ...f.paths, preservedProvenancePath: f.paths.dbPath }, f.pins)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on overlapping preserved path")
    expect(res.error).toContain("preserved provenance path overlaps")
  })
})

describe("CLI phase-3 gating (subprocess, no network)", () => {
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
    const f = makePhase3Fixture()
    const res = spawnSync(
      process.execPath,
      [
        scriptPath,
        "--apply-reviewed-phase3",
        "--db",
        f.paths.dbPath,
        "--provenance",
        f.paths.provenancePath,
        "--checkpoint",
        f.paths.checkpointPath,
      ],
      { env: strippedEnv(), encoding: "utf-8" },
    )
    expect(res.status).not.toBe(0)
    expect(String(res.stderr)).toContain("snapshot")
    expect(fs.readFileSync(f.paths.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(f.paths.provenancePath)).toBe(false)
  })

  it("rejects --live --apply-reviewed-phase3 before any config, network, or write", () => {
    const f = makePhase3Fixture()
    const res = spawnSync(
      process.execPath,
      [scriptPath, "--live", "--apply-reviewed-phase3", "--db", f.paths.dbPath, "--checkpoint", f.paths.checkpointPath],
      { env: strippedEnv(), encoding: "utf-8" },
    )
    expect(res.status).not.toBe(0)
    expect(String(res.stderr)).toContain("offline")
    expect(fs.readFileSync(f.paths.dbPath, "utf-8")).toBe(f.dbText)
  })
})
