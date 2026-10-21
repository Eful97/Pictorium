#!/usr/bin/env node
// Torrentio MANUAL explicit insert for the local curated database.
//
// Scope (authorized task): insert ONE explicitly operator-authorized NEW title
// (Reacher series ONLY: IMDb tt9288030 / TMDB tv 108978) that the fixed
// 105+832 reviewed manifests cannot cover (they bind existing DB IDs only and
// stay fail-closed). No automatic fetching, no whole-DB augmentation, no new
// source providers, no live poster/Torrentio calls.
//
// Safety contract (mirrors torrentio-av-import.mjs / torrentio-series-sample.mjs):
// - Default invocation is a dry-run: args are validated, the plan is printed,
//   and NO write happens.
// - --apply performs the single insert. The script performs ZERO network I/O
//   on every path (no fetch import, no TMDB key read): the declared evidence
//   is operator-provided from already-authorized observations, recorded with
//   `verification: "declared"` (never curated/MediaInfo-verified).
// - New IDs ONLY: an already-present IMDb id is refused (no quality
//   overwrite, no downgrade, no re-merge). Historic 105+832 apply pins are
//   untouched and now fail closed on the post-insert DB baseline (their pins
//   bind the 1430-row bytes) — that is the guard working as designed.
// - Series inserts REQUIRE explicit episode evidence (season + episode +
//   aired air-date); the selection is recorded as "operator-selected-episode"
//   (never a median claim). Movies forbid season/episode keys.
// - Formats are bound to the shared merge allowlist (dv/hdr/hdr10plus/atmos);
//   imax is never inserted from declared streams (stays curated-only).
// - No raw responses, filenames, infohashes, magnets, urls, keys or tokens are
//   accepted, saved, logged or embedded in errors (no such flags exist).
// - DB + companion provenance are written writer-canonical (sorted keys +
//   trailing newline), exactly like the reviewed writer.
//
// Usage:
//   node scripts/torrentio-manual-insert.mjs --help
//   node scripts/torrentio-manual-insert.mjs --id <tt..> --tmdb-id <n> \
//     --type series --quality 4K --formats dv,hdr,hdr10plus,atmos \
//     --season 2 --episode 4 --air-date 2023-12-22 \
//     --observed-at 2026-10-21 --scope <slug> \
//     --samples '[{"quality":"4K","formats":[...]}]' \
//     [--db <path>] [--provenance <path>] [--apply]
//
// Pure helpers are exported for deterministic unit tests (no network, tmp fixtures).

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import {
  ALLOWED_MERGE_FORMATS,
  KNOWN_FORMAT_TOKENS,
  KNOWN_QUALITIES,
} from "./torrentio-av-import.mjs"

export const TOOL = "torrentio-manual-insert"
export const MANUAL_IMDB_RE = /^tt\d{7,10}$/
export const MANUAL_SCOPE_RE = /^[a-z0-9][a-z0-9\-_:,.+]*$/i
export const MANUAL_MAX_SCOPE_LEN = 80
// Fixed declared-source contract for this workflow: operator-provided
// Torrentio declared labels, user-accepted, never relabeled as verified.
export const MANUAL_SOURCE = "torrentio"
export const MANUAL_VERIFICATION = "declared"
export const MANUAL_ALGORITHM_SERIES = "operator-selected-episode"
// Identity provenance for manual inserts: both ids are operator-provided and
// format-validated only (never an independent TMDB /find verification, so no
// tvResults/movieResults counts are recorded here).
export const MANUAL_IDENTITY_METHOD = "operator-provided-imdb-tmdb"
export const MANUAL_SEMANTICS =
  "title-edition-union; separate-sample observations, no single-file tuple claim; no same-stream/playback/language guarantee"
export const MANUAL_OBSERVED_KIND = "prior-operator-observation-no-refetch"

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex")
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function sortedRecord(obj) {
  const out = {}
  for (const key of Object.keys(obj).sort()) out[key] = obj[key]
  return out
}

