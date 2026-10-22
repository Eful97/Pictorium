// Optional chart warmup runner for Pictorium (opt-in, off by default).
//
// What it does: after a Rome 00:00/12:00 chart slot rolls over, the first
// request to a built-in catalog pays the upstream refresh (lazy renewal).
// This script lets an OPERATOR warm those first pages ahead of traffic from
// any always-on host (VPS, home server, external scheduler) over plain HTTPS.
//
// What it does NOT do:
// - No new server endpoint, no new env vars, no scheduler enabled anywhere.
//   Until an operator runs this (by hand, cron, systemd timer, or an
//   external scheduler) nothing changes: lazy renewal keeps working as before.
// - No secrets: it only calls the installation's own PUBLIC manifest/catalog
//   GET endpoints, in a chosen user namespace context (`u`/`config`, the same
//   values already present in Stremio install URLs). It NEVER sends API keys
//   (`api_key`, `mdblist_key`, TVDB, ...): keyed rows are resolved server-side
//   from the installation's stored keys/defaults, exactly like a Stremio
//   client would. On a keyless personal installation, JustWatch-backed
//   catalogs come back empty — warm them from a configured namespace instead.
// - No cache-busting, no forced re-render: first pages only, one request per
//   catalog, bounded concurrency, stops on 429/redirect-off-origin/errors.
//   A 200 response only means the installation served the page; on upstream
//   outage the catalog intentionally serves retained rows, so "warmed" does
//   NOT prove upstream freshness (outcomes are reported honestly).
//
// Usage (one-shot, e.g. from cron — see docs/chart-warmup.md):
//   node scripts/chart-warmup.mjs --base-url https://my-host.example [--user <uuid>] [--config <token>]
// Usage (watch mode: stay resident, warm once per Rome slot):
//   node scripts/chart-warmup.mjs --base-url https://my-host.example --watch
//
// The watch process must stay running to do anything: run it on an always-on
// Node host you control. Serverless/sleeping platforms cannot keep a resident
// watcher alive — use one-shot there, triggered by a scheduler you control.
//
// Importing this module has NO side effects: the CLI only runs when the file
// is executed directly. Pure helpers are exported for unit tests.

import { pathToFileURL } from "node:url"

// --- Constants -------------------------------------------------------------

/** Chart slots renew on this IANA zone (DST-aware, server-TZ independent). */
export const CHART_WARMUP_TZ = "Europe/Rome"

/** Server-side failure gate: no retry sooner than this after an error. */
export const CHART_WARMUP_RETRY_MS = 60_000

/** Manifest catalog entries are remote content: bound before trusting. */
export const MAX_MANIFEST_CATALOGS = 200

/** Manifest bodies are remote content: bound before trusting (bytes, not chars). */
export const MANIFEST_MAX_BYTES = 512 * 1024

/**
 * Catalog IDs ride the URL path and are echoed in logs: strict allowlist so
 * control characters, query/traversal metacharacters and foreign shapes are
 * rejected before any fetch or log line. Covers every canonical built-in ID
 * (`pictorium-*` families); custom/search/external IDs are excluded anyway.
 */
export const SAFE_CATALOG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export const DEFAULT_CONCURRENCY = 2
export const MAX_CONCURRENCY = 4
export const DEFAULT_TIMEOUT_MS = 30_000
export const MIN_TIMEOUT_MS = 1_000
export const MAX_TIMEOUT_MS = 120_000
export const DEFAULT_CATALOG_LIMIT = 40
export const MAX_CATALOG_LIMIT = 100
export const MAX_REDIRECTS = 2

// --- Pure: Rome slot (mirrors src/lib/chart-generation.ts) ----------------

/**
 * Current fixed-cycle slot id in Europe/Rome ("YYYYMMDD-00" / "YYYYMMDD-12").
 * DST-aware via Intl: spring-forward skips 02:00 (still slot 00), fall-back
 * repeats 02:xx (still slot 00). Keep in sync with `romeSlotKey`.
 */
export function romeSlotKey(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHART_WARMUP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nowMs)
  const get = (type) => parts.find((p) => p.type === type)?.value ?? ""
  const date = `${get("year")}${get("month")}${get("day")}`
  const hour = parseInt(get("hour"), 10)
  const slot = Number.isFinite(hour) && hour >= 12 ? "12" : "00"
  return `${date}-${slot}`
}

function romeWallParts(nowMs) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CHART_WARMUP_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nowMs)
  const out = {}
  for (const p of parts) out[p.type] = p.value
  return out
}

