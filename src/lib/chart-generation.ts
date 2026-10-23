import crypto from "node:crypto"
import fsp from "node:fs/promises"
import path from "node:path"
import { getStorageMode } from "@/lib/kv"
import { DATA_DIR } from "@/lib/data-dir"
import { atomicWriteFile } from "@/lib/atomic-write"
import { createLogger } from "@/lib/logger"
import { GLOBAL_REGION_CODE } from "@/lib/regions"

const log = createLogger("chart-generation")

// ---------------------------------------------------------------------------
// Independent per-family ranking snapshots ("fixed cycles", simplified).
//
// Built-in ranking lists renew on the same portable Europe/Rome 00:00/12:00
// cadence (DST-aware, independent of the server timezone) — but renewal is
// INDEPENDENT PER canonical family, with no all-source barrier:
//
// - each logical ranking list (jw:movie:charts, jw:series:popular,
//   jw:movie:trending, platform:<key>:<movie|series>, anime:<movie|series>)
//   publishes its own snapshot when ITS fetch succeeds;
// - one request to its catalog/rank refreshes THAT stale list only, without
//   fetching unrelated platforms, anime lists, or modes;
// - a failed source (e.g. MDBList) blocks only its own family: JW/platform
//   renewals proceed independently. A successful zero-row read is a genuine
//   empty for this cycle on every family: it publishes an empty snapshot (a
//   miss stays null and never resurrects a saved rank). Only transport
//   failure (HTTP error, invalid payload, abort, open circuit — strict
//   adapters throw, never resolve a conflated []) blocks publish and keeps
//   the last good snapshot, with a 60s retry gate. A cached legacy
//   error-negative never masquerades as a successful empty for strict
//   callers.
//
// Serving rule (coherence over speed): each request pins the published
// snapshot of ITS family once and reuses it for catalog order, rank labels,
// and cache fences (mid-request consistency: a slot rolling mid-request never
// changes the pinned id). The prior published list stays available to
// competing readers while one owner performs the awaited bounded refresh;
// the swap is atomic on complete success. New published versions make old
// ready-body keys unreachable (ready-body cache keys carry the pinned family
// generation id; pins always revalidate durable storage first, so a publish
// by another instance cuts over immediately).
//
// Group identity (privacy/isolation):
// - JW + platform families: region code + region language ONLY. Their fetches
//   carry no credentials, so TMDB/MDBList keys must NOT partition them —
//   keyed vs public requests share the same JW/platform rows.
// - anime families: region + language + effective MDBList key hash (keyed vs
//   public payloads never mix). Only the hash enters keys; secrets never
//   touch snapshots, keys, logs, or URLs.
//
// Persistence: KV (`chartfam:pub/pubgen/lease`, EX bounded 7d) when
// configured, atomic files `chartfam-*` in DATA_DIR otherwise
// (single-process exact; multi-process file mode is best-effort only —
// multi-instance deployments MUST configure KV/Redis so commits stay atomic
// and cutover immediate). Published snapshots are retained 7 days on both
// backends (KV TTL + 7d file sweep parity; failure-gate metas sweep at 36h):
// finite retention, and a family in outage is never garbage-collected by
// another family's publish. The sweep runs awaited inside the owning commit
// (owned cleanup, no untracked background work). Snapshots are bounded (rank
// rows only, never TMDB details nor keys; cap 512KB; anime <= 500, platforms
// <= 10, charts/popular/trending <= 20). Single-process ordering comes from
// the memory lease (acquire→commit) PLUS the per-family commit mutex below
// (read-check-write is serialized, so a delayed in-flight write can never
// land after a newer publish even if the lease window lapped it) and the
// durable generation recheck (out-of-order or stale-owner commits are
// rejected; KV enforces the same via the atomic Lua commit). Commit failures
// never mark memory: the last
// published snapshot (or live mode when cold) keeps being served, never a
// private unpublished one.
// ---------------------------------------------------------------------------

/** Pinned family id for requests with no published snapshot (cold start). */
export const CHART_LIVE_PIN_ID = "live"

/** How long a failed source keeps publish attempts gated (no retry sooner). */
export const CHART_FAILURE_RETRY_MS = 60_000

/** Nonempty in-scope built-in ready bodies are reused up to 12h, fenced by
 *  the published family generation so renewal invalidates immediately.
 *  Empty/error bodies stay 60s; excluded (custom/search/addon/variant)
 *  catalogs keep their historical TTLs. */
export const CHART_READY_TTL_MS = 12 * 60 * 60 * 1000

/** Owner lease TTL for the publish critical section. */
const PUBLISH_LEASE_TTL_MS = 30_000

/**
 * Published snapshots are retained 7 days on BOTH backends (KV EX parity):
 * a family in outage keeps its last good snapshot while other families keep
 * publishing — a successful JW renewal must never garbage-collect a failed
 * anime family's rows. Failure-gate metas are short-lived (60s gates): a
 * 36h sweep is plenty for them.
 */
const PUB_FILE_RETENTION_MS = 7 * 24 * 3600 * 1000
const META_FILE_RETENTION_MS = 36 * 3600 * 1000

