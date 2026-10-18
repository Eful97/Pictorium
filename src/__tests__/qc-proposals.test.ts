import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  buildProposals,
  evaluateObservation,
  mapFormatToken,
  mapQualityToken,
  sanitizeProvenance,
  toMs,
} from "../../scripts/build-qc-proposals.mjs"

// Requires a rejected observation and narrows the inferred entry union to
// the rejection member. The untyped JS module infers `ok` widened to
// boolean (so `expect(ok)` alone never narrows) with entry as rejection
// { index, imdb, decision, reasons } vs proposal variants carrying
// reviewReasons. The `ok` check plus `"reasons" in entry` / `"index" in
// entry` plus the Array.isArray/element guards below perform the actual
// narrowing; the helper fails the test on proposal results so a wrong-path
// regression can never silently pass. No casts, no `any`.
type QcObservationResult = ReturnType<typeof evaluateObservation>

function rejectedEntry(result: QcObservationResult) {
  expect(result.ok).toBe(false)
  if (result.ok) {
    throw new Error("expected a rejected observation, got a proposal")
  }
  const entry = result.entry
  if (!("reasons" in entry) || !("index" in entry)) {
    throw new Error("expected a rejected observation entry with index and reasons")
  }
  if (!Array.isArray(entry.reasons) || !entry.reasons.every((reason) => typeof reason === "string")) {
    throw new Error("expected rejected reasons to be an array of strings")
  }
  return entry
}

const SCRIPT = path.resolve(process.cwd(), "scripts/build-qc-proposals.mjs")
const NOW_ISO = "2026-10-17T13:00:00.000Z"
const NOW_MS = Date.parse(NOW_ISO)
const FRESH_S = Date.parse("2026-10-09T00:00:00.000Z") / 1000
const OLD_S = Date.parse("2026-05-01T00:00:00.000Z") / 1000
const FUTURE_S = Date.parse("2027-01-01T00:00:00.000Z") / 1000

const LOCAL_DB = {
  tt15239678: { quality: "4K", formats: ["dv"] },
  tt0068646: { quality: "4K", formats: ["dv", "atmos"] },
  tt0816692: { quality: "4K", formats: ["imax"] },
  tt11198330: { quality: "4K", formats: ["atmos", "dv"] },
}

function movieBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "tt15239678",
    type: "movie",
    status: "ready",
    quality: "4K REMUX DV ATMOS",
    tokens: ["4K", "REMUX", "DV", "ATMOS"],
    trust_rule: "Radarr Remux T1",
    trust_tier: "trusted",
    min_trust: "high",
    checked_streams: 100,
    trusted_streams: 6,
    matched_streams: 6,
    stale: false,
    updated_at: FRESH_S,
    next_refresh_at: FUTURE_S,
    cache_policy: "default",
    last_error: null,
    ...overrides,
  }
}

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    localDb: LOCAL_DB,
    nowMs: NOW_MS,
    minTrustRequired: "high",
    maxAgeDays: 90,
    ...overrides,
  }
}

function runCli(args: string[], cwd: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
    }) as string
    return { ok: true, stdout: String(stdout), stderr: "" }
  } catch (e) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string }
    return {
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? e),
    }
  }
}

describe("token mapping (explicit only, never invent IMAX)", () => {
  it("maps the documented quality tokens", () => {
    expect(mapQualityToken("4K")).toBe("4K")
    expect(mapQualityToken("1080P")).toBe("FHD")
    expect(mapQualityToken("720P")).toBe("HD")
    expect(mapQualityToken("SD")).toBe("SD")
    expect(mapQualityToken(" 4k ")).toBe("4K")
  })

  it("ignores non-explicit quality tokens (no inference)", () => {
    for (const t of ["2160P", "UHD", "8K", "1440P", "HDTV", "WEBDL", "REMUX", "FOO", "", 42, null]) {
      expect(mapQualityToken(t as string)).toBeNull()
    }
  })

  it("maps the documented format tokens", () => {
    expect(mapFormatToken("DV")).toBe("dv")
    expect(mapFormatToken("HDR")).toBe("hdr")
    expect(mapFormatToken("HDR10")).toBe("hdr")
    expect(mapFormatToken("HDR10+")).toBe("hdr10plus")
    expect(mapFormatToken("ATMOS")).toBe("atmos")
  })

  it("never maps IMAX or source tokens (metadata only, no schema inflation)", () => {
    for (const t of ["IMAX", "REMUX", "BLURAY", "WEBDL", "WEBRIP", "HDTV", "8K", "FOO", "", 42, null]) {
      expect(mapFormatToken(t as string)).toBeNull()
    }
  })
})

