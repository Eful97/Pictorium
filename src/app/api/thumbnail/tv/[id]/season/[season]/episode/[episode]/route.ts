import { createHash } from "node:crypto"
import { NextRequest } from "next/server"
import { getTVEpisodeDetails, getTVEpisodeImages, getExternalIds, resolveUserApiKeys } from "@/lib/tmdb"
import { getScopedUserId, userExists } from "@/lib/user-auth"
import { formatTvdbImageUrl, getTvdbEpisodesResult, getTvdbSeriesId } from "@/lib/tvdb"
import { resolveImdbId } from "@/lib/imdb-cache"
import {
  getEpisodeRatingsProvider,
  resolveEpisodeRatingsProvider,
  resolveEpisodeVoteProvenance,
} from "@/lib/episode-ratings-provider"
import type { EpisodeVoteProvenance } from "@/lib/episode-ratings-provider"
import { fetchCustomRatings, resolveCustomRatingConfig } from "@/lib/custom-rating"
import type { RatingItem } from "@/lib/custom-rating"
import { cacheGet, cacheSet } from "@/lib/cache"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { jsonGzip } from "@/lib/json-response"
import { initSharp } from "@/lib/sharp-config"
import { createLogger } from "@/lib/logger"
import {
  DEFAULT_THUMBNAIL_BADGE_ANCHOR,
  DEFAULT_THUMBNAIL_BADGE_SCALE,
  DEFAULT_THUMBNAIL_BADGE_STYLE,
  DEFAULT_THUMBNAIL_VOTE_SOURCE,
  THUMBNAIL_BADGE_OFFSET_MAX,
  THUMBNAIL_BADGE_OFFSET_MIN,
  THUMBNAIL_BADGE_SCALE_MAX,
  THUMBNAIL_BADGE_SCALE_MIN,
  THUMBNAIL_WIDTHS,
  ThumbnailRenderError,
  parseThumbnailBadgeMode,
  parseThumbnailBadgeStyle,
  parseThumbnailBadgeAnchor,
  parseThumbnailBadgeOffset,
  parseThumbnailBadgeScale,
  parseThumbnailBlur,
  parseThumbnailFillerStatus,
  parseThumbnailFillerStyle,
  parseThumbnailRotation,
  parseThumbnailStillSource,
  parseThumbnailVoteSource,
  parseThumbnailWidth,
  renderEpisodeThumbnail,
  resolveRotatedThumbnailStill,
  resolveThumbnailStill,
  sanitizeTvdbStillUrl,
  thumbnailBadgeGeometryReport,
  thumbnailCacheKey,
  thumbnailRotationBucket,
} from "@/lib/thumbnail-renderer"
import type { ThumbnailBadgeAnchor, ThumbnailBadgeStyle, ThumbnailFillerStatus, ThumbnailFillerStyle, ThumbnailVoteSource } from "@/lib/thumbnail-renderer"
import { getServerDefaultsForUser } from "@/lib/server-defaults"
import { getCatalogEpoch } from "@/lib/catalog-epoch"
import { baseLangCode, createT } from "@/lib/i18n-server"
import { canonicalPosterLang, isPublicPosterInstance } from "@/lib/poster-params-hardening"

type RouteParams = { id: string; season: string; episode: string }

const log = createLogger("thumbnail")

const CACHE_TTL_MS = 12 * 60 * 60 * 1000
const CACHE_TAGS = ["tmdb", "images", "thumbnail"]
const CACHE_CONTROL = "public, max-age=43200, s-maxage=43200, stale-while-revalidate=3600"
const MAX_LANGUAGES_LENGTH = 120

function jsonError(message: string, status: number, acceptEncoding: string | null): Response {
  return jsonGzip({ error: message }, status, { "Cache-Control": "no-store" }, acceptEncoding)
}

/** First usable locale from the `languages` passthrough (ratings metadata). */
function ratingLanguage(languages: string): string {
  const first = (languages.split(",")[0] || "").trim()
  return /^[a-z]{2}(?:-[A-Za-z]{2})?$/.test(first) ? first : "en-US"
}

/**
 * i18n keys of the on-image filler banner labels. The renderer only knows the
 * language-neutral status codes (`manga`/`anime`/`filler`/`mixed`), so the
 * localized text is resolved here and passed as a plain label — the same split
 * used by `ribbonLabel` on the poster path (label built once in the caller,
 * bytes rendered by the single shared compositor).
 */
const THUMBNAIL_FILLER_LABEL_KEYS: Record<ThumbnailFillerStatus, string> = {
  manga: "ui.thumbnailFillerStatusManga",
  anime: "ui.thumbnailFillerStatusAnime",
  filler: "ui.thumbnailFillerStatusFiller",
  mixed: "ui.thumbnailFillerStatusMixed",
}