/** Rome UTC offset (minutes, east-positive) at an absolute instant. */
function romeOffsetMinutesAt(utcMs) {
  const wall = romeWallParts(utcMs)
  const wallMin = Number(wall.hour) * 60 + Number(wall.minute)
  const utcMin = new Date(utcMs).getUTCHours() * 60 + new Date(utcMs).getUTCMinutes()
  let off = wallMin - utcMin
  if (off > 720) off -= 1440
  if (off < -720) off += 1440
  return off
}

/**
 * Start (inclusive, ms epoch) of a Rome slot id. Offset solved AT the slot
 * start wall time (two fixed-point iterations): a noon probe would be off by
 * one hour on DST transition days. Keep in sync with `romeSlotStartMs`.
 */
export function romeSlotStartMs(slotKey) {
  const m = /^(\d{4})(\d{2})(\d{2})-(00|12)$/.exec(slotKey)
  if (!m) return 0
  const [, y, mo, d, hh] = m
  const wallAsUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), 0, 0)
  let utc = wallAsUtc - romeOffsetMinutesAt(wallAsUtc) * 60_000
  utc = wallAsUtc - romeOffsetMinutesAt(utc) * 60_000
  return utc
}

function nextSlotKey(slotKey) {
  const m = /^(\d{4})(\d{2})(\d{2})-(00|12)$/.exec(slotKey)
  if (!m) return null
  const [, y, mo, d, hh] = m
  if (hh === "00") return `${y}${mo}${d}-12`
  const nextDay = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)) + 24 * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, "0")
  return `${nextDay.getUTCFullYear()}${pad(nextDay.getUTCMonth() + 1)}${pad(nextDay.getUTCDate())}-00`
}

/**
 * Start of the slot FOLLOWING the one containing nowMs (not start + 12h:
 * spring-forward days have an 11h 00-slot, fall-back days a 13h one).
 */
export function nextRomeSlotStartMs(nowMs = Date.now()) {
  const next = nextSlotKey(romeSlotKey(nowMs))
  if (!next) return 0
  return romeSlotStartMs(next)
}

// --- Pure: catalog selection -----------------------------------------------

/**
 * Built-in family-backed chart catalogs, by contract convention (mirrors
 * `isBuiltInChartCatalogId` in src/lib/chart-generation.ts WITHOUT copying
 * the platform inventory: prefix rules only, so future platforms are covered
 * and custom/search/people/external catalogs stay excluded).
 */
export function isWarmupCatalogId(catalogId) {
  if (typeof catalogId !== "string" || catalogId.length === 0) return false
  if (catalogId.startsWith("pictorium-custom-")) return false
  if (catalogId.startsWith("pictorium-search-")) return false
  if (catalogId.startsWith("pictorium-jw") || catalogId.startsWith("pictorium-anime")) return true
  return /^pictorium-.+-(movies|series)$/.test(catalogId)
}

function isValidCatalogEntry(entry) {
  if (!entry || typeof entry !== "object") return false
  const { id, type, extra } = entry
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return false
  // Strict ID chars: no control/query/traversal/foreign shapes in URLs or logs.
  if (!SAFE_CATALOG_ID_PATTERN.test(id)) return false
  if (type !== "movie" && type !== "series") return false
  // Required extras (e.g. search catalogs) need caller params: first-page
  // warming must not invent them.
  if (Array.isArray(extra) && extra.some((e) => e && e.isRequired === true)) return false
  return true
}

/**
 * Discover warmable catalogs from a manifest `catalogs` array (remote,
 * untrusted content): validate shape + type, keep built-ins only, cap count.
 * Returns entries in manifest order: { id, type }[].
 */
export function selectWarmupCatalogs(catalogs, limit = DEFAULT_CATALOG_LIMIT) {
  if (!Array.isArray(catalogs)) return []
  const cap = Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), MAX_CATALOG_LIMIT)) : DEFAULT_CATALOG_LIMIT
  const out = []
  for (const entry of catalogs) {
    if (out.length >= cap) break
    if (!isValidCatalogEntry(entry)) continue
    if (!isWarmupCatalogId(entry.id)) continue
    out.push({ id: entry.id, type: entry.type })
  }
  return out
}

// --- Pure: URL building (same-origin paths, encoded IDs, no API keys) ------

/**
 * Validate the operator-provided base URL. Must be http(s) with no embedded
 * credentials (avoids credential leaks on redirect). Returns the origin.
 * Throws on missing/invalid input — callers must not fetch in that case.
 */
export function parseBaseUrl(raw) {
  const value = (raw ?? "").toString().trim()
  if (!value) throw new Error("missing base URL (--base-url or PICTORIUM_BASE_URL)")
  let url
  try {
    url = new URL(value)
  } catch {
    // Never reflect operator input (may carry query tokens/secrets).
    throw new Error("invalid base URL (expected absolute http(s) URL)")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    // Generic on purpose: never reflect the unknown scheme (it may carry a
    // secret query or a custom protocol handler value).
    throw new Error("base URL must be http(s)")
  }
  if (url.username || url.password) {
    throw new Error("base URL must not embed credentials")
  }
  return url.origin
}

