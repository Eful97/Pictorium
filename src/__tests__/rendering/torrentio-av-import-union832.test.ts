import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { lookupAVSpecs } from "@/lib/av-specs"
import {
  ALLOWED_MERGE_FORMATS,
  KNOWN_FORMAT_TOKENS,
  KNOWN_QUALITIES,
  REVIEWED832_APPROVED,
  REVIEWED832_DB_BASELINE_SHA256,
  REVIEWED832_DB_KEYS,
  REVIEWED832_PINS,
  REVIEWED832_SCOPE,
  REVIEWED_APPROVED,
  REVIEWED_DB_BASELINE_SHA256,
  REVIEWED_EXCLUDED,
  REVIEWED_SNAPSHOT_SHA256,
  mergeAdditive,
  parseArgs,
  runReviewedApply,
} from "../../../scripts/torrentio-av-import.mjs"

const ROOT = path.resolve(__dirname, "../../..")

const UNION_IDS = REVIEWED832_APPROVED.map((e) => e.id)
const PHASE1_IDS = new Set(REVIEWED_APPROVED.map((e) => e.id))
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

// Post-apply contract anchors (verified against the offline rehearsal on a DB
// copy before the production apply; the writer is deterministic).
const POST_UNION_DB_SHA256 = "099560c0eec8e28369fe8839462760653b15aedd8e726544715294c3bca44058"
const PHASE1_SUBSET_SHA256 = "00dc30b1058f20b5b408bd11ad0085b45a5cba1d03c1244251a49d0444729621"
const FHD_ROWS = ["tt0137523", "tt2737304"]
const SERIES_ANCHORS: Record<string, { quality: string; formats: string[] }> = {
  tt11198330: { quality: "4K", formats: ["dv", "atmos"] },
  tt10466872: { quality: "4K", formats: ["dv", "atmos"] },
}
const UNKNOWN_ANCHORS: Record<string, { quality: string; formats: string[] }> = {
  tt0167258: { quality: "4K", formats: ["dv", "atmos"] },
  tt10638622: { quality: "4K", formats: ["dv", "atmos"] },
  tt12439741: { quality: "4K", formats: ["imax"] },
  tt3044887: { quality: "4K", formats: ["dv", "atmos"] },
}
const IMAX_IDS = ["tt0114388","tt0371746","tt0372784","tt0468569","tt0816692","tt10366460","tt10648342","tt1074638","tt10872600","tt10954984","tt11315808","tt1160419","tt12037194","tt1211837","tt1228705","tt1229238","tt12439741","tt12584954","tt1300854","tt1345836","tt1375666","tt14539740","tt1477834","tt15239678","tt15398776","tt1630029","tt1745960","tt1825683","tt18412256","tt1843866","tt2015381","tt2049403","tt2382320","tt2488496","tt2527336","tt2527338","tt2975590","tt3498820","tt3501632","tt3748528","tt3896198","tt4154756","tt4154796","tt4633694","tt5013056","tt6263850","tt6320628","tt6334354","tt6710474","tt6723592","tt6791350","tt8579674","tt9114286","tt9218128","tt9376612","tt9419884","tt9603212"]
const CONFLICT_UNIONS: Record<string, string[]> = {
  tt0087332: ["dv", "atmos", "hdr10plus"],
  tt0090605: ["dv", "atmos"],
  tt0104694: ["dv", "atmos"],
  tt0138704: ["dv", "atmos", "hdr10plus"],
  tt0325980: ["dv", "atmos", "hdr10plus"],
  tt0369610: ["dv", "atmos", "hdr10plus"],
  tt0383574: ["dv", "atmos", "hdr10plus"],
  tt0425379: ["dv", "atmos"],
  tt0816692: ["imax", "hdr", "dv", "hdr10plus", "atmos"],
  tt1130884: ["dv", "hdr10plus"],
}

function sha256Hex(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex")
}