/** Caps: bounded memory + bounded persisted footprint. */
const MAX_GROUPS_MEMORY = 200
const MAX_FAMILY_FILES_SWEEP = 400

// Marker comments let the unit-test KV mock emulate atomic semantics (real
// Redis/Upstash just ignore Lua comments) — same pattern as trakt-profile-lock.
const LEASE_ACQUIRE_SCRIPT = `-- chartfam-lease-acquire
local v = redis.call("GET", KEYS[1])
if v then return 0 end
redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
return 1`

const LEASE_RELEASE_SCRIPT = `-- chartfam-lease-release
local v = redis.call("GET", KEYS[1])
if v == ARGV[1] then redis.call("DEL", KEYS[1]) return 1 end
return 0`

/**
 * Atomic publish commit: the write lands ONLY when the caller still owns the
 * lease AND no equal-or-newer generation is already published. Returns
 * "ok" | "stale-lease" (lease lost/expired mid-commit: another owner may
 * have published meanwhile) | "stale-gen" (a newer generation won the race).
 * Any other outcome (script error, backend down) is an "error": the caller
 * must NOT mark memory — the last published snapshot keeps being served and
 * the next request resumes.
 */
const COMMIT_SCRIPT = `-- chartfam-commit
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return "stale-lease" end
local cur = redis.call("GET", KEYS[2])
if cur and cur >= ARGV[2] then return "stale-gen" end
redis.call("SET", KEYS[3], ARGV[3], "PX", ARGV[4])
redis.call("SET", KEYS[2], ARGV[2], "PX", ARGV[4])
redis.call("DEL", KEYS[1])
return "ok"`

// --- Pure: Rome slot -------------------------------------------------------

/**
 * Current fixed-cycle slot id in Europe/Rome ("YYYYMMDD-00" for 00:00–11:59,
 * "YYYYMMDD-12" for 12:00–23:59 local). DST-aware via Intl: spring-forward
 * skips 02:00 (still slot 00), fall-back repeats 02:xx (still slot 00).
 * Portable: independent of the server timezone (uses explicit timeZone).
 */
export function romeSlotKey(nowMs: number = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nowMs)
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? ""
  const date = `${get("year")}${get("month")}${get("day")}`
  const hour = parseInt(get("hour"), 10)
  const slot = Number.isFinite(hour) && hour >= 12 ? "12" : "00"
  return `${date}-${slot}`
}

/** Rome UTC offset (minutes, east-positive) at an absolute instant. */
function romeOffsetMinutesAt(utcMs: number): number {
  const wall = romeWallParts(utcMs)
  const wallMin = Number(wall.hour) * 60 + Number(wall.minute)
  const utcMin =
    new Date(utcMs).getUTCHours() * 60 + new Date(utcMs).getUTCMinutes()
  let off = wallMin - utcMin
  // Normalize to the [-720, +720] range across midnight.
  if (off > 720) off -= 1440
  if (off < -720) off += 1440
  return off
}

/**
 * Start (inclusive, ms epoch) of a Rome slot id. The offset is solved AT the
 * slot start wall time (two fixed-point iterations converge: transitions
 * happen at night Rome time, slots start at 00:00/12:00): using a noon probe
 * would be off by one hour on DST transition days (midnight +01 vs noon +02
 * in spring, midnight +02 vs noon +01 in fall).
 */
export function romeSlotStartMs(slotKey: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})-(00|12)$/.exec(slotKey)
  if (!m) return 0
  const [, y, mo, d, hh] = m
  const wallAsUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), 0, 0)
  // Fixed point: utc = wall - offset(utc). Two iterations converge because
  // the offset is piecewise-constant around slot starts.
  let utc = wallAsUtc - romeOffsetMinutesAt(wallAsUtc) * 60_000
  utc = wallAsUtc - romeOffsetMinutesAt(utc) * 60_000
  return utc
}

function romeWallParts(nowMs: number): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nowMs)
  const out: Record<string, string> = {}
  for (const p of parts) out[p.type] = p.value
  return out
}

function nextSlotKey(slotKey: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(00|12)$/.exec(slotKey)
  if (!m) return null
  const [, y, mo, d, hh] = m
  if (hh === "00") return `${y}${mo}${d}-12`
  const nextDay = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)) + 24 * 3600 * 1000)
  const pad = (n: number): string => String(n).padStart(2, "0")
  return `${nextDay.getUTCFullYear()}${pad(nextDay.getUTCMonth() + 1)}${pad(nextDay.getUTCDate())}-00`
}

/**
 * Start of the slot FOLLOWING the one containing nowMs. Computed from the
 * next slot key (not start + 12h): spring-forward days have an 11h 00-slot
 * and fall-back days a 13h one. At an exact boundary the containing slot is
 * the new one, so this returns the boundary after it — never the current
 * instant.
 */
export function nextRomeSlotStartMs(nowMs: number = Date.now()): number {
  const next = nextSlotKey(romeSlotKey(nowMs))
  if (!next) return 0
  return romeSlotStartMs(next)
}

/**
 * Absolute end (exclusive, ms epoch) of the given published slot generation
 * (`YYYYMMDD-00|12`). Snapshot-backed poster facts expire at the end of the
 * PINNED slot — not at the end of the slot containing "now" (a pin published
 * in a previous slot, or a render starting just before a boundary and
 * completing after it, must not mint the future next-slot deadline). Returns
 * 0 for an unparseable generation (fail-open: the caller falls back).
 */
