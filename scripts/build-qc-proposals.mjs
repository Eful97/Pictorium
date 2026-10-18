#!/usr/bin/env node
// Offline QualiCache AV enrichment PROPOSAL generator.
//
// Reads operator-captured QualiCache JSON observations from --input and emits a
// JSON review proposal (stdout or --output). It NEVER fetches, crawls,
// schedules, imports, or modifies the local av-specs database: the database is
// opened read-only and only used to echo original local values next to
// additive candidate deltas.
//
// Offline-only by construction: this module imports only node:fs, node:path
// and node:url. There is no network request on any invocation, including
// --help. See docs/qualicache-import.md for the authorized-observation
// workflow, the permission status, and the input envelope format.
//
// Usage:
//   node scripts/build-qc-proposals.mjs --input <captured.json> [--output <external-proposal.json>]
//     [--db <av-specs.json>] [--max-age-days 90] [--now <iso>] [--min-trust high|medium|low]
//   node scripts/build-qc-proposals.mjs --help

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const TOOL = "build-qc-proposals"
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_AGE_DAYS = 90
const DEFAULT_MIN_TRUST = "high"

// Local schema vocabulary (src/lib/av-specs.ts). QualiCache has no IMAX
// token, so this mapper can never emit "imax": unknown tokens are ignored
// and reported, never invented.
const QUALITY_ORDER = { SD: 0, HD: 1, FHD: 2, "4K": 3 }
const FORMAT_ORDER = ["dv", "hdr", "hdr10plus", "atmos"]
const SOURCE_ONLY_TOKENS = new Set(["REMUX", "BLURAY", "WEBDL", "WEBRIP", "HDTV"])
const MIN_TRUST_ENUM = new Set(["high", "medium", "low"])

// Pure: explicit quality-token mapping only. Anything else -> null (ignored).
export function mapQualityToken(token) {
  if (typeof token !== "string") return null
  const t = token.trim().toUpperCase()
  if (t === "4K") return "4K"
  if (t === "1080P") return "FHD"
  if (t === "720P") return "HD"
  if (t === "SD") return "SD"
  return null
}

// Pure: explicit A/V format mapping only. Never returns "imax"
// (no IMAX token exists in the QualiCache vocabulary).
export function mapFormatToken(token) {
  if (typeof token !== "string") return null
  const t = token.trim().toUpperCase()
  if (t === "DV") return "dv"
  if (t === "HDR" || t === "HDR10") return "hdr"
  if (t === "HDR10+" || t === "HDR10PLUS") return "hdr10plus"
  if (t === "ATMOS") return "atmos"
  return null
}

// Pure: epoch seconds (QualiCache floats), epoch millis, or ISO string -> ms.
// Returns null when unparseable. Epochs >= 1e12 are treated as millis.
export function toMs(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    return value >= 1e12 ? value : value * 1000
  }
  if (typeof value === "string" && value.trim() !== "") {
    const t = Date.parse(value.trim())
    return Number.isFinite(t) ? t : null
  }
  return null
}

export function toIso(ms) {
  if (!Number.isFinite(ms)) return null
  try {
    return new Date(ms).toISOString()
  } catch {
    return null
  }
}

// Pure: type summary without content (never echoes arbitrary objects/secrets).
export function describeValue(value) {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (Array.isArray(value)) return `array(len=${value.length})`
  const t = typeof value
  if (t === "string") return `string(len=${value.length})`
  if (t === "number") return Number.isInteger(value) ? "integer" : "number"
  if (t === "boolean" || t === "bigint") return t
  if (t === "object") {
    try {
      return `object(keys=${Object.keys(value).length})`
    } catch {
      return "object"
    }
  }
  return t
}

// Pure: short strings may be echoed (ids, enums); anything else is a type
// summary so headers/key material/objects never reach reasons.
function summarizeField(value) {
  if (typeof value === "string") return JSON.stringify(value.length > 120 ? value.slice(0, 120) : value)
  return describeValue(value)
}