// Strict YYYY-MM-DD calendar validation (roundtrip): rejects impossible
// calendar dates that Date.parse normalizes (e.g. 2024-02-31 -> Mar 2).
export function isStrictCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const dt = new Date(Date.UTC(year, month - 1, day))
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
}

// Current UTC date as YYYY-MM-DD (injectable via `nowMs` for tests).
export function todayUtcIso(nowMs = Date.now()) {
  return new Date(nowMs).toISOString().slice(0, 10)
}

// realpath when the path exists, resolved-absolute fallback otherwise
// (mirrors the safeReal pattern in scripts/build-qc-proposals.mjs).
function safeReal(p) {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

// Resolve a possibly not-yet-existing store path via its nearest existing
// ancestor (realpath), so symlink/case aliases cannot smuggle one file over
// the other (mirrors resolveOutputReal in build-qc-proposals.mjs).
export function resolveStoreReal(storePath) {
  const abs = path.resolve(storePath)
  let dir = abs
  const tail = []
  while (!fs.existsSync(dir)) {
    tail.unshift(path.basename(dir))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  let base = safeReal(dir)
  return tail.length > 0 ? path.join(base, ...tail) : base
}

// True when both store paths name the same file: resolved/realpath equality
// (case-insensitive on Windows) or the same device+inode identity
// (hardlink alias) when both paths exist.
export function sameStorePath(a, b) {
  const ra = resolveStoreReal(a)
  const rb = resolveStoreReal(b)
  const equal =
    process.platform === "win32"
      ? ra.toLowerCase() === rb.toLowerCase()
      : ra === rb
  if (equal) return true
  try {
    const sa = fs.statSync(a)
    const sb = fs.statSync(b)
    return sa.dev === sb.dev && sa.ino === sb.ino
  } catch {
    return false
  }
}

// Best-effort removal of OUR OWN tmp file only; never touches user files.
function cleanupOwnTmp(tmpPath) {
  try {
    fs.unlinkSync(tmpPath)
  } catch {
    // best-effort
  }
}

// Atomic single-file write via tmp+rename. On failure the own tmp file is
// removed and the target is left untouched.
function writeAtomic(targetPath, text) {
  const tmpPath = `${targetPath}.tmp-${process.pid}`
  try {
    fs.writeFileSync(tmpPath, text, "utf-8")
  } catch (err) {
    cleanupOwnTmp(tmpPath)
    return { ok: false, error: err?.message ?? String(err) }
  }
  try {
    fs.renameSync(tmpPath, targetPath)
  } catch (err) {
    cleanupOwnTmp(tmpPath)
    return { ok: false, error: err?.message ?? String(err) }
  }
  return { ok: true }
}

// Accepts a strict calendar date or a full ISO datetime whose date part is
// strict; normalizes to the YYYY-MM-DD date part (no invented timing: a
// date-only input stays date-only).
export function normalizeObservedAt(value) {
  if (typeof value !== "string") return null
  const datePart = value.length > 10 ? value.slice(0, 10) : value
  if (!isStrictCalendarDate(datePart)) return null
  if (value.length > 10) {
    const t = Date.parse(value)
    if (Number.isNaN(t)) return null
    return value
  }
  return datePart
}

// ---------------------------------------------------------------------------
// Args (strict; unknown/duplicate flags rejected, dry-run by default)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ManualInsertArgs
 * @property {boolean} help
 * @property {boolean} apply
 * @property {string | null} id
 * @property {number | null} tmdbId
 * @property {string | null} type
 * @property {string | null} quality
 * @property {string[] | null} formats
 * @property {number | null} season
 * @property {number | null} episode
 * @property {string | null} airDate
 * @property {string | null} observedAt
 * @property {string | null} scope
 * @property {string | null} db
 * @property {string | null} provenance
 * @property {Array<{ quality: string, formats: string[] }> | null} samples
 */

/**
 * @param {string[]} argv
 * @returns {{ ok: true, args: ManualInsertArgs } | { ok: false, error: string }}
 */
export function parseManualArgs(argv) {
  const args = {
    help: false,
    apply: false,
    id: null,
    tmdbId: null,
    type: null,
    quality: null,
    formats: null,
    season: null,
    episode: null,
    airDate: null,
    observedAt: null,
    scope: null,
    db: null,
    provenance: null,
    samples: null,
  }
  const seen = new Set()
  const fail = (error) => ({ ok: false, error })
  const takeValue = (flag) => {
    if (seen.has(flag)) return { error: `duplicate flag ${flag}` }
    seen.add(flag)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith("--")) return { error: `missing value for ${flag}` }
    i += 2
    return { value }
  }
  let i = 0
  while (i < argv.length) {
    const flag = argv[i]
    if (flag === "--help" || flag === "-h") {
      if (seen.has(flag)) return fail(`duplicate flag ${flag}`)
      seen.add(flag)
      args.help = true
      i += 1
      continue
    }
    if (flag === "--apply") {
      if (seen.has(flag)) return fail("duplicate flag --apply")
      seen.add(flag)
      args.apply = true
      i += 1
      continue
    }
    if (flag === "--id" || flag === "--type" || flag === "--quality" || flag === "--scope") {
      const taken = takeValue(flag)
      if (taken.error) return fail(taken.error)
      if (flag === "--id") args.id = taken.value
      else if (flag === "--type") args.type = taken.value
      else if (flag === "--quality") args.quality = taken.value
      else args.scope = taken.value
      continue
    }
    if (flag === "--formats" || flag === "--observed-at" || flag === "--air-date") {
      const taken = takeValue(flag)
      if (taken.error) return fail(taken.error)
      if (flag === "--formats") {
        args.formats = taken.value.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0)
      } else if (flag === "--observed-at") args.observedAt = taken.value
      else args.airDate = taken.value
      continue
    }
    if (flag === "--tmdb-id" || flag === "--season" || flag === "--episode") {
      const taken = takeValue(flag)
      if (taken.error) return fail(taken.error)
      const n = Number(taken.value)
      if (!Number.isInteger(n)) return fail(`${flag} must be an integer (saw ${taken.value})`)
      if (flag === "--tmdb-id") args.tmdbId = n
      else if (flag === "--season") args.season = n
      else args.episode = n
      continue
    }
    if (flag === "--db" || flag === "--provenance") {
      const taken = takeValue(flag)
      if (taken.error) return fail(taken.error)
      if (flag === "--db") args.db = taken.value
      else args.provenance = taken.value
      continue
    }
    if (flag === "--samples") {
      const taken = takeValue(flag)
      if (taken.error) return fail(taken.error)
      let parsedSamples
      try {
        parsedSamples = JSON.parse(taken.value)
      } catch {
        return fail("--samples must be JSON (array of {quality, formats})")
      }
      args.samples = parsedSamples
      continue
    }
    return fail(`unknown flag ${flag}`)
  }
  return { ok: true, args }
}