function contextParams(user, config) {
  const params = new URLSearchParams()
  if (user) params.set("u", user)
  if (config) params.set("config", config)
  return params
}

/** Public manifest endpoint for the chosen namespace context. */
export function buildManifestUrl(origin, { user, config } = {}) {
  const url = new URL(`${origin}/manifest.json`)
  for (const [k, v] of contextParams(user, config)) url.searchParams.set(k, v)
  return url.toString()
}

/**
 * First page of a built-in catalog for the chosen namespace context.
 * IDs ride the path (encoded); only `u`/`config` ride the query — API keys
 * never enter runner URLs (server resolves stored keys like for Stremio).
 */
export function buildCatalogUrl(origin, type, id, { user, config } = {}) {
  const url = new URL(`${origin}/catalog/${type}/${encodeURIComponent(id)}.json`)
  for (const [k, v] of contextParams(user, config)) url.searchParams.set(k, v)
  return url.toString()
}

// --- Fetch helpers (bounded, same-origin redirects only) -------------------

/**
 * Runner errors are operator-safe by construction: only these known static
 * categories (own bounded messages + HTTP status/numbers) ever reach
 * outcomes/logs. Anything else — fetch rejections, JSON syntax excerpts,
 * remote bodies — collapses to the caller-supplied generic fallback so a
 * `config=SECRET` without a URL or a parser echo can never leak.
 */
const SAFE_ERROR_MESSAGES = new Set([
  "missing base URL (--base-url or PICTORIUM_BASE_URL)",
  "invalid base URL (expected absolute http(s) URL)",
  "base URL must be http(s)",
  "base URL must not embed credentials",
  "no fetch implementation available",
  "request timed out",
  "too many redirects",
  "manifest body exceeds cap",
  "aborted",
  "manifest has no catalogs array",
  "no eligible built-in chart catalogs in manifest (custom/search/people excluded)",
  "manifest fetch failed",
  "fetch failed",
  "unknown argument (see --help)",
])

const SAFE_ERROR_PATTERNS = [
  /^redirect without same-origin location \(HTTP \d+\)$/,
  /^cross-origin redirect refused \(\d+\)$/,
  /^manifest HTTP \d+$/,
  /^manifest catalog count \d+ exceeds cap \d+$/,
  /^missing value for --[a-z-]+$/,
]

/** Bounded error category for outcomes: allowlisted own message or a static fallback. */
function toSafeError(err, fallback) {
  if (err instanceof Error) {
    if (err.name === "AbortError") return "aborted"
    const message = err.message ?? ""
    if (SAFE_ERROR_MESSAGES.has(message)) return message
    for (const re of SAFE_ERROR_PATTERNS) {
      if (re.test(message)) return message
    }
  }
  return fallback
}

/**
 * Honor the server's Retry-After on 429: delay-seconds or an HTTP-date,
 * whichever the server sent. No runner-side cap: retrying earlier than the
 * server's deadline would hammer it (callers still apply the >=60s floor).
 * Returns ms, or null when absent/invalid/past.
 */
function retryAfterMs(res, nowMs = Date.now()) {
  const raw = res.headers ? res.headers.get("retry-after") : null
  if (raw == null) return null
  const text = String(raw).trim()
  if (text === "") return null
  const secs = Number(text)
  if (Number.isFinite(secs) && /^-?\d+(\.\d+)?$/.test(text)) {
    return secs > 0 ? Math.floor(secs * 1000) : null
  }
  const at = Date.parse(text)
  if (Number.isFinite(at)) {
    return at > nowMs ? at - nowMs : null
  }
  return null
}

function combineSignals(timeoutMs, outer) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!outer) return timeout
  if (typeof AbortSignal.any === "function") return AbortSignal.any([timeout, outer])
  // Legacy runtimes without AbortSignal.any: forward both sources manually so
  // an operator abort is never silently dropped (timeout-only would ignore it).
  const controller = new AbortController()
  const forward = () => {
    try {
      controller.abort(outer.aborted ? outer.reason : timeout.reason)
    } catch {
      controller.abort()
    }
  }
  if (timeout.aborted || outer.aborted) {
    forward()
    return controller.signal
  }
  timeout.addEventListener("abort", forward, { once: true })
  outer.addEventListener("abort", forward, { once: true })
  return controller.signal
}

/**
 * GET with manual redirect handling: follow up to MAX_REDIRECTS hops ONLY
 * when the target stays same-origin (never leak `u`/`config` query context
 * to a foreign origin). Returns the final Response (caller drains it).
 *
 * The timeout is a deadline over the whole chain (plus body consumption by
 * the caller): each hop gets the remaining budget, never a fresh one.
 */