describe("toMs (epoch seconds vs millis vs ISO)", () => {
  it("treats QualiCache float epochs as seconds", () => {
    expect(toMs(1786600224.8469446)).toBe(1786600224846.9446)
  })

  it("treats large epochs as millis and parses ISO", () => {
    expect(toMs(1786600224846)).toBe(1786600224846)
    expect(toMs("2026-10-09T00:00:00.000Z")).toBe(Date.parse("2026-10-09T00:00:00.000Z"))
  })

  it("rejects non-finite and unparseable timestamps", () => {
    expect(toMs(null)).toBeNull()
    expect(toMs(Number.NaN)).toBeNull()
    expect(toMs("not-a-date")).toBeNull()
    expect(toMs("")).toBeNull()
  })
})

describe("positive movie additive proposal", () => {
  it("proposes only the missing format, preserving the curated entry", () => {
    const res = evaluateObservation(movieBody(), 0, ctx())
    expect(res.ok).toBe(true)
    const e = res.entry as Record<string, unknown>
    expect(e.kind).toBe("movie-additive")
    expect(e.decision).toBe("needs-review")
    expect(e.local).toEqual({ quality: "4K", formats: ["dv"] })
    expect(e.candidateDelta).toEqual({ addQuality: null, addFormats: ["atmos"] })
    expect(e.observed).toEqual({ quality: "4K", formats: ["dv", "atmos"] })
    expect((e.reviewReasons as string[]).join(" ")).toMatch(/corroboration/)
  })
})

describe("existing preserved: omission and down-tier", () => {
  it("blocks a lower-tier quality and treats omissions as edition-specific", () => {
    const res = evaluateObservation(
      movieBody({ id: "tt0068646", quality: "1080P BLURAY DV", tokens: ["1080P", "BLURAY", "DV"] }),
      0,
      ctx(),
    )
    expect(res.ok).toBe(true)
    const e = res.entry as Record<string, unknown>
    expect(e.kind).toBe("movie-additive")
    expect(e.decision).toBe("no-change")
    expect(e.local).toEqual({ quality: "4K", formats: ["dv", "atmos"] })
    expect(e.candidateDelta).toEqual({ addQuality: null, addFormats: [] })
    const reasons = (e.reviewReasons as string[]).join(" | ")
    expect(reasons).toMatch(/quality-downgrade-blocked/)
    expect(reasons).toMatch(/edition-specific omission/)
  })

  it("keeps local imax untouched (out of QC token vocabulary)", () => {
    const res = evaluateObservation(
      movieBody({ id: "tt0816692", quality: "4K REMUX DV", tokens: ["4K", "REMUX", "DV"] }),
      0,
      ctx(),
    )
    expect(res.ok).toBe(true)
    const e = res.entry as Record<string, unknown>
    expect(e.local).toEqual({ quality: "4K", formats: ["imax"] })
    expect(e.candidateDelta).toEqual({ addQuality: null, addFormats: ["dv"] })
    expect((e.observed as Record<string, unknown>).formats).toEqual(["dv"])
    // Local imax is echoed verbatim (preserved), but never derived from QC:
    // observed formats and the additive delta must not contain it.
    expect((e.observed as Record<string, unknown>).formats).not.toContain("imax")
    expect((e.candidateDelta as Record<string, unknown>).addFormats).not.toContain("imax")
  })
})

