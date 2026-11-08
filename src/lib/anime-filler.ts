/**
 * Anime filler classification resolver — server-only.
 *
 * Reads the bundled snapshot `src/generated/anime-filler-map.json` (generator:
 * `scripts/build-anime-filler-map.mjs`; data notes: `docs/anime-filler-data.md`).
 * The separate CC BY-SA 4.0 own DB `src/generated/anime-filler-own-map.json`
 * (vendor: `scripts/update-anime-filler-own-map.mjs`) is the PREFERRED index:
 * it wins for every series it contains, and the CC BY 4.0 snapshot is only the
 * fallback when the own DB has no record for the id.
 *
 * The own DB refreshes itself at runtime by default (every 24 hours): the
 * remote snapshot replaces the bundled one and stays the preferred source,
 * with the CC BY 4.0 snapshot as the fallback. The refresh is fire-and-forget (a
 * lookup never waits for the network) and fail-closed (a bad refresh keeps the
 * previous index). Set `PICTORIUM_FILLER_OWN_URL=off` to disable it, or override
 * the URL / interval (`PICTORIUM_FILLER_OWN_REFRESH_HOURS`, hours, 0 = once per
 * process).
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
 * The snapshots are data (~size of the JSON, not needed in a browser bundle):
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

export interface AnimeFillerOwnRuntimeInfo {
  /** True when a remote URL is configured. */
  enabled: boolean
  /** Whether the active own snapshot comes from the network or the bundle. */
  source: "remote" | "bundled"
  /** Last successful remote load (ISO), null for the bundled snapshot. */
  refreshedAt: string | null
  /** Configured refresh interval in hours (0 = once per process). */
  refreshHours: number
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

// ---- remote own snapshot (enabled by default) -----------------------------

const DEFAULT_REMOTE_URL = "https://raw.githubusercontent.com/Eful97/pictorium-anime-filler/master/anime-filler-own-map.json"
const configuredUrl = (process.env.PICTORIUM_FILLER_OWN_URL ?? "").trim()
const REMOTE_URL = configuredUrl === "" ? DEFAULT_REMOTE_URL : configuredUrl
const REMOTE_DISABLED = REMOTE_URL.toLowerCase() === "off"
const configuredHours = Number(process.env.PICTORIUM_FILLER_OWN_REFRESH_HOURS ?? "24")
const REFRESH_HOURS = Number.isFinite(configuredHours) && configuredHours >= 0 ? configuredHours : 24
const REFRESH_MS = REFRESH_HOURS === 0 ? Number.POSITIVE_INFINITY : REFRESH_HOURS * 60 * 60 * 1000
const RETRY_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024
const MIN_REMOTE_RECORDS = 10

interface LoadedSnapshot {
  index: FillerIndex
  meta: Record<string, unknown>
  revision: string | null
  loadedAt: number
}

let remoteSnapshot: LoadedSnapshot | null = null
let remoteEpoch: string | null = null
let lastAttemptAt = 0
let refreshInFlight = false
let remoteEtag: string | null = null
let remoteLoadCounter = 0

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

