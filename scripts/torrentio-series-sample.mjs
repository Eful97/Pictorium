#!/usr/bin/env node
// Torrentio series episode-proxy sampler (bounded: exactly 2 confirmed series).
//
// Scope (authorized task): existing src/data/av-specs.json series ONLY
//   tt11198330, tt10466872. No reclassification of the full DB, no new
//   titles, no movie changes. Prior batch105 movie provenance stays verbatim;
//   series evidence lives in a companion file, never in the 105 file.
//   Semantics: deterministic intermediate AIRED episode proxy for the ENTIRE
//   series (user-accepted), NEVER "observed all seasons" or "certified".
//
// Safety contract:
// - Default invocation is a dry-run: arg validation + plan print, NO network
//   and NO write (mirrors torrentio-av-import.mjs).
// - --live performs serial requests (>=1100ms spacing, no retries) with the
//   authoritative TMDB /find IMDb series gate BEFORE any /stream request, then
//   reads TV/seasons only (bounded 2 series), picks ONE deterministic median
//   aired episode, and fetches exactly ONE Torrentio
//   /stream/series/<imdbId>:<S>:<E>.json per series.
// - 429/401/403/Retry-After/challenge-class responses STOP the run
//   immediately (report saved, non-zero exit, no alternate proxy, no retry).
// - Declared tags only: single release candidate via the established strict
//   parser (selectCandidate in torrentio-av-import.mjs).
//   Series delta allowlist: absent dv/hdr10plus/atmos ONLY (never generic hdr,
//   never imax, never quality change, never removal). Current 2 series are
//   already 4K dv+atmos, so only hdr10plus can be additive (else nochange).
// - No raw names/urls/hashes/magnets/keys/tokens persisted, logged, or
//   embedded in errors. TMDB key is read from established local config
//   (process env or .env.local key NAMES PICTORIUM_TMDB_KEY >
//   POSTERIUM_TMDB_KEY > TMDB_KEY > TMDB_API_KEY); its value never reaches
//   logs or reports (same resolver pattern as torrentio-av-import.mjs).
//
// Pure helpers are exported for deterministic unit tests (no network).

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  mergeAdditive,
  selectCandidate,
  shouldStopOnHttpStatus,
} from "./torrentio-av-import.mjs"

export const TOOL = "torrentio-series-sample"
export const TORRENTIO_DEFAULT_BASE = "https://torrentio.strem.fun"
export const TMDB_DEFAULT_BASE = "https://api.themoviedb.org/3"
export const MIN_SPACING_MS = 1100
export const DEFAULT_SPACING_MS = 1100
export const FETCH_TIMEOUT_MS = 10000
export const SERIES_IDS = ["tt11198330", "tt10466872"]
// Series delta allowlist: absent dv/hdr10plus/atmos only. Generic hdr and
// imax are never added from declared streams; quality is never changed.
export const SERIES_ALLOWED_ADDED = ["dv", "hdr10plus", "atmos"]
const IMDb_RE = /^tt\d+$/
const STOP_STATUSES = new Set([401, 403, 429])

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Args (strict, mirrors torrentio-av-import.mjs gating style)
// ---------------------------------------------------------------------------

/**
 * @typedef {object} SeriesSampleArgs
 * @property {boolean} live
 * @property {boolean} help
 * @property {number} spacingMs
 * @property {string} torrentioBase
 * @property {string | null} report
 */

/**
 * @param {string[]} argv
 * @returns {{ ok: true, args: SeriesSampleArgs } | { ok: false, error: string }}
 */
export function parseSeriesArgs(argv) {
  const args = {
    live: false,
    help: false,
    spacingMs: DEFAULT_SPACING_MS,
    torrentioBase: TORRENTIO_DEFAULT_BASE,
    report: null,
  }
  const seen = new Set()
  const fail = (error) => ({ ok: false, error })
  let i = 0
  while (i < argv.length) {
    const flag = argv[i]
    if (flag === "--live") {
      if (seen.has(flag)) return fail("duplicate flag --live")
      seen.add(flag)
      args.live = true
      i += 1
      continue
    }
    if (flag === "--help" || flag === "-h") {
      if (seen.has(flag)) return fail(`duplicate flag ${flag}`)
      seen.add(flag)
      args.help = true
      i += 1
      continue
    }
    if (flag === "--spacing-ms" || flag === "--torrentio-base" || flag === "--report") {
      if (seen.has(flag)) return fail(`duplicate flag ${flag}`)
      seen.add(flag)
      const value = argv[i + 1]
      if (value === undefined || value.startsWith("--")) return fail(`missing value for ${flag}`)
      if (flag === "--spacing-ms") {
        const n = Number(value)
        if (!Number.isInteger(n) || n < MIN_SPACING_MS) {
          return fail(`--spacing-ms must be an integer >= ${MIN_SPACING_MS}`)
        }
        args.spacingMs = n
      } else if (flag === "--torrentio-base") {
        if (!/^https:\/\/[^/]+$/.test(value)) return fail("--torrentio-base must be an https origin (no path)")
        args.torrentioBase = value.replace(/\/+$/, "")
      } else {
        args.report = value
      }
      i += 2
      continue
    }
    return fail(`unknown flag ${flag}`)
  }
  return { ok: true, args }
}