export async function fetchSameOrigin(url, { fetchImpl, timeoutMs, signal, deadlineMs } = {}) {
  const impl = fetchImpl ?? globalThis.fetch
  if (typeof impl !== "function") throw new Error("no fetch implementation available")
  const origin = new URL(url).origin
  const budget = Number.isFinite(deadlineMs) ? deadlineMs : Date.now() + timeoutMs
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const remaining = Math.min(timeoutMs, budget - Date.now())
    if (!(remaining > 0)) throw new Error("request timed out")
    const res = await impl(current, {
      redirect: "manual",
      signal: combineSignals(remaining, signal),
      headers: { accept: "application/json" },
    })
    const status = res.status ?? 0
    if (status >= 300 && status < 400) {
      const location = res.headers ? res.headers.get("location") : null
      try {
        if (res.body && typeof res.body.cancel === "function") await res.body.cancel()
      } catch {
        // Best-effort drain; the hop already failed.
      }
      if (!location || hop === MAX_REDIRECTS) {
        throw new Error(`redirect without same-origin location (HTTP ${status})`)
      }
      const next = new URL(location, current).toString()
      if (new URL(next).origin !== origin) {
        throw new Error(`cross-origin redirect refused (${status})`)
      }
      current = next
      continue
    }
    return res
  }
  throw new Error("too many redirects")
}

/**
 * Read a JSON body with a hard byte cap enforced DURING streaming: the reader
 * is cancelled as soon as the cap is exceeded, so a huge hostile body can
 * never force a full buffer (declared Content-Length is checked first).
 * Byte counts come from the wire encoding, so multibyte UTF-8 cannot smuggle
 * extra bytes past a character count. Falls back to `text()` only for
 * bounded test doubles without a stream body. The caller's remaining timeout
 * budget covers consumption; an outer abort cancels the read.
 */
async function readJsonBody(res, capBytes = MANIFEST_MAX_BYTES, opts = {}) {
  const declared = res.headers ? res.headers.get("content-length") : null
  if (declared !== null && declared !== undefined && String(declared).trim() !== "") {
    const n = Number(String(declared).trim())
    if (Number.isFinite(n) && n > capBytes) throw new Error("manifest body exceeds cap")
  }
  const stream = res.body
  if (stream && typeof stream.getReader === "function") {
    const reader = stream.getReader()
    // Quiet cancel: reader.cancel() rejects when the reader is already
    // released — that rejection must never surface (the cap/timeout/abort
    // error below is what matters).
    const cancelQuiet = (reason) => {
      try {
        const p = reader.cancel(reason)
        if (p && typeof p.catch === "function") p.catch(() => {})
      } catch {
        // Already released/closed: nothing to cancel.
      }
    }
    const chunks = []
    let total = 0
    const readLoop = (async () => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        // ArrayBuffer.isView works across realms (jsdom/test doubles) where
        // instanceof does not — and a view must never be String()ified.
        const len = ArrayBuffer.isView(value)
          ? value.byteLength
          : (value && typeof value.length === "number" ? value.length : 0)
        total += len
        if (total > capBytes) {
          cancelQuiet("cap exceeded")
          throw new Error("manifest body exceeds cap")
        }
        if (value) chunks.push(value)
      }
    })()
    const racers = [readLoop]
    let timeoutId = 0
    let onAbort = null
    if (Number.isFinite(opts.timeoutMs)) {
      racers.push(new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          cancelQuiet("timeout")
          reject(new Error("request timed out"))
        }, Math.max(1, Math.floor(opts.timeoutMs)))
      }))
    }
    if (opts.signal) {
      racers.push(new Promise((_, reject) => {
        if (opts.signal.aborted) {
          reject(new Error("aborted"))
          return
        }
        onAbort = () => {
          cancelQuiet("aborted")
          reject(new Error("aborted"))
        }
        opts.signal.addEventListener("abort", onAbort, { once: true })
      }))
    }
    try {
      await Promise.race(racers)
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      if (onAbort && opts.signal) {
        try {
          opts.signal.removeEventListener("abort", onAbort)
        } catch {
          // Best effort: the listener already fired or the signal is gone.
        }
      }
      try {
        reader.releaseLock()
      } catch {
        // Best effort: the stream is fully consumed or cancelled already.
      }
    }
    // Normalize cross-realm views (jsdom/test doubles): ArrayBuffer.isView
    // works across realms where instanceof does not. Never String() a view
    // (that would stringify bytes as "1,2,3" and corrupt sizes).
    const parts = chunks.map((c) => (ArrayBuffer.isView(c)
      ? new Uint8Array(c.buffer, c.byteOffset, c.byteLength)
      : new TextEncoder().encode(String(c))))
    let size = 0
    for (const p of parts) size += p.length
    const buf = new Uint8Array(size)
    let off = 0
    for (const p of parts) {
      buf.set(p, off)
      off += p.length
    }
    return JSON.parse(new TextDecoder("utf-8").decode(buf))
  }
  // Bounded test doubles without a stream body: still enforce the byte cap.
  const text = await res.text()
  if (new TextEncoder().encode(text).length > capBytes) throw new Error("manifest body exceeds cap")
  return JSON.parse(text)
}

