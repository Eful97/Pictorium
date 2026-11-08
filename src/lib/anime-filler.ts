/**
 * Anime filler classification resolver — server-only pure leaf.
 *
 * Reads the bundled snapshot `src/generated/anime-filler-map.json` (generator:
 * `scripts/build-anime-filler-map.mjs`; data notes: `docs/anime-filler-data.md`).
 * The separate CC BY-SA 4.0 own DB `src/generated/anime-filler-own-map.json`
 * (vendor: `scripts/update-anime-filler-own-map.mjs`) is a SECOND index used
 * only as a fallback when the primary snapshot has no record for the id.
 * Two static imports, zero runtime I/O: no fetch, no filesystem, no secrets.
 * The lookup indices are built once at module load.
 *
 * Contract:
 * - numbering is absolute: every record classifies episodes `1..n`;
 * - `resolveFillerStatus` returns a language-neutral code (`manga` | `anime` |
 *   `filler` | `mixed`) or `null`. It never returns a display label: localized
 *   labels live in the i18n layer, which maps these codes;
 * - legacy v1 snapshots store `canon` in their ranges. It is accepted on read
 *   and normalized to `manga` (the explicit manga-canon code), so existing
 *   bytes keep resolving without a snapshot rewrite;
 * - fail-closed: unknown id, malformed input, ambiguous id or an episode
 *   outside every available window (`< 1`, or `> n` with no longer fallback)
 *   return `null` — never a guess;
 * - an episode past the primary record's window (`> n`) may be resolved from
 *   the own DB when that record extends the same series; episodes inside the
 *   primary window always come from the primary, so each episode has exactly
 *   one source.
 *
 * The snapshot is data (~size of the JSON, not needed in a browser bundle):
 * import this module from server code only, never from client components.
 */
import snapshotData from "@/generated/anime-filler-map.json"
import ownSnapshotData from "@/generated/anime-filler-own-map.json"

export type AnimeFillerStatus = "manga" | "anime" | "filler" | "mixed"

/** Canonical language-neutral codes, in snapshot order. */
export const ANIME_FILLER_STATUS_CODES = [
  "manga",
  "anime",
  "filler",
  "mixed",
] as const satisfies readonly AnimeFillerStatus[]

export interface AnimeFillerCounts {
  /** Classified episodes across all records. */
  episodes: number
  /** Manga-canon episodes (legacy v1 `canon` counts are read into this slot). */
  manga: number
  /** Anime-canon episodes (0 for a legacy v1 snapshot that had no split). */
  anime: number
  filler: number
  mixed: number
  /** Records flagged `partial` (source still ongoing at snapshot time). */
  partial: number
  /** Number of compressed ranges across all records. */
  ranges: number
}

export interface AnimeFillerMapInfo {
  /** False only when the bundled snapshot yielded no usable record. */
  available: boolean
  schemaVersion: number | null
  /** Upstream snapshot revision (`meta.sourceRevision`). */
  revision: string | null
  /** Upstream snapshot date (`meta.sourceSnapshotDate`, `YYYY-MM-DD`). */
  snapshotDate: string | null
  /** Local generation timestamp (`meta.generatedAt`, ISO). */
  generatedAt: string | null
  /** Records actually indexed from the snapshot. */
  recordCount: number
  counts: AnimeFillerCounts | null
  /** Data licence declared by the snapshot (`meta.sourceLicense`). */
  sourceLicense: string | null
  /** Upstream project URL (`meta.sourceUrl`). */
  sourceUrl: string | null
}

type FillerRange = readonly [start: number, end: number, status: AnimeFillerStatus]

interface FillerRecord {
  tmdbId: number
  malId: number | null
  /** Classified window: absolute episode numbers `1..episodes`. */
  episodes: number
  /** Sorted, non-overlapping ranges (snapshot invariant, validated by generator). */
  ranges: FillerRange[]
}

interface FillerIndex {
  records: FillerRecord[]
  /** `null` = duplicate id (ambiguous), never resolved. */
  byTmdb: Map<number, FillerRecord | null>
  byMal: Map<number, FillerRecord | null>
}

const STATUS_SET: ReadonlySet<string> = new Set(ANIME_FILLER_STATUS_CODES)

/**
 * Legacy v1 snapshot compatibility: v1 ranges store `canon`, v1 counts store
 * `canon`. Both are read-only aliases of the explicit `manga` code; nothing
 * ever emits `canon` from this module.
 */
const LEGACY_STATUS_ALIASES: Readonly<Record<string, AnimeFillerStatus>> = {
  canon: "manga",
}