describe("movie addition for unknown ids", () => {
  it("emits a needs-review proposal, never a verified claim", () => {
    const res = evaluateObservation(movieBody({ id: "tt9999999" }), 0, ctx())
    expect(res.ok).toBe(true)
    const e = res.entry as Record<string, unknown>
    expect(e.kind).toBe("movie-addition")
    expect(e.local).toBeNull()
    expect(e.decision).toBe("needs-review")
    expect(e.candidate).toEqual({ quality: "4K", formats: ["dv", "atmos"] })
    expect((e.reviewReasons as string[]).join(" ")).toMatch(/not a verified file-quality claim/)
  })
})

describe("series records are episode-scoped only", () => {
  const seriesBody = () =>
    movieBody({
      id: "tt0944947",
      type: "series",
      season: 1,
      episode: 1,
      quality: "4K BLURAY DV",
      tokens: ["4K", "BLURAY", "DV"],
      trust_rule: "Radarr UHD Bluray T1",
    })

  it("emits a review-episode-only observation even when the local id is missing", () => {
    const res = evaluateObservation(seriesBody(), 0, ctx())
    expect(res.ok).toBe(true)
    const e = res.entry as Record<string, unknown>
    expect(e.kind).toBe("series-episode-observation")
    expect(e.decision).toBe("review-episode-only")
    expect(e.season).toBe(1)
    expect(e.episode).toBe(1)
    expect(e.local).toBeNull()
    expect(e).not.toHaveProperty("candidate")
    expect(e).not.toHaveProperty("candidateDelta")
    expect((e.reviewReasons as string[]).join(" ")).toMatch(/never a title-level upsert/)
  })

  it("never upserts at title level even when a local entry exists", () => {
    const res = evaluateObservation(
      { ...seriesBody(), id: "tt11198330", tokens: ["4K", "WEBDL", "DV", "ATMOS"] },
      0,
      ctx(),
    )
    expect(res.ok).toBe(true)
    const e = res.entry as Record<string, unknown>
    expect(e.kind).toBe("series-episode-observation")
    expect(e.local).toEqual({ quality: "4K", formats: ["atmos", "dv"] })
    expect(e).not.toHaveProperty("candidate")
  })

  it("rejects non-positive season/episode", () => {
    for (const bad of [
      { season: 0, episode: 1 },
      { season: 1, episode: 0 },
      { season: 1.5, episode: 1 },
      { season: null, episode: 1 },
    ]) {
      const res = evaluateObservation({ ...seriesBody(), ...bad }, 0, ctx())
      expect(res.ok).toBe(false)
      expect(rejectedEntry(res).reasons.join(" ")).toMatch(/invalid-identity/)
    }
  })
})

