# Pictorium integration guide (poster endpoint only)

> 🇮🇹 Versione italiana: [`INTEGRAZIONE.md`](./INTEGRAZIONE.md)

This document is the stable contract for embedding Pictorium posters in a
third-party project (e.g. a Stremio add-on). It describes only what an
integrator needs: the poster endpoint, the optional episode-thumbnail
endpoint, its query parameters, API keys, failure behavior, and the
license/attribution rules.

## Scope: poster endpoint (plus the optional episode thumbnail)

Use **only** the poster endpoint and embed the resulting URLs in your own
catalogs:

```text
GET {yourInstanceUrl}/api/poster/{movie|series}/{id}
```

- `{movie|series}`: `movie` for films. `series`, `tv`, `show`, `tvshow` all
  mean TV series.
- `{id}`: a TMDB numeric id (`.../movie/550`) or an IMDb id (`.../movie/tt0133093`,
  resolved server-side to TMDB).
- IMDb id resolution order: operator manual alias → saved-mapping `imdbId` →
  TMDB `/find`. Always prefer the numeric TMDB id when you know it:
  franchise-shared `tt...` ids (e.g. anthology series split into separate
  TMDB entries) may fail to resolve (`404`) even though the title exists.

### Placeholder patterns (AIO / custom URL)

When the consumer substitutes per-title placeholders (e.g. AIOMetadata,
which supports `{tmdb_id}` and `{imdb_id}`), use them in the path
(`/api/poster/{type}/{tmdb_id}`):

- `{tmdb_id|imdb_id}` (auto, recommended for Nuvio and AIOMetadata): the
  consumer substitutes whichever id the current view provides (Home,
  Library, More Like This, Cast rows each carry different ids) and keeps
  the original poster when neither is available — verified against
  AIOMetadata's alternation groups (`{a|b}`, first non-empty wins) and
  Nuvio's `{a|b}` markers. One template works everywhere — no per-view
  choice needed.
- `{tmdb_id}` (exact alternative): no resolution involved — but only if the
  consumer genuinely knows that item's TMDB id.
- `{imdb_id}` (universal fallback): every item has one, but it pays the
  resolution cost above and fails on franchise splits.
  Typed `tmdb:<num>` substitutions resolve as the exact numeric path;
  anything else unresolvable still answers `400`.

If a title answers `404` via `tt...` while it exists on TMDB, use the
numeric id or ask the instance operator to stitch a manual alias.

### Optional: episode thumbnail endpoint (AIO `Episode Thumbnail URL Pattern`)

Posters are the required contract. If your consumer also replaces episode
stills (AIOMetadata exposes a separate **Episode Thumbnail URL Pattern**), the
same instance serves a 16:9 composite with the episode rating:

```text
GET {yourInstanceUrl}/api/thumbnail/tv/{tmdbId}/season/{season}/episode/{episode}?still={still}
```

- `still` (optional): a TMDB still path (`/abc123.jpg`), a complete TMDB
  image URL (`https://image.tmdb.org/t/p/w500/abc123.jpg`, e.g. AIO's
  `{thumbnail}`), **or** a complete TVDB artwork URL
  (`https://artworks.thetvdb.com/banners/v4/episode/<id>/screencap/<file>.jpg`,
  what AIO sends when the space resolves episode metadata from TheTVDB). The
  TVDB URL is fetched directly (public artwork: no TVDB API key and no lookup)
  and keeps its own cache entry. For TMDB inputs only the file name is used;
  the server applies its own `w780`/`w1280` source policy, so URL and path are
  the same image and the same cache entry. When `still` is absent/blank (AIO
  passes an empty `{thumbnail}` for videos with no `originalThumb`) the server
  picks the episode's first TMDB still and renders exactly like that explicit
  path; the historical `400` remains only when TMDB has no still for the
  episode.
