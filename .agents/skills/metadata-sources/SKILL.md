---
name: metadata-sources
description: >
  External metadata/ranking sources used by Pictorium catalogs and badges:
  JustWatch StreamingCharts (GraphQL, getJWRankings, 6 h cache, shared with
  /api/trending/rank and warmup), FlixPatrol Top 10 (fp-crawler catalogs,
  SUPPORTED_COUNTRIES fail-closed, disk+memory cache, 12 h validity), MDBList lists
  (mdblistMovie/Show/Anime, key-hashed cache keys, 12 h TTL). Covers cache
  tags, TTLs, and ID resolution fallbacks. Trigger: "justwatch", "flixpatrol",
  "mdblist", "ranking", "top 10", "trending", "classifica", "badge trend",
  "fonte metadati", "graphql".
---

Pictorium pulls rankings from three external sources. All of them feed catalogs
and/or the trend badges. Full architecture: `.agents/catalog.md`.

## JustWatch (`src/lib/justwatch.ts`)

- GraphQL POST to `JUSTWATCH_API_URL` (env, default `https://apis.justwatch.com/graphql`)
  with headers `Content-Type: application/json`, `X-Platform: WEB`.
- `getJWRankings(objectType: "MOVIE" | "SHOW", country = "IT", first = 20)` —
  filter `DAILY_POPULARITY_SAME_CONTENT_TYPE`, language `it-IT`.
- Returns `{ tmdbId, imdbId, rank }[]` — **imdbId comes from JustWatch itself**;
  do NOT re-fetch TMDB external_ids for these rows.
- In-memory cache 6 h, max 100 entries, key `{objectType}:{country}:{first}`.
  Shared with `/api/trending/rank` (trend badge) and warmup. Test hook clears it.
- Timeout 15 s.

## FlixPatrol (`src/lib/flixpatrol.ts`)

- `getTop10(slug, "italy", apiKey)` — catalogs fetched from
  `https://raw.githubusercontent.com/0xConstant1/fp-crawler/main/catalogs/{country}.json`.
- `SUPPORTED_COUNTRIES` closed list → unknown country is rejected fail-closed
  (no arbitrary URL fetch, no silent fallback to Italy).
- `SLUG_TO_PLATFORM`: netflix, disney, amazon-prime, hbo-max, apple-tv,
  paramount-plus.
- Cache: disk file `flixpatrol_cache_{country}.json` under `DATA_DIR` (falls back
  to `os.tmpdir()` when DATA_DIR is not writable, e.g. serverless) + in-memory
  Map, 12 h validity for both. Per-country cache files exist under `data/`.
- Source does NOT provide imdbId → catalog depends entirely on `resolveImdbId`
  (TMDB external_ids).
- Also drives the network badge (which platform + rank).

## MDBList (`src/lib/mdblist.ts`)

- Lists: `mdblistMovie` (trending movies), `mdblistShow` (trending shows),
  `mdblistAnime` (trending anime) — `MDBLISTS` const.
- `fetchMDBList(listKey, apiKey)` → `{ imdb, title, year, tmdb? }[]` (top 20).
- Key resolution: explicit request key only (no instance key). The key is hashed
  (sha1, 8 chars) into the cache key so different keys don't collide, never in
  plaintext.
- Cache: `cacheSet`/`cacheGet` (tag `mdblist`), TTL 12 h. Only NON-empty
  results are cached — network errors return `[]` and are retried on next access.
- `MDBLIST_API_URL` env (mock server in e2e) always wins over the real endpoint.
- `checkMDBLists(imdbId)` → list key + rank for the MDBList badge.

## TVDB (`src/lib/tvdb.ts`)

- Episodes/seasonTypes (meta route) + artwork posters rescue (B1, poster route).
- `getTvdbArtworks(mediaType, tvdbId, apiKey)` → `TvdbArtwork[]` (`ArtworkBaseRecord`
  spec v4.7.10: series via `/series/{id}/artworks`, movies via `/movies/{id}/extended`
  which embeds `artworks`; no dedicated movie artworks endpoint).
- `pickTvdbPoster(arts, lang)` (pure): portrait-only, textless (`includesText === false`)
  first, then language (null > preferred > eng > other), then TVDB score.
- Rescue gating (poster route, unmapped branch only): no TMDB clean poster AND logo
  present AND key present (`?tvdb_key=` > `PICTORIUM_TVDB_API_KEY` instance fallback);
  portrait only (landscape already has the backdrop base). Fail-open → language fallback.
- `TVDB_API_URL` env (mock server in e2e) wins over `https://api4.thetvdb.com/v4`.
- Shared fail-open breaker (`tvdb`, 5 fails → 60 s) + `TVDB_TIMEOUT_MS` (5000) +
  episodes pagination budget (`TVDB_EPISODES_BUDGET_MS`, 20000).
- Artwork images live on `https://artworks.thetvdb.com` (fixed CDN host, SSRF-allowlisted
  in `imgSrc` alongside `image.tmdb.org`).

## Shared rules

- API keys come from the request (see `tmdb-api` skill) — never env defaults.
- JustWatch rows already carry `imdbId`: no extra TMDB call (catalog.md rule).
- Cache tags used: `catalog` (refresh 03:00 UTC), `mdblist`.
- Empty results are cached briefly (catalog 60 s) or not at all (mdblist) so
  transient failures don't freeze lists.

## Files

- `src/lib/justwatch.ts` — GraphQL + cache
- `src/lib/flixpatrol.ts` — Top 10 + cache files
- `src/lib/mdblist.ts` — lists + cache
- `src/lib/ratings.ts` — rating badges (same key-hash pattern)
- `src/app/api/trending/rank/route.ts` — trend badge endpoint
- `data/flixpatrol_cache*.json`, `data/justwatch_cache.json`, `data/mdblist_cache.json`