function normalizeStatus(value: unknown): AnimeFillerStatus | null {
  if (typeof value !== "string") return null
  if (STATUS_SET.has(value)) return value as AnimeFillerStatus
  return LEGACY_STATUS_ALIASES[value] ?? null
}

/**
 * Positive safe integers only: no partial `parseInt` ("164junk" → null), no
 * truncation of fractions (3.5 → null), no unsafe values. Strings are accepted
 * only when entirely numeric, so route parameters (`"74"`) work.
 */
function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

function toNonNegativeInt(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function parseRanges(raw: unknown): FillerRange[] {
  if (!Array.isArray(raw)) return []
  const ranges: FillerRange[] = []
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 3) continue
    const start = toPositiveInt(entry[0])
    const end = toPositiveInt(entry[1])
    const status = normalizeStatus(entry[2])
    if (start === null || end === null || end < start || status === null) continue
    ranges.push([start, end, status])
  }
  // The generator writes ranges already sorted; sorting defensively keeps the
  // binary search correct if the snapshot is ever produced differently.
  ranges.sort((a, b) => a[0] - b[0])
  return ranges
}

function parseRecord(raw: unknown): FillerRecord | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const tmdbId = toPositiveInt(record.t)
  const episodes = toPositiveInt(record.n)
  if (tmdbId === null || episodes === null) return null
  const ranges = parseRanges(record.ranges)
  if (ranges.length === 0) return null
  return {
    tmdbId,
    malId: toPositiveInt(record.m),
    episodes,
    ranges,
  }
}

function addToIndex(map: Map<number, FillerRecord | null>, key: number | null, record: FillerRecord): void {
  if (key === null) return
  const existing = map.get(key)
  if (existing === undefined) {
    map.set(key, record)
    return
  }
  // Two records sharing one id cannot be told apart: mark ambiguous (null
  // lookup) instead of serving another title's classification.
  if (existing !== record) map.set(key, null)
}

function buildIndex(rawRecords: unknown): FillerIndex {
  const records: FillerRecord[] = []
  const byTmdb = new Map<number, FillerRecord | null>()
  const byMal = new Map<number, FillerRecord | null>()
  if (Array.isArray(rawRecords)) {
    for (const raw of rawRecords) {
      const record = parseRecord(raw)
      if (!record) continue
      records.push(record)
      addToIndex(byTmdb, record.tmdbId, record)
      addToIndex(byMal, record.malId, record)
    }
  }
  return { records, byTmdb, byMal }
}

function parseCounts(rawMeta: unknown): AnimeFillerCounts | null {
  if (!rawMeta || typeof rawMeta !== "object") return null
  const counts = (rawMeta as Record<string, unknown>).counts
  if (!counts || typeof counts !== "object") return null
  const source = counts as Record<string, unknown>
  const episodes = toNonNegativeInt(source.episodes)
  // Dual-schema: v2 counts carry `manga`/`anime`; a v1 snapshot carries
  // `canon` and no anime split. Missing `anime` is an explicit 0, never null.
  const manga = toNonNegativeInt(source.manga !== undefined ? source.manga : source.canon)
  const anime = toNonNegativeInt(source.anime === undefined ? 0 : source.anime)
  const filler = toNonNegativeInt(source.filler)
  const mixed = toNonNegativeInt(source.mixed)
  const partial = toNonNegativeInt(source.partial)
  const ranges = toNonNegativeInt(source.ranges)
  if (
    episodes === null ||
    manga === null ||
    anime === null ||
    filler === null ||
    mixed === null ||
    partial === null ||
    ranges === null
  ) {
    return null
  }
  return { episodes, manga, anime, filler, mixed, partial, ranges }
}

const SNAPSHOT = snapshotData as unknown as { meta?: unknown; records?: unknown }
const INDEX = buildIndex(SNAPSHOT.records)
const META = (SNAPSHOT.meta && typeof SNAPSHOT.meta === "object" ? SNAPSHOT.meta : {}) as Record<string, unknown>

// Separate CC BY-SA 4.0 own DB (Eful97/pictorium-anime-filler), vendored by
// `scripts/update-anime-filler-own-map.mjs`. It is a SECOND, independent index:
// the two files are never merged. Resolution uses it only as a fallback when
// the CC BY 4.0 snapshot has no record for the id, so a series is always
// classified from exactly one source (never a per-episode mixture).
const OWN_SNAPSHOT = ownSnapshotData as unknown as { meta?: unknown; records?: unknown }
const OWN_INDEX = buildIndex(OWN_SNAPSHOT.records)
const OWN_META = (OWN_SNAPSHOT.meta && typeof OWN_SNAPSHOT.meta === "object" ? OWN_SNAPSHOT.meta : {}) as Record<string, unknown>