describe("gating: status, trust, staleness, freshness, identity", () => {
  it.each([["pending"], ["error"], ["empty"], ["unknown-status"], [null]])(
    "rejects non-ready status %s",
    (status) => {
      const res = evaluateObservation(movieBody({ status }), 0, ctx())
      expect(res.ok).toBe(false)
      expect(rejectedEntry(res).decision).toBe("rejected")
      expect(rejectedEntry(res).reasons.join(" ")).toMatch(/status-/)
    },
  )

  it("does not infer trusted from the request min_trust echo", () => {
    const body = movieBody()
    delete (body as Record<string, unknown>).trust_tier
    const res = evaluateObservation(body, 0, ctx())
    expect(res.ok).toBe(false)
    expect(rejectedEntry(res).reasons.join(" ")).toMatch(/trust-tier-not-trusted/)
  })

  it("rejects request trust below the required threshold", () => {
    const res = evaluateObservation(
      {
        body: movieBody({ min_trust: "medium" }),
        request: { endpoint: "/v1/quality/movie/tt15239678", min_trust_request: "medium" },
      },
      0,
      ctx(),
    )
    expect(res.ok).toBe(false)
    expect(rejectedEntry(res).reasons.join(" ")).toMatch(/trust-request-below-threshold/)
  })

  it("rejects stale true and unknown stale", () => {
    expect(evaluateObservation(movieBody({ stale: true }), 0, ctx()).ok).toBe(false)
    const missing = movieBody()
    delete (missing as Record<string, unknown>).stale
    const res = evaluateObservation(missing, 0, ctx())
    expect(res.ok).toBe(false)
    expect(rejectedEntry(res).reasons.join(" ")).toMatch(/stale-unknown/)
  })

  it("rejects too-old observations and future timestamps (next_refresh never grants validity)", () => {
    const old = evaluateObservation(movieBody({ updated_at: OLD_S }), 0, ctx())
    expect(old.ok).toBe(false)
    expect(rejectedEntry(old).reasons.join(" ")).toMatch(/too-old/)
    const future = evaluateObservation(movieBody({ updated_at: FUTURE_S }), 0, ctx())
    expect(future.ok).toBe(false)
    expect(rejectedEntry(future).reasons.join(" ")).toMatch(/future-updated-at/)
  })

  it("rejects invalid identities and endpoint/type mismatches", () => {
    expect(evaluateObservation(movieBody({ id: "12345" }), 0, ctx()).ok).toBe(false)
    expect(evaluateObservation(movieBody({ id: "ttXYZ" }), 0, ctx()).ok).toBe(false)
    const epMismatch = evaluateObservation(
      { body: movieBody(), request: { endpoint: "/v1/quality/movie/tt0000001", min_trust_request: "high" } },
      0,
      ctx(),
    )
    expect(epMismatch.ok).toBe(false)
    expect(rejectedEntry(epMismatch).reasons.join(" ")).toMatch(/identity-mismatch/)
    const typeMismatch = evaluateObservation(
      { body: movieBody(), request: { type: "series", season: 1, episode: 1, min_trust_request: "high" } },
      0,
      ctx(),
    )
    expect(typeMismatch.ok).toBe(false)
    expect(rejectedEntry(typeMismatch).reasons.join(" ")).toMatch(/type-mismatch/)
  })
})

describe("malformed payload and token fields", () => {
  it("rejects non-array or empty tokens, and unmappable-only tokens", () => {
    expect(evaluateObservation(movieBody({ tokens: "4K DV" }), 0, ctx()).ok).toBe(false)
    expect(evaluateObservation(movieBody({ tokens: [] }), 0, ctx()).ok).toBe(false)
    const unknown = evaluateObservation(movieBody({ tokens: ["8K", "HDTV", "FOO", "IMAX"] }), 0, ctx())
    expect(unknown.ok).toBe(false)
    expect(rejectedEntry(unknown).reasons.join(" ")).toMatch(/no-mappable-tokens/)
  })

  it("ignores malformed token elements but keeps mappable ones", () => {
    const res = evaluateObservation(movieBody({ tokens: ["4K", "DV", 42, ""] }), 0, ctx())
    expect(res.ok).toBe(true)
    const e = res.entry as Record<string, unknown>
    expect(e.observed).toEqual({ quality: "4K", formats: ["dv"] })
    // Malformed entries are type summaries, never raw objects/values.
    expect((e.ignoredTokens as Record<string, unknown>).malformed).toEqual(["integer", "string(len=0)"])
  })

  it("rejects non-object entries without throwing", () => {
    for (const bad of [null, 42, "x", []]) {
      const res = evaluateObservation(bad as unknown as Record<string, unknown>, 3, ctx())
      expect(res.ok).toBe(false)
      expect(rejectedEntry(res).index).toBe(3)
    }
  })
})

