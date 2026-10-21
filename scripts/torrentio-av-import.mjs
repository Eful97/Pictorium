#!/usr/bin/env node
// Torrentio movie-only AV enrichment for the local curated database.
//
// Scope (authorized task): existing src/data/av-specs.json IMDb IDs ONLY.
// Series/ambiguous/unknown/failed IDs are left unchanged. Series are never
// promoted, no new titles are imported, and curated values are never
// downgraded or replaced: only absent allowlisted formats (dv/hdr/hdr10plus/
// atmos) are added, quality is only filled when absent, and imax is never
// added from declared streams (stays curated).
//
// Safety contract (BLOCKED: proposal-only, no database writes possible):
// - Default invocation is a dry-run: args are validated, the plan is
//   printed, and NO network request and NO write happens.
// - --live performs serial requests (>=1000ms spacing, no retries) with an
//   authoritative TMDB /find movie/series gate BEFORE any /stream request.
// - --apply disabled pending curated-data reconciliation: parseArgs
//   rejects it BEFORE any config read, network request, or write, with
//   "apply disabled pending curated-data reconciliation". The merge/apply
//   code below is therefore unreachable via the CLI until the curatorial
//   policy decision re-enables it; it is kept (not removed) so the
//   proposal/merge helpers stay reviewable, with no alternate writer/unlock.
// - --apply-reviewed-union is the second offline writer: fixed 832-id
//   reviewed-union manifest (822 generic-hdr deltas + the 10 previously
//   excluded curated conflicts, user-authorized title-edition union), pinned
//   to the same immutable snapshot and to the post-105 DB baseline SHA. Same
//   offline/fail-closed/rollback/idempotence contract as --apply-reviewed.
//   Mutually exclusive with --apply-reviewed; rejects --live/--only/--limit.
// - --apply-reviewed is the phase-1 offline writer: fixed 105-id reviewed
//   manifest (104 hdr10plus + 1 atmos, excl 10 curated conflicts), pinned
//   snapshot SHA + byte size and pinned DB baseline SHA + key count. It runs
//   BEFORE any config read or network request, performs zero network I/O,
//   revalidates every record (fail-closed), and rolls back the DB write when
//   provenance persistence fails. Repeat runs are verified no-ops.
// - 429/403/401/Retry-After/challenge responses STOP the run immediately
//   (checkpoint saved, non-zero exit, resume via the same checkpoint).
// - No raw responses, playback links, infohashes, magnets, filenames,
//   keys, tokens or debrid URLs are saved, logged or embedded in errors.
// - The TMDB key is read from established local config (process env or
//   .env.local key NAMES PICTORIUM_TMDB_KEY > POSTERIUM_TMDB_KEY >
//   TMDB_KEY > TMDB_API_KEY); its value never reaches logs or reports.
//   Note: this config read happens only AFTER arg validation, so a
//   rejected --apply never touches config, network, or disk writes.
// - Strict own token parser (no ERDB code): one deterministic same-release
//   candidate record per title, never a tuple combined across releases.
// - Permission note: the public manifest answers HTTP 200 and carries no
//   batch-use clause in its description; the operator explicitly authorized
//   this movie-only use. That is a technical observation, not a legal
//   assurance. If terms explicitly prohibiting batch use are discovered,
//   stop and report instead of bypassing.
//
// BLOCKED production safeguards (recorded unresolved, NOT fixed in this
// task; no speculative refactor while the workflow is blocked):
// - fetchJson cancels the timeout at headers, before res.json(): the body
//   read itself is unbounded (no max-bytes cap).
// - The checkpoint carries no source/parser/database fingerprint and no
//   schema validation: resume reuses whatever stale decision the file
//   holds (arbitrary hand-edited records are trusted as validated).
// - DB + provenance are two separate atomic renames, not one transaction:
//   a crash between them can leave the pair inconsistent.
// - isMain uses process.argv[1] === fileURLToPath(import.meta.url),
//   whose platform behavior (symlinks, case, separators) is unverified.
// - The generic HDR regex can label tokens whose curated semantics need
//   a curatorial decision (declared-vs-verified ambiguity unresolved).
//
// Scope (authorized task): existing src/data/av-specs.json IMDb IDs ONLY.
// Series/ambiguous/unknown/failed IDs are left unchanged. Series are never
// promoted, no new titles are imported, and curated values are never
// downgraded or replaced: only absent allowlisted formats (dv/hdr/hdr10plus/
// atmos) are added, quality is only filled when absent, and imax is never
// added from declared streams (stays curated).
// "mutated" below always means a PROPOSED additive delta held in the
// checkpoint/provenance plan, never an applied database change: the full
// scan observed 1424 movie / 2 series / 4 unknown of 1430 entries
// (~1421 stream requests; 3 ids already resolved by the pilot checkpoint),
// with 937 proposed deltas, and the production database is unchanged.
//
// Usage (proposal-only while --apply is disabled):
//   node scripts/torrentio-av-import.mjs --help
//   node scripts/torrentio-av-import.mjs [--db <path>] [--limit <n>]
//   node scripts/torrentio-av-import.mjs --live [--only tt1,tt2] [--limit <n>]
//     [--spacing-ms <>=1000>] [--db <path>]
//     [--provenance <path>] [--checkpoint <path>]
//     [--torrentio-base <https-url>]
//   --apply disabled pending curated-data reconciliation (rejected at arg
//   validation before any config read, network request, or write): do NOT
//   pass it; live runs only produce the checkpoint + provenance proposal,
//   never database writes.
//
// Pure helpers are exported for deterministic unit tests (mock HTTP only;
// the test suite never touches the network).

import fs from "node:fs"
import crypto from "node:crypto"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const TOOL = "torrentio-av-import"
export const TORRENTIO_DEFAULT_BASE = "https://torrentio.strem.fun"
export const TMDB_DEFAULT_BASE = "https://api.themoviedb.org/3"
export const MIN_SPACING_MS = 1000
export const DEFAULT_SPACING_MS = 1100
export const FETCH_TIMEOUT_MS = 10000
export const QUALITY_ORDER = { SD: 0, HD: 1, FHD: 2, "4K": 3 }
export const FORMAT_ORDER = ["dv", "hdr", "hdr10plus", "atmos"]
// Merge allowlist: imax is observed by the parser but NEVER merged
// (stays curated-only).
export const ALLOWED_MERGE_FORMATS = ["dv", "hdr", "hdr10plus", "atmos"]
export const KNOWN_FORMAT_TOKENS = ["dv", "hdr", "hdr10plus", "atmos", "imax"]
export const KNOWN_QUALITIES = ["4K", "FHD", "HD", "SD"]
const IMDb_RE = /^tt\d+$/
const STOP_STATUSES = new Set([401, 403, 429])

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const FLAG_DEFS = {
  "--live": { kind: "bool" },
  "--apply": { kind: "bool" },
  "--apply-reviewed": { kind: "bool" },
  "--apply-reviewed-union": { kind: "bool" },
  "--help": { kind: "bool" },
  "-h": { kind: "bool" },
  "--limit": { kind: "value" },
  "--only": { kind: "value" },
  "--spacing-ms": { kind: "value" },
  "--db": { kind: "value" },
  "--provenance": { kind: "value" },
  "--checkpoint": { kind: "value" },
  "--torrentio-base": { kind: "value" },
}

/**
 * @typedef {object} TorrentioImportArgs
 * @property {boolean} live
 * @property {boolean} apply
 * @property {boolean} applyReviewed
 * @property {boolean} applyReviewedUnion
 * @property {boolean} help
 * @property {number | null} limit
 * @property {string[] | null} only
 * @property {number} spacingMs
 * @property {string | null} db
 * @property {string | null} provenance
 * @property {string | null} checkpoint
 * @property {string} torrentioBase
 *
 * Strict CLI validation: unknown flags, duplicate flags, missing values
 * and out-of-range numerics are rejected BEFORE any network or write.
 * @param {string[]} argv
 * @returns {{ ok: true, args: TorrentioImportArgs } | { ok: false, error: string }}
 */
export function parseArgs(argv) {
  const args = {
    live: false,
    apply: false,
    applyReviewed: false,
    applyReviewedUnion: false,
    help: false,
    limit: null,
    only: null,
    spacingMs: DEFAULT_SPACING_MS,
    db: null,
    provenance: null,
    checkpoint: null,
    torrentioBase: TORRENTIO_DEFAULT_BASE,
  }
  const seen = new Set()
  const fail = (error) => ({ ok: false, error })
  let i = 0
  while (i < argv.length) {
    const flag = argv[i]
    const def = FLAG_DEFS[flag]
    if (!def) return fail(`unknown flag ${flag}`)
    if (seen.has(flag)) return fail(`duplicate flag ${flag}`)
    seen.add(flag)
    if (def.kind === "bool") {
      if (flag === "--live") args.live = true
      else if (flag === "--apply") args.apply = true
      else if (flag === "--apply-reviewed") args.applyReviewed = true
      else if (flag === "--apply-reviewed-union") args.applyReviewedUnion = true
      else args.help = true
      i += 1
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith("--")) return fail(`missing value for ${flag}`)
    if (flag === "--limit") {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1) return fail("--limit must be an integer >= 1")
      args.limit = n
    } else if (flag === "--only") {
      const ids = value.split(",").map((s) => s.trim()).filter(Boolean)
      if (ids.length === 0 || !ids.every((id) => IMDb_RE.test(id))) {
        return fail("--only must be a comma-separated list of IMDb ids (tt + digits)")
      }
      args.only = [...new Set(ids)]
    } else if (flag === "--spacing-ms") {
      const n = Number(value)
      if (!Number.isInteger(n) || n < MIN_SPACING_MS) {
        return fail(`--spacing-ms must be an integer >= ${MIN_SPACING_MS}`)
      }
      args.spacingMs = n
    } else if (flag === "--db") {
      args.db = value
    } else if (flag === "--provenance") {
      args.provenance = value
    } else if (flag === "--checkpoint") {
      args.checkpoint = value
    } else if (flag === "--torrentio-base") {
      if (!/^https:\/\/[^/]+$/.test(value)) return fail("--torrentio-base must be an https origin (no path)")
      args.torrentioBase = value.replace(/\/+$/, "")
    }
    i += 2
  }
  if (args.apply) return fail("--apply disabled pending curated-data reconciliation (proposal-only; no database writes)")
  if (args.applyReviewed) {
    if (args.live) return fail("--apply-reviewed is offline: must not be combined with --live (no network in the reviewed path)")
    if (args.only !== null || args.limit !== null) {
      return fail("--apply-reviewed applies the fixed 105-id reviewed manifest; --only/--limit are rejected")
    }
  }
  if (args.applyReviewed && args.applyReviewedUnion) {
    return fail("--apply-reviewed and --apply-reviewed-union are separate fixed phases; pass only one")
  }
  if (args.applyReviewedUnion) {
    if (args.live) return fail("--apply-reviewed-union is offline: must not be combined with --live (no network in the reviewed path)")
    if (args.only !== null || args.limit !== null) {
      return fail("--apply-reviewed-union applies the fixed 832-id reviewed manifest; --only/--limit are rejected")
    }
  }
  return { ok: true, args }
}

// ---------------------------------------------------------------------------
// Strict per-record declared-label parser (own implementation)
// ---------------------------------------------------------------------------

function tokenize(normalized) {
  return normalized.split(/[\s]+/).filter(Boolean)
}

// Numeric resolution per text; digits win over word labels by construction.
function qualityFromText(text) {
  if (!text) return { quality: null, numeric: false }
  const t = text.toLowerCase().replace(/[._\-+]+/g, " ")
  if (t.includes("2160")) return { quality: "4K", numeric: true }
  if (/\b(1080[pi]?|fhd|fullhd)\b/.test(t)) return { quality: "FHD", numeric: true }
  if (/\b(720[pi]?|hd|hdtv)\b/.test(t)) return { quality: "HD", numeric: true }
  if (/\b(480[pi]?|576[pi]?|sd|dvdrip|cam|ts|telesync|hdts|hdcam)\b/.test(t)) {
    return { quality: "SD", numeric: true }
  }
  const tokens = tokenize(t)
  if (tokens.some((tok) => tok === "4k" || tok === "uhd" || tok.startsWith("4k") || tok.startsWith("uhd"))) {
    return { quality: "4K", numeric: false }
  }
  return { quality: null, numeric: false }
}

function formatsFromText(raw) {
  if (!raw) return []
  const rawLow = String(raw).toLowerCase()
  // HDR10+ variants must be detected on the raw text: the "+" is a
  // separator in the normalized form ("hdr10+" -> "hdr10 ").
  const hasHdr10Plus =
    /hdr[\s._\-]*10[\s._\-]*\+/.test(rawLow) || rawLow.includes("hdr10plus")
  const t = rawLow.replace(/[._\-+]+/g, " ")
  const tokens = new Set(tokenize(t))
  const out = []
  if (hasHdr10Plus || tokens.has("hdr10plus")) {
    out.push("hdr10plus")
  } else if (tokens.has("hdr10") || tokens.has("hdr")) {
    out.push("hdr")
  }
  if (tokens.has("dv") || tokens.has("dovi") || tokens.has("dolbyvision") || /\bdolby\s*vision\b/.test(t)) {
    out.push("dv")
  }
  if (tokens.has("atmos")) out.push("atmos")
  if (tokens.has("imax")) out.push("imax")
  return out
}

function recordField(rec, name) {
  if (!isRecord(rec)) return ""
  if (name === "filename") {
    const hints = rec.behaviorHints
    return (isRecord(hints) && typeof hints.filename === "string" && hints.filename) || ""
  }
  if (name === "bingeGroup") {
    const hints = rec.behaviorHints
    return (isRecord(hints) && typeof hints.bingeGroup === "string" && hints.bingeGroup) || ""
  }
  return (typeof rec[name] === "string" && rec[name]) || ""
}