async function drainBody(res) {
  try {
    if (res.body && typeof res.body.cancel === "function") await res.body.cancel()
    else if (typeof res.text === "function") await res.text()
  } catch {
    // Warming only needs the fetch to complete server-side; drain failures
    // must not fail the outcome.
  }
}

// --- One-shot ----------------------------------------------------------------

/**
 * Warm the first page of every eligible built-in catalog discovered through
 * the installation's own manifest (one-shot). Bounded serial/low-concurrency
 * network, timeout per request, stop-safe on 429/redirect/HTTP errors.
 *
 * Honest outcomes: `ok` with per-catalog 200s means the installation served
 * the pages (lazy slot refresh triggered where stale); it does NOT prove
 * upstream sources are fresh — on outage the catalog intentionally serves
 * retained rows. Transport failures keep `ok: false` with per-catalog detail.
 */
export async function runOnce(options, deps = {}) {
  const {
    baseUrl,
    user = "",
    config = "",
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    limit = DEFAULT_CATALOG_LIMIT,
    signal,
  } = options ?? {}
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== "function") throw new Error("no fetch implementation available")

  const origin = parseBaseUrl(baseUrl) // throws before any fetch
  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, MAX_CONCURRENCY))
  const timeout = Math.max(MIN_TIMEOUT_MS, Math.min(Math.floor(timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS))
  const slot = romeSlotKey(deps.nowMs ?? Date.now())

  let manifest
  try {
    // One timeout budget for the manifest fetch AND its body: the redirect
    // chain and the bounded JSON read share this deadline.
    const manifestDeadlineMs = Date.now() + timeout
    const res = await fetchSameOrigin(buildManifestUrl(origin, { user, config }), {
      fetchImpl, timeoutMs: timeout, signal, deadlineMs: manifestDeadlineMs,
    })
    if (!res.ok) {
      await drainBody(res)
      // A 429 at the manifest/proxy carries the same server deadline as a
      // catalog 429: report it so the watch honors Retry-After instead of
      // retrying at the plain 60s floor. No catalog requests follow.
      if (res.status === 429) {
        const manifestRetryAfterMs = retryAfterMs(res)
        return {
          ok: false,
          slot,
          error: "manifest HTTP 429",
          manifestTotal: 0,
          selected: 0,
          okCount: 0,
          failCount: 0,
          skippedCount: 0,
          ...(manifestRetryAfterMs != null ? { retryAfterMs: manifestRetryAfterMs } : {}),
          stopReason: "rate-limited (HTTP 429): manifest/proxy",
          results: [],
        }
      }
      return {
        ok: false,
        slot,
        error: `manifest HTTP ${res.status ?? "?"}`,
        manifestTotal: 0,
        selected: 0,
        okCount: 0,
        failCount: 0,
        skippedCount: 0,
        results: [],
      }
    }
    manifest = await readJsonBody(res, MANIFEST_MAX_BYTES, {
      timeoutMs: Math.max(1, manifestDeadlineMs - Date.now()), signal,
    })
    await drainBody(res)
  } catch (err) {
    return {
      ok: false,
      slot,
      error: toSafeError(err, "manifest fetch failed"),
      manifestTotal: 0,
      selected: 0,
      okCount: 0,
      failCount: 0,
      skippedCount: 0,
      results: [],
    }
  }

  const entries = manifest && typeof manifest === "object" ? manifest.catalogs : undefined
  if (!Array.isArray(entries)) {
    return {
      ok: false, slot, error: "manifest has no catalogs array",
      manifestTotal: 0, selected: 0, okCount: 0, failCount: 0, skippedCount: 0, results: [],
    }
  }
  if (entries.length > MAX_MANIFEST_CATALOGS) {
    return {
      ok: false, slot, error: `manifest catalog count ${entries.length} exceeds cap ${MAX_MANIFEST_CATALOGS}`,
      manifestTotal: entries.length, selected: 0, okCount: 0, failCount: 0, skippedCount: 0, results: [],
    }
  }
  const targets = selectWarmupCatalogs(entries, limit)
  if (targets.length === 0) {
    return {
      ok: false, slot, error: "no eligible built-in chart catalogs in manifest (custom/search/people excluded)",
      manifestTotal: entries.length, selected: 0, okCount: 0, failCount: 0, skippedCount: 0, results: [],
    }
  }

  const results = new Array(targets.length)
  let cursor = 0
  let stopQueue = false
  let stopReason = ""

  async function worker() {
    while (!stopQueue) {
      if (signal && signal.aborted) {
        stopQueue = true
        stopReason = "aborted"
        break
      }
      const index = cursor
      cursor += 1
      if (index >= targets.length) break
      const target = targets[index]
      const outcome = { id: target.id, type: target.type, status: "fail", statusCode: 0 }
      try {
        const res = await fetchSameOrigin(buildCatalogUrl(origin, target.type, target.id, { user, config }), {
          fetchImpl, timeoutMs: timeout, signal,
        })
        outcome.statusCode = res.status ?? 0
        if (res.ok) {
          outcome.status = "ok"
        } else if (res.status === 429) {
          outcome.status = "skipped"
          outcome.retryAfterMs = retryAfterMs(res)
          stopQueue = true
          stopReason = "rate-limited (HTTP 429): queue stopped"
        }
        await drainBody(res)
      } catch (err) {
        outcome.status = "fail"
        outcome.error = toSafeError(err, "fetch failed")
        if (signal && signal.aborted) {
          stopQueue = true
          stopReason = "aborted"
        }
      }
      results[index] = outcome
    }
  }

  await Promise.all(Array.from({ length: Math.min(workers, targets.length) }, () => worker()))

  // Entries past a 429/abort stop never started: report honestly as skipped.
  for (let i = 0; i < results.length; i += 1) {
    if (!results[i]) results[i] = { id: targets[i].id, type: targets[i].type, status: "skipped" }
  }

  const okCount = results.filter((r) => r.status === "ok").length
  const failCount = results.filter((r) => r.status === "fail").length
  const skippedCount = results.filter((r) => r.status === "skipped").length
  // Longest server-imposed wait across 429s: the watch honors it (never
  // retries earlier than the server's deadline). No success is cached here —
  // skipped runs stay `ok: false` below.
  const maxRetryAfterMs = Math.max(0, ...results.map((r) => r.retryAfterMs ?? 0))
  return {
    // Skipped (429 stop, abort) also fails the run: warming is incomplete.
    ok: failCount === 0 && skippedCount === 0 && (signal ? !signal.aborted : true),
    slot,
    manifestTotal: entries.length,
    selected: targets.length,
    okCount,
    failCount,
    skippedCount,
    ...(maxRetryAfterMs > 0 ? { retryAfterMs: maxRetryAfterMs } : {}),
    ...(stopReason ? { stopReason } : {}),
    results,
    note: "200 means the installation served the first page (stale slots refresh lazily); it does not prove upstream (JustWatch/FlixPatrol/MDBList) freshness — on outage retained rows are served by design.",
  }
}