describe("provenance sanitization (no secrets in output)", () => {
  it("drops API keys, headers, and key material", () => {
    const body = {
      ...movieBody(),
      apiKey: "qc-secret-123",
      api_key: "qc-secret-456",
      keyMaterial: "REDACTED-BUT-MUST-NOT-FLOW",
      headers: { Authorization: "Bearer s3cr3t", "X-Api-Key": "k" },
    }
    const request = {
      endpoint: "/v1/quality/movie/tt15239678",
      min_trust_request: "high",
      apiKey: "req-secret",
      headers: { Cookie: "c=1" },
    }
    expect(sanitizeProvenance(body, request)).toEqual({
      id: "tt15239678",
      type: "movie",
      status: "ready",
      quality: "4K REMUX DV ATMOS",
      tokens: ["4K", "REMUX", "DV", "ATMOS"],
      trust_rule: "Radarr Remux T1",
      trust_tier: "trusted",
      min_trust: "high",
      checked_streams: 100,
      trusted_streams: 6,
      matched_streams: 6,
      stale: false,
      updated_at: FRESH_S,
      next_refresh_at: FUTURE_S,
      cache_policy: "default",
      last_error: null,
      request: { endpoint: "/v1/quality/movie/tt15239678", min_trust_request: "high" },
    })
    const result = buildProposals({ observations: [{ body, request }], ...ctx() })
    const text = JSON.stringify(result)
    for (const secret of ["qc-secret-123", "qc-secret-456", "REDACTED-BUT-MUST-NOT-FLOW", "Bearer s3cr3t", "req-secret"]) {
      expect(text).not.toContain(secret)
    }
    expect(text).not.toContain("apiKey")
    expect(text).not.toContain("Authorization")
  })
})

describe("CLI: offline, deterministic, output-safe", () => {
  it("prints help with no reads and no network (exit 0)", () => {
    const res = runCli(["--help"], process.cwd())
    expect(res.ok).toBe(true)
    expect(res.stdout).toMatch(/OFFLINE-ONLY/)
    expect(res.stdout).toMatch(/--input/)
  })

  it("contains no networking primitives in its source", () => {
    const source = fs.readFileSync(SCRIPT, "utf-8")
    for (const banned of [
      "fetch(",
      "node:http",
      "undici",
      "axios",
      "node-fetch",
      "http.request",
      "https.request",
      "http.get",
      "https.get",
      "XMLHttpRequest",
      "WebSocket",
      "setInterval",
      "setTimeout",
    ]) {
      expect(source, `banned primitive ${banned}`).not.toContain(banned)
    }
  })

  it("emits deterministic proposals to a temp output (byte-identical reruns)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-prop-"))
    const input = path.join(dir, "captured.json")
    const db = path.join(dir, "db.json")
    fs.writeFileSync(
      input,
      JSON.stringify({
        observations: [
          { body: movieBody(), request: { endpoint: "/v1/quality/movie/tt15239678", min_trust_request: "high" } },
          { body: movieBody({ id: "tt0944947", type: "series", season: 1, episode: 1, tokens: ["4K", "BLURAY", "DV"] }) },
          { body: movieBody({ id: "tt0068646", status: "pending", tokens: [] }) },
        ],
      }),
    )
    fs.writeFileSync(db, JSON.stringify(LOCAL_DB))
    const out1 = path.join(dir, "proposal1.json")
    const out2 = path.join(dir, "proposal2.json")
    const common = ["--input", input, "--db", db, "--now", NOW_ISO]
    expect(runCli([...common, "--output", out1], process.cwd()).ok).toBe(true)
    expect(runCli([...common, "--output", out2], process.cwd()).ok).toBe(true)
    expect(fs.readFileSync(out1, "utf-8")).toBe(fs.readFileSync(out2, "utf-8"))
    const proposal = JSON.parse(fs.readFileSync(out1, "utf-8"))
    expect(proposal.mode).toBe("offline")
    expect(proposal.proposals).toHaveLength(2)
    expect(proposal.rejected).toHaveLength(1)
    expect(proposal.stats).toMatchObject({ input: 3, accepted: 2, rejected: 1 })
    expect(proposal.proposals.map((p: { kind: string }) => p.kind).sort()).toEqual([
      "movie-additive",
      "series-episode-observation",
    ])
  })

  it("supports stdout output and bare-body input", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-prop-"))
    const input = path.join(dir, "captured.json")
    const db = path.join(dir, "db.json")
    fs.writeFileSync(input, JSON.stringify([movieBody({ id: "tt9999999" })]))
    fs.writeFileSync(db, JSON.stringify(LOCAL_DB))
    const res = runCli(["--input", input, "--db", db, "--now", NOW_ISO], process.cwd())
    expect(res.ok).toBe(true)
    const proposal = JSON.parse(res.stdout)
    expect(proposal.proposals).toHaveLength(1)
    expect(proposal.proposals[0].kind).toBe("movie-addition")
  })

  it("refuses malformed input with no output file created", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-prop-"))
    const bad = path.join(dir, "bad.json")
    fs.writeFileSync(bad, "{not valid json")
    const out = path.join(dir, "proposal.json")
    expect(runCli(["--input", bad, "--output", out], process.cwd()).ok).toBe(false)
    expect(fs.existsSync(out)).toBe(false)
    const empty = path.join(dir, "empty.json")
    fs.writeFileSync(empty, JSON.stringify({ observations: [] }))
    expect(runCli(["--input", empty, "--output", out], process.cwd()).ok).toBe(false)
    expect(fs.existsSync(out)).toBe(false)
  })

  it("refuses to overwrite the input or the database", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-prop-"))
    const input = path.join(dir, "captured.json")
    const db = path.join(dir, "db.json")
    fs.writeFileSync(input, JSON.stringify([movieBody()]))
    fs.writeFileSync(db, JSON.stringify(LOCAL_DB))
    const beforeInput = fs.readFileSync(input, "utf-8")
    const beforeDb = fs.readFileSync(db, "utf-8")
    expect(runCli(["--input", input, "--output", input, "--db", db, "--now", NOW_ISO], process.cwd()).ok).toBe(false)
    expect(runCli(["--input", input, "--output", db, "--db", db, "--now", NOW_ISO], process.cwd()).ok).toBe(false)
    expect(fs.readFileSync(input, "utf-8")).toBe(beforeInput)
    expect(fs.readFileSync(db, "utf-8")).toBe(beforeDb)
  })
})