function sameStringArray(actual: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

/**
 * Structural validation of a remote own snapshot. Stricter than the bundled
 * one: a truncated or malformed download must never replace a working index.
 */
function validateRemoteSnapshot(raw: unknown): string[] {
  const errors: string[] = []
  if (!isPlainObject(raw)) return ["snapshot is not an object"]
  const meta = raw.meta
  if (!isPlainObject(meta)) return ["missing meta"]
  if (meta.schemaVersion !== 2) errors.push("meta.schemaVersion must be 2")
  if (!sameStringArray(meta.statusCodes, ANIME_FILLER_STATUS_CODES)) {
    errors.push("meta.statusCodes must be [manga, anime, filler, mixed]")
  }
  if (meta.sourceLicense !== "CC BY-SA 4.0") errors.push("meta.sourceLicense must be CC BY-SA 4.0")
  if (typeof meta.sourceUrl !== "string" || !meta.sourceUrl.startsWith("https://github.com/")) {
    errors.push("meta.sourceUrl must point at the own DB repository")
  }
  if (!Array.isArray(raw.records)) return [...errors, "records must be an array"]
  if (raw.records.length < MIN_REMOTE_RECORDS) {
    errors.push(`records must contain at least ${MIN_REMOTE_RECORDS} entries`)
  }

  const tmdb = new Set<number>()
  let episodes = 0
  let ranges = 0
  raw.records.forEach((entry, index) => {
    const label = `records[${index}]`
    if (!isPlainObject(entry)) {
      errors.push(`${label} is not an object`)
      return
    }
    const tmdbId = toPositiveInt(entry.t)
    if (tmdbId === null) {
      errors.push(`${label}.t must be a positive integer`)
      return
    }
    if (entry.m !== null && entry.m !== undefined && toPositiveInt(entry.m) === null) {
      errors.push(`${label}.m must be null or a positive integer`)
    }
    if (typeof entry.partial !== "boolean") errors.push(`${label}.partial must be boolean`)
    if (tmdb.has(tmdbId)) errors.push(`${label}.t ${tmdbId} is duplicated`)
    tmdb.add(tmdbId)

    const total = toPositiveInt(entry.n)
    if (total === null) {
      errors.push(`${label}.n must be a positive integer`)
      return
    }
    if (!Array.isArray(entry.ranges) || entry.ranges.length === 0) {
      errors.push(`${label}.ranges must be a non-empty array`)
      return
    }
    let expected = 1
    for (const range of entry.ranges as unknown[]) {
      if (!Array.isArray(range) || range.length !== 3) {
        errors.push(`${label}.ranges entry must be [start, end, status]`)
        continue
      }
      const start = toPositiveInt(range[0])
      const end = toPositiveInt(range[1])
      const status = normalizeStatus(range[2])
      if (start === null || end === null || end < start || status === null) {
        errors.push(`${label}.ranges entry is invalid`)
        continue
      }
      if (start !== expected) errors.push(`${label}.ranges do not cover 1..${total} (gap at ${expected})`)
      expected = end + 1
      ranges += 1
    }
    if (expected !== total + 1) errors.push(`${label}.ranges do not cover 1..${total}`)
    episodes += total
  })

  if (!isPlainObject(meta.counts)) {
    errors.push("missing meta.counts")
  } else {
    if (meta.counts.records !== raw.records.length) {
      errors.push(`meta.counts.records ${meta.counts.records} != ${raw.records.length}`)
    }
    if (meta.counts.episodes !== episodes) errors.push(`meta.counts.episodes ${meta.counts.episodes} != ${episodes}`)
    if (meta.counts.ranges !== ranges) errors.push(`meta.counts.ranges ${meta.counts.ranges} != ${ranges}`)
  }

  return errors
}

function sanitizeEpoch(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-40)
}

async function fetchRemoteSnapshot(): Promise<boolean> {
  if (REMOTE_DISABLED) return false
  try {
    const response = await fetch(REMOTE_URL, {
      headers: remoteEtag ? { "if-none-match": remoteEtag } : { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
      redirect: "follow",
    })
    if (response.status === 304) {
      if (remoteSnapshot) remoteSnapshot.loadedAt = Date.now()
      return true
    }
    if (!response.ok) return false

    const declaredLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SNAPSHOT_BYTES) return false
    const text = await response.text()
    if (text.length > MAX_SNAPSHOT_BYTES) return false

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return false
    }
    if (validateRemoteSnapshot(parsed).length > 0) return false

    const records = (parsed as { records: unknown }).records
    const index = buildIndex(records)
    if (index.records.length < MIN_REMOTE_RECORDS) return false

    const rawMeta = (parsed as { meta?: unknown }).meta
    const meta = isPlainObject(rawMeta) ? rawMeta : {}
    const revision = readString(meta, "sourceRevision")
    remoteLoadCounter += 1
    remoteSnapshot = { index, meta, revision, loadedAt: Date.now() }
    remoteEpoch = revision ? sanitizeEpoch(revision) : `r${remoteLoadCounter}`
    remoteEtag = response.headers.get("etag")
    return true
  } catch {
    // Fail-closed: keep the previous index.
    return false
  }
}

function maybeRefreshRemote(): void {
  if (REMOTE_DISABLED || refreshInFlight) return
  const now = Date.now()
  if (remoteSnapshot && now - remoteSnapshot.loadedAt < REFRESH_MS) return
  if (now - lastAttemptAt < RETRY_MS) return
  lastAttemptAt = now
  refreshInFlight = true
  void fetchRemoteSnapshot().finally(() => {
    refreshInFlight = false
  })
}

/**
 * Force a remote refresh (admin endpoint / tests). Returns true when the
 * snapshot is current after the call (200 loaded or 304 unchanged).
 */
export async function refreshFillerSnapshotNow(): Promise<boolean> {
  if (REMOTE_DISABLED) return false
  lastAttemptAt = Date.now()
  return fetchRemoteSnapshot()
}

/**
 * Cache-key fragment derived from the loaded remote revision. `null` when no
 * remote snapshot is active, so the existing `/meta` cache keys are unchanged
 * by default.
 */
export function fillerSnapshotEpoch(): string | null {
  maybeRefreshRemote()
  return remoteEpoch
}

// ---- bundled indices ------------------------------------------------------