function statusForRecord(record: FillerRecord, episode: number): AnimeFillerStatus | null {
  if (episode < 1 || episode > record.episodes) return null
  // Binary search over the sorted ranges: O(log ranges) per episode.
  let lo = 0
  let hi = record.ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const [start, end, status] = record.ranges[mid]
    if (episode < start) hi = mid - 1
    else if (episode > end) lo = mid + 1
    else return status
  }
  // Inside `1..n` but uncovered: malformed snapshot → fail closed.
  return null
}

function resolveIn(
  map: Map<number, FillerRecord | null>,
  fallbackMap: Map<number, FillerRecord | null>,
  id: unknown,
  absoluteEpisode: unknown,
): AnimeFillerStatus | null {
  const key = toPositiveInt(id)
  const episode = toPositiveInt(absoluteEpisode)
  if (key === null || episode === null) return null
  const entry = map.get(key)
  if (entry !== undefined) {
    // An ambiguous primary id (duplicate record) is never resolved by fallback.
    if (!entry) return null
    const status = statusForRecord(entry, episode)
    if (status !== null) return status
    // The primary owns the series but stops before this episode: the separate
    // own DB may extend the tail. Episodes inside the primary window (including
    // an internal gap) never fall back, so every episode still comes from
    // exactly one source.
    if (episode <= entry.episodes) return null
    const fallback = fallbackMap.get(key)
    return fallback ? statusForRecord(fallback, episode) : null
  }
  // Absent from the primary: the separate own DB is the only fallback.
  const fallback = fallbackMap.get(key)
  if (!fallback) return null // absent from the fallback too, or ambiguous
  return statusForRecord(fallback, episode)
}

/**
 * Classification of an absolute episode for a TMDB series.
 *
 * The CC BY 4.0 snapshot is authoritative for every series it contains. When it
 * has no record for the id, the separate CC BY-SA 4.0 own DB is consulted as a
 * fallback. The own DB also extends an overlapping series past the primary's
 * classified window (`> n`); episodes inside that window always use the primary,
 * so no single episode is classified from two sources.
 *
 * @returns `"manga" | "anime" | "filler" | "mixed"`, or `null` when the series
 * is in neither source, the id/episode is malformed, the id is ambiguous, or
 * the episode falls outside every classified window. A legacy v1 range stored
 * as `canon` resolves to `manga`.
 */
export function resolveFillerStatus(tmdbId: unknown, absoluteEpisode: unknown): AnimeFillerStatus | null {
  return resolveIn(INDEX.byTmdb, OWN_INDEX.byTmdb, tmdbId, absoluteEpisode)
}

/**
 * Same as {@link resolveFillerStatus} but keyed by the primary MAL id. Used by
 * the MAL-first path (Jikan fallback consumers can resolve a MAL id without a
 * TMDB lookup). Never a substitute for a TMDB id on the TMDB path: both
 * indices point at the same records.
 */
export function resolveFillerStatusByMal(malId: unknown, absoluteEpisode: unknown): AnimeFillerStatus | null {
  return resolveIn(INDEX.byMal, OWN_INDEX.byMal, malId, absoluteEpisode)
}

function mapInfo(index: FillerIndex, meta: Record<string, unknown>): AnimeFillerMapInfo {
  const counts = parseCounts(meta)
  return {
    available: index.records.length > 0,
    schemaVersion: toPositiveInt(meta.schemaVersion),
    revision: readString(meta, "sourceRevision"),
    snapshotDate: readString(meta, "sourceSnapshotDate"),
    generatedAt: readString(meta, "generatedAt"),
    recordCount: index.records.length,
    counts: counts ? { ...counts } : null,
    sourceLicense: readString(meta, "sourceLicense"),
    sourceUrl: readString(meta, "sourceUrl"),
  }
}

/** Snapshot provenance and coverage counters (no records, no secrets). */
export function fillerMapInfo(): AnimeFillerMapInfo {
  return mapInfo(INDEX, META)
}

/**
 * Provenance/coverage of the separate CC BY-SA 4.0 own DB used as a fallback.
 * Never includes records; it stays a distinct artifact from the CC BY 4.0
 * snapshot returned by {@link fillerMapInfo}.
 */
export function ownFillerMapInfo(): AnimeFillerMapInfo {
  return mapInfo(OWN_INDEX, OWN_META)
}