export function chartSlotEndMs(slotKey: string): number {
  const next = nextSlotKey(slotKey)
  if (!next) return 0
  return romeSlotStartMs(next)
}

/** Cycle-aware freshness floor: source entries older than this are refreshed. */
export function currentChartSlotFloor(nowMs: number = Date.now()): number {
  return romeSlotStartMs(romeSlotKey(nowMs))
}

// --- Pure: group identity ----------------------------------------------------

export interface ChartGroupInput {
  readonly regionCode: string
  readonly regionLang: string
  readonly mdblistKey?: string | null
}

function hashFragment(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8)
}

/**
 * Group identity for credential-bearing families (anime): region + language +
 * effective MDBList key hash. Keyed vs public anime payloads never share.
 * The raw key never appears (hash only, 8 hex like the other
 * key-fragment conventions in this repo).
 */
export function chartGroupKey(input: ChartGroupInput): string {
  const code = (input.regionCode || "").toUpperCase()
  const lang = input.regionLang || ""
  const keyHash = input.mdblistKey ? hashFragment(input.mdblistKey) : "none"
  return `v1:${crypto.createHash("sha1").update(`${code}|${lang}|${keyHash}`).digest("hex").slice(0, 16)}`
}

/**
 * Group identity for credential-free families (JW charts/popular/trending,
 * streaming platforms): region + language ONLY. Their fetches carry no
 * credentials, so TMDB/MDBList keys must NOT partition them — keyed vs
 * public requests share the same rows.
 */
export function chartListGroupKey(input: Pick<ChartGroupInput, "regionCode" | "regionLang">): string {
  const code = (input.regionCode || "").toUpperCase()
  const lang = input.regionLang || ""
  return `v1:${crypto.createHash("sha1").update(`${code}|${lang}`).digest("hex").slice(0, 16)}`
}

/** True for credential-bearing families (anime lists). */
export function isKeyedChartFamily(family: string): boolean {
  return family.startsWith("anime:")
}

/**
 * Family-aware group identity: anime families isolate on the effective
 * MDBList key hash; every other family shares region+language rows
 * regardless of unrelated credentials.
 */
export function chartFamilyGroupKey(input: ChartGroupInput & { family: string }): string {
  if (isKeyedChartFamily(input.family)) return chartGroupKey(input)
  return chartListGroupKey(input)
}

/** Log-safe group description (no secrets, hashes only). */
export function describeChartGroup(input: ChartGroupInput): string {
  return `${(input.regionCode || "?").toUpperCase()}/${input.regionLang || "?"}:${input.mdblistKey ? `keyed:${hashFragment(input.mdblistKey)}` : "public"}`
}

/** Built-in family-backed chart catalogs: global/platform/anime rankings whose
 *  rows come from a published family snapshot. Custom, search, and addon
 *  catalogs are excluded (zero chart I/O on those paths). */
export function isBuiltInChartCatalogId(catalogId: string): boolean {
  if (catalogId.startsWith("pictorium-custom-")) return false
  if (catalogId.startsWith("pictorium-search-")) return false
  if (catalogId.startsWith("pictorium-jw") || catalogId.startsWith("pictorium-anime")) return true
  return /^pictorium-.+-(movies|series)$/.test(catalogId)
}

// --- Shapes ------------------------------------------------------------------

export interface ChartRow {
  readonly tmdbId: number
  readonly imdbId: string | null
  readonly rank: number
  readonly title?: string | null
  readonly year?: number | null
}

export type ChartFamilyStatus = "ok" | "empty" | "error"

/** Where the published rows of a platform family came from (JW fast-path or
 *  the FlixPatrol fallback). Informational: rows + order are authoritative,
 *  provenance only records which source won. */
export type ChartFamilyProvenance = "justwatch" | "flixpatrol" | null

export interface ChartFamilySnapshot {
  readonly generation: string
  readonly group: string
  readonly family: string
  readonly status: Exclude<ChartFamilyStatus, "error">
  readonly rows: readonly ChartRow[]
  readonly fetchedAt: number
  readonly publishedAt: number
  readonly provenance?: ChartFamilyProvenance
}

export interface ChartFamilyPin {
  /** Generation id, or "live" when cold (no published snapshot yet). */
  readonly id: string
  /** Pinned snapshot (last good); null in live mode. Never partial. */
  readonly snapshot: ChartFamilySnapshot | null
}

interface FailureMeta {
  readonly lastFailureAt: number
  readonly nextRetryAt: number
}

/** Ready-body cache-key fragment fencing old generations (`:cg<id>`). */
export function chartPinCacheFragment(pin: ChartFamilyPin): string {
  return `:cg${pin.id}`
}

/** Rows of a pinned family (null in live mode: the caller fetches live). */
export function pinnedFamilyRows(pin: ChartFamilyPin): readonly ChartRow[] | null {
  return pin.snapshot?.rows ?? null
}

// --- Validation (fail-closed: invalid rows never publish) --------------------