describe("union-832 scope pins (user-authorized additive union, no replacement)", () => {
  it("binds exactly 832 approved ids with the authorized composition", () => {
    expect(REVIEWED832_APPROVED).toHaveLength(832)
    expect(new Set(UNION_IDS).size).toBe(832)
    for (const id of UNION_IDS) expect(id).toMatch(/^tt\d{7,10}$/)
    const byAdded = (wanted: string[]) =>
      REVIEWED832_APPROVED.filter((e) => JSON.stringify(e.added) === JSON.stringify(wanted))
    expect(byAdded(["hdr"])).toHaveLength(771)
    expect(byAdded(["dv", "hdr"])).toHaveLength(3)
    expect(byAdded(["hdr", "atmos"])).toHaveLength(25)
    expect(byAdded(["hdr10plus"])).toHaveLength(6)
    expect(byAdded(["atmos"])).toHaveLength(3)
    expect(byAdded(["hdr", "hdr10plus"])).toHaveLength(23)
    expect(byAdded(["dv", "hdr10plus", "atmos"])).toHaveLength(1)
  })

  it("is disjoint from the 105 phase-1 ids and contains all 10 prev-conflicts", () => {
    for (const id of UNION_IDS) expect(PHASE1_IDS.has(id)).toBe(false)
    expect([...REVIEWED_EXCLUDED].sort()).toEqual([...EXCLUDED_10].sort())
    for (const id of EXCLUDED_10) expect(UNION_IDS).toContain(id)
  })

  it("adds only absent allowlisted formats, never imax; hdr census is 822", () => {
    let hdrCount = 0
    for (const { added } of REVIEWED832_APPROVED) {
      expect(added.length).toBeGreaterThan(0)
      for (const token of added) expect(ALLOWED_MERGE_FORMATS).toContain(token)
      expect(added).not.toContain("imax")
      if (added.includes("hdr")) hdrCount += 1
    }
    expect(hdrCount).toBe(822)
  })

  it("shares the phase-1 snapshot pin and binds the post-105 db baseline", () => {
    expect(REVIEWED832_PINS.snapshotSha256).toBe(REVIEWED_SNAPSHOT_SHA256)
    expect(REVIEWED832_PINS.snapshotBytes).toBe(489781)
    expect(REVIEWED832_DB_BASELINE_SHA256).toMatch(/^[0-9a-f]{64}$/)
    expect(REVIEWED832_DB_BASELINE_SHA256).not.toBe(REVIEWED_DB_BASELINE_SHA256)
    expect(REVIEWED832_DB_KEYS).toBe(1430)
    expect(REVIEWED832_SCOPE).toBe("reviewed-union-832:movie-only,822generic-hdr+10prev-conflicts")
    expect(REVIEWED832_PINS.scope).toBe(REVIEWED832_SCOPE)
    expect([...REVIEWED832_PINS.excluded].sort()).toEqual([...PHASE1_IDS].sort())
    expect([...REVIEWED832_PINS.allowedCandidateQualities].sort()).toEqual([...KNOWN_QUALITIES].sort())
  })

  it("every approved id is backed by a versioned sanitized provenance entry (no raw snapshot replay)", () => {
    // Versioned sanitized provenance + manifest consistency: this asserts
    // on the user-facing provenance evidence (source/verification/scope +
    // declared enums + observed batch date), not by replaying the raw
    // snapshot/checkpoint file, so it runs identically with no external
    // checkpoint available.
    const provenance = JSON.parse(
      fs.readFileSync(path.join(ROOT, "src", "data", "av-specs-torrentio-provenance.json"), "utf8"),
    )
    expect(Object.keys(provenance)).toHaveLength(REVIEWED_APPROVED.length + REVIEWED832_APPROVED.length)
    for (const { id, added } of REVIEWED832_APPROVED) {
      const entry = provenance[id]
      expect(entry, id).toBeDefined()
      expect(entry.source).toBe("torrentio")
      expect(entry.verification).toBe("declared")
      expect(entry.userAccepted).toBe(true)
      expect(entry.decision).toBe("mutated")
      expect(entry.classification).toBe("movie")
      expect(entry.movieResults).toBe(1)
      expect(entry.tvResults).toBe(0)
      expect(entry.added).toEqual(added)
      expect(entry.scope).toBe(REVIEWED832_SCOPE)
      expect(entry.snapshotSha256).toBe(REVIEWED_SNAPSHOT_SHA256)
      expect(typeof entry.observedAt === "string" && entry.observedAt.startsWith("2026-10-21")).toBe(true)
      // Declared candidate quality/formats match the union pin allowlist
      // and the known vocabularies; the union delta is a subset of the
      // declared formats (never imax, never outside the merge allowlist).
      expect(REVIEWED832_PINS.allowedCandidateQualities).toContain(entry.declared.quality)
      expect(KNOWN_QUALITIES).toContain(entry.declared.quality)
      expect(Array.isArray(entry.declared.formats)).toBe(true)
      for (const token of entry.declared.formats) expect(KNOWN_FORMAT_TOKENS).toContain(token)
      for (const token of added) {
        expect(ALLOWED_MERGE_FORMATS).toContain(token)
        expect(entry.declared.formats).toContain(token)
      }
      expect(added).not.toContain("imax")
    }
  })

  it("the preserved phase-1 provenance reconstructs the pinned baseline bytes", () => {
    // The on-disk provenance file is writer-canonical (sorted keys +
    // trailing newline); removing this batch leaves exactly the pinned
    // phase-1 baseline full bytes (original full-105 canonical SHA +
    // byte size), proving the original formatting was canonical.
    const rawText = fs.readFileSync(
      path.join(ROOT, "src", "data", "av-specs-torrentio-provenance.json"),
      "utf8",
    )
    const provenance = JSON.parse(rawText)
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(provenance).sort()) sorted[key] = provenance[key]
    expect(rawText).toBe(`${JSON.stringify(sorted, null, 2)}\n`)
    const unionIds = new Set(REVIEWED832_APPROVED.map((e) => e.id))
    const preserved: Record<string, unknown> = {}
    for (const key of Object.keys(provenance)) {
      if (!unionIds.has(key)) preserved[key] = provenance[key]
    }
    expect(Object.keys(preserved)).toHaveLength(REVIEWED_APPROVED.length)
    const preservedSorted: Record<string, unknown> = {}
    for (const key of Object.keys(preserved).sort()) preservedSorted[key] = preserved[key]
    const preservedText = `${JSON.stringify(preservedSorted, null, 2)}\n`
    expect(REVIEWED832_PINS.provenanceBaselineSha256).toBe(
      "c832d1755a340b27448314da868def1b81b2605cda6655a97f0f18614a9185f3",
    )
    expect(sha256Hex(Buffer.from(preservedText, "utf-8"))).toBe(
      REVIEWED832_PINS.provenanceBaselineSha256,
    )
    expect(REVIEWED832_PINS.provenanceBaselineBytes).toBe(67743)
    expect(Buffer.byteLength(preservedText, "utf-8")).toBe(REVIEWED832_PINS.provenanceBaselineBytes)
  })
})

