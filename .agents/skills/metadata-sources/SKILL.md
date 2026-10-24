---
name: metadata-sources
description: >
  External metadata/ranking sources used by Pictorium catalogs and badges:
  JustWatch StreamingCharts (GraphQL, getJWRankings, 6 h shared cache, timeout
  PICTORIUM_JUSTWATCH_TIMEOUT_MS default 2500 ms), FlixPatrol Top 10 (fp-crawler
  catalogs, JW fast-path first, disk+memory cache, 12 h validity), MDBList lists
  (mdblistMovie/Show/Anime/AnimeMovie, key-hashed cache keys, 12 h / 60 s empty).
  Covers cache tags, TTLs, and ID resolution fallbacks. Trigger: "justwatch",
  "flixpatrol", "mdblist", "ranking", "top 10", "trending", "classifica",
  "badge trend", "fonte metadati", "graphql".
---

Pictorium pulls rankings from three external sources. All of them feed catalogs
and/or the trend badges. Full architecture: `.agents/catalog.md`.

## JustWatch (`src/lib/justwatch.ts`)

- GraphQL POST to `JUSTWATCH_API_URL` (env, default `https://apis.justwatch.com/graphql`).
- `getJWRankings(objectType: "MOVIE" | "SHOW", country = "IT", first = 20,
  packages?, language = "it-IT")` — filter `DAILY_POPULARITY_SAME_CONTENT_TYPE`;
  GLOBAL charts query with `country: null` and US/en-US localization. `getJWTitles`
  (popular/trending/release-year, paginated), title quality (`resolveMaxQuality`
  from offers presentation types) and availability (`hasJWOffers`, digital-only
  via `hasDigitalOffer` — CINEMA tickets don't count) share the same transport.
- Returns `{ tmdbId, imdbId, rank }[]` — **imdbId comes from JustWatch itself**;
  do NOT re-fetch TMDB external_ids for these rows (platform JW rows append
  external_ids inside the same `getDetails` call — never a second per-title fetch).
- Shared in-memory cache, 6 h TTL, max 1000 entries. Key
  `{objectType}:{country}:{first}:{packages}:{language}` (titles add
  offset/sort/genres/monetization/overfetch). Empty results are cached 60 s
  (backdated timestamp). Shared with `/api/trending/rank` (trend badge),
  the platform fast-path, and warmup. Test hook clears it.
- Timeout `PICTORIUM_JUSTWATCH_TIMEOUT_MS` (default 2500, clamp 500–10000),
  combined with the caller signal. Circuit breaker: 5 failures → 60 s cooldown,
  403 (DataDome) → 5 min immediate trip. 200-empty responses don't trip the
  breaker (covered by the 60 s negative cache instead).

## FlixPatrol (`src/lib/flixpatrol.ts`)

- `getTop10(slug, "italy", apiKey, { enrich })` — catalogs fetched from
  `https://raw.githubusercontent.com/0xConstant1/fp-crawler/main/catalogs/{country}.json`.
- `SUPPORTED_COUNTRIES` closed list → unknown country is rejected fail-closed
  (no arbitrary URL fetch, no silent fallback to Italy).
- `SLUG_TO_PLATFORM` maps slugs to display names — see the source for the exact
  list (platform slugs plus `now`, `now-tv`, `hayu`, `crunchyroll`); don't
  duplicate the inventory here.
- Platform charts are FP-first with per-media-type JW fallback (never blended
  within one chart): `resolveFlixPlatformSides(slug, country)` resolves both
  sides from a SINGLE catalog fetch; a fresh usable chart wins with ZERO JW
  traffic, any other side (absent split, stale/invalid date, transport error,
  malformed document/chart, or zero usable tmdbIds) falls back to the
  same-region `getJWRankings` per packages (plus a `getJWTitles` top-up when
  the daily chart is thin, GLOBAL excluded); those JW rows already carry
  `imdbId`. Only the FP path resolves `imdbId` per title via `resolveImdbId`
  (TMDB external_ids, in `catalog-handler.ts`). Each side resolves
  independently: an opposite-side failure never blocks the requested side,
  and only a JW failure on top of an FP miss throws (both sources down:
  retention + 60s gate, never a fake empty; a successful JW `[]` publishes a
  genuine empty). Chart-date freshness is bounded and deterministic: the
  chart-level `date` (document top-level `date` only when the chart carries
  none) must equal the current or previous Europe/Rome calendar day — older
  is stale, future/invalid is rejected; `scraped_at_utc` and fetch/cache
  timestamps never count. Absent platform split (overall-only platforms) is a
  fallback, never a fake FP empty. Published snapshots carry the actual
  per-side provenance (`justwatch`/`flixpatrol`) as internal diagnostics.
  Legacy `platform:` families keep the historic JW unions (NOW via Peacock,
  Paramount via SkyShowtime) byte-identical; opt-in `stream:` families use
  strict own-brand packages with isolated pins (see streaming-catalogs).
  Availability-index discovery (`availability.json`, `schema_version: 1`,
  empty variant array = base chart exists, 12h fetch / 24h source-age, no
  sibling aliases) and the per-response `X-Pictorium-Source` diagnostic plus
  neutral manifest names are the backend disclosure architecture — full
  user-facing source disclosure waits for the UI (no public-label
  completeness claimed until then).
- Cache: disk file `flixpatrol_cache_{country}.json` under `DATA_DIR` (falls back
  to a `pictorium-`-prefixed file in `os.tmpdir()` when DATA_DIR is not writable,
  e.g. serverless) + in-memory Map, 12 h validity for both. Enrichment runs at
  concurrency 6 with its own 5 min / 500-entry TMDB cache keyed without `api_key`
  (secret never in keys).
- GLOBAL charts return empty — GLOBAL FP is deliberately excluded by scope
  (platform globals stay JW-only), never filled with national data.
- Also drives the network badge (which platform + rank).
- Fetch timeouts: catalog 15 s, TMDB enrichment 15 s per fetch.

## MDBList (`src/lib/mdblist.ts`)

- Lists: `mdblistMovie` (trending movies), `mdblistShow` (trending shows),
  `mdblistAnime` / `mdblistAnimeMovie` (trending anime series / movies) —
  `MDBLISTS` const.
- `fetchMDBList(listKey, apiKey)` → `{ imdb, title, year, tmdb? }[]` (block-paged,
  `MDBLIST_BLOCK_SIZE = 500`). The `apiKey` is caller-resolved: catalogs pass the
  `resolveUserApiKeys` result (explicit request > namespace store > permitted
  instance env fallback — see the `tmdb-api` skill), so namespace/instance keys DO
  reach this path through the resolver even though the function itself reads no
  env. `fetchCustomMDBList` additionally reads `MDBLIST_KEY` env directly as its
  own fallback (`envWithFallback`, `MDBLIST_API_KEY` also accepted).
  `checkMDBLists(imdbId)` calls `fetchMDBList` keyless. Daily-quota parking
  (`mdblist-quota.ts`): a parked key skips the keyed fetch in favor of the public
  `/json` fallback, cache hits still serve, mock-server runs stay isolated.
- The key changes the payload → it is part of the cache key (sha1, 8 chars, never
  plaintext); unkeyed requests share the `none` bucket. The hashed fragment
  separates credential contexts (same pattern as `ratings.ts`) — no
  mathematical no-collision guarantee is claimed for the 8-hex truncation.
- Cache: shared `cacheGet`/`cacheSet` (tag `mdblist`), TTL 12 h for NON-empty
  results, 60 s for empty/error results (transient failures don't freeze lists —
  they retry on next access after a minute).
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

- Key precedence for unified-resolver consumers (`resolveUserApiKeys` in
  `src/lib/tmdb.ts`): explicit request credentials > encrypted namespace
  store (`?u=`, `MULTI_USER=1`, `PROFILE_ENCRYPTION_KEY`) > opt-in instance env
  fallback (`PICTORIUM_*` primary, legacy `POSTERIUM_*` accepted with deprecation
  warning per `src/lib/env-compat.ts`; TMDB also honors bare `TMDB_KEY` /
  `TMDB_API_KEY`, custom MDBList also `MDBLIST_API_KEY`). With multi-user ON,
  scoped (`?u=`) requests skip the env fallback unless
  `PICTORIUM_MULTI_USER_ALLOW_ENV_FALLBACK=1`; global (unscoped) requests keep
  it. This policy covers only resolver consumers — `fetchCustomMDBList`
  (`src/lib/mdblist.ts`) additionally falls back to `MDBLIST_KEY` env directly
  with no scope argument, so never set instance fallback keys on public
  multi-user instances. See the `tmdb-api` skill.
- JustWatch rows already carry `imdbId`: no extra TMDB call (catalog.md rule);
  platform enrichment appends external_ids inside the same details fetch.
- Cache tags used: `catalog` (non-empty bodies carry an explicit 1 h TTL that wins
  over the scheduled daily refresh at `CACHE_REFRESH_HOUR`, default 03:00 UTC;
  empty bodies 60 s), `mdblist` (12 h / 60 s empty), `stremio`/`search`.
  JustWatch (6 h / 60 s empty) and FlixPatrol (12 h) keep their own module caches
  on top. Key-missing empties carry the key hash in the cache key so they never
  poison keyed responses.

## Files

- `src/lib/justwatch.ts` — GraphQL + shared in-memory cache (no disk file)
- `src/lib/flixpatrol.ts` — Top 10 + per-country disk/memory cache files
  (`flixpatrol_cache_{country}.json` under `DATA_DIR`, `pictorium-`-prefixed tmp
  fallback on serverless)
- `src/lib/mdblist.ts` — lists + shared cache (tag `mdblist`); quota parking in
  `src/lib/mdblist-quota.ts`
- `src/lib/tmdb.ts` — `resolveUserApiKeys` (request > namespace > permitted env)
- `src/lib/user-keys.ts` — encrypted per-namespace key store (AES-256-GCM)
- `src/lib/user-auth.ts` — `?u=` namespace selection vs header credentials
- `src/lib/env-compat.ts` — `PICTORIUM_*` primary, `POSTERIUM_*` legacy fallback
- `src/lib/ratings.ts` — rating badges (same key-hash pattern)
- `src/app/api/trending/rank/route.ts` — trend badge endpoint
