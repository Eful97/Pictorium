/**
 * FlixPatrol availability-index discovery for opt-in streaming catalogs.
 *
 * Server-only (filesystem cache). Reads ONE fixed index document:
 * `https://raw.githubusercontent.com/0xConstant1/fp-crawler/main/catalogs/availability.json`
 * (`schema_version: 1`, `generated_at`, `regions[countrySlug][serviceId][movies|series|overall]`
 * variant ids; a section key present with an EMPTY variant array means the
 * base chart EXISTS). No untrusted URL fetching: the URL is constant, country
 * and service keys are matched against allowlists, never interpolated into a
 * request. Bounded parse (entry caps, string length caps, `__proto__` guards,
 * streaming byte cap with early cancel on overflow), bounded cache (12h fetchedAt TTL memory +
 * file in DATA_DIR, re-validated on disk read, awaited writes with
 * single-flight fetch coalescing), stale/error/unknown preserved distinctly
 * from known-missing:
 * - `ok`: freshly generated index (`generated_at` within 24h), `fpChart` is
 *   a real boolean per section.
 * - `stale`: cached document served OR freshly fetched but ancient/unknown
 *   `generated_at` — coverage flags are best-effort and marked stale. Index
 *   coverage alone is NEVER a chart-freshness guarantee (per-side chart-date
 *   freshness still applies at serving time).
 * - `error`: no document at all — `fpChart` is `"unknown"`, never false
 *   (unknown must not read as known-missing).
 *
 * "Index existence means chart coverage, not commercial availability": the
 * index lists fp-crawler chart variants, not subscription catalogs. The UI
 * contract must present it as chart coverage only.
 *
 * Mixed `overall` charts are NEVER split into movies/series here: when a
 * pair carries only `overall` coverage, both sections report unavailable
 * with `overallOnly: true` and an explicit capability explanation instead
 * of a blind movies-fallback (splitting would invent ranks). The generic
 * universe (Task F) additionally exposes overall charts as mixed `all`
 * catalogs (base + per-variant, order/rank/media type preserved per item).
 * Feed variant ids are collected alongside for the variant catalogs.
 */

import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import { REGIONS } from "@/lib/regions"
import {
  STREAMING_SERVICES,
  chartCountryInfo,
  genericIndexServiceId,
  genericServiceShortName,
  genericStreamingCatalogId,
  genericVariantLabel,
  parseChartCountrySlug,
  parseStreamingSourceMode,
  streamingAvailabilityServiceId,
  streamingCatalogId,
  streamingServiceShortName,
  STREAMING_SOURCE_LABEL_FP,
  STREAMING_SOURCE_LABEL_JW,
  jwFallbackSupported,
  type GenericStreamingSection,
  type StreamingSection,
  type StreamingService,
  type StreamingSourceMode,
} from "@/lib/streaming-catalogs"

const log = createLogger("streaming-availability")

export const STREAMING_AVAILABILITY_URL =
  "https://raw.githubusercontent.com/0xConstant1/fp-crawler/main/catalogs/availability.json"

/** Expected index schema version; anything else is rejected as malformed. */
const AVAILABILITY_SCHEMA_VERSION = 1

const INDEX_TTL_MS = 12 * 60 * 60 * 1000
const INDEX_TIMEOUT_MS = 15000
const INDEX_MAX_BYTES = 1024 * 1024

/**
 * Source-age honesty: the upstream index is regenerated daily. A document
 * whose `generated_at` is missing/invalid/in the future or older than this is
 * served as `stale` (best-effort coverage), never `ok` — index coverage alone
 * (FP chart listed) is NOT a chart-freshness guarantee (the per-side
 * chart-date freshness in `flixpatrol.ts` still applies at serving time).
 */
const INDEX_SOURCE_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Prototype-polluting keys are never trusted as index entries. */
function isSafeKey(k: string): boolean {
  return k !== "__proto__" && k !== "constructor" && k !== "prototype"
}

function isStrictBoolean(v: unknown): v is boolean {
  return typeof v === "boolean"
}

/**
 * Validate ONE persisted section-coverage record. Persisted disk entries
 * store ALREADY-NORMALIZED booleans (`{ movies: true, … }`) — never the raw
 * upstream variant forms (`[]`/`"it"`/records) that `parseAvailabilityIndex`
 * accepts. Only strict booleans validate; anything else (including the raw
 * source shapes) is rejected per entry so a persisted `true` can never
 * reload as `false` after a restart.
 */
function parsePersistedSectionCoverage(v: unknown): SectionCoverage | null {
  if (!isRecord(v)) return null
  const rec = v as Record<string, unknown>
  if (!isStrictBoolean(rec["movies"]) || !isStrictBoolean(rec["series"]) || !isStrictBoolean(rec["overall"])) return null
  return { movies: rec["movies"], series: rec["series"], overall: rec["overall"] }
}

/**
 * Bounded validation for the PERSISTED disk schema (normalized booleans),
 * separate from `parseAvailabilityIndex` (raw upstream variant forms).
 * Per-entry fail-closed: entries with non-boolean coverage are skipped, so
 * tampered/partial bytes can only remove coverage (unavailable), never
 * invent it. Caps and `__proto__` guards match the source parse.
 */