// Pure: canonical endpoint path without query/userinfo/fragment.
// Full URLs are normalized to their pathname; plain paths are stripped of
// any ?query/#fragment. Returns null when not usable.
export function canonicalEndpointPath(endpoint) {
  if (typeof endpoint !== "string") return null
  const trimmed = endpoint.trim()
  if (!trimmed) return null
  if (trimmed.includes("://")) {
    try {
      return new URL(trimmed).pathname || null
    } catch {
      return null
    }
  }
  let p = trimmed
  const q = p.indexOf("?")
  if (q !== -1) p = p.slice(0, q)
  const h = p.indexOf("#")
  if (h !== -1) p = p.slice(0, h)
  if (!p || p.includes("@")) return null
  return p
}

// Pure: parse a canonical endpoint /v1/quality/{movie|series}/{ttid}.
// Absent (undefined/null) -> null (no constraint). Anything else must match
// exactly; returns { malformed: true, canonical } or { id, mediaType,
// canonical }.
export function parseEndpoint(endpoint) {
  if (endpoint === undefined || endpoint === null) return null
  const canonical = canonicalEndpointPath(endpoint)
  if (!canonical) return { malformed: true, canonical: null }
  const m = /^\/v1\/quality\/(movie|series)\/(tt\d{7,})\/?$/.exec(canonical)
  if (!m) return { malformed: true, canonical }
  return { id: m[2], mediaType: m[1], canonical }
}

// Pure: pick allowlisted provenance fields only; secrets never flow through.
// Only typed scalars and validated string tokens are forwarded: nested
// objects, headers, key material, URL queries/userinfo/fragments, and raw
// last_error text are dropped or summarized, never echoed.
export function sanitizeProvenance(body, request) {
  const provenance = {}
  if (body && typeof body === "object" && !Array.isArray(body)) {
    if (typeof body.id === "string") provenance.id = body.id
    if (typeof body.type === "string") provenance.type = body.type
    for (const key of ["season", "episode", "checked_streams", "trusted_streams", "matched_streams"]) {
      if (Number.isInteger(body[key]) && body[key] >= 0) provenance[key] = body[key]
    }
    for (const key of ["status", "quality", "trust_rule", "trust_tier", "min_trust", "cache_policy"]) {
      if (typeof body[key] === "string") provenance[key] = body[key]
    }
    if (typeof body.stale === "boolean") provenance.stale = body.stale
    if (typeof body.updated_at === "number" && Number.isFinite(body.updated_at)) provenance.updated_at = body.updated_at
    else if (typeof body.updated_at === "string" && body.updated_at.trim() !== "") provenance.updated_at = body.updated_at
    if (typeof body.next_refresh_at === "number" && Number.isFinite(body.next_refresh_at)) {
      provenance.next_refresh_at = body.next_refresh_at
    } else if (typeof body.next_refresh_at === "string" && body.next_refresh_at.trim() !== "") {
      provenance.next_refresh_at = body.next_refresh_at
    }
    if (Array.isArray(body.tokens)) provenance.tokens = body.tokens.filter((t) => typeof t === "string")
    // last_error free text may carry upstream credentials: presence only.
    if (body.last_error === null || body.last_error === undefined) {
      if (body.last_error === null) provenance.last_error = null
    } else {
      provenance.last_error = true
    }
  }
  if (request && typeof request === "object" && !Array.isArray(request)) {
    const req = {}
    const canonical = request.endpoint !== undefined ? canonicalEndpointPath(request.endpoint) : null
    if (canonical) req.endpoint = canonical
    if (typeof request.type === "string") req.type = request.type
    if (Number.isInteger(request.season) && request.season >= 0) req.season = request.season
    if (Number.isInteger(request.episode) && request.episode >= 0) req.episode = request.episode
    if (typeof request.min_trust_request === "string") req.min_trust_request = request.min_trust_request
    if (Object.keys(req).length > 0) provenance.request = req
  }
  return provenance
}

function isValidImdbId(id) {
  return typeof id === "string" && /^tt\d{7,}$/.test(id)
}

function normType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : null
}