// ---------------------------------------------------------------------------
// Validation (fail-closed; new IDs only, allowlisted enums, episode evidence)
// ---------------------------------------------------------------------------

/**
 * Validates an explicit manual insert spec. Returns null when valid, else the
 * refusal reason. Never touches disk or network. `opts.today` overrides the
 * current UTC date (YYYY-MM-DD) for deterministic tests; defaults to today.
 * @param {Record<string, unknown>} spec
 * @param {{ today?: string }} [opts]
 * @returns {string | null}
 */
export function validateManualInsert(spec, opts = {}) {
  if (!isRecord(spec)) return "spec must be an object"
  const { id, tmdbId, type, quality, formats, season, episode, airDate, observedAt, scope, samples } = spec
  if (typeof id !== "string" || !MANUAL_IMDB_RE.test(id)) return `invalid IMDb id ${String(id)} (expected tt + 7-10 digits)`
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return `invalid tmdb id ${String(tmdbId)} (positive integer required)`
  if (type !== "movie" && type !== "series") return `invalid type ${String(type)} (movie|series only)`
  if (!KNOWN_QUALITIES.includes(quality)) return `quality ${String(quality)} outside the known vocabulary`
  if (!Array.isArray(formats) || formats.length === 0) return "formats must be a non-empty comma list"
  if (new Set(formats).size !== formats.length) return "duplicate formats are not allowed"
  for (const token of formats) {
    if (!KNOWN_FORMAT_TOKENS.includes(token)) return `format ${String(token)} outside the known vocabulary`
    if (!ALLOWED_MERGE_FORMATS.includes(token)) {
      return `format ${String(token)} is not insertable from declared streams (imax stays curated-only)`
    }
  }
  if (typeof scope !== "string" || scope.length === 0 || scope.length > MANUAL_MAX_SCOPE_LEN) {
    return "scope must be a non-empty slug (max 80 chars)"
  }
  if (!MANUAL_SCOPE_RE.test(scope)) return `scope ${scope} is not an allowlisted slug`
  if (normalizeObservedAt(observedAt) === null) {
    return `observedAt ${String(observedAt)} must be a strict calendar date (YYYY-MM-DD, prior observation, no invented timing)`
  }
  const observedDate = String(normalizeObservedAt(observedAt)).slice(0, 10)
  const today =
    typeof opts.today === "string" && isStrictCalendarDate(opts.today)
      ? opts.today
      : todayUtcIso()
  // "Prior aired" is enforced, not just calendar-shaped: the observation
  // cannot be in the future relative to today (UTC).
  if (observedDate > today) {
    return `observedAt ${observedDate} is in the future (today ${today} UTC)`
  }
  if (type === "series") {
    if (!Number.isInteger(season) || season < 1) return "series inserts require an explicit aired --season (>= 1)"
    if (!Number.isInteger(episode) || episode < 1) return "series inserts require an explicit aired --episode (>= 1)"
    if (typeof airDate !== "string" || !isStrictCalendarDate(airDate)) {
      return `series inserts require an explicit aired --air-date (strict YYYY-MM-DD, saw ${String(airDate)})`
    }
    // No future-aired claims from operator data: the episode must have aired
    // on or before the observation date.
    if (airDate > observedDate) {
      return `air-date ${airDate} is after the observation date ${observedDate} (no future-aired claims)`
    }
  } else {
    if (season !== null && season !== undefined) return "movie inserts must not carry --season"
    if (episode !== null && episode !== undefined) return "movie inserts must not carry --episode"
    if (airDate !== null && airDate !== undefined) return "movie inserts must not carry --air-date"
  }
  // Optional pure-field per-sample observations (same episode): each sample
  // carries only enum quality + enum formats (no raw text), each sample
  // quality matches the declared quality, and the union of sample formats
  // (as a set) equals the declared formats.
  if (samples !== null && samples !== undefined) {
    if (!Array.isArray(samples) || samples.length === 0) {
      return "samples must be a non-empty array when provided"
    }
    const union = new Set()
    for (const sample of samples) {
      if (!isRecord(sample)) return "each sample must be an object {quality, formats}"
      const extraSampleKeys = Object.keys(sample).filter((k) => k !== "quality" && k !== "formats")
      if (extraSampleKeys.length > 0) {
        return `sample carries non-allowlisted keys (${extraSampleKeys.join(",")}); only quality/formats allowed`
      }
      if (!KNOWN_QUALITIES.includes(sample.quality)) {
        return `sample quality ${String(sample.quality)} outside the known vocabulary`
      }
      if (!Array.isArray(sample.formats) || sample.formats.length === 0) {
        return "each sample needs a non-empty formats list"
      }
      if (new Set(sample.formats).size !== sample.formats.length) {
        return "duplicate formats inside a sample are not allowed"
      }
      for (const token of sample.formats) {
        if (!KNOWN_FORMAT_TOKENS.includes(token)) {
          return `sample format ${String(token)} outside the known vocabulary`
        }
        if (!ALLOWED_MERGE_FORMATS.includes(token)) {
          return `sample format ${String(token)} is not insertable from declared streams (imax stays curated-only)`
        }
        union.add(token)
      }
      if (sample.quality !== quality) {
        return `sample quality ${String(sample.quality)} must match the declared quality ${String(quality)}`
      }
    }
    if (union.size !== formats.length || !formats.every((token) => union.has(token))) {
      return "sample union must equal the declared formats (set)"
    }
  }
  return null
}