describe("parseArgs union gating (no live, no generic writer)", () => {
  it("accepts --apply-reviewed-union without --live", () => {
    expect(parseArgs(["--apply-reviewed-union"]).ok).toBe(true)
  })

  it("rejects --apply-reviewed-union combined with --live/--only/--limit or phase 1", () => {
    expect(parseArgs(["--live", "--apply-reviewed-union"]).ok).toBe(false)
    expect(parseArgs(["--apply-reviewed-union", "--only", "tt0133093"]).ok).toBe(false)
    expect(parseArgs(["--apply-reviewed-union", "--limit", "1"]).ok).toBe(false)
    expect(parseArgs(["--apply-reviewed", "--apply-reviewed-union"]).ok).toBe(false)
  })

  it("keeps the original live --apply path disabled", () => {
    expect(parseArgs(["--live", "--apply"]).ok).toBe(false)
  })
})

interface UnionFixtureOverrides {
  ids?: string[];
  candidateQuality?: string;
  dbExtra?: Record<string, { quality: string; formats: string[] }>;
  classification?: Record<string, string>;
  pinsExtra?: Record<string, unknown>;
  skipCheckpoint?: string[];
  priorProvenance?: Record<string, unknown>;
}

function makeUnionFixture(overrides: UnionFixtureOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pictorium-avimport-union-"))
  const ids = overrides.ids ?? ["tt0000007", "tt0000008"]
  const db: Record<string, { quality: string; formats: string[] }> = {}
  for (const id of ids) db[id] = { quality: "4K", formats: ["dv"] }
  if (overrides.dbExtra) Object.assign(db, overrides.dbExtra)
  const dbPath = path.join(dir, "av-specs.json")
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2) + "\n", "utf-8")
  const quality = overrides.candidateQuality ?? "4K"
  const checkpointIds: Record<string, unknown> = {}
  for (const id of ids) {
    if (overrides.skipCheckpoint?.includes(id)) continue
    checkpointIds[id] = {
      stage: "done",
      classification: overrides.classification?.[id] ?? "movie",
      decision: "mutated",
      added: ["hdr"],
      movieResults: 1,
      tvResults: 0,
      candidate: { quality, formats: ["hdr"] },
      observedAt: "2026-10-21T09:00:00.000Z",
    }
  }
  const checkpointPath = path.join(dir, "checkpoint.json")
  fs.writeFileSync(checkpointPath, JSON.stringify({ ids: checkpointIds }, null, 2) + "\n", "utf-8")
  const provenancePath = path.join(dir, "av-specs-torrentio-provenance.json")
  if (overrides.priorProvenance) {
    const priorSorted: Record<string, unknown> = {}
    for (const key of Object.keys(overrides.priorProvenance).sort()) {
      priorSorted[key] = overrides.priorProvenance[key]
    }
    fs.writeFileSync(provenancePath, `${JSON.stringify(priorSorted, null, 2)}\n`, "utf-8")
  }
  const dbBytes = fs.readFileSync(dbPath)
  const cpBytes = fs.readFileSync(checkpointPath)
  const basePins = {
    snapshotSha256: sha256Hex(cpBytes),
    snapshotBytes: cpBytes.length,
    dbBaselineSha256: sha256Hex(dbBytes),
    dbKeys: Object.keys(db).length,
    approved: ids.map((id) => ({ id, added: ["hdr"] })),
    excluded: ["tt9999999"],
    allowedCandidateQualities: [...KNOWN_QUALITIES],
    scope: "reviewed-union-test",
    ...(overrides.pinsExtra ?? {}),
  }
  // A pinned prior provenance simulates the preserved phase-1 file: the
  // fixture provenance is written writer-canonical (sorted keys + trailing
  // newline) and the pin binds its exact full bytes.
  const pins = overrides.priorProvenance
    ? {
        ...basePins,
        provenanceBaselineSha256: sha256Hex(fs.readFileSync(provenancePath)),
        provenanceBaselineBytes: fs.readFileSync(provenancePath).length,
      }
    : basePins
  return { dir, dbPath, provenancePath, checkpointPath, pins, dbText: dbBytes.toString("utf-8") }
}