// One stream record describes one release: the filename (actual file) wins
// over looser title/name/bingeGroup labels, and a numeric resolution wins
// over a bare 4K/UHD label. Formats are declared tokens of the same record.
export function parseTorrentioRecord(rec) {
  if (!isRecord(rec)) return { quality: null, formats: [], numeric: false }
  const filename = recordField(rec, "filename")
  const others = [recordField(rec, "title"), recordField(rec, "name"), recordField(rec, "bingeGroup")]
  const fileQ = qualityFromText(filename)
  let quality = null
  let numeric = false
  if (fileQ.quality) {
    quality = fileQ.quality
    numeric = fileQ.numeric
  } else {
    for (const text of others) {
      const q = qualityFromText(text)
      if (q.quality && (quality === null || (q.numeric && !numeric))) {
        quality = q.quality
        numeric = q.numeric
        if (numeric) break
      }
    }
    if (!quality) {
      const joined = others.join(" ")
      const labelQ = qualityFromText(joined)
      if (labelQ.quality && !labelQ.numeric) {
        quality = labelQ.quality
        numeric = false
      }
    }
  }
  const seen = new Set()
  const formats = []
  for (const text of [filename, ...others]) {
    for (const f of formatsFromText(text)) {
      if (!seen.has(f)) {
        seen.add(f)
        formats.push(f)
      }
    }
  }
  return { quality, formats, numeric }
}