describe("identity: endpoint type and agreement (RED-before)", () => {
  it("rejects an endpoint whose type disagrees with the body (no request.type)", () => {
    const res = evaluateObservation(
      { body: movieBody(), request: { endpoint: "/v1/quality/series/tt15239678", min_trust_request: "high" } },
      0,
      ctx(),
    )
    expect(res.ok).toBe(false)
    expect(rejectedEntry(res).reasons.join(" ")).toMatch(/type-mismatch|invalid-endpoint/)
  })

  it("rejects a malformed provided endpoint", () => {
    for (const endpoint of ["/oops/tt15239678", "/v1/quality/unknown/tt15239678", "/v1/quality/movie/not-an-id", 42]) {
      const res = evaluateObservation(
        { body: movieBody(), request: { endpoint, min_trust_request: "high" } },
        0,
        ctx(),
      )
      expect(res.ok).toBe(false)
      expect(rejectedEntry(res).reasons.join(" ")).toMatch(/invalid-endpoint/)
    }
  })

  it("accepts a full URL endpoint canonicalized to its pathname", () => {
    const res = evaluateObservation(
      {
        body: movieBody(),
        request: { endpoint: "https://qualicache.example/v1/quality/movie/tt15239678", min_trust_request: "high" },
      },
      0,
      ctx(),
    )
    expect(res.ok).toBe(true)
  })

  it("rejects disagreeing body/request season+episode instead of letting body win", () => {
    const seriesBody = () =>
      movieBody({ id: "tt0944947", type: "series", season: 2, episode: 2, tokens: ["4K", "BLURAY", "DV"] })
    const res = evaluateObservation(
      { body: seriesBody(), request: { endpoint: "/v1/quality/series/tt0944947", season: 1, episode: 1, min_trust_request: "high" } },
      0,
      ctx(),
    )
    expect(res.ok).toBe(false)
    expect(rejectedEntry(res).reasons.join(" ")).toMatch(/season-mismatch|episode-mismatch/)
  })

  it("rejects disagreeing body/request min_trust instead of mislabeling provenance", () => {
    const res = evaluateObservation(
      {
        body: movieBody({ min_trust: "low" }),
        request: { endpoint: "/v1/quality/movie/tt15239678", min_trust_request: "high" },
      },
      0,
      ctx(),
    )
    expect(res.ok).toBe(false)
    expect(rejectedEntry(res).reasons.join(" ")).toMatch(/trust-request-mismatch/)
  })
})