function normalizeRow(raw: unknown, index: number, allowZeroTmdb: boolean): ChartRow | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const tmdbId = Number(r.tmdbId)
  const rank = Number(r.rank ?? index + 1)
  // Anime lists may hold imdb-only rows (tmdb resolved later per request):
  // zero tmdbId is legitimate there, invalid everywhere else.
  if (!Number.isFinite(tmdbId) || tmdbId < 0 || (!allowZeroTmdb && tmdbId <= 0)) return null
  if (!Number.isFinite(rank)) return null
  const imdbId = typeof r.imdbId === "string" && r.imdbId ? r.imdbId : null
  const title = typeof r.title === "string" ? r.title : null
  const yearRaw = Number(r.year)
  const year = Number.isFinite(yearRaw) && yearRaw > 0 ? Math.floor(yearRaw) : null
  return { tmdbId: Math.floor(tmdbId), imdbId, rank: Math.floor(rank), title, year }
}

function normalizeRows(raw: unknown, cap: number, allowZeroTmdb = false): ChartRow[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length > cap) return null
  const out: ChartRow[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = normalizeRow(raw[i], i, allowZeroTmdb)
    if (!row) return null
    out.push(row)
  }
  return out
}

/** Per-family row caps (bounded snapshots; match upstream fetch windows). */
function familyRowCap(family: string): number {
  if (family.startsWith("anime:")) return 500
  if (family.startsWith("platform:")) return 10
  if (family.includes(":popular") || family.includes(":trending")) return 20
  return 20
}

/** True for families where an empty snapshot is a legitimate designed outcome
 *  (GLOBAL platform charts resolve worldwide-only and may be empty by design).
 *  Retained as a tested pure; the renewal path now publishes successful
 *  zero-row reads as empty snapshots on every family (genuine empty for the
 *  cycle), reserving "error" for real transport failure with last-good
 *  retention. */
export function isEmptyLegitimateFamily(family: string, regionCode: string): boolean {
  return family.startsWith("platform:") && (regionCode || "").toUpperCase() === GLOBAL_REGION_CODE
}

// --- Persistence ---------------------------------------------------------------

export type ChartCommitResult = "ok" | "stale" | "error"

interface ChartFamilyPersist {
  loadPublished(group: string, family: string): Promise<ChartFamilySnapshot | null>
  /**
   * Guarded atomic publish commit. Writes ONLY when the caller still owns
   * the lease AND no equal-or-newer generation is published ("stale"
   * otherwise). "error" (or a throw) means nothing was durably written: the
   * caller must NOT mark memory — no private unpublished publication.
   */
  commitPublished(group: string, family: string, slot: string, snap: ChartFamilySnapshot, leaseOwner: string): Promise<ChartCommitResult>
  loadMeta(group: string, family: string): Promise<FailureMeta | null>
  saveMeta(group: string, family: string, meta: FailureMeta): Promise<void>
}

function isValidSnapshot(raw: unknown, group: string, family: string): ChartFamilySnapshot | null {
  if (!raw || typeof raw !== "object") return null
  const s = raw as Record<string, unknown>
  if (typeof s.generation !== "string" || !/^\d{8}-(00|12)$/.test(s.generation)) return null
  if (s.group !== group || s.family !== family || typeof s.publishedAt !== "number") return null
  if (s.status !== "ok" && s.status !== "empty") return null
  if (typeof s.fetchedAt !== "number") return null
  const rows = normalizeRows(s.rows, 500, family.startsWith("anime:"))
  if (!rows) return null
  const provenance = s.provenance === "justwatch" || s.provenance === "flixpatrol" ? s.provenance : null
  return { generation: s.generation, group, family, status: s.status, rows, fetchedAt: s.fetchedAt, publishedAt: s.publishedAt, provenance }
}

