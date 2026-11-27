/**
 * Server-only AV specs resolver: remote snapshot over the bundled seed.
 *
 * `src/data/av-specs.json` (see `av-specs.ts`) is the bundled SEED. At runtime
 * the same-shaped JSON is fetched from GitHub every 24 h and its entries win
 * over the seed per imdb id; ids absent remotely still resolve from the seed.
 * The refresh is fire-and-forget (a lookup never waits for the network) and
 * fail-closed (bad status, size, JSON or too few valid entries keep the
 * previous index). Same pattern as `anime-filler.ts`.
 *
 * Env: `PICTORIUM_AV_SPECS_URL` (`off` disables), `PICTORIUM_AV_SPECS_REFRESH_HOURS`
 * (0 = once per process). Import from server code only: the client keeps the
 * bundled seed through `lookupAVSpecs`.
 */
import { lookupAVSpecs, isVideoFormat, type AVSpecEntry, type VideoFormat } from "@/lib/av-specs"

const DEFAULT_REMOTE_URL = "https://raw.githubusercontent.com/Eful97/pictorium-quality-database/main/av-specs.json"
const configuredUrl = (process.env.PICTORIUM_AV_SPECS_URL ?? "").trim()
const REMOTE_URL = configuredUrl === "" ? DEFAULT_REMOTE_URL : configuredUrl
const REMOTE_DISABLED = REMOTE_URL.toLowerCase() === "off"
const configuredHours = Number(process.env.PICTORIUM_AV_SPECS_REFRESH_HOURS ?? "24")
const REFRESH_HOURS = Number.isFinite(configuredHours) && configuredHours >= 0 ? configuredHours : 24
const REFRESH_MS = REFRESH_HOURS === 0 ? Number.POSITIVE_INFINITY : REFRESH_HOURS * 60 * 60 * 1000
const RETRY_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000
const MAX_BYTES = 5 * 1024 * 1024
const MIN_REMOTE_ENTRIES = 100
const QUALITIES: ReadonlySet<string> = new Set(["4K", "FHD", "HD", "SD"])
const IMDB_ID = /^tt\d+$/

let remote: ReadonlyMap<string, AVSpecEntry> | null = null
let loadedAt = 0
let lastAttemptAt = 0
let inFlight = false
let etag: string | null = null

function parseEntry(raw: unknown): AVSpecEntry | null {
  if (!raw || typeof raw !== "object") return null
  const { quality, formats } = raw as { quality?: unknown; formats?: unknown }
  const q = typeof quality === "string" && QUALITIES.has(quality) ? (quality as AVSpecEntry["quality"]) : undefined
  const f = Array.isArray(formats) ? (formats.filter((x) => typeof x === "string" && isVideoFormat(x)) as VideoFormat[]) : undefined
  if (!q && (!f || f.length === 0)) return null
  return { ...(q ? { quality: q } : {}), ...(f && f.length > 0 ? { formats: f } : {}) }
}

function parseSnapshot(parsed: unknown): Map<string, AVSpecEntry> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const map = new Map<string, AVSpecEntry>()
  for (const [id, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!IMDB_ID.test(id)) continue
    const entry = parseEntry(raw)
    if (entry) map.set(id, entry)
  }
  return map.size >= MIN_REMOTE_ENTRIES ? map : null
}

async function fetchRemote(): Promise<boolean> {
  try {
    const response = await fetch(REMOTE_URL, {
      headers: etag && remote ? { "if-none-match": etag } : { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
      redirect: "follow",
    })
    if (response.status === 304 && remote) {
      loadedAt = Date.now()
      return true
    }
    if (!response.ok) return false
    const declared = Number(response.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > MAX_BYTES) return false
    const text = await response.text()
    if (text.length > MAX_BYTES) return false
    const map = parseSnapshot(JSON.parse(text))
    if (!map) return false
    remote = map
    loadedAt = Date.now()
    etag = response.headers.get("etag")
    return true
  } catch {
    return false
  }
}

function maybeRefresh(): void {
  if (REMOTE_DISABLED || inFlight) return
  const now = Date.now()
  if (remote && now - loadedAt < REFRESH_MS) return
  if (now - lastAttemptAt < RETRY_MS) return
  lastAttemptAt = now
  inFlight = true
  void fetchRemote().finally(() => {
    inFlight = false
  })
}

/** Remote entry when loaded, else the bundled seed; null when neither knows the id. */
export function lookupAVSpecsServer(id: string | null | undefined): AVSpecEntry | null {
  maybeRefresh()
  if (!id) return null
  return remote?.get(id.trim()) ?? lookupAVSpecs(id)
}

/** Test/admin hook: refresh now and report whether the snapshot is current. */
export async function refreshAVSpecsNow(): Promise<boolean> {
  if (REMOTE_DISABLED) return false
  lastAttemptAt = Date.now()
  return fetchRemote()
}

/** Test hook: drop remote state. */
export function __resetAVSpecsRemoteForTests(): void {
  remote = null
  loadedAt = 0
  lastAttemptAt = 0
  inFlight = false
  etag = null
}
