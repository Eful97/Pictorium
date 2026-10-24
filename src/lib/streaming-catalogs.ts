/**
 * Opt-in streaming catalogs selected by service + country (backend slice).
 *
 * Client-safe leaf (no `node:` imports): shared by the server (manifest,
 * catalog serving, availability endpoint, validation) and — in the UI
 * follow-up — by the selector. Do NOT import server-only modules here.
 *
 * Design (see `.agents/catalog.md`):
 * - One stored entry per service + country covers both media sections
 *   (`sections` defaults to movies + series). Country + service + media are
 *   all part of the catalog identity and cache keys.
 * - Stored entries are sanitized at every read (`sanitizeStreamingSelections`):
 *   bounded, allowlisted, canonical country codes. Unknown countries NEVER
 *   fall back to Italy — the entry is dropped.
 * - `streamingSelections === undefined` (absent) = legacy behavior: the
 *   historical built-in platform catalogs keep serving exactly as before, so
 *   existing spaces' explicit catalog selections are preserved. An explicit
 *   `[]` (or a non-empty list) switches the space to opt-in mode: only the
 *   general JustWatch Top 20 (+ anime Top 20, which are not service-based)
 *   plus the enabled selections are exposed. Task 3 owns the new-space
 *   default initialization; this module only defines the state boundary.
 * - Catalog ids are derived deterministically, never stored:
 *   `pictorium-stream-<service>-<cc>-<movies|series>` (`cc` lowercase).
 * - Public labels are source-neutral by design (`Top 10`, never
 *   "FlixPatrol"/"JustWatch"): the manifest performs zero chart I/O, so it
 *   cannot know which source currently backs a list. The actual source is
 *   exposed per catalog response via the `X-Pictorium-Source` header (from
 *   the already-pinned family snapshot — no extra I/O; a response diagnostic
 *   for clients that inspect headers, not visible inside Stremio itself) and
 *   in advance via the read-only availability endpoint (potential sources +
 *   honest display labels "Top 10 · FlixPatrol" vs "Top 10 · JustWatch" —
 *   both daily Top 10 charts, never a generic `Popolari` claim). No
 *   public-label completeness is claimed until the UI exists (follow-up).
 * - Anime Top 20 are not service-based and stay in both modes (absent and
 *   explicit): task 3 owns new-space defaults and will explicitly disable
 *   anime for NEW spaces — this correction changes nothing for anime/legacy.
 * - Chart families are isolated by policy: new selections pin
 *   `stream:<service>:<movie|series>` (strict own-brand JW packages, no
 *   sibling aliases), legacy platform catalogs pin
 *   `platform:<key>:<movie|series>` (historic unions preserved). A shared
 *   old JW pin is never trusted where the policy differs.
 * - Rank/poster coherence: streaming catalog rows carry their list rank as
 *   the poster `rank=` override (same mechanism as the JW branch), resolved
 *   against the SELECTION country — never the global JW region — and the
 *   poster `region` follows the selection country too.
 */

import { getRegionDef, parseRegion, REGIONS, GLOBAL_REGION, type RegionDef } from "./regions"

export const STREAMING_CATALOG_ID_PREFIX = "pictorium-stream-"

/** Services with a safe backend mapping (JW packages + FlixPatrol slug). */
export const STREAMING_SERVICES = [
  "netflix",
  "prime",
  "disney",
  "now",
  "apple",
  "hbo",
  "paramount",
  "crunchyroll",
] as const

export type StreamingService = (typeof STREAMING_SERVICES)[number]

export type StreamingSection = "movies" | "series"

const STREAMING_SERVICE_SET: ReadonlySet<string> = new Set(STREAMING_SERVICES)

/** Max stored selections per space (8 services x supported countries, bounded). */
export const MAX_STREAMING_SELECTIONS = 200

/**
 * Stored opt-in entry: one service + country, both media sections unless
 * `sections` narrows it. `enabled: false` hides it without deleting it
 * (absent `enabled` = enabled).
 *
 * Task F generic extension (additive): `source` selects the chart source
 * policy (`auto` = FP primary with declared JW fallback, `flixpatrol` =
 * real FP charts only, `justwatch` = real own-brand JW only; absent = `auto`,
 * never migrated) and `variant` pins a feed variant chart (e.g. `"it"`,
 * `"hi"`, `"amazon-channels"`; absent/null = base chart). Legacy entries
 * without both keep byte-identical legacy ids/behavior.
 */
export interface StreamingSelection {
  readonly service: string
  readonly country: string
  readonly sections?: ("movies" | "series" | "all")[]
  readonly enabled?: boolean
  readonly source?: StreamingSourceMode
  readonly variant?: string
}

/**
 * Loose stored/input form accepted at sanitize boundaries (Task F
 * correction c2): rows minted before strict validation may carry
 * `source: null` / `variant: null` (absent semantics: `auto`/base chart)
 * instead of the canonical enum/string. Boundaries normalize to the
 * canonical `StreamingSelection` above (absent/null = `auto`/base, unknown
 * = dropped); the loose form is never persisted or forwarded.
 */
export interface StreamingSelectionInput {
  readonly service: string
  readonly country: string
  readonly sections?: unknown
  readonly enabled?: unknown
  readonly source?: string | null
  readonly variant?: string | null
}

export interface SanitizedStreamingSelection {
  readonly service: StreamingService
  /** Canonical uppercase region code (e.g. "IT", "US"). Never a fallback. */
  readonly country: string
  readonly sections: readonly StreamingSection[]
  readonly enabled: boolean
}