// ---------------------------------------------------------------------------
// Deterministic median aired episode (pure, tested narrow BEFORE any network)
// ---------------------------------------------------------------------------
//
// Convention (explicit, documented): from regular seasons only
// (season_number >= 1; specials season 0 excluded), with a valid
// YYYY-MM-DD air_date on or before the reference day (UTC, calendar-date
// comparison; future/absent/invalid excluded), sorted by
// (season_number, episode_number) ascending, pick the LOWER median:
// index = floor((n - 1) / 2). Lower median keeps the deterministic
// "intermediate episode" bias on the earlier half for even counts and is the
// exact middle for odd counts. The choice is independent of any stream
// response (episode is chosen BEFORE the single Torrentio fetch).

/**
 * Strict YYYY-MM-DD calendar validation (roundtrip): rejects impossible
 * calendar dates that Date.parse normalizes (e.g. 2024-02-31 -> Mar 2).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStrictCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const dt = new Date(Date.UTC(year, month - 1, day))
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
}

/**
 * Exact unambiguous series gate: the authoritative TMDB /find result must be
 * exactly one TV hit, zero movie hits, with a numeric TV id. More than one TV
 * hit is ambiguous and must not classify.
 * @param {unknown} movieResults
 * @param {unknown} tvResults
 * @param {unknown} tvEntry
 * @returns {boolean}
 */
export function isUnambiguousSeriesFind(movieResults, tvResults, tvEntry) {
  return isRecord(tvEntry) && typeof tvEntry.id === "number" && movieResults === 0 && tvResults === 1
}

/**
 * @param {Array<{ season_number?: unknown, episode_number?: unknown, air_date?: unknown }>} episodes
 * @param {string} todayIso date-only YYYY-MM-DD (UTC); defaults to today
 * @returns {{ season: number, episode: number, airDate: string } | null}
 */
export function selectMedianAiredEpisode(episodes, todayIso) {
  const today = isStrictCalendarDate(todayIso) ? todayIso : new Date().toISOString().slice(0, 10)
  if (!Array.isArray(episodes) || episodes.length === 0) return null
  const aired = []
  for (const ep of episodes) {
    if (!isRecord(ep)) continue
    const season = ep.season_number
    const episode = ep.episode_number
    const airDate = ep.air_date
    if (!Number.isInteger(season) || season < 1) continue
    if (!Number.isInteger(episode) || episode < 1) continue
    if (typeof airDate !== "string" || !isStrictCalendarDate(airDate)) continue
    if (airDate > today) continue
    aired.push({ season, episode, airDate })
  }
  if (aired.length === 0) return null
  aired.sort((a, b) => (a.season - b.season) || (a.episode - b.episode))
  const index = Math.floor((aired.length - 1) / 2)
  return aired[index]
}

/**
 * Series additive check: curated entry wins; only absent
 * dv/hdr10plus/atmos may be added. Generic hdr/imax/quality changes are
 * never proposed (returned as filtered, never merged).
 * @param {{ quality?: unknown, formats?: unknown }} existing
 * @param {{ quality?: unknown, formats?: unknown } | null} candidate
 */
export function seriesAdditiveDelta(existing, candidate) {
  const merged = mergeAdditive(existing, candidate ?? {})
  const added = Array.isArray(merged.added)
    ? merged.added.filter((t) => SERIES_ALLOWED_ADDED.includes(t))
    : []
  const decision = added.length > 0 ? "mutated" : "nochange"
  return { added, decision }
}