describe("runReviewedApply union-phase fixtures (offline, no network)", () => {
  it("applies the union delta and records the union scope with declared provenance", () => {
    const f = makeUnionFixture()
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.applied).toBe(2)
    const db = JSON.parse(fs.readFileSync(f.dbPath, "utf-8"))
    expect(db["tt0000007"]).toEqual({ quality: "4K", formats: ["dv", "hdr"] })
    expect(db["tt0000008"]).toEqual({ quality: "4K", formats: ["dv", "hdr"] })
    const prov = JSON.parse(fs.readFileSync(f.provenancePath, "utf-8"))
    expect(Object.keys(prov)).toHaveLength(2)
    for (const id of Object.keys(prov)) {
      expect(prov[id].source).toBe("torrentio")
      expect(prov[id].verification).toBe("declared")
      expect(prov[id].userAccepted).toBe(true)
      expect(prov[id].scope).toBe("reviewed-union-test")
      expect(prov[id].added).toEqual(["hdr"])
    }
    const text = fs.readFileSync(f.provenancePath, "utf-8")
    expect(text).not.toContain("magnet")
    expect(text).not.toContain("infoHash")
    expect(text).not.toContain("http")
  })

  it("accepts an FHD declared candidate under the union allowlist without touching stored quality", () => {
    const f = makeUnionFixture({ candidateQuality: "FHD" })
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(true)
    const db = JSON.parse(fs.readFileSync(f.dbPath, "utf-8"))
    expect(db["tt0000007"]).toEqual({ quality: "4K", formats: ["dv", "hdr"] })
    const prov = JSON.parse(fs.readFileSync(f.provenancePath, "utf-8"))
    expect(prov["tt0000007"].declared).toEqual({ quality: "FHD", formats: ["hdr"] })
  })

  it("rejects the same FHD candidate when qualities are restricted to 4K", () => {
    const f = makeUnionFixture({
      candidateQuality: "FHD",
      pinsExtra: { allowedCandidateQualities: ["4K"] },
    })
    const before = fs.readFileSync(f.dbPath, "utf-8")
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(false)
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(before)
    expect(fs.existsSync(f.provenancePath)).toBe(false)
  })

  it("enforces the excluded list (phase-1 ids cannot re-enter via the union)", () => {
    const f = makeUnionFixture({
      ids: ["tt0000007", "tt9999999"],
      pinsExtra: { approved: [{ id: "tt0000007", added: ["hdr"] }, { id: "tt9999999", added: ["hdr"] }] },
    })
    const before = fs.readFileSync(f.dbPath, "utf-8")
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on excluded id")
    expect(res.error).toContain("excluded list")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(before)
    expect(fs.existsSync(f.provenancePath)).toBe(false)
  })

  it("is idempotent and rolls back the db write when provenance persistence fails", () => {
    const f = makeUnionFixture()
    const first = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(first.ok).toBe(true)
    const dbSha = sha256Hex(fs.readFileSync(f.dbPath))
    const second = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.error)
    expect(second.idempotent).toBe(true)
    expect(sha256Hex(fs.readFileSync(f.dbPath))).toBe(dbSha)

    const g = makeUnionFixture()
    fs.mkdirSync(g.provenancePath)
    const res = runReviewedApply(
      { dbPath: g.dbPath, provenancePath: g.provenancePath, checkpointPath: g.checkpointPath },
      g.pins,
    )
    expect(res.ok).toBe(false)
    expect(fs.readFileSync(g.dbPath, "utf-8")).toBe(g.dbText)
  })

  it("fails closed on unrelated drift with no writes", () => {
    const f = makeUnionFixture({ dbExtra: { tt9999998: { quality: "4K", formats: ["dv"] } } })
    expect(
      runReviewedApply(
        { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
        f.pins,
      ).ok,
    ).toBe(true)
    const db = JSON.parse(fs.readFileSync(f.dbPath, "utf-8"))
    db["tt9999998"] = { quality: "4K", formats: ["dv", "hdr"] }
    fs.writeFileSync(f.dbPath, JSON.stringify(db, null, 2) + "\n", "utf-8")
    const dbBefore = fs.readFileSync(f.dbPath, "utf-8")
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on unrelated drift")
    expect(res.error).toContain("database changed outside the reviewed batch")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(dbBefore)
  })
})