/** Short display names for the manifest (emoji handled by the caller). */
const SERVICE_SHORT_NAMES: Record<StreamingService, string> = {
  netflix: "Netflix",
  prime: "Prime Video",
  disney: "Disney+",
  now: "NOW/Sky",
  apple: "Apple TV+",
  hbo: "HBO Max",
  paramount: "Paramount+",
  crunchyroll: "Crunchyroll",
}

/**
 * Provider emoji for the DEFAULT catalog names (UI + manifest share the
 * builders below, so both stay consistent). Curated 8 mirror the canonical
 * built-in catalog names in `catalog-definitions.ts` (no invented mapping).
 * A small intentional well-known generic map covers user-named providers by
 * ACTUAL feed service id (`rai`, `discovery-plus`); EVERYTHING else falls
 * back to 📺 (decorative only, never an official brand mark, never a
 * guessed brand). `catalogShowEmojis` OFF strips all of these via
 * `stripCatalogEmojis` (property-based); explicit user renames always win
 * verbatim and are never persisted with a generated emoji.
 */
const STREAMING_SERVICE_EMOJI: Record<string, string> = {
  netflix: "🔴",
  prime: "📦",
  disney: "🏰",
  now: "☁️",
  apple: "🍎",
  hbo: "🟣",
  paramount: "🏔️",
  crunchyroll: "🍥",
}

/** Well-known generic feed service ids (actual upstream ids, decorative only). */
const GENERIC_SERVICE_EMOJI: Record<string, string> = {
  rai: "📡",
  discovery: "🌍",
  "discovery-plus": "🌍",
}

/** Fallback emoji for every other (unknown/unmapped) provider. Decorative only. */
const UNKNOWN_SERVICE_EMOJI = "📺"

/** Prefix a provider emoji (curated, well-known generic, or 📺 fallback). Display names stay emoji-free. */
function withProviderEmoji(serviceId: string, displayName: string): string {
  const direct = STREAMING_SERVICE_EMOJI[serviceId]
  if (direct) return `${direct} ${displayName}`
  const legacy = GENERIC_INDEX_TO_LEGACY[serviceId]
  if (legacy) {
    const emoji = STREAMING_SERVICE_EMOJI[legacy]
    if (emoji) return `${emoji} ${displayName}`
  }
  return `${GENERIC_SERVICE_EMOJI[serviceId] ?? UNKNOWN_SERVICE_EMOJI} ${displayName}`
}

export function streamingServiceShortName(service: StreamingService): string {
  return SERVICE_SHORT_NAMES[service]
}

/**
 * Canonical platform key shared with the chart families
 * (`platform:<key>:<movie|series>` in chart-generation/renewal).
 */
export function streamingPlatformKey(service: StreamingService): string {
  return service
}

/** FlixPatrol platform slug for a streaming service (country-catalog fetch). */
const SERVICE_FLIX_SLUGS: Record<StreamingService, string> = {
  netflix: "netflix",
  prime: "amazon-prime",
  disney: "disney",
  now: "now",
  apple: "apple-tv",
  hbo: "hbo-max",
  paramount: "paramount-plus",
  crunchyroll: "crunchyroll",
}

export function streamingFlixSlug(service: StreamingService): string {
  return SERVICE_FLIX_SLUGS[service]
}

/**
 * FlixPatrol availability-index service id for a streaming service.
 * Distinct from the rendering slug above: the upstream index keys Paramount
 * as `paramount` (verified against the live
 * `availability.json`: netflix, amazon-prime, disney, now, apple-tv,
 * hbo-max, paramount, crunchyroll — only paramount differs from the
 * country-catalog slug `paramount-plus`). Keep this map explicit so a future
 * upstream rename is a one-line fix, never a silent miss.
 */
const SERVICE_AVAILABILITY_IDS: Record<StreamingService, string> = {
  netflix: "netflix",
  prime: "amazon-prime",
  disney: "disney",
  now: "now",
  apple: "apple-tv",
  hbo: "hbo-max",
  paramount: "paramount",
  crunchyroll: "crunchyroll",
}

export function streamingAvailabilityServiceId(service: StreamingService): string {
  return SERVICE_AVAILABILITY_IDS[service]
}

/**
 * Strict own-brand JustWatch packages for NEW opt-in selections (no sibling
 * aliases). Legacy platform catalogs keep the historic unions
 * (`chart-renewal.ts` CHART_PLATFORM_SOURCES: NOW via `pct`/`pcp` Peacock,
 * Paramount via `sst` SkyShowtime) byte-identical. For selections the alias
 * is forbidden: NOW resolves only via `ntv`/`skg`, Paramount only via `pmp`.
 */
export const STREAMING_JW_PACKAGES: Record<StreamingService, readonly string[]> = {
  netflix: ["nfx"],
  prime: ["prv", "amp"],
  disney: ["dnp"],
  now: ["ntv", "skg"],
  apple: ["atp"],
  hbo: ["mxx"],
  paramount: ["pmp"],
  crunchyroll: ["cru"],
}

/** Sky/NOW presence for NEW selections: NOW TV operates under the NOW brand
 * in IT/GB only. Germany returns JustWatch rows for `ntv`/`skg` but the DE
 * market brand is WOW/Sky (no NOW consumer brand) — serving those rows under
 * the NOW name would mislabel Sky content, so DE stays unavailable for NOW
 * selections. Probe-backed (2026-10-23, see `JW_FALLBACK_COUNTRIES`). */