function snapshotPayloadSize(snap: ChartFamilySnapshot): number {
  try {
    return Buffer.byteLength(JSON.stringify(snap))
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

/** Published snapshots stay small (rank rows only, never TMDB details). */
const MAX_SNAPSHOT_BYTES = 512 * 1024
const PUB_TTL_SECONDS = 7 * 24 * 3600

function kvPubKey(group: string, family: string): string {
  return `chartfam:pub:${group}:${family}`
}

function kvGenKey(group: string, family: string): string {
  return `chartfam:pubgen:${group}:${family}`
}

function kvMetaKey(group: string, family: string): string {
  return `chartfam:meta:${group}:${family}`
}

function kvLeaseKey(group: string, family: string): string {
  return `chartfam:lease:${group}:${family}`
}

async function kvPersist(): Promise<ChartFamilyPersist | null> {
  if (getStorageMode() !== "kv") return null
  let kv: {
    get<T>(k: string): Promise<T | null>
    set(k: string, v: unknown, o?: { ex?: number }): Promise<void>
    del(k: string): Promise<number>
    eval<T>(s: string, k: string[], a: string[]): Promise<T>
  }
  try {
    const { getKv } = await import("@/lib/kv")
    kv = getKv()
  } catch {
    return null
  }
  const wrap = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn()
    } catch (e) {
      log.warn("chartfam KV op failed (fail-open, memory only)", {
        error: e instanceof Error ? e.message : String(e),
      })
      return null
    }
  }
  return {
    async loadPublished(group, family) {
      const raw = await wrap(() => kv.get<unknown>(kvPubKey(group, family)))
      return raw ? isValidSnapshot(raw, group, family) : null
    },
    async commitPublished(group, family, slot, snap, leaseOwner) {
      if (snapshotPayloadSize(snap) > MAX_SNAPSHOT_BYTES) {
        log.warn("chartfam snapshot oversized, publish refused", { group, family })
        return "error"
      }
      let payload: string
      try {
        payload = JSON.stringify(snap)
      } catch {
        return "error"
      }
      try {
        const res = await kv.eval<string>(
          COMMIT_SCRIPT,
          [kvLeaseKey(group, family), kvGenKey(group, family), kvPubKey(group, family)],
          [leaseOwner, slot, payload, String(PUB_TTL_SECONDS * 1000)],
        )
        if (res === "ok" || res === "stale-lease" || res === "stale-gen") {
          if (res !== "ok") {
            log.debug("chartfam KV commit rejected (concurrent owner won)", { group, family, outcome: res })
            return "stale"
          }
          return "ok"
        }
        log.warn("chartfam KV commit unexpected outcome", { group, family, outcome: String(res) })
        return "error"
      } catch (e) {
        log.warn("chartfam KV commit failed (last good snapshot kept)", {
          error: e instanceof Error ? e.message : String(e),
        })
        return "error"
      }
    },
    async loadMeta(group, family) {
      const raw = await wrap(() => kv.get<unknown>(kvMetaKey(group, family)))
      if (!raw || typeof raw !== "object") return null
      const m = raw as Record<string, unknown>
      if (typeof m.lastFailureAt !== "number" || typeof m.nextRetryAt !== "number") return null
      return { lastFailureAt: m.lastFailureAt, nextRetryAt: m.nextRetryAt }
    },
    async saveMeta(group, family, meta) {
      await wrap(() => kv.set(kvMetaKey(group, family), meta, { ex: 48 * 3600 }))
    },
  }
}

async function acquireKvLease(key: string, owner: string): Promise<boolean> {
  try {
    const { getKv } = await import("@/lib/kv")
    const won = await getKv().eval<number>(LEASE_ACQUIRE_SCRIPT, [key], [owner, String(PUBLISH_LEASE_TTL_MS)])
    return Number(won) === 1
  } catch (e) {
    log.warn("chartfam lease acquire failed (fail-open, no publish)", {
      error: e instanceof Error ? e.message : String(e),
    })
    return false
  }
}

async function releaseKvLease(key: string, owner: string): Promise<void> {
  try {
    const { getKv } = await import("@/lib/kv")
    await getKv().eval<number>(LEASE_RELEASE_SCRIPT, [key], [owner])
  } catch {
    // TTL reaps it; never throw on the serving path.
  }
}

function filePersist(dir: string): ChartFamilyPersist {
  // Windows forbids `:` (and several other chars) in file names while KV keys
  // use them freely: sanitize to [a-zA-Z0-9_-] (group hashes stay unique).
  const safe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, "-")
  const pubFile = (group: string, family: string): string => path.join(dir, `chartfam-pub-${safe(group)}-${safe(family)}.json`)
  const metaFile = (group: string, family: string): string => path.join(dir, `chartfam-meta-${safe(group)}-${safe(family)}.json`)
  const readJson = async (file: string): Promise<unknown | null> => {
    try {
      return JSON.parse(await fsp.readFile(file, "utf-8"))
    } catch {
      return null
    }
  }
  return {
    async loadPublished(group, family) {
      return isValidSnapshot(await readJson(pubFile(group, family)), group, family)
    },
    async commitPublished(group, family, slot, snap, leaseOwner) {
      // Single-process exactness: the whole read-check-write is serialized
      // per family (see withFamilyCommitLock), so a delayed in-flight write
      // can never land after a newer publish. The durable guard here is the
      // owner check (a live lease held by another owner loses immediately)
      // plus the generation recheck. Multi-process file mode is best-effort:
      // multi-instance deployments MUST configure KV (see module header).
      return withFamilyCommitLock(familyKey(group, family), async (): Promise<ChartCommitResult> => {
        if (!leaseOwner || chartCommitOwnerMismatch(group, family, leaseOwner)) {
          log.debug("chartfam file commit rejected (stale owner)", { group, family })
          return "stale"
        }
        try {
          const cur = await readJson(pubFile(group, family))
          const valid = isValidSnapshot(cur, group, family)
          if (valid && valid.generation >= slot) return "stale"
          if (snapshotPayloadSize(snap) > MAX_SNAPSHOT_BYTES) {
            log.warn("chartfam snapshot oversized, publish refused", { group, family })
            return "error"
          }
          try {
            await atomicWriteFile(pubFile(group, family), JSON.stringify(snap))
            // Disk hygiene (owned cleanup, awaited in the owning request — no
            // untracked background work): drop only long-orphaned family files.
            // Published snapshots keep the 7d KV-parity retention; failure-gate
            // metas (60s gates) sweep at 36h. Publish cadence is 2/day so the
            // readdir cost is negligible.
            await sweepFamilyFiles(dir)
          } catch (e) {
            log.warn("chartfam file commit failed (last good snapshot kept)", {
              error: e instanceof Error ? e.message : String(e),
            })
            return "error"
          }
          return "ok"
        } catch {
          return "error"
        }
      })
    },
    async loadMeta(group, family) {
      const raw = await readJson(metaFile(group, family))
      if (!raw || typeof raw !== "object") return null
      const m = raw as Record<string, unknown>
      if (typeof m.lastFailureAt !== "number" || typeof m.nextRetryAt !== "number") return null
      return { lastFailureAt: m.lastFailureAt, nextRetryAt: m.nextRetryAt }
    },
    async saveMeta(group, family, meta) {
      try {
        await atomicWriteFile(metaFile(group, family), JSON.stringify(meta))
      } catch (e) {
        log.warn("chartfam file write failed (fail-open, memory only)", {
          error: e instanceof Error ? e.message : String(e),
        })
      }
    },
  }
}