// --- Watch mode ---------------------------------------------------------------

/**
 * Pure watch decision for tests and the loop below:
 * - new slot (and no recent error): warm it;
 * - new slot but failed <60s ago (or before the server's Retry-After): wait
 *   out the gate — never retry earlier than the server's deadline;
 * - already warmed this slot: wait until the next Rome slot starts (never
 *   re-warm). `lastSlot` is the last SUCCESSFULLY warmed slot: a failed
 *   attempt marks nothing, so the same wall slot retries after the gate.
 *   (Legacy callers passing a failed slot as `lastSlot` still get the gate
 *   instead of an idle-to-boundary sleep.)
 */
export function decideWatchAction({ nowMs, lastSlot, lastErrorMs = 0, retryNotBeforeMs = 0 }) {
  const slot = romeSlotKey(nowMs)
  if (slot !== lastSlot) {
    const gateUntil = Math.max(
      lastErrorMs > 0 ? lastErrorMs + CHART_WARMUP_RETRY_MS : 0,
      retryNotBeforeMs || 0,
    )
    if (nowMs < gateUntil) {
      return { action: "wait", slot, delayMs: gateUntil - nowMs }
    }
    return { action: "warm", slot }
  }
  if (lastErrorMs > 0) {
    const gateUntil = Math.max(lastErrorMs + CHART_WARMUP_RETRY_MS, retryNotBeforeMs || 0)
    if (nowMs < gateUntil) {
      return { action: "wait", slot, delayMs: gateUntil - nowMs }
    }
    return { action: "warm", slot }
  }
  const delayMs = Math.max(0, nextRomeSlotStartMs(nowMs) - nowMs)
  return { action: "wait", slot, delayMs: delayMs > 0 ? delayMs : CHART_WARMUP_RETRY_MS }
}