const NOW_JW_COUNTRIES: ReadonlySet<string> = new Set(["IT", "GB"])

/**
 * Paramount+ own-brand countries for NEW selections: the nine markets where
 * the live JustWatch probe returned `pmp` chart rows (2026-10-23, matching
 * the FP `paramount` chart footprint). SkyShowtime countries (ES/PT/CZ/RO/
 * NL/SE/PL/...) are deliberately excluded: without the `sst` alias they are
 * unknown for a Paramount selection, never silently mapped.
 */
const PARAMOUNT_JW_COUNTRIES: ReadonlySet<string> = new Set([
  "US", "GB", "CA", "AU", "FR", "DE", "IT", "MX", "BR",
])

/**
 * JustWatch fallback allowlist for NEW opt-in selections only: per-pair
 * evidence from live JustWatch chart probes (2026-10-23, `streamingCharts`
 * `first: 3` with the strict own-brand package filter per service; nonsense
 * package codes error out, so a `rows=0` probe with a non-empty unfiltered
 * control for the same country reads as unsupported). A listed pair means
 * "a JW chart query for this pair returned rows on the probe date" — NOT a
 * commercial-availability guarantee and NOT a chart-freshness promise
 * (per-side chart-date freshness still applies at serving time). Unlisted
 * pairs are unavailable (fail-closed): no attempt, no guessed `justwatch`
 * potential. The UI/task3 follow-up owns probe refresh and wider discovery
 * (e.g. Hulu USA / Peacock USA as NEW services — never as an alias).
 */
const JW_FALLBACK_COUNTRIES: Record<StreamingService, ReadonlySet<string>> = {
  // Probe rows for every supported country except IL (JustWatch publishes
  // no IL charts at all — the unfiltered IL control is also empty).
  netflix: new Set(["AU", "BR", "CA", "CZ", "DE", "ES", "FR", "GB", "IN", "IT", "JP", "KR", "MX", "NL", "PL", "PT", "RO", "SA", "SE", "TR", "US"]),
  prime: new Set(["AU", "BR", "CA", "CZ", "DE", "ES", "FR", "GB", "IN", "IT", "JP", "KR", "MX", "NL", "PL", "PT", "RO", "SA", "SE", "TR", "US"]),
  // Probe rows everywhere except IL/IN/SA.
  disney: new Set(["AU", "BR", "CA", "CZ", "DE", "ES", "FR", "GB", "IT", "JP", "KR", "MX", "NL", "PL", "PT", "RO", "SE", "TR", "US"]),
  now: NOW_JW_COUNTRIES,
  // Probe rows everywhere except IL/RO/TR.
  apple: new Set(["AU", "BR", "CA", "CZ", "DE", "ES", "FR", "GB", "IN", "IT", "JP", "KR", "MX", "NL", "PL", "PT", "SA", "SE", "US"]),
  // Probe rows only in these 15 (JP/KR/IN/CA/SA/IL/PT return none).
  hbo: new Set(["AU", "BR", "CZ", "DE", "ES", "FR", "GB", "IT", "MX", "NL", "PL", "RO", "SE", "TR", "US"]),
  paramount: PARAMOUNT_JW_COUNTRIES,
  // Probe rows for every supported country except IL.
  crunchyroll: new Set(["AU", "BR", "CA", "CZ", "DE", "ES", "FR", "GB", "IN", "IT", "JP", "KR", "MX", "NL", "PL", "PT", "RO", "SA", "SE", "TR", "US"]),
}

export function jwFallbackSupported(service: StreamingService, countryCode: string): boolean {
  const cc = countryCode.toUpperCase()
  if (service === "now") return NOW_JW_COUNTRIES.has(cc)
  if (service === "paramount") return PARAMOUNT_JW_COUNTRIES.has(cc)
  return JW_FALLBACK_COUNTRIES[service]?.has(cc) ?? false
}

/**
 * Legacy platform gate: ALWAYS true (historic behavior preserved
 * byte-identical, including the NOW+US Peacock `pct`/`pcp` and Paramount-ES
 * SkyShowtime `sst` group-package unions). Task2 must not drift legacy
 * catalogs when no opt-in selection exists: the strict no-alias policy above
 * applies ONLY to new `pictorium-stream-*` selections (separate `stream:`
 * chart families + strict JW packages in serving/renewal). Unknown keys stay
 * fail-open as before.
 */
export function isJwFallbackAllowedForPlatform(platformKey: string, countryCode: string): boolean {
  void countryCode
  void platformKey
  return true
}

function sanitizeSections(raw: unknown): readonly StreamingSection[] {
  if (!Array.isArray(raw)) return ["movies", "series"]
  const out: StreamingSection[] = []
  for (const s of raw) {
    if ((s === "movies" || s === "series") && !out.includes(s)) out.push(s)
    if (out.length >= 2) break
  }
  return out.length > 0 ? out : ["movies", "series"]
}

/**
 * Sanitize stored selections. `undefined` input passes through as
 * `undefined` (absent = legacy behavior — NOT the same as explicit `[]`,
 * which is opt-in mode with zero selections). Invalid entries are dropped:
 * unknown services, unknown/unresolvable countries (never Italy fallback),
 * prototype pollution, over-long strings. Bounded to
 * MAX_STREAMING_SELECTIONS.
 */