function parsePersistedAvailabilityCache(raw: unknown): AvailabilityCache | null {
  if (!isRecord(raw)) return null
  const rec = raw as Record<string, unknown>
  if (typeof rec["fetchedAt"] !== "number" || !Number.isFinite(rec["fetchedAt"])) return null
  if (rec["generatedAt"] !== null && rec["generatedAt"] !== undefined && typeof rec["generatedAt"] !== "string") return null
  const generatedAt = typeof rec["generatedAt"] === "string" ? rec["generatedAt"].slice(0, 64) : null
  if (!isRecord(rec["regions"])) return null
  const regions: Record<string, Record<string, SectionCoverage>> = {}
  for (const slug of Object.keys(rec["regions"] as Record<string, unknown>).slice(0, 300)) {
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 64 || !isSafeKey(slug)) continue
    const services = (rec["regions"] as Record<string, unknown>)[slug]
    if (!isRecord(services)) continue
    const out: Record<string, SectionCoverage> = {}
    for (const serviceId of Object.keys(services as Record<string, unknown>).slice(0, 64)) {
      if (typeof serviceId !== "string" || serviceId.length === 0 || serviceId.length > 64 || !isSafeKey(serviceId)) continue
      const cov = parsePersistedSectionCoverage((services as Record<string, unknown>)[serviceId])
      if (!cov) continue
      out[serviceId] = cov
    }
    regions[slug] = out
  }
  // Compat marker (Task F c3/M1): `variants` is REQUIRED in persisted
  // files. Pre-F disk files carry only normalized booleans
  // (`{ regions.italy.rai.series: true }`) with no `variants` key; accepting
  // them with `variants: {}` would make `hasBase()` read `true + []` as a
  // real base chart and advertise a fictitious base for variant-only
  // categories (verified: `italy.rai.series: ["it"]` — the real country doc
  // carries only `rai.series-it`, no `rai.series` base). A missing `variants`
  // key is a legacy snapshot: reject it (return null) so the loader forces a
  // bounded refetch instead of trusting a base that was never proven. When
  // the network is down the loader then reports honestly unknown (error, no
  // fake base) instead of a stale `true`. New snapshots always persist the
  // key (even as `{}`), so the fresh roundtrip is unaffected.
  if (rec["variants"] === undefined) return null
  if (!isRecord(rec["variants"])) return null
  const variants: Record<string, Record<string, SectionVariants>> = {}
  for (const slug of Object.keys(rec["variants"] as Record<string, unknown>).slice(0, 300)) {
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 64 || !isSafeKey(slug)) continue
    const services = (rec["variants"] as Record<string, unknown>)[slug]
    if (!isRecord(services)) continue
    const out: Record<string, SectionVariants> = {}
    for (const serviceId of Object.keys(services as Record<string, unknown>).slice(0, 64)) {
      if (typeof serviceId !== "string" || serviceId.length === 0 || serviceId.length > 64 || !isSafeKey(serviceId)) continue
      const vars = parsePersistedSectionVariants((services as Record<string, unknown>)[serviceId])
      if (!vars) continue
      if (vars.movies.length + vars.series.length + vars.overall.length === 0) continue
      out[serviceId] = vars
    }
    if (Object.keys(out).length > 0) variants[slug] = out
  }
  return { fetchedAt: rec["fetchedAt"] as number, generatedAt, regions, variants }
}

const CACHE_FILE = (() => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.accessSync(DATA_DIR, fs.constants.W_OK)
    return path.join(DATA_DIR, "streaming-availability.json")
  } catch {
    return path.join(os.tmpdir(), "pictorium-streaming-availability.json")
  }
})()

type SectionCoverage = { movies: boolean; series: boolean; overall: boolean }

/**
 * Feed variant ids per section (Task F generic universe): the non-empty
 * variant arrays carried by the upstream index (e.g. `series: ["it"]`,
 * `overall: ["amazon-channels"]`). Sparse — only pairs with at least one
 * non-empty variant array appear here. Sorted for determinism. Bounded like
 * the coverage parse (≤64 ids, ≤128 chars each); anything else is dropped,
 * never invented.
 */
export interface SectionVariants {
  readonly movies: readonly string[]
  readonly series: readonly string[]
  readonly overall: readonly string[]
}

function parsePersistedSectionVariants(v: unknown): SectionVariants | null {
  if (!isRecord(v)) return null
  const rec = v as Record<string, unknown>
  const out: Record<string, readonly string[]> = {}
  for (const section of ["movies", "series", "overall"] as const) {
    const raw = rec[section]
    if (!Array.isArray(raw) || raw.length > 64) return null
    const ids: string[] = []
    for (const e of raw) {
      if (typeof e !== "string" || e.length === 0 || e.length > 128) return null
      ids.push(e)
    }
    out[section] = ids
  }
  return { movies: out["movies"], series: out["series"], overall: out["overall"] }
}

export type StreamingIndexStatus = "ok" | "stale" | "error"

interface AvailabilityCache {
  readonly fetchedAt: number
  readonly generatedAt: string | null
  /** countrySlug -> serviceId -> section coverage (allowlisted at read). */
  readonly regions: Record<string, Record<string, SectionCoverage>>
  /**
   * countrySlug -> serviceId -> feed variant ids per section (Task F).
   * Sparse: only pairs with non-empty variant arrays. Absent in pre-F disk
   * files (defaults to empty there).
   */
  readonly variants: Record<string, Record<string, SectionVariants>>
}

let memCache: AvailabilityCache | null = null

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