// Pure: split raw tokens into mapped quality/formats plus ignored buckets.
function splitTokens(tokens) {
  const qualities = []
  const formats = []
  const ignoredSource = []
  const ignoredUnknown = []
  const malformed = []
  for (const raw of tokens) {
    if (typeof raw !== "string" || raw.trim() === "") {
      malformed.push(describeValue(raw))
      continue
    }
    const q = mapQualityToken(raw)
    if (q) {
      if (!qualities.includes(q)) qualities.push(q)
      continue
    }
    const f = mapFormatToken(raw)
    if (f) {
      if (!formats.includes(f)) formats.push(f)
      continue
    }
    const upper = raw.trim().toUpperCase()
    if (SOURCE_ONLY_TOKENS.has(upper)) ignoredSource.push(raw)
    else ignoredUnknown.push(raw)
  }
  // Highest explicit quality tier wins when several are present.
  qualities.sort((a, b) => QUALITY_ORDER[a] - QUALITY_ORDER[b])
  formats.sort((a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b))
  return {
    quality: qualities.length > 0 ? qualities[qualities.length - 1] : null,
    qualityConflict: qualities.length > 1,
    formats,
    ignoredSource,
    ignoredUnknown,
    malformedTokens: malformed,
  }
}

// Pure: validate one observation and build either a proposal or a rejection.
// Never throws for per-observation issues; structural input errors are fatal
// in main() before this runs, so no partial report is ever emitted.
export function evaluateObservation(item, index, ctx) {
  const { localDb, nowMs, minTrustRequired, maxAgeDays } = ctx
  const reject = (imdb, reasons, extra = {}) => ({
    ok: false,
    entry: { index, imdb, decision: "rejected", reasons, ...extra },
  })

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return reject(null, ["malformed-observation: entry is not an object"])
  }
  const rawBody = item.body !== undefined ? item.body : item
  const request = item.request !== undefined ? item.request : null
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return reject(null, ["malformed-observation: body is not an object"])
  }
  const body = { ...rawBody }
  if (rawBody === item && body.request !== undefined) delete body.request
  const reqObj = request && typeof request === "object" && !Array.isArray(request) ? request : null

  const id = body.id
  if (!isValidImdbId(id)) {
    return reject(typeof id === "string" ? id : null, [
      `invalid-identity: id ${describeValue(id)} is not a valid IMDb id (expected tt + 7 or more digits)`,
    ])
  }

  // Canonical endpoint identity: a provided endpoint must parse as
  // /v1/quality/{movie|series}/{ttid} (full URLs normalize to pathname,
  // query/userinfo/fragment stripped) and must agree with body/request.
  const endpointProvided = reqObj !== null && reqObj.endpoint !== undefined && reqObj.endpoint !== null
  let endpointInfo = null
  if (endpointProvided) {
    endpointInfo = parseEndpoint(reqObj.endpoint)
    if (!endpointInfo || endpointInfo.malformed) {
      return reject(id, [
        `invalid-endpoint: endpoint ${describeValue(reqObj.endpoint)} is not a canonical /v1/quality/{movie|series}/{ttid} path`,
      ])
    }
    if (endpointInfo.id !== id) {
      return reject(id, [`identity-mismatch: endpoint id ${endpointInfo.id} differs from body id ${id}`])
    }
  }

  const bodyType = normType(body.type)
  const requestType = reqObj ? normType(reqObj.type) : null
  if (bodyType !== null && bodyType !== "movie" && bodyType !== "series") {
    return reject(id, [`unknown-type: body type ${describeValue(body.type)} is not movie/series`])
  }
  if (requestType !== null && requestType !== "movie" && requestType !== "series") {
    return reject(id, [`unknown-type: request type ${describeValue(reqObj.type)} is not movie/series`])
  }
  if (bodyType && requestType && bodyType !== requestType) {
    return reject(id, [`type-mismatch: body type ${bodyType} differs from request type ${requestType}`])
  }
  if (endpointInfo) {
    if (bodyType && bodyType !== endpointInfo.mediaType) {
      return reject(id, [`type-mismatch: endpoint type ${endpointInfo.mediaType} differs from body type ${bodyType}`])
    }
    if (requestType && requestType !== endpointInfo.mediaType) {
      return reject(id, [
        `type-mismatch: endpoint type ${endpointInfo.mediaType} differs from request type ${requestType}`,
      ])
    }
  }
  const mediaType = bodyType ?? requestType ?? endpointInfo?.mediaType ?? null
  if (!mediaType) {
    return reject(id, ["unknown-type: neither body, request, nor endpoint declares movie/series"])
  }

  let season = null
  let episode = null
  if (mediaType === "series") {
    // When both sides supply season/episode they must agree; body never
    // silently wins over a disagreeing request.
    const bodySeasonSupplied = body.season !== undefined
    const reqSeasonSupplied = reqObj !== null && reqObj.season !== undefined
    const bodyEpisodeSupplied = body.episode !== undefined
    const reqEpisodeSupplied = reqObj !== null && reqObj.episode !== undefined
    if (bodySeasonSupplied && reqSeasonSupplied && body.season !== reqObj.season) {
      return reject(id, [
        `season-mismatch: body and request season disagree (${summarizeField(body.season)} vs ${summarizeField(reqObj.season)})`,
      ])
    }
    if (bodyEpisodeSupplied && reqEpisodeSupplied && body.episode !== reqObj.episode) {
      return reject(id, [
        `episode-mismatch: body and request episode disagree (${summarizeField(body.episode)} vs ${summarizeField(reqObj.episode)})`,
      ])
    }
    const rawSeason = bodySeasonSupplied ? body.season : reqObj?.season
    const rawEpisode = bodyEpisodeSupplied ? body.episode : reqObj?.episode
    if (!Number.isInteger(rawSeason) || rawSeason < 1) {
      return reject(id, [`invalid-identity: series season ${describeValue(rawSeason)} must be a positive integer`])
    }
    if (!Number.isInteger(rawEpisode) || rawEpisode < 1) {
      return reject(id, [`invalid-identity: series episode ${describeValue(rawEpisode)} must be a positive integer`])
    }
    season = rawSeason
    episode = rawEpisode
  }

  const status = normType(body.status)
  if (status !== "ready") {
    const label =
      status === "pending"
        ? "status-pending: no data yet; serve without badges (not an error)"
        : status === "error"
          ? "status-error: treated as pending; serve without badges (not an error)"
          : status === "empty"
            ? "status-empty: no release matched"
            : `status-unknown: ${describeValue(body.status)} is not ready`
    return reject(id, [label], {
      observedSummary: {
        type: mediaType,
        status: typeof body.status === "string" ? body.status : describeValue(body.status),
      },
    })
  }

  if (typeof body.stale !== "boolean") {
    return reject(id, [`stale-unknown: stale ${describeValue(body.stale)} is not a boolean; only explicit false is accepted`])
  }
  if (body.stale !== false) {
    return reject(id, ["stale-true: cached record is marked stale"])
  }

  // When both body and request supply min_trust they must agree; the request
  // value never silently wins and is never evidence of the observed tier.
  const bodyTrustSupplied = body.min_trust !== undefined && body.min_trust !== null
  const reqTrustSupplied = reqObj !== null && reqObj.min_trust_request !== undefined && reqObj.min_trust_request !== null
  if (bodyTrustSupplied && reqTrustSupplied) {
    const bNorm = typeof body.min_trust === "string" ? body.min_trust.trim().toLowerCase() : null
    const rNorm = typeof reqObj.min_trust_request === "string" ? reqObj.min_trust_request.trim().toLowerCase() : null
    if (bNorm === null || rNorm === null || bNorm !== rNorm) {
      return reject(id, [
        `trust-request-mismatch: body and request min_trust disagree (${describeValue(body.min_trust)} vs ${describeValue(reqObj.min_trust_request)})`,
      ])
    }
  }
  const observedTier = normType(body.trust_tier)
  const requestTrustRaw = reqObj?.min_trust_request ?? body.min_trust
  const requestTrust = normType(requestTrustRaw)
  if (observedTier !== "trusted") {
    return reject(id, [
      `trust-tier-not-trusted: observed trust_tier ${describeValue(body.trust_tier)} is not trusted; ` +
        `request min_trust=${summarizeField(requestTrustRaw)} is the request setting, never evidence of the observed tier`,
    ])
  }
  if (requestTrust !== String(minTrustRequired).toLowerCase()) {
    return reject(id, [
      `trust-request-below-threshold: request min_trust ${summarizeField(requestTrustRaw)} ` +
        `does not equal required ${summarizeField(minTrustRequired)}`,
    ])
  }

  const updatedMs = toMs(body.updated_at)
  if (updatedMs === null) {
    return reject(id, [`invalid-updated-at: ${describeValue(body.updated_at)} is not a valid epoch/ISO timestamp`])
  }
  if (updatedMs > nowMs) {
    return reject(id, [`future-updated-at: ${toIso(updatedMs)} is after now ${toIso(nowMs)}`])
  }
  const ageDays = (nowMs - updatedMs) / DAY_MS
  if (ageDays > maxAgeDays) {
    return reject(id, [
      `too-old: observation age ${ageDays.toFixed(1)}d exceeds the diagnostic threshold of ${maxAgeDays}d`,
    ])
  }

  if (!Array.isArray(body.tokens)) {
    return reject(id, ["malformed-tokens-field: tokens is not an array"])
  }
  if (body.tokens.length === 0) {
    return reject(id, ["empty-tokens: no release tokens to map"])
  }
  const split = splitTokens(body.tokens)
  if (!split.quality && split.formats.length === 0) {
    return reject(id, [
      `no-mappable-tokens: ${body.tokens.length} token(s) with no mapping ` +
        `(source-only ${split.ignoredSource.length}, unknown ${split.ignoredUnknown.length}, malformed ${split.malformedTokens.length})`,
    ])
  }

  const nextRefreshMs = toMs(body.next_refresh_at)
  const requestTrustForOutput = typeof requestTrustRaw === "string" ? requestTrustRaw : null
  const shared = {
    imdb: id,
    mediaType,
    observed: { quality: split.quality, formats: split.formats },
    ignoredTokens: { sourceOnly: split.ignoredSource, unknown: split.ignoredUnknown, malformed: split.malformedTokens },
    qualityTokenConflict: split.qualityConflict,
    provenance: sanitizeProvenance(body, reqObj),
    trust: {
      observedTier,
      observedRule: typeof body.trust_rule === "string" ? body.trust_rule : null,
      requestMinTrust: requestTrustForOutput,
      requiredMinTrust: minTrustRequired,
    },
    freshness: {
      checkedAt: toIso(nowMs),
      updatedAt: toIso(updatedMs),
      ageDays: Math.round(ageDays * 10) / 10,
      maxAgeDays,
      eligible: true,
      note: "diagnostic proposal threshold only; a future next_refresh_at never grants validity",
      nextRefreshAt: nextRefreshMs === null ? null : toIso(nextRefreshMs),
    },
  }

  const localRaw = localDb && typeof localDb === "object" ? localDb[id] : null
  const local =
    localRaw && typeof localRaw === "object"
      ? { quality: localRaw.quality ?? null, formats: Array.isArray(localRaw.formats) ? [...localRaw.formats] : [] }
      : null

  // Series records are review-only episode observations, never title upserts.
  if (mediaType === "series") {
    return {
      ok: true,
      entry: {
        ...shared,
        kind: "series-episode-observation",
        season,
        episode,
        local,
        decision: "review-episode-only",
        reviewReasons: [
          "episode-scoped observation: a single trusted release for S" +
            `${season}E${episode}; never a title-level upsert, even when the local id is missing`,
          "single-release tokens are not title-level proof; needs corroboration before any curated change",
          "QualiCache has no IMAX token: local imax entries are untouched and unrelated",
        ],
      },
    }
  }

  // Movie with no local entry: addition proposal, not a verified claim.
  if (!local) {
    return {
      ok: true,
      entry: {
        ...shared,
        kind: "movie-addition",
        local: null,
        candidate: { quality: split.quality, formats: split.formats },
        decision: "needs-review",
        reviewReasons: [
          "movie addition is a proposal needing review/corroboration, not a verified file-quality claim",
          "single-release tokens are not title-level proof; corroborate before curating",
        ],
      },
    }
  }

  // Movie with a local entry: additive delta only; never remove, never downgrade.
  const reasons = []
  const addFormats = split.formats.filter((f) => !local.formats.includes(f))
  const missingInRelease = local.formats.filter((f) => !split.formats.includes(f))
  if (missingInRelease.length > 0) {
    reasons.push(
      `edition-specific omission: release lacks local ${JSON.stringify(missingInRelease)}; ` +
        "a single release omitting a format is not proof the curated entry is wrong; local formats preserved",
    )
  }
  let candidateQuality = null
  if (split.quality && local.quality && QUALITY_ORDER[split.quality] !== undefined && QUALITY_ORDER[local.quality] !== undefined) {
    if (QUALITY_ORDER[split.quality] < QUALITY_ORDER[local.quality]) {
      reasons.push(
        `quality-downgrade-blocked: observed ${split.quality} is a lower tier than curated ${local.quality}; local quality preserved`,
      )
    } else if (QUALITY_ORDER[split.quality] > QUALITY_ORDER[local.quality]) {
      candidateQuality = split.quality
      reasons.push(
        `quality-upgrade-candidate: observed ${split.quality} is a higher tier than curated ${local.quality}; ` +
          "needs review/corroboration (single release is not title-level proof)",
      )
    }
  } else if (split.quality && !local.quality) {
    candidateQuality = split.quality
    reasons.push("quality-candidate: curated entry has no quality tier; observed tier needs review/corroboration")
  }
  if (addFormats.length > 0) {
    reasons.push(
      `additive formats ${JSON.stringify(addFormats)} need review/corroboration; ` +
        "single-release tokens are not title-level proof",
    )
  }
  if (reasons.length === 0 || (addFormats.length === 0 && candidateQuality === null)) {
    if (missingInRelease.length === 0 && reasons.length === 0) {
      reasons.push("parity: observed tokens are fully covered by the curated entry; no change proposed")
    }
  }
  const actionable = addFormats.length > 0 || candidateQuality !== null
  return {
    ok: true,
    entry: {
      ...shared,
      kind: "movie-additive",
      local,
      candidateDelta: { addQuality: candidateQuality, addFormats },
      missingInRelease,
      decision: actionable ? "needs-review" : "no-change",
      reviewReasons: reasons,
    },
  }
}