export function sanitizeStreamingSelections(
  raw: readonly StreamingSelectionInput[] | null | undefined,
): SanitizedStreamingSelection[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return []
  const out: SanitizedStreamingSelection[] = []
  for (const entry of raw.slice(0, MAX_STREAMING_SELECTIONS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const { service, country, sections, enabled } = entry as Record<string, unknown>
    if (typeof service !== "string" || typeof country !== "string") continue
    if (service.length > 32 || country.length > 32) continue
    if (!STREAMING_SERVICE_SET.has(service)) continue
    // Fail-closed: an unknown country code/slug drops the entry. This must
    // NEVER resolve to the default region (Italy) — a selection for a
    // country the backend cannot resolve is unavailable, not Italian.
    // parseRegion covers exactly the supported RegionDefs (+ GLOBAL, which
    // is excluded: no global streaming selections); anything else is null.
    const code = parseRegion(country)
    if (!code || code === "GLOBAL") continue
    out.push({
      service: service as StreamingService,
      country: code,
      sections: sanitizeSections(sections),
      enabled: enabled !== false,
    })
  }
  return out
}

/** Stable catalog id for one selection + media section (derived, never stored). */
export function streamingCatalogId(
  service: StreamingService,
  countryCode: string,
  section: StreamingSection,
): string {
  return `${STREAMING_CATALOG_ID_PREFIX}${service}-${countryCode.toLowerCase()}-${section}`
}

/** All enabled catalog ids for one sanitized selection. */
export function streamingSelectionCatalogIds(sel: SanitizedStreamingSelection): string[] {
  if (!sel.enabled) return []
  return sel.sections.map((s) => streamingCatalogId(sel.service, sel.country, s))
}

export interface ParsedStreamingCatalogId {
  readonly service: StreamingService
  /** Canonical uppercase region code. */
  readonly country: string
  readonly section: StreamingSection
}

/**
 * Parse a derived streaming catalog id. Returns null for anything that is
 * not a well-formed, allowlisted selection id (unknown service/country,
 * GLOBAL, malformed) — callers answer 404.
 */
export function parseStreamingCatalogId(catalogId: string): ParsedStreamingCatalogId | null {
  if (!catalogId.startsWith(STREAMING_CATALOG_ID_PREFIX)) return null
  const rest = catalogId.slice(STREAMING_CATALOG_ID_PREFIX.length)
  const m = /^([a-z]+)-([a-z]{2})-(movies|series)$/.exec(rest)
  if (!m) return null
  const [, service, cc, section] = m
  if (!STREAMING_SERVICE_SET.has(service)) return null
  const code = parseRegion(cc)
  if (!code || code === "GLOBAL") return null
  return { service: service as StreamingService, country: code, section: section as StreamingSection }
}

export function isStreamingCatalogId(catalogId: string): boolean {
  return parseStreamingCatalogId(catalogId) !== null
}

/**
 * Neutral stable manifest name (source-neutral by contract: the manifest
 * performs zero chart I/O, so it must not claim "FlixPatrol" or
 * "JustWatch"). Actual source disclosure travels per-response
 * (`X-Pictorium-Source`) and via the availability endpoint.
 */
export function streamingCatalogName(
  service: StreamingService,
  countryCode: string,
  _section: StreamingSection,
): string {
  const region = getRegionDef(countryCode)
  // Brief default visible name ONLY (user requirement): provider emoji +
  // service + localized country + " - Top 10". No country flag, no section
  // suffix, no bullets — type travels as the separate Film/Serie/Mista
  // badge/descriptor (never dropped from identity/IDs).
  return `${withProviderEmoji(service, SERVICE_SHORT_NAMES[service])} ${region.label} - Top 10`
}

/**
 * Honest per-source display labels (potential, not proof: consumed by the UI
 * follow-up, no UI is wired here). Both backends serve the same shape — a
 * daily Top 10 chart — so the JW fallback is NOT labeled `Popolari` (that
 * would imply the generic popular-titles feed while the canonical JW path is
 * the daily chart `DAILY_POPULARITY_SAME_CONTENT_TYPE`). FP = real
 * fp-crawler chart coverage from the availability index; JW = daily-chart
 * fallback for verified own-brand pairs only. The manifest stays neutral
 * (`Top 10` with no source claim: zero chart I/O); the per-response
 * `X-Pictorium-Source` header is a diagnostic for clients that inspect
 * responses (not visible inside Stremio itself) and `unknown` means the live
 * window was not pinned — never a guess. No claim of public-label
 * completeness is made until the UI exists.
 */
export const STREAMING_SOURCE_LABEL_FP = "Top 10 · FlixPatrol"
export const STREAMING_SOURCE_LABEL_JW = "Top 10 · JustWatch"

/**
 * Minimal safe extension seam for wider service lists (task3/backend
 * follow-up owns Hulu USA / Peacock USA — never as an alias of another
 * service). To add a service: append to STREAMING_SERVICES, add its
 * country-catalog slug (SERVICE_FLIX_SLUGS), its availability-index id
 * (SERVICE_AVAILABILITY_IDS, verified against the live index), its strict
 * own-brand JW packages (STREAMING_JW_PACKAGES, no sibling brands), extend
 * the verified JW country sets above (or add a new one), and cover it in
 * `streaming-selections.test.ts` with a real-format index fixture. Do NOT
 * expand all 119 index countries speculatively in this correction: only the
 * 22 RegionDef countries are selectable, and unknown countries stay
 * fail-closed (never Italy).
 */

/** Value of the per-response `X-Pictorium-Source` header. */
export type StreamingActualSource = "flixpatrol" | "justwatch" | "unknown"

export const STREAMING_SOURCE_HEADER = "X-Pictorium-Source"

// ---------------------------------------------------------------------------
// Generic opt-in universe (Task F): ALL fp-crawler Top 10 pairs, not just the
// 8 curated services x 22 RegionDef countries above.
//
// Additive by design: every export above stays byte-identical in behavior
// (legacy `pictorium-stream-<service>-<cc>-<section>` ids, strict 8-service
// matrix, MAX bump aside). The generic descriptor below covers the dynamic
// availability-index universe (82 service ids x 118 fp-crawler slugs +
// global = 119 total, base + variant charts, `all`/mixed overall) with:
// - source mode per selection (`auto` = FP primary with declared JW fallback,
//   `flixpatrol` = real FP charts only, `justwatch` = real own-brand JW only;
//   strict modes never substitute silently);
// - derived ids encoding service + chart-country + section + source + variant
//   unambiguously (`--` separators; tokens never contain `--`);
// - backward acceptance: legacy 8x22 entries without source/variant keep the
//   legacy ids byte-identical (explicit `auto` behaves like absent).
// ---------------------------------------------------------------------------

/** Source policy for a generic selection (absent = `auto`, never migrated). */
export const STREAMING_SOURCE_MODES = ["auto", "flixpatrol", "justwatch"] as const

export type StreamingSourceMode = (typeof STREAMING_SOURCE_MODES)[number]

export function parseStreamingSourceMode(raw: unknown): StreamingSourceMode | null {
  return raw === "auto" || raw === "flixpatrol" || raw === "justwatch" ? raw : null
}

/** Generic sections: base movies/series plus `all` (mixed overall charts). */
export type GenericStreamingSection = "movies" | "series" | "all"

/** New derived-id prefix (legacy `pictorium-stream-` ids stay reserved). */
export const GENERIC_STREAMING_CATALOG_ID_PREFIX = "pictorium-stream2-"

/**
 * Chart-country slug allowlist for generic selections (mirror of
 * `SUPPORTED_COUNTRIES` in `flixpatrol.ts` + `global`). Fail-closed: a slug
 * outside this list is never fetched (no arbitrary URLs, no traversal) and
 * never falls back to Italy. RegionDef countries resolve through `regions.ts`
 * (metadata language, JW code); every other slug renders with en-US metadata
 * and is FP-only (JW own-brand support is verified per RegionDef pair only).
 */
export const GENERIC_CHART_COUNTRY_SLUGS: readonly string[] = [
  "albania", "algeria", "antigua-and-barbuda", "argentina", "armenia", "australia", "austria",
  "azerbaijan", "bahamas", "bahrain", "bangladesh", "belarus", "belgium", "belize", "bolivia",
  "bosnia-and-herzegovina", "botswana", "brazil", "bulgaria", "cambodia", "canada", "chile",
  "colombia", "costa-rica", "croatia", "cyprus", "czech-republic", "denmark", "dominica",
  "dominican-republic", "ecuador", "egypt", "estonia", "finland", "france", "gambia", "germany",
  "ghana", "greece", "guatemala", "honduras", "hong-kong", "hungary", "iceland", "india",
  "indonesia", "iraq", "ireland", "israel", "italy", "jamaica", "japan", "jordan", "kazakhstan",
  "kenya", "kuwait", "laos", "latvia", "lebanon", "libya", "lithuania", "luxembourg", "malaysia",
  "malta", "mauritania", "mauritius", "mexico", "moldova", "mongolia", "montenegro", "morocco",
  "mozambique", "namibia", "netherlands", "new-zealand", "nicaragua", "niger", "nigeria",
  "north-macedonia", "norway", "oman", "pakistan", "panama", "paraguay", "peru", "philippines",
  "poland", "portugal", "qatar", "romania", "salvador", "saudi-arabia", "serbia", "singapore",
  "slovakia", "slovenia", "south-africa", "south-korea", "spain", "sri-lanka", "sweden",
  "switzerland", "taiwan", "tajikistan", "thailand", "trinidad-and-tobago", "tunisia", "turkey",
  "uganda", "ukraine", "united-arab-emirates", "united-kingdom", "united-states", "uruguay",
  "venezuela", "vietnam", "yemen", "zimbabwe",
  "global",
]

const GENERIC_CHART_SLUG_SET: ReadonlySet<string> = new Set(GENERIC_CHART_COUNTRY_SLUGS)

/** Single slug token: lowercase alnum segments, never `--` (the id delimiter). */
const SLUG_TOKEN_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function normalizeSlugToken(raw: unknown, maxLen = 64): string | null {
  if (typeof raw !== "string") return null
  const t = raw.trim().toLowerCase()
  if (t.length === 0 || t.length > maxLen) return null
  if (t.includes("--")) return null
  if (!SLUG_TOKEN_RE.test(t)) return null
  if (t === "__proto__" || t === "constructor" || t === "prototype") return null
  return t
}

/** Fail-closed chart-slug validation (never Italy fallback — null = drop). */
export function parseChartCountrySlug(raw: unknown): string | null {
  const t = normalizeSlugToken(raw)
  if (!t || !GENERIC_CHART_SLUG_SET.has(t)) return null
  return t
}

/** Fail-closed service-id validation against slug-token shape (index membership is checked server-side). */
export function parseGenericServiceId(raw: unknown): string | null {
  return normalizeSlugToken(raw)
}

/** Fail-closed variant-id validation (bounded feed token, never a path). */
export function parseGenericVariantId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null
  return normalizeSlugToken(raw, 64)
}