/**
 * Bounded parse of the fixed index document (real upstream shape:
 * `{ schema_version: 1, generated_at, regions[countrySlug][serviceId] }`,
 * where each section (`movies`/`series`/`overall`) carries variant ids).
 * Presence of a section key means chart COVERAGE exists — an EMPTY variant
 * array (`[]`) proves the BASE chart (verified against the live index:
 * `italy.netflix.movies: []`, `italy.paramount.overall: []`,
 * `italy.crunchyroll.overall: []`). A NON-EMPTY variant array (`["it"]`)
 * proves ONLY the listed variant charts: the base `catalog_id` may not exist
 * upstream (verified: `italy.rai.series: ["it"]` while the country doc carries
 * only `rai.series-it`, no `rai.series`). Base emission is decided downstream
 * (`buildGenericStreamingChoices` emits exact variant choices only for those
 * sections), never here. A missing key means no chart. Caps: 300
 * country slugs, 64 service ids per country, key/value length bounds.
 * Feed variant ids are collected alongside for the generic universe
 * (Task F) without changing base-chart semantics. Anything malformed
 * (wrong `schema_version`, non-object regions) → null (error, never
 * partial trust).
 */
export function parseAvailabilityIndex(doc: unknown): Omit<AvailabilityCache, "fetchedAt"> | null {
  if (!isRecord(doc)) return null
  if (doc.schema_version !== AVAILABILITY_SCHEMA_VERSION) return null
  const generatedAt = typeof doc.generated_at === "string" ? doc.generated_at.slice(0, 64) : null
  if (!isRecord(doc.regions)) return null
  const regions: Record<string, Record<string, SectionCoverage>> = {}
  const variants: Record<string, Record<string, SectionVariants>> = {}
  const countrySlugs = Object.keys(doc.regions).slice(0, 300)
  for (const slug of countrySlugs) {
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 64) continue
    if (!isSafeKey(slug)) continue
    const services = (doc.regions as Record<string, unknown>)[slug]
    if (!isRecord(services)) continue
    const out: Record<string, SectionCoverage> = {}
    for (const serviceId of Object.keys(services).slice(0, 64)) {
      if (typeof serviceId !== "string" || serviceId.length === 0 || serviceId.length > 64) continue
      if (!isSafeKey(serviceId)) continue
      const sections = (services as Record<string, unknown>)[serviceId]
      if (!isRecord(sections)) continue
      const has = (v: unknown): boolean => {
        // Coverage existence: the key is present at all. Whether a BASE
        // chart exists is decided downstream from the variant list (empty =
        // base, non-empty = variant-only).
        if (v === undefined) return false
        if (Array.isArray(v)) {
          if (v.length === 0) return true
          return v.length <= 64 && v.every((e) => typeof e === "string" && e.length > 0 && e.length <= 128)
        }
        if (typeof v === "string") return v.length > 0 && v.length <= 128
        if (isRecord(v)) {
          const keys = Object.keys(v).slice(0, 64)
          return keys.length > 0 && keys.every((k) => typeof k === "string" && k.length > 0 && k.length <= 128 && isSafeKey(k))
        }
        return false
      }
      const rec = sections as Record<string, unknown>
      out[serviceId] = {
        movies: has(rec["movies"]),
        series: has(rec["series"]),
        overall: has(rec["overall"]),
      }
      // Feed variant ids (Task F): non-empty ARRAY forms only — the variant
      // chart catalogs (`<service>.<cat>-<variant>`) the generic universe
      // serves. String/record shapes count as coverage (base chart exists)
      // but carry no enumerable variant id, so they contribute none here.
      const list = (v: unknown): readonly string[] => {
        if (!Array.isArray(v) || v.length === 0 || v.length > 64) return []
        const ids: string[] = []
        for (const e of v) {
          if (typeof e !== "string") continue
          const t = e.trim().toLowerCase()
          if (t.length === 0 || t.length > 64 || t.includes("--")) continue
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(t)) continue
          if (t === "__proto__" || t === "constructor" || t === "prototype") continue
          if (!ids.includes(t)) ids.push(t)
        }
        return ids.sort()
      }
      const vars: SectionVariants = {
        movies: list(rec["movies"]),
        series: list(rec["series"]),
        overall: list(rec["overall"]),
      }
      if (vars.movies.length + vars.series.length + vars.overall.length > 0) {
        if (!variants[slug]) variants[slug] = {}
        variants[slug][serviceId] = vars
      }
    }
    regions[slug] = out
  }
  return { generatedAt, regions, variants }
}

/** True when the upstream `generated_at` proves a fresh source document. */
function isSourceAgeFresh(generatedAt: string | null, nowMs: number): boolean {
  if (!generatedAt) return false
  const t = Date.parse(generatedAt)
  if (!Number.isFinite(t)) return false
  if (t > nowMs + 60_000) return false
  return nowMs - t <= INDEX_SOURCE_MAX_AGE_MS
}

/**
 * Bounded streaming body reader (bytes, not UTF-16 chars). Reads
 * `res.body` chunk-by-chunk with a hard byte cap; on overflow the reader is
 * cancelled and NO partial body is returned (callers treat overflow as a
 * failed fetch, never parse truncated bytes as a complete index). A declared
 * `content-length` above the cap short-circuits before any read. Mid-body
 * read failures also resolve to failure. Falls back to a single buffered
 * read with the same byte cap only when no web-stream body exists.
 */
