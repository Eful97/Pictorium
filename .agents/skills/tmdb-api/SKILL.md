---
name: tmdb-api
description: >
  TMDB API usage in Pictorium. Covers the v3 endpoints used (find, external_ids,
  details, images), API key resolution (request > user namespace > permitted
  instance fallback), caching (5 min in-memory, adaptive up to 24h for details, URL without api_key), inflight
  coalescing, health checks, and image URL construction (TMDB_IMG_URL, w500/original).
  Trigger: "tmdb", "api key", "external_ids", "resolveImdbId", "getDetails",
  "poster path", "image.tmdb.org", "chiamata TMDB", "chiave api", "mock server".
---

Pictorium has no bundled TMDB key. Scoped routes use `resolveUserApiKeys`:
explicit request credentials > encrypted user namespace > permitted instance
fallback. `?u=` or `/u/<uuid>/` can select a namespace when multi-user scoping
is enabled; read `user-auth.ts` for eligibility and `user-keys.ts` for storage.
Never replace this with the legacy synchronous request-only resolver.

An **opt-in instance fallback** exists for personal single-user deploys (e.g. a
Vercel instance used by one person): `PICTORIUM_TMDB_KEY` (and
`PICTORIUM_MDBLIST_KEY` for MDBList) are read as a LAST-RESORT when the request
carries no key. Header/query always win. Do NOT set these on public
multi-user instances without understanding the quota policy. With multi-user
ON, scoped requests disable the instance fallback unless
`PICTORIUM_MULTI_USER_ALLOW_ENV_FALLBACK=1`; global requests retain it.

## Key resolution

`resolveUserApiKeys(req, scopedUser)` in `src/lib/tmdb.ts`:
1. Header `x-api-key`, then query `api_key` for TMDB.
2. Stored namespace key, if a scoped user exists.
3. Permitted env fallback: `PICTORIUM_TMDB_KEY` (legacy `POSTERIUM_TMDB_KEY`),
   then `TMDB_KEY` / `TMDB_API_KEY`.
4. Otherwise key-missing behavior; never manufacture credentials.

`resolveRouteApiKey` applies scoping for upstream proxy routes.
`resolveRequestApiKey` remains a synchronous request > env resolver for legacy
consumers; it does NOT read the namespace. Preserve each consumer's contract.

`resolveImdbId`/`resolveImdbToTmdb` MUST receive the request key explicitly. Never
reintroduce a default key in the fetch layer itself.

## Endpoints used

| What | Where | Notes |
|---|---|---|
| `GET /find/{external_id}?external_source=imdb_id` | `src/lib/imdb-resolver.ts` | `resolveImdbToTmdb(imdbId, "movie"\|"tv", apiKey)`. Regex `^tt\d+$` guard. Cache: hit 7 days, no-match 60 s (sentinella -1). Network errors NOT cached. |
| `GET /{type}/{id}/external_ids` | `src/lib/tmdb.ts` (`resolveImdbId`) | Used by catalogs (FlixPatrol, MDBList fallback). |
| `GET /{type}/{id}` details | `src/lib/tmdb.ts` (`getDetails`) | Language `it-IT` in catalog flows. |
| `GET /{type}/{id}/images` | `src/lib/tmdb.ts` (`getImages`) | `TMDBImage` list for poster selection. |
| Health check | `src/lib/tmdb.ts` (`checkTmdbEndpoint`) | `/api/health`; never leaks the key in response/errors. |

## Fetch layer rules (tmdbFetch)

- Base URL: `TMDB_BASE_URL` env or `https://api.themoviedb.org/3`. Mock mode
  (`TMDB_BASE_URL` set) uses `mock-key` so e2e works without a real key
  (`e2e/mock-server.mjs`).
- Cache key = URL WITHOUT `api_key` (shared across users, key never in memory/Map).
- In-memory cache 5 min (every endpoint except details), max 2500 entries, LRU eviction (promote on hit).
- Details (`/movie/{id}`, `/tv/{id}`) use an ADAPTIVE lifetime (`detailsCacheTtlMs`): up to 24h for titles released >14 days ago and quiet series; 5 min when unreleased-undated, undated or released/first aired within 14 days; never past the day a release / first-air date or the next-episode air day flips; a next episode date already past (TMDB lag) retries after 6h; floor 1 min. Stored per entry (`ttlMs`) and published to the shared layer with the same TTL.
- Inflight coalescing: identical requests share the transport; each waiter races
  its own caller signal. Inspect `tmdbFetch` before changing cancellation.
- Per-request timeout 30 s; `checkTmdbEndpoint` 8 s.

## Images

`IMG_BASE = TMDB_IMG_URL || "https://image.tmdb.org/t/p"`.
Path format: `{IMG_BASE}/{size}/{file_path}` (e.g. `w500`, `original`).
`src/lib/poster-render-helpers.ts` keeps rendering deterministic (no dependency on
image.tmdb.org at render time) and validates paths start with `https://image.tmdb.org/t/p/`.
`src/lib/utils.ts` has the client-side `NEXT_PUBLIC_TMDB_IMG_URL` counterpart.

## Do NOT

- Do NOT bypass the unified resolver, namespace eligibility, or scoped env-fallback policy.
- Do NOT log or cache URLs containing the api_key.
- Do NOT put the key in Map keys, cache keys, or error messages.
- Do NOT add extra TMDB calls for imdbId where the source (JustWatch) already
  provides it.
- Do NOT change `resolveRequestApiKey` semantics (public contract, `auth.test.ts`
  covers it).

## Files

- `src/lib/tmdb.ts` — base URLs, `resolveRequestApiKey`, `tmdbFetch`, `checkTmdbEndpoint`, `getDetails`/`getExternalIds`/`getImages`
- `src/lib/imdb-resolver.ts` — `resolveImdbToTmdb` (find endpoint + cache)
- `src/lib/flixpatrol.ts` — own `TMDB_BASE` constant for its internal lookups
- `src/lib/poster-render-helpers.ts` — deterministic image URL handling
- `e2e/mock-server.mjs` — mock endpoints used by e2e/visual tests