describe("sanitization: nested secrets never reach output", () => {
  const SECRET_Q = "SECRET-Q-UNIQUE-91827"
  const SECRET_TOK = "SECRET-TOK-UNIQUE-91827"
  const SECRET_RULE = "SECRET-RULE-UNIQUE-91827"
  const SECRET_ERR = "SECRET-ERR-UNIQUE-91827"

  function leakyObservation() {
    return {
      body: {
        ...movieBody(),
        tokens: ["4K", "DV", { apiKey: SECRET_TOK }],
        trust_rule: { rule: SECRET_RULE } as unknown as string,
        last_error: `upstream failed with key ${SECRET_ERR}` as unknown as null,
      },
      request: { endpoint: `/v1/quality/movie/tt15239678?api_key=${SECRET_Q}`, min_trust_request: "high" },
    }
  }

  it("strips URL credentials/query, nested token objects, and raw trust/last_error material", () => {
    const result = buildProposals({ observations: [leakyObservation()], ...ctx() })
    const text = JSON.stringify(result)
    for (const s of [SECRET_Q, SECRET_TOK, SECRET_RULE, SECRET_ERR]) {
      expect(text).not.toContain(s)
    }
    const entry = result.proposals[0] ?? result.rejected[0]
    const prov = (entry as Record<string, unknown>).provenance as Record<string, unknown>
    expect(JSON.stringify(prov)).not.toContain(SECRET_Q)
    const ignored = (entry as Record<string, unknown>).ignoredTokens as Record<string, unknown>
    if (ignored) expect(JSON.stringify(ignored)).not.toContain(SECRET_TOK)
    // Canonical endpoint carries no query.
    const req = prov?.request as Record<string, unknown> | undefined
    if (req?.endpoint) {
      expect(String(req.endpoint)).not.toContain("?")
      expect(String(req.endpoint)).not.toContain(SECRET_Q)
      expect(String(req.endpoint)).toBe("/v1/quality/movie/tt15239678")
    }
    // No raw malformed objects leak through.
    if (ignored) {
      for (const m of (ignored.malformed ?? []) as unknown[]) {
        expect(typeof m).toBe("string")
      }
    }
  })

  it("never stringifies arbitrary objects into rejected reasons", () => {
    const evil = {
      body: {
        ...movieBody(),
        id: { apiKey: "SECRET-ID-UNIQUE-91827" } as unknown as string,
        type: { evil: "SECRET-TYPE-UNIQUE-91827" } as unknown as string,
        updated_at: { token: "SECRET-TIME-UNIQUE-91827" } as unknown as number,
        trust_tier: { tier: "SECRET-TRUST-UNIQUE-91827" } as unknown as string,
      },
    }
    const result = buildProposals({ observations: [evil], ...ctx() })
    const text = JSON.stringify(result)
    for (const s of ["SECRET-ID-UNIQUE-91827", "SECRET-TYPE-UNIQUE-91827", "SECRET-TIME-UNIQUE-91827", "SECRET-TRUST-UNIQUE-91827"]) {
      expect(text).not.toContain(s)
    }
  })
})

