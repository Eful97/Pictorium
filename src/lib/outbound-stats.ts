/**
 * Telemetria outbound per host (Step 0a, I/O audit).
 *
 * Conta richieste/errori e latenza delle fetch upstream, raggruppate per
 * hostname. Mai payload, mai chiavi: la key è solo l'hostname.
 * Bounded per-host state (64 hosts, oldest evicted) plus one weakly held
 * per-Response observation for opt-in body telemetry (never outlives its
 * Response, dropped on reset).
 * Solo osservabilità: non cambia retry, timeout o cache di nessun caller.
 *
 * Field semantics (backwards compatible):
 * - `requests`/`errors`/`avgMs`/`lastMs`: legacy, unchanged. `errors` counts
 *   ONLY transport failures (sync throw / fetch rejection), never HTTP
 *   4xx/5xx — existing scripts (bench/load-smoke) read these fields and stay
 *   byte-compatible.
 * - `httpErrors`: resolved responses with `status >= 400` (4xx/5xx). Kept
 *   separate from `errors` so a rate-limit 429 never looks like a dead socket.
 * - `transportErrors`: explicit alias of `errors` (transport throw/reject).
 * - `avgMs`/`lastMs` measure time until the fetch promise resolves (response
 *   headers available). That is neither a precise TTFB nor a full-body
 *   transfer time: a stream that is never read still looks "fast". The
 *   `avgHeaderMs`/`lastHeaderMs` aliases name the same measurement honestly.
 * - `bodyReads`/`bodyErrors`/`bodyBytes`/`avgBodyReadMs`/`lastBodyReadMs`:
 *   OPT-IN telemetry of the body-read phase only, recorded solely when the
 *   caller (instrumented image paths: fetchImg + portrait/landscape auto-fit
 *   callbacks) consumes the body via `readResponseBody`. Partial coverage by
 *   design: streams that are never read produce no body telemetry, and a full
 *   transfer is never faked. Body counters never inflate
 *   `requests`/`errors`/`httpErrors`. `avgBodyReadMs` averages successful
 *   reads only (denominator `bodyReads`); `lastBodyReadMs` is the duration of
 *   the latest `arrayBuffer()`, success or failure.
 */

export interface OutboundHostStats {
  readonly requests: number
  readonly errors: number
  readonly avgMs: number
  readonly lastMs: number
  /** Resolved responses with HTTP status >= 400 (429/5xx included). Never in `errors`. */
  readonly httpErrors: number
  /** Explicit alias of `errors`: sync throws + transport rejections. */
  readonly transportErrors: number
  /** Honest alias of `avgMs`: time-to-headers, neither precise TTFB nor full-body time. */
  readonly avgHeaderMs: number
  /** Honest alias of `lastMs`: time-to-headers, neither precise TTFB nor full-body time. */
  readonly lastHeaderMs: number
  /** Body reads completed via `readResponseBody` (instrumented paths only). */
  readonly bodyReads: number
  /** Body reads failed via `readResponseBody` (aborts included). */
  readonly bodyErrors: number
  /** Body bytes consumed on success (sum, instrumented paths only). */
  readonly bodyBytes: number
  /** Mean `arrayBuffer()`-only duration over successful reads (denominator `bodyReads`). */
  readonly avgBodyReadMs: number
  /** Duration of the latest `arrayBuffer()` (body phase only), success or failure. */
  readonly lastBodyReadMs: number
}

interface MutableHostStats {
  requests: number
  errors: number
  totalMs: number
  lastMs: number
  httpErrors: number
  transportErrors: number
  bodyReads: number
  bodyErrors: number
  bodyBytes: number
  bodyTotalReadMs: number
  lastBodyReadMs: number
}

function freshHostStats(): MutableHostStats {
  return {
    requests: 0,
    errors: 0,
    totalMs: 0,
    lastMs: 0,
    httpErrors: 0,
    transportErrors: 0,
    bodyReads: 0,
    bodyErrors: 0,
    bodyBytes: 0,
    bodyTotalReadMs: 0,
    lastBodyReadMs: 0,
  }
}