/**
 * Curated legacy service name -> upstream availability-index id (Task F
 * correction c1): the generic universe addresses the INDEX id
 * (`prime` -> `amazon-prime`, `apple` -> `apple-tv`, `hbo` -> `hbo-max`;
 * every other curated name already is its index id). Identity otherwise.
 */
const GENERIC_LEGACY_SERVICE_TO_INDEX: Record<string, string> = {
  prime: "amazon-prime",
  apple: "apple-tv",
  hbo: "hbo-max",
}

/** Normalize a curated legacy service name to its upstream index id (identity otherwise). */
export function genericIndexServiceId(service: string): string {
  return GENERIC_LEGACY_SERVICE_TO_INDEX[service] ?? service
}

const GENERIC_INDEX_TO_LEGACY: Record<string, string> = {
  "amazon-prime": "prime",
  "apple-tv": "apple",
  "hbo-max": "hbo",
}

/**
 * Curated `StreamingService` key behind a generic service id (either the
 * curated name or its index id); null when neither. Own-brand JW packages
 * and the verified JW matrix stay keyed by curated name, so the generic path
 * resolves them through here instead of missing (`amazon-prime` has no
 * direct package entry).
 */
export function genericJwServiceKey(serviceId: string): StreamingService | null {
  if ((STREAMING_SERVICE_SET as ReadonlySet<string>).has(serviceId)) return serviceId as StreamingService
  const legacy = GENERIC_INDEX_TO_LEGACY[serviceId]
  return legacy ? (legacy as StreamingService) : null
}