async function sweepFamilyFiles(dir: string): Promise<void> {
  let entries: string[]
  try {
    entries = await fsp.readdir(dir)
  } catch {
    return
  }
  const cands = entries.filter((e) => e.startsWith("chartfam-")).slice(0, MAX_FAMILY_FILES_SWEEP)
  const now = Date.now()
  await Promise.all(
    cands.map(async (e) => {
      try {
        // Retention is per artifact kind (never by publishing family): a
        // 7d-retained last-good snapshot of a family in outage is NOT garbage
        // collected just because another family keeps publishing.
        const retention = e.startsWith("chartfam-pub-") ? PUB_FILE_RETENTION_MS : META_FILE_RETENTION_MS
        const st = await fsp.stat(path.join(dir, e))
        if (now - st.mtimeMs > retention) await fsp.unlink(path.join(dir, e)).catch(() => {})
      } catch {
        // best-effort sweep only
      }
    }),
  )
}
const noopPersist: ChartFamilyPersist = {
  async loadPublished() {
    return null
  },
  async commitPublished() {
    // No durable backend configured (test memory mode): the process memory
    // IS the store, so the commit "lands" and the caller marks memory.
    // This is distinct from a FAILING backend ("error"/throw), which must
    // refuse so no private unpublished snapshot is ever marked.
    return "ok"
  },
  async loadMeta() {
    return null
  },
  async saveMeta() {},
}

/** Test-only persist override (per test FILE module registry: hermetic). */
let persistOverride: ChartFamilyPersist | null = null
let persistDirOverride: string | null = null

function isTestEnv(): boolean {
  return (
    process.env.VITEST === "true" ||
    process.env.VITEST === "1" ||
    !!process.env.VITEST_WORKER_ID
  )
}

function activePersist(): ChartFamilyPersist {
  if (persistOverride) return persistOverride
  if (getStorageMode() === "kv") {
    // Async backend creation cannot block the sync accessor: use a lazy
    // delegating proxy that resolves KV on first use (fail-open to noop).
    return lazyKvPersist
  }
  if (isTestEnv()) return noopPersist
  return filePersist(persistDirOverride ?? DATA_DIR)
}

let kvPersistInstance: ChartFamilyPersist | null | undefined
const lazyKvPersist: ChartFamilyPersist = {
  async loadPublished(group, family) {
    return (await kvOrNoop()).loadPublished(group, family)
  },
  async commitPublished(group, family, slot, snap, leaseOwner) {
    return (await kvOrNoop()).commitPublished(group, family, slot, snap, leaseOwner)
  },
  async loadMeta(group, family) {
    return (await kvOrNoop()).loadMeta(group, family)
  },
  async saveMeta(group, family, meta) {
    return (await kvOrNoop()).saveMeta(group, family, meta)
  },
}

async function kvOrNoop(): Promise<ChartFamilyPersist> {
  if (kvPersistInstance === undefined) kvPersistInstance = await kvPersist()
  return kvPersistInstance ?? noopPersist
}

// --- In-memory state (per process; per test-FILE registry) -------------------

const publishedByFamily = new Map<string, { snap: ChartFamilySnapshot; loadedAt: number }>()
const metaByFamily = new Map<string, FailureMeta>()
const leaseByFamily = new Map<string, { owner: string; expiresAt: number }>()

/**
 * Per-family commit mutex (single-process serialization). File read-check-
 * write is not atomic across awaits: without this, a delayed in-flight
 * commit that already passed the generation guard could land AFTER a newer
 * publish (last-writer-wins) even single-process once the lease window
 * lapped it. The mutex serializes whole commits; the generation recheck
 * inside then decides on fresh state. Completed chains are dropped so the
 * map only holds in-flight families.
 */
const commitLocks = new Map<string, Promise<void>>()

async function withFamilyCommitLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = commitLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const cur = new Promise<void>((r) => {
    release = r
  })
  const chained = prev.then(() => cur)
  commitLocks.set(key, chained)
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (commitLocks.get(key) === chained) commitLocks.delete(key)
  }
}