describe("runReviewedApply union-phase provenance baseline guard (offline, no network)", () => {
  const PRIOR = { tt0000001: { source: "torrentio", scope: "reviewed-test-phase1", note: "preserved" } }

  function writeProvenanceSorted(provenancePath: string, obj: Record<string, unknown>) {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) sorted[key] = obj[key]
    fs.writeFileSync(provenancePath, `${JSON.stringify(sorted, null, 2)}\n`, "utf-8")
  }

  it("preserves the pinned prior provenance verbatim on a fresh apply", () => {
    const f = makeUnionFixture({ priorProvenance: PRIOR })
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(res.error)
    expect(res.applied).toBe(2)
    const prov = JSON.parse(fs.readFileSync(f.provenancePath, "utf-8"))
    expect(prov["tt0000001"]).toEqual(PRIOR["tt0000001"])
    expect(Object.keys(prov)).toHaveLength(1 + 2)
  })

  it("fails closed when the pinned prior provenance is missing, with no writes", () => {
    const f = makeUnionFixture({ priorProvenance: PRIOR })
    fs.rmSync(f.provenancePath)
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on missing prior provenance")
    expect(res.error).toContain("prior provenance is missing")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(f.provenancePath)).toBe(false)
  })

  it("fails closed when the pinned prior provenance drifts, with no writes", () => {
    const f = makeUnionFixture({ priorProvenance: PRIOR })
    writeProvenanceSorted(f.provenancePath, {
      ...PRIOR,
      tt0000001: { source: "torrentio", scope: "reviewed-test-phase1", note: "tampered" },
    })
    const provBefore = fs.readFileSync(f.provenancePath, "utf-8")
    const res = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("expected failure on drifted prior provenance")
    expect(res.error).toContain("prior provenance")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.readFileSync(f.provenancePath, "utf-8")).toBe(provBefore)
  })

  it("rejects drift in the preserved prior entries on an idempotent re-run", () => {
    const f = makeUnionFixture({ priorProvenance: PRIOR })
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
    const prov = JSON.parse(fs.readFileSync(f.provenancePath, "utf-8"))
    prov["tt0000001"] = { ...prov["tt0000001"], note: "tampered" }
    writeProvenanceSorted(f.provenancePath, prov)
    const dbBefore = fs.readFileSync(f.dbPath, "utf-8")
    const provBefore = fs.readFileSync(f.provenancePath, "utf-8")
    const third = runReviewedApply(
      { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath },
      f.pins,
    )
    expect(third.ok).toBe(false)
    if (third.ok) throw new Error("expected failure on drifted preserved provenance")
    expect(third.error).toContain("preserved provenance baseline mismatch")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(dbBefore)
    expect(fs.readFileSync(f.provenancePath, "utf-8")).toBe(provBefore)
  })
})