const MAX_HOSTS = 64
const hosts = new Map<string, MutableHostStats>()

/**
 * Responses created by timedFetch with a pending potential body read.
 * WeakMap: never retains Responses past their lifetime; recreated on reset
 * so pre-reset observations cannot pollute fresh counters.
 */
let trackedResponses = new WeakMap<object, { host: string }>()

function forHost(host: string): MutableHostStats {
  let s = hosts.get(host)
  if (!s) {
    if (hosts.size >= MAX_HOSTS) hosts.delete(hosts.keys().next().value!)
    s = freshHostStats()
    hosts.set(host, s)
  }
  return s
}

type HeaderOutcome = "ok" | "http-error" | "transport-error"

function recordHeader(host: string, ms: number, outcome: HeaderOutcome): void {
  const s = forHost(host)
  s.requests++
  if (outcome === "transport-error") {
    s.errors++
    s.transportErrors++
  } else if (outcome === "http-error") {
    s.httpErrors++
  }
  s.totalMs += ms
  s.lastMs = ms
}

/** True only for numeric HTTP statuses >= 400; exotic shapes are never blamed. */
function isHttpErrorStatus(res: unknown): boolean {
  try {
    const status = (res as { status?: unknown } | null | undefined)?.status
    return typeof status === "number" && Number.isFinite(status) && status >= 400
  } catch {
    return false
  }
}

function trackForBody(res: unknown, host: string): void {
  try {
    if ((typeof res === "object" && res !== null) || typeof res === "function") {
      trackedResponses.set(res as object, { host })
    }
  } catch {
    // Best-effort stats: never break the caller.
  }
}

function hostOf(url: string | URL): string {
  try {
    return new URL(String(url)).hostname || "unknown"
  } catch {
    return "unknown"
  }
}

/**
 * Drop-in della global fetch con conteggio per host. Delega 1:1 (stessi
 * argomenti, stessa promise): i mock su globalThis.fetch restano intercettati
 * perché la lookup è al momento della chiamata, non all'import.
 * Trasparente anche verso stub esotici: un valore non-promise viene assimilato
 * via Promise.resolve (come farebbe await), un throw sincrono resta sincrono.
 * The returned Response is the original object (same identity, no
 * clone/tee/proxy): read it as before, or via `readResponseBody` to add
 * body-completion telemetry.
 */
export function timedFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const host = hostOf(url)
  const t0 = Date.now()
  let result: unknown
  try {
    result = fetch(url, init)
  } catch (err) {
    recordHeader(host, Date.now() - t0, "transport-error")
    throw err
  }
  return Promise.resolve(result as Response | Promise<Response>).then(
    (res) => {
      recordHeader(host, Date.now() - t0, isHttpErrorStatus(res) ? "http-error" : "ok")
      trackForBody(res, host)
      return res
    },
    (err) => {
      recordHeader(host, Date.now() - t0, "transport-error")
      throw err
    },
  )
}

/**
 * OPT-IN body read with real completion telemetry.
 *
 * Delegates the single read to `res.arrayBuffer()`: same bytes out, same
 * error instance rethrown on failure, no clone/tee/proxy, Response identity
 * intact, stream and backpressure unchanged. Does not touch the caller's
 * timeout/signal/retry/cache/SSRF/size-guard: it only measures.
 *
 * - Only Responses created by `timedFetch` feed the body counters; foreign
 *   Responses are read normally with no fabricated stats.
 * - `lastBodyReadMs` is the duration of `arrayBuffer()` alone; the
 *   request-to-consumed total is headerMs + caller idle + bodyReadMs (caller
 *   buffering idle is attributed to no phase).
 * - Covers only instrumented image paths (fetchImg + auto-fit callbacks):
 *   not a complete upstream transfer telemetry.
 */