/**
 * @typedef {object} ManualInsertSpec
 * @property {string} id
 * @property {number} tmdbId
 * @property {string} type
 * @property {string} quality
 * @property {string[]} formats
 * @property {number | null} [season]
 * @property {number | null} [episode]
 * @property {string | null} [airDate]
 * @property {string} observedAt
 * @property {string} scope
 * @property {Array<{ quality: string, formats: string[] }>} [samples]
 */

/**
 * @typedef {object} ManualProvenanceEntry
 * @property {string} source
 * @property {string | null} observedAt
 * @property {string} observedKind
 * @property {number} tmdbId
 * @property {string} identityMethod operator-provided-imdb-tmdb (both ids are
 * operator-provided and format-validated, never an independent TMDB /find
 * verification: no tvResults/movieResults counts are recorded here)
 * @property {{ quality: string, formats: string[] }} declared
 * @property {Array<{ quality: string, formats: string[] }>} [samples]
 * @property {string[]} added
 * @property {string} decision
 * @property {string} classification
 * @property {string} verification
 * @property {boolean} userAccepted
 * @property {string} semantics
 * @property {string} scope
 * @property {number} [season]
 * @property {number} [episode]
 * @property {string} [airDate]
 * @property {string} [algorithm]
 */

// Companion provenance entry for a validated manual insert. Allowlist-only:
// ids, enums, S/E, dates, counts — never raw names, filenames, hashes, urls,
// magnets, keys, or tokens.
/**
 * @param {ManualInsertSpec} spec
 * @returns {ManualProvenanceEntry}
 */
