---
name: perf
description: >
  Render-pipeline performance invariants for Pictorium — the caps and patterns
  that keep cold poster renders fast without OOM: getImages parallel with
  getDetails, worst-case timeout caps (auto-fit scoring 1200 / fetch 5000 /
  Wikidata 2500 / rating 1500 ms), AbortSignal.any in fetch layers, blur as raw
  RGBA overlay (no PNG roundtrip), buffer reuse from best-fit, slot limiter,
  RENDER_VERSION regeneration rule. Trigger: "performance", "slow poster",
  "ottimizzazione", "render lento", "latency", "timeout", "RENDER_VERSION",
  "pipeline audit".
---

These are the invariants of the poster render pipeline. When editing the pipeline
or auditing it for speed, preserve them. They were established in the
2026-08-12 optimization pass; don't regress them silently.

## Invariants

### 1. Parallel first data block (non-mapped branch, `route.ts`)
- `getImages` starts in PARALLEL with `getDetails` + `getExternalIds` using only
  `preferredLanguage,en,null`. It does NOT wait for `original_language`.
- `original_language` is added only in a CONDITIONAL retry: when posters OR
  logos are missing from the base langs (title in a small language). Don't add
  `origLang` to every request (costs payload + the same RTT).

### 2. Worst-case caps (env-overridable, module-level)
| Cap | Default | Env var | Clamp |
|---|---|---|---|
| Auto-fit **scoring** (CPU) | 1200 ms | `PICTORIUM_AUTO_FIT_TIMEOUT_MS` | 300–10000 |
| Auto-fit **fetch** (logo + candidates, I/O) | 5000 ms | `PICTORIUM_AUTO_FIT_FETCH_TIMEOUT_MS` | 1000–15000 |
| Auto-fit **candidate count** (clean posters ranked) | 8 | `PICTORIUM_AUTO_FIT_CANDIDATE_COUNT` | 1–32 |
| Wikidata awards | 2500 ms | `WIKIDATA_TIMEOUT` | – |
| Rating wait (TMDB+IMDb upgrade) | 1500 ms | `PICTORIUM_RATING_WAIT_MS` | 300–10000 |
| MDBList aggregated rating (internal fetch) | 1500 ms | `PICTORIUM_MDBLIST_TIMEOUT_MS` | 300–10000 |
| JustWatch GraphQL (rankings/titles/quality/offers) | 2500 ms | `PICTORIUM_JUSTWATCH_TIMEOUT_MS` | 500–10000 |
| TVDB API (login/search/extended/episodes page) | 5000 ms | `PICTORIUM_TVDB_TIMEOUT_MS` | 1000–15000 |
| TVDB episodes pagination (total budget) | 20000 ms | `PICTORIUM_TVDB_EPISODES_BUDGET_MS` | 5000–60000 |

The auto-fit **scoring** cap is the CPU bound (metrics, not product). The
auto-fit **fetch** cap is separate network I/O to TMDB: when both shared
`PICTORIUM_AUTO_FIT_TIMEOUT_MS`, slow-network platforms (HF, Vercel) exceeded
1200 ms on the logo/candidates fetch and skipped best-fit entirely, falling
back to the first clean poster. Keep the two caps separate.

`PICTORIUM_BEST_FIT_ENABLED` is a global on/off/auto switch read at module
level that overrides the per-request decision (route poster + `/api/poster-fit`).

Rating wait is SHARED with the tmdb-details route (same knob).

### 3. `AbortSignal.any` in fetch layers
- `fetchImg` (`poster-render-helpers.ts`) and `fetchAggregatedRating`
  (`ratings.ts`) combine the caller signal with their own internal timeout via
  `AbortSignal.any`. A never-aborted external signal (e.g. `renderAbort` after a
  successful render) must NOT bypass the internal timeout. Never revert to
  `signal ?? timeout`.
- `ratingAbort` (dedicated AbortController for the rating fetch) is aborted
  right after the `Promise.race` — leaves no orphan background fetch.

### 4. Blur as raw RGBA overlay (no PNG roundtrip)
- `applyBlur` returns `{ overlay, top, height }` raw RGBA; `poster-service.ts`
  composites it as the FIRST layer of the final composite, under
  backdrop/vignette/badges → one decode + one encode total. The artwork gets
  NO global color retouch (the old `.modulate(1.01/1.06)` was removed: it
  altered auteur grading). Do NOT reintroduce modulate or a `blur → modulate`
  PNG roundtrip.

### 5. Buffer reuse from best-fit
- `posterPathBuffer` AND `logoPathBuffer` are carried from the best-fit result
  into the render (no re-fetch in the poster/logo fetch block). Logo re-fetch
  only as fallback (cache hit or timeout).
- Poster buffer is w342 upscaled to 500×750 (accepted softness). Do NOT add a
  w500 re-fetch silently — that re-fetch fires on every best-fit pick of a
  non-first poster and eats the buffer-reuse win. Discuss before changing.

### 6. Concurrency & deadline
- Slot limiter: `PICTORIUM_MAX_CONCURRENT_RENDERS` (default `clamp(availableParallelism, 2, 8)`; explicit env 1–32, invalid → 4),
  `PICTORIUM_RENDER_SLOT_WAIT_MS` (15000, clamp 500–60000),
  `PICTORIUM_RENDER_QUEUE` (0). Waiters don't hold image buffers.