/** Strict own-brand JustWatch packages for a generic service id (either form); null when unknown. */
export function genericJwPackagesForService(serviceId: string): readonly string[] | null {
  const direct = (STREAMING_JW_PACKAGES as Record<string, readonly string[]>)[serviceId]
  if (direct) return direct
  const legacy = GENERIC_INDEX_TO_LEGACY[serviceId]
  if (legacy) return (STREAMING_JW_PACKAGES as Record<string, readonly string[]>)[legacy] ?? null
  return null
}

export interface ChartCountryInfo {
  /** fp-crawler slug (fetch identity). */
  readonly slug: string
  /** Canonical code for cache keys/poster region (RegionDef code where known). */
  readonly code: string
  /** TMDB/JW metadata language (RegionDef lang where known, else en-US). */
  readonly lang: string
  /** Display label (RegionDef label where known, else prettified slug). */
  readonly label: string
  /** RegionDef flag where known; global chart flag for `global`, else "". */
  readonly flag: string
  /** True for the 22 RegionDef countries (JW-capable); false = FP-only. */
  readonly knownRegion: boolean
}

/** Prettify a hyphenated slug for display when no curated name exists. */
export function prettifySlug(slug: string): string {
  return slug
    .split("-")
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
    .join(" ")
}

/** Curated display names for widely-known non-legacy services (fallback: prettified id). */
const GENERIC_SERVICE_DISPLAY_NAMES: Record<string, string> = {
  hulu: "Hulu",
  peacock: "Peacock",
  wow: "WOW",
  rai: "Rai",
  canal: "Canal+",
  joyn: "Joyn",
  stan: "Stan",
  crave: "Crave",
  hotstar: "Hotstar",
  skyshowtime: "SkyShowtime",
  "hulu-nippon": "Hulu Japan",
  viu: "Viu",
  wavve: "Wavve",
  coupang: "Coupang Play",
  "coupang-play": "Coupang Play",
  player: "Player",
  globoplay: "Globoplay",
  vix: "Vix",
  mgm: "MGM+",
  lionsgate: "Lionsgate+",
  amc: "AMC+",
  starz: "Starz",
  shudder: "Shudder",
  mubi: "MUBI",
  crunchyroll: "Crunchyroll",
}

export function genericServiceShortName(serviceId: string): string {
  if ((STREAMING_SERVICE_SET as ReadonlySet<string>).has(serviceId)) {
    return SERVICE_SHORT_NAMES[serviceId as StreamingService]
  }
  return GENERIC_SERVICE_DISPLAY_NAMES[serviceId] ?? prettifySlug(serviceId)
}

/** Upstream variant labels (`availability.json#variantLabels`) + prettify fallback. */
const GENERIC_VARIANT_LABELS: Record<string, string> = {
  "amazon-channels": "Amazon Channels",
  en: "English",
  hi: "Hindi",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  mr: "Marathi",
}

export function genericVariantLabel(variant: string): string {
  return GENERIC_VARIANT_LABELS[variant] ?? prettifySlug(variant)
}

export function chartCountryInfo(slug: string): ChartCountryInfo {
  if (slug === "global") {
    return { slug, code: "GLOBAL", lang: "en-US", label: "Global", flag: "🌐", knownRegion: false }
  }
  const bySlug = new Map(REGIONS.map((r) => [r.flixSlug, r]))
  const known = bySlug.get(slug)
  if (known) {
    return { slug, code: known.code, lang: known.lang, label: known.label, flag: known.flag, knownRegion: true }
  }
  return { slug, code: slug.toUpperCase(), lang: "en-US", label: prettifySlug(slug), flag: "", knownRegion: false }
}

export interface GenericStreamingSelectionInput {
  readonly service: string
  readonly country: string
  readonly sections?: readonly string[]
  readonly enabled?: boolean
  readonly source?: string | null
  readonly variant?: string | null
}