// Pure: build the full proposal from validated observations. Clock injectable
// via nowMs for deterministic tests. Never writes anything.
export function buildProposals({ observations, localDb, nowMs, minTrustRequired, maxAgeDays }) {
  const proposals = []
  const rejected = []
  const byReason = {}
  observations.forEach((item, index) => {
    const result = evaluateObservation(item, index, { localDb, nowMs, minTrustRequired, maxAgeDays })
    if (result.ok) proposals.push(result.entry)
    else {
      rejected.push(result.entry)
      for (const reason of result.entry.reasons) {
        const key = reason.split(":")[0]
        byReason[key] = (byReason[key] ?? 0) + 1
      }
    }
  })
  return {
    tool: TOOL,
    mode: "offline",
    network: "none (offline-only; this tool performs no network requests)",
    generatedAt: toIso(nowMs),
    minTrustRequired,
    maxAgeDays,
    localDb: { entries: localDb && typeof localDb === "object" ? Object.keys(localDb).length : 0 },
    source: "operator-captured QualiCache observations (authorized use only; see docs/qualicache-import.md)",
    proposals,
    rejected,
    stats: {
      input: observations.length,
      accepted: proposals.length,
      rejected: rejected.length,
      byReason,
    },
  }
}

function printHelp() {
  console.log(`Offline QualiCache AV enrichment proposal generator (${TOOL}).

Reads operator-captured QualiCache JSON observations and emits a JSON review
proposal. OFFLINE-ONLY: performs no network requests on any invocation.
Never imports, auto-applies, or modifies the database; the DB is read-only.

Usage:
  node scripts/build-qc-proposals.mjs --input <captured.json> [--output <proposal.json>]
    [--db <av-specs.json>] [--max-age-days 90] [--now <iso>] [--min-trust high|medium|low]

Input: JSON array, or {"observations": [...]}. Each item is either a raw
QualiCache response body or {"body": {...}, "request": {...}} with request
metadata (endpoint/type/season/episode/min_trust_request).
See docs/qualicache-import.md for the envelope, mapping rules, and permission
status. --help performs no reads besides this text and no network.
--output must be a JSON report path OUTSIDE the repository (or omit for
stdout); repo sources/config and any path inside the repo are refused.`)
}