/**
 * Long-running watch: warm once per Rome slot, idle otherwise. A failed
 * warming never marks the slot done: the same wall slot retries after the
 * >=60s gate (or the server's Retry-After, whichever is later), never
 * hot-looping. Resolves on abort (SIGINT/SIGTERM wired by main); the abort
 * signal is normalized once and forwarded to every owned manifest/catalog
 * fetch so no background fetch survives the run.
 */
export async function runWatch(options, deps = {}) {
  // Exported-API style is runWatch({ baseUrl }, { signal }): normalize once
  // and pass it to EVERY owned fetch via runOnce's options (runOnce reads
  // options.signal, not deps.signal — passing only deps would leave fetches
  // unabortable).
  const effectiveSignal = deps.signal ?? options?.signal ?? null
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms, sig) => new Promise((resolve, reject) => {
    if (sig && sig.aborted) {
      reject(new Error("aborted"))
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    function cleanup() {
      clearTimeout(timer)
      if (sig) sig.removeEventListener("abort", onAbort)
    }
    function onAbort() {
      cleanup()
      reject(new Error("aborted"))
    }
    if (sig) sig.addEventListener("abort", onAbort, { once: true })
  }))
  const onEvent = deps.onEvent ?? (() => {})

  let lastSlot = null
  let lastErrorMs = 0
  let retryNotBeforeMs = 0
  for (;;) {
    if (effectiveSignal && effectiveSignal.aborted) return { stopped: true, lastSlot }
    const nowMs = now()
    const decision = decideWatchAction({ nowMs, lastSlot, lastErrorMs, retryNotBeforeMs })
    if (decision.action === "warm") {
      onEvent({ type: "slot", slot: decision.slot })
      const res = await runOnce({ ...options, signal: effectiveSignal }, { ...deps, nowMs, signal: effectiveSignal })
      if (res.ok) {
        // Success marks the slot: same-slot ticks idle to the boundary.
        lastSlot = res.slot ?? decision.slot
        lastErrorMs = 0
        retryNotBeforeMs = 0
      } else {
        // Failure marks nothing: the same wall slot retries after the gate.
        // Retry-After (seconds or HTTP-date) is honored on top of the 60s
        // floor — never earlier than the server's deadline.
        lastErrorMs = now()
        retryNotBeforeMs = lastErrorMs + Math.max(CHART_WARMUP_RETRY_MS, res.retryAfterMs ?? 0)
      }
      onEvent({ type: "result", result: res })
      continue
    }
    onEvent({ type: "idle", slot: decision.slot, delayMs: decision.delayMs })
    try {
      // Cap a single sleep so clock adjustments cannot stall the loop forever;
      // the retry deadline is re-evaluated afterwards, so a capped sleep never
      // shortens a server-imposed wait (and a warmed slot never re-warms).
      await sleep(Math.min(Math.max(decision.delayMs, 0), 60 * 60 * 1000), effectiveSignal)
    } catch {
      return { stopped: true, lastSlot }
    }
  }
}

// --- CLI -----------------------------------------------------------------------

function printHelp() {
  console.log(`chart-warmup.mjs — optional chart first-page warmer (opt-in, off by default)

Usage (one-shot):
  node scripts/chart-warmup.mjs --base-url https://my-host.example [--user <uuid>] [--config <token>]
Usage (watch: warm once per Europe/Rome 00:00/12:00 slot, stay resident):
  node scripts/chart-warmup.mjs --base-url https://my-host.example --watch

Options:
  --base-url <url>     Installation origin (or PICTORIUM_BASE_URL env). Required.
  --user <uuid>        User namespace context (or PICTORIUM_CHART_WARMUP_USER).
  --config <token>     Config-token context (or PICTORIUM_CHART_WARMUP_CONFIG).
  --concurrency <n>    Catalog fetch concurrency, 1-${MAX_CONCURRENCY} (default ${DEFAULT_CONCURRENCY}).
  --timeout-ms <n>     Per-request timeout, ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} (default ${DEFAULT_TIMEOUT_MS}).
  --limit <n>          Max catalogs to warm, 1-${MAX_CATALOG_LIMIT} (default ${DEFAULT_CATALOG_LIMIT}).
  --watch              Long-running mode (slot polling via Intl Europe/Rome).
  --json               Print the machine-readable summary.
  --help               This text.

Exit codes: 0 all warmed · 1 warmed with failures · 2 usage/config error.
API keys are never accepted, sent, or logged by this runner.`)
}