export interface SanitizedGenericStreamingSelection {
  /** Normalized lowercase service id (index membership checked server-side). */
  readonly service: string
  /** fp-crawler chart slug (fetch identity, never substituted). */
  readonly chartSlug: string
  /** Canonical code (RegionDef code where known, else uppercased slug). */
  readonly country: string
  readonly sections: readonly GenericStreamingSection[]
  readonly enabled: boolean
  readonly source: StreamingSourceMode
  /** Variant chart id, or null for the base chart. */
  readonly variant: string | null
  /**
   * True when this selection is legacy-identical (curated 8-service,
   * RegionDef slug, movies/series only, auto source, no variant): the
   * manifest keeps emitting the legacy `pictorium-stream-*` ids for it.
   */
  readonly legacy: boolean
}

function sanitizeGenericSections(raw: unknown): readonly GenericStreamingSection[] {
  if (!Array.isArray(raw)) return ["movies", "series"]
  const out: GenericStreamingSection[] = []
  for (const s of raw) {
    if ((s === "movies" || s === "series" || s === "all") && !out.includes(s)) out.push(s)
    if (out.length >= 3) break
  }
  return out.length > 0 ? out : ["movies", "series"]
}

/**
 * Sanitize stored selections into the generic descriptor (backward-accepting:
 * legacy 8xISO entries without source/variant sanitize to `legacy: true` and
 * keep their byte-identical legacy ids). `undefined` passes through as
 * `undefined` (absent = legacy behavior, NOT explicit `[]`). Invalid entries
 * are dropped fail-closed (unknown slugs never become Italy). Bounded to
 * MAX_STREAMING_SELECTIONS (200: batch-adding many providers for one country,
 * e.g. 82 services x 2 sections, stays under the 32KB config-token cap while
 * every previously valid config still fits).
 */
export function sanitizeGenericStreamingSelections(
  raw: readonly GenericStreamingSelectionInput[] | null | undefined,
): SanitizedGenericStreamingSelection[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) return []
  const out: SanitizedGenericStreamingSelection[] = []
  for (const entry of raw.slice(0, MAX_STREAMING_SELECTIONS)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const rec = entry as Record<string, unknown>
    const service = parseGenericServiceId(rec["service"])
    // Country accepts RegionDef codes/slugs AND full chart slugs; canonical
    // chart identity is always the fp-crawler slug (never Italy on failure).
    let chartSlug: string | null = null
    if (typeof rec["country"] === "string") {
      const code = parseRegion(rec["country"])
      if (code && code !== "GLOBAL") {
        chartSlug = getRegionDef(code).flixSlug
      } else if (typeof rec["chartSlug"] === "string") {
        chartSlug = parseChartCountrySlug(rec["chartSlug"])
      } else {
        chartSlug = parseChartCountrySlug(rec["country"])
      }
    } else if (typeof rec["chartSlug"] === "string") {
      chartSlug = parseChartCountrySlug(rec["chartSlug"])
    }
    if (!service || !chartSlug) continue
    // Present-but-invalid `source` fails closed (the entry is dropped, never
    // silently switched to `auto`): a stored/parsed intent the backend does
    // not understand must not become a different policy. Absent/null/""
    // stays `auto` (compatibility, never migrated).
    const rawSource = rec["source"]
    let source: StreamingSourceMode
    if (rawSource === undefined || rawSource === null || rawSource === "") {
      source = "auto"
    } else {
      const parsedSource = parseStreamingSourceMode(rawSource)
      if (!parsedSource) continue
      source = parsedSource
    }
    const rawVariant = rec["variant"]
    // Present-but-invalid `variant` fails closed (drop the entry, never a
    // silent switch to base): a stored/parsed intent the backend does not
    // understand must not become a different chart. Absent/null/"" stays
    // base (compatibility, never migrated) — the same boundary as `source`
    // above. Validation reuses the canonical `parseGenericVariantId` leaf
    // (single regex, no drifted duplicate).
    let variant: string | null
    if (rawVariant === undefined || rawVariant === null || rawVariant === "") {
      variant = null
    } else {
      const parsedVariant = parseGenericVariantId(rawVariant)
      if (!parsedVariant) continue
      variant = parsedVariant
    }
    const info = chartCountryInfo(chartSlug)
    const sections = sanitizeGenericSections(rec["sections"])
    const legacy =
      source === "auto" &&
      variant === null &&
      (STREAMING_SERVICE_SET as ReadonlySet<string>).has(service) &&
      info.knownRegion &&
      sections.every((s) => s === "movies" || s === "series")
    // Generic (non-legacy) entries using a curated legacy name address the
    // upstream index id (exact `catalog_id` match: `prime` -> `amazon-prime`,
    // `apple` -> `apple-tv`, `hbo` -> `hbo-max`); otherwise FP discovery and
    // renewal permanently miss the real chart. Legacy-identical entries keep
    // their curated identity (byte-identical legacy ids).
    out.push({
      service: legacy ? service : genericIndexServiceId(service),
      chartSlug,
      country: info.code,
      sections,
      enabled: rec["enabled"] !== false,
      source,
      variant,
      legacy,
    })
  }
  return out
}

/**
 * Derived generic catalog id (never stored): unambiguous `--`-delimited
 * encoding of service + chart-country + section + source + optional variant.
 * Tokens never contain `--`, sections/sources are enums — parsing is strict.
 */