const SNAPSHOT = snapshotData as unknown as { meta?: unknown; records?: unknown }
const INDEX = buildIndex(SNAPSHOT.records)
const META = (SNAPSHOT.meta && typeof SNAPSHOT.meta === "object" ? SNAPSHOT.meta : {}) as Record<string, unknown>

// Separate CC BY-SA 4.0 own DB (Eful97/pictorium-anime-filler), vendored by
// `scripts/update-anime-filler-own-map.mjs` and optionally refreshed remotely.
// It is a SECOND, independent index: the two files are never merged. Resolution
// uses it only as a fallback when the CC BY 4.0 snapshot has no record for the
// id, so a series is always classified from exactly one source.
const OWN_SNAPSHOT = ownSnapshotData as unknown as { meta?: unknown; records?: unknown }
const OWN_INDEX = buildIndex(OWN_SNAPSHOT.records)
const OWN_META = (OWN_SNAPSHOT.meta && typeof OWN_SNAPSHOT.meta === "object" ? OWN_SNAPSHOT.meta : {}) as Record<string, unknown>

function activeOwnIndex(): FillerIndex {
  return remoteSnapshot?.index ?? OWN_INDEX
}

function activeOwnMeta(): Record<string, unknown> {
  return remoteSnapshot?.meta ?? OWN_META
}

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
    // An ambiguous preferred id (duplicate record) is never resolved by fallback.
    if (!entry) return null
    const status = statusForRecord(entry, episode)
    if (status !== null) return status
    // The preferred source owns the series but stops before this episode: the
    // fallback snapshot may extend the tail. Episodes inside the preferred
    // window (including an internal gap) never fall back, so every episode still
    // comes from exactly one source.
    if (episode <= entry.episodes) return null
    const fallback = fallbackMap.get(key)
    return fallback ? statusForRecord(fallback, episode) : null
  }
  // Absent from the preferred source: the fallback snapshot is consulted.
  const fallback = fallbackMap.get(key)
  if (!fallback) return null // absent from the fallback too, or ambiguous
  return statusForRecord(fallback, episode)
}

/**
 * Classification of an absolute episode for a TMDB series.
 *
 * The CC BY-SA 4.0 own DB is authoritative for every series it contains. When
 * it has no record for the id, the CC BY 4.0 snapshot is consulted as a
 * fallback. The CC BY 4.0 snapshot also extends an overlapping series past the
 * own DB's classified window (`> n`); episodes inside that window always use the
 * own DB, so no single episode is classified from two sources.
 *
 * @returns `"manga" | "anime" | "filler" | "mixed"`, or `null` when the series
 * is in neither source, the id/episode is malformed, the id is ambiguous, or
 * the episode falls outside every classified window. A legacy v1 range stored
 * as `canon` resolves to `manga`.
 */
export function resolveFillerStatus(tmdbId: unknown, absoluteEpisode: unknown): AnimeFillerStatus | null {
  maybeRefreshRemote()
  return resolveIn(activeOwnIndex().byTmdb, INDEX.byTmdb, tmdbId, absoluteEpisode)
}

/**
 * Same as {@link resolveFillerStatus} but keyed by the primary MAL id. Used by
 * the MAL-first path (Jikan fallback consumers can resolve a MAL id without a
 * TMDB lookup). Never a substitute for a TMDB id on the TMDB path: both
 * indices point at the same records.
 */
export function resolveFillerStatusByMal(malId: unknown, absoluteEpisode: unknown): AnimeFillerStatus | null {
  maybeRefreshRemote()
  return resolveIn(activeOwnIndex().byMal, INDEX.byMal, malId, absoluteEpisode)
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
  maybeRefreshRemote()
  return mapInfo(INDEX, META)
}

/**
 * Provenance/coverage of the separate CC BY-SA 4.0 own DB (the preferred source).
 * Never includes records; it stays a distinct artifact from the CC BY 4.0
 * snapshot returned by {@link fillerMapInfo}. When the remote refresh is
 * active, this reports the loaded remote snapshot.
 */
export function ownFillerMapInfo(): AnimeFillerMapInfo {
  maybeRefreshRemote()
  return mapInfo(activeOwnIndex(), activeOwnMeta())
}

/** Runtime status of the optional remote refresh. */
export function ownFillerRuntimeInfo(): AnimeFillerOwnRuntimeInfo {
  maybeRefreshRemote()
  return {
    enabled: !REMOTE_DISABLED,
    source: remoteSnapshot ? "remote" : "bundled",
    refreshedAt: remoteSnapshot ? new Date(remoteSnapshot.loadedAt).toISOString() : null,
    refreshHours: REFRESH_HOURS,
  }
}
