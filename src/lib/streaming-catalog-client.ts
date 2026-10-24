/**
 * Client-safe streaming-catalog helpers for the opt-in Top 10 UI.
 *
 * Pure leaf: no `node:` imports, no server modules. The backend contracts
 * live in `streaming-catalogs.ts` (identity/sanitize/matrix) and
 * `streaming-availability.ts` (server-only index fetch); this module only
 * shapes what the Cataloghi UI needs:
 * - localStorage boundary (absent key = legacy, explicit value = opt-in),
 * - availability-choice lookups for the Add dialog (source-filtered, dynamic
 *   provider universe, multiselect batch),
 * - canonical Stremio-meta → tile mapping (legacy card path; the numeric
 *   tmdbId stays on the numeric tmdbId — no TMDB inference),
 * - fast ORIGINAL-TMDB browse projection (`GET /api/streaming-catalog`)
 *   for the SimklCard boxes (never `/api/poster` images in cards),
 * - per-response source-header parsing (actual source, never a guess),
 * - entry ordering against the shared catalogOrder.
 */

import {
  MAX_STREAMING_SELECTIONS,
  genericStreamingCatalogId,
  parseAnyStreamingCatalogId,
  sanitizeGenericStreamingSelections,
  sanitizeStreamingSelections,
  streamingCatalogId,
  type GenericStreamingSection,
  type SanitizedGenericStreamingSelection,
  type SanitizedStreamingSelection,
  type StreamingSection,
  type StreamingSelection,
  type StreamingService,
  type StreamingSourceMode,
} from "./streaming-catalogs"
import { getRegionDef, parseRegion } from "./regions"
import { userFetch } from "./http"

/** localStorage key for the device-scoped opt-in selections. Absent = legacy. */
export const STREAMING_SELECTIONS_STORAGE_KEY = "pictorium_streaming_selections"

/** Anime Top 20 catalog ids (service-agnostic): disabled for genuine-new spaces. */
export const ANIME_TOP_CATALOG_IDS = ["pictorium-anime-movies", "pictorium-anime"] as const

/** Actual per-response source from `X-Pictorium-Source` (never a guess). */
export type StreamingActualSource = "flixpatrol" | "justwatch" | "unknown"

/**
 * Parse the per-response source header. Anything missing, empty or
 * unexpected reads as `unknown` — unknown must never render a source logo.
 */
export function parseStreamingSourceHeader(value: string | null | undefined): StreamingActualSource {
  const v = (value ?? "").trim().toLowerCase()
  if (v === "flixpatrol") return "flixpatrol"
  if (v === "justwatch") return "justwatch"
  return "unknown"
}

/** Opt-in mode is ANY explicit value (including `[]`); absent = legacy. */
export function isStreamingOptIn(
  selections: readonly unknown[] | null | undefined,
): boolean {
  return selections !== undefined && selections !== null
}

/**
 * Identity of OUR poster URLs: `/api/poster/{movie|series}/<numericTmdbId>`.
 * Numeric only — never a guess, never a TMDB lookup.
 */
export interface CatalogPosterIdentity {
  readonly type: "movie" | "series"
  readonly tmdbId: number
}