export function genericStreamingCatalogId(
  service: string,
  chartSlug: string,
  section: GenericStreamingSection,
  source: StreamingSourceMode = "auto",
  variant: string | null = null,
): string {
  const base = `${GENERIC_STREAMING_CATALOG_ID_PREFIX}${service}--${chartSlug}--${section}--${source}`
  return variant ? `${base}--${variant}` : base
}

export interface ParsedGenericStreamingCatalogId {
  readonly service: string
  readonly chartSlug: string
  readonly section: GenericStreamingSection
  readonly source: StreamingSourceMode
  readonly variant: string | null
}

const GENERIC_CATALOG_ID_RE =
  /^pictorium-stream2-([a-z0-9]+(?:-[a-z0-9]+)*)--([a-z0-9]+(?:-[a-z0-9]+)*)--(movies|series|all)--(auto|flixpatrol|justwatch)(?:--([a-z0-9]+(?:-[a-z0-9]+)*))?$/

/** Parse a generic `pictorium-stream2-*` id; null for anything else/malformed. */
export function parseGenericStreamingCatalogId(catalogId: string): ParsedGenericStreamingCatalogId | null {
  if (catalogId.length > 160 || !catalogId.startsWith(GENERIC_STREAMING_CATALOG_ID_PREFIX)) return null
  const m = GENERIC_CATALOG_ID_RE.exec(catalogId)
  if (!m) return null
  const [, service, chartSlug, section, source, variant] = m
  if (!GENERIC_CHART_SLUG_SET.has(chartSlug)) return null
  return {
    service,
    chartSlug,
    section: section as GenericStreamingSection,
    source: source as StreamingSourceMode,
    variant: variant ?? null,
  }
}

export function isGenericStreamingCatalogId(catalogId: string): boolean {
  return parseGenericStreamingCatalogId(catalogId) !== null
}

/**
 * Canonical chart family for a generic descriptor (Task F): the descriptor
 * is fully encoded (`stream2:<source>:<service>:<slug>:<section>:<variant>`,
 * `-` for no variant), so different source choices never share pins, rows,
 * or cache fences with each other or with legacy `stream:`/`platform:`
 * families. The group key (`chartFamilyGroupKey`) additionally fences
 * region + language.
 */
export function genericStreamFamily(desc: ParsedGenericStreamingCatalogId): string {
  return `stream2:${desc.source}:${desc.service}:${desc.chartSlug}:${desc.section}:${desc.variant ?? "-"}`
}

const GENERIC_STREAM_FAMILY_RE =
  /^stream2:(auto|flixpatrol|justwatch):([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*):(movies|series|all):([a-z0-9]+(?:-[a-z0-9]+)*|-)$/

/** Parse a generic chart family back into its descriptor; null when malformed. */
export function parseGenericStreamFamily(family: string): ParsedGenericStreamingCatalogId | null {
  const m = GENERIC_STREAM_FAMILY_RE.exec(family)
  if (!m) return null
  const [, source, service, chartSlug, section, variant] = m
  if (!GENERIC_CHART_SLUG_SET.has(chartSlug)) return null
  return {
    service,
    chartSlug,
    section: section as GenericStreamingSection,
    source: source as StreamingSourceMode,
    variant: variant === "-" ? null : variant,
  }
}

/**
 * Parse ANY opt-in streaming catalog id (legacy first, then generic).
 * Legacy ids normalize to `{ source: "auto", variant: null }`.
 */
export function parseAnyStreamingCatalogId(catalogId: string): ParsedGenericStreamingCatalogId | null {
  const legacy = parseStreamingCatalogId(catalogId)
  if (legacy) {
    return {
      service: legacy.service,
      chartSlug: getRegionDef(legacy.country).flixSlug,
      section: legacy.section,
      source: "auto",
      variant: null,
    }
  }
  return parseGenericStreamingCatalogId(catalogId)
}

/**
 * Region for a generic streaming selection (Task F): RegionDef where known
 * (JW-capable countries), GLOBAL for the global chart, else a synthesized
 * descriptor carrying the chart slug + en-US metadata language. Non-RegionDef
 * countries are FP-only (see renewal): the synthesized code is only a cache
 * identity, never an Italy substitution. Client-safe (pure).
 */
export function genericSelectionRegionDef(desc: ParsedGenericStreamingCatalogId): RegionDef {
  const info = chartCountryInfo(desc.chartSlug)
  if (desc.chartSlug === "global") return GLOBAL_REGION
  if (info.knownRegion) return getRegionDef(info.code)
  return {
    code: info.code,
    flixSlug: desc.chartSlug,
    lang: "en-US",
    lang2: "en",
    languageName: "English",
    label: info.label,
    flag: info.flag,
  }
}

/**
 * Neutral stable manifest name for a generic catalog (source-neutral by
 * contract: the manifest performs zero chart I/O, so it never claims
 * "FlixPatrol"/"JustWatch" — actual-source disclosure travels per-response
 * and via the availability endpoint + the browse UI badge).
 */
export function genericStreamingCatalogName(
  service: string,
  chartSlug: string,
  _section: GenericStreamingSection,
  _variant: string | null = null,
): string {
  const info = chartCountryInfo(chartSlug)
  // Brief default visible name ONLY (same contract as the legacy builder):
  // provider emoji + service + localized country + " - Top 10". No flag, no
  // section suffix, no variant suffix (variant identity stays in IDs; the
  // variant label travels in the separate choice/display badges).
  return `${withProviderEmoji(service, genericServiceShortName(service))} ${info.label} - Top 10`
}