export function parseArgs(argv) {
  const out = {
    baseUrl: process.env.PICTORIUM_BASE_URL || "",
    user: process.env.PICTORIUM_CHART_WARMUP_USER || "",
    config: process.env.PICTORIUM_CHART_WARMUP_CONFIG || "",
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    limit: DEFAULT_CATALOG_LIMIT,
    watch: false,
    json: false,
    help: false,
  }
  const takeValue = (arg, name, rest, i) => {
    const eq = arg.indexOf("=")
    if (eq !== -1) return arg.slice(eq + 1)
    const next = rest[i + 1]
    if (next === undefined || next.startsWith("--")) throw new Error(`missing value for ${name}`)
    rest.splice(i + 1, 1)
    return next
  }
  const rest = [...argv]
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg === "--base-url") out.baseUrl = takeValue(arg, "--base-url", rest, i)
    else if (arg.startsWith("--base-url=")) out.baseUrl = arg.slice("--base-url=".length)
    else if (arg === "--user") out.user = takeValue(arg, "--user", rest, i)
    else if (arg.startsWith("--user=")) out.user = arg.slice("--user=".length)
    else if (arg === "--config") out.config = takeValue(arg, "--config", rest, i)
    else if (arg.startsWith("--config=")) out.config = arg.slice("--config=".length)
    else if (arg === "--concurrency") out.concurrency = Number(takeValue(arg, "--concurrency", rest, i))
    else if (arg.startsWith("--concurrency=")) out.concurrency = Number(arg.slice("--concurrency=".length))
    else if (arg === "--timeout-ms") out.timeoutMs = Number(takeValue(arg, "--timeout-ms", rest, i))
    else if (arg.startsWith("--timeout-ms=")) out.timeoutMs = arg.slice("--timeout-ms=".length)
    else if (arg === "--limit") out.limit = Number(takeValue(arg, "--limit", rest, i))
    else if (arg.startsWith("--limit=")) out.limit = Number(arg.slice("--limit=".length))
    else if (arg === "--watch") out.watch = true
    else if (arg === "--json") out.json = true
    else if (arg === "--help" || arg === "-h") out.help = true
    else throw new Error("unknown argument (see --help)")
  }
  return out
}

function summarizeForHumans(res, originHost) {
  const lines = [
    `slot=${res.slot} origin=${originHost} manifest=${res.manifestTotal} selected=${res.selected} ok=${res.okCount} fail=${res.failCount} skipped=${res.skippedCount}`,
  ]
  for (const r of res.results) {
    const detail = r.status === "ok" ? `HTTP ${r.statusCode}` : (r.error ?? `HTTP ${r.statusCode ?? "?"}`)
    lines.push(`  ${r.status.toUpperCase()} ${r.type}/${r.id} — ${detail}`)
  }
  if (res.stopReason) lines.push(`stop: ${res.stopReason}`)
  if (res.error) lines.push(`error: ${res.error}`)
  return lines.join("\n")
}

async function main() {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(`chart-warmup: ${toSafeError(err, "invalid arguments (see --help)")}`)
    printHelp()
    process.exitCode = 2
    return
  }
  if (args.help) {
    printHelp()
    return
  }
  let origin
  try {
    origin = parseBaseUrl(args.baseUrl)
  } catch (err) {
    // No fetch attempted on missing/invalid base URL.
    console.error(`chart-warmup: ${toSafeError(err, "invalid base URL")}`)
    process.exitCode = 2
    return
  }
  const originHost = new URL(origin).host
  const runOptions = {
    baseUrl: origin,
    user: args.user,
    config: args.config,
    concurrency: args.concurrency,
    timeoutMs: args.timeoutMs,
    limit: args.limit,
  }

  if (!args.watch) {
    const res = await runOnce(runOptions)
    if (args.json) console.log(JSON.stringify(res))
    else console.log(summarizeForHumans(res, originHost))
    process.exitCode = res.ok ? 0 : 1
    return
  }

  // Watch mode: stay resident until SIGINT/SIGTERM; forward abort to fetches.
  const controller = new AbortController()
  for (const sigName of ["SIGINT", "SIGTERM"]) {
    process.on(sigName, () => controller.abort())
  }
  console.log(`chart-warmup: watching Europe/Rome slots for ${originHost} (Ctrl-C to stop)`)
  await runWatch({ ...runOptions, signal: controller.signal }, {
    signal: controller.signal,
    onEvent: (event) => {
      if (args.json) {
        console.log(JSON.stringify(event))
        return
      }
      if (event.type === "slot") console.log(`slot ${event.slot}: warming…`)
      else if (event.type === "result") console.log(summarizeForHumans(event.result, originHost))
    },
  })
}

const invokedAsCli = (() => {
  try {
    return typeof process !== "undefined"
      && Array.isArray(process.argv)
      && typeof process.argv[1] === "string"
      && import.meta.url === pathToFileURL(process.argv[1]).href
  } catch {
    return false
  }
})()

if (invokedAsCli) {
  main().catch((err) => {
    console.error(`chart-warmup: ${toSafeError(err, "chart-warmup failed")}`)
    process.exitCode = 1
  })
}