/**
 * Locale of the filler banner label.
 *
 * There is no per-space "thumbnail language" setting (the banner describes the
 * episode, not the metadata), so the choice is per request:
 * `flang` (canonical UI tag) > the first usable `Accept-Language` tag > `en`.
 * `flang` is DISPLAY-only: an unusable value is ignored (never a 400) and the
 * request simply downgrades to the next level, because a garbage tag must not
 * break an otherwise valid thumbnail. The resolved tag is part of the cache
 * identity only when a banner is actually drawn (`thumbnailCacheKey`), so the
 * same episode in `it` and `en` never shares an entry, and the key stays
 * bounded (shipped locales + `en`).
 */
function resolveThumbnailFillerLanguage(flang: string | null, acceptLanguage: string | null): string {
  const canonical = (raw: string | null | undefined): string | null => {
    const trimmed = (raw ?? "").trim()
    if (!trimmed) return null
    return canonicalPosterLang(trimmed) ?? canonicalPosterLang(baseLangCode(trimmed))
  }
  const direct = canonical(flang)
  if (direct) return direct
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = (part.split(";")[0] ?? "").trim()
    if (!tag) continue
    const resolved = canonical(tag)
    if (resolved) return resolved
  }
  return "en"
}

// ---------------------------------------------------------------------------
// Space Miniature (episode thumbnail) defaults.
//
// AIOMetadata's Episode Thumbnail URL Pattern hardcodes `w`/`badges` and does
// NOT carry the user's style/corner/scale/source choices. Without this
// fallback those saved choices were visible only in the `/meta` composed URLs
// and silently ignored by a directly-called pattern, so a style change never
// reached the image. Precedence mirrors `/meta`: explicit query wins, then the
// namespace default, then the renderer default. Stored JSON is unvalidated
// (numbers included), so every read is clamped exactly like the renderer.
// ---------------------------------------------------------------------------

function storedThumbnailBadgeStyle(raw: unknown): ThumbnailBadgeStyle {
  if (typeof raw !== "string") return DEFAULT_THUMBNAIL_BADGE_STYLE
  return parseThumbnailBadgeStyle(raw) ?? DEFAULT_THUMBNAIL_BADGE_STYLE
}

function storedThumbnailAnchor(raw: unknown): ThumbnailBadgeAnchor {
  if (typeof raw !== "string") return DEFAULT_THUMBNAIL_BADGE_ANCHOR
  return parseThumbnailBadgeAnchor(raw) ?? DEFAULT_THUMBNAIL_BADGE_ANCHOR
}

function storedThumbnailVoteSource(raw: unknown): ThumbnailVoteSource {
  if (typeof raw !== "string") return DEFAULT_THUMBNAIL_VOTE_SOURCE
  return parseThumbnailVoteSource(raw) ?? DEFAULT_THUMBNAIL_VOTE_SOURCE
}

function storedThumbnailOffset(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0
  return Math.max(THUMBNAIL_BADGE_OFFSET_MIN, Math.min(THUMBNAIL_BADGE_OFFSET_MAX, Math.round(raw)))
}

function storedThumbnailScale(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_THUMBNAIL_BADGE_SCALE
  return Math.max(THUMBNAIL_BADGE_SCALE_MIN, Math.min(THUMBNAIL_BADGE_SCALE_MAX, Math.round(raw)))
}

function storedThumbnailFlag(raw: unknown): boolean {
  return typeof raw === "boolean" ? raw : false
}

function storedThumbnailFillerStyle(raw: unknown): ThumbnailFillerStyle {
  if (typeof raw !== "string") return "corner"
  return parseThumbnailFillerStyle(raw) ?? "corner"
}

function imageResponse(
  png: Buffer,
  etag: string,
  notModified: boolean,
  voteSource?: EpisodeVoteProvenance,
): Response {
  const headers: Record<string, string> = {
    ETag: etag,
    "Cache-Control": CACHE_CONTROL,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
  }
  // Provenance of the ★ value actually drawn: `imdb` = per-episode IMDb poll
  // (ShowGrid by default), `tmdb` = the fail-open episode `vote_average`
  // fallback, `imdb-fallback` = an opt-in provider was configured but
  // unusable, so the default ShowGrid poll served the value (never a silent
  // ToS bypass). Additive diagnostic header (no body/ETag change), so the
  // source is observable without re-rendering or inferring it from the pixels.
  if (voteSource) headers["X-Pictorium-Vote-Source"] = voteSource
  if (notModified) return new Response(null, { status: 304, headers })
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { ...headers, "Content-Type": "image/png" },
  })
}

/**
 * Resolve the TVDB episode still URL for `?stills=tvdb`.
 *
 * Strictly best-effort and fail-open: a missing/invalid TVDB key, no TVDB
 * series id, an upstream error or no matching episode all return `null`, and
 * the renderer uses the TMDB path instead (never a 500). The TVDB key is read
 * server-side only (header/query/env/namespace): it never enters the request
 * URL emitted to clients nor the cache key.
 */