describe("CLI: malformed options rejected before any read/write", () => {
  function validInput(dir: string): { input: string; db: string } {
    const input = path.join(dir, "captured.json")
    const db = path.join(dir, "db.json")
    fs.writeFileSync(input, JSON.stringify([movieBody({ id: "tt9999999" })]))
    fs.writeFileSync(db, JSON.stringify(LOCAL_DB))
    return { input, db }
  }

  it("rejects missing values, typos, duplicates, and a bad --min-trust enum", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-prop-"))
    const { input, db } = validInput(dir)
    const out = path.join(dir, "proposal.json")
    // Missing values (flag at end / followed by another flag).
    expect(runCli(["--input", input, "--db", db, "--output"], process.cwd()).ok).toBe(false)
    expect(runCli(["--input", input, "--db", db, "--now"], process.cwd()).ok).toBe(false)
    expect(runCli(["--input", input, "--db", db, "--max-age-days"], process.cwd()).ok).toBe(false)
    expect(runCli(["--input", input, "--db", db, "--min-trust"], process.cwd()).ok).toBe(false)
    expect(runCli(["--input", input, "--db", db, "--db", db], process.cwd()).ok).toBe(false)
    // Unknown flag typo.
    expect(runCli(["--input", input, "--db", db, "--now", NOW_ISO, "--outpt", out], process.cwd()).ok).toBe(false)
    // Duplicate flags.
    expect(runCli(["--input", input, "--input", input, "--db", db, "--now", NOW_ISO], process.cwd()).ok).toBe(false)
    // Bad enum + bad values, nothing written.
    expect(runCli(["--input", input, "--db", db, "--now", NOW_ISO, "--min-trust", "ultra", "--output", out], process.cwd()).ok).toBe(false)
    expect(runCli(["--input", input, "--db", db, "--now", "not-a-date", "--output", out], process.cwd()).ok).toBe(false)
    expect(runCli(["--input", input, "--db", db, "--now", NOW_ISO, "--max-age-days", "banana", "--output", out], process.cwd()).ok).toBe(false)
    expect(fs.existsSync(out)).toBe(false)
  })

  it("accepts the documented --min-trust enum (high/medium/low)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-prop-"))
    const { input, db } = validInput(dir)
    for (const tier of ["high", "medium", "low"]) {
      const res = runCli(["--input", input, "--db", db, "--now", NOW_ISO, "--min-trust", tier], process.cwd())
      expect(res.ok).toBe(true)
      expect(JSON.parse(res.stdout).minTrustRequired).toBe(tier)
    }
  })
})

describe("output protection: JSON-only, never inside the repo", () => {
  it("refuses repo sources/config and any path inside the repo (aliases via realpath, case-insensitive)", async () => {
    const mod = (await import("../../scripts/build-qc-proposals.mjs")) as Record<string, (...a: never[]) => unknown>
    const guard = mod.checkOutputPath as (
      out: string,
      opts: { rootDir: string; inputPath: string; dbPath: string; defaultDb: string; scriptPath: string },
    ) => string | null
    expect(typeof guard).toBe("function")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-guard-"))
    const input = path.join(dir, "captured.json")
    const db = path.join(dir, "db.json")
    const root = process.cwd()
    const opts = { rootDir: root, inputPath: input, dbPath: db, defaultDb: path.join(root, "src", "data", "av-specs.json"), scriptPath: SCRIPT }
    // Inside-repo nonexistent file (parents may not exist yet).
    expect(guard(path.join(root, "qc-should-not-exist-91827.json"), opts)).not.toBeNull()
    expect(guard(path.join(root, "nested-nope-91827", "sub", "out.json"), opts)).not.toBeNull()
    // Repo source/config files.
    expect(guard(path.join(root, "src", "lib", "av-specs.ts"), opts)).not.toBeNull()
    expect(guard(path.join(root, "package.json"), opts)).not.toBeNull()
    // Non-JSON report path.
    expect(guard(path.join(dir, "proposal.txt"), opts)).not.toBeNull()
    // Case-insensitive alias of the repo root still counts as inside.
    expect(guard(path.join(root.toUpperCase(), "qc-alias-91827.json"), opts)).not.toBeNull()
    // External JSON report path is allowed.
    expect(guard(path.join(dir, "proposal.json"), opts)).toBeNull()
    // Input/DB aliases refused.
    expect(guard(input, { ...opts, inputPath: input })).not.toBeNull()
    expect(guard(db, { ...opts, dbPath: db })).not.toBeNull()
  })

  it("CLI refuses --output inside the repo with nothing written", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-prop-"))
    const input = path.join(dir, "captured.json")
    const db = path.join(dir, "db.json")
    fs.writeFileSync(input, JSON.stringify([movieBody({ id: "tt9999999" })]))
    fs.writeFileSync(db, JSON.stringify(LOCAL_DB))
    const inside = path.join(process.cwd(), "qc-should-not-exist-91827.json")
    const res = runCli(["--input", input, "--db", db, "--now", NOW_ISO, "--output", inside], process.cwd())
    expect(res.ok).toBe(false)
    expect(fs.existsSync(inside)).toBe(false)
  })
})