async function readBoundedResponseText(
  res: Response,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  try {
    const declared = res.headers?.get?.("content-length")
    if (declared !== null && declared !== undefined && declared !== "") {
      const n = Number(declared)
      if (Number.isFinite(n) && n > maxBytes) return { ok: false, reason: "oversize-declared" }
    }
    const stream = res.body?.getReader?.() ?? null
    if (!stream) {
      const text = await res.text()
      if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, reason: "oversize" }
      return { ok: true, text }
    }
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      let step: ReadableStreamReadResult<Uint8Array>
      try {
        step = await stream.read()
      } catch {
        try {
          await stream.cancel()
        } catch {
          // ignore cancel failure
        }
        return { ok: false, reason: "read-error" }
      }
      if (step.done) break
      const value = step.value as Uint8Array | string | undefined
      const chunk = typeof value === "string" ? new TextEncoder().encode(value) : value
      if (!chunk) continue
      total += chunk.length
      if (total > maxBytes) {
        try {
          await stream.cancel()
        } catch {
          // ignore cancel failure
        }
        return { ok: false, reason: "oversize" }
      }
      chunks.push(chunk)
    }
    const merged = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      merged.set(c, off)
      off += c.length
    }
    return { ok: true, text: new TextDecoder().decode(merged) }
  } catch {
    return { ok: false, reason: "read-error" }
  }
}