// Deterministic single-record candidate: highest tier wins; ties prefer an
// explicit numeric resolution, then the lowest stream index. Never merges
// formats across releases.
export function selectCandidate(streams) {
  if (!Array.isArray(streams) || streams.length === 0) return null
  let best = null
  for (let index = 0; index < streams.length; index += 1) {
    const parsed = parseTorrentioRecord(streams[index])
    if (!parsed.quality) continue
    const rank = QUALITY_ORDER[parsed.quality] ?? -1
    const incumbentRank = best ? (QUALITY_ORDER[best.quality] ?? -1) : -1
    if (
      !best ||
      rank > incumbentRank ||
      (rank === incumbentRank && parsed.numeric && !best.numeric)
    ) {
      best = { index, quality: parsed.quality, formats: parsed.formats, numeric: parsed.numeric }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Authoritative TMDB /find classification gate
// ---------------------------------------------------------------------------

export function classifyFindResult(findJson) {
  const movies = Array.isArray(findJson?.movie_results) ? findJson.movie_results : null
  const series = Array.isArray(findJson?.tv_results) ? findJson.tv_results : null
  if (!movies || !series) return "unknown"
  if (movies.length > 0 && series.length === 0) return "movie"
  if (series.length > 0 && movies.length === 0) return "series"
  if (movies.length > 0 && series.length > 0) return "ambiguous"
  return "unknown"
}

// ---------------------------------------------------------------------------
// Additive merge (curated values win; only absent allowlisted formats fill)
// ---------------------------------------------------------------------------

export function mergeAdditive(existing, candidate) {
  const base = isRecord(existing) ? existing : {}
  const cand = isRecord(candidate) ? candidate : {}
  const currentFormats = Array.isArray(base.formats) ? base.formats.filter((f) => typeof f === "string") : []
  const currentSet = new Set(currentFormats)
  const candFormats = Array.isArray(cand.formats) ? cand.formats : []
  const added = []
  for (const token of FORMAT_ORDER) {
    if (candFormats.includes(token) && ALLOWED_MERGE_FORMATS.includes(token) && !currentSet.has(token)) {
      added.push(token)
      currentSet.add(token)
    }
  }
  const entry = { ...base, formats: [...currentSet] }
  let qualityFilled = false
  if ((entry.quality === undefined || entry.quality === null) && typeof cand.quality === "string" && KNOWN_QUALITIES.includes(cand.quality)) {
    entry.quality = cand.quality
    qualityFilled = true
  }
  return { entry, added, decision: added.length > 0 || qualityFilled ? "mutated" : "nochange" }
}

// ---------------------------------------------------------------------------
// Stop policy, checkpoint, provenance hygiene
// ---------------------------------------------------------------------------

function headerHasRetryAfter(headers) {
  if (!headers) return false
  try {
    if (typeof headers.get === "function") {
      return headers.get("retry-after") !== null
    }
    const keys = Object.keys(headers)
    return keys.some((k) => String(k).toLowerCase() === "retry-after")
  } catch {
    return false
  }
}

// 429/403/401/Retry-After/challenge-class responses stop the run: no
// automated retries, no alternate proxy. Plain per-id failures (404,
// 5xx without Retry-After, timeouts, invalid JSON) do NOT stop the run.
export function shouldStopOnHttpStatus(status, headers) {
  if (STOP_STATUSES.has(status)) return true
  if (headerHasRetryAfter(headers)) return true
  return false
}

export function mergeCheckpoint(prev, next) {
  const a = isRecord(prev?.ids) ? prev.ids : {}
  const b = isRecord(next?.ids) ? next.ids : {}
  return { ids: { ...a, ...b } }
}

// Allowlist-only provenance: ids, enums, counts and timestamps. Never raw
// names, filenames, hashes, urls, keys or tokens.
export function sanitizeProvenanceEntry(input) {
  const quality =
    typeof input?.candidate?.quality === "string" && KNOWN_QUALITIES.includes(input.candidate.quality)
      ? input.candidate.quality
      : null
  const formats = Array.isArray(input?.candidate?.formats)
    ? input.candidate.formats.filter((f) => KNOWN_FORMAT_TOKENS.includes(f))
    : []
  const decision = typeof input?.decision === "string" ? input.decision : "skip"
  const classification =
    input?.classification === "movie" || input?.classification === "series" ||
    input?.classification === "ambiguous" || input?.classification === "unknown"
      ? input.classification
      : "unknown"
  return {
    source: "torrentio",
    observedAt: typeof input?.observedAt === "string" ? input.observedAt : null,
    declared: { quality, formats },
    decision,
    evidence: {
      classification,
      movieResults: Number.isInteger(input?.movieResults) ? input.movieResults : 0,
      tvResults: Number.isInteger(input?.tvResults) ? input.tvResults : 0,
      via: "tmdb-find",
    },
  }
}

// ---------------------------------------------------------------------------
// Reviewed offline apply (explicit 105-id manifest, no network)
//
// Scope: user-accepted additive import of explicit declared labels with
// companion provenance (source torrentio, verification "declared" — NOT
// curated/MediaInfo-verified). Static title-level AV DB semantics: formats
// denote editions union (not all formats in the same stream); no playback
// or language guarantee.
//
// The manifest below is the full approved set: 104 hdr10plus + 1 atmos
// (tt1535109), classification movie, candidate quality 4K, delta allowlist
// minus current DB, nonempty/no-hdr, minus the exact 10 excluded curated
// conflicts. Positive list binding: the apply path iterates ONLY these ids,
// so a changed snapshot can never widen the import.
// ---------------------------------------------------------------------------

export const REVIEWED_SCOPE = "reviewed-105:movie-only,hdr10plus104+atmos1,excl10"
export const REVIEWED_SNAPSHOT_SHA256 = "2d4a777773ed96fbdc570766ed75a8cd7f67e9f6f8e93ca347cf5a3f9f3488b6"
export const REVIEWED_SNAPSHOT_BYTES = 489781
export const REVIEWED_DB_BASELINE_SHA256 = "d96623dabf3d347bb8d0d0fbbc1c6d834aa6f368ce5bf92526d6f98857d8a478"
export const REVIEWED_DB_KEYS = 1430
export const REVIEWED_EXCLUDED = [
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
export const REVIEWED_APPROVED = [
    { id: "tt0084649", added: ["hdr10plus"] },
    { id: "tt0091474", added: ["hdr10plus"] },
    { id: "tt0092007", added: ["hdr10plus"] },
    { id: "tt0093748", added: ["hdr10plus"] },
    { id: "tt0094898", added: ["hdr10plus"] },
    { id: "tt0096283", added: ["hdr10plus"] },
    { id: "tt0099077", added: ["hdr10plus"] },
    { id: "tt0101540", added: ["hdr10plus"] },
    { id: "tt0101889", added: ["hdr10plus"] },
    { id: "tt0106519", added: ["hdr10plus"] },
    { id: "tt0112864", added: ["hdr10plus"] },
    { id: "tt0119008", added: ["hdr10plus"] },
    { id: "tt0119177", added: ["hdr10plus"] },
    { id: "tt0119282", added: ["hdr10plus"] },
    { id: "tt0120815", added: ["hdr10plus"] },
    { id: "tt0120863", added: ["hdr10plus"] },
    { id: "tt0162222", added: ["hdr10plus"] },
    { id: "tt0203009", added: ["hdr10plus"] },
    { id: "tt0217505", added: ["hdr10plus"] },
    { id: "tt0257044", added: ["hdr10plus"] },
    { id: "tt0325710", added: ["hdr10plus"] },
    { id: "tt0328107", added: ["hdr10plus"] },
    { id: "tt0335266", added: ["hdr10plus"] },
    { id: "tt0361748", added: ["hdr10plus"] },
    { id: "tt0401792", added: ["hdr10plus"] },
    { id: "tt0408306", added: ["hdr10plus"] },
    { id: "tt0449088", added: ["hdr10plus"] },
    { id: "tt0450259", added: ["hdr10plus"] },
    { id: "tt0790636", added: ["hdr10plus"] },
    { id: "tt0829482", added: ["hdr10plus"] },
    { id: "tt0903624", added: ["hdr10plus"] },
    { id: "tt10098448", added: ["hdr10plus"] },
    { id: "tt1022603", added: ["hdr10plus"] },
    { id: "tt10374610", added: ["hdr10plus"] },
    { id: "tt10633456", added: ["hdr10plus"] },
    { id: "tt10648342", added: ["hdr10plus"] },
    { id: "tt11539996", added: ["hdr10plus"] },
    { id: "tt11655566", added: ["hdr10plus"] },
    { id: "tt1170358", added: ["hdr10plus"] },
    { id: "tt12299608", added: ["hdr10plus"] },
    { id: "tt12300742", added: ["hdr10plus"] },
    { id: "tt12593682", added: ["hdr10plus"] },
    { id: "tt12908150", added: ["hdr10plus"] },
    { id: "tt1298650", added: ["hdr10plus"] },
    { id: "tt13833688", added: ["hdr10plus"] },
    { id: "tt1399103", added: ["hdr10plus"] },
    { id: "tt14114802", added: ["hdr10plus"] },
    { id: "tt14208870", added: ["hdr10plus"] },
    { id: "tt14905854", added: ["hdr10plus"] },
    { id: "tt15047880", added: ["hdr10plus"] },
    { id: "tt1535108", added: ["hdr10plus"] },
    { id: "tt1535109", added: ["atmos"] },
    { id: "tt1568346", added: ["hdr10plus"] },
    { id: "tt1630029", added: ["hdr10plus"] },
    { id: "tt1757678", added: ["hdr10plus"] },
    { id: "tt18259538", added: ["hdr10plus"] },
    { id: "tt1950186", added: ["hdr10plus"] },
    { id: "tt19770238", added: ["hdr10plus"] },
    { id: "tt2012616", added: ["hdr10plus"] },
    { id: "tt22084616", added: ["hdr10plus"] },
    { id: "tt2245084", added: ["hdr10plus"] },
    { id: "tt2310332", added: ["hdr10plus"] },
    { id: "tt26581740", added: ["hdr10plus"] },
    { id: "tt26657236", added: ["hdr10plus"] },
    { id: "tt2671706", added: ["hdr10plus"] },
    { id: "tt27543632", added: ["hdr10plus"] },
    { id: "tt28650488", added: ["hdr10plus"] },
    { id: "tt2911666", added: ["hdr10plus"] },
    { id: "tt29355505", added: ["hdr10plus"] },
    { id: "tt29552248", added: ["hdr10plus"] },
    { id: "tt29567915", added: ["hdr10plus"] },
    { id: "tt30343021", added: ["hdr10plus"] },
    { id: "tt30825738", added: ["hdr10plus"] },
    { id: "tt31036941", added: ["hdr10plus"] },
    { id: "tt31170389", added: ["hdr10plus"] },
    { id: "tt32093575", added: ["hdr10plus"] },
    { id: "tt32141377", added: ["hdr10plus"] },
    { id: "tt32357218", added: ["hdr10plus"] },
    { id: "tt32612507", added: ["hdr10plus"] },
    { id: "tt32820897", added: ["hdr10plus"] },
    { id: "tt32890033", added: ["hdr10plus"] },
    { id: "tt32916440", added: ["hdr10plus"] },
    { id: "tt33071426", added: ["hdr10plus"] },
    { id: "tt33296751", added: ["hdr10plus"] },
    { id: "tt34564059", added: ["hdr10plus"] },
    { id: "tt34685692", added: ["hdr10plus"] },
    { id: "tt37287335", added: ["hdr10plus"] },
    { id: "tt37654096", added: ["hdr10plus"] },
    { id: "tt39316472", added: ["hdr10plus"] },
    { id: "tt4633694", added: ["hdr10plus"] },
    { id: "tt4712810", added: ["hdr10plus"] },
    { id: "tt5113044", added: ["hdr10plus"] },
    { id: "tt5648882", added: ["hdr10plus"] },
    { id: "tt6285944", added: ["hdr10plus"] },
    { id: "tt6565702", added: ["hdr10plus"] },
    { id: "tt6857376", added: ["hdr10plus"] },
    { id: "tt6920084", added: ["hdr10plus"] },
    { id: "tt7131622", added: ["hdr10plus"] },
    { id: "tt7599146", added: ["hdr10plus"] },
    { id: "tt8036976", added: ["hdr10plus"] },
    { id: "tt8814476", added: ["hdr10plus"] },
    { id: "tt8946378", added: ["hdr10plus"] },
    { id: "tt9419884", added: ["hdr10plus"] },
    { id: "tt9601292", added: ["hdr10plus"] },
    { id: "tt9620292", added: ["hdr10plus"] },
];

// ---------------------------------------------------------------------------
// Reviewed union apply, phase 2 (explicit 832-id manifest, no network)
//
// User-authorized ADDITIVE UNION of the remaining 832 Torrentio proposals:
// 822 generic-HDR deltas (declared-vs-verified hold resolved by explicit user
// acceptance: generic "hdr" is recorded as HDR declared, never as certified
// HDR10) + the 10 previously excluded curated conflicts (accepted as
// title-level edition union, not independently verified and not a guarantee
// that all features share one stream).
//
// Non-replacement contract (same as phase 1, extended): mergeAdditive only
// appends absent allowlisted formats [dv/hdr/hdr10plus/atmos]; imax stays
// curated-only; quality is never written on this phase (all 832 rows already
// carry a quality, so qualityFilled never fires); series/unknown rows stay
// verbatim; no new titles (row count unchanged). A declared candidate quality
// may sit below the stored quality (FHD candidates enriching 4K rows) — that
// is not a downgrade: the stored quality tuple is untouched and the source's
// declared candidate quality is recorded separately in provenance, with no
// same-stream/playback/language guarantee.
//
// The manifest below is the full approved set, derived ONLY from the pinned
// immutable snapshot plus the pinned post-105 DB state: exactly the 832
// mutated movie records absent from the phase-1 provenance, positive-list
// bound (the apply path iterates ONLY these ids). The 105 phase-1 ids are
// pinned as excluded from this phase; the DB baseline pin is the post-105
// state SHA.
// ---------------------------------------------------------------------------

export const REVIEWED832_SCOPE = "reviewed-union-832:movie-only,822generic-hdr+10prev-conflicts"
export const REVIEWED832_DB_BASELINE_SHA256 = "31b165e23610af0709bce32d92548be6380278e6c9771738d4fadba598db0e45"
export const REVIEWED832_DB_KEYS = 1430
export const REVIEWED832_APPROVED = [
    { id: "tt0034583", added: ["hdr"] },
    { id: "tt0050083", added: ["hdr"] },
    { id: "tt0054215", added: ["hdr"] },
    { id: "tt0057012", added: ["hdr"] },
    { id: "tt0060196", added: ["hdr"] },
    { id: "tt0066921", added: ["hdr"] },
    { id: "tt0068646", added: ["hdr"] },
    { id: "tt0071562", added: ["hdr"] },
    { id: "tt0073195", added: ["hdr"] },
    { id: "tt0073486", added: ["hdr"] },
    { id: "tt0074285", added: ["hdr"] },
    { id: "tt0075314", added: ["hdr"] },
    { id: "tt0076759", added: ["hdr"] },
    { id: "tt0078788", added: ["hdr"] },
    { id: "tt0080455", added: ["hdr"] },
    { id: "tt0080474", added: ["hdr"] },
    { id: "tt0080487", added: ["hdr"] },
    { id: "tt0080678", added: ["hdr"] },
    { id: "tt0080684", added: ["hdr"] },
    { id: "tt0081283", added: ["hdr"] },
    { id: "tt0081398", added: ["hdr"] },
    { id: "tt0081505", added: ["hdr"] },
    { id: "tt0082085", added: ["hdr"] },
    { id: "tt0082089", added: ["hdr"] },
    { id: "tt0082340", added: ["hdr"] },
    { id: "tt0082783", added: ["hdr"] },
    { id: "tt0082971", added: ["hdr"] },
    { id: "tt0082979", added: ["hdr"] },
    { id: "tt0083111", added: ["hdr"] },
    { id: "tt0083190", added: ["hdr"] },
    { id: "tt0083658", added: ["dv", "hdr"] },
    { id: "tt0083791", added: ["hdr"] },
    { id: "tt0083866", added: ["hdr"] },
    { id: "tt0083907", added: ["hdr"] },
    { id: "tt0083944", added: ["hdr", "atmos"] },
    { id: "tt0084237", added: ["hdr"] },
    { id: "tt0084726", added: ["hdr"] },
    { id: "tt0084787", added: ["hdr"] },
    { id: "tt0084805", added: ["hdr"] },
    { id: "tt0085334", added: ["hdr"] },
    { id: "tt0085407", added: ["hdr"] },
    { id: "tt0085995", added: ["hdr"] },
    { id: "tt0086066", added: ["hdr"] },
    { id: "tt0086190", added: ["hdr"] },
    { id: "tt0086250", added: ["hdr"] },
    { id: "tt0086425", added: ["hdr"] },
    { id: "tt0086567", added: ["hdr"] },
    { id: "tt0086879", added: ["hdr"] },
    { id: "tt0086979", added: ["hdr"] },
    { id: "tt0087332", added: ["hdr10plus"] },
    { id: "tt0087363", added: ["hdr"] },
    { id: "tt0087469", added: ["hdr"] },
    { id: "tt0087538", added: ["hdr"] },
    { id: "tt0087781", added: ["hdr"] },
    { id: "tt0087800", added: ["hdr"] },
    { id: "tt0087843", added: ["hdr"] },
    { id: "tt0088247", added: ["hdr"] },
    { id: "tt0088258", added: ["hdr"] },
    { id: "tt0088286", added: ["hdr"] },
    { id: "tt0088680", added: ["hdr"] },
    { id: "tt0088763", added: ["hdr"] },
    { id: "tt0088794", added: ["hdr"] },
    { id: "tt0088847", added: ["hdr"] },
    { id: "tt0088939", added: ["hdr"] },
    { id: "tt0088993", added: ["hdr", "atmos"] },
    { id: "tt0089175", added: ["hdr"] },
    { id: "tt0089218", added: ["hdr"] },
    { id: "tt0089755", added: ["hdr"] },
    { id: "tt0089767", added: ["hdr"] },
    { id: "tt0089791", added: ["hdr"] },
    { id: "tt0089885", added: ["hdr"] },
    { id: "tt0089907", added: ["hdr"] },
    { id: "tt0089941", added: ["hdr"] },
    { id: "tt0090022", added: ["hdr"] },
    { id: "tt0090180", added: ["hdr"] },
    { id: "tt0090329", added: ["hdr"] },
    { id: "tt0090605", added: ["atmos"] },
    { id: "tt0090728", added: ["hdr", "hdr10plus"] },
    { id: "tt0090756", added: ["hdr"] },
    { id: "tt0091042", added: ["hdr"] },
    { id: "tt0091369", added: ["hdr"] },
    { id: "tt0091419", added: ["hdr"] },
    { id: "tt0092005", added: ["hdr"] },
    { id: "tt0092099", added: ["hdr"] },
    { id: "tt0092106", added: ["hdr"] },
    { id: "tt0092563", added: ["hdr"] },
    { id: "tt0092699", added: ["hdr"] },
    { id: "tt0092890", added: ["hdr"] },
    { id: "tt0092965", added: ["hdr"] },
    { id: "tt0092991", added: ["hdr"] },
    { id: "tt0093058", added: ["hdr"] },
    { id: "tt0093409", added: ["hdr"] },
    { id: "tt0093437", added: ["hdr"] },
    { id: "tt0093565", added: ["hdr"] },
    { id: "tt0093640", added: ["hdr"] },
    { id: "tt0093773", added: ["hdr"] },
    { id: "tt0093779", added: ["hdr"] },
    { id: "tt0093870", added: ["hdr"] },
    { id: "tt0094012", added: ["hdr"] },
    { id: "tt0094226", added: ["hdr", "atmos"] },
    { id: "tt0094291", added: ["hdr", "hdr10plus"] },
    { id: "tt0094721", added: ["hdr"] },
    { id: "tt0094737", added: ["hdr", "hdr10plus"] },
    { id: "tt0095016", added: ["hdr", "hdr10plus"] },
    { id: "tt0095031", added: ["hdr"] },
    { id: "tt0095159", added: ["hdr"] },
    { id: "tt0095631", added: ["hdr"] },
    { id: "tt0095647", added: ["hdr"] },
    { id: "tt0096256", added: ["hdr"] },
    { id: "tt0096438", added: ["hdr"] },
    { id: "tt0096446", added: ["hdr", "atmos"] },
    { id: "tt0096754", added: ["hdr"] },
    { id: "tt0096895", added: ["hdr"] },
    { id: "tt0096969", added: ["hdr"] },
    { id: "tt0097165", added: ["hdr"] },
    { id: "tt0097216", added: ["hdr"] },
    { id: "tt0097351", added: ["hdr"] },
    { id: "tt0097441", added: ["hdr"] },
    { id: "tt0097493", added: ["hdr"] },
    { id: "tt0097733", added: ["hdr"] },
    { id: "tt0097757", added: ["hdr"] },
    { id: "tt0097815", added: ["hdr"] },
    { id: "tt0097958", added: ["hdr"] },
    { id: "tt0098067", added: ["hdr"] },
    { id: "tt0098258", added: ["hdr"] },
    { id: "tt0098384", added: ["hdr"] },
    { id: "tt0098554", added: ["hdr"] },
    { id: "tt0098635", added: ["hdr"] },
    { id: "tt0098724", added: ["hdr"] },
    { id: "tt0099348", added: ["hdr"] },
    { id: "tt0099487", added: ["hdr"] },
    { id: "tt0099674", added: ["hdr"] },
    { id: "tt0099685", added: ["hdr"] },
    { id: "tt0099785", added: ["hdr"] },
    { id: "tt0099810", added: ["hdr"] },
    { id: "tt0099871", added: ["hdr"] },
    { id: "tt0100157", added: ["hdr"] },
    { id: "tt0100802", added: ["hdr"] },
    { id: "tt0101414", added: ["hdr"] },
    { id: "tt0101507", added: ["hdr"] },
    { id: "tt0102536", added: ["hdr"] },
    { id: "tt0102685", added: ["hdr"] },
    { id: "tt0102975", added: ["hdr"] },
    { id: "tt0103064", added: ["hdr"] },
    { id: "tt0103074", added: ["hdr"] },
    { id: "tt0103639", added: ["hdr"] },
    { id: "tt0103776", added: ["hdr"] },
    { id: "tt0103874", added: ["hdr"] },
    { id: "tt0104257", added: ["hdr"] },
    { id: "tt0104348", added: ["hdr"] },
    { id: "tt0104691", added: ["hdr"] },
    { id: "tt0104694", added: ["atmos"] },
    { id: "tt0104797", added: ["hdr"] },
    { id: "tt0104940", added: ["hdr"] },
    { id: "tt0105151", added: ["hdr"] },
    { id: "tt0105236", added: ["hdr"] },
    { id: "tt0105323", added: ["hdr"] },
    { id: "tt0105695", added: ["hdr"] },
    { id: "tt0106308", added: ["hdr"] },
    { id: "tt0106364", added: ["hdr"] },
    { id: "tt0106489", added: ["hdr"] },
    { id: "tt0106677", added: ["hdr"] },
    { id: "tt0106856", added: ["hdr"] },
    { id: "tt0106977", added: ["hdr"] },
    { id: "tt0107048", added: ["hdr"] },
    { id: "tt0107290", added: ["hdr"] },
    { id: "tt0107554", added: ["hdr"] },
    { id: "tt0107688", added: ["hdr"] },
    { id: "tt0107818", added: ["hdr"] },
    { id: "tt0108002", added: ["hdr"] },
    { id: "tt0108037", added: ["hdr"] },
    { id: "tt0108052", added: ["hdr"] },
    { id: "tt0108358", added: ["hdr"] },
    { id: "tt0108399", added: ["hdr"] },
    { id: "tt0109445", added: ["hdr"] },
    { id: "tt0109506", added: ["hdr"] },
    { id: "tt0109642", added: ["hdr"] },
    { id: "tt0109830", added: ["hdr"] },
    { id: "tt0110116", added: ["hdr"] },
    { id: "tt0110148", added: ["hdr"] },
    { id: "tt0110357", added: ["hdr"] },
    { id: "tt0110367", added: ["hdr"] },
    { id: "tt0110413", added: ["hdr"] },
    { id: "tt0110932", added: ["hdr"] },
    { id: "tt0111161", added: ["hdr"] },
    { id: "tt0111257", added: ["hdr"] },
    { id: "tt0111503", added: ["hdr"] },
    { id: "tt0112384", added: ["hdr"] },
    { id: "tt0112471", added: ["hdr"] },
    { id: "tt0112573", added: ["hdr"] },
    { id: "tt0112641", added: ["hdr"] },
    { id: "tt0113277", added: ["hdr"] },
    { id: "tt0113627", added: ["hdr"] },
    { id: "tt0113870", added: ["hdr"] },
    { id: "tt0114388", added: ["hdr"] },
    { id: "tt0114709", added: ["hdr"] },
    { id: "tt0114746", added: ["hdr"] },
    { id: "tt0114814", added: ["hdr"] },
    { id: "tt0115685", added: ["hdr"] },
    { id: "tt0115736", added: ["hdr"] },
    { id: "tt0116282", added: ["hdr"] },
    { id: "tt0116695", added: ["hdr"] },
    { id: "tt0116905", added: ["hdr"] },
    { id: "tt0116922", added: ["hdr"] },
    { id: "tt0117060", added: ["hdr"] },
    { id: "tt0117381", added: ["hdr"] },
    { id: "tt0117500", added: ["hdr"] },
    { id: "tt0117571", added: ["hdr"] },
    { id: "tt0117665", added: ["hdr"] },
    { id: "tt0117731", added: ["hdr"] },
    { id: "tt0118528", added: ["hdr"] },
    { id: "tt0118715", added: ["hdr"] },
    { id: "tt0118749", added: ["hdr", "hdr10plus"] },
    { id: "tt0118884", added: ["hdr"] },
    { id: "tt0118971", added: ["hdr"] },
    { id: "tt0119174", added: ["hdr"] },
    { id: "tt0119217", added: ["hdr"] },
    { id: "tt0119229", added: ["hdr"] },
    { id: "tt0119396", added: ["hdr"] },
    { id: "tt0119488", added: ["hdr"] },
    { id: "tt0119654", added: ["hdr"] },
    { id: "tt0119822", added: ["hdr"] },
    { id: "tt0120201", added: ["hdr"] },
    { id: "tt0120324", added: ["hdr"] },
    { id: "tt0120338", added: ["hdr"] },
    { id: "tt0120363", added: ["hdr"] },
    { id: "tt0120382", added: ["hdr"] },
    { id: "tt0120655", added: ["hdr"] },
    { id: "tt0120660", added: ["hdr", "hdr10plus"] },
    { id: "tt0120669", added: ["hdr"] },
    { id: "tt0120689", added: ["hdr"] },
    { id: "tt0120737", added: ["hdr"] },
    { id: "tt0120755", added: ["hdr"] },
    { id: "tt0120762", added: ["hdr"] },
    { id: "tt0120789", added: ["hdr"] },
    { id: "tt0120791", added: ["hdr", "atmos"] },
    { id: "tt0120794", added: ["hdr"] },
    { id: "tt0120804", added: ["hdr"] },
    { id: "tt0120903", added: ["hdr"] },
    { id: "tt0120915", added: ["hdr"] },
    { id: "tt0121164", added: ["hdr"] },
    { id: "tt0121765", added: ["hdr"] },
    { id: "tt0121766", added: ["hdr"] },
    { id: "tt0126029", added: ["hdr"] },
    { id: "tt0128442", added: ["hdr"] },
    { id: "tt0128445", added: ["hdr"] },
    { id: "tt0133093", added: ["hdr"] },
    { id: "tt0133189", added: ["hdr"] },
    { id: "tt0137523", added: ["hdr"] },
    { id: "tt0138704", added: ["hdr10plus"] },
    { id: "tt0139654", added: ["hdr"] },
    { id: "tt0140352", added: ["hdr"] },
    { id: "tt0144084", added: ["hdr"] },
    { id: "tt0145487", added: ["hdr"] },
    { id: "tt0147612", added: ["hdr"] },
    { id: "tt0147800", added: ["hdr"] },
    { id: "tt0158983", added: ["hdr"] },
    { id: "tt0165798", added: ["hdr"] },
    { id: "tt0166896", added: ["hdr"] },
    { id: "tt0166924", added: ["hdr"] },
    { id: "tt0167260", added: ["hdr"] },
    { id: "tt0167261", added: ["hdr"] },
    { id: "tt0167404", added: ["hdr"] },
    { id: "tt0169547", added: ["hdr"] },
    { id: "tt0172495", added: ["hdr"] },
    { id: "tt0175880", added: ["hdr"] },
    { id: "tt0177789", added: ["hdr"] },
    { id: "tt0180093", added: ["hdr"] },
    { id: "tt0181689", added: ["hdr"] },
    { id: "tt0181875", added: ["hdr"] },
    { id: "tt0190590", added: ["hdr"] },
    { id: "tt0195685", added: ["hdr"] },
    { id: "tt0198781", added: ["hdr"] },
    { id: "tt0203230", added: ["hdr"] },
    { id: "tt0206634", added: ["hdr"] },
    { id: "tt0209144", added: ["hdr"] },
    { id: "tt0210945", added: ["hdr"] },
    { id: "tt0215750", added: ["hdr"] },
    { id: "tt0221027", added: ["hdr"] },
    { id: "tt0230600", added: ["hdr"] },
    { id: "tt0234215", added: ["hdr"] },
    { id: "tt0240772", added: ["hdr"] },
    { id: "tt0241527", added: ["hdr"] },
    { id: "tt0242653", added: ["hdr"] },
    { id: "tt0243133", added: ["hdr"] },
    { id: "tt0245844", added: ["hdr"] },
    { id: "tt0246578", added: ["hdr"] },
    { id: "tt0258463", added: ["hdr"] },
    { id: "tt0264464", added: ["hdr"] },
    { id: "tt0264616", added: ["hdr"] },
    { id: "tt0265086", added: ["hdr", "atmos"] },
    { id: "tt0265666", added: ["hdr"] },
    { id: "tt0266543", added: ["hdr"] },
    { id: "tt0266697", added: ["hdr"] },
    { id: "tt0268126", added: ["hdr"] },
    { id: "tt0268380", added: ["hdr"] },
    { id: "tt0268978", added: ["hdr", "atmos"] },
    { id: "tt0275847", added: ["hdr"] },
    { id: "tt0278504", added: ["hdr"] },
    { id: "tt0289043", added: ["hdr", "atmos"] },
    { id: "tt0290334", added: ["hdr"] },
    { id: "tt0295297", added: ["hdr"] },
    { id: "tt0298148", added: ["hdr"] },
    { id: "tt0304141", added: ["hdr"] },
    { id: "tt0311113", added: ["hdr"] },
    { id: "tt0316356", added: ["hdr"] },
    { id: "tt0316654", added: ["hdr"] },
    { id: "tt0317219", added: ["hdr"] },
    { id: "tt0317248", added: ["hdr"] },
    { id: "tt0317705", added: ["hdr"] },
    { id: "tt0317740", added: ["hdr"] },
    { id: "tt0317919", added: ["hdr"] },
    { id: "tt0318627", added: ["hdr"] },
    { id: "tt0319061", added: ["hdr"] },
    { id: "tt0325980", added: ["hdr10plus"] },
    { id: "tt0327137", added: ["hdr"] },
    { id: "tt0327597", added: ["hdr"] },
    { id: "tt0330373", added: ["hdr"] },
    { id: "tt0332280", added: ["hdr"] },
    { id: "tt0337978", added: ["hdr"] },
    { id: "tt0338751", added: ["hdr"] },
    { id: "tt0350258", added: ["hdr"] },
    { id: "tt0353969", added: ["hdr"] },
    { id: "tt0367882", added: ["hdr"] },
    { id: "tt0369339", added: ["hdr"] },
    { id: "tt0369610", added: ["hdr10plus"] },
    { id: "tt0371746", added: ["hdr"] },
    { id: "tt0372183", added: ["hdr"] },
    { id: "tt0372784", added: ["dv", "hdr"] },
    { id: "tt0373889", added: ["hdr"] },
    { id: "tt0375063", added: ["hdr"] },
    { id: "tt0378194", added: ["hdr"] },
    { id: "tt0379786", added: ["hdr"] },
    { id: "tt0381061", added: ["hdr"] },
    { id: "tt0381681", added: ["hdr"] },
    { id: "tt0381849", added: ["hdr"] },
    { id: "tt0382932", added: ["hdr"] },
    { id: "tt0383028", added: ["hdr"] },
    { id: "tt0383574", added: ["hdr10plus"] },
    { id: "tt0388795", added: ["hdr"] },
    { id: "tt0398286", added: ["hdr", "atmos"] },
    { id: "tt0399146", added: ["hdr"] },
    { id: "tt0407887", added: ["hdr"] },
    { id: "tt0409459", added: ["hdr"] },
    { id: "tt0411477", added: ["hdr"] },
    { id: "tt0413300", added: ["hdr", "atmos"] },
    { id: "tt0414387", added: ["hdr", "atmos"] },
    { id: "tt0416449", added: ["hdr"] },
    { id: "tt0417741", added: ["hdr"] },
    { id: "tt0420223", added: ["hdr"] },
    { id: "tt0421715", added: ["hdr"] },
    { id: "tt0425210", added: ["hdr"] },
    { id: "tt0425379", added: ["atmos"] },
    { id: "tt0427340", added: ["hdr"] },
    { id: "tt0432283", added: ["hdr"] },
    { id: "tt0434409", added: ["hdr"] },
    { id: "tt0435625", added: ["hdr"] },
    { id: "tt0435761", added: ["hdr"] },
    { id: "tt0440963", added: ["hdr"] },
    { id: "tt0446029", added: ["hdr"] },
    { id: "tt0449059", added: ["hdr"] },
    { id: "tt0451279", added: ["hdr"] },
    { id: "tt0454848", added: ["hdr"] },
    { id: "tt0454876", added: ["hdr"] },
    { id: "tt0454921", added: ["hdr"] },
    { id: "tt0458339", added: ["hdr"] },
    { id: "tt0460791", added: ["hdr"] },
    { id: "tt0468569", added: ["hdr"] },
    { id: "tt0470752", added: ["hdr"] },
    { id: "tt0472043", added: ["hdr", "hdr10plus"] },
    { id: "tt0475276", added: ["hdr", "atmos"] },
    { id: "tt0478970", added: ["hdr"] },
    { id: "tt0482571", added: ["hdr"] },
    { id: "tt0498380", added: ["hdr"] },
    { id: "tt0499549", added: ["hdr"] },
    { id: "tt0758758", added: ["hdr"] },
    { id: "tt0765429", added: ["hdr"] },
    { id: "tt0765443", added: ["hdr"] },
    { id: "tt0770828", added: ["hdr"] },
    { id: "tt0780504", added: ["hdr"] },
    { id: "tt0780536", added: ["hdr"] },
    { id: "tt0796366", added: ["hdr", "atmos"] },
    { id: "tt0800369", added: ["hdr"] },
    { id: "tt0814314", added: ["hdr"] },
    { id: "tt0816692", added: ["dv", "hdr10plus", "atmos"] },
    { id: "tt0830515", added: ["hdr"] },
    { id: "tt0831387", added: ["hdr"] },
    { id: "tt0840361", added: ["hdr"] },
    { id: "tt0848228", added: ["hdr"] },
    { id: "tt0887912", added: ["hdr"] },
    { id: "tt0892769", added: ["hdr"] },
    { id: "tt0892791", added: ["hdr", "atmos"] },
    { id: "tt0910970", added: ["hdr", "atmos"] },
    { id: "tt0926084", added: ["hdr"] },
    { id: "tt0974015", added: ["hdr"] },
    { id: "tt0988045", added: ["hdr"] },
    { id: "tt0993846", added: ["hdr"] },
    { id: "tt1016150", added: ["hdr"] },
    { id: "tt1024648", added: ["hdr"] },
    { id: "tt10366206", added: ["hdr"] },
    { id: "tt10366460", added: ["hdr"] },
    { id: "tt10375624", added: ["hdr"] },
    { id: "tt1049413", added: ["hdr"] },
    { id: "tt10516984", added: ["hdr"] },
    { id: "tt1051906", added: ["hdr"] },
    { id: "tt10612922", added: ["hdr", "hdr10plus"] },
    { id: "tt10638522", added: ["hdr"] },
    { id: "tt10640346", added: ["hdr"] },
    { id: "tt1065073", added: ["hdr"] },
    { id: "tt10676052", added: ["hdr"] },
    { id: "tt10720352", added: ["hdr"] },
    { id: "tt1074638", added: ["hdr"] },
    { id: "tt1080016", added: ["hdr"] },
    { id: "tt10838180", added: ["hdr"] },
    { id: "tt10855768", added: ["hdr"] },
    { id: "tt10872600", added: ["hdr"] },
    { id: "tt1091191", added: ["hdr", "atmos"] },
    { id: "tt10954984", added: ["hdr"] },
    { id: "tt1099212", added: ["hdr"] },
    { id: "tt11079148", added: ["hdr"] },
    { id: "tt11083552", added: ["hdr"] },
    { id: "tt11121664", added: ["hdr"] },
    { id: "tt11127680", added: ["hdr"] },
    { id: "tt11138512", added: ["hdr"] },
    { id: "tt1119646", added: ["hdr"] },
    { id: "tt11233960", added: ["hdr"] },
    { id: "tt11271038", added: ["hdr"] },
    { id: "tt11278476", added: ["hdr"] },
    { id: "tt11286314", added: ["hdr"] },
    { id: "tt11291274", added: ["hdr"] },
    { id: "tt1130884", added: ["hdr10plus"] },
    { id: "tt11315808", added: ["hdr", "hdr10plus"] },
    { id: "tt11327514", added: ["hdr"] },
    { id: "tt1136608", added: ["hdr"] },
    { id: "tt11378946", added: ["hdr"] },
    { id: "tt11561116", added: ["hdr"] },
    { id: "tt11563598", added: ["hdr", "hdr10plus"] },
    { id: "tt1156398", added: ["hdr"] },
    { id: "tt11564570", added: ["hdr"] },
    { id: "tt1160419", added: ["hdr"] },
    { id: "tt11729298", added: ["hdr"] },
    { id: "tt1179933", added: ["hdr"] },
    { id: "tt1182345", added: ["hdr", "atmos"] },
    { id: "tt11847410", added: ["hdr"] },
    { id: "tt11866324", added: ["hdr"] },
    { id: "tt1189340", added: ["hdr"] },
    { id: "tt1193138", added: ["hdr"] },
    { id: "tt1197624", added: ["hdr"] },
    { id: "tt1201607", added: ["hdr"] },
    { id: "tt12037194", added: ["hdr"] },
    { id: "tt12042730", added: ["hdr"] },
    { id: "tt1211837", added: ["hdr"] },
    { id: "tt1219289", added: ["hdr"] },
    { id: "tt12262116", added: ["hdr"] },
    { id: "tt12263384", added: ["hdr"] },
    { id: "tt1228705", added: ["hdr"] },
    { id: "tt1229238", added: ["hdr"] },
    { id: "tt12361974", added: ["hdr"] },
    { id: "tt12446086", added: ["hdr"] },
    { id: "tt1250777", added: ["hdr"] },
    { id: "tt12583926", added: ["hdr"] },
    { id: "tt12584954", added: ["hdr"] },
    { id: "tt1262426", added: ["hdr"] },
    { id: "tt1270797", added: ["hdr"] },
    { id: "tt1270798", added: ["hdr"] },
    { id: "tt12731980", added: ["hdr"] },
    { id: "tt1276104", added: ["hdr", "atmos"] },
    { id: "tt12801262", added: ["hdr"] },
    { id: "tt1285016", added: ["hdr"] },
    { id: "tt1291584", added: ["hdr"] },
    { id: "tt1300854", added: ["hdr"] },
    { id: "tt1302006", added: ["hdr"] },
    { id: "tt1312221", added: ["hdr"] },
    { id: "tt1318514", added: ["hdr"] },
    { id: "tt1321510", added: ["hdr"] },
    { id: "tt1323594", added: ["hdr"] },
    { id: "tt13238346", added: ["hdr"] },
    { id: "tt1340800", added: ["hdr"] },
    { id: "tt1341338", added: ["hdr"] },
    { id: "tt13433802", added: ["hdr"] },
    { id: "tt1343727", added: ["hdr"] },
    { id: "tt1345836", added: ["hdr"] },
    { id: "tt13611778", added: ["hdr"] },
    { id: "tt13622970", added: ["hdr"] },
    { id: "tt13654226", added: ["hdr", "hdr10plus"] },
    { id: "tt1371111", added: ["hdr"] },
    { id: "tt1375666", added: ["hdr"] },
    { id: "tt1392170", added: ["hdr"] },
    { id: "tt1392190", added: ["hdr"] },
    { id: "tt1392214", added: ["hdr"] },
    { id: "tt1396484", added: ["hdr"] },
    { id: "tt1398426", added: ["hdr"] },
    { id: "tt1408101", added: ["hdr", "atmos"] },
    { id: "tt14142060", added: ["hdr"] },
    { id: "tt14173636", added: ["hdr"] },
    { id: "tt14205554", added: ["hdr"] },
    { id: "tt14230458", added: ["hdr"] },
    { id: "tt1431045", added: ["hdr"] },
    { id: "tt14324650", added: ["hdr"] },
    { id: "tt14364480", added: ["hdr"] },
    { id: "tt14376344", added: ["hdr"] },
    { id: "tt14402926", added: ["hdr"] },
    { id: "tt14444726", added: ["hdr"] },
    { id: "tt14513804", added: ["hdr"] },
    { id: "tt14539740", added: ["hdr", "hdr10plus"] },
    { id: "tt1454468", added: ["hdr"] },
    { id: "tt1457767", added: ["hdr"] },
    { id: "tt1462764", added: ["hdr"] },
    { id: "tt1477834", added: ["hdr"] },
    { id: "tt1478839", added: ["hdr"] },
    { id: "tt14849194", added: ["hdr"] },
    { id: "tt1485796", added: ["hdr"] },
    { id: "tt1488589", added: ["hdr"] },
    { id: "tt1490017", added: ["hdr"] },
    { id: "tt14966898", added: ["hdr"] },
    { id: "tt1515091", added: ["hdr"] },
    { id: "tt1517268", added: ["hdr"] },
    { id: "tt1517451", added: ["hdr"] },
    { id: "tt15239678", added: ["hdr"] },
    { id: "tt15318872", added: ["hdr"] },
    { id: "tt15339456", added: ["hdr"] },
    { id: "tt15398776", added: ["dv", "hdr"] },
    { id: "tt1570728", added: ["hdr"] },
    { id: "tt15791034", added: ["hdr"] },
    { id: "tt15940132", added: ["hdr"] },
    { id: "tt1596343", added: ["hdr"] },
    { id: "tt1596363", added: ["hdr", "hdr10plus"] },
    { id: "tt16311594", added: ["hdr", "hdr10plus"] },
    { id: "tt1631867", added: ["hdr"] },
    { id: "tt16419074", added: ["hdr"] },
    { id: "tt1646971", added: ["hdr"] },
    { id: "tt16478058", added: ["hdr"] },
    { id: "tt1650062", added: ["hdr"] },
    { id: "tt1663202", added: ["hdr"] },
    { id: "tt1667889", added: ["hdr"] },
    { id: "tt1668200", added: ["hdr"] },
    { id: "tt1677720", added: ["hdr"] },
    { id: "tt1690953", added: ["hdr"] },
    { id: "tt16968450", added: ["hdr"] },
    { id: "tt1727388", added: ["hdr"] },
    { id: "tt1727824", added: ["hdr"] },
    { id: "tt17279496", added: ["hdr"] },
    { id: "tt1745960", added: ["hdr"] },
    { id: "tt1748122", added: ["hdr"] },
    { id: "tt17490712", added: ["hdr"] },
    { id: "tt17526714", added: ["hdr"] },
    { id: "tt1756855", added: ["hdr"] },
    { id: "tt1772341", added: ["hdr", "atmos"] },
    { id: "tt1790885", added: ["hdr", "atmos"] },
    { id: "tt1798709", added: ["hdr"] },
    { id: "tt1800241", added: ["hdr", "atmos"] },
    { id: "tt1825683", added: ["hdr"] },
    { id: "tt18412256", added: ["hdr"] },
    { id: "tt1843866", added: ["hdr"] },
    { id: "tt1853728", added: ["hdr"] },
    { id: "tt1855199", added: ["hdr"] },
    { id: "tt1856080", added: ["hdr"] },
    { id: "tt1856101", added: ["hdr"] },
    { id: "tt1860357", added: ["hdr"] },
    { id: "tt1877830", added: ["hdr"] },
    { id: "tt1877832", added: ["hdr"] },
    { id: "tt18925334", added: ["hdr"] },
    { id: "tt1895587", added: ["hdr"] },
    { id: "tt1907668", added: ["hdr"] },
    { id: "tt1951264", added: ["hdr"] },
    { id: "tt1951265", added: ["hdr"] },
    { id: "tt1951266", added: ["hdr"] },
    { id: "tt1979376", added: ["hdr"] },
    { id: "tt1981115", added: ["hdr"] },
    { id: "tt2015381", added: ["hdr"] },
    { id: "tt20215234", added: ["hdr"] },
    { id: "tt2024544", added: ["hdr"] },
    { id: "tt2049403", added: ["hdr"] },
    { id: "tt2057392", added: ["hdr"] },
    { id: "tt2084970", added: ["hdr"] },
    { id: "tt2096673", added: ["hdr"] },
    { id: "tt20969586", added: ["hdr"] },
    { id: "tt2103281", added: ["hdr"] },
    { id: "tt21064584", added: ["hdr"] },
    { id: "tt2109248", added: ["hdr"] },
    { id: "tt21192142", added: ["hdr"] },
    { id: "tt21940010", added: ["hdr"] },
    { id: "tt22022452", added: ["hdr"] },
    { id: "tt2209418", added: ["hdr"] },
    { id: "tt2250912", added: ["hdr"] },
    { id: "tt22526100", added: ["hdr"] },
    { id: "tt2267998", added: ["hdr", "atmos"] },
    { id: "tt2277860", added: ["hdr"] },
    { id: "tt2278388", added: ["hdr"] },
    { id: "tt2283362", added: ["hdr"] },
    { id: "tt2293640", added: ["hdr"] },
    { id: "tt2294629", added: ["hdr"] },
    { id: "tt23561236", added: ["hdr"] },
    { id: "tt2379713", added: ["hdr"] },
    { id: "tt2380307", added: ["hdr"] },
    { id: "tt2381249", added: ["hdr"] },
    { id: "tt2382320", added: ["hdr"] },
    { id: "tt2395427", added: ["hdr"] },
    { id: "tt2488496", added: ["hdr"] },
    { id: "tt2527336", added: ["hdr"] },
    { id: "tt2527338", added: ["hdr"] },
    { id: "tt2543164", added: ["hdr"] },
    { id: "tt2543472", added: ["hdr"] },
    { id: "tt2582496", added: ["hdr"] },
    { id: "tt2582782", added: ["hdr"] },
    { id: "tt2582802", added: ["hdr", "atmos"] },
    { id: "tt2584384", added: ["hdr"] },
    { id: "tt26443597", added: ["hdr"] },
    { id: "tt26443616", added: ["hdr"] },
    { id: "tt26743210", added: ["hdr"] },
    { id: "tt2674426", added: ["hdr"] },
    { id: "tt2709768", added: ["hdr"] },
    { id: "tt2713180", added: ["hdr"] },
    { id: "tt27165187", added: ["hdr"] },
    { id: "tt27369017", added: ["hdr"] },
    { id: "tt2737304", added: ["hdr"] },
    { id: "tt27403986", added: ["hdr"] },
    { id: "tt27419466", added: ["hdr"] },
    { id: "tt27681354", added: ["hdr"] },
    { id: "tt27706593", added: ["hdr"] },
    { id: "tt2771200", added: ["hdr"] },
    { id: "tt27847051", added: ["hdr"] },
    { id: "tt28014327", added: ["hdr"] },
    { id: "tt28015403", added: ["hdr"] },
    { id: "tt28082769", added: ["hdr"] },
    { id: "tt2820852", added: ["hdr"] },
    { id: "tt28259207", added: ["hdr"] },
    { id: "tt28607951", added: ["hdr"] },
    { id: "tt2872718", added: ["hdr", "atmos"] },
    { id: "tt2906216", added: ["hdr"] },
    { id: "tt29356163", added: ["hdr"] },
    { id: "tt29474455", added: ["hdr"] },
    { id: "tt2948356", added: ["hdr"] },
    { id: "tt2948372", added: ["hdr"] },
    { id: "tt29494959", added: ["hdr"] },
    { id: "tt2953050", added: ["hdr"] },
    { id: "tt29623480", added: ["hdr"] },
    { id: "tt2975590", added: ["hdr"] },
    { id: "tt30144839", added: ["hdr"] },
    { id: "tt30319503", added: ["hdr"] },
    { id: "tt3040964", added: ["hdr"] },
    { id: "tt3065204", added: ["hdr"] },
    { id: "tt3076658", added: ["hdr"] },
    { id: "tt30887701", added: ["hdr"] },
    { id: "tt31192372", added: ["hdr"] },
    { id: "tt31193180", added: ["hdr"] },
    { id: "tt31195136", added: ["hdr"] },
    { id: "tt31227572", added: ["hdr", "hdr10plus"] },
    { id: "tt31434639", added: ["hdr"] },
    { id: "tt31514146", added: ["hdr", "hdr10plus"] },
    { id: "tt32268156", added: ["hdr"] },
    { id: "tt32278481", added: ["hdr"] },
    { id: "tt3228774", added: ["hdr"] },
    { id: "tt32321803", added: ["hdr", "hdr10plus"] },
    { id: "tt32332915", added: ["hdr"] },
    { id: "tt32333324", added: ["hdr"] },
    { id: "tt32338669", added: ["hdr"] },
    { id: "tt32393988", added: ["hdr"] },
    { id: "tt32547691", added: ["hdr"] },
    { id: "tt32565993", added: ["hdr"] },
    { id: "tt32588798", added: ["hdr"] },
    { id: "tt32642706", added: ["hdr"] },
    { id: "tt3281548", added: ["hdr"] },
    { id: "tt32843349", added: ["hdr"] },
    { id: "tt33095251", added: ["hdr"] },
    { id: "tt33100314", added: ["hdr"] },
    { id: "tt3315342", added: ["hdr"] },
    { id: "tt3316960", added: ["hdr"] },
    { id: "tt33305867", added: ["hdr"] },
    { id: "tt33311069", added: ["hdr"] },
    { id: "tt33612209", added: ["hdr"] },
    { id: "tt33978029", added: ["hdr"] },
    { id: "tt3397884", added: ["hdr"] },
    { id: "tt34459219", added: ["hdr"] },
    { id: "tt3450958", added: ["hdr"] },
    { id: "tt3460252", added: ["hdr"] },
    { id: "tt3469046", added: ["hdr"] },
    { id: "tt3480822", added: ["hdr"] },
    { id: "tt3498820", added: ["hdr"] },
    { id: "tt3501632", added: ["hdr"] },
    { id: "tt3513548", added: ["hdr", "hdr10plus"] },
    { id: "tt3521164", added: ["hdr"] },
    { id: "tt3566834", added: ["hdr"] },
    { id: "tt35672862", added: ["hdr"] },
    { id: "tt3581652", added: ["hdr"] },
    { id: "tt36042156", added: ["hdr"] },
    { id: "tt3606756", added: ["hdr"] },
    { id: "tt36073210", added: ["hdr"] },
    { id: "tt36463894", added: ["hdr"] },
    { id: "tt3659388", added: ["hdr"] },
    { id: "tt3682448", added: ["hdr"] },
    { id: "tt36893729", added: ["hdr"] },
    { id: "tt36948232", added: ["hdr"] },
    { id: "tt3731562", added: ["hdr"] },
    { id: "tt3741700", added: ["hdr"] },
    { id: "tt3748528", added: ["hdr"] },
    { id: "tt3778644", added: ["hdr"] },
    { id: "tt3783958", added: ["hdr"] },
    { id: "tt37853455", added: ["hdr"] },
    { id: "tt3794354", added: ["hdr"] },
    { id: "tt37971717", added: ["hdr"] },
    { id: "tt3799694", added: ["hdr"] },
    { id: "tt3829920", added: ["hdr"] },
    { id: "tt38616652", added: ["hdr"] },
    { id: "tt3890160", added: ["hdr"] },
    { id: "tt38953026", added: ["hdr"] },
    { id: "tt3896198", added: ["hdr"] },
    { id: "tt3915174", added: ["hdr"] },
    { id: "tt39390497", added: ["hdr"] },
    { id: "tt3967856", added: ["hdr"] },
    { id: "tt4034228", added: ["hdr", "hdr10plus"] },
    { id: "tt4154664", added: ["hdr"] },
    { id: "tt4154756", added: ["hdr"] },
    { id: "tt4154796", added: ["hdr"] },
    { id: "tt4178092", added: ["hdr"] },
    { id: "tt4244994", added: ["hdr"] },
    { id: "tt4263482", added: ["hdr"] },
    { id: "tt4302938", added: ["hdr"] },
    { id: "tt4353250", added: ["hdr"] },
    { id: "tt43617372", added: ["hdr"] },
    { id: "tt4364194", added: ["hdr"] },
    { id: "tt4425200", added: ["hdr"] },
    { id: "tt4495098", added: ["hdr"] },
    { id: "tt4513678", added: ["hdr"] },
    { id: "tt4520988", added: ["hdr"] },
    { id: "tt4540710", added: ["hdr"] },
    { id: "tt4572514", added: ["hdr"] },
    { id: "tt4630562", added: ["hdr"] },
    { id: "tt4698684", added: ["hdr"] },
    { id: "tt4729430", added: ["hdr"] },
    { id: "tt4761112", added: ["hdr"] },
    { id: "tt4846232", added: ["hdr"] },
    { id: "tt4846340", added: ["hdr"] },
    { id: "tt4873118", added: ["hdr", "hdr10plus"] },
    { id: "tt4881806", added: ["hdr"] },
    { id: "tt4912910", added: ["hdr"] },
    { id: "tt4972582", added: ["hdr"] },
    { id: "tt4975722", added: ["hdr"] },
    { id: "tt4996328", added: ["hdr"] },
    { id: "tt5013056", added: ["hdr"] },
    { id: "tt5034838", added: ["hdr"] },
    { id: "tt5040012", added: ["hdr"] },
    { id: "tt5052448", added: ["hdr"] },
    { id: "tt5090568", added: ["hdr"] },
    { id: "tt5095030", added: ["hdr"] },
    { id: "tt5104604", added: ["hdr"] },
    { id: "tt5109280", added: ["hdr"] },
    { id: "tt5116302", added: ["hdr"] },
    { id: "tt5164432", added: ["hdr"] },
    { id: "tt5177114", added: ["hdr"] },
    { id: "tt5177120", added: ["hdr"] },
    { id: "tt5311514", added: ["hdr"] },
    { id: "tt5362988", added: ["hdr"] },
    { id: "tt5363618", added: ["hdr"] },
    { id: "tt5462602", added: ["hdr", "hdr10plus"] },
    { id: "tt5463162", added: ["hdr"] },
    { id: "tt5580036", added: ["hdr"] },
    { id: "tt5580266", added: ["hdr"] },
    { id: "tt5606664", added: ["hdr"] },
    { id: "tt5649144", added: ["hdr"] },
    { id: "tt5726616", added: ["hdr"] },
    { id: "tt5727208", added: ["hdr"] },
    { id: "tt5950044", added: ["hdr"] },
    { id: "tt5971474", added: ["hdr"] },
    { id: "tt6019206", added: ["hdr"] },
    { id: "tt6105098", added: ["hdr"] },
    { id: "tt6139732", added: ["hdr"] },
    { id: "tt6146586", added: ["hdr"] },
    { id: "tt6155172", added: ["hdr"] },
    { id: "tt6166392", added: ["hdr"] },
    { id: "tt6263850", added: ["hdr"] },
    { id: "tt6264654", added: ["hdr"] },
    { id: "tt6320628", added: ["hdr"] },
    { id: "tt6334354", added: ["hdr"] },
    { id: "tt6467266", added: ["hdr"] },
    { id: "tt6499752", added: ["hdr"] },
    { id: "tt6571548", added: ["hdr"] },
    { id: "tt6644200", added: ["hdr"] },
    { id: "tt6710474", added: ["hdr"] },
    { id: "tt6718170", added: ["hdr"] },
    { id: "tt6723592", added: ["hdr"] },
    { id: "tt6751668", added: ["hdr"] },
    { id: "tt6791350", added: ["hdr"] },
    { id: "tt6857112", added: ["hdr"] },
    { id: "tt6933238", added: ["hdr"] },
    { id: "tt6966692", added: ["hdr"] },
    { id: "tt7125774", added: ["hdr"] },
    { id: "tt7146812", added: ["hdr"] },
    { id: "tt7160372", added: ["hdr"] },
    { id: "tt7286456", added: ["hdr"] },
    { id: "tt7349662", added: ["hdr"] },
    { id: "tt7395114", added: ["hdr"] },
    { id: "tt7405458", added: ["hdr"] },
    { id: "tt7466442", added: ["hdr"] },
    { id: "tt7504818", added: ["hdr"] },
    { id: "tt7510222", added: ["hdr"] },
    { id: "tt7668870", added: ["hdr"] },
    { id: "tt7740496", added: ["hdr"] },
    { id: "tt7772582", added: ["hdr", "hdr10plus"] },
    { id: "tt7888964", added: ["hdr"] },
    { id: "tt7979580", added: ["hdr"] },
    { id: "tt8041270", added: ["hdr"] },
    { id: "tt8151874", added: ["hdr", "hdr10plus"] },
    { id: "tt8332922", added: ["hdr"] },
    { id: "tt8367814", added: ["hdr"] },
    { id: "tt8368368", added: ["hdr"] },
    { id: "tt8404614", added: ["hdr"] },
    { id: "tt8503618", added: ["hdr"] },
    { id: "tt8579674", added: ["hdr"] },
    { id: "tt8589698", added: ["hdr"] },
    { id: "tt8652728", added: ["hdr"] },
    { id: "tt8721424", added: ["hdr"] },
    { id: "tt8772262", added: ["hdr"] },
    { id: "tt8820258", added: ["hdr"] },
    { id: "tt8847712", added: ["hdr"] },
    { id: "tt8999762", added: ["hdr"] },
    { id: "tt9071322", added: ["hdr"] },
    { id: "tt9114286", added: ["hdr"] },
    { id: "tt9179096", added: ["hdr"] },
    { id: "tt9185206", added: ["hdr"] },
    { id: "tt9218128", added: ["hdr"] },
    { id: "tt9362722", added: ["hdr"] },
    { id: "tt9376612", added: ["hdr"] },
    { id: "tt9411972", added: ["hdr"] },
    { id: "tt9580138", added: ["hdr"] },
    { id: "tt9603208", added: ["hdr"] },
    { id: "tt9603212", added: ["hdr"] },
    { id: "tt9620288", added: ["hdr"] },
    { id: "tt9686708", added: ["hdr"] },
    { id: "tt9764362", added: ["hdr"] },
    { id: "tt9770150", added: ["hdr"] },
    { id: "tt9784798", added: ["hdr"] },
];

export const REVIEWED832_PINS = {
  snapshotSha256: REVIEWED_SNAPSHOT_SHA256,
  snapshotBytes: REVIEWED_SNAPSHOT_BYTES,
  dbBaselineSha256: REVIEWED832_DB_BASELINE_SHA256,
  dbKeys: REVIEWED832_DB_KEYS,
  approved: REVIEWED832_APPROVED,
  // Phase-2 pins: the 105 phase-1 ids are excluded from this phase; declared
  // candidate qualities follow the shared KNOWN_QUALITIES allowlist (823 4K +
  // 9 FHD candidates observed); provenance entries carry the union scope.
  // The phase-1 provenance baseline pin binds the exact pre-phase-2
  // provenance file (105 entries, writer-canonical bytes): a fresh phase-2
  // write must preserve those entries verbatim, and an idempotent re-run
  // must find them intact. Phase-1 pins carry no such pin (behavior
  // unchanged there).
  excluded: REVIEWED_APPROVED.map((e) => e.id),
  allowedCandidateQualities: [...KNOWN_QUALITIES],
  scope: REVIEWED832_SCOPE,
  provenanceBaselineSha256: "c832d1755a340b27448314da868def1b81b2605cda6655a97f0f18614a9185f3",
  provenanceBaselineBytes: 67743,
}

export const REVIEWED_PINS = {
  snapshotSha256: REVIEWED_SNAPSHOT_SHA256,
  snapshotBytes: REVIEWED_SNAPSHOT_BYTES,
  dbBaselineSha256: REVIEWED_DB_BASELINE_SHA256,
  dbKeys: REVIEWED_DB_KEYS,
  approved: REVIEWED_APPROVED,
}

const REVIEWED_IMDB_RE = /^tt\d{7,10}$/

function reviewedExcluded(pins) {
  return Array.isArray(pins?.excluded) ? pins.excluded : REVIEWED_EXCLUDED
}

function reviewedAllowedQualities(pins) {
  return Array.isArray(pins?.allowedCandidateQualities) && pins.allowedCandidateQualities.length > 0
    ? pins.allowedCandidateQualities
    : ["4K"]
}

function reviewedScope(pins) {
  return typeof pins?.scope === "string" && pins.scope ? pins.scope : REVIEWED_SCOPE
}

function reviewedProvenanceBaselineSha(pins) {
  return typeof pins?.provenanceBaselineSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(pins.provenanceBaselineSha256)
    ? pins.provenanceBaselineSha256
    : null
}

function reviewedProvenanceBaselineBytes(pins) {
  return Number.isInteger(pins?.provenanceBaselineBytes) && pins.provenanceBaselineBytes > 0
    ? pins.provenanceBaselineBytes
    : null
}

// Canonical provenance text (sorted keys + trailing newline), exactly as the
// writer persists it. Used to verify an optional pinned provenance baseline.
function canonicalProvenanceText(provenance) {
  const sorted = {}
  for (const key of Object.keys(provenance).sort()) sorted[key] = provenance[key]
  return canonicalJson(sorted)
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

// Per-record revalidation against the pinned snapshot and the live DB entry.
// Never trusts cached added/decision blindly: the merge is recomputed and
// must equal the pinned delta exactly.
function reviewedRecordError(id, expectedAdded, record, dbEntry, opts = {}) {
  if (!REVIEWED_IMDB_RE.test(id)) return `invalid IMDb id ${id}`
  if (!isRecord(record)) return `missing snapshot record for ${id}`
  if (record.stage !== "done") return `snapshot record for ${id} is not done`
  if (record.classification !== "movie") return `snapshot record for ${id} is not a movie`
  if (record.decision !== "mutated") return `snapshot record for ${id} is not a mutation`
  if (record.movieResults !== 1 || record.tvResults !== 0) return `find gate mismatch for ${id}`
  if (typeof record.observedAt !== "string" || Number.isNaN(Date.parse(record.observedAt))) {
    return `invalid observedAt for ${id}`
  }
  if (!record.observedAt.startsWith("2026-10-21")) return `observedAt outside the Oct 21 2026 batch for ${id}`
  const candidate = record.candidate
  if (!isRecord(candidate)) return `missing candidate for ${id}`
  const allowedQualities =
    Array.isArray(opts.allowedCandidateQualities) && opts.allowedCandidateQualities.length > 0
      ? opts.allowedCandidateQualities
      : ["4K"]
  if (!allowedQualities.includes(candidate.quality)) {
    return `candidate quality ${candidate.quality} is outside the reviewed allowlist for ${id}`
  }
  if (!Array.isArray(candidate.formats) || !candidate.formats.every((f) => KNOWN_FORMAT_TOKENS.includes(f))) {
    return `candidate formats outside the known vocabulary for ${id}`
  }
  if (!Array.isArray(expectedAdded) || expectedAdded.length === 0) return `empty approved delta for ${id}`
  for (const token of expectedAdded) {
    if (!ALLOWED_MERGE_FORMATS.includes(token)) return `approved delta outside the merge allowlist for ${id}`
  }
  if (!isRecord(dbEntry)) return `${id} is not in the database (no new titles)`
  const merged = mergeAdditive(dbEntry, candidate)
  if (merged.decision !== "mutated") return `candidate for ${id} no longer merges cleanly`
  if (JSON.stringify(merged.added) !== JSON.stringify(expectedAdded)) {
    return `recomputed delta mismatch for ${id}`
  }
  return null
}

// Companion provenance entry: declared tuple + approved delta + observedAt +
// source torrentio + userAccepted + verification "declared" (NOT curated or
// MediaInfo-verified) + title-edition-union semantics. Allowlist-only: no raw
// names, filenames, hashes, urls, magnets, keys, tokens, or file paths. The
// snapshot content SHA binds the source batch (content hash, not a release
// hash); file paths and secret-adjacent values never enter the record.
function buildReviewedProvenanceEntry(id, record, expectedAdded, snapshotSha256, scope = REVIEWED_SCOPE) {
  return {
    source: "torrentio",
    observedAt: record.observedAt,
    declared: {
      quality: record.candidate.quality,
      formats: [...record.candidate.formats],
    },
    added: [...expectedAdded],
    decision: "mutated",
    classification: "movie",
    movieResults: 1,
    tvResults: 0,
    verification: "declared",
    userAccepted: true,
    semantics: "title-edition-union; no same-stream/playback/language guarantee",
    scope,
    snapshotSha256,
  }
}

function writeFileAtomicResult(target, text) {
  const tmpPath = `${target}.tmp-${process.pid}`
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(tmpPath, text, "utf-8")
    fs.renameSync(tmpPath, target)
    return null
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true })
    } catch {
      // ignore cleanup failure
    }
    return err?.message ?? String(err)
  }
}

/**
 * Offline reviewed apply: no network, no config read, no TMDB key. Reads the
 * pinned snapshot, revalidates every approved record (fail-closed on any
 * source/db/input change), then writes DB + companion provenance with rollback
 * on partial failure. A repeat run over the applied state is a verified
 * no-op (no writes). Never calls process.exit; the CLI maps the result.
 * @param {{ dbPath: string, provenancePath: string, checkpointPath: string }} paths
 * @param {{ snapshotSha256: string, snapshotBytes: number, dbBaselineSha256: string, dbKeys: number, approved: Array<{ id: string, added: string[] }>, excluded?: string[], allowedCandidateQualities?: string[], scope?: string, provenanceBaselineSha256?: string, provenanceBaselineBytes?: number }} [pins]
 * An optional provenanceBaselineSha256 (+ provenanceBaselineBytes) pins the
 * exact pre-apply provenance file (writer-canonical bytes). When present, a
 * fresh write requires that pinned provenance byte-intact (never silently
 * reset), re-checks it immediately before writing, and an idempotent re-run
 * verifies the preserved entries via reconstruction. Pins without it
 * (phase 1) keep the legacy behavior.
 * @returns {{ ok: true, applied: number, idempotent: boolean, dbSha256: string } | { ok: false, error: string }}
 */
export function runReviewedApply(paths, pins = REVIEWED_PINS) {
  const fail = (error) => ({ ok: false, error })
  try {
    const dbPath = path.resolve(paths.dbPath)
    const provenancePath = path.resolve(paths.provenancePath)
    const checkpointPath = path.resolve(paths.checkpointPath)
    if (dbPath === provenancePath || dbPath === checkpointPath || provenancePath === checkpointPath) {
      return fail("refusing reviewed apply: db/provenance/checkpoint paths overlap")
    }
    let checkpointBytes
    try {
      checkpointBytes = fs.readFileSync(checkpointPath)
    } catch {
      return fail(`cannot read snapshot ${checkpointPath}`)
    }
    if (checkpointBytes.length !== pins.snapshotBytes) {
      return fail(`snapshot byte size mismatch (expected ${pins.snapshotBytes}, saw ${checkpointBytes.length})`)
    }
    if (sha256Hex(checkpointBytes) !== pins.snapshotSha256) {
      return fail("snapshot SHA mismatch: source changed, refusing reviewed apply")
    }
    let checkpoint
    try {
      checkpoint = JSON.parse(checkpointBytes.toString("utf-8"))
    } catch {
      return fail("snapshot is not valid JSON")
    }
    if (!isRecord(checkpoint) || !isRecord(checkpoint.ids)) {
      return fail("snapshot has no ids record")
    }
    let dbBytes
    try {
      dbBytes = fs.readFileSync(dbPath)
    } catch {
      return fail(`cannot read database ${dbPath}`)
    }
    let localDb
    try {
      localDb = JSON.parse(dbBytes.toString("utf-8"))
    } catch {
      return fail("database is not valid JSON")
    }
    if (!isRecord(localDb)) return fail("database must be a JSON object of id -> {quality, formats}")
    const approved = pins.approved
    if (!Array.isArray(approved) || approved.length === 0) return fail("approved manifest is empty")
    const seen = new Set()
    for (const item of approved) {
      if (!isRecord(item) || typeof item.id !== "string" || !Array.isArray(item.added)) {
        return fail("malformed approved manifest entry")
      }
      if (seen.has(item.id)) return fail(`duplicate approved id ${item.id}`)
      seen.add(item.id)
      if (reviewedExcluded(pins).includes(item.id)) return fail(`approved id ${item.id} is on the excluded list`)
      if (!REVIEWED_IMDB_RE.test(item.id)) return fail(`invalid approved IMDb id ${item.id}`)
    }

    const dbSha = sha256Hex(dbBytes)
    const freshDb = dbSha === pins.dbBaselineSha256 && Object.keys(localDb).length === pins.dbKeys
    if (freshDb) {
      for (const { id, added } of approved) {
        const problem = reviewedRecordError(id, added, checkpoint.ids[id], localDb[id], {
          allowedCandidateQualities: reviewedAllowedQualities(pins),
        })
        if (problem) return fail(`refusing reviewed apply: ${problem}`)
      }
      const nextDb = { ...localDb }
      for (const { id } of approved) {
        const merged = mergeAdditive(localDb[id], checkpoint.ids[id].candidate)
        nextDb[id] = merged.entry
      }
      if (Object.keys(nextDb).length !== Object.keys(localDb).length) {
        return fail("refusing reviewed apply: entry count changed (no new titles allowed)")
      }
      const sortedDb = {}
      for (const key of Object.keys(nextDb).sort()) sortedDb[key] = nextDb[key]
      const nextDbText = canonicalJson(sortedDb)
      const updates = {}
      for (const { id, added } of approved) {
        updates[id] = buildReviewedProvenanceEntry(id, checkpoint.ids[id], added, pins.snapshotSha256, reviewedScope(pins))
      }
      let existingProvenance = {}
      let existingProvenanceText = null
      try {
        existingProvenanceText = fs.readFileSync(provenancePath, "utf-8")
      } catch {
        existingProvenanceText = null
      }
      if (existingProvenanceText !== null) {
        try {
          existingProvenance = JSON.parse(existingProvenanceText)
        } catch {
          return fail("existing provenance is not valid JSON")
        }
        if (!isRecord(existingProvenance)) return fail("existing provenance must be a JSON object")
      }
      // Optional pinned provenance baseline (phase 2): the pre-apply
      // provenance file must exist byte-intact. Never silently reset an
      // unreadable/invalid/drifted read to {} when the pin is present.
      const provBaselineSha = reviewedProvenanceBaselineSha(pins)
      const provBaselineBytes = reviewedProvenanceBaselineBytes(pins)
      if (provBaselineSha) {
        if (existingProvenanceText === null) {
          return fail("refusing reviewed apply: pinned prior provenance is missing")
        }
        const baselineText = canonicalProvenanceText(existingProvenance)
        if (sha256Hex(Buffer.from(baselineText, "utf-8")) !== provBaselineSha) {
          return fail("refusing reviewed apply: pinned prior provenance SHA mismatch")
        }
        if (provBaselineBytes !== null && Buffer.byteLength(baselineText, "utf-8") !== provBaselineBytes) {
          return fail("refusing reviewed apply: pinned prior provenance byte size mismatch")
        }
        if (existingProvenanceText !== baselineText) {
          return fail("refusing reviewed apply: pinned prior provenance is not byte-canonical")
        }
      }
      const nextProvenance = { ...existingProvenance, ...updates }
      const sortedProvenance = {}
      for (const key of Object.keys(nextProvenance).sort()) sortedProvenance[key] = nextProvenance[key]
      const nextProvenanceText = canonicalJson(sortedProvenance)
      const currentDbText = dbBytes.toString("utf-8")
      if (nextDbText === currentDbText && nextProvenanceText === (existingProvenanceText ?? canonicalJson({}))) {
        return { ok: true, applied: approved.length, idempotent: true, dbSha256: dbSha }
      }
      // Freshness guard: refuse when either input moved under us. With a
      // pinned provenance baseline, the provenance file is a third guarded
      // input: it must still be byte-identical at write time.
      let dbBytesNow
      let checkpointBytesNow
      let provenanceBytesNow = null
      try {
        dbBytesNow = fs.readFileSync(dbPath)
        checkpointBytesNow = fs.readFileSync(checkpointPath)
        if (provBaselineSha) provenanceBytesNow = fs.readFileSync(provenancePath, "utf-8")
      } catch {
        return fail("refusing reviewed apply: inputs unreadable at write time")
      }
      if (sha256Hex(dbBytesNow) !== dbSha || sha256Hex(checkpointBytesNow) !== pins.snapshotSha256) {
        return fail("refusing reviewed apply: inputs changed during validation")
      }
      if (provBaselineSha && provenanceBytesNow !== existingProvenanceText) {
        return fail("refusing reviewed apply: provenance changed during validation")
      }
      const dbError = writeFileAtomicResult(dbPath, nextDbText)
      if (dbError) return fail(`reviewed apply db write failed: ${dbError}`)
      const provError = writeFileAtomicResult(provenancePath, nextProvenanceText)
      if (provError) {
        try {
          fs.writeFileSync(dbPath, dbBytes)
        } catch {
          return fail(`reviewed apply provenance write failed (${provError}); DB ROLLBACK ALSO FAILED`)
        }
        return fail(`reviewed apply provenance write failed (${provError}); db rolled back`)
      }
      return {
        ok: true,
        applied: approved.length,
        idempotent: false,
        dbSha256: sha256Hex(Buffer.from(nextDbText, "utf-8")),
      }
    }

    // Non-baseline DB: succeed ONLY as a verified no-op when the full DB
    // state is exactly this batch (entire pre-image + pinned deltas,
    // baseline SHA intact) and the provenance already carries the
    // identical batch entries (plus the pinned preserved baseline when the
    // pins carry a provenance baseline pin).
    if (Object.keys(localDb).length !== pins.dbKeys) {
      return fail("database changed outside the reviewed batch (key count drift)")
    }
    for (const { id, added } of approved) {
      const record = checkpoint.ids[id]
      const entry = localDb[id]
      const problem = isRecord(record) ? null : `missing snapshot record for ${id}`
      if (problem) return fail(`refusing reviewed apply: ${problem}`)
      if (!isRecord(entry)) return fail(`refusing reviewed apply: ${id} missing from database`)
      if (typeof record.observedAt !== "string" || !record.observedAt.startsWith("2026-10-21")) {
        return fail(`refusing reviewed apply: observedAt outside the Oct 21 2026 batch for ${id}`)
      }
      if (record.classification !== "movie" || record.decision !== "mutated") {
        return fail(`refusing reviewed apply: snapshot record changed for ${id}`)
      }
      const currentFormats = Array.isArray(entry.formats) ? entry.formats : null
      if (!currentFormats || !added.every((t) => currentFormats.includes(t))) {
        return fail("database changed outside the reviewed batch (approved delta absent)")
      }
      const preImage = {
        ...entry,
        formats: currentFormats.filter((f) => !added.includes(f)),
      }
      const reMerged = mergeAdditive(preImage, record.candidate)
      if (JSON.stringify(reMerged.added) !== JSON.stringify(added)) {
        return fail(`database changed outside the reviewed batch (delta mismatch for ${id})`)
      }
      const noChange = mergeAdditive(entry, record.candidate)
      if (noChange.decision !== "nochange" || noChange.added.length !== 0) {
        return fail(`database changed outside the reviewed batch (unexpected pending delta for ${id})`)
      }
    }
    // Full-batch state verification: reconstruct the entire DB pre-image by
    // stripping ONLY each approved added delta (formats) while preserving
    // every other key/field verbatim, canonicalize exactly like the writer
    // (sorted keys + canonicalJson), and require the pinned baseline SHA.
    // The per-id subset checks above cannot see unrelated row/field drift
    // (including approved quality drift); this global check fails closed on
    // any of it. The production baseline is canonical sorted (verified:
    // stripping the applied deltas from the applied DB reproduces the
    // pinned baseline SHA), so no separate post-apply pin is needed.
    {
      const approvedById = new Map(approved.map(({ id, added }) => [id, added]))
      const preImageDb = {}
      for (const key of Object.keys(localDb)) {
        const entry = localDb[key]
        if (!isRecord(entry)) {
          return fail("database changed outside the reviewed batch (non-record entry)")
        }
        const added = approvedById.get(key)
        if (added) {
          if (!Array.isArray(entry.formats)) {
            return fail("database changed outside the reviewed batch (approved delta absent)")
          }
          preImageDb[key] = { ...entry, formats: entry.formats.filter((f) => !added.includes(f)) }
        } else {
          preImageDb[key] = entry
        }
      }
      const sortedPre = {}
      for (const key of Object.keys(preImageDb).sort()) sortedPre[key] = preImageDb[key]
      if (sha256Hex(Buffer.from(canonicalJson(sortedPre), "utf-8")) !== pins.dbBaselineSha256) {
        return fail("database changed outside the reviewed batch (baseline SHA mismatch)")
      }
    }
    let provenanceOnDisk
    try {
      provenanceOnDisk = JSON.parse(fs.readFileSync(provenancePath, "utf-8"))
    } catch {
      return fail("database changed outside the reviewed batch (provenance unreadable)")
    }
    if (!isRecord(provenanceOnDisk)) return fail("database changed outside the reviewed batch (provenance shape)")
    for (const { id, added } of approved) {
      const expected = buildReviewedProvenanceEntry(id, checkpoint.ids[id], added, pins.snapshotSha256, reviewedScope(pins))
      if (JSON.stringify(provenanceOnDisk[id]) !== JSON.stringify(expected)) {
        return fail(`database changed outside the reviewed batch (provenance drift for ${id})`)
      }
    }
    // Optional pinned provenance baseline (phase 2): the preserved prior
    // entries (everything outside this batch) must reconstruct the pinned
    // baseline exactly. Removing this batch's ids and canonicalizing exactly
    // like the writer (sorted keys + canonicalJson) must reproduce the
    // pinned full bytes SHA (+ byte size): any omission, change, or
    // reformat of the preserved entries fails closed. Pins without the pin
    // (phase 1) skip this check, behavior unchanged.
    {
      const batchIds = new Set(approved.map(({ id }) => id))
      const preserved = {}
      for (const key of Object.keys(provenanceOnDisk)) {
        if (!batchIds.has(key)) preserved[key] = provenanceOnDisk[key]
      }
      const preservedSha = reviewedProvenanceBaselineSha(pins)
      const preservedBytes = reviewedProvenanceBaselineBytes(pins)
      if (preservedSha) {
        const preservedText = canonicalProvenanceText(preserved)
        if (sha256Hex(Buffer.from(preservedText, "utf-8")) !== preservedSha) {
          return fail("database changed outside the reviewed batch (preserved provenance baseline mismatch)")
        }
        if (preservedBytes !== null && Buffer.byteLength(preservedText, "utf-8") !== preservedBytes) {
          return fail("database changed outside the reviewed batch (preserved provenance byte size mismatch)")
        }
      }
    }
    return { ok: true, applied: approved.length, idempotent: true, dbSha256: dbSha }
  } catch (err) {
    return { ok: false, error: `reviewed apply failed: ${err?.message ?? String(err)}` }
  }
}

// ---------------------------------------------------------------------------
// Local config (key names only in errors/logs; values never leave this file)
// ---------------------------------------------------------------------------

function parseDotEnvFile(filePath) {
  const out = {}
  let raw
  try {
    raw = fs.readFileSync(filePath, "utf-8")
  } catch {
    return out
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const eq = trimmed.indexOf("=")
    const name = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && value) out[name] = value
  }
  return out
}

