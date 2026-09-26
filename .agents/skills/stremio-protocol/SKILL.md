---
name: stremio-protocol
description: >
  Stremio addon contract for Pictorium: manifest (manifest.json, /u/<uuid>/
  path variant for AIOMetadata), addonId scheme, resources (catalog, poster,
  meta), /meta/{type}/{id} resolution and idPrefixes, catalog routes and their
  query params (u=, config=, skip=), poster endpoint contract, resolvable
  metadata IDs (tt... / provider:id — never bare numbers), headers
  (Cache-Control, CORS), maxDuration. Trigger: "manifest", "addon",
  "stremio", "catalogo", "catalog route", "AIOMetadata", "meta id", "id risolvibile",
  "poster url", "addonId".
---

Pictorium is a Stremio addon serving posters, catalogs and full metadata cards:
it DOES resolve `/meta/{type}/{id}` via `src/lib/meta-handler.ts` (see below), so
catalog `id` values are resolvable by Pictorium itself — without relying on
external addons like AIOMetadata.

## Meta resource (`/meta/{type}/{id}`)

- Route `src/app/meta/[type]/[id]/route.ts`, delegating to `pictoriumMeta` in
  `src/lib/meta-handler.ts`. Also reachable at `/c/[config]/meta/[type]/[id]` and
  `/u/[user]/meta/[type]/[id]`.
- Resolvable id prefixes: `tt...` (IMDb), `tmdb:<id>`, `tvdb:<id>`, `tvdbc:<id>`;
  a bare numeric id is treated as a TMDB id (fallback). `kitsu:`, `mal:`,
  `anilist:`, `anidb:` are intentionally NOT resolved → `{ meta: null }` (200)
  so dedicated anime addons keep serving them (manifest C3). Unresolvable id →
  `{ meta: null }` (200), never a 404/cancel.
- Resolution flow: TMDB id via `tmdbFindByImdb` / `tmdbFindByTvdb` or direct
  parse; full details via `getFullDetails` (+ credits/videos/external_ids);
  logo via `getImages`; poster via `buildStremioPosterUrl` (standalone poster
  embedded); episode list via episode groups (`getTVEpisodeGroups`) or standard
  seasons (`getTVSeason`), optionally enriched with TVDB (`enrichVideosWithTvdb`).
- The manifest declares the `meta` resource with `types` and `idPrefixes`
  (see `src/lib/build-manifest.ts`).

## Golden rule — resolvable metadata IDs

Catalog `id` values are emitted so they resolve (now via Pictorium's own `/meta`,
previously only via AIOMetadata). A bare number (`12345`) is NOT a portable id:
use `tt...` (IMDb) or `provider:id` (e.g. `tmdb:12345`). Resolution order (helper
`catalogMetaId` in `src/lib/catalog-handler.ts`):
1. `imdbId` provided by the source (JustWatch already returns it);
2. else TMDB `/{type}/{id}/external_ids` (`resolveImdbId`, passes the request key);
3. else fallback `tmdb:<id>`.

Never emit a bare numeric `id` as the catalog meta id.

## Manifest (`src/lib/build-manifest.ts`)

- URL: classic `manifest.json?u=...` OR path `/u/<uuid>/manifest.json` for
  AIOMetadata imports (they reject/break URLs with query strings).
- `addonId`: `org.pictorium` + `.` + first 8 chars of user UUID (or config token).
- Fields: `resources: ["catalog", "poster", { name: "meta", types, idPrefixes }]`,
  `types`, `idPrefixes`, `manifestVersion: 1`, `catalogs` from `PICTORIUM_CATALOGS`
  each with `extra: [{ name: "skip" }]`, `version: APP_VERSION` (generated).
- Headers: `Access-Control-Allow-Origin: *`, `Content-Type: application/json`,
  `Cache-Control: no-cache, max-age=0, must-revalidate`.

## Catalog route

`src/app/catalog/[type]/[id]/route.ts` — type normalized movie/series (see
`normalizeCatalogType` in `catalog-handler.ts`). Query params: `u=` (user UUID
profile) and `config=` (config token) — both enter cache keys and poster URLs.
`skip=` supports pagination.

- Empty `metas: []` = unknown catalog, missing key, or error. Rate limit → 429
  with `Retry-After`. `Cache-Control: no-cache`, CORS `*`.
- `maxDuration = 60`: a cold catalog does ~20 `getDetails` + ranking calls.

## Poster endpoint

`/api/poster/{type}/{id}` — the SAME endpoint serves the client preview and the
Stremio poster. Query params: `rv` (render version), `mv` (saved mapping), `u=`
(user profile), plus all render params (see `.agents/render-params.md`).
The copy-paste AIO template comes in two variants with identical params:
`{tmdb_id}` first (exact, no TMDB `/find` involved) and `{imdb_id}` as the
universal fallback (every item has one, but franchise-shared `tt` ids on
split season entries need a manual alias or mapping `imdbId` — resolution
order: user alias > global alias > own mapping `imdbId` > global mapping
`imdbId` > `/find`).

## Catalog list (`PICTORIUM_CATALOGS` in `catalog-definitions.ts`)

Canonical IDs use the `pictorium-` prefix; legacy `posterium-*` IDs are accepted
as route aliases (`normalizeCatalogId`) but never emitted.

- `pictorium-jw-movies` / `pictorium-jw-series` — JustWatch StreamingCharts
- `pictorium-netflix/prime/disney/apple/hbo/paramount-{movies,series}` — FlixPatrol Top 10
- `pictorium-anime` — MDBList `mdblistAnime`

Warmup: `pictorium-jw-movies`, `pictorium-jw-series`, `pictorium-anime`
(`WARMUP_CATALOG_IDS`), refreshed at 03:00 UTC (cache tag `catalog`).

## Do NOT

- Do NOT emit bare numeric meta ids.
- Do NOT hardcode new catalogs in the route: add them to `PICTORIUM_CATALOGS`
  (and `WARMUP_CATALOG_IDS` if they must be pre-warmed).
- Do NOT change route/param names or response formats (public contracts).
- Do NOT add new id prefixes to `/meta`: the resolver (`meta-handler.ts`) fixes
  the supported set — align the manifest with it, not the other way round.

## Files

- `src/lib/build-manifest.ts` — manifest builder
- `src/lib/catalog-definitions.ts` — catalog list + warmup
- `src/lib/catalog-handler.ts` — `pictoriumCatalog` logic, `catalogMetaId`
- `src/app/catalog/[type]/[id]/route.ts` — Stremio catalog route
- `src/lib/stremio-poster-url.ts` / `stremio-poster-params.ts` — poster URL builder
- `.agents/catalog.md` — full catalog architecture doc