async function fetchIndexDocument(): Promise<Omit<AvailabilityCache, "fetchedAt"> | null> {
  try {
    const res = await fetch(STREAMING_AVAILABILITY_URL, { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) })
    if (!res.ok) return null
    // Bounded read (fixed-URL policy): the byte cap applies to the stream
    // itself — a missing or lying content-length can never cause an
    // unbounded buffering (early cancel, never a truncated parse).
    const bounded = await readBoundedResponseText(res, INDEX_MAX_BYTES)
    if (!bounded.ok) return null
    try {
      return parseAvailabilityIndex(JSON.parse(bounded.text))
    } catch {
      return null
    }
  } catch (e) {
    log.warn("streaming availability fetch failed", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

// Single-flight fetch coalescing: concurrent callers share one upstream read.
let fetchInflight: Promise<Omit<AvailabilityCache, "fetchedAt"> | null> | null = null
function fetchIndexDocumentCoalesced(): Promise<Omit<AvailabilityCache, "fetchedAt"> | null> {
  if (!fetchInflight) {
    fetchInflight = fetchIndexDocument().finally(() => {
      fetchInflight = null
    })
  }
  return fetchInflight
}

function loadDiskCache(): AvailabilityCache | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null
    const stat = fs.statSync(CACHE_FILE)
    if (stat.size > INDEX_MAX_BYTES) return null
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as AvailabilityCache
    // Re-validate the persisted regions against the PERSISTED schema
    // (normalized booleans) — never through the raw-variant source parse,
    // which rejects booleans and would reload every persisted `true` as
    // `false` after a restart.
    return parsePersistedAvailabilityCache(raw)
  } catch (e) {
    log.warn("streaming availability disk cache unreadable", { error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

async function saveDiskCache(data: AvailabilityCache): Promise<void> {
  try {
    // Reject oversize instead of truncating: a `.slice()`-truncated payload
    // is invalid JSON and would poison the next restart's disk read. The
    // in-memory entry keeps serving; the disk simply stays at its previous
    // (valid) state.
    const serialized = JSON.stringify(data)
    if (new TextEncoder().encode(serialized).length > INDEX_MAX_BYTES) {
      log.warn("streaming availability disk cache oversized, skipping write")
      return
    }
    await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true })
    const tmp = `${CACHE_FILE}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await fsp.writeFile(tmp, serialized, "utf-8")
    try {
      await fsp.rename(tmp, CACHE_FILE)
    } catch {
      await fsp.copyFile(tmp, CACHE_FILE)
      await fsp.unlink(tmp).catch(() => {})
    }
  } catch (e) {
    log.warn("streaming availability disk cache write failed", { error: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * Load the index (memory → disk → network, 12h fetchedAt TTL). Never throws:
 * transport or parse failure resolves to `stale` (cached document) or
 * `error` (no document). Source-age honesty: a document whose `generated_at`
 * is missing/invalid/future or older than INDEX_SOURCE_MAX_AGE_MS reports
 * `stale` even when freshly fetched — index coverage is chart coverage, never
 * a chart-freshness guarantee. Persistence is awaited inside the owning
 * request lifecycle (no detached writes); concurrent callers share one
 * upstream fetch. No mass provider probing — this is the single fetch.
 */
export async function loadStreamingAvailability(): Promise<{ status: StreamingIndexStatus } & AvailabilityCache> {
  const now = Date.now()
  const statusFor = (doc: AvailabilityCache): StreamingIndexStatus =>
    isSourceAgeFresh(doc.generatedAt, now) ? "ok" : "stale"
  if (memCache && now - memCache.fetchedAt <= INDEX_TTL_MS) {
    return { status: statusFor(memCache), ...memCache }
  }
  if (!memCache) memCache = loadDiskCache()
  if (memCache && now - memCache.fetchedAt <= INDEX_TTL_MS) {
    return { status: statusFor(memCache), ...memCache }
  }
  const fresh = await fetchIndexDocumentCoalesced()
  if (fresh) {
    memCache = { ...fresh, fetchedAt: now }
    await saveDiskCache(memCache)
    return { status: statusFor(memCache), ...memCache }
  }
  if (memCache) return { status: "stale", ...memCache }
  return { status: "error", fetchedAt: 0, generatedAt: null, regions: {}, variants: {} }
}

/** Test hook: reset the in-memory index cache (and any in-flight fetch). */
export function __clearStreamingAvailabilityCache(): void {
  memCache = null
  fetchInflight = null
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE)
  } catch {
    // best-effort test isolation only
  }
}

/**
 * Test hook: drop ONLY the in-memory index (and any in-flight fetch) while
 * preserving the disk file — simulates a process restart against the same
 * DATA_DIR. Unlike `__clearStreamingAvailabilityCache` (which also deletes
 * the disk file), this keeps the persisted snapshot so disk-reload
 * roundtrips can be verified.
 */
export function __clearStreamingAvailabilityMemory(): void {
  memCache = null
  fetchInflight = null
}

export type StreamingPotentialSource = "flixpatrol" | "justwatch" | "unavailable"

export interface StreamingChoiceAvailability {
  readonly service: StreamingService
  readonly serviceName: string
  readonly country: string
  readonly countryFlag: string
  readonly countryLabel: string
  readonly countryFlixSlug: string
  readonly section: StreamingSection
  readonly catalogId: string
  /** FP chart coverage: true/false when the index is known, "unknown" on index error. */
  readonly fpChart: boolean | "unknown"
  readonly jwFallback: boolean
  readonly potential: StreamingPotentialSource
  /** Honest display labels (potential, not proof): both daily Top 10 charts (see streaming-catalogs). */
  readonly displayFp: string
  readonly displayJw: string
  /** True when the index carries only an `overall` chart for this pair: the
   *  pair is NOT exposed as movies/series (no split, no invented ranks). */
  readonly overallOnly: boolean
  readonly note: string | null
}

export interface StreamingAvailabilityResponse {
  readonly indexStatus: StreamingIndexStatus
  readonly generatedAt: string | null
  readonly choices: Array<StreamingChoiceAvailability | GenericStreamingChoiceAvailability>
}

const SECTION_LABEL: Record<StreamingSection, string> = { movies: "Film", series: "Serie TV" }

/**
 * All selectable service × country × section choices for the supported
 * subset (declared services × regions with a RegionDef). Unknown indexed
 * countries outside the supported subset are never promised: they simply
 * have no choice here. Hulu/Peacock are not mapped services — no choice
 * claims them (unsupported, not "every-country" claims).
 */
export function buildStreamingChoices(
  coverage: Record<string, Record<string, SectionCoverage>>,
  indexKnown: boolean,
  filters?: { service?: string; country?: string; section?: string },
): StreamingChoiceAvailability[] {
  const out: StreamingChoiceAvailability[] = []
  for (const service of STREAMING_SERVICES) {
    if (filters?.service && filters.service !== service) continue
    const flixServiceId = streamingAvailabilityServiceId(service)
    for (const region of REGIONS) {
      if (filters?.country && filters.country.toUpperCase() !== region.code) continue
      const pair = coverage[region.flixSlug]?.[flixServiceId]
      for (const section of ["movies", "series"] as const) {
        if (filters?.section && filters.section !== section) continue
        const fpChart: boolean | "unknown" = !indexKnown ? "unknown" : !!pair?.[section]
        const overallOnly = !!pair && !pair.movies && !pair.series && pair.overall
        const jwFallback = jwFallbackSupported(service, region.code)
        const potential: StreamingPotentialSource =
          fpChart === true ? "flixpatrol" : jwFallback ? "justwatch" : "unavailable"
        const note = overallOnly
          ? "Solo classifica complessiva (overall): non esposta come Film/Serie TV — dividere la lista inventerebbe i rank."
          : potential === "unavailable"
            ? fpChart === "unknown"
              ? "Indice non disponibile e nessun fallback JustWatch noto per questa coppia."
              : "Nessuna copertura FlixPatrol né fallback JustWatch noto per questa coppia."
            : null
        out.push({
          service,
          serviceName: streamingServiceShortName(service),
          country: region.code,
          countryFlag: region.flag,
          countryLabel: region.label,
          countryFlixSlug: region.flixSlug,
          section,
          catalogId: streamingCatalogId(service, region.code, section),
          fpChart,
          jwFallback,
          potential,
          displayFp: `${STREAMING_SOURCE_LABEL_FP} — ${SECTION_LABEL[section]}`,
          displayJw: `${STREAMING_SOURCE_LABEL_JW} — ${SECTION_LABEL[section]}`,
          overallOnly,
          note,
        })
      }
    }
  }
  return out
}

/**
 * Canonical semantic identity for one auto-policy availability choice:
 * service-index-id (`genericIndexServiceId`: prime->amazon-prime,
 * apple->apple-tv, hbo->hbo-max; everything else identity, so `amazon` vs
 * `amazon-prime` and `hulu` vs `hulu-nippon` stay distinct) + chart slug +
 * section (movies/series/all distinct: mixed `all` never merges with a
 * split) + auto policy + variant (null base vs exact variant ids distinct).
 * Backend field/type/schema/id formats are untouched — this only decides
 * which already-built descriptors survive the final auto composition.
 */
function autoChoiceCanonicalKey(
  c: StreamingChoiceAvailability | GenericStreamingChoiceAvailability,
): string {
  const slug = (
    (c as GenericStreamingChoiceAvailability).chartSlug ??
    (c as StreamingChoiceAvailability).countryFlixSlug ??
    ""
  ).toLowerCase()
  const svc = genericIndexServiceId(String(c.service).toLowerCase())
  const variant = (c as GenericStreamingChoiceAvailability).variant ?? "-"
  return `${svc}|${slug}|${c.section}|auto|${variant}`
}

/**
 * Remove SEMANTIC duplicates from the final auto composition (legacy first,
 * so the legacy-identical entry keeps its stable legacy id and no old config
 * ID is invalidated). Order-preserving, first-wins; genuinely distinct
 * providers/countries/sections/variants are never merged.
 */
export function dedupeAutoAvailabilityChoices(
  choices: Array<StreamingChoiceAvailability | GenericStreamingChoiceAvailability>,
): Array<StreamingChoiceAvailability | GenericStreamingChoiceAvailability> {
  const seen = new Set<string>()
  const out: Array<StreamingChoiceAvailability | GenericStreamingChoiceAvailability> = []
  for (const c of choices) {
    const key = autoChoiceCanonicalKey(c)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

export async function getStreamingAvailability(filters?: {
  service?: string
  country?: string
  section?: string
  source?: string
}): Promise<StreamingAvailabilityResponse> {
  const loaded = await loadStreamingAvailability()
  // Absent source = `auto` (compatibility: legacy auto ids retained).
  // A PRESENT-but-invalid source fails closed (empty choices): silently
  // switching intent to `auto` would promise charts under a policy the caller
  // never asked for. Strict modes carry ONLY requested-policy encoded ids —
  // legacy auto ids never leak, cross potentials never substitute.
  const rawSource = filters?.source
  const source: StreamingSourceMode | null =
    rawSource === undefined ? "auto" : parseStreamingSourceMode(rawSource)
  if (source === null) {
    return { indexStatus: loaded.status, generatedAt: loaded.generatedAt, choices: [] }
  }
  const indexKnown = loaded.status !== "error"
  if (source === "auto") {
    // Semantic dedup (R): the legacy builder and the generic builder can
    // describe the SAME persisted semantic list under different catalogIds
    // (e.g. overall-only Crunchyroll IT: no FP movies/series split, so the
    // generic `chartExists === false` entries skip the in-emit legacy guard
    // and duplicate the identical legacy JW-fallback pair -> 5 chips instead
    // of 3). Canonical identity is service-index-id (prime->amazon-prime,
    // apple->apple-tv, hbo->hbo-max via the existing alias map — never
    // amazon vs amazon-prime nor hulu vs hulu-nippon) + chart slug + section
    // + auto policy + variant. First (legacy) wins, so legacy-identical
    // entries keep their stable legacy ids; genuinely distinct providers,
    // countries, source policies, variants and mixed `all` sections never
    // share a key and are all preserved. Strict FP/JW compositions are
    // untouched (legacy ids never leak there).
    return {
      indexStatus: loaded.status,
      generatedAt: loaded.generatedAt,
      choices: dedupeAutoAvailabilityChoices([
        ...buildStreamingChoices(loaded.regions, indexKnown, filters),
        ...buildGenericStreamingChoices(loaded.regions, loaded.variants, indexKnown, { ...filters, source }),
      ]),
    }
  }
  if (source === "flixpatrol") {
    // Strict FP serves ONLY real FP charts: unavailable/overallOnly
    // descriptors are auto-mode capabilities (honest metadata there), never
    // selectable strict choices. The UI must also filter; this is the
    // backend gate (no unavailable pseudo-choices leak under only-FP).
    return {
      indexStatus: loaded.status,
      generatedAt: loaded.generatedAt,
      choices: buildGenericStreamingChoices(loaded.regions, loaded.variants, indexKnown, {
        ...filters,
        source,
      }).filter((c) => c.potential === "flixpatrol"),
    }
  }
  return {
    indexStatus: loaded.status,
    generatedAt: loaded.generatedAt,
    choices: buildGenericStreamingChoices(loaded.regions, loaded.variants, indexKnown, {
      ...filters,
      source,
    }),
  }
}

// ---------------------------------------------------------------------------
// Generic universe choices (Task F): the dynamic availability-index union —
// every indexed (service, chart-country) pair, base + variant charts,
// `all`/mixed for overall — filtered by an explicit source policy.
//
// Additive: the legacy builder above is untouched (legacy 8x22 entries keep
// byte-identical fields/ids). Generic entries whose (service, slug, section,
// source, variant) is legacy-identical are SUPPRESSED here (the legacy entry
// already covers them); everything else gets `pictorium-stream2-*` ids.
// ---------------------------------------------------------------------------

/** Legacy availability service id -> curated service (reverse index map). */
const AVAILABILITY_ID_TO_LEGACY: Record<string, StreamingService> = {
  netflix: "netflix",
  "amazon-prime": "prime",
  disney: "disney",
  now: "now",
  "apple-tv": "apple",
  "hbo-max": "hbo",
  paramount: "paramount",
  crunchyroll: "crunchyroll",
}

export interface GenericStreamingChoiceAvailability {
  readonly service: string
  readonly serviceName: string
  /** RegionDef code where known, else the uppercased chart slug. */
  readonly country: string
  readonly countryFlag: string
  readonly countryLabel: string
  readonly countryFlixSlug: string
  /** fp-crawler chart slug (fetch identity, never substituted). */
  readonly chartSlug: string
  readonly section: GenericStreamingSection
  /** Requested source policy this choice was computed for. */
  readonly source: StreamingSourceMode
  /** Feed variant chart id, or null for the base chart. */
  readonly variant: string | null
  /** All feed variant ids recorded for this (service, slug, category). */
  readonly variants: readonly string[]
  readonly catalogId: string
  /** FP chart coverage: true/false when the index is known, "unknown" on index error. */
  readonly fpChart: boolean | "unknown"
  readonly jwFallback: boolean
  readonly potential: StreamingPotentialSource
  /** Honest display labels (potential, not proof): both daily Top 10 charts. */
  readonly displayFp: string
  readonly displayJw: string
  /** True when the pair carries only an `overall` chart (movies/series unavailable, never split). */
  readonly overallOnly: boolean
  readonly note: string | null
}

export interface GenericChoiceFilters {
  readonly service?: string
  readonly country?: string
  readonly section?: string
  readonly source?: StreamingSourceMode
}

const GENERIC_SECTION_LABEL: Record<GenericStreamingSection, string> = {
  movies: "Film",
  series: "Serie TV",
  all: "Film & Serie TV",
}

/**
 * All generic (service, chart-country, section, source, variant) choices.
 * The dynamic registry is the index itself: every allowlisted slug x every
 * safe service id found in the fetched document. Fail-closed throughout:
 * non-allowlisted slugs/service shapes are skipped (never promised, never
 * Italy). `source` selects the potential policy — strict modes never
 * substitute silently (`flixpatrol` never reports `justwatch` potential and
 * vice versa; `justwatch` omits unsupported pairs entirely).
 */
export function buildGenericStreamingChoices(
  coverage: Record<string, Record<string, SectionCoverage>>,
  variants: Record<string, Record<string, SectionVariants>>,
  indexKnown: boolean,
  filters?: GenericChoiceFilters,
): GenericStreamingChoiceAvailability[] {
  const source: StreamingSourceMode = filters?.source ?? "auto"
  const out: GenericStreamingChoiceAvailability[] = []
  const serviceFilter = filters?.service?.trim().toLowerCase() || null
  // The country filter accepts RegionDef codes ("IT", "US"), chart slugs
  // ("italy", "united-states") and GLOBAL ("global"); anything else matches
  // nothing (fail-closed, never Italy).
  const countryFilterSlugs: ReadonlySet<string> | null = (() => {
    const raw = filters?.country?.trim()
    if (!raw) return null
    const asSlug = parseChartCountrySlug(raw)
    if (asSlug) return new Set([asSlug])
    const t = raw.toUpperCase()
    if (t === "GLOBAL") return new Set(["global"])
    const found = REGIONS.find((r) => r.code === t)
    return found ? new Set([found.flixSlug]) : new Set<string>()
  })()
  const sectionFilter = filters?.section === "movies" || filters?.section === "series" || filters?.section === "all"
    ? filters.section
    : null

  const matchService = (serviceId: string): boolean => {
    if (!serviceFilter) return true
    if (serviceId === serviceFilter) return true
    // Legacy service names map to their availability ids (`prime` matches
    // `amazon-prime`); anything else must match the id verbatim.
    const legacy = (Object.keys(AVAILABILITY_ID_TO_LEGACY) as string[]).find(
      (id) => AVAILABILITY_ID_TO_LEGACY[id] === serviceFilter,
    )
    return legacy === serviceId
  }

  // Base keys already emitted from the index (service|slug|section, base
  // charts only): the strict-JW matrix backfill below must not duplicate
  // them, only add verified pairs the index never lists.
  const emittedBase = new Set<string>()

  for (const slug of Object.keys(coverage)) {
    const chartSlug = parseChartCountrySlug(slug)
    if (!chartSlug) continue
    const info = chartCountryInfo(chartSlug)
    if (countryFilterSlugs && !countryFilterSlugs.has(chartSlug)) continue
    const services = coverage[slug]
    if (!services || typeof services !== "object") continue
    for (const serviceId of Object.keys(services)) {
      if (typeof serviceId !== "string" || serviceId.length === 0 || serviceId.length > 64) continue
      if (serviceId === "__proto__" || serviceId === "constructor" || serviceId === "prototype") continue
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(serviceId) || serviceId.includes("--")) continue
      if (!matchService(serviceId)) continue
      const pair = services[serviceId] as SectionCoverage | null
      if (!pair || typeof pair !== "object") continue
      const pairVariants = variants[slug]?.[serviceId]
      const legacyService = AVAILABILITY_ID_TO_LEGACY[serviceId]
      const legacySlug = legacyService ? info.knownRegion : false
      const jwEligible = !!legacyService && info.knownRegion && jwFallbackSupported(legacyService, info.code)

      // Base existence is proven ONLY by an empty variant array (`[]`) or a
      // non-array coverage form: a NON-EMPTY variant array (e.g.
      // `series: ["it"]`) means variant-only charts — the base `catalog_id`
      // (here `rai.series`) does not exist upstream (the real country doc
      // carries only `rai.series-it`). Category presence alone never proves
      // a base, so only the exact variant choices emit — never a fictitious
      // base, never a duplicate base+variant at equal meaning.
      const varsFor = (section: "movies" | "series" | "overall"): readonly string[] =>
        pairVariants?.[section] ?? []
      const hasBase = (section: "movies" | "series" | "overall"): boolean =>
        !!pair[section] && varsFor(section).length === 0
      const hasAny = (section: "movies" | "series" | "overall"): boolean =>
        hasBase(section) || varsFor(section).length > 0

      const emit = (
        section: GenericStreamingSection,
        variant: string | null,
        sectionVariants: readonly string[],
        chartExists: boolean,
      ): void => {
        if (sectionFilter && sectionFilter !== section) return
        // Legacy-identical coverage stays on the legacy entry: suppress the
        // generic duplicate (same rows, same policy, legacy family). A
        // variant-only section has no base to suppress and its variants are
        // never legacy-identical, so they always emit.
        if (
          source === "auto" &&
          variant === null &&
          legacySlug &&
          (section === "movies" || section === "series") &&
          chartExists
        ) {
          return
        }
        // Mixed `all` is FP-only by design in every source mode: blending
        // separate JW movies+shows charts would invent ranks, so a
        // justwatch-only request can never serve it — omit the choice
        // (unsupported, never a silent substitution or a fake JW promise).
        if (source === "justwatch" && (section === "all" || !jwEligible)) return
        const fpChart: boolean | "unknown" = !indexKnown ? "unknown" : chartExists
        let potential: StreamingPotentialSource
        if (source === "flixpatrol") {
          potential = fpChart === true ? "flixpatrol" : "unavailable"
        } else if (source === "justwatch") {
          potential = "justwatch"
        } else {
          potential = fpChart === true ? "flixpatrol" : jwEligible ? "justwatch" : "unavailable"
        }
        const overallOnly =
          section !== "all" && !hasAny("movies") && !hasAny("series") && hasAny("overall")
        const variantSuffix = variant ? ` · ${genericVariantLabel(variant)}` : ""
        const note = overallOnly
          ? "Solo classifica complessiva (overall): non esposta come Film/Serie TV — dividere la lista inventerebbe i rank."
          : potential === "unavailable"
            ? fpChart === "unknown"
              ? "Indice non disponibile e nessun fallback JustWatch noto per questa coppia."
              : source === "flixpatrol"
                ? "Nessuna classifica FlixPatrol per questa coppia/versione (modalità solo-FlixPatrol: nessun fallback)."
                : source === "justwatch"
                  ? "Nessun supporto JustWatch verificato per questa coppia (modalità solo-JustWatch: nessuna sostituzione)."
                  : "Nessuna copertura FlixPatrol né fallback JustWatch noto per questa coppia."
            : null
        if (variant === null) emittedBase.add(`${serviceId}|${chartSlug}|${section}`)
        out.push({
          service: serviceId,
          serviceName: genericServiceShortName(serviceId),
          country: info.code,
          countryFlag: info.flag,
          countryLabel: info.label,
          countryFlixSlug: chartSlug,
          chartSlug,
          section,
          source,
          variant,
          variants: sectionVariants,
          catalogId: genericStreamingCatalogId(serviceId, chartSlug, section, source, variant),
          fpChart,
          jwFallback: jwEligible,
          potential,
          displayFp: `${STREAMING_SOURCE_LABEL_FP} — ${GENERIC_SECTION_LABEL[section]}${variantSuffix}`,
          displayJw: `${STREAMING_SOURCE_LABEL_JW} — ${GENERIC_SECTION_LABEL[section]}${variantSuffix}`,
          overallOnly,
          note,
        })
      }

      if (hasBase("movies")) emit("movies", null, varsFor("movies"), true)
      for (const v of varsFor("movies")) emit("movies", v, varsFor("movies"), true)
      if (hasBase("series")) emit("series", null, varsFor("series"), true)
      for (const v of varsFor("series")) emit("series", v, varsFor("series"), true)
      if (hasBase("overall")) emit("all", null, varsFor("overall"), true)
      for (const v of varsFor("overall")) emit("all", v, varsFor("overall"), true)
      // Overall-only pairs (no movies/series split — splitting would
      // invent ranks): report both sections as explicitly unavailable with
      // the overallOnly capability, like the legacy builder.
      if (!hasAny("movies") && !hasAny("series") && hasAny("overall")) {
        emit("movies", null, [], false)
        emit("series", null, [], false)
      }
    }
  }

  if (source === "justwatch") {
    // Strict-JW matrix backfill (Task F correction c2): the documented
    // own-brand matrix (JW_FALLBACK_COUNTRIES in streaming-catalogs.ts,
    // probe-backed 2026-10-23 per the comment there) enumerates
    // INDEPENDENTLY of the FP index. Pairs the index never lists (e.g. NOW
    // GB: no `now` chart entry) are still verified JW choices; on index
    // error they surface with fpChart "unknown" (availability metadata
    // unknown, JW support still matrix-verified). Never an FP claim: these
    // carry fpChart false/unknown and potential justwatch only.
    for (const service of STREAMING_SERVICES) {
      const flixServiceId = streamingAvailabilityServiceId(service)
      if (!matchService(service) && !matchService(flixServiceId)) continue
      for (const region of REGIONS) {
        if (countryFilterSlugs && !countryFilterSlugs.has(region.flixSlug)) continue
        if (!jwFallbackSupported(service, region.code)) continue
        for (const section of ["movies", "series"] as const) {
          if (sectionFilter && sectionFilter !== section) continue
          const key = `${flixServiceId}|${region.flixSlug}|${section}`
          if (emittedBase.has(key)) continue
          emittedBase.add(key)
          const info = chartCountryInfo(region.flixSlug)
          out.push({
            service: flixServiceId,
            serviceName: genericServiceShortName(flixServiceId),
            country: info.code,
            countryFlag: info.flag,
            countryLabel: info.label,
            countryFlixSlug: region.flixSlug,
            chartSlug: region.flixSlug,
            section,
            source,
            variant: null,
            variants: [],
            catalogId: genericStreamingCatalogId(flixServiceId, region.flixSlug, section, source, null),
            fpChart: !indexKnown ? "unknown" : false,
            jwFallback: true,
            potential: "justwatch",
            displayFp: `${STREAMING_SOURCE_LABEL_FP} — ${GENERIC_SECTION_LABEL[section]}`,
            displayJw: `${STREAMING_SOURCE_LABEL_JW} — ${GENERIC_SECTION_LABEL[section]}`,
            overallOnly: false,
            note: null,
          })
        }
      }
    }
  }
  return out
}
