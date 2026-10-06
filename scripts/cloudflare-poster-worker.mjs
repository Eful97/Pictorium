// scripts/cloudflare-poster-worker.mjs
//
// Optional edge cache for the Pictorium poster origin. NOT deployed by this
// repo (no wrangler config, no deploy script): paste this file's content into
// a Cloudflare Worker manually.
//
// Usage:
//   1. Create a Worker with this file's content (Cloudflare dashboard).
//   2. Set the `ORIGIN_URL` variable to the actual public poster origin
//      (default: https://pictorium.duckdns.org). It must be the real desired
//      host; the worker never derives the host from the request path.
//   3. Route poster paths to it (e.g. `posters.example.com/api/poster/*`).
//      Anything else is proxied without caching.
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
 * Opaque cache key on the WORKER's own hostname under a reserved path, so
 * secrets hashed into the input never appear in the clear. The input is the
 * normalized target URL plus the RAW Accept header (exact, uninterpreted)
 * and the RAW values (with null-vs-empty presence) of the tracked Next.js
 * RSC request headers as a stable JSON tuple: explicit `?fmt=` stays
 * distinct via the query, origin-default formats and RSC variants stay
 * distinct via the raw classes, without mimicking origin negotiation.
 */
export async function cacheKeyFor(request, target, sortedQuery) {
  const workerUrl = new URL(request.url);
  const acceptValue = request.headers.get("accept");
  const rawAccept = acceptValue ?? "";
  const tracked = TRACKED_KEY_HEADERS.map((name) => [name, request.headers.get(name)]);
  const canonical = ["GET", target.origin, target.pathname, sortedQuery, JSON.stringify({ accept: acceptValue, tracked })].join("\n");
  const hex = await sha256Hex(canonical);
  const keyUrl = new URL(`${CACHE_KEY_PREFIX}${hex}`, workerUrl.origin);
  return { key: new Request(keyUrl.toString()), rawAccept };
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

/**
 * Storage gate: only `200` + exact `public` token with a positive shared TTL,
 * without `private`/`no-cache`/`no-store` (incl. valued forms)/`Set-Cookie`,
 * and without meaningful `Vary` beyond the tracked tokens/`Accept-Encoding`.
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
    const { key } = await cacheKeyFor(request, target, sorted);
    const cache = globalThis.caches?.default ?? null;

    if (cache) {
      try {
        const hit = await cache.match(key);
        if (hit) return hitResponse(hit);
      } catch {
        console.warn("[pictorium-worker] cache lookup failed");
      }
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