/**
 * True when the caller must NOT publish: it does not hold the live,
 * unexpired lease for this family. Guarded publication requires the actual
 * owner + an unexpired lease on the file and test-memory backends (kept
 * serialized via the commit mutex + generation recheck); KV enforces the
 * same atomically via its Lua commit. No live entry (never acquired,
 * expired, or released) means a stale owner — the generation guard alone is
 * not enough. Multi-process file mode stays best-effort: multi-instance
 * deployments MUST configure KV (see module header).
 */
function chartCommitOwnerMismatch(group: string, family: string, leaseOwner: string): boolean {
  const key = familyKey(group, family)
  const mem = leaseByFamily.get(key)
  if (!mem) return true
  if (mem.expiresAt <= Date.now()) return true
  return mem.owner !== leaseOwner
}

function evictOldest(map: Map<string, unknown>, cap: number): void {
  while (map.size > cap) {
    const first = map.keys().next().value
    if (first === undefined) break
    map.delete(first)
  }
}

function familyKey(group: string, family: string): string {
  return `${group}:${family}`
}

// --- Public API ------------------------------------------------------------------

export interface ChartFamilyInput extends ChartGroupInput {
  readonly family: string
}

/**
 * Pin ONE family's snapshot for a request. Always revalidates against durable
 * storage first (single source of truth): a publish by another instance cuts
 * over immediately — old ready-body keys stop serving at once (strict
 * cutover). Memory is only a fallback when durable storage is unavailable or
 * empty. Returns the last good published snapshot, or live mode when cold
 * (never published): cold requests use uniformly-live reads that publish on
 * success. The pin (id + snapshot) must be captured once per request and
 * reused for every read/key in that request (mid-request consistency: a slot
 * rolling mid-request never changes the pinned id).
 */
export async function pinChartFamily(input: ChartFamilyInput): Promise<ChartFamilyPin> {
  const group = chartFamilyGroupKey(input)
  try {
    const stored = await activePersist().loadPublished(group, input.family)
    if (stored) {
      publishedByFamily.set(familyKey(group, input.family), { snap: stored, loadedAt: Date.now() })
      evictOldest(publishedByFamily, MAX_GROUPS_MEMORY)
      return { id: stored.generation, snapshot: stored }
    }
  } catch {
    // Durable read failed: fall through to memory (fail-open serving).
  }
  const mem = publishedByFamily.get(familyKey(group, input.family))
  if (mem) return { id: mem.snap.generation, snapshot: mem.snap }
  return { id: CHART_LIVE_PIN_ID, snapshot: null }
}

/**
 * Failure-gate state: true while a source failure blocks publish retries for
 * this family (>= 60s). Refreshes skip fetching while gated (publish
 * couldn't land anyway); the next request resumes.
 */
export async function isChartFamilyGated(input: ChartFamilyInput): Promise<boolean> {
  const group = chartFamilyGroupKey(input)
  let meta: FailureMeta | null = metaByFamily.get(familyKey(group, input.family)) ?? null
  if (!meta) {
    try {
      meta = await activePersist().loadMeta(group, input.family)
    } catch {
      meta = null
    }
  }
  return !!meta && Date.now() < meta.nextRetryAt
}

async function recordFamilyFailure(group: string, family: string): Promise<void> {
  const now = Date.now()
  const meta: FailureMeta = { lastFailureAt: now, nextRetryAt: now + CHART_FAILURE_RETRY_MS }
  metaByFamily.set(familyKey(group, family), meta)
  try {
    await activePersist().saveMeta(group, family, meta)
  } catch {
    // fail-open
  }
}

/**
 * Non-blocking owner lease for one family's refresh critical section. At
 * most one owner fetches+commits per group+family at a time; competitors get
 * null and keep serving the pinned (old) snapshot. The lease TTL bounds a
 * crashed owner.
 */
export async function tryAcquireChartFamilyLease(input: ChartFamilyInput): Promise<string | null> {
  const group = chartFamilyGroupKey(input)
  const key = familyKey(group, input.family)
  const now = Date.now()
  const mem = leaseByFamily.get(key)
  if (mem && mem.expiresAt > now) return null
  const owner = crypto.randomUUID()
  if (getStorageMode() === "kv") {
    const won = await acquireKvLease(kvLeaseKey(group, input.family), owner)
    if (!won) return null
  }
  // File/memory mode: single-process exact via the memory lease (multi-process
  // file is best-effort — atomic replace + generation guard on re-read; see
  // module header: multi-instance deployments MUST configure KV).
  leaseByFamily.set(key, { owner, expiresAt: now + PUBLISH_LEASE_TTL_MS })
  return owner
}

export async function releaseChartFamilyLease(input: ChartFamilyInput, owner: string): Promise<void> {
  const group = chartFamilyGroupKey(input)
  const key = familyKey(group, input.family)
  const mem = leaseByFamily.get(key)
  if (mem && mem.owner === owner) leaseByFamily.delete(key)
  if (getStorageMode() === "kv") await releaseKvLease(kvLeaseKey(group, input.family), owner)
}

/**
 * Guarded atomic publish of ONE family's snapshot (the refresh owner calls
 * this after its bounded fetch). "ok"/"empty" validate fail-closed and
 * commit; "error" records the 60s failure gate and keeps the last good
 * snapshot. Slot rollover during the fetch aborts the commit (stale slot
 * never overwrites a newer publish). Anything but "ok" leaves memory
 * untouched except adopting a concurrent winner ("stale"): no private
 * unpublished publication, last good snapshot kept.
 */