// Pure-ish (throws on malformed CLI): strict option parsing with no silent
// drops. Unknown flags, duplicate flags, missing values, and stray
// positionals are all fatal before any file is read or written.
export function parseCliOptions(args) {
  const knownValueFlags = new Set(["--input", "--output", "--db", "--max-age-days", "--now", "--min-trust"])
  const seen = new Map()
  const values = {}
  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg === "--help" || arg === "-h") {
      seen.set(arg, (seen.get(arg) ?? 0) + 1)
      if (seen.get(arg) > 1) throw new Error(`duplicate flag ${arg}`)
      values.help = true
      i += 1
      continue
    }
    if (arg.startsWith("-")) {
      if (!knownValueFlags.has(arg)) throw new Error(`unknown flag ${arg} (see --help)`)
      if (seen.has(arg)) throw new Error(`duplicate flag ${arg}`)
      const next = args[i + 1]
      if (next === undefined || (typeof next === "string" && next.startsWith("--"))) {
        throw new Error(`missing value for ${arg}`)
      }
      seen.set(arg, 1)
      values[arg] = next
      i += 2
      continue
    }
    throw new Error(`unexpected positional argument ${JSON.stringify(arg)} (see --help)`)
  }
  return values
}

function safeReal(p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

// Resolve a possibly not-yet-existing path via its nearest existing ancestor
// (realpath), so symlink/case aliases cannot smuggle writes into the repo.
export function resolveOutputReal(outputPath) {
  const abs = path.resolve(outputPath)
  let dir = abs
  const tail = []
  while (!fs.existsSync(dir)) {
    tail.unshift(path.basename(dir))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  let base
  try {
    base = fs.realpathSync(dir)
  } catch {
    base = path.resolve(dir)
  }
  return tail.length > 0 ? path.join(base, ...tail) : base
}

// Pure-ish guard (injectable rootDir for tests): JSON-only report path,
// never inside the repo, never over input/DB/script. Returns null when
// allowed, otherwise a short reason code (no filesystem writes).
export function checkOutputPath(outputPath, opts) {
  const { rootDir, inputPath, dbPath, defaultDb, scriptPath } = opts ?? {}
  if (typeof outputPath !== "string" || outputPath.trim() === "") return "missing-output"
  if (!/\.json$/i.test(outputPath.trim())) return "not-json-report-path"
  const outReal = resolveOutputReal(outputPath)
  const rootReal = safeReal(rootDir ?? process.cwd())
  const norm = (p) => String(p).toLowerCase()
  const outLower = norm(outReal)
  const rootLower = norm(rootReal)
  if (outLower === rootLower || outLower.startsWith(rootLower + norm(path.sep))) return "inside-repository"
  for (const p of [inputPath, dbPath, defaultDb, scriptPath]) {
    if (!p) continue
    let protectedReal
    try {
      protectedReal = safeReal(p)
    } catch {
      continue
    }
    if (outLower === norm(protectedReal)) return "protected-file"
  }
  return null
}

function main() {
  const args = process.argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    // Bare --help/-h still prints, but malformed combos around it are fatal.
    try {
      const parsed = parseCliOptions(args)
      void parsed
    } catch (err) {
      console.error(`[${TOOL}] ${err?.message ?? err}`)
      process.exit(2)
    }
    printHelp()
    return
  }
  let cliOpts
  try {
    cliOpts = parseCliOptions(args)
  } catch (err) {
    console.error(`[${TOOL}] ${err?.message ?? err}`)
    process.exit(2)
  }
  const inputPath = cliOpts["--input"] ?? null
  if (!inputPath) {
    console.error(`[${TOOL}] missing required --input <captured.json> (see --help, docs/qualicache-import.md)`)
    process.exit(2)
  }
  const outputPath = cliOpts["--output"] ?? null
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const defaultDb = path.join(rootDir, "src", "data", "av-specs.json")
  const dbPath = cliOpts["--db"] ?? defaultDb
  const maxAgeRaw = cliOpts["--max-age-days"] ?? null
  const maxAgeDays = maxAgeRaw !== null ? Number(maxAgeRaw) : DEFAULT_MAX_AGE_DAYS
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
    console.error(`[${TOOL}] invalid --max-age-days (expected a positive number of days)`)
    process.exit(2)
  }
  const minTrustRaw = cliOpts["--min-trust"] ?? DEFAULT_MIN_TRUST
  const minTrustRequired = typeof minTrustRaw === "string" ? minTrustRaw.trim().toLowerCase() : ""
  if (!MIN_TRUST_ENUM.has(minTrustRequired)) {
    console.error(`[${TOOL}] invalid --min-trust (expected one of high|medium|low, default "high")`)
    process.exit(2)
  }
  const nowOpt = cliOpts["--now"] ?? null
  const nowMs = nowOpt !== null ? Date.parse(nowOpt) : Date.now()
  if (!Number.isFinite(nowMs)) {
    console.error(`[${TOOL}] invalid --now (expected ISO date-time)`)
    process.exit(2)
  }

  // Output protection first: JSON-only report path outside the repository;
  // never the input, the database, repo sources/config, or anything inside
  // the repo (aliases/symlinks/case variants via realpath of the nearest
  // existing parent, compared case-insensitively for Windows).
  if (outputPath) {
    const reason = checkOutputPath(outputPath, {
      rootDir,
      inputPath,
      dbPath,
      defaultDb,
      scriptPath: process.argv[1],
    })
    if (reason === "not-json-report-path") {
      console.error(`[${TOOL}] refusing non-JSON output ${outputPath} (JSON report path only)`)
      process.exit(2)
    }
    if (reason === "inside-repository") {
      console.error(`[${TOOL}] refusing to write inside the repository ${outputPath} (use an external report path or stdout)`)
      process.exit(2)
    }
    if (reason !== null) {
      console.error(`[${TOOL}] refusing to overwrite protected file ${outputPath}`)
      process.exit(2)
    }
  }

  // Full validation before any output: structural errors exit non-zero with
  // nothing written, so no partial or misleading report is ever emitted.
  let raw
  try {
    raw = fs.readFileSync(inputPath, "utf-8")
  } catch {
    console.error(`[${TOOL}] cannot read input ${inputPath}`)
    process.exit(2)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error(`[${TOOL}] input is not valid JSON`)
    process.exit(2)
  }
  const observations = Array.isArray(parsed) ? parsed : parsed?.observations
  if (!Array.isArray(observations) || observations.length === 0) {
    console.error(`[${TOOL}] input must be a non-empty JSON array or {"observations": [...]} with at least one entry`)
    process.exit(2)
  }

  let dbRaw
  try {
    dbRaw = fs.readFileSync(dbPath, "utf-8")
  } catch {
    console.error(`[${TOOL}] cannot read database ${dbPath} (read-only lookup)`)
    process.exit(2)
  }
  let localDb
  try {
    localDb = JSON.parse(dbRaw)
  } catch {
    console.error(`[${TOOL}] database is not valid JSON`)
    process.exit(2)
  }
  if (!localDb || typeof localDb !== "object" || Array.isArray(localDb)) {
    console.error(`[${TOOL}] database must be a JSON object of id -> {quality, formats}`)
    process.exit(2)
  }

  const result = buildProposals({
    observations,
    localDb,
    nowMs,
    minTrustRequired,
    maxAgeDays,
  })
  const text = JSON.stringify(result, null, 2) + "\n"
  if (!outputPath) {
    process.stdout.write(text)
    return
  }
  const tmpPath = `${outputPath}.tmp-${process.pid}`
  try {
    fs.writeFileSync(tmpPath, text, "utf-8")
    fs.renameSync(tmpPath, outputPath)
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true })
    } catch {
      // ignore cleanup failure
    }
    console.error(`[${TOOL}] failed to write output: ${err?.message ?? err}`)
    process.exit(2)
  }
  console.error(
    `[${TOOL}] wrote ${result.proposals.length} proposal(s), ${result.rejected.length} rejected of ${result.stats.input} observation(s) -> ${outputPath}`,
  )
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