export function buildManualProvenanceEntry(spec) {
  const problem = validateManualInsert(spec)
  if (problem) throw new Error(`invalid manual insert spec: ${problem}`)
  const observedAt = normalizeObservedAt(spec.observedAt)
  const entry = {
    source: MANUAL_SOURCE,
    observedAt,
    observedKind: MANUAL_OBSERVED_KIND,
    tmdbId: spec.tmdbId,
    identityMethod: MANUAL_IDENTITY_METHOD,
    declared: { quality: spec.quality, formats: [...spec.formats] },
    added: [...spec.formats],
    decision: "inserted",
    classification: spec.type,
    verification: MANUAL_VERIFICATION,
    userAccepted: true,
    semantics: MANUAL_SEMANTICS,
    scope: spec.scope,
  }
  if (Array.isArray(spec.samples)) {
    entry.samples = spec.samples.map((sample) => ({
      quality: sample.quality,
      formats: [...sample.formats],
    }))
  }
  if (spec.type === "series") {
    entry.season = spec.season
    entry.episode = spec.episode
    entry.airDate = spec.airDate
    entry.algorithm = MANUAL_ALGORITHM_SERIES
  }
  return entry
}

// ---------------------------------------------------------------------------
// Apply (offline; new IDs only; canonical writes; no network/credentials)
// ---------------------------------------------------------------------------

/**
 * @param {{ dbPath: string, provenancePath: string }} paths
 * @param {ManualInsertSpec} spec validated insert spec
 * @param {{ dryRun?: boolean, apply?: boolean }} [opts]
 * @returns {{ ok: true, dryRun: boolean, applied: number, idempotent: false, dbSha256?: string, provenanceKeys?: number, dbKeys?: number, plan?: { id: string, dbEntry: { quality: string, formats: string[] }, provenanceEntry: ManualProvenanceEntry, dbKeysBefore: number } } | { ok: false, error: string }}
 */
