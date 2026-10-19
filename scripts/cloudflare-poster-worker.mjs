import { WorkerEntrypoint } from "cloudflare:workers";

// scripts/cloudflare-poster-worker.mjs
//
// Optional edge cache for the Pictorium poster origin. NOT deployed by this
// repo (ships wrangler.jsonc, no deploy script / no automatic deploy): paste
// this file's content into a Cloudflare Worker manually, or deploy it with
// wrangler for the native tiered path.
//
// Usage:
//   1. Create a Worker with this file's content (Cloudflare dashboard).
//   2. Set the `ORIGIN_URL` variable to the actual public poster origin
//      (default: https://pictorium.duckdns.org). It must be the real desired
//      host; the worker never derives the host from the request path.
//   3. Route poster paths to it (e.g. `posters.example.com/api/poster/*`).
//      Anything else is proxied without caching.
//
// Tiered edge caching (OPT-IN, off by default):
//   The `caches.default` layer below is LOCAL to each data center: the Cache
//   API "does not participate in tiered caching" (official Workers docs,
//   "Relationship to other caches"). Tiering comes from Workers Caching
//   (https://developers.cloudflare.com/workers/cache/), which is "tiered by
//   default" (lower tier per data center + shared upper tier; same topology
//   as zone Tiered Cache, applied automatically to the Worker, no zone
//   configuration). It keys entries by target entrypoint + path + query
//   string (order matters) + `ctx.props` + anti-poisoning headers, and it
//   partitions variants by the response `Vary` header (all names honored,
//   values compared verbatim; `Vary: *` disables caching).
//
//   This file implements the documented gateway pattern: the `default`
//   entrypoint (gateway, caching DISABLED) runs every request and keeps all
//   conservative rules below; eligible requests are forwarded over
//   `ctx.exports` to the `PosterCacheTier` named entrypoint (caching
//   ENABLED), whose responses the upper tier stores. Only requests that pass
//   the bypass gate (no credentials, no preview/refresh/live, no
//   conditional/range, poster GET only) ever reach the inner entrypoint, so
//   per-user secrets can never be collapsed into a shared upper-tier entry.
//   The inner entrypoint additionally refuses upper-tier storage (neutralized
//   `Cache-Control: no-store` with the original smuggled for gateway
//   restore) for any response the shared storage gate rejects, and for any
//   response whose `Vary` does not cover the tracked request headers present
//   on the request (upper tier could not partition it correctly).
//
//   The upper-tier key is keyed PROACTIVELY, never via `Vary` alone: the
//   gateway passes the full canonical digest (origin + path + sorted query
//   + RAW Accept/RSC classes incl. null-vs-empty absence) as the documented
//   `cf.cacheKey` override on the `ctx.exports` loopback (same-account
//   only, honored per "Custom cache keys"; entrypoint + `ctx.props` still
//   apply). `Vary` alone cannot isolate raw classes the response does not
//   list: e.g. a `Vary: Accept` response stored for a headerless request
//   would otherwise HIT for an `rsc: 1` request before the inner entrypoint
//   ever runs. The `Vary`-coverage check below stays as defense in depth.
//
//   Upper-tier freshness matches the legacy contract exactly: Workers
//   Caching honors `stale-while-revalidate`/`stale-if-error` (and, without
//   an explicit `stale-if-error`, serves stale on Worker error indefinitely
//   unless `s-maxage`/`must-revalidate`/`proxy-revalidate` is present),
//   while the legacy Cache API never serves stale. Passing the origin policy
//   through untouched would therefore EXTEND stale serving beyond the
//   explicit no-SWR Worker contract. The inner entrypoint stores an
//   edge-normalized copy upstream instead (`edgeCacheControl`: SWR/SIE
//   stripped, `stale-if-error=0` pinned so the indefinite-error default
//   cannot add stale serving) while smuggling the untouched original in
//   `x-pictorium-tier-edge-cc` for gateway restore. The client always sees
//   the exact origin policy (`Age` passthrough is header fidelity only,
//   never an expiration proof); the normalized
//   copy exists only in the upper tier. Successful tier responses are NEVER
//   duplicated into the manual `caches.default` layer: Workers Caching
//   already provides the lower + upper tiers with exact expiration, so a
//   second manual copy would only add unproven `Age`/TTL handoff semantics.
//   Pre-existing manual entries are still read before the tier hop (they
//   obey the existing finite TTL of the legacy path); only WRITES from
//   tier-served responses are skipped. Legacy behavior (flag OFF, runtime
//   without `ctx.exports`, tier failure fallback) still writes the manual
//   cache exactly as before.
//
//   Enable with ALL of the following (anything missing = legacy local-only
//   behavior, byte-identical to before):
//   - `PICTORIUM_TIERED_CACHE=1` (or `true`) in the Worker variables.
//   - Wrangler `cache.enabled` with a per-entrypoint split (requires
//     Wrangler 4.107.0+, see "Per-entrypoint caching" in the official docs):
//       { "cache": { "enabled": true },
//         "exports": { "default": { "type": "worker", "cache": { "enabled": false } },
//                        "PosterCacheTier": { "type": "worker", "cache": { "enabled": true } } } }
//     WARNING: enabling caching on the `default` entrypoint is UNSAFE here:
//     the upper-tier key does not isolate credential headers (`Cookie`,
//     `x-api-key`, ...), so a cached gateway response could be served across
//     credentials. The gateway must stay uncached; only `PosterCacheTier`
//     may be cached.
//   - The dashboard paste flow alone keeps the legacy local cache: it has no
//     wrangler config surface (this repo ships wrangler.jsonc for the native
//     tiered deployment instead). Enabling Workers Caching currently requires
//     a wrangler-based deployment (or a dashboard equivalent if/when
//     available).
//   Rejected alternative: `fetch()` subrequest `cf` tiering (zone Tiered
//   Cache / `cacheEverything` / custom `cacheKey`). The subrequest cache is
//   tiered per the TARGET zone, which here is the poster's origin host (not
//   user-controlled by default); `cacheEverything: true` would force-cache
//   private/no-store responses; custom `cacheKey` is Enterprise-only; and
//   `cf.vary` normalization would mimic origin negotiation instead of
//   tracking the raw classes below. None of that preserves the contracts.
//
//   LIVE behavior unverified in this repo (no account/zone access, no
//   deploy): verify `Cf-Cache-Status`, origin-call reduction, and header
//   fidelity on the deployed Worker before claiming tiered gains.
//
// Conservative by design (mirrors src/lib/poster-runtime-cache.ts semantics):
//   - Cache key tracks the RAW Accept header (opaque SHA-256, never in the
//     clear), so no format negotiation is mimicked and `?fmt=` overrides stay
//     distinct. The Next.js App Router RSC request headers observed live on
//     the origin (`rsc`, `next-router-state-tree`, `next-router-prefetch`,
//     `next-router-segment-prefetch`) are tracked the same way (raw values
//     plus null-vs-empty presence, opaque JSON tuple in the key input).
//   - `Vary` is always preserved to the client. A stored copy may drop only
//     the tracked tokens (the key already tracks them) and keeps the FULL
//     origin `Vary` in the reserved internal header
//     `x-pictorium-worker-origin-vary` (overwritten when spoofed); any other
//     meaningful `Vary` token (e.g. `Cookie`, `Authorization`) skips storage.
//     `Accept-Encoding` is transport-level and ignored conservatively.
//   - Credential headers / secret query keys are NEVER stripped: they bypass
//     the cache and are forwarded untouched (the origin needs them).
//   - Only `200` + exact `public` directive with a positive
//     `s-maxage`/`max-age` is stored. `private` (incl. `private="field"`),
//     `no-cache` (incl. `no-cache="field"`), `no-store`, `Set-Cookie` and
//     zero/absent/conflicting TTLs skip storage. The origin TTL is used
//     untouched: no SWR is implemented or claimed.
//   - Cache `match`/`put` failures (sync or async) never break the response;
//     `waitUntil` work logs a fixed message (no URLs, no secrets).
//   - Every response carries `x-pictorium-worker: HIT | MISS | BYPASS`
//     (diagnostic marker only).