const POSTER_IDENTITY_RE = /\/api\/poster\/(movie|series)\/(\d+)(?:[/?#]|$)/

export function parseCatalogPosterIdentity(posterUrl: string | null | undefined): CatalogPosterIdentity | null {
  if (!posterUrl) return null
  const m = POSTER_IDENTITY_RE.exec(posterUrl)
  if (!m) return null
  const tmdbId = Number(m[2])
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null
  return { type: m[1] as "movie" | "series", tmdbId }
}

/** Minimal Stremio-meta shape consumed by the curated cards (legacy path). */
export interface StreamingCatalogMeta {
  readonly id?: unknown
  readonly name?: unknown
  readonly poster?: unknown
}

/** Tile rendered by the curated cards (posters as served to Stremio). */
export interface StreamingTile {
  readonly tmdbId: number
  /** Client media type (`series` catalogs render as `tv` in the editor). */
  readonly mediaType: "movie" | "tv"
  readonly title: string
  /** Full Pictorium poster URL as served in the catalog (Stremio parity). */
  readonly poster: string
}

/**
 * Map one canonical catalog meta to a tile. The tmdbId comes from OUR poster
 * URL (numeric by backend contract); metas without a parseable poster URL are
 * dropped (never inferred from raw TMDB data).
 */
export function streamingMetaToTile(
  meta: StreamingCatalogMeta,
  section: StreamingSection,
): StreamingTile | null {
  const poster = typeof meta.poster === "string" ? meta.poster : null
  const identity = parseCatalogPosterIdentity(poster)
  if (!identity || !poster) return null
  const title = typeof meta.name === "string" && meta.name.trim() ? meta.name : ""
  return {
    tmdbId: identity.tmdbId,
    mediaType: section === "movies" ? "movie" : "tv",
    title,
    poster,
  }
}

/** Both derived per-section catalog ids for one legacy entry (enabled or not). */
export function derivedIdsForSelection(sel: {
  readonly service: StreamingService
  readonly country: string
  readonly sections: readonly StreamingSection[];
}): string[] {
  return sel.sections.map((s) => streamingCatalogId(sel.service, sel.country, s))
}

/** All derived catalog ids for one generic (sanitized) entry. */
export function derivedIdsForGenericSelection(sel: SanitizedGenericStreamingSelection): string[] {
  if (sel.legacy) {
    return (sel.sections as readonly string[])
      .filter((s): s is StreamingSection => s === "movies" || s === "series")
      .map((s) => streamingCatalogId(sel.service as StreamingService, sel.country, s))
  }
  return sel.sections.map((s) =>
    genericStreamingCatalogId(sel.service, sel.chartSlug, s, sel.source, sel.variant),
  )
}

/** Stable dedup key for one legacy service + country pair. */
export function streamingPairKey(service: string, country: string): string {
  return `${service}::${country.toUpperCase()}`
}

/**
 * Chart-slug identity of a stored country value (RegionDef code/slug or raw
 * chart slug; never Italy on failure — callers sanitize first). Stored
 * `"IT"` and sanitized `"italy"` resolve to the same slug, so legacy codes
 * and generic slugs address one identity.
 */
export function countryToChartSlug(country: string): string {
  const raw = country.trim()
  if (!raw) return ""
  const code = parseRegion(raw)
  if (code && code !== "GLOBAL") return getRegionDef(code).flixSlug
  return raw.toLowerCase()
}

/**
 * Stable identity key for one generic entry: service + chart slug +
 * source + variant. Same provider in multiple countries, sources or variants
 * are distinct identities (never merged).
 */
export function genericSelectionKey(sel: {
  readonly service: string
  readonly chartSlug?: string
  readonly country?: string
  readonly source?: string | null
  readonly variant?: string | null
}): string {
  const slug = (sel.chartSlug ?? countryToChartSlug(sel.country ?? "")).trim().toLowerCase()
  const source = (sel.source ?? "auto").trim().toLowerCase() || "auto"
  const variant = (sel.variant ?? "").trim().toLowerCase() || "-"
  return `${sel.service.trim().toLowerCase()}::${slug}::${source}::${variant}`
}

/** Find a legacy entry by service + country (case-insensitive country). */
export function findStreamingSelection(
  selections: readonly SanitizedStreamingSelection[],
  service: string,
  country: string,
): SanitizedStreamingSelection | undefined {
  const cc = country.toUpperCase()
  return selections.find((s) => s.service === service && s.country === cc)
}

/** Find a generic entry by full identity (service + slug + source + variant). */
export function findGenericSelection(
  selections: readonly SanitizedGenericStreamingSelection[],
  desc: {
    readonly service: string
    readonly chartSlug?: string
    readonly country?: string
    readonly source?: string | null
    readonly variant?: string | null
  },
): SanitizedGenericStreamingSelection | undefined {
  const want = genericSelectionKey(desc)
  return selections.find((s) => genericSelectionKey(s) === want)
}

export type AddSelectionStatus = "added" | "merged" | "duplicate" | "full" | "invalid"

/**
 * Pure add/merge for one legacy (service, country, sections) choice. Never
 * mutates the input; bounds to MAX_STREAMING_SELECTIONS; merges section sets
 * on the same pair. Callers sanitize before persisting.
 */
export function addSelectionToList(
  selections: readonly SanitizedStreamingSelection[],
  service: string,
  country: string,
  sections: readonly StreamingSection[],
): { selections: SanitizedStreamingSelection[]; status: AddSelectionStatus } {
  const cleanSections = sections.filter((s) => s === "movies" || s === "series")
  if (cleanSections.length === 0) return { selections: [...selections], status: "invalid" }
  const cc = country.trim().toUpperCase()
  const existing = findStreamingSelection(selections, service, cc)
  if (existing) {
    const merged = Array.from(new Set([...existing.sections, ...cleanSections]))
    if (merged.length === existing.sections.length) return { selections: [...selections], status: "duplicate" }
    return {
      selections: selections.map((s) =>
        s === existing ? { ...s, sections: merged, enabled: true } : s,
      ),
      status: "merged",
    }
  }
  if (selections.length >= MAX_STREAMING_SELECTIONS) return { selections: [...selections], status: "full" }
  // Reuse the backend sanitizer as the single validation gate (unknown
  // service/country can never enter through the UI either).
  const sanitized = sanitizeStreamingSelections([
    ...selections.map((s) => ({ service: s.service, country: s.country, sections: [...s.sections], enabled: s.enabled })),
    { service, country: cc, sections: [...cleanSections] },
  ])
  if (!sanitized || sanitized.length !== selections.length + 1) {
    return { selections: [...selections], status: "invalid" }
  }
  return { selections: sanitized, status: "added" }
}

/** One batch entry for the multiselect dialog (country accepts code or slug). */
export interface GenericAddEntry {
  readonly service: string
  readonly country: string
  readonly sections: readonly GenericStreamingSection[]
  readonly source?: StreamingSourceMode
  readonly variant?: string | null
}

export interface BatchAddResult {
  readonly selections: SanitizedGenericStreamingSelection[]
  readonly added: number
  readonly merged: number
  readonly duplicates: number
  readonly status: AddSelectionStatus
}

/**
 * Pure batch add/merge for generic entries (multiselect dialog). Entries
 * sharing one identity (service + slug + source + variant) merge their
 * section sets; distinct identities append. Never mutates the input; bounds
 * to MAX_STREAMING_SELECTIONS (overflow entries are skipped, status `full`
 * when nothing new could be stored). Callers convert to the persisted model
 * before writing.
 */
export function addGenericSelectionsToList(
  selections: readonly SanitizedGenericStreamingSelection[],
  entries: readonly GenericAddEntry[],
): BatchAddResult {
  let next = [...selections]
  let added = 0
  let merged = 0
  let duplicates = 0
  let full = false
  for (const entry of entries) {
    const cleanSections = (Array.isArray(entry.sections) ? entry.sections : []).filter(
      (s): s is GenericStreamingSection => s === "movies" || s === "series" || s === "all",
    )
    if (cleanSections.length === 0) continue
    const source: StreamingSourceMode =
      entry.source === "flixpatrol" || entry.source === "justwatch" ? entry.source : "auto"
    const variant = typeof entry.variant === "string" && entry.variant ? entry.variant : null
    const key = genericSelectionKey({
      service: entry.service,
      country: entry.country,
      source,
      variant,
    })
    // Fail-closed validation of the single entry through the backend leaf
    // (unknown slug/service/present-but-invalid source can never enter).
    // The sanitizer never merges same-identity rows, so merging is computed
    // here against the previous state — never by diffing a combined probe.
    const check = sanitizeGenericStreamingSelections([
      {
        service: entry.service,
        country: entry.country,
        sections: [...cleanSections],
        enabled: true,
        source,
        ...(variant ? { variant } : {}),
      },
    ])
    const checked = check?.find((s) => genericSelectionKey(s) === key)
    if (!checked) continue
    const prevMatch = next.find((s) => genericSelectionKey(s) === key)
    if (prevMatch) {
      const mergedSections = Array.from(new Set([...prevMatch.sections, ...checked.sections]))
      if (mergedSections.length === prevMatch.sections.length) {
        duplicates += 1
        continue
      }
      next = next.map((s) =>
        genericSelectionKey(s) === key ? { ...prevMatch, sections: mergedSections, enabled: true } : s,
      )
      merged += 1
      continue
    }
    if (next.length >= MAX_STREAMING_SELECTIONS) {
      full = true
      continue
    }
    next = [...next, checked]
    added += 1
  }
  const status: AddSelectionStatus =
    added > 0 || merged > 0 ? (added > 0 ? "added" : "merged") : full ? "full" : duplicates > 0 ? "duplicate" : "invalid"
  return { selections: next, added, merged, duplicates, status }
}

/**
 * Convert sanitized generic entries to the persisted model
 * (`StreamingSelection`: mutable arrays, absent source/variant for
 * auto/base, legacy entries byte-identical). Persisted entries keep
 * `country` as the RegionDef code for curated RegionDef pairs and as the
 * chart slug otherwise (the sanitizer accepts both, never Italy fallback).
 */
export function toPersistedSelections(
  selections: readonly SanitizedGenericStreamingSelection[],
): StreamingSelection[] {
  return selections.map((s) => {
    const persisted: {
      service: string
      country: string
      sections: Array<"movies" | "series" | "all">
      enabled: boolean
      source?: StreamingSourceMode
      variant?: string
    } = {
      service: s.service,
      // Legacy-identical entries keep the canonical code (e.g. "IT");
      // generic entries persist the chart slug (fetch identity).
      country: s.legacy ? s.country : s.chartSlug,
      sections: [...s.sections],
      enabled: s.enabled,
    }
    if (s.source !== "auto") persisted.source = s.source
    if (s.variant) persisted.variant = s.variant
    return persisted
  })
}

/**
 * Order generic entries for the curated UI section: catalogOrder positions
 * of the first known derived id win (same order Stremio serves); entries
 * absent from the order keep their relative array order at the end.
 */
export function orderGenericStreamingEntries(
  selections: readonly SanitizedGenericStreamingSelection[],
  catalogOrder: readonly string[],
): SanitizedGenericStreamingSelection[] {
  const pos = new Map<string, number>()
  catalogOrder.forEach((id, idx) => {
    if (!pos.has(id)) pos.set(id, idx)
  })
  return [...selections]
    .map((sel, arrayIdx) => {
      let best = Number.POSITIVE_INFINITY
      for (const id of derivedIdsForGenericSelection(sel)) {
        const p = pos.get(id)
        if (p !== undefined && p < best) best = p
      }
      return { sel, best, arrayIdx }
    })
    .sort((a, b) => (a.best === b.best ? a.arrayIdx - b.arrayIdx : a.best - b.best))
    .map((e) => e.sel)
}

/**
 * Legacy order helper (kept for existing consumers): orders sanitized
 * legacy entries against the shared catalogOrder.
 */
export function orderStreamingEntries(
  selections: readonly SanitizedStreamingSelection[],
  catalogOrder: readonly string[],
): SanitizedStreamingSelection[] {
  const pos = new Map<string, number>()
  catalogOrder.forEach((id, idx) => {
    if (!pos.has(id)) pos.set(id, idx)
  })
  return [...selections]
    .map((sel, arrayIdx) => {
      let best = Number.POSITIVE_INFINITY
      for (const id of derivedIdsForSelection(sel)) {
        const p = pos.get(id)
        if (p !== undefined && p < best) best = p
      }
      return { sel, best, arrayIdx }
    })
    .sort((a, b) => (a.best === b.best ? a.arrayIdx - b.arrayIdx : a.best - b.best))
    .map((e) => e.sel)
}

/**
 * Availability choice shape (mirrors the server response, no server import).
 * Generic fields (`chartSlug`, `source`, `variant`, `variants`,
 * `countryFlixSlug`) are present on `stream2` choices; legacy `stream`
 * choices omit them (absent = auto/base).
 */
export interface StreamingChoice {
  readonly service: string
  readonly serviceName: string
  readonly country: string
  readonly countryFlag: string
  readonly countryLabel: string
  readonly countryFlixSlug?: string
  readonly chartSlug?: string
  readonly section: StreamingSection | GenericStreamingSection
  readonly source?: StreamingSourceMode
  readonly variant?: string | null
  readonly variants?: readonly string[]
  readonly catalogId: string
  readonly fpChart: boolean | "unknown"
  readonly jwFallback: boolean
  readonly potential: "flixpatrol" | "justwatch" | "unavailable"
  readonly displayFp: string
  readonly displayJw: string
  readonly overallOnly: boolean
  readonly note: string | null
}

export interface StreamingAvailability {
  readonly indexStatus: "ok" | "stale" | "error"
  readonly generatedAt: string | null
  readonly choices: StreamingChoice[]
}

export type AvailabilityLoadState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly availability: StreamingAvailability }
  | { readonly kind: "error" }

export type StreamingSourceFilter = StreamingSourceMode

/**
 * Read-only availability fetch (no auth, no user keys: the index is global).
 * `source` selects the server policy (`auto` default = legacy auto ids +
 * generic auto ids; strict modes carry only requested-policy ids, never
 * legacy auto). Never throws: transport/parse failure resolves to
 * `{ kind: "error" }` so the dialog shows an honest state with retry.
 *
 * Kept signature-compatible: `fetchStreamingAvailability(signal?)` still
 * fetches `auto`.
 */
export async function fetchStreamingAvailability(
  sourceOrSignal?: StreamingSourceFilter | AbortSignal | null,
  signal?: AbortSignal,
): Promise<AvailabilityLoadState> {
  let source: StreamingSourceFilter = "auto"
  let abort: AbortSignal | undefined
  if (typeof sourceOrSignal === "string") {
    source = sourceOrSignal === "flixpatrol" || sourceOrSignal === "justwatch" ? sourceOrSignal : "auto"
    abort = signal
  } else {
    abort = sourceOrSignal ?? undefined
  }
  try {
    const res = await fetch(`/api/streaming-availability?source=${source}`, { signal: abort })
    if (!res.ok) return { kind: "error" }
    const body = (await res.json()) as Partial<StreamingAvailability>
    if (!body || !Array.isArray(body.choices)) return { kind: "error" }
    const status = body.indexStatus === "ok" || body.indexStatus === "stale" ? body.indexStatus : "error"
    return {
      kind: "ready",
      availability: {
        indexStatus: status,
        generatedAt: typeof body.generatedAt === "string" ? body.generatedAt : null,
        choices: body.choices as StreamingChoice[],
      },
    }
  } catch {
    if (abort?.aborted) return { kind: "idle" }
    return { kind: "error" }
  }
}

/** A choice is offered only when its potential is real (never unavailable). */
export function isChoiceOffered(choice: StreamingChoice | undefined): boolean {
  return !!choice && choice.potential !== "unavailable"
}

/** Unique countries (first-seen order) with at least one offered section. */
export function selectableCountriesForService(choices: readonly StreamingChoice[], service: string): StreamingChoice[] {
  const seen = new Set<string>()
  const out: StreamingChoice[] = []
  for (const c of choices) {
    if (c.service !== service || c.potential === "unavailable" || seen.has(c.country)) continue
    seen.add(c.country)
    out.push(c)
  }
  return out
}

/** Per-section choices for one legacy service + country pair. */
export function choicesForPair(
  choices: readonly StreamingChoice[],
  service: string,
  country: string,
): { movies?: StreamingChoice; series?: StreamingChoice } {
  const cc = country.toUpperCase()
  const out: { movies?: StreamingChoice; series?: StreamingChoice } = {}
  for (const c of choices) {
    if (c.service !== service || c.country !== cc) continue
    if (c.section === "movies") out.movies = c
    else if (c.section === "series") out.series = c
  }
  return out
}

/** A section is offered only when its potential is real (FP chart or JW fallback). */
export function isSectionSelectable(choice: StreamingChoice | undefined): boolean {
  return !!choice && choice.potential !== "unavailable"
}

/** Fetch identity of a choice: chart slug (generic) or normalized code. */
export function choiceSlug(choice: Pick<StreamingChoice, "chartSlug" | "countryFlixSlug" | "country">): string {
  const raw = choice.chartSlug ?? choice.countryFlixSlug ?? countryToChartSlug(choice.country)
  return raw.trim().toLowerCase()
}

/**
 * Unique countries with at least one offered choice (insertion order).
 * Country identity is the chart slug; the display row carries the flag/label.
 */
export function selectableCountries(
  choices: readonly StreamingChoice[],
): Array<{ slug: string; country: string; flag: string; label: string }> {
  const seen = new Set<string>()
  const out: Array<{ slug: string; country: string; flag: string; label: string }> = []
  for (const c of choices) {
    if (c.potential === "unavailable") continue
    const slug = choiceSlug(c)
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    out.push({ slug, country: c.country, flag: c.countryFlag, label: c.countryLabel })
  }
  return out
}

/**
 * Unique service rows for one chart slug with at least one offered section.
 * Dynamic universe (never the 8-curated allowlist): every indexed service
 * the feed reports. First-seen choice order is preserved.
 */
export function selectableServicesForCountry(
  choices: readonly StreamingChoice[],
  slug: string,
): Array<{ service: string; serviceName: string; choices: StreamingChoice[] }> {
  const target = slug.trim().toLowerCase()
  const byService = new Map<string, { service: string; serviceName: string; choices: StreamingChoice[] }>()
  for (const c of choices) {
    if (choiceSlug(c) !== target || c.potential === "unavailable") continue
    let row = byService.get(c.service)
    if (!row) {
      row = { service: c.service, serviceName: c.serviceName, choices: [] }
      byService.set(c.service, row)
    }
    row.choices.push(c)
  }
  return [...byService.values()]
}

/**
 * Group selected choices into stored entries (one per service + slug +
 * source + variant identity, sections merged). Variants never merge with the
 * base chart; strict sources never merge across policies.
 */
export function groupChoicesIntoEntries(
  selected: readonly StreamingChoice[],
): GenericAddEntry[] {
  const byKey = new Map<string, GenericAddEntry & { variantKey: string }>()
  for (const c of selected) {
    if (c.potential === "unavailable") continue
    const section = c.section
    if (section !== "movies" && section !== "series" && section !== "all") continue
    const source: StreamingSourceMode = c.source === "flixpatrol" || c.source === "justwatch" ? c.source : "auto"
    const variant = typeof c.variant === "string" && c.variant ? c.variant : null
    const key = `${c.service}::${choiceSlug(c)}::${source}::${variant ?? "-"}`
    const prev = byKey.get(key)
    const sections = prev
      ? Array.from(new Set([...prev.sections, section]))
      : [section]
    byKey.set(key, {
      service: c.service,
      country: c.chartSlug ?? c.countryFlixSlug ?? c.country,
      sections,
      source,
      variant,
      variantKey: key,
    })
  }
  return [...byKey.values()].map(({ variantKey: _drop, ...entry }) => entry)
}

/**
 * How many derived lists the current dialog selection would actually add:
 * choices already stored under the same identity + sections are skipped
 * (never blind-select duplicates toward the 200 cap).
 */
export function countAddableLists(
  selections: readonly SanitizedGenericStreamingSelection[],
  entries: readonly GenericAddEntry[],
): { addable: number; total: number } {
  let addable = 0
  let total = 0
  for (const entry of entries) {
    const key = genericSelectionKey({
      service: entry.service,
      country: entry.country,
      source: entry.source ?? "auto",
      variant: entry.variant ?? null,
    })
    for (const section of entry.sections) {
      total += 1
      const existing = selections.find((s) => genericSelectionKey(s) === key)
      if (!existing || !(existing.sections as readonly string[]).includes(section)) addable += 1
    }
  }
  return { addable, total }
}

// ---------------------------------------------------------------------------
// Fast ORIGINAL-TMDB browse projection (SimklCard boxes).
// ---------------------------------------------------------------------------

/** One browse row: original TMDB data for a pinned chart row (never a poster render). */
export interface StreamingBrowseItem {
  readonly tmdbId: number
  readonly mediaType: "movie" | "tv"
  readonly title: string
  readonly rank: number
  /** Original TMDB poster path (client prefixes w185/w342). Null when unknown. */
  readonly posterPath: string | null
  readonly year: number | null
}

export interface StreamingBrowseResult {
  readonly catalogId: string
  readonly service: string
  readonly chartSlug: string
  readonly section: GenericStreamingSection
  readonly source: StreamingActualSource
  readonly region: string
  /**
   * Last successful publication time (ms epoch) of the pinned snapshot the
   * rows come from (T1 backend contract) — Pictorium's publication, NOT the
   * fp-crawler chart date, NOT the request time. Null with no genuine pin.
   * T2 formats this for the UI; this leaf only types/carries it.
   */
  readonly updatedAt: number | null
  readonly items: StreamingBrowseItem[]
}

/**
 * Fetch one derived list through the read-only browse projection. The rows
 * are the pinned chart rows Stremio serves (same order + rank + real media
 * type); posters are ORIGINAL TMDB paths (never `/api/poster`). Secrets
 * never travel: only the caller's TMDB key (when the device owns one) plus
 * the namespace `u` scoping go out — no instance/server secrets, no config
 * token (the derived id already encodes the source policy).
 */
export async function fetchStreamingBrowse(
  catalogId: string,
  opts: { apiKey?: string; userId?: string | null; signal?: AbortSignal } = {},
): Promise<StreamingBrowseResult> {
  const params = new URLSearchParams({ catalog: catalogId })
  if (opts.apiKey) params.set("api_key", opts.apiKey)
  if (opts.userId) params.set("u", opts.userId)
  // Static import (same pattern as every other client hook): the previous
  // per-call dynamic `await import("./http")` resolved nondeterministically
  // under concurrent card mounts in tests (one card mocked, the sibling real).
  const res = await userFetch(`/api/streaming-catalog?${params.toString()}`, { signal: opts.signal })
  const sourceHeader = parseStreamingSourceHeader(res.headers.get("X-Pictorium-Source"))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json().catch(() => null)) as {
    catalogId?: unknown
    service?: unknown
    chartSlug?: unknown
    section?: unknown
    source?: unknown
    region?: unknown
    updatedAt?: unknown
    items?: unknown
  } | null
  if (!body || !Array.isArray(body.items)) throw new Error("bad browse response")
  const sectionRaw = body.section
  const section: GenericStreamingSection =
    sectionRaw === "movies" || sectionRaw === "series" || sectionRaw === "all"
      ? sectionRaw
      : parseAnyStreamingCatalogId(catalogId)?.section ?? "movies"
  const items: StreamingBrowseItem[] = []
  for (const raw of body.items) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const tmdbId = typeof row.tmdbId === "number" && Number.isSafeInteger(row.tmdbId) && row.tmdbId > 0 ? row.tmdbId : null
    if (tmdbId === null) continue
    items.push({
      tmdbId,
      mediaType: row.mediaType === "tv" ? "tv" : "movie",
      title: typeof row.title === "string" ? row.title : "",
      rank: typeof row.rank === "number" && Number.isFinite(row.rank) ? row.rank : 0,
      posterPath: typeof row.posterPath === "string" ? row.posterPath : null,
      year: typeof row.year === "number" && Number.isFinite(row.year) ? row.year : null,
    })
  }
  const responseSource = body.source === "flixpatrol" || body.source === "justwatch" ? body.source : null
  return {
    catalogId: typeof body.catalogId === "string" ? body.catalogId : catalogId,
    service: typeof body.service === "string" ? body.service : "",
    chartSlug: typeof body.chartSlug === "string" ? body.chartSlug : "",
    section,
    source: responseSource ?? (sourceHeader === "unknown" ? "unknown" : sourceHeader),
    region: typeof body.region === "string" ? body.region : "",
    updatedAt: typeof body.updatedAt === "number" && Number.isFinite(body.updatedAt) && body.updatedAt > 0 ? body.updatedAt : null,
    items,
  }
}

/** Map one browse row to the SimklCard item shape (original TMDB miniature). */
export function browseItemToSimkl(item: StreamingBrowseItem): {
  id: number
  media_type: "movie" | "tv"
  title: string
  poster_path: string | null
  rank: number
} {
  return {
    id: item.tmdbId,
    media_type: item.mediaType,
    title: item.title,
    poster_path: item.posterPath,
    rank: item.rank,
  }
}