export function runManualInsert(paths, spec, opts = {}) {
  const fail = (error) => ({ ok: false, error })
  const problem = validateManualInsert(spec)
  if (problem) return fail(`refusing manual insert: ${problem}`)
  // Pre-I/O alias guard: --db and --provenance must never name the same
  // file (exact, relative-alias, symlink, case-variant, or hardlink).
  // Without it, the provenance write would overwrite the database.
  if (sameStorePath(paths.dbPath, paths.provenancePath)) {
    return fail(
      "refusing manual insert: --db and --provenance resolve to the same file (alias/symlink/hardlink guard, no writes performed)",
    )
  }
  let dbBytes
  try {
    dbBytes = fs.readFileSync(paths.dbPath)
  } catch {
    return fail(`cannot read database ${paths.dbPath}`)
  }
  let db
  try {
    db = JSON.parse(dbBytes.toString("utf-8"))
  } catch {
    return fail("database is not valid JSON")
  }
  if (!isRecord(db)) return fail("database must be a JSON object of id -> {quality, formats}")
  if (Object.prototype.hasOwnProperty.call(db, spec.id)) {
    return fail(`refusing manual insert: ${spec.id} already exists (no overwrite/downgrade path)`)
  }
  const entry = buildManualProvenanceEntry(spec)
  const plan = {
    id: spec.id,
    dbEntry: { quality: spec.quality, formats: [...spec.formats] },
    provenanceEntry: entry,
    dbKeysBefore: Object.keys(db).length,
  }
  if (opts.dryRun !== false && !opts.apply) {
    return { ok: true, dryRun: true, applied: 0, idempotent: false, plan }
  }
  let existingProvenance = {}
  let existingProvenanceText = null
  try {
    existingProvenanceText = fs.readFileSync(paths.provenancePath, "utf-8")
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
    if (Object.prototype.hasOwnProperty.call(existingProvenance, spec.id)) {
      return fail(`refusing manual insert: provenance already has ${spec.id}`)
    }
  }
  const nextDb = sortedRecord({ ...db, [spec.id]: plan.dbEntry })
  const nextDbText = canonicalJson(nextDb)
  const nextProv = sortedRecord({ ...existingProvenance, [spec.id]: entry })
  const nextProvText = canonicalJson(nextProv)
  // Freshness re-read (minimal lost-update guard): both stores are re-read
  // immediately before the first write and byte-compared with what was
  // validated above. Any drift refuses with NO writes performed.
  let dbFresh
  try {
    dbFresh = fs.readFileSync(paths.dbPath)
  } catch {
    return fail(`cannot re-read database ${paths.dbPath} before write (no writes performed)`)
  }
  if (!dbFresh.equals(dbBytes)) {
    return fail("refusing manual insert: database changed since read (no writes performed)")
  }
  let provFresh = null
  try {
    provFresh = fs.readFileSync(paths.provenancePath, "utf-8")
  } catch {
    provFresh = null
  }
  if ((provFresh ?? null) !== (existingProvenanceText ?? null)) {
    return fail("refusing manual insert: provenance changed since read (no writes performed)")
  }
  // Two atomic renames with DB rollback when provenance persistence fails
  // (same contract as the reviewed writer).
  const dbBefore = dbBytes.toString("utf-8")
  const dbWrite = writeAtomic(paths.dbPath, nextDbText)
  if (!dbWrite.ok) {
    return fail(`database write failed: ${dbWrite.error}`)
  }
  const provWrite = writeAtomic(paths.provenancePath, nextProvText)
  if (!provWrite.ok) {
    let rolledBack = false
    try {
      fs.writeFileSync(paths.dbPath, dbBefore, "utf-8")
      rolledBack = fs.readFileSync(paths.dbPath, "utf-8") === dbBefore
    } catch {
      rolledBack = false
    }
    if (rolledBack) {
      return fail(`provenance write failed, database rolled back: ${provWrite.error}`)
    }
    return fail(`provenance write failed AND database rollback failed: ${provWrite.error}`)
  }
  return {
    ok: true,
    dryRun: false,
    applied: 1,
    idempotent: false,
    dbSha256: sha256Hex(Buffer.from(nextDbText, "utf-8")),
    provenanceKeys: Object.keys(nextProv).length,
    dbKeys: Object.keys(nextDb).length,
  }
}