const DEFAULT_ORIGIN_URL = "https://pictorium.duckdns.org";
const CACHE_KEY_PREFIX = "/.pictorium-poster-cache/v2/";
const POSTER_PATH_PREFIX = "/api/poster/";

// Worker-internal params: stripped from the upstream target AND from the key.
const INTERNAL_QUERY_KEYS = new Set(["__fmt", "__format"]);
// Secrets: bypass the cache, forwarded untouched, never enter the key in the clear.
const AUTH_QUERY_KEYS = new Set(["api_key", "mdblist_key", "simkl_key", "tvdb_key", "fanart_key"]);
const CREDENTIAL_HEADERS = [
  "authorization",
  "cookie",
  "x-api-key",
  "x-admin-token",
  "x-tvdb-key",
  "x-simkl-key",
  "simkl-api-key",
  "x-fanart-key",
];
// Conditional GET: the origin owns revalidation, the edge must not serve/collapse it.
const CONDITIONAL_HEADERS = [
  "if-none-match",
  "if-modified-since",
  "if-match",
  "if-unmodified-since",
  "if-range",
];
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// Tracked `Vary` dimensions (lowercase): `Accept` plus the Next.js App Router
// RSC tokens observed live on the origin (`Vary: rsc,
// next-router-state-tree, next-router-prefetch, next-router-segment-prefetch,
// Accept`). `next-url` is deliberately NOT tracked: the origin does not vary
// on it, so keying on it would only split the cache without a correctness
// benefit.
const TRACKED_VARY_TOKENS = new Set([
  "accept",
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
]);
// Request headers folded into the key alongside `Accept` (fixed order keeps
// the key input stable). Values are raw; absence (`null`) and empty (`""`)
// stay distinct in the JSON tuple.
const TRACKED_KEY_HEADERS = [
  "rsc",
  "next-router-state-tree",
  "next-router-prefetch",
  "next-router-segment-prefetch",
];
// Reserved internal header holding the FULL origin `Vary` on the stored copy.
// Synthetic cache metadata: never sent to the client (stripped on HIT).
const ORIGIN_VARY_HEADER = "x-pictorium-worker-origin-vary";
// Opt-in flag for the tiered upper layer (Workers Caching gateway pattern).
const TIERED_FLAG_NAME = "PICTORIUM_TIERED_CACHE";
// Reserved internal header smuggling the original `Cache-Control` when the
// inner entrypoint neutralizes a response for the upper tier. Gateway-only
// metadata: never sent to the client (restored/stripped in finalize).
const TIER_ORIG_CC_HEADER = "x-pictorium-tier-orig-cc";
// Reserved internal header smuggling the ORIGINAL `Cache-Control` when the
// inner entrypoint stores an edge-normalized copy upstream (SWR/SIE
// stripped, `stale-if-error=0` pinned; see `edgeCacheControl`).
// Gateway-only metadata: the gateway restores the exact original for the
// client, so the freshness contract never changes. Spoofed values are stripped
// in the inner entrypoint before either header is ever set.
const TIER_EDGE_CC_HEADER = "x-pictorium-tier-edge-cc";
// Prefix for the documented `cf.cacheKey` override on the `ctx.exports`
// loopback: the suffix is the opaque canonical digest (origin + path +
// sorted query + raw Accept/RSC classes), so the upper-tier key partitions
// every raw class the lower-tier synthetic key tracks.
const TIER_CACHE_KEY_PREFIX = "pictorium-poster-tier:";