describe("CLI union gating (subprocess, no network)", () => {
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
    const f = makeUnionFixture()
    const res = spawnSync(
      process.execPath,
      [scriptPath, "--apply-reviewed-union", "--db", f.dbPath, "--provenance", f.provenancePath, "--checkpoint", f.checkpointPath],
      { env: strippedEnv(), encoding: "utf-8" },
    )
    expect(res.status).not.toBe(0)
    expect(String(res.stderr)).toContain("snapshot")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
    expect(fs.existsSync(f.provenancePath)).toBe(false)
  })

  it("rejects --live --apply-reviewed-union before any config, network, or write", () => {
    const f = makeUnionFixture()
    const res = spawnSync(
      process.execPath,
      [scriptPath, "--live", "--apply-reviewed-union", "--db", f.dbPath, "--checkpoint", f.checkpointPath],
      { env: strippedEnv(), encoding: "utf-8" },
    )
    expect(res.status).not.toBe(0)
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(f.dbText)
  })
})

describe("union-832 real database contract (post-apply, 937 declared entries)", () => {
  it("keeps 1430 rows with no new titles and carries every union delta", () => {
    const db = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "av-specs.json"), "utf8"))
    expect(Object.keys(db)).toHaveLength(1430)
    for (const { id, added } of REVIEWED832_APPROVED) {
      const entry = db[id]
      expect(entry, id).toBeDefined()
      for (const token of added) expect(entry.formats, id).toContain(token)
    }
  })

  it("never changes stored quality on this phase (FHD pair stays FHD, rest 4K)", () => {
    const db = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "av-specs.json"), "utf8"))
    const fhd = REVIEWED832_APPROVED.filter(({ id }) => db[id].quality === "FHD").map(({ id }) => id).sort()
    expect(fhd).toEqual([...FHD_ROWS].sort())
    for (const { id } of REVIEWED832_APPROVED) {
      expect(KNOWN_QUALITIES).toContain(db[id].quality)
    }
  })

  it("adds no imax from declared streams; the curated imax set is byte-identical", () => {
    const db = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "av-specs.json"), "utf8"))
    const imax = Object.keys(db).filter((id) => db[id].formats.includes("imax")).sort()
    expect(imax).toEqual([...IMAX_IDS].sort())
  })

  it("leaves the 2 series and 4 unknown rows verbatim", () => {
    for (const [id, expected] of Object.entries({ ...SERIES_ANCHORS, ...UNKNOWN_ANCHORS })) {
      expect(lookupAVSpecs(id)).toEqual(expected)
    }
  })

  it("mutates the 10 prev-conflicts to the authorized title-edition unions", () => {
    for (const [id, formats] of Object.entries(CONFLICT_UNIONS)) {
      const specs = lookupAVSpecs(id)
      expect(specs).not.toBeNull()
      expect(specs?.quality).toBe("4K")
      expect(specs?.formats).toEqual(formats)
    }
  })

  it("carries 937 provenance entries: 105 phase-1 verbatim + 832 union declared", () => {
    const provenance = JSON.parse(
      fs.readFileSync(path.join(ROOT, "src", "data", "av-specs-torrentio-provenance.json"), "utf8"),
    )
    expect(Object.keys(provenance)).toHaveLength(937)
    const phase1Subset: Record<string, unknown> = {}
    for (const id of Object.keys(provenance).sort()) {
      if (PHASE1_IDS.has(id)) phase1Subset[id] = provenance[id]
    }
    expect(Object.keys(phase1Subset)).toHaveLength(105)
    expect(sha256Hex(Buffer.from(JSON.stringify(phase1Subset), "utf-8"))).toBe(PHASE1_SUBSET_SHA256)
    for (const { id, added } of REVIEWED832_APPROVED) {
      const entry = provenance[id]
      expect(entry, id).toBeDefined()
      expect(entry.source).toBe("torrentio")
      expect(entry.verification).toBe("declared")
      expect(entry.userAccepted).toBe(true)
      expect(entry.decision).toBe("mutated")
      expect(entry.classification).toBe("movie")
      expect(entry.added).toEqual(added)
      expect(entry.scope).toBe(REVIEWED832_SCOPE)
      expect(entry.snapshotSha256).toBe(REVIEWED_SNAPSHOT_SHA256)
      expect(entry.semantics).toContain("title-edition-union")
      expect(Object.keys(entry).sort()).toEqual(
        ["added", "classification", "decision", "declared", "verification", "userAccepted", "movieResults", "observedAt", "scope", "semantics", "snapshotSha256", "source", "tvResults"].sort(),
      )
    }
  })

  it("keeps provenance allowlist-only (no raw names, hashes, urls, magnets, keys, paths)", () => {
    const text = fs.readFileSync(path.join(ROOT, "src", "data", "av-specs-torrentio-provenance.json"), "utf8")
    for (const needle of ["magnet", "infohash", "http", "filename", ".mkv", "C:", "/tmp/", ".json", "api_key", "token"]) {
      expect(text.toLowerCase()).not.toContain(needle)
    }
  })

  it("pins the full post-union database bytes", () => {
    const bytes = fs.readFileSync(path.join(ROOT, "src", "data", "av-specs.json"))
    expect(sha256Hex(bytes)).toBe(POST_UNION_DB_SHA256)
  })

  it("a superseded phase manifest fails closed on a newer delta with no writes (baseline mismatch)", () => {
    // Self-contained deterministic fixture: apply a phase-1-like manifest,
    // then a disjoint phase-2-like delta, then re-running the old phase pins
    // must fail closed (the db no longer reconstructs the old baseline)
    // with no writes — the same fail-closed the production phase-1 pins
    // exhibit on the union db. No production files, no external checkpoint.
    const f = makeUnionFixture({ ids: ["tt0000007", "tt0000008", "tt0000009"] })
    const paths = { dbPath: f.dbPath, provenancePath: f.provenancePath, checkpointPath: f.checkpointPath }
    const pinsA = {
      ...f.pins,
      approved: [
        { id: "tt0000007", added: ["hdr"] },
        { id: "tt0000008", added: ["hdr"] },
      ],
      excluded: ["tt0000009"],
      scope: "reviewed-test-phase1",
    }
    const first = runReviewedApply(paths, pinsA)
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error(first.error)
    expect(first.applied).toBe(2)
    const pinsB = {
      ...f.pins,
      approved: [{ id: "tt0000009", added: ["hdr"] }],
      excluded: ["tt0000007", "tt0000008"],
      dbBaselineSha256: sha256Hex(fs.readFileSync(f.dbPath)),
      scope: "reviewed-test-phase2",
    }
    const second = runReviewedApply(paths, pinsB)
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error(second.error)
    expect(second.applied).toBe(1)
    const dbBefore = fs.readFileSync(f.dbPath, "utf-8")
    const provBefore = fs.readFileSync(f.provenancePath, "utf-8")
    const stale = runReviewedApply(paths, pinsA)
    expect(stale.ok).toBe(false)
    if (stale.ok) throw new Error("expected the superseded phase manifest to fail closed")
    expect(stale.error).toContain("database changed outside the reviewed batch")
    expect(fs.readFileSync(f.dbPath, "utf-8")).toBe(dbBefore)
    expect(fs.readFileSync(f.provenancePath, "utf-8")).toBe(provBefore)
  })
})

describe("guarded merge keeps the union additive (unit)", () => {
  it("never downgrades quality and never merges imax from declared candidates", () => {
    const merged = mergeAdditive({ quality: "4K", formats: ["dv"] }, { quality: "FHD", formats: ["hdr", "imax"] })
    expect(merged.entry).toEqual({ quality: "4K", formats: ["dv", "hdr"] })
    expect(merged.added).toEqual(["hdr"])
  })
})