export async function readResponseBody(res: Response): Promise<ArrayBuffer> {
  let host: string | null = null
  try {
    host = trackedResponses.get(res as unknown as object)?.host ?? null
  } catch {
    host = null
  }
  if (host === null) return res.arrayBuffer()
  const t0 = Date.now()
  try {
    const buf = await res.arrayBuffer()
    let bytes = 0
    try {
      bytes = typeof buf?.byteLength === "number" && Number.isFinite(buf.byteLength) ? buf.byteLength : 0
    } catch {
      bytes = 0
    }
    const s = forHost(host)
    s.bodyReads++
    s.bodyBytes += bytes
    const readMs = Date.now() - t0
    s.bodyTotalReadMs += readMs
    s.lastBodyReadMs = readMs
    return buf
  } catch (err) {
    const s = forHost(host)
    s.bodyErrors++
    s.lastBodyReadMs = Date.now() - t0
    throw err
  }
}

/**
 * OPT-IN body read with a hard size cap, streaming with a running counter.
 *
 * Same telemetry contract as `readResponseBody` (bodyReads/bodyBytes on a
 * completed read, bodyErrors + lastBodyReadMs on failure) plus a cap: the
 * body is consumed chunk-by-chunk and the stream is cancelled as soon as the
 * running total exceeds `maxBytes`, so a chunked response without a
 * content-length header can never allocate past the cap (the
 * arrayBuffer-then-check alternative buffers the whole body first).
 *
 * Exotic Responses without a readable stream (test doubles) fall back to
 * `readResponseBody`: same bytes, cap checked after the read.
 */
export async function readResponseBodyCapped(
  res: Response,
  maxBytes: number,
  tooLargeError: () => Error,
): Promise<ArrayBuffer> {
  let host: string | null = null
  try {
    host = trackedResponses.get(res as unknown as object)?.host ?? null
  } catch {
    host = null
  }
  let body: ReadableStream<Uint8Array> | null | undefined
  try {
    body = (res as { body?: ReadableStream<Uint8Array> | null }).body
  } catch {
    body = null
  }
  if (!body || typeof body.getReader !== "function") {
    // Exotic test doubles without a stream: same bytes, cap checked after.
    const buf = await readResponseBody(res)
    if (buf.byteLength > maxBytes) throw tooLargeError()
    return buf
  }
  const t0 = Date.now()
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        // Stop the transfer now: the remaining chunks are never allocated.
        await reader.cancel().catch(() => {})
        throw tooLargeError()
      }
      chunks.push(value)
    }
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (host !== null) {
      const s = forHost(host)
      s.bodyReads++
      s.bodyBytes += total
      const readMs = Date.now() - t0
      s.bodyTotalReadMs += readMs
      s.lastBodyReadMs = readMs
    }
    return out.buffer
  } catch (err) {
    if (host !== null) {
      const s = forHost(host)
      s.bodyErrors++
      s.lastBodyReadMs = Date.now() - t0
    }
    throw err
  }
}

export function outboundStats(): Record<string, OutboundHostStats> {
  const out: Record<string, OutboundHostStats> = {}
  for (const [host, s] of hosts) {
    const avg = s.requests > 0 ? Math.round((s.totalMs / s.requests) * 10) / 10 : 0
    out[host] = {
      requests: s.requests,
      errors: s.errors,
      avgMs: avg,
      lastMs: s.lastMs,
      httpErrors: s.httpErrors,
      transportErrors: s.transportErrors,
      avgHeaderMs: avg,
      lastHeaderMs: s.lastMs,
      bodyReads: s.bodyReads,
      bodyErrors: s.bodyErrors,
      bodyBytes: s.bodyBytes,
      avgBodyReadMs: s.bodyReads > 0 ? Math.round((s.bodyTotalReadMs / s.bodyReads) * 10) / 10 : 0,
      lastBodyReadMs: s.lastBodyReadMs,
    }
  }
  return out
}

/** Test-only: reset counters (and pending body observations). */
export function __resetOutboundStatsForTest(): void {
  hosts.clear()
  trackedResponses = new WeakMap()
}