export { DEFAULT_ORIGIN_URL };

/** Validate the origin: http(s) only, no credentials. Never throws. */
export function resolveOrigin(env) {
  const raw = String(env?.ORIGIN_URL ?? DEFAULT_ORIGIN_URL).trim();
  let parsed = null;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "unparseable" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "protocol" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "credentials" };
  }
  return { ok: true, origin: `${parsed.protocol}//${parsed.host}` };
}

/**
 * Tiered opt-in: explicit `PICTORIUM_TIERED_CACHE=1|true` (trimmed,
 * case-insensitive) AND `ctx.exports.PosterCacheTier.fetch` available at
 * request time. Anything else keeps the legacy local-only path. Fail-closed:
 * unknown values ("yes", "on", ...) stay OFF.
 */
export function resolveTiered(env) {
  const raw = String(env?.[TIERED_FLAG_NAME] ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Build the upstream target. Path/query are ASSIGNED onto a fresh origin URL,
 * so a hostile `//evil-host/...` pathname can never change the host
 * (unlike `new URL(path, origin)`, which treats leading `//` as authority).
 */
export function buildTarget(requestUrl, origin) {
  const target = new URL(origin);
  target.pathname = requestUrl.pathname;
  target.search = requestUrl.search;
  target.hash = "";
  for (const key of INTERNAL_QUERY_KEYS) target.searchParams.delete(key);
  return target;
}

/**
 * Conservative normalization: stable sort by key ONLY. Unknown params are
 * kept (incl. `u`, `rv`, `mv`, `config`), repeats keep their relative order.
 */
export function sortedQueryString(searchParams) {
  const entries = [];
  let index = 0;
  for (const [key, value] of searchParams) {
    if (INTERNAL_QUERY_KEYS.has(key)) continue;
    entries.push({ key, value, index: index++ });
  }
  entries.sort((a, b) => {
    if (a.key < b.key) return -1;
    if (a.key > b.key) return 1;
    return a.index - b.index;
  });
  return entries
    .map(({ key, value }) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Opaque canonical digest input: normalized target (origin + path + sorted
 * query with internal keys stripped) plus the RAW Accept header (exact,
 * uninterpreted) and the RAW values (with null-vs-empty presence) of the
 * tracked Next.js RSC request headers as a stable JSON tuple. Query
 * credentials never reach this function (bypass gate first), so the input
 * carries no secrets. Explicit `?fmt=` stays distinct via the query,
 * origin-default formats and RSC variants stay distinct via the raw
 * classes, without mimicking origin negotiation. Shared by the lower-tier
 * synthetic key and the upper-tier `cf.cacheKey` override so both layers
 * partition identically.
 */
export function cacheDigestInput(request, target, sortedQuery) {
  const acceptValue = request.headers.get("accept");
  const tracked = TRACKED_KEY_HEADERS.map((name) => [name, request.headers.get(name)]);
  return ["GET", target.origin, target.pathname, sortedQuery, JSON.stringify({ accept: acceptValue, tracked })].join("\n");
}

export async function cacheDigestHex(request, target, sortedQuery) {
  return sha256Hex(cacheDigestInput(request, target, sortedQuery));
}

/**
 * Opaque cache key on the WORKER's own hostname under a reserved path, so
 * secrets hashed into the input never appear in the clear. The `digest`
 * (same canonical input the upper tier is keyed with) is also returned so
 * the gateway can pass it as the documented `cf.cacheKey` override.
 */
export async function cacheKeyFor(request, target, sortedQuery) {
  const workerUrl = new URL(request.url);
  const digest = await cacheDigestHex(request, target, sortedQuery);
  const keyUrl = new URL(`${CACHE_KEY_PREFIX}${digest}`, workerUrl.origin);
  return { key: new Request(keyUrl.toString()), rawAccept: request.headers.get("accept") ?? "", digest };
}

/**
 * Null when cacheable, otherwise a short bypass reason. Conservative:
 * credentials, preview/refresh/live, client freshness/conditional/range and
 * non-poster or non-GET traffic never touch the cache (but are still proxied).
 */
export function bypassReason(request, url) {
  if (request.method !== "GET") return "method";
  if (!url.pathname.startsWith(POSTER_PATH_PREFIX)) return "route";
  for (const key of AUTH_QUERY_KEYS) {
    if (url.searchParams.has(key)) return "auth-query";
  }
  for (const header of CREDENTIAL_HEADERS) {
    if (request.headers.has(header)) return "auth-header";
  }
  if (url.searchParams.has("preview")) return "preview";
  if (url.searchParams.has("__poster_refresh")) return "refresh";
  if (url.searchParams.get("live") === "1") return "live";
  const cacheControl = (request.headers.get("cache-control") ?? "").toLowerCase();
  if (/(^|,)\s*(no-cache|no-store)\s*(,|$)/.test(cacheControl)) return "request-cache-control";
  if (/(^|,)\s*max-age\s*=\s*0\s*(,|$)/.test(cacheControl)) return "request-cache-control";
  if ((request.headers.get("pragma") ?? "").toLowerCase().includes("no-cache")) return "pragma";
  for (const header of CONDITIONAL_HEADERS) {
    if (request.headers.has(header)) return "conditional";
  }
  if (request.headers.has("range")) return "range";
  return null;
}

function parseDirectives(cacheControlValue) {
  return String(cacheControlValue ?? "")
    .toLowerCase()
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Shared-cache TTL: `s-maxage` wins over `max-age` (exact numeric tokens).
 * Duplicate directives with conflicting values mean an ambiguous policy, so
 * the TTL is unknown and storage is skipped (returns undefined).
 */
export function sharedTtlSec(cacheControlValue) {
  let maxAge;
  let sMaxAge;
  for (const directive of parseDirectives(cacheControlValue)) {
    let match = directive.match(/^s-maxage\s*=\s*(\d+)$/);
    if (match) {
      const value = Number.parseInt(match[1], 10);
      if (sMaxAge !== undefined && sMaxAge !== value) return undefined;
      sMaxAge = value;
      continue;
    }
    match = directive.match(/^max-age\s*=\s*(\d+)$/);
    if (match) {
      const value = Number.parseInt(match[1], 10);
      if (maxAge !== undefined && maxAge !== value) return undefined;
      maxAge = value;
    }
  }
  return sMaxAge ?? maxAge;
}

/**
 * True for `no-cache` / `private` / `no-store`, bare or with field names
 * (e.g. `no-cache="Set-Cookie"`, `private="x"`): any revalidation or
 * partitioning intent skips edge storage.
 */
function hasBlockingDirective(directives) {
  return directives.some(
    (directive) => directive === "no-cache" || directive === "private" || directive === "no-store" ||
      directive.startsWith("no-cache=") || directive.startsWith("private=") || directive.startsWith("no-store="),
  );
}

// Stale-serving directives: honored by Workers Caching per RFC 9111 (incl.
// the indefinite stale-on-error default when none of `stale-if-error`,
// `s-maxage`, `must-revalidate`, `proxy-revalidate` is present), ignored by
// the legacy Cache API. Stripped from every copy stored in the upper tier.
const STALE_DIRECTIVES = new Set(["stale-while-revalidate", "stale-if-error"]);

/**
 * Edge-normalized `Cache-Control` for the UPPER tier only. Passing the
 * origin policy through untouched would EXTEND stale serving beyond the
 * explicit no-SWR Worker contract (Workers Caching honors SWR/SIE, the
 * legacy Cache API does not). Stripping SWR/SIE and pinning
 * `stale-if-error=0` (explicit opt-out of the indefinite-error default, per
 * the official configuration docs) keeps upper-tier freshness exactly
 * `max-age`/`s-maxage`: still `public` + positive TTL, so the copy remains
 * storable upstream. Every other directive (`public`, TTLs, `immutable`,
 * `must-revalidate`, ...) passes through untouched. The gateway restores
 * the exact original from `TIER_EDGE_CC_HEADER`, so the client never
 * sees this rewrite.
 */
export function edgeCacheControl(cacheControlValue) {
  const kept = [];
  for (const directive of parseDirectives(cacheControlValue)) {
    const name = directive.split("=")[0].trim();
    if (!STALE_DIRECTIVES.has(name)) kept.push(directive);
  }
  if (!kept.some((directive) => directive.split("=")[0].trim() === "stale-if-error")) {
    kept.push("stale-if-error=0");
  }
  return kept.join(", ");
}

/**
 * Storage gate: only `200` + exact `public` token with a positive shared TTL,
 * without `private`/`no-cache`/`no-store` (incl. valued forms)/`Set-Cookie`,
 * and without meaningful `Vary` beyond the tracked tokens/`Accept-Encoding`.
 * NOTE: `stale-while-revalidate`/`stale-if-error` do NOT block storage here:
 * the legacy Cache API never serves stale, and the upper tier receives an
 * edge-normalized policy (`edgeCacheControl`) that removes them, so the
 * freshness contract is identical on both layers.
 */
export function isCacheableResponse(response) {
  if (response.status !== 200) return false;
  const cacheControl = response.headers.get("cache-control");
  const directives = parseDirectives(cacheControl);
  if (!directives.includes("public")) return false;
  if (hasBlockingDirective(directives)) return false;
  const ttl = sharedTtlSec(cacheControl);
  if (!Number.isFinite(ttl) || ttl <= 0) return false;
  if (response.headers.has("set-cookie")) return false;
  return varyAllowsStorage(response);
}

/**
 * True unless `Vary` names a meaningful dimension. Tracked tokens (`Accept`
 * plus the Next.js RSC tokens) are keyed, so they allow storage;
 * `Accept-Encoding` is transport-level and ignored.
 */
export function varyAllowsStorage(response) {
  const raw = response.headers.get("vary");
  if (!raw) return true;
  const tokens = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.includes("*")) return false;
  return tokens.every((token) => token === "accept-encoding" || TRACKED_VARY_TOKENS.has(token));
}

/**
 * Headers for the STORED copy: drops only the tracked `Vary` tokens (the key
 * already tracks their raw values) and preserves the FULL original `Vary`
 * in the reserved internal header `x-pictorium-worker-origin-vary`
 * (overwriting any origin-spoofed value). Called only after the key captured
 * the tracked values.
 */
export function storageHeaders(response) {
  const headers = new Headers(response.headers);
  const raw = headers.get("vary");
  headers.delete(ORIGIN_VARY_HEADER);
  if (raw) {
    headers.set(ORIGIN_VARY_HEADER, raw);
    const kept = raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part && !TRACKED_VARY_TOKENS.has(part.toLowerCase()));
    if (kept.length === 0) headers.delete("vary");
    else headers.set("vary", kept.join(", "));
  }
  return headers;
}

/**
 * Canonical inner URL for the tiered hop: worker host + poster path + the
 * normalized (sorted, internal-keys-stripped) query. Never requested at the
 * origin and never used as an origin URL: the inner entrypoint re-derives
 * the origin target from it via `buildTarget`. Canonicalizing here keeps
 * the upper-tier key (which is query-order-sensitive) converged with the
 * lower-tier synthetic key.
 */
function canonicalTierUrl(url, sorted) {
  const canonical = new URL(url.pathname, url.origin);
  if (sorted) canonical.search = sorted;
  return canonical.toString();
}

/**
 * True when the response `Vary` lets the upper tier partition every tracked
 * request header present on this request (`Accept` plus the Next.js RSC
 * tokens). Workers Caching honors all `Vary` names with verbatim values, so
 * a covered header is isolated exactly like in the lower-tier synthetic
 * key; an UNCOVERED-but-present header would collapse distinct raw classes
 * into one upper-tier entry. Absent request headers share one variant
 * legitimately (identical absence class); `Vary: *` never qualifies.
 */
export function tierVaryCoversRequest(response, request) {
  const raw = response.headers.get("vary");
  if (!raw) return false;
  const tokens = new Set(
    raw
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
  if (tokens.has("*")) return false;
  if (request.headers.get("accept") !== null && !tokens.has("accept")) return false;
  for (const name of TRACKED_KEY_HEADERS) {
    if (request.headers.get(name) !== null && !tokens.has(name)) return false;
  }
  return true;
}

/**
 * Neutralize a response for the upper tier: force `Cache-Control: no-store`
 * (Workers Caching bypasses and stores nothing) while smuggling the
 * original value in `TIER_ORIG_CC_HEADER` for gateway restore. Overwrites
 * spoofed smuggle headers first (both markers, so a neutralized response
 * can never be mistaken for an edge-transformed one). Body/status/headers
 * otherwise untouched, so the gateway can rebuild the exact origin-faithful
 * client response.
 */
function neutralizeTierResponse(response) {
  const headers = new Headers(response.headers);
  headers.delete(TIER_ORIG_CC_HEADER);
  headers.delete(TIER_EDGE_CC_HEADER);
  headers.set(TIER_ORIG_CC_HEADER, response.headers.get("cache-control") ?? "");
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Attach the edge-normalized upstream policy while smuggling the exact
 * origin `Cache-Control` in `TIER_EDGE_CC_HEADER` for gateway restore.
 * Every storable upstream copy carries this header; the gateway treats its
 * presence (without `TIER_ORIG_CC_HEADER`) as "storable upstream, restore
 * the original for the client and the lower tier".
 */
function withEdgePolicy(response) {
  const headers = new Headers(response.headers);
  headers.delete(TIER_EDGE_CC_HEADER);
  headers.set(TIER_EDGE_CC_HEADER, response.headers.get("cache-control") ?? "");
  headers.set("cache-control", edgeCacheControl(response.headers.get("cache-control")));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Inner tier entrypoint logic (pure function for testability): fetch the
 * origin and return either an edge-normalized storable response (passes the
 * shared storage gate AND the Vary-coverage check; original policy smuggled
 * for gateway restore) or a neutralized response the upper tier will not
 * store. The gateway restores both shapes before replying to the client.
 */
export async function serveTierInner(request, env) {
  const resolved = resolveOrigin(env);
  if (!resolved.ok) return new Response("Bad origin configuration", { status: 500 });

  const url = new URL(request.url);
  const target = buildTarget(url, resolved.origin);

  if (bypassReason(request, url) !== null) {
    // Defense in depth: the gateway never forwards these. Proxy without
    // storing so the upper tier cannot keep credential/conditional traffic.
    return neutralizeTierResponse(await proxyOnce(target, request));
  }

  const originRes = await proxyOnce(target, request);
  // Manual redirects are returned as-is (never followed); neutralize so the
  // upper tier cannot store them (the legacy layer never stores non-200).
  if (REDIRECT_STATUSES.has(originRes.status)) return neutralizeTierResponse(originRes);
  if (!isCacheableResponse(originRes) || !tierVaryCoversRequest(originRes, request)) {
    return neutralizeTierResponse(originRes);
  }
  // Storable for the upper tier: strip spoofed tier-internal headers first,
  // otherwise the gateway would mistake them for neutralization or
  // edge-policy signals and restore attacker-chosen `Cache-Control`.
  if (originRes.headers.has(TIER_ORIG_CC_HEADER) || originRes.headers.has(TIER_EDGE_CC_HEADER)) {
    const headers = new Headers(originRes.headers);
    headers.delete(TIER_ORIG_CC_HEADER);
    headers.delete(TIER_EDGE_CC_HEADER);
    return withEdgePolicy(
      new Response(originRes.body, {
        status: originRes.status,
        statusText: originRes.statusText,
        headers,
      }),
    );
  }
  return withEdgePolicy(originRes);
}

/**
 * Gateway-side restore for an inner response: reinstate the smuggled
 * original `Cache-Control` (or absence) from either marker, strip all
 * tier-internal metadata, and mark the manual-tier outcome. Returns
 * `{ response, neutralized }`. The gateway never writes tier-served
 * responses into the manual lower tier (Workers Caching owns both tiers
 * and exact expiration); `neutralized` stays for test introspection.
 */
function finalizeTierResponse(innerRes) {
  const headers = new Headers(innerRes.headers);
  const smuggled = headers.get(TIER_ORIG_CC_HEADER);
  const edge = headers.get(TIER_EDGE_CC_HEADER);
  headers.delete(TIER_ORIG_CC_HEADER);
  headers.delete(TIER_EDGE_CC_HEADER);
  const original = smuggled !== null ? smuggled : edge;
  if (original !== null) {
    if (original) headers.set("cache-control", original);
    else headers.delete("cache-control");
  }
  // Same marker convention as the legacy path: manual redirects are BYPASS,
  // origin/upper-tier serves are MISS (marker reports the lower-tier miss).
  headers.set("x-pictorium-worker", REDIRECT_STATUSES.has(innerRes.status) ? "BYPASS" : "MISS");
  const response = new Response(innerRes.body, {
    status: innerRes.status,
    statusText: innerRes.statusText,
    headers,
  });
  return { response, neutralized: smuggled !== null };
}

/**
 * Named entrypoint for the tiered upper layer. Requires the wrangler
 * per-entrypoint split (`default` caching DISABLED, `PosterCacheTier`
 * caching ENABLED): Workers Caching stores what THIS entrypoint returns,
 * keyed by (entrypoint, `cf.cacheKey` override or canonical path+query,
 * `ctx.props`, Vary variants). The gateway only ever forwards gate-passing
 * (credential-free) requests here, with the canonical digest as
 * `cf.cacheKey` so every raw Accept/RSC class partitions proactively.
 * `cloudflare:workers` exists only in the Workers runtime; the base class
 * here is structural (a `fetch(request)` method using `this.env`).
 */
export class PosterCacheTier extends WorkerEntrypoint {
  async fetch(request) {
    return serveTierInner(request, this.env);
  }
}

function hitResponse(stored) {
  // The stored copy drops the tracked tokens (the key tracks them), but the
  // client always sees the FULL origin `Vary`: restore it from the reserved
  // internal header, then remove that header so it never leaks to the
  // client. When the origin sent no `Vary`, nothing is added back.
  const headers = new Headers(stored.headers);
  const originalVary = stored.headers.get(ORIGIN_VARY_HEADER);
  if (originalVary !== null) headers.set("vary", originalVary);
  headers.delete(ORIGIN_VARY_HEADER);
  headers.set("x-pictorium-worker", "HIT");
  return new Response(stored.body, {
    status: stored.status,
    statusText: stored.statusText,
    headers,
  });
}

function withMarker(response, marker) {
  const headers = new Headers(response.headers);
  headers.set("x-pictorium-worker", marker);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function upstreamHeaders(request, clientUrl) {
  const headers = new Headers(request.headers);
  // Drop Host so fetch sets it from the target; forward the client host/proto.
  headers.delete("host");
  headers.set("x-forwarded-host", clientUrl.host);
  headers.set("x-forwarded-proto", clientUrl.protocol.replace(":", ""));
  return headers;
}

function proxyOnce(target, request) {
  const clientUrl = new URL(request.url);
  const init = {
    method: request.method,
    headers: upstreamHeaders(request, clientUrl),
    redirect: "manual",
  };
  // Body only for non-GET/HEAD; no `duplex` hint needed.
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
  return fetch(target.toString(), init);
}

const pictoriumPosterWorker = {
  async fetch(request, env, ctx) {
    const resolved = resolveOrigin(env);
    if (!resolved.ok) return new Response("Bad origin configuration", { status: 500 });

    const url = new URL(request.url);
    const target = buildTarget(url, resolved.origin);

    if (bypassReason(request, url) !== null) {
      return withMarker(await proxyOnce(target, request), "BYPASS");
    }

    const sorted = sortedQueryString(target.searchParams);
    const { key, digest } = await cacheKeyFor(request, target, sorted);
    const cache = globalThis.caches?.default ?? null;

    if (cache) {
      try {
        const hit = await cache.match(key);
        if (hit) return hitResponse(hit);
      } catch {
        console.warn("[pictorium-worker] cache lookup failed");
      }
    }

    // Tiered upper layer (opt-in): forward gate-passing requests to the
    // cached `PosterCacheTier` entrypoint over `ctx.exports`. The bypass
    // gate above already excluded credentials/preview/live/conditionals, so
    // only anonymous cache-eligible traffic reaches the shared upper tier.
    // The documented `cf.cacheKey` override carries the SAME canonical
    // digest as the lower-tier synthetic key (origin + raw Accept/RSC
    // classes): the upper tier partitions every raw class proactively
    // instead of relying on `Vary` coverage. Marker semantics in tiered
    // mode: the marker reports the manual LOWER-tier outcome ("MISS" =
    // manual miss, served by origin or natively by the upper tier, which
    // is never duplicated into the manual cache).
    const tierFetch = resolveTiered(env) ? ctx?.exports?.PosterCacheTier?.fetch : undefined;
    if (typeof tierFetch === "function") {
      let innerRes = null;
      try {
        const innerReq = new Request(canonicalTierUrl(url, sorted), {
          method: "GET",
          headers: request.headers,
        });
        innerRes = await ctx.exports.PosterCacheTier.fetch(innerReq, {
          cf: { cacheKey: `${TIER_CACHE_KEY_PREFIX}${digest}` },
        });
      } catch {
        console.warn("[pictorium-worker] tier fetch failed");
        innerRes = null;
      }
      if (innerRes instanceof Response) {
        // Never duplicated into the manual `caches.default` layer: Workers
        // Caching already stores this response in the lower + upper tiers
        // with exact expiration, and re-storing the restored copy would
        // assume unproven `Age`/TTL handoff semantics. Repeats are served
        // natively (marker stays MISS = manual-tier miss, served by origin
        // or the upper tier); pre-existing manual entries are still read
        // above and obey their own finite TTL.
        const { response: clientRes } = finalizeTierResponse(innerRes);
        return clientRes;
      }
      // Fall through to the legacy origin path on unexpected inner results.
    }

    const originRes = await proxyOnce(target, request);
    // Manual redirects are returned as-is: auth is never re-sent to the
    // redirect destination because the worker never follows them.
    if (REDIRECT_STATUSES.has(originRes.status)) return withMarker(originRes, "BYPASS");

    // Clone BEFORE the client response consumes the origin body: teeing first
    // keeps both branches usable (cloning a used body breaks the stream).
    const shouldStore = cache !== null && isCacheableResponse(originRes);
    const storable = shouldStore
      ? new Response(originRes.clone().body, {
          status: originRes.status,
          statusText: originRes.statusText,
          headers: storageHeaders(originRes),
        })
      : null;
    const clientRes = withMarker(originRes, "MISS");

    if (cache && storable) {
      // `Promise.resolve().then(...)` captures BOTH sync throws and async
      // rejections from `cache.put` without breaking the client response.
      const put = Promise.resolve()
        .then(() => cache.put(key, storable))
        .catch(() => {
          console.warn("[pictorium-worker] cache put failed");
        });
      if (ctx?.waitUntil) {
        try {
          ctx.waitUntil(put);
        } catch {
          console.warn("[pictorium-worker] cache put failed");
        }
      } else {
        await put;
      }
    }

    return clientRes;
  },
};

export default pictoriumPosterWorker;