function resolveTmdbKey(rootDir) {
  const names = ["PICTORIUM_TMDB_KEY", "POSTERIUM_TMDB_KEY", "TMDB_KEY", "TMDB_API_KEY"]
  for (const name of names) {
    if (process.env[name]) return process.env[name]
  }
  const local = parseDotEnvFile(path.join(rootDir, ".env.local"))
  for (const name of names) {
    if (local[name]) return local[name]
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Network (main flow only; never imported by unit tests for HTTP)
// ---------------------------------------------------------------------------

async function fetchJson(url, timeoutMs) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Pictorium/1.0" },
      signal: ctrl.signal,
    })
    return res
  } finally {
    clearTimeout(timer)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Rebuilds the allowlisted provenance entry from a stored checkpoint
// record (resume path). Returns null when the record lacks validated
// fields, so resume never invents evidence.
export function existingSnapshot(record) {
  if (!isRecord(record) || typeof record.observedAt !== "string") return null
  const candidate = isRecord(record.candidate)
    ? { quality: record.candidate.quality ?? null, formats: record.candidate.formats ?? [] }
    : { quality: null, formats: [] }
  return sanitizeProvenanceEntry({
    imdbId: null,
    observedAt: record.observedAt,
    candidate,
    decision: record.decision,
    classification: record.classification,
    movieResults: record.movieResults,
    tvResults: record.tvResults,
  })
}

function usage() {
  return [
    `${TOOL}: movie-only Torrentio enrichment for src/data/av-specs.json`,
    "",
    "Default (no flags) is a dry-run: validates args, prints the plan,",
    "performs NO network request and NO write.",
    "",
    "  node scripts/torrentio-av-import.mjs --help",
    "  node scripts/torrentio-av-import.mjs [--db <path>] [--limit <n>]",
    "  node scripts/torrentio-av-import.mjs --live [--only tt1,tt2] [--limit <n>]",
    "    [--spacing-ms <>=1000>] [--db <path>]",
    "    [--provenance <path>] [--checkpoint <path>]",
    "    [--torrentio-base <https-origin>]",
    "",
    "--apply disabled pending curated-data reconciliation (no merge path).",
    "Reviewed union offline apply (no network, fixed 832-id manifest):",
    "  node scripts/torrentio-av-import.mjs --apply-reviewed-union [--db <path>]",
    "    [--provenance <path>] [--checkpoint <path>]",
    "Reviewed offline apply (no network, fixed 105-id manifest):",
    "  node scripts/torrentio-av-import.mjs --apply-reviewed [--db <path>]",
    "    [--provenance <path>] [--checkpoint <path>]",
    "Checkpoint defaults outside the repo (os.tmpdir).",
  ].join("\n")
}

function checkpointPathFor(rootDir, override) {
  if (override) return path.resolve(override)
  return path.join(os.tmpdir(), "pictorium-torrentio-av-import", "checkpoint.json")
}

function isInsideRepo(rootDir, target) {
  const rel = path.relative(rootDir, path.resolve(target))
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function readJsonFile(label, filePath) {
  let raw
  try {
    raw = fs.readFileSync(filePath, "utf-8")
  } catch {
    console.error(`[${TOOL}] cannot read ${label} ${filePath}`)
    process.exit(2)
  }
  try {
    return JSON.parse(raw)
  } catch {
    console.error(`[${TOOL}] ${label} is not valid JSON: ${filePath}`)
    process.exit(2)
  }
}

function writeJsonAtomic(filePath, value) {
  const text = JSON.stringify(value, null, 2) + "\n"
  const tmpPath = `${filePath}.tmp-${process.pid}`
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(tmpPath, text, "utf-8")
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true })
    } catch {
      // ignore cleanup failure
    }
    console.error(`[${TOOL}] failed to write ${filePath}: ${err?.message ?? err}`)
    process.exit(2)
  }
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`[${TOOL}] ${parsed.error}`)
    console.error(usage())
    process.exit(2)
  }
  const opts = parsed.args
  if (opts.help) {
    console.log(usage())
    return
  }

  const dbPath = opts.db ? path.resolve(opts.db) : path.join(rootDir, "src", "data", "av-specs.json")
  const provenancePath = opts.provenance
    ? path.resolve(opts.provenance)
    : path.join(rootDir, "src", "data", "av-specs-torrentio-provenance.json")
  const checkpointPath = checkpointPathFor(rootDir, opts.checkpoint)
  if (isInsideRepo(rootDir, checkpointPath)) {
    console.error(`[${TOOL}] refusing checkpoint inside the repository (keep scratch outside): ${checkpointPath}`)
    process.exit(2)
  }

  // Reviewed offline apply: pinned snapshot + fixed manifest (105-id phase 1
  // or 832-id union phase 2), no network and no config read. Runs BEFORE any
  // live-stage code.
  if (opts.applyReviewed || opts.applyReviewedUnion) {
    const pins = opts.applyReviewedUnion ? REVIEWED832_PINS : REVIEWED_PINS
    const result = runReviewedApply(
      { dbPath, provenancePath, checkpointPath },
      pins,
    )
    if (!result.ok) {
      console.error(`[${TOOL}] ${result.error}`)
      process.exit(2)
    }
    if (result.idempotent) {
      console.log(`[${TOOL}] reviewed apply: already applied (${result.applied} ids verified, no writes)`)
    } else {
      console.log(`[${TOOL}] reviewed apply: ${result.applied} additive mutation(s) -> ${dbPath}`)
      console.log(`[${TOOL}] provenance ${result.applied} entrie(s) -> ${provenancePath}`)
    }
    console.log(`[${TOOL}] scope ${reviewedScope(pins)}; snapshot ${pins.snapshotSha256}`)
    console.log(`[${TOOL}] declared source stays 'torrentio' (never relabeled curated); playback or languages are NOT guaranteed.`)
    return
  }

  const localDb = readJsonFile("database", dbPath)
  if (!isRecord(localDb)) {
    console.error(`[${TOOL}] database must be a JSON object of id -> {quality, formats}`)
    process.exit(2)
  }
  const allIds = Object.keys(localDb).filter((id) => IMDb_RE.test(id))
  const skippedMalformed = Object.keys(localDb).length - allIds.length

  let selected = [...allIds].sort()
  if (opts.only) {
    const unknown = opts.only.filter((id) => !Object.prototype.hasOwnProperty.call(localDb, id))
    if (unknown.length > 0) {
      console.error(`[${TOOL}] --only ids not in the existing database (no new titles): ${unknown.slice(0, 5).join(",")}`)
      process.exit(2)
    }
    selected = opts.only.slice().sort()
  }
  if (opts.limit !== null) selected = selected.slice(0, opts.limit)

  if (!opts.live) {
    const estSeconds = Math.round((selected.length * 2 * opts.spacingMs) / 1000)
    console.log(`[${TOOL}] dry-run: no network, no writes.`);
    console.log(`[${TOOL}] database entries: ${allIds.length} (+${skippedMalformed} malformed skipped)`);
    console.log(`[${TOOL}] selected ids: ${selected.length} (spacing ${opts.spacingMs}ms, est ~${estSeconds}s live)`);
    console.log(`[${TOOL}] checkpoint: ${checkpointPath}`);
    console.log(`[${TOOL}] re-run with --live to classify via TMDB /find then fetch Torrentio movie streams.`);
    return
  }

  const tmdbKey = resolveTmdbKey(rootDir)
  if (!tmdbKey) {
    console.error(`[${TOOL}] STOP: no TMDB request key in established local config (PICTORIUM_TMDB_KEY / TMDB_KEY / TMDB_API_KEY); refusing to guess movie/type without the authoritative /find gate. No network attempted.`)
    process.exit(3)
  }
  const tmdbBase = (process.env.TMDB_BASE_URL || TMDB_DEFAULT_BASE).replace(/\/+$/, "")

  let checkpoint = { ids: {} }
  try {
    const raw = fs.readFileSync(checkpointPath, "utf-8")
    const prev = JSON.parse(raw)
    if (isRecord(prev) && isRecord(prev.ids)) checkpoint = { ids: prev.ids }
    else console.error(`[${TOOL}] checkpoint invalid, starting fresh (read-only so far)`)
  } catch {
    // No checkpoint yet: fresh run.
  }

  const counts = {
    total: selected.length,
    verifiedMovie: 0,
    series: 0,
    ambiguous: 0,
    unknown: 0,
    findFailed: 0,
    requested: 0,
    streamOk: 0,
    mutated: 0,
    nochange: 0,
    skipped: 0,
    errors: 0,
  }
  const pendingMutations = []
  const provenanceUpdates = {}
  let lastRequestAt = 0
  let stopped = false

  const throttle = async () => {
    const now = Date.now()
    const wait = opts.spacingMs - (now - lastRequestAt)
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()
  }

  const saveCheckpoint = () => {
    writeJsonAtomic(checkpointPath, checkpoint)
  }

  for (const imdbId of selected) {
    const existing = checkpoint.ids[imdbId]
    if (isRecord(existing) && existing.stage === "done") {
      if (existing.classification === "movie") counts.verifiedMovie += 1
      else if (existing.classification === "series") counts.series += 1
      else if (existing.classification === "ambiguous") counts.ambiguous += 1
      else if (existing.classification === "unknown") counts.unknown += 1
      if (existing.decision === "mutated") {
        counts.mutated += 1
        pendingMutations.push(imdbId)
      } else if (existing.decision === "nochange") {
        counts.nochange += 1
      } else {
        counts.skipped += 1
      }
      // Resume path: rebuild the provenance delta from the stored record
      // so a later --apply persists evidence for ids processed in an
      // earlier (proposal-only) run.
      if (isRecord(existingSnapshot(existing))) {
        provenanceUpdates[imdbId] = existingSnapshot(existing)
      }
      continue
    }

    // --- Authoritative type gate: TMDB /find BEFORE any /movie stream call.
    await throttle()
    let findJson = null
    let findStatus = 0
    let findStop = false
    try {
      const res = await fetchJson(
        `${tmdbBase}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id&api_key=${encodeURIComponent(tmdbKey)}`,
        FETCH_TIMEOUT_MS,
      )
      findStatus = res.status
      findStop = shouldStopOnHttpStatus(res.status, res.headers)
      if (!findStop && res.ok) findJson = await res.json()
    } catch {
      findJson = null
    }
    if (findStop) {
      console.error(`[${TOOL}] STOP: source restriction (status ${findStatus}); checkpoint saved, resume later. No alternate proxy attempted.`)
      saveCheckpoint()
      stopped = true
      break
    }
    if (!findJson) {
      counts.findFailed += 1
      counts.errors += 1
      continue
    }
    const movieResults = Array.isArray(findJson.movie_results) ? findJson.movie_results.length : 0
    const tvResults = Array.isArray(findJson.tv_results) ? findJson.tv_results.length : 0
    const classification = classifyFindResult(findJson)
    if (classification !== "movie") {
      if (classification === "series") counts.series += 1
      else if (classification === "ambiguous") counts.ambiguous += 1
      else counts.unknown += 1
      counts.skipped += 1
      const record = {
        stage: "done",
        classification,
        decision: `skip-${classification}`,
        movieResults,
        tvResults,
        observedAt: new Date().toISOString(),
      }
      checkpoint.ids[imdbId] = record
      provenanceUpdates[imdbId] = sanitizeProvenanceEntry({
        imdbId,
        observedAt: record.observedAt,
        candidate: { quality: null, formats: [] },
        decision: record.decision,
        classification,
        movieResults,
        tvResults,
      })
      saveCheckpoint()
      continue
    }
    counts.verifiedMovie += 1

    // --- Movie-only stream fetch.
    await throttle()
    counts.requested += 1
    let streams = null
    let streamStop = false
    let streamStatus = 0
    try {
      const res = await fetchJson(
        `${opts.torrentioBase}/stream/movie/${encodeURIComponent(imdbId)}.json`,
        FETCH_TIMEOUT_MS,
      )
      streamStatus = res.status
      streamStop = shouldStopOnHttpStatus(res.status, res.headers)
      if (!streamStop && res.ok) {
        const body = await res.json()
        streams = Array.isArray(body?.streams) ? body.streams : null
      }
    } catch {
      streams = null
    }
    if (streamStop) {
      console.error(`[${TOOL}] STOP: source restriction (status ${streamStatus}); checkpoint saved, resume later. No alternate proxy attempted.`)
      saveCheckpoint()
      stopped = true
      break
    }
    const observedAt = new Date().toISOString()
    if (!streams) {
      counts.errors += 1
      counts.skipped += 1
      const record = { stage: "done", classification, decision: "skip-fetch-failed", movieResults, tvResults, observedAt }
      checkpoint.ids[imdbId] = record
      provenanceUpdates[imdbId] = sanitizeProvenanceEntry({
        imdbId,
        observedAt,
        candidate: { quality: null, formats: [] },
        decision: record.decision,
        classification,
        movieResults,
        tvResults,
      })
      saveCheckpoint()
      continue
    }
    counts.streamOk += 1
    const candidate = selectCandidate(streams)
    if (!candidate) {
      counts.skipped += 1
      const record = { stage: "done", classification, decision: "skip-no-quality", movieResults, tvResults, observedAt }
      checkpoint.ids[imdbId] = record
      provenanceUpdates[imdbId] = sanitizeProvenanceEntry({
        imdbId,
        observedAt,
        candidate: { quality: null, formats: [] },
        decision: record.decision,
        classification,
        movieResults,
        tvResults,
      })
      saveCheckpoint()
      continue
    }
    const merged = mergeAdditive(localDb[imdbId], candidate)
    const record = {
      stage: "done",
      classification,
      decision: merged.decision,
      added: merged.added,
      movieResults,
      tvResults,
      candidate: { quality: candidate.quality, formats: candidate.formats },
      observedAt,
    }
    checkpoint.ids[imdbId] = record
    provenanceUpdates[imdbId] = sanitizeProvenanceEntry({
      imdbId,
      observedAt,
      candidate: { quality: candidate.quality, formats: candidate.formats },
      decision: merged.decision,
      classification,
      movieResults,
      tvResults,
    })
    if (merged.decision === "mutated") {
      counts.mutated += 1
      pendingMutations.push(imdbId)
    } else {
      counts.nochange += 1
    }
    saveCheckpoint()
    if (counts.requested % 25 === 0) {
      console.log(`[${TOOL}] progress requested=${counts.requested} movie=${counts.verifiedMovie} mutated=${counts.mutated} nochange=${counts.nochange} skipped=${counts.skipped} errors=${counts.errors}`)
    }
  }

  console.log(`[${TOOL}] live summary total=${counts.total} movie=${counts.verifiedMovie} series=${counts.series} ambiguous=${counts.ambiguous} unknown=${counts.unknown} findFailed=${counts.findFailed} requested=${counts.requested} streamOk=${counts.streamOk} proposed-mutated=${counts.mutated} (proposed deltas only, no DB writes) nochange=${counts.nochange} skipped=${counts.skipped} errors=${counts.errors}`)
  console.log(`[${TOOL}] checkpoint: ${checkpointPath}`)

  if (stopped) {
    console.error(`[${TOOL}] stopped early on source restriction; re-run with the same flags to resume. Nothing applied.`)
    process.exit(3)
  }

  if (!opts.apply) {
    console.log(`[${TOOL}] proposal only: no database writes (${pendingMutations.length} proposed additive delta(s) held in checkpoint/provenance; --apply disabled pending curated-data reconciliation).`)
    return
  }

  // Atomic apply (UNREACHABLE while --apply disabled pending curated-data
  // reconciliation at arg validation; kept for review, no alternate
  // writer/unlock introduced).
  const nextDb = { ...localDb }
  for (const imdbId of pendingMutations) {
    const rec = checkpoint.ids[imdbId]
    if (!isRecord(rec) || rec.decision !== "mutated" || !isRecord(rec.candidate)) {
      console.error(`[${TOOL}] refusing apply: checkpoint record for ${imdbId} is not a validated mutation`)
      process.exit(2)
    }
    const merged = mergeAdditive(localDb[imdbId], rec.candidate)
    if (merged.decision !== "mutated") {
      console.error(`[${TOOL}] refusing apply: candidate for ${imdbId} no longer merges cleanly`)
      process.exit(2)
    }
    nextDb[imdbId] = merged.entry
  }
  if (Object.keys(nextDb).length !== Object.keys(localDb).length) {
    console.error(`[${TOOL}] refusing apply: entry count changed (no new titles allowed)`)
    process.exit(2)
  }
  const sortedDb = {}
  for (const key of Object.keys(nextDb).sort()) sortedDb[key] = nextDb[key]
  writeJsonAtomic(dbPath, sortedDb)

  let provenance = {}
  try {
    provenance = JSON.parse(fs.readFileSync(provenancePath, "utf-8"))
    if (!isRecord(provenance)) provenance = {}
  } catch {
    provenance = {}
  }
  const nextProvenance = { ...provenance, ...provenanceUpdates }
  const sortedProv = {}
  for (const key of Object.keys(nextProvenance).sort()) sortedProv[key] = nextProvenance[key]
  writeJsonAtomic(provenancePath, sortedProv)

  console.log(`[${TOOL}] applied ${pendingMutations.length} additive mutation(s) -> ${dbPath}`)
  console.log(`[${TOOL}] provenance ${Object.keys(provenanceUpdates).length} entrie(s) -> ${provenancePath}`)
  console.log(`[${TOOL}] declared source stays 'torrentio' (never relabeled curated); playback or languages are NOT guaranteed.`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