async function resolveTvdbEpisodeStill(
  seriesId: number,
  seasonNumber: number,
  episodeNumber: number,
  tmdbKey: string | undefined,
  tvdbKey: string | undefined,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    if (!tvdbKey?.trim()) return null

    // Same resolution as the seasonTypes route: TMDB `external_ids` tvdb_id
    // first (reliable), IMDb/remoteid only as a fallback.
    let tvdbSeriesId: number | null = null
    try {
      const ext = await getExternalIds("tv", seriesId, tmdbKey, signal, 8000)
      if (typeof ext?.tvdb_id === "number" && ext.tvdb_id > 0) {
        tvdbSeriesId = ext.tvdb_id
      } else if (ext?.imdb_id) {
        tvdbSeriesId = await getTvdbSeriesId(ext.imdb_id, tvdbKey, signal)
      }
    } catch {
      // Non-fatal: try the numeric remoteid lookup below.
    }
    if (!tvdbSeriesId) tvdbSeriesId = await getTvdbSeriesId(String(seriesId), tvdbKey, signal)
    if (!tvdbSeriesId) return null

    // `default` season type + `default` language: the still image is not
    // language-dependent and this avoids a localized page miss. The whole leg
    // is cached by the TVDB module; a miss simply falls back to TMDB.
    const { episodes } = await getTvdbEpisodesResult(tvdbSeriesId, "default", tvdbKey, "default", signal)
    const match = episodes.find((ep) => ep.seasonNumber === seasonNumber && ep.number === episodeNumber)
    return sanitizeTvdbStillUrl(formatTvdbImageUrl(match?.image))
  } catch {
    return null
  }
}

const ROTATION_CANDIDATES_CACHE_TTL_MS = 12 * 60 * 60 * 1000

/**
 * Episode still candidates, shared by daily rotation (`?rotate=1`) and the
 * automatic still fallback (empty/absent `?still`).
 *
 * The list is the TMDB episode `/images` payload (already cached by the TMDB
 * module for 5 minutes); the sanitized path list is cached at the route level
 * for the same 12-hour family as the composed thumbnail so a shared render
 * never pays a second upstream lookup. Failures propagate to the callers:
 * `resolveRotatedThumbnailStill` fails open to the fixed `?still` (never a
 * 500), and the auto-still leg treats them as "no still" (400, as before).
 * Empty/failed lists are never cached.
 */