export async function commitChartFamilySnapshot(
  input: ChartFamilyInput & {
    readonly rows: unknown
    readonly status: ChartFamilyStatus
    readonly provenance?: ChartFamilyProvenance
    readonly slot?: string
    readonly fetchedAt?: number
  },
  owner: string,
): Promise<ChartFamilyPin> {
  const group = chartFamilyGroupKey(input)
  const key = familyKey(group, input.family)
  const now = Date.now()
  const slot = input.slot ?? romeSlotKey(now)
  if (input.status === "error") {
    await recordFamilyFailure(group, input.family)
    log.debug("chartfam family error; last good snapshot kept", {
      group: describeChartGroup(input),
      family: input.family,
    })
    return pinChartFamily(input)
  }
  const rows = normalizeRows(input.rows, familyRowCap(input.family), input.family.startsWith("anime:"))
  if (!rows) {
    await recordFamilyFailure(group, input.family)
    return pinChartFamily(input)
  }
  const status: Exclude<ChartFamilyStatus, "error"> = input.status === "empty" || rows.length === 0 ? "empty" : "ok"
  // Abort on slot rollover during the fetch: a stale slot never publishes.
  if (romeSlotKey(now) !== slot) return pinChartFamily(input)
  const snap: ChartFamilySnapshot = {
    generation: slot,
    group,
    family: input.family,
    status,
    rows,
    fetchedAt: input.fetchedAt ?? now,
    publishedAt: now,
    provenance: input.provenance ?? null,
  }
  if (snapshotPayloadSize(snap) > MAX_SNAPSHOT_BYTES) {
    log.warn("chartfam snapshot oversized, publish skipped", { group, family: input.family })
    await recordFamilyFailure(group, input.family)
    return pinChartFamily(input)
  }
  let outcome: ChartCommitResult = "error"
  try {
    outcome = await activePersist().commitPublished(group, input.family, slot, snap, owner)
  } catch (e) {
    log.warn("chartfam commit threw (last good snapshot kept)", {
      error: e instanceof Error ? e.message : String(e),
    })
    outcome = "error"
  }
  if (outcome === "ok") {
    publishedByFamily.set(key, { snap, loadedAt: now })
    evictOldest(publishedByFamily, MAX_GROUPS_MEMORY)
    metaByFamily.delete(key)
    log.debug("chartfam published new snapshot", { group, family: input.family, generation: slot })
  } else if (outcome === "stale") {
    // A concurrent owner won: adopt the winner so this process converges
    // without waiting for its own memory refresh.
    try {
      const winner = await activePersist().loadPublished(group, input.family)
      if (winner) {
        publishedByFamily.set(key, { snap: winner, loadedAt: Date.now() })
        evictOldest(publishedByFamily, MAX_GROUPS_MEMORY)
      }
    } catch {
      // fail-open
    }
  }
  return pinChartFamily(input)
}

// --- Test hooks ---------------------------------------------------------------

/** Test-only: file backend factory for a directory (restart-safety tests). */
export function __fileChartGenerationPersistForTest(dir: string): ChartFamilyPersist {
  return filePersist(dir)
}

/** Test-only: replace the persistence backend (hermetic, per test file). */
export function __setChartGenerationPersistForTest(persist: ChartFamilyPersist | null): void {
  persistOverride = persist
}

/** Test-only: override the file persistence directory. */
export function __setChartGenerationDirForTest(dir: string | null): void {
  persistDirOverride = dir
}

/** Test-only: drop all in-memory family state (isolation, not weakening). */
export function __resetChartGenerationForTest(): void {
  publishedByFamily.clear()
  metaByFamily.clear()
  leaseByFamily.clear()
  commitLocks.clear()
  kvPersistInstance = undefined
}

/** In-memory persist backend for tests (KV/file stand-ins). */
export function __inMemoryChartGenerationPersist(): ChartFamilyPersist & {
  published: Map<string, ChartFamilySnapshot>
  metas: Map<string, FailureMeta>
} {
  const published = new Map<string, ChartFamilySnapshot>()
  const metas = new Map<string, FailureMeta>()
  return {
    published,
    metas,
    async loadPublished(group, family) {
      return published.get(`${group}:${family}`) ?? null
    },
    async commitPublished(group, family, slot, snap, leaseOwner) {
      // Test backend: synchronous read-check-write (no awaits inside, so no
      // interleave), but the stale-owner guard matches the file backend so
      // single-process ordering regressions are caught here too. Guarded
      // publication requires the live owner: missing/expired/released owners
      // lose even when the generation looks current.
      if (!leaseOwner || chartCommitOwnerMismatch(group, family, leaseOwner)) return "stale"
      const cur = published.get(`${group}:${family}`)
      if (cur && cur.generation >= slot) return "stale"
      published.set(`${group}:${family}`, snap)
      return "ok"
    },
    async loadMeta(group, family) {
      return metas.get(`${group}:${family}`) ?? null
    },
    async saveMeta(group, family, meta) {
      metas.set(`${group}:${family}`, meta)
    },
  }
}