- Deadline watchdog: `PICTORIUM_RENDER_TIMEOUT_MS` (30000; 8500 on Vercel when unset; clamp 1000–40000 = maxDuration)
  frees slot + inflight map on overrun.
- Negative cache: `PICTORIUM_NEGATIVE_CACHE_TTL_MS` (5000) for 500/503.

### 7. RENDER_VERSION — never hand-edited
- `src/lib/render-version.ts` is AUTO-GENERATED. After touching ANY file in
  `RENDER_FILES` (`scripts/write-render-version.mjs`): `node scripts/write-render-version.mjs`.
  If your file affects visual output but isn't listed, ADD it, then regenerate.
- `predev`/`prebuild`/`pretest` already regenerate; the manual run is for
  immediate verification. A stale RENDER_VERSION means cache + Stremio URLs
  don't invalidate.

### 8. Explicit query emission — never prune params (A2 lesson)
- Preview (`buildPreviewUrl`) and Stremio (`buildStremioPosterUrl`) emit render
  params EXPLICITLY, even at default values. Absent ≠ default: the server chain
  is query > mapping > config token > server defaults > hardcoded, with
  sentinels (`badgeStyle "shadow"` = absent) and branches that skip `sd`
  (gradient/blur). Omitting a param resolves differently with `?config=`
  installs, saved mappings, or customized instance defaults — silent
  preview/final desync. Shorter URLs are not worth it.

### 9. Preview debounce (client)
- `buildPreviewUrlCb` fires trailing-debounced (200ms) in `context.tsx`;
  selection change fires immediately. Every slider tick rebuilds the callback
  identity — without debounce each pixel of drag is a server render (storm).

### 10. Slot-bound upstream caps, second wave
- MDBList aggregated-rating internal fetch cap is `MDBLIST_TIMEOUT_MS`
  (1500ms default, see section 2 and `ratings.ts`); `resolveStreamQuality` → `getExternalIds`
  with caller signal + 8s cap. Same rationale as `POSTER_TMDB_TIMEOUT_MS`:
  no unbounded upstream hold on a render slot.
- `getJWRankings`/`getJWTitles` cache EMPTY results 60s (backdated timestamp).
  The circuit breaker only trips on errors/throws — a 200-empty response
  would otherwise refetch on every render (thunder without circuit).
- `catalogLogo` memo: 24h hit / 1h miss, keyed without `api_key`. Never cache
  exceptions — a transient timeout must not hide an existing logo for an hour.

### 11. Canonical render + variant (C3)
- Posters render ONE canonical (webp di default, jpeg con
  `PICTORIUM_IMAGE_FORMAT=jpeg`); the other format is a response-time
  conversion (same opts as the direct pipeline encode: webp q85/effort-2,
  jpeg q82+mozjpeg), cached as variant with a derived etag, 304-capable.
  Inflight/coalescing is keyed canonical so one render serves both formats.
  The cache key carries a canonical marker (`:fmtwebp`) so an env flip can
  never serve old-format bytes under a new key. Accept-avif negotiates to
  webp; only an explicit `?fmt=avif` keeps a dedicated legacy render. Do NOT
  reintroduce per-format render keys — that triples cold renders and cache
  memory. `?fmt=` stays an explicit override in both directions.

### 12. KV L2 policy (C1)
- L2 is enabled when a KV backend is configured unless `PICTORIUM_KV_CACHE`
  is explicitly disabled (`0`/`false`/`off`/`no`). Read `cache.ts:isKvL2`.
- L2 (native Redis or Vercel KV/Upstash) carries small JSON only (≤64KB, never Buffers — no base64
  bloat, no value-limit/cost surprises); writes are fire-and-forget, reads
  only on L1 miss. Keys are self-invalidating (epoch/versions inside), so no
  cross-instance tag invalidation is needed. Poster/badge PNGs stay local.

### 13. Warmup self-fetch origin (C2)
- Self-fetch origin is NEVER derived from the request (host-header
  injection/SSRF). Order: `PICTORIUM_WARMUP_ORIGIN` env → `VERCEL_URL`
  (platform-provided, trusted; loopback doesn't route on serverless) →
  loopback (local/VPS). Poster queue supports `?offset=` resume (`nextOffset`
  in response); catalog warm (`?catalogs=1`, the 8 `WARMUP_CATALOG_IDS`) is
  opt-in — it pays N+1 upstream per catalog.

## Audit workflow

1. Read `route.ts` (non-mapped branch, caps, race, format flow), `poster-service.ts`,
   `poster-auto-fit.ts`, `poster-render-helpers.ts` (fetchImg), `ratings.ts`,
   `blur.ts`, `poster-runtime-cache.ts` (limiter, formats), `justwatch.ts`
   (negative cache), `catalog-handler.ts` (logo memo), `cache.ts` (KV L2),
   `warmup/route.ts`, `context.tsx` (debounce).
2. Check each invariant above holds.
3. In read-only audits, inspect `RENDER_FILES` and the generated value without
   running the generator (it writes). Regenerate only in an authorized
   implementation workflow; do not claim freshness from inspection alone.
4. Report regressions with `file:line`; propose the minimal fix.