- Accepted URL form: `https:` only, exact `image.tmdb.org` host (no
  subdomains), no credentials/port/query/fragment, single file segment and a
  raster `jpg`/`jpeg`/`png` file — or the exact `artworks.thetvdb.com` host with
  a nested raster `jpg`/`jpeg`/`png`/`webp` path. Anything else answers `400`
  before any upstream fetch (the historic path form is unchanged).
- Other query params: `w` (`160|320|480|640|768|1280`, default `320`),
  `badges=both|vote|custom` (default `both`), `blur=0|1|true|false` (default
  off), `source=tmdb|imdb` (default `imdb`). The Miniature settings saved in
  Pictorium (`bstyle`, `anchor`, `ox`/`oy`, `bscale`, `blur`, `source`,
  `rotate`) apply to the `u=` namespace when the pattern omits them (explicit
  query params always win); a space with no saved values keeps the historical
  defaults byte-for-byte.
- API key: resolved exactly like the poster route (header `x-api-key` > query
  `api_key` > `u=` namespace > instance store/env). If your instance has no
  server-side key and the poster template carries `api_key=...`, keep the same
  parameter here (the Install Hub pattern copies it automatically); without it
  the rating leg answers `502`, while the poster keeps working. A `u=` that
  names no existing space is treated as anonymous before key resolution (same
  collapse as the poster route), so the instance/server key applies again and
  the same `u` behaves identically on posters and thumbnails.
- Response: PNG, ETag + `304`, 30-minute cache. Failures never cache.

AIOMetadata **Episode Thumbnail URL Pattern** (paste as-is; AIO already
URL-encodes `{thumbnail}`, do not encode it again):

```text
https://<host>/api/thumbnail/tv/{tmdb_id}/season/{season}/episode/{episode}?still={thumbnail}&w=320&badges=both&blur={blur}
```

`{blur}` expands to `true`/`false` from AIO's **Blur Thumbnails** switch. An
episode with no TMDB still passes an empty `{thumbnail}`; the server then
auto-resolves the episode's first TMDB still (200, same bytes as the explicit
path), and answers `400` only when TMDB has no still at all for that episode,
so those rows fall back to the client's own placeholder.

Failure legs are distinguishable from the body — never treat every non-200 as
a CDN problem:

- `400` = the still is not an acceptable TMDB path/URL or TVDB artwork URL
  (AIO's `<aio-host>/missing_thumbnail.png`, nested TMDB path, non-raster):
  rejected before any fetch, by design. `400
  {"error":"No TMDB still for this episode"}` = `still` was empty and TMDB has
  no still for the episode either (or the episode-images lookup failed).
- `502 {"error":"TMDB episode details unavailable"}` = no usable TMDB key on
  the request (the rating leg fails closed before the still is fetched); pass
  the same `api_key` the poster URL carries, or configure the key server-side.
- `502 {"error":"Episode still unavailable"}` = the still was accepted but the
  TMDB image CDN fetch failed (404/transport); transient upstream, not config.

You do **not** need `/catalog/*`, `/meta/*`, the editor UI, or any other
Pictorium route. There is nothing to strip out of the codebase — simply do
not call what you do not need. Keeping the deployment intact (instead of
deleting code) keeps your fork close to upstream.

## Self-hosting (required)

Run your own copy. Do not point end-user traffic at someone else's instance.

- Docker image: `eful97/pictorium:latest` (multi-arch `amd64`/`arm64`),
  or 1-click Vercel deploy from the repo.
- See `docker-compose.yml` and `.env.example` for the full variable list.
- Environment variables are read at module level: changing them requires a
  restart, hot reload does not apply them.

## API keys

TMDB resolution priority (see `resolveRequestApiKey` in `src/lib/tmdb.ts`):

1. `x-api-key` request header (preferred — never appears in URLs/logs),
2. `api_key` query parameter,
3. `PICTORIUM_TMDB_KEY` instance fallback (**opt-in**, for single-user
   personal deploys; do **not** set it on shared multi-user instances).

Recommended setup:

| Key    | How to pass                        | Why                                              |
|--------|------------------------------------|--------------------------------------------------|
| TMDB   | per request (`x-api-key`/`api_key`)| Per-user keys avoid one shared rate limit. `api_key` is stripped from the poster cache key, so per-user keys do **not** fragment the cache. |
| MDBList| `PICTORIUM_MDBLIST_KEY` on the instance | The anime rank is global (same list for everyone). A per-request `mdblist_key` **does** fragment the poster cache (one miss + render per distinct key), so prefer the instance key. |

Without any usable TMDB key, unmapped (cold) titles answer `503` (fast, no
slot consumed) instead of rendering degraded posters. Mapped titles or
explicit `?poster=` requests still render, minus live rank/quality upgrades.

## Query parameters

All parameters are optional. Unknown parameters are ignored. Oversized
values answer `400` before any render work (see `posterQuerySchema` in
`src/lib/validation.ts`: `extra`/`label` ≤ 80 chars, `title`/`rsrc` ≤ 200,
`poster`/`logo`/`backdrop` ≤ 160, `imdbId` matching `^tt\d{1,20}$`).
External image URLs are rejected — only `https://image.tmdb.org/t/p/...`
paths (or TMDB `file_path`s) are accepted.

| Param | Values | Default | Effect |
|---|---|---|---|
| `rv` | render version string | — | **Always send it.** Cache-buster: when the renderer changes, a new `rv` forces CDNs/clients to fetch fresh posters. Current value is in `src/lib/render-version.ts`. |
| `badges` | `1`/`0` | `1` | Genre/rating badge on/off. |
| `ranking` | `1`/`0` | `1` | Ranking/award badges on/off. |
| `bg`/`by`/`br`/`bq` | `1`/`0` | `1` | Genre / year / rating / stream-quality components of the genre badge, toggled independently. |
| `bs` | `shadow` `pill` `bar` `colored` `bordo` `vetro` | `shadow` | Genre badge style. |
| `rs` | `default` `bar` `colored` `pill` `netflix` | `default` | Ranking badge style (`default` auto-selects the Netflix ribbon when a rank exists). |
| `gradHeight` | `5`–`100` | `30` | Bottom gradient height, percent. |
| `blur`/`bf`/`bd` | numbers | `5`/`60`/`40` | Background blur intensity / fade / darkness. |
| `be` | `1`/`0` | `1` | Blurred background on/off (`be=0` disables it). |
| `netLogo` | `1`/`0` | `1` | Network/studio logo pill on/off. |
| `side` | `left`/`right` | server decide | Netflix ribbon / network logo side. Pass explicitly for deterministic output. |
| `ac` | hex color | auto | Accent color override (sampled from artwork when omitted). |
| `tl` | `1`/`0` | auto | Top-light text mode. Omit to let the server compute it from the artwork luminance. |
| `pre` | `1` | off | Pre-digital effect (dark veil + "Coming Soon" ribbon), films only, default OFF. |
| `lang` | e.g. `it`, `en` | `it` | Artwork/metadata language. |
| `region` | e.g. `IT`, `US` | server default | JustWatch charts region (rankings, quality, pre-release detection). |
| `title` | text (≤ 200) | — | **Send it.** Title used for the JustWatch match (quality + pre-release detection). Without it the match falls back to generic values and degrades. |
| `rd`/`fad` | `YYYY-MM-DD` | — | Full release / first-air date. Prefer over `year` (year-only becomes Jan 1st and can miss the theatrical window used by pre-release detection). |
| `imdbId` | `tt...` | — | Helps external-id matching (IMDb Top 250, aggregated rating). |
| `rank`/`label` | int / text (≤ 80) | live | Explicit rank override + its label. |
| `extra` | text (≤ 80) | — | Custom text badge. |
| `animerank` | int | live | Anime chart rank override (TV). |
| `rsrc` | CSV (≤ 200) | default set | Rating sources used for the aggregated vote. |
| `poster`/`logo`/`backdrop` | TMDB paths | auto | Explicit artwork override (preview/WYSIWYG use). |
| `scale`/`ox`/`oy`, `bscale`/`box`/`boy` | numbers | auto | Logo / backdrop geometry overrides. |
| `mv` | mapping version | — | Pass back the `mv` you received: matching `mv` enables immutable long-term caching. |
| `fmt`/`format` | image format | JPEG | Alternate output format where supported. |
| `preview` | `1` | — | Preview mode (no-store headers). Live clients should omit it. |
| `debug` | `1` | — | Returns JSON with computed render data instead of an image. |

> Do **not** use the `?config=` token for cross-project integration: it
> requires sharing the instance `CONFIG_HMAC_SECRET` and is fail-closed in
> production. Explicit query parameters are debuggable and versionable.

### Shared hosting (presets mode)

On shared hosting (`PICTORIUM_POSTER_PARAMS=presets`, auto-on with
`HOSTED_BY=elfhosted` or `MULTI_USER=1`) requests other than live editor
previews are canonicalised before rendering:

- Without an honoured `poster=` override (which needs a user space), `title`,
  `genreName`, `year`, `rd`, `fad`, `voteAverage`, `imdbId` and `wikidata_id`
  are ignored: the server uses TMDB data and the saved mapping. Sending them is
  harmless.
- `rank` is kept only as an integer from 0 to 100 (0 hides the rank badge).
- `animerank` values above the anime badge cap (20) are treated as "no badge".
- `rsrc` keeps supported sources only, without duplicates.

## Responses and failure behavior (fail-safe integration)

| Status | Meaning | What to do |
|---|---|---|
| `200` | JPEG poster (ETag + `304 Not Modified` supported) | Cache it. Honor `mv`/`rv` for invalidation. |
| `400` | Invalid id or out-of-bounds query param | Fix the request (your bug, never retry as-is). |
| `404` | No artwork really exists for this title | Fall back to your normal poster. Do not retry in a loop. |
| `429` | Rate limited (poster bucket: ~200 burst, ~20 req/s sustained per key) | Back off for the `Retry-After` seconds, then retry or fall back. |
| `503` | Render slots saturated, render deadline exceeded, or upstream (TMDB/CDN) too slow — includes a `Retry-After` | Back off, then retry or fall back. Never treat as "title does not exist". |

**Golden rule:** if Pictorium is unreachable/slow, or an item has no IMDb
id, fall back to your normal poster. Pictorium must never break your
catalogs. Unmapped posters cache ~6h, mapped posters ~24h; recent
render errors are negative-cached only ~5s.

Default render budget (tunable via env): max 4 concurrent renders
(`PICTORIUM_MAX_CONCURRENT_RENDERS`), 30s overall render deadline
(`PICTORIUM_RENDER_TIMEOUT_MS`), ~15s slot wait. A cold catalog grid bursts
through the 200-token bucket comfortably; sustained scraping above ~20 rps
per key gets `429`.

## License and attribution (AGPL-3.0-only)

Pictorium is licensed under the **GNU Affero General Public License v3.0**.
The short version for integrators:

1. **Keep it a separate service.** Do not copy the renderer into your own
   codebase — the combined work would fall under AGPL-3.0 with source
   disclosure. A network call to your own Pictorium instance keeps licenses
   clean on both sides.
2. **Publish your fork if you modify it.** Any change served over the
   network must have its Corresponding Source offered to that server's users
   (AGPL §13). Deploy-specific settings (keys, region defaults, env tuning)
   stay on your side; generic fixes belong upstream as PRs.
3. **Credit stays visible — including paid tiers.** Show "Powered by
   Pictorium" with a link to `https://github.com/Eful97/Pictorium`
   wherever the option is presented. Never present it as your own feature.
4. The full license text ships in the repo (`LICENSE`) and in the Docker
   image, and is exposed at runtime via `GET /api/license`.