function usage() {
  return [
    `${TOOL}: explicit operator insert of ONE new title (offline, no network)`,
    "",
    "Default (no flags) is a dry-run: validates args, prints the plan,",
    "performs NO write and NO network request.",
    "",
    "  node scripts/torrentio-manual-insert.mjs --id <tt..> --tmdb-id <n>",
    "    --type series --quality 4K --formats dv,hdr,hdr10plus,atmos",
    "    --season 2 --episode 4 --air-date 2023-12-22",
    "    --observed-at 2026-10-21 --scope <slug>",
    '    --samples \'[{"quality":"4K","formats":["dv","hdr","atmos"]},',
    '      {"quality":"4K","formats":["dv","hdr10plus"]}]\'',
    "    [--db <path>] [--provenance <path>] [--apply]",
    "",
    "New IDs only (existing ids refused, no overwrite/downgrade). Series",
    "inserts require explicit --season/--episode/--air-date (aired on or",
    "before --observed-at, never future-aired), recorded as",
    "operator-selected, never median. --observed-at is the prior observation",
    "date (strict YYYY-MM-DD, never in the future, never invented timing).",
    "--samples is optional pure-field per-sample evidence (same episode):",
    "only {quality, formats} enums, sample qualities match the declared",
    "quality, and the sample union (set) must equal the declared formats.",
  ].join("\n")
}

function defaultPaths(rootDir, override, fallback) {
  if (override) return path.resolve(override)
  return path.join(rootDir, fallback)
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const parsed = parseManualArgs(process.argv.slice(2))
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
  const required = ["id", "tmdbId", "type", "quality", "formats", "observedAt", "scope"]
  const missing = required.filter((k) => opts[k] === null || opts[k] === undefined)
  if (missing.length > 0) {
    console.error(`[${TOOL}] missing required flags: ${missing.map((k) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).join(", ")}`)
    console.error(usage())
    process.exit(2)
  }
  const spec = {
    id: opts.id,
    tmdbId: opts.tmdbId,
    type: opts.type,
    quality: opts.quality,
    formats: opts.formats,
    season: opts.season,
    episode: opts.episode,
    airDate: opts.airDate,
    observedAt: opts.observedAt,
    scope: opts.scope,
    samples: opts.samples,
  }
  const problem = validateManualInsert(spec)
  if (problem) {
    console.error(`[${TOOL}] ${problem}`)
    process.exit(2)
  }
  const dbPath = defaultPaths(rootDir, opts.db, path.join("src", "data", "av-specs.json"))
  const provenancePath = defaultPaths(
    rootDir,
    opts.provenance,
    path.join("src", "data", "av-specs-series-provenance.json"),
  )
  if (!opts.apply) {
    const res = runManualInsert({ dbPath, provenancePath }, spec)
    if (!res.ok) {
      console.error(`[${TOOL}] ${res.error}`)
      process.exit(3)
    }
    console.log(`[${TOOL}] dry-run: no writes, no network.`)
    console.log(`[${TOOL}] plan: insert ${res.plan.id} tmdb:${spec.tmdbId} (${spec.type})`)
    console.log(`[${TOOL}] plan: db ${JSON.stringify(res.plan.dbEntry)} (keys ${res.plan.dbKeysBefore} -> ${res.plan.dbKeysBefore + 1})`)
    console.log(`[${TOOL}] plan: provenance ${provenancePath} (+1 ${res.plan.id})`)
    console.log(`[${TOOL}] re-run with --apply to write.`)
    return
  }
  const res = runManualInsert({ dbPath, provenancePath }, spec, { apply: true })
  if (!res.ok) {
    console.error(`[${TOOL}] ${res.error}`)
    process.exit(3)
  }
  console.log(`[${TOOL}] applied 1 insert (${spec.id}); db keys ${res.dbKeys}, db sha ${res.dbSha256}`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