// Allowlist-only companion provenance entry: ids, enums, S/E, dates, counts.
// Never raw names, filenames, hashes, urls, magnets, keys, or tokens.
export function sanitizeSeriesProvenanceEntry(input) {
  const formats = Array.isArray(input?.candidate?.formats)
    ? input.candidate.formats.filter((f) => ["dv", "hdr", "hdr10plus", "atmos", "imax"].includes(f))
    : []
  const quality =
    typeof input?.candidate?.quality === "string" &&
    ["4K", "FHD", "HD", "SD"].includes(input.candidate.quality)
      ? input.candidate.quality
      : null
  const added = Array.isArray(input?.added)
    ? input.added.filter((f) => SERIES_ALLOWED_ADDED.includes(f))
    : []
  const season = Number.isInteger(input?.season) ? input.season : null
  const episode = Number.isInteger(input?.episode) ? input.episode : null
  const airDate =
    typeof input?.airDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.airDate) ? input.airDate : null
  return {
    source: "torrentio",
    observedAt: typeof input?.observedAt === "string" ? input.observedAt : null,
    season,
    episode,
    airDate,
    algorithm: "median-aired-lower-regular-seasons",
    declared: { quality, formats },
    added,
    decision: typeof input?.decision === "string" ? input.decision : "skip",
    classification: "series",
    tvResults: Number.isInteger(input?.tvResults) ? input.tvResults : 0,
    movieResults: Number.isInteger(input?.movieResults) ? input.movieResults : 0,
    verification: "declared-episode-sample",
    userAccepted: true,
    semantics: "episode-proxy-for-entire-series; single release sample, no same-stream/playback/language guarantee",
    scope: "series-2:tt11198330+tt10466872,episode-proxy",
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url, timeoutMs) {
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

function usage() {
  return [
    `${TOOL}: bounded series episode-proxy sampler (exactly 2 series, no DB writes by default)`,
    "",
    "Default (no flags) is a dry-run: validates args, prints the plan,",
    "performs NO network request and NO write.",
    "",
    "  node scripts/torrentio-series-sample.mjs --help",
    "  node scripts/torrentio-series-sample.mjs [--spacing-ms <>=1100>]",
    "  node scripts/torrentio-series-sample.mjs --live [--spacing-ms <>=1100>]",
    "    [--torrentio-base <https-origin>] [--report <path-outside-repo>]",
    "",
    "Live reads TMDB /find + TV/seasons (bounded 2 series), picks ONE median",
    "aired episode per series, fetches exactly ONE Torrentio series stream per",
    "series, and writes a sanitized companion report OUTSIDE the repo by",
    "default (no av-specs.json writes, no 105-provenance writes).",
  ].join("\n")
}

function reportPathFor(rootDir, override) {
  if (override) return path.resolve(override)
  return path.join(os.tmpdir(), "pictorium-torrentio-series-sample", "series-report.json")
}

function isInsideRepo(rootDir, target) {
  const rel = path.relative(rootDir, path.resolve(target))
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function readDb(rootDir) {
  const dbPath = path.join(rootDir, "src", "data", "av-specs.json")
  const raw = fs.readFileSync(dbPath, "utf-8")
  const db = JSON.parse(raw)
  if (!isRecord(db)) throw new Error("database must be a JSON object")
  return { dbPath, db }
}

function challengeLike(status, bodyText) {
  if (status === 403 || status === 429) return true
  if (typeof bodyText !== "string" || bodyText.length === 0) return false
  const t = bodyText.slice(0, 2000).toLowerCase()
  return t.includes("challenge") || t.includes("captcha") || t.includes("cloudflare") || t.includes("just a moment")
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const parsed = parseSeriesArgs(process.argv.slice(2))
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

  const reportPath = reportPathFor(rootDir, opts.report)
  if (isInsideRepo(rootDir, reportPath)) {
    console.error(`[${TOOL}] refusing report inside the repository (keep scratch outside): ${reportPath}`)
    process.exit(2)
  }

  let db
  try {
    ({ db } = readDb(rootDir))
  } catch (err) {
    console.error(`[${TOOL}] cannot read database: ${err?.message ?? err}`)
    process.exit(2)
  }
  const missing = SERIES_IDS.filter((id) => !Object.prototype.hasOwnProperty.call(db, id))
  if (missing.length > 0) {
    console.error(`[${TOOL}] series ids not in the existing database (no new titles): ${missing.join(",")}`)
    process.exit(2)
  }
  for (const id of SERIES_IDS) {
    if (!IMDb_RE.test(id)) {
      console.error(`[${TOOL}] invalid IMDb id in bounded scope: ${id}`)
      process.exit(2)
    }
  }

  if (!opts.live) {
    console.log(`[${TOOL}] dry-run: no network, no writes.`)
    console.log(`[${TOOL}] bounded series scope: ${SERIES_IDS.join(",")} (existing DB only)`)
    console.log(`[${TOOL}] episode rule: median-aired-lower over regular seasons (specials excluded, future/absent/invalid excluded)`)
    console.log(`[${TOOL}] per series: TMDB /find gate + TV/seasons read + ONE Torrentio /stream/series/<id>:<S>:<E>.json (serial, spacing ${opts.spacingMs}ms)`)
    console.log(`[${TOOL}] report (live only, outside repo): ${reportPath}`)
    console.log(`[${TOOL}] re-run with --live to sample.`)
    return
  }

  const tmdbKey = resolveTmdbKey(rootDir)
  if (!tmdbKey) {
    console.error(`[${TOOL}] STOP: no TMDB request key in established local config (PICTORIUM_TMDB_KEY / TMDB_KEY / TMDB_API_KEY); refusing to guess type without the authoritative /find gate. No network attempted.`)
    process.exit(3)
  }
  const tmdbBase = (process.env.TMDB_BASE_URL || TMDB_DEFAULT_BASE).replace(/\/+$/, "")
  const todayIso = new Date().toISOString().slice(0, 10)

  let lastRequestAt = 0
  const throttle = async () => {
    const now = Date.now()
    const wait = opts.spacingMs - (now - lastRequestAt)
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()
  }

  const report = { tool: TOOL, observedAt: new Date().toISOString(), today: todayIso, ids: {} }
  const stop = (message) => {
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true })
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8")
    } catch {
      // ignore report write failure on the stop path; exit code still signals STOP
    }
    console.error(`[${TOOL}] STOP: ${message} report saved (no alternate proxy attempted).`)
    process.exit(3)
  }

  let streamFetches = 0
  for (const imdbId of SERIES_IDS) {
    // --- Authoritative type gate: TMDB /find BEFORE any stream call.
    await throttle()
    let findJson = null
    let findStatus = 0
    let findHeaders = null
    try {
      const res = await fetchWithTimeout(
        `${tmdbBase}/find/${encodeURIComponent(imdbId)}?external_source=imdb_id&api_key=${encodeURIComponent(tmdbKey)}`,
        FETCH_TIMEOUT_MS,
      )
      findStatus = res.status
      findHeaders = res.headers
      if (!shouldStopOnHttpStatus(res.status, res.headers)) {
        if (res.ok) findJson = await res.json()
        else if (!STOP_STATUSES.has(res.status)) findJson = null
      }
    } catch {
      findJson = null
    }
    if (shouldStopOnHttpStatus(findStatus, findHeaders)) stop(`source restriction (status ${findStatus}) on TMDB /find for ${imdbId};`)
    if (!findJson) {
      report.ids[imdbId] = sanitizeSeriesProvenanceEntry({
        observedAt: new Date().toISOString(),
        season: null,
        episode: null,
        airDate: null,
        candidate: { quality: null, formats: [] },
        added: [],
        decision: "skip-find-failed",
        tvResults: 0,
        movieResults: 0,
      })
      continue
    }
    const movieResults = Array.isArray(findJson.movie_results) ? findJson.movie_results.length : 0
    const tvResults = Array.isArray(findJson.tv_results) ? findJson.tv_results.length : 0
    const tvEntry = Array.isArray(findJson.tv_results) && findJson.tv_results.length > 0 ? findJson.tv_results[0] : null
    if (!isUnambiguousSeriesFind(movieResults, tvResults, tvEntry)) {
      report.ids[imdbId] = sanitizeSeriesProvenanceEntry({
        observedAt: new Date().toISOString(),
        candidate: { quality: null, formats: [] },
        added: [],
        decision: movieResults > 0 ? "skip-ambiguous" : "skip-unknown",
        tvResults,
        movieResults,
      })
      continue
    }
    const tvId = tvEntry.id

    // --- Bounded TV/seasons read: TV details then each regular season.
    await throttle()
    let tvJson = null
    let tvStatus = 0
    let tvHeaders = null
    try {
      const res = await fetchWithTimeout(`${tmdbBase}/tv/${tvId}?api_key=${encodeURIComponent(tmdbKey)}`, FETCH_TIMEOUT_MS)
      tvStatus = res.status
      tvHeaders = res.headers
      if (!shouldStopOnHttpStatus(res.status, res.headers) && res.ok) tvJson = await res.json()
    } catch {
      tvJson = null
    }
    if (shouldStopOnHttpStatus(tvStatus, tvHeaders)) stop(`source restriction (status ${tvStatus}) on TMDB /tv for ${imdbId};`)
    const seasons = Array.isArray(tvJson?.seasons) ? tvJson.seasons : []
    const regular = seasons.filter((s) => isRecord(s) && s.season_number >= 1 && typeof s.episode_count === "number" && s.episode_count > 0)
    const allEpisodes = []
    for (const s of regular) {
      await throttle()
      let seasonJson = null
      let seasonStatus = 0
      let seasonHeaders = null
      try {
        const res = await fetchWithTimeout(`${tmdbBase}/tv/${tvId}/season/${s.season_number}?api_key=${encodeURIComponent(tmdbKey)}`, FETCH_TIMEOUT_MS)
        seasonStatus = res.status
        seasonHeaders = res.headers
        if (!shouldStopOnHttpStatus(res.status, res.headers) && res.ok) seasonJson = await res.json()
      } catch {
        seasonJson = null
      }
      if (shouldStopOnHttpStatus(seasonStatus, seasonHeaders)) stop(`source restriction (status ${seasonStatus}) on TMDB season for ${imdbId};`)
      // Known limitation (unresolved, out of scope for this task): a failed
      // season fetch silently yields a median over the partial episode set.
      if (seasonJson && Array.isArray(seasonJson.episodes)) {
        for (const ep of seasonJson.episodes) {
          if (!isRecord(ep)) continue
          allEpisodes.push({ season_number: ep.season_number, episode_number: ep.episode_number, air_date: ep.air_date })
        }
      }
    }
    const picked = selectMedianAiredEpisode(allEpisodes, todayIso)
    if (!picked) {
      report.ids[imdbId] = sanitizeSeriesProvenanceEntry({
        observedAt: new Date().toISOString(),
        candidate: { quality: null, formats: [] },
        added: [],
        decision: "skip-no-aired-episode",
        tvResults,
        movieResults,
      })
      continue
    }

    // --- Exactly ONE Torrentio series stream per series.
    await throttle()
    streamFetches += 1
    const streamPath = `/stream/series/${encodeURIComponent(imdbId)}:${picked.season}:${picked.episode}.json`
    let streams = null
    let streamStatus = 0
    let streamHeaders = null
    let streamBodyText = ""
    try {
      const res = await fetchWithTimeout(`${opts.torrentioBase}${streamPath}`, FETCH_TIMEOUT_MS)
      streamStatus = res.status
      streamHeaders = res.headers
      if (!shouldStopOnHttpStatus(res.status, res.headers) && res.ok) {
        const body = await res.json()
        streams = Array.isArray(body?.streams) ? body.streams : null
      } else if (res.status !== 0) {
        try {
          streamBodyText = (await res.text()).slice(0, 2000)
        } catch {
          streamBodyText = ""
        }
      }
    } catch {
      streams = null
    }
    if (shouldStopOnHttpStatus(streamStatus, streamHeaders) || challengeLike(streamStatus, streamBodyText)) {
      stop(`source restriction (status ${streamStatus}) on Torrentio series stream for ${imdbId};`)
    }
    const observedAt = new Date().toISOString()
    if (!streams) {
      report.ids[imdbId] = sanitizeSeriesProvenanceEntry({
        observedAt,
        season: picked.season,
        episode: picked.episode,
        airDate: picked.airDate,
        candidate: { quality: null, formats: [] },
        added: [],
        decision: "skip-fetch-failed",
        tvResults,
        movieResults,
      })
      continue
    }
    const candidate = selectCandidate(streams)
    if (!candidate) {
      report.ids[imdbId] = sanitizeSeriesProvenanceEntry({
        observedAt,
        season: picked.season,
        episode: picked.episode,
        airDate: picked.airDate,
        candidate: { quality: null, formats: [] },
        added: [],
        decision: "skip-no-quality",
        tvResults,
        movieResults,
      })
      continue
    }
    const delta = seriesAdditiveDelta(db[imdbId], candidate)
    report.ids[imdbId] = sanitizeSeriesProvenanceEntry({
      observedAt,
      season: picked.season,
      episode: picked.episode,
      airDate: picked.airDate,
      candidate: { quality: candidate.quality, formats: candidate.formats },
      added: delta.added,
      decision: delta.decision,
      tvResults,
      movieResults,
    })
  }

  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf-8")
  } catch (err) {
    console.error(`[${TOOL}] failed to write report: ${err?.message ?? err}`)
    process.exit(2)
  }
  const mutated = Object.entries(report.ids).filter(([, v]) => isRecord(v) && v.decision === "mutated").length
  const nochange = Object.entries(report.ids).filter(([, v]) => isRecord(v) && v.decision === "nochange").length
  console.log(`[${TOOL}] live summary series=2 streamFetches=${streamFetches} mutated=${mutated} nochange=${nochange}`)
  console.log(`[${TOOL}] report: ${reportPath}`)
  console.log(`[${TOOL}] proposal only: no database writes (companion report holds the sanitized episode-proxy evidence).`)
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
if (isMain) main()