async function loadEpisodeStillCandidates(
  seriesId: number,
  seasonNumber: number,
  episodeNumber: number,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<string[]> {
  const key = `thumbnail:rotation-candidates:${seriesId}:${seasonNumber}:${episodeNumber}`
  const cached = cacheGet<string[]>(key)
  if (Array.isArray(cached) && cached.length > 0) return cached
  const images = await getTVEpisodeImages(
    seriesId,
    seasonNumber,
    episodeNumber,
    "en,null",
    apiKey,
    signal,
    8000,
  )
  const paths = images.stills
    .map((still) => still.file_path)
    .filter((path): path is string => typeof path === "string" && path.length > 0)
  if (paths.length > 0) cacheSet(key, paths, CACHE_TAGS, ROTATION_CANDIDATES_CACHE_TTL_MS)
  return paths
}

/**
 * Composed thumbnail for one TV episode still.
 *
 * Read-only GET: `?still=<TMDB still path | TMDB image URL | TVDB still URL>`
 * is optional. A path is canonicalized to a single file segment on the exact
 * `image.tmdb.org` host; a complete TMDB image URL (what AIO passes in its
 * `{thumbnail}` placeholder) is reduced to that same file name, so both
 * spellings share one cache entry and one byte-identical render. A complete
 * `https://artworks.thetvdb.com/...` raster URL is accepted as-is and fetched
 * directly (public artwork, no TVDB API key/lookup); its raw URL enters the
 * cache key, so it never collides with a TMDB path entry. An absent/blank
 * `still` (AIO substitutes empty `{thumbnail}` for episodes with no source
 * thumbnail) is auto-resolved to the episode's first TMDB still and renders
 * through the SAME pipeline/cache entry as that explicit path; only an episode
 * with no TMDB still at all keeps the historical 400. `w` is allowlisted
 * (invalid = 400) and `badges` is `both|vote|custom` (invalid = 400). The route
 * is mounted only under `/tv`, so non-TV ids are structurally rejected.
 *
 * Miniature choices (`bstyle`/`anchor`/`ox`/`oy`/`bscale`/`blur`/`source`/
 * `rotate`) keep the explicit-query contract (invalid = 400), but when a
 * parameter is absent it now follows the namespace's saved Miniature defaults
 * (`u` space, then the instance/global space) instead of always using the
 * renderer default; a namespace with no saved values is byte-identical to
 * before. This is what makes a directly-called AIO pattern reflect the style
 * chosen in the settings UI.
 *
 * `?stills=tmdb|tvdb` (default `tmdb`) selects the base still provider: `tvdb`
 * resolves the episode image from TheTVDB (artworks.thetvdb.com) and uses it
 * as the base with the SAME badge compositing; a TVDB miss/error fails open to
 * the required TMDB still, never a 500. The provider is part of the cache key
 * (and ETag via the content hash); the TVDB API key stays server-side and
 * never appears in the client URL or the key.
 *
 * `blur` (`0`/`1`/`true`/`false`, default `0`) is optional spoiler protection:
 * the episode still is Gaussian-blurred before compositing, while the rating
 * pills are drawn afterwards and stay crisp. The flag is part of the cache key
 * (and therefore the ETag via the content hash); absent and `0` are the same
 * byte-identical plain thumbnail.
 *
 * `rotate` (`0`/`1`/`true`/`false`, default `0`) opts into daily still
 * rotation: the episode's TMDB still list is resolved and the still comes from
 * the same 02:00 UTC day bucket as the dynamic poster rotation. The bucket is
 * part of the cache key; a provider miss/outage fails open to the fixed
 * `?still` with no bucket fragment, so the historical entry stays reusable and
 * rotation can never turn a thumbnail into a 500.
 *
 * `bscale` (`10..200`, default `100`) scales the composed badge pill; absent
 * and `100` are the same historical byte-identical render, and the value is
 * part of the cache key (and ETag).
 *
 * `fill` (`manga`/`anime`/`filler`/`mixed`) draws the anime filler
 * classification as a
 * top-left corner chip (default) or, with `fillStyle=strip`, as a full-width
 * banner on the top edge (the `/meta` resolver emits it only for a classified
 * episode with a no-ambiguity standard ordering). Absent or blank = no banner
 * and the historical bytes; an explicit unusable value is a 400. `fillStyle`
 * is absent = space default (then `corner`); an explicit unusable value is a
 * 400. The localized label is resolved per request (`flang` >
 * `Accept-Language` > `en`) and status, layout and locale are part of the
 * cache key, because the banner carries localized text; top-anchored badges
 * (`tl`/`tr`) are shifted below the banner, bottom-anchored ones (`bl`/`br`)
 * keep their historical placement. `flang` is display-only: an unusable tag is
 * ignored, never a 400.
 *
 * The response is a PNG cached for 12 hours (same `tmdb`/`images` family) and
 * revalidated with a content-hash ETag; upstream failures are never cached.
 * Badge style/provider/vote-source/stills changes produce a different
 * `thumbnailCacheKey`, so a longer TTL never serves a stale representation.
 *
 * The ★ pill carries the EPISODE rating, never the series average. `?source`
 * selects where that per-episode value comes from:
 *
 * - `imdb` (default): the configured episode-ratings provider. The default is
 *   `showgrid` (per-episode IMDb poll, resolved through the series IMDb id).
 *   Any invalid/missing id, transport error, empty map or missing/zero entry
 *   fails OPEN back to the TMDB episode vote, so the IMDb poll is the
 *   preferred source but never an empty/500 regression. Cinemeta is no longer
 *   consulted on this path (see `episode-ratings-provider.ts`; the operator
 *   explicitly accepted the ShowGrid risk: no licence, permission pending).
 *   `PICTORIUM_EPISODE_RATINGS_PROVIDER` can opt into another registry
 *   provider (seriesgraph/dataset require an explicit non-commercial ack and
 *   URL; otherwise the route warns and uses ShowGrid);
 * - `tmdb` (explicit): `vote_average` of this very episode, no episode
 *   provider is consulted at all.
 *
 * A missing/zero episode rating skips the pill; a TMDB metadata failure on the
 * fallback leg fails closed (502) instead of falling back to the series
 * average. `source` is part of the cache key (and therefore the ETag via the
 * content hash); the effective provider id is part of the key too.
 *
 * The source actually drawn is echoed in the additive
 * `X-Pictorium-Vote-Source` header (`imdb` | `tmdb` | `imdb-fallback`): a miss
 * that fell back to the TMDB episode vote, or a configured opt-in provider
 * that could not run and resolved through the default ShowGrid poll, is
 * observable without inferring it from pixels.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  initSharp()

  const { id, season, episode } = await params
  const sp = req.nextUrl.searchParams
  const acceptEncoding = req.headers.get("accept-encoding")

  const seriesId = Number(id)
  const seasonNumber = Number(season)
  const episodeNumber = Number(episode)
  if (!Number.isInteger(seriesId) || seriesId <= 0) {
    return jsonError("Invalid id: must be a positive integer", 400, acceptEncoding)
  }
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0) {
    return jsonError("Invalid season: must be a non-negative integer", 400, acceptEncoding)
  }
  if (!Number.isInteger(episodeNumber) || episodeNumber < 0) {
    return jsonError("Invalid episode: must be a non-negative integer", 400, acceptEncoding)
  }

  // `still` is OPTIONAL: AIOMetadata substitutes an EMPTY `{thumbnail}` for
  // episodes whose source video carries no `originalThumb`, and those rows must
  // not fall back to the client placeholder when TMDB has a still for the
  // episode. Accepted spellings: a TMDB path, a complete TMDB image URL, or a
  // complete TVDB artwork URL (`artworks.thetvdb.com`, fetched directly: no
  // API key lookup). An explicit but unacceptable still stays a hard 400
  // before any upstream fetch (unchanged); an absent/blank still is
  // auto-resolved from the episode's TMDB stills right before the cache
  // identity is built.
  const rawStill = sp.get("still")
  const explicitStill = resolveThumbnailStill(rawStill)
  if (!explicitStill && rawStill !== null && rawStill.trim() !== "") {
    return jsonError(
      "Invalid still: expected a TMDB still path/URL or a TVDB still URL",
      400,
      acceptEncoding,
    )
  }
  // Base provider: `tmdb` (default, historical) or `tvdb`. The supplied still is
  // still required as the fail-open fallback in both cases.
  const stillsSource = parseThumbnailStillSource(sp.get("stills"))
  if (stillsSource === null) {
    return jsonError("Invalid stills: must be tmdb or tvdb", 400, acceptEncoding)
  }
  const width = parseThumbnailWidth(sp.get("w") ?? null)
  if (width === null) {
    return jsonError(`Invalid w: must be one of ${THUMBNAIL_WIDTHS.join(", ")}`, 400, acceptEncoding)
  }
  const badgeMode = parseThumbnailBadgeMode(sp.get("badges") ?? null)
  if (badgeMode === null) {
    return jsonError("Invalid badges: must be both, vote or custom", 400, acceptEncoding)
  }
  // Explicit query values keep their historical contract: invalid = 400.
  // Absent values are resolved from the space Miniature defaults below.
  const rawBadgeStyle = sp.get("bstyle")
  const queryBadgeStyle = parseThumbnailBadgeStyle(rawBadgeStyle)
  if (queryBadgeStyle === null) {
    return jsonError("Invalid bstyle: must be pill, bordo, vetro, branded, naked, score or circle", 400, acceptEncoding)
  }
  // Corner anchor + manual offsets (8px margin is the anchor's default).
  const rawAnchor = sp.get("anchor")
  const queryAnchor = parseThumbnailBadgeAnchor(rawAnchor)
  if (queryAnchor === null) {
    return jsonError("Invalid anchor: must be tl, tr, bl or br", 400, acceptEncoding)
  }
  const rawOffsetX = sp.get("ox")
  const rawOffsetY = sp.get("oy")
  const queryOffsetX = parseThumbnailBadgeOffset(rawOffsetX)
  const queryOffsetY = parseThumbnailBadgeOffset(rawOffsetY)
  if (queryOffsetX === null || queryOffsetY === null) {
    return jsonError("Invalid ox/oy: integer px between -2000 and 2000", 400, acceptEncoding)
  }
  // Badge-stack scale: percent of the standard render (10..200, absent = 100).
  // Applied to the composed pill bitmap; 100 is byte-identical to the
  // historical fixed-size thumbnail.
  const rawBadgeScale = sp.get("bscale")
  const queryBadgeScale = parseThumbnailBadgeScale(rawBadgeScale)
  if (queryBadgeScale === null) {
    return jsonError("Invalid bscale: integer percent between 10 and 200", 400, acceptEncoding)
  }
  const rawBlur = sp.get("blur")
  const queryBlur = parseThumbnailBlur(rawBlur)
  if (queryBlur === null) {
    return jsonError("Invalid blur: must be 0, 1, true or false", 400, acceptEncoding)
  }
  // Daily still rotation: absent/OFF keeps the fixed `?still` and the
  // historical cache entry byte-identical; only an explicit opt-in can change
  // the selected still.
  const rawRotation = sp.get("rotate")
  const queryRotation = parseThumbnailRotation(rawRotation)
  if (queryRotation === null) {
    return jsonError("Invalid rotate: must be 0, 1, true or false", 400, acceptEncoding)
  }
  const rawVoteSource = sp.get("source")
  const queryVoteSource = parseThumbnailVoteSource(rawVoteSource)
  if (queryVoteSource === null) {
    return jsonError("Invalid source: must be tmdb or imdb", 400, acceptEncoding)
  }
  // Anime filler banner: the code is emitted by `/meta` only for a classified
  // episode. Absent (or blank, like a blank `still`) = no banner and the
  // historical render; an EXPLICIT unusable value is a 400, matching every
  // other enum parameter. The legacy `canon` code is accepted as an alias of
  // `manga` (same green bytes, same `:flmanga` cache entry). `flang` is
  // display-only and never rejected.
  const rawFill = sp.get("fill")
  const queryFill: ThumbnailFillerStatus | null = parseThumbnailFillerStatus(rawFill)
  if (!queryFill && rawFill !== null && rawFill.trim() !== "") {
    return jsonError("Invalid fill: must be manga, anime, filler or mixed", 400, acceptEncoding)
  }
  // Banner layout: absent = space default (then corner); an explicit unusable
  // value is a 400 like the other enums. It is meaningful only with `fill`.
  const rawFillStyle = sp.get("fillStyle")
  const queryFillStyle = parseThumbnailFillerStyle(rawFillStyle)
  if (queryFillStyle === null && rawFillStyle !== null && rawFillStyle.trim() !== "") {
    return jsonError("Invalid fillStyle: must be corner or strip", 400, acceptEncoding)
  }
  const fillerLanguage = queryFill
    ? resolveThumbnailFillerLanguage(sp.get("flang"), req.headers.get("accept-language"))
    : null
  const rawLanguages = sp.get("languages") || "en,null"
  const languages = /^[A-Za-z0-9,-]{1,120}$/.test(rawLanguages) && rawLanguages.length <= MAX_LANGUAGES_LENGTH
    ? rawLanguages
    : "en,null"

  const wantsGeometry = sp.get("debug") === "1" && sp.get("netgeo") === "1"
  // Namespace utente (multi-user): STESSA regola della route poster — un `u`
  // che non nomina uno spazio esistente vale come anonimo PRIMA della
  // risoluzione chiavi (spazi fantasma collassati a null). Senza questo
  // collapse `scopedUser` restava valorizzato, con MULTI_USER=1 il fallback
  // d'istanza veniva spento e la thumbnail falliva 502 mentre il poster con lo
  // stesso `u` (pattern senza `api_key`) rispondeva 200. Nessun nuovo accesso:
  // è esattamente il fallback che il poster già concede.
  const rawUser = sp.get("u") ?? sp.get("user")
  let scopedUser = getScopedUserId(rawUser)
  if (scopedUser && !(await userExists(scopedUser))) scopedUser = null
  const effKeys = await resolveUserApiKeys(req, scopedUser)
  const apiKey = effKeys.tmdb.key
  const tvdbKey = effKeys.tvdb.key
  // Space Miniature defaults (namespace `u`, phantom spaces already collapsed
  // to anonymous above). Explicit query params keep winning; absent ones now
  // follow the saved settings, so a directly-called AIO pattern renders the
  // same style/corner/scale/blur/source/rotation as the `/meta` composed URLs
  // and the settings preview instead of silently falling back to `pill`.
  // A namespace with no saved values resolves to the renderer defaults, so the
  // historical bytes/cache key stay identical.
  const spaceDefaults = await getServerDefaultsForUser(scopedUser)
  const badgeStyle = rawBadgeStyle === null
    ? storedThumbnailBadgeStyle(spaceDefaults.thumbnailBadgeStyle)
    : queryBadgeStyle
  const badgeAnchor = rawAnchor === null
    ? storedThumbnailAnchor(spaceDefaults.thumbnailAnchor)
    : queryAnchor
  // Anti cache-busting: su istanze pubbliche gli anonimi ottengono ox/oy solo a
  // passi di 5px, prima della cache key. Solo i valori da query: i default salvati
  // restano esatti (WYSIWYG); utente verificato / istanza privata invariati.
  const quantizeAnonOffset = (v: number): number =>
    !scopedUser && isPublicPosterInstance() ? Math.round(v / 5) * 5 : v
  const offsetX = rawOffsetX === null
    ? storedThumbnailOffset(spaceDefaults.thumbnailOffsetX)
    : quantizeAnonOffset(queryOffsetX)
  const offsetY = rawOffsetY === null
    ? storedThumbnailOffset(spaceDefaults.thumbnailOffsetY)
    : quantizeAnonOffset(queryOffsetY)
  const badgeScale = rawBadgeScale === null
    ? storedThumbnailScale(spaceDefaults.thumbnailBadgeScale)
    : queryBadgeScale
  const blur = rawBlur === null ? storedThumbnailFlag(spaceDefaults.thumbnailBlur) : queryBlur
  const rotationEnabled = rawRotation === null
    ? storedThumbnailFlag(spaceDefaults.thumbnailRotation)
    : queryRotation
  const voteSource = rawVoteSource === null
    ? storedThumbnailVoteSource(spaceDefaults.thumbnailVoteSource)
    : queryVoteSource
  // Banner layout resolution mirrors `bstyle`: explicit query (absent/blank =
  // fall through) > space default > corner. Only meaningful when a
  // classification is actually drawn; otherwise it has no render/cache effect.
  const fillerStyle: ThumbnailFillerStyle = rawFillStyle === null
    ? storedThumbnailFillerStyle(spaceDefaults.thumbnailFillerStyle)
    : queryFillStyle ?? storedThumbnailFillerStyle(spaceDefaults.thumbnailFillerStyle)
  const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(8000) : undefined
  // Auto still (absent/blank `?still` only): the first usable TMDB episode
  // still, from the SAME sanitized candidate list daily rotation uses (already
  // cached at route level; zero extra I/O when rotation ran in this slot).
  //
  // Cache identity: the RESOLVED PATH is used exactly as an explicit `?still`
  // would be, so no "auto" marker is added. That is deliberate: the composed
  // bytes are path-identical, and AIO's empty-substitution rows then share the
  // historical entry of the same still instead of fragmenting the cache. A
  // TMDB episode with no still at all (or a failed lookup) keeps today's 400 —
  // there is no base image to composite — and is never cached.
  let still = explicitStill
  if (!still) {
    const candidates = await loadEpisodeStillCandidates(
      seriesId,
      seasonNumber,
      episodeNumber,
      apiKey,
      signal,
    ).catch(() => [] as string[])
    still = candidates[0] ?? null
    if (!still) {
      return jsonError("No TMDB still for this episode", 400, acceptEncoding)
    }
  }
  // Provider selection is read per request (never at module level) and is part
  // of the cache identity: an opt-in provider can never reuse a Cinemeta entry.
  const providerSelection = resolveEpisodeRatingsProvider()
  const provider = getEpisodeRatingsProvider(providerSelection.provider)
  // Rotation is resolved BEFORE the cache lookup because the selected still is
  // part of the cache identity. `resolveRotatedThumbnailStill` never rejects:
  // a TMDB miss/outage keeps the fixed still and emits no bucket fragment, so
  // the historical key (and its entries) stay reusable.
  const rotation = rotationEnabled
    ? await resolveRotatedThumbnailStill({
        fallback: still,
        bucket: thumbnailRotationBucket(),
        loadCandidates: () => loadEpisodeStillCandidates(seriesId, seasonNumber, episodeNumber, apiKey, signal),
      })
    : null
  const effectiveStill = rotation?.still ?? still
  const thumbnailEpoch = await getCatalogEpoch(scopedUser)
  const cacheKey = thumbnailCacheKey({ seriesId, seasonNumber, episodeNumber, still: effectiveStill, width, badges: badgeMode, badgeStyle, anchor: badgeAnchor, offsetX, offsetY, badgeScale, languages, blur, voteSource, provider: providerSelection.provider, stills: stillsSource, rotationBucket: rotation?.rotationBucket ?? undefined, epoch: thumbnailEpoch, filler: queryFill ?? undefined, fillerStyle: queryFill ? fillerStyle : undefined, fillerLang: fillerLanguage ?? undefined })
  if (!wantsGeometry) {
    const cached = cacheGet<{ png: Buffer; etag: string; voteSource?: ThumbnailVoteSource }>(cacheKey)
    if (cached) {
      return imageResponse(
        cached.png,
        cached.etag,
        req.headers.get("if-none-match") === cached.etag,
        resolveEpisodeVoteProvenance(providerSelection, cached.voteSource ?? voteSource),
      )
    }
  }

  // Vote of THIS episode for the ★ pill (TOP Posters contract: the pill is the
  // episode rating, never the series average).
  //
  // `imdb` is the DEFAULT source: resolve the series IMDb id, then ask the
  // configured episode-ratings provider (ShowGrid by default, see
  // `episode-ratings-provider.ts`). The whole provider leg is fail-open: an
  // invalid/missing id, a transport error, an empty map or a missing/zero
  // entry all leave `voteAverage` at 0 and the source falls back to TMDB
  // below (never an empty/500 regression when TMDB has the vote). Explicit
  // `?source=tmdb` skips this leg entirely. Only the TMDB leg is fail-closed.
  let voteAverage = 0
  let effectiveVoteSource: ThumbnailVoteSource = voteSource
  if (voteSource === "imdb") {
    if (provider.id === "tmdb") {
      // Explicit `tmdb` provider (or `off`): no external episode provider is
      // consulted; the TMDB leg below is the source.
      effectiveVoteSource = "tmdb"
    } else {
      try {
        const imdbId = await resolveImdbId("tv", seriesId, apiKey, 8000, signal)
        // The provider owns its parsing/validation: ShowGrid rejects malformed
        // ids before any fetch, and an unimplemented opt-in provider
        // (seriesgraph/dataset) fails closed with `null`.
        const rating = await provider.fetch({
          seriesId,
          imdbId,
          season: seasonNumber,
          episode: episodeNumber,
          signal,
        })
        if (typeof rating === "number" && Number.isFinite(rating) && rating > 0) {
          voteAverage = rating
        }
      } catch {
        voteAverage = 0
      }
      if (voteAverage > 0) {
        // IMDb-family hit: no TMDB metadata fetch needed for the ★ value.
      } else {
        effectiveVoteSource = "tmdb"
        log.debug("Thumbnail vote: episode provider miss, falling back to TMDB", {
          provider: provider.id,
          seriesId,
          season: seasonNumber,
          episode: episodeNumber,
        })
      }
    }
  }

  if (effectiveVoteSource === "tmdb") {
    try {
      const episodeDetails = await getTVEpisodeDetails(
        seriesId,
        seasonNumber,
        episodeNumber,
        ratingLanguage(languages),
        apiKey,
        signal,
        8000,
      )
      if (typeof episodeDetails.vote_average === "number" && Number.isFinite(episodeDetails.vote_average)) {
        voteAverage = episodeDetails.vote_average
      }
    } catch {
      return jsonError("TMDB episode details unavailable", 502, acceptEncoding)
    }
  }

  // Optional custom provider. The pipeline already swallows transport/config
  // failures into `[]`; the extra guard keeps a future throwing provider from
  // turning a thumbnail into a 500 (both always degrades to vote-only).
  //
  // Their scope is TITLE-level: the endpoint is queried with the SERIES IMDb
  // id, so these scores describe the show, not this episode. They are passed
  // through with `customRatingsScope: "title"` (fail-closed) and therefore
  // render as the neutral text pill; they are never branded as an episode
  // IMDb/MAL value. The per-episode IMDb poll is a different channel: it feeds
  // the neutral ★ through `?source=imdb` above (`voteSource`), not the custom
  // pill, so the two never double-count the same score.
  let customRatings: RatingItem[] = []
  if (badgeMode !== "vote") {
    const customConfig = resolveCustomRatingConfig()
    if (customConfig.enabled) {
      try {
        const imdbId = await resolveImdbId("tv", seriesId, apiKey, 8000, signal)
        if (imdbId) customRatings = await fetchCustomRatings(imdbId, customConfig, signal)
      } catch {
        customRatings = []
      }
    }
  }

  // Preferred TVDB still (only for an explicit `?stills=tvdb`). Resolved AFTER
  // the cache lookup so a cache hit never pays the third-party lookup, and
  // fail-open to `null` so the renderer falls back to the TMDB still.
  let tvdbStill: string | null = null
  if (stillsSource === "tvdb") {
    tvdbStill = await resolveTvdbEpisodeStill(seriesId, seasonNumber, episodeNumber, apiKey, tvdbKey, signal)
  }

  let result: Awaited<ReturnType<typeof renderEpisodeThumbnail>>
  try {
    result = await renderEpisodeThumbnail({
      still: effectiveStill,
      stills: stillsSource,
      tvdbStill,
      width,
      badgeMode,
      voteAverage,
      customRatings,
      // Title-level scores (series id): never eligible for the branded pill.
      customRatingsScope: "title",
      badgeStyle,
      anchor: badgeAnchor,
      offsetX,
      offsetY,
      badgeScale,
      // Provenance of the ★ value: the fallback leg is genuinely TMDB.
      voteSource: effectiveVoteSource,
      blur,
      // Filler banner: status + localized label resolved above, drawn by the
      // single local banner builder (no second renderer).
      filler: queryFill,
      fillerStyle: queryFill ? fillerStyle : null,
      fillerLabel: queryFill
        ? createT(fillerLanguage ?? "en")(THUMBNAIL_FILLER_LABEL_KEYS[queryFill])
        : null,
      signal,
    })
  } catch (e) {
    if (e instanceof ThumbnailRenderError) {
      return jsonError(e.message, e.status, acceptEncoding)
    }
    return jsonError("Episode thumbnail unavailable", 502, acceptEncoding)
  }

  // Diagnostics for the SAME enlarged-preview drag layer used by posters:
  // report the visible stack box instead of PNG bytes. No cache entry (the
  // box is derived from the render, not stored) and no image response.
  if (wantsGeometry) {
    return jsonGzip(thumbnailBadgeGeometryReport(result), 200, undefined, acceptEncoding)
  }

  const etag = `"${createHash("sha256").update(result.png).digest("hex")}"`
  // The cache stores the renderer's provenance (`imdb`/`tmdb`); the response
  // header additionally discloses an opt-in provider that resolved through
  // Cinemeta (`imdb-fallback`), computed per request so a shared cache entry
  // stays honest for both callers.
  const voteProvenance = resolveEpisodeVoteProvenance(providerSelection, effectiveVoteSource)
  // Failures never reach this point, so only successful composites are cached.
  cacheSet(cacheKey, { png: result.png, etag, voteSource: effectiveVoteSource }, CACHE_TAGS, CACHE_TTL_MS)
  return imageResponse(
    result.png,
    etag,
    req.headers.get("if-none-match") === etag,
    voteProvenance,
  )
}
