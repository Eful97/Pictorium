# Pictorium integration guide (poster endpoint only)

> 🇮🇹 Versione italiana: [`INTEGRAZIONE.md`](./INTEGRAZIONE.md)

This document is the stable contract for embedding Pictorium posters in a
third-party project (e.g. a Stremio add-on). It describes only what an
integrator needs: the poster endpoint, its query parameters, API keys,
failure behavior, and the license/attribution rules.

## Scope: poster endpoint only

Use **only** the poster endpoint and embed the resulting URLs in your own
catalogs:

```text
GET {yourInstanceUrl}/api/poster/{movie|series}/{id}
```

- `{movie|series}`: `movie` for films. `series`, `tv`, `show`, `tvshow` all
  mean TV series.
- `{id}`: a TMDB numeric id (`.../movie/550`) or an IMDb id (`.../movie/tt0133093`,
  resolved server-side to TMDB).

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
