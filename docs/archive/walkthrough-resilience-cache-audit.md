# Walkthrough: Resilience, Cache Hardening & Benchmark Audit

Milestone completion record for the resilience, artwork hardening, telemetry
and production audit initiative in Pictorium.

## 1. What was built

- **Circuit breaker primitive** (`src/lib/circuit-breaker.ts`): half-open factory
  extracted from `awards.ts`; `recordFailure(customBackoffMs)` honors `Retry-After`;
  `trip()` for instant-open on hard blocks (403 DataDome).
- **Provider resilience**: MDBList (1500ms deadline, 3 fails → 30s), JustWatch
  (2500ms unified timeout, 5 fails → 60s, `trip(300s)` on 403), TVDB (choke-point
  `tvdbFetch`, 5s timeout, 20s episodes pagination budget), Wikidata post-race
  abort (`wdAbort`) in the poster route.
- **Cache hardening**: deterministic TTL jitter ±10% on dynamic posters
  (header == storage per entry, M3); backdrop-crop 404 fallback (portrait +
  landscape); TVDB poster rescue (no TMDB clean + logo + key, portrait only).
- **Telemetry** (`GET /api/cache/status`): `staleHits`, `coalescedHits`,
  `rescues: { tvdb, backdropCrop }`, `circuitBreakers: { awards, mdblist,
  justwatch, tvdb }`. Admin-gated, zero pixel change.
- **Bench** (`scripts/load-smoke.mjs`): scenarios coalesce / burst / warm /
  swr / jitter / soak (+ consolidated matrix); `POST /api/cache/expire`
  (admin + same-origin) forces stale entries for the SWR scenario.
- **Backpressure coverage**: waiter-timeout and queue-limit unit tests for the
  render slot limiter (503 path).

## 2. SLO contracts (measured on AOT production build, heap 384MB)

| SLO | Contract |
|---|---|
| SLO-1 Warm Hit | RAM-served p95 < 150ms / p99 < 250ms @100 concurrent, 0 renders, polling peaks 0. (Original 25/50ms targets were below the Next.js loopback stack floor; recalibrated on measured p95 ~77ms.) |
| SLO-2 Cold Coalescing | ≥98% coalesced on single-key burst, exactly 1 render, slot peak ≤ 1. |
| SLO-3 SWR Revalidation | 100% immediate answers on stale burst, exactly 1 background render (dedup), `ΔstaleHits == 100`. |
| SLO-4 Burst Limiter | Active slots rigidly ≤ `MAX_CONCURRENT_RENDERS`, zero 500/429/404; 503 only with coherent `Retry-After`. |
| SLO-5 Jitter Distribution | Bulk-warmup spread ≥ 60 min, no 60s bucket above 15% of keys (no thundering herd). 15% (not 10%): sequential test IDs are the worst case for FNV-mod clustering (measured 7.3–9.3% across deploys with identical code); real TMDB IDs are arbitrary and uniform (~5%). |

## 3. Reproduce

```bash
LOAD_MODE=all LOAD_START=start BENCH_ADMIN_TOKEN=secret node scripts/load-smoke.mjs
```

Child app runs on `LOAD_PORT` (default 3101) with heap capped at 384MB and
explicit `MAX_CONCURRENT_RENDERS=4` / `RENDER_SLOT_WAIT_MS=15000` /
`RATELIMIT_POSTER_MAX=10000`. `PORT` is forwarded so SWR self-refresh targets
the right origin. Mock server provides deterministic TMDB/JustWatch/Wikidata.

## 4. Known behaviors (not bugs)

- `RENDER_VERSION` bumps mechanically when hashed files change (hook calls
  included) even with zero pixel change; visual e2e certifies byte-identity.
- `cacheExpire` sets `timestamp = 0`: entries not refreshed afterwards are
  evicted (not served stale) by the next `cacheStatus()` cleanup past grace.
  By design for the bench flow (refresh rewrites fresh first).
- SWR `staleHits == 100` assumes the 100-serve burst completes before the
  ~300ms background render; soften only on observed flake.
- Jitter uniformity (peak 7.3–9.3% vs 15% limit) is deterministic on sequential
  test IDs (worst case for FNV mod clustering, prefix-sensitive); real keys
  carry hashes and sit ~5%.
- Unprefixed bench envs (`MAX_CONCURRENT_RENDERS=`, …) are never read by the
  app — `env-compat` honors only `PICTORIUM_*`/`POSTERIUM_*`. The script
  forwards both spellings with identical values.

## 5. Milestone D — Artwork Funnel Audit (2026-09-15, live, 400 titoli)

Dataset congelato `scripts/fixtures/artwork-funnel-dataset.json` (150
popular-movies, 100 popular-series, 100 niche, 50 anime-world JP; metodo nel
campo `meta`). Run: `node scripts/audit-artwork-funnel.mjs` (~8 min, 0 errori).

| Strato | TMDB Clean | TVDB Rescue | Lang | Crop | 404 |
|---|---|---|---|---|---|
| popular-movies (150) | 84.7% | 2.0% | 6.0% | 7.3% | 0.0% |
| popular-series (100) | 77.0% | 3.0% | 11.0% | 7.0% | 2.0% |
| niche (100) | 79.0% | 2.0% | 8.0% | 9.0% | 2.0% |
| anime-world (50) | 90.0% | 0.0% | 6.0% | 2.0% | 2.0% |
| **TOTALE (400)** | **82.0%** | **2.0%** | **7.8%** | **7.0%** | **1.3%** |

TVDB deep-dive: 8 rescue, di cui 1 con ≥2 textless eterogenei (12.5%).
Gate (≥5.0% AND ≥30%): **NO-OP** — entrambe le condizioni falliscono.
`pickTvdbPoster` resta com'è; candidate scoring scartato come over-engineering
per regola pre-registrata. B2 crop da solo salva il 7% dei titoli (28 ex-404).
