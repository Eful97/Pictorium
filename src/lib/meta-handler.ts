import crypto from "node:crypto"
import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGetShared, cacheSet, hashUserFragment } from "@/lib/cache"
import { getServerDefaultsChecked, getServerDefaultsForUser, type ServerDefaults } from "@/lib/server-defaults"
import { POSTER_URL_VERSION } from "@/lib/render-version"
import { getById } from "@/lib/store"
import { decodeConfig, type PictoriumUserConfig } from "@/lib/config-token"
import { selectBestLogo } from "@/lib/logo-selection"
import {
  getFullDetails,
  getImages,
  getTVSeason,
  getTVEpisodeGroup,
  type TMDBEpisodeGroupDetails,
  posterUrl,
  posterUrlOriginal,
  resolveUserApiKeys,
  tmdbFindByImdb,
  tmdbFindByTvdb,
  evictTVSeasonCache,
} from "@/lib/tmdb"
import { resolveImdbId } from "@/lib/imdb-cache"
import { isValidImdbId } from "@/lib/imdb-csv"
import { getCatalogEpoch } from "@/lib/catalog-epoch"
import { buildNoticeDetail, NOTICE_ID_PREFIX } from "@/lib/notice-meta"
import { resolveCatalogRegionWithDefaults, normalizeCatalogRating } from "@/lib/catalog-handler"
import { isSupportedUiLang, contentLanguageForUiLang } from "@/lib/regions"
import { getScopedUserId, userExists, userRateLimitKey } from "@/lib/user-auth"
import { touchUserActivity } from "@/lib/user-activity"
import { buildStremioPosterUrl, stremioPosterShape } from "@/lib/stremio-poster-url"
import { mappingHasBothShapeBases } from "@/lib/catalog-shape"
import { normalizeSeasonalTheme, resolveEffectiveSeasonalTheme } from "@/lib/seasonal-theme"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { enrichVideosWithTvdbDetailed } from "@/lib/tvdb"
import { buildVideosFromAnizip, buildVideosFromGroupsDetailed, buildVideosFromTvdbDetailed, concurrentMap, isSeasonEpisodesComplete } from "@/lib/episode-ordering"
import { groupDetailsEpisodeCount, groupDetailsRegularEpisodeCount, resolveDefaultEpisodeGroupId } from "@/lib/episode-group-default"
import { createLogger } from "@/lib/logger"
import { sanitizeEpisodeStillPath } from "@/lib/episode-stills"
import { resolveFillerStatus } from "@/lib/anime-filler"
import { fetchCinemetaRating } from "@/lib/cinemeta"
import type {
  ThumbnailBadgeAnchor,
  ThumbnailBadgeStyle,
  ThumbnailStillSource,
  ThumbnailVoteSource,
} from "@/lib/thumbnail-renderer"

const log = createLogger("meta")

import { combineAbortSignals } from "@/lib/abort-signal"

const META_TOTAL_BUDGET_MS = 15000

export interface StremioVideo {
  id: string
  name: string
  season: number
  episode: number
  overview?: string
  thumbnail?: string
  released?: string
  rating?: string
}

export interface StremioTrailer {
  source: string
  type: string
}

/**
 * Stremio `meta.links` entry. Categories mirror stremio-core constants
 * (`GENRES_LINK_CATEGORY` / `IMDB_LINK_CATEGORY`): "Genres" opens the
 * discover view on our own Top catalog, "imdb" opens the title page.
 */
export interface StremioLink {
  name: string
  category: "Genres" | "imdb"
  url: string
}

export interface StremioMetaDetail {
  id: string
  imdb_id?: string
  type: "movie" | "series"
  name: string
  genres: string[]
  poster: string | null
  posterShape?: "poster" | "landscape"
  background?: string
  /** Render landscape con logo baked-in (solo titoli landscape, vedi
   *  catalog-handler: NuvioTV non deve sovrapporre il logo separato). */
  landscapePoster?: string
  logo?: string
  description?: string
  releaseInfo?: string
  released?: string
  runtime?: string
  imdbRating?: string
  cast?: string[]
  director?: string[]
  writer?: string[]
  trailers?: StremioTrailer[]
  links?: StremioLink[]
  behaviorHints?: {
    defaultVideoId?: string
    hasScheduledVideos?: boolean
  }
  videos?: StremioVideo[]
}

function metaResponse(body: { meta: StremioMetaDetail | null }, isPartial = false): Response {
  return Response.json(body, {
    headers: {
      // Stremio Web uses a CDN with long caching: 12h made ordering changes
      // invisible (Re:ZERO: worked on Nuvio/bypass, not on Stremio web).
      // 5 min + a short SWR is enough for performance and lets episodeGroupId
      // changes propagate quickly. The server still invalidates the internal
      // cache on PUT/POST mapping.
      // Partial data (interrupted/truncated seasons): short downstream TTL
      // with no SWR, so 60s is a hard upper stale bound and the retry can
      // actually serve the recovery instead of extended-stale content.
      "Cache-Control": isPartial
        ? "public, max-age=60"
        : "public, max-age=300, stale-while-revalidate=600",
      "Access-Control-Allow-Origin": "*",
    },
  })
}

function hashFragment(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 8)
}

/**
 * Episode thumbnail contract (mirrors `/api/thumbnail/tv/...`): 320px wide
 * 16:9 canvas with both rating pills enabled. `still` travels URL-encoded; the
 * raw TMDB w500 still is intentionally replaced (the composed URL keeps the
 * still path in the query for traceability) and is never duplicated as a
 * separate field.
 */
const EPISODE_THUMBNAIL_WIDTH = 320
const EPISODE_THUMBNAIL_BADGES = "both"

/**
 * Persisted Miniature visual choices (renderer contract) resolved with the
 * usual metadata precedence: query override > config token > namespace/defaults
 * > renderer default. Values are sanitized by the renderer's own parsers, so
 * this module never drifts from the `/api/thumbnail` contract.
 */
interface EpisodeThumbnailOptions {
  badgeStyle: ThumbnailBadgeStyle
  anchor: ThumbnailBadgeAnchor
  offsetX: number
  offsetY: number
  badgeScale: number
  blur: boolean
  voteSource: ThumbnailVoteSource
  /** Daily still rotation (`rotate`): default OFF (fixed still). */
  rotation: boolean
  /**
   * Anime filler classification banner (`fill=`): default OFF. When ON the
   * compositor URL carries the language-neutral code (`manga` | `anime` |
   * `filler` | `mixed`) only for titles/episodes known to the bundled
   * snapshot, and only on standard TMDB ordering (never on remapped S:E).
   */
  fillerBadge: boolean
  /**
   * Layout of the classification banner (`fillStyle`): `corner`/`strip`.
   * Display-only, resolved token > defaults > corner. `corner` is omitted from
   * the compositor URL (it is the absent render), so pre-style URLs stay
   * byte-identical; `strip` is emitted only when a classification is drawn.
   */
  fillerStyle: "corner" | "strip"
  /**
   * Base still provider: `tvdb` when the space resolves episode metadata from
   * TheTVDB (the compositor's `?stills=` contract), `tmdb` otherwise.
   */
  stills: ThumbnailStillSource
}

async function resolveEpisodeThumbnailOptions(
  searchParams: URLSearchParams,
  config: Partial<PictoriumUserConfig> | null,
  defaults: ServerDefaults,
  stills: ThumbnailStillSource,
  /**
   * Per-title rotation override from the saved mapping: explicit true/false
   * wins on the space default, null/undefined inherits it. Sits between the
   * ephemeral query override and the config token, like the other per-title
   * choices.
   */
  mappingRotation?: boolean | null,
): Promise<EpisodeThumbnailOptions> {
  const {
    parseThumbnailBadgeStyle,
    parseThumbnailBadgeAnchor,
    parseThumbnailBadgeOffset,
    parseThumbnailBadgeScale,
    parseThumbnailVoteSource,
    parseThumbnailBlur,
    parseThumbnailRotation,
    DEFAULT_THUMBNAIL_BADGE_STYLE,
    DEFAULT_THUMBNAIL_BADGE_ANCHOR,
    DEFAULT_THUMBNAIL_BADGE_SCALE,
    DEFAULT_THUMBNAIL_VOTE_SOURCE,
    THUMBNAIL_BADGE_OFFSET_MIN,
    THUMBNAIL_BADGE_OFFSET_MAX,
    THUMBNAIL_BADGE_SCALE_MIN,
    THUMBNAIL_BADGE_SCALE_MAX,
  } = await import("@/lib/thumbnail-renderer")

  // Invalid explicit query values fall through to the next level (fail-closed
  // to a valid rendering, never a 400 on an otherwise valid meta URL).
  const pick = <T>(
    queryName: string,
    configValue: unknown,
    storedValue: unknown,
    parse: (raw: string | null | undefined) => T | null,
    fallback: T,
  ): T => {
    const queryRaw = searchParams.get(queryName)
    if (queryRaw !== null) {
      const parsed = parse(queryRaw)
      if (parsed !== null) return parsed
    }
    for (const candidate of [configValue, storedValue]) {
      if (typeof candidate === "string") {
        const parsed = parse(candidate)
        if (parsed !== null) return parsed
      }
    }
    return fallback
  }

  const pickOffset = (queryName: string, configValue: unknown, storedValue: unknown): number => {
    const queryRaw = searchParams.get(queryName)
    if (queryRaw !== null) {
      const parsed = parseThumbnailBadgeOffset(queryRaw)
      if (parsed !== null) return parsed
    }
    for (const candidate of [configValue, storedValue]) {
      // Stored/token offsets are numbers (token schema), but the storage is
      // unvalidated JSON: clamp and round exactly like the renderer parser.
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return Math.max(THUMBNAIL_BADGE_OFFSET_MIN, Math.min(THUMBNAIL_BADGE_OFFSET_MAX, Math.round(candidate)))
      }
      if (typeof candidate === "string") {
        const parsed = parseThumbnailBadgeOffset(candidate)
        if (parsed !== null) return parsed
      }
    }
    return 0
  }

  const pickBlur = (): boolean => {
    const queryRaw = searchParams.get("blur")
    if (queryRaw !== null) {
      const parsed = parseThumbnailBlur(queryRaw)
      if (parsed !== null) return parsed
    }
    for (const candidate of [config?.thumbnailBlur, defaults.thumbnailBlur]) {
      if (typeof candidate === "boolean") return candidate
    }
    return false
  }

  const pickRotation = (): boolean => {
    const queryRaw = searchParams.get("rotate")
    if (queryRaw !== null) {
      const parsed = parseThumbnailRotation(queryRaw)
      if (parsed !== null) return parsed
    }
    // Per-title saved choice (`thumbnailRotation` on the mapping): explicit
    // true/false wins on the space default, null/absent inherits it.
    if (typeof mappingRotation === "boolean") return mappingRotation
    for (const candidate of [config?.thumbnailRotation, defaults.thumbnailRotation]) {
      if (typeof candidate === "boolean") return candidate
    }
    return false
  }

  // Anime filler banner toggle: no ephemeral query override (the banner is a
  // persisted space choice), so it resolves token > defaults > OFF. The
  // resolved value is emitted per-episode as an explicit `fill=` code, so the
  // compositor URL stays self-contained (no config token needed).
  const pickFillerBadge = (): boolean => {
    for (const candidate of [config?.thumbnailFillerBadge, defaults.thumbnailFillerBadge]) {
      if (typeof candidate === "boolean") return candidate
    }
    return false
  }

  // Banner layout: token > space default > corner. Only the non-default
  // `strip` travels on the compositor URL (corner is the absent render), so a
  // space that never chose a style keeps byte-identical URLs.
  const pickFillerStyle = (): "corner" | "strip" => {
    for (const candidate of [config?.thumbnailFillerStyle, defaults.thumbnailFillerStyle]) {
      if (candidate === "strip" || candidate === "corner") return candidate
    }
    return "corner"
  }

  const pickScale = (queryName: string, configValue: unknown, storedValue: unknown): number => {
    const queryRaw = searchParams.get(queryName)
    if (queryRaw !== null) {
      const parsed = parseThumbnailBadgeScale(queryRaw)
      if (parsed !== null) return parsed
    }
    for (const candidate of [configValue, storedValue]) {
      // Stored/token scales are numbers, but the storage is unvalidated JSON:
      // clamp and round exactly like the renderer parser.
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return Math.max(THUMBNAIL_BADGE_SCALE_MIN, Math.min(THUMBNAIL_BADGE_SCALE_MAX, Math.round(candidate)))
      }
      if (typeof candidate === "string") {
        const parsed = parseThumbnailBadgeScale(candidate)
        if (parsed !== null) return parsed
      }
    }
    return DEFAULT_THUMBNAIL_BADGE_SCALE
  }

  return {
    stills,
    badgeStyle: pick(
      "bstyle",
      config?.thumbnailBadgeStyle,
      defaults.thumbnailBadgeStyle,
      parseThumbnailBadgeStyle,
      DEFAULT_THUMBNAIL_BADGE_STYLE,
    ),
    anchor: pick(
      "anchor",
      config?.thumbnailAnchor,
      defaults.thumbnailAnchor,
      parseThumbnailBadgeAnchor,
      DEFAULT_THUMBNAIL_BADGE_ANCHOR,
    ),
    offsetX: pickOffset("ox", config?.thumbnailOffsetX, defaults.thumbnailOffsetX),
    offsetY: pickOffset("oy", config?.thumbnailOffsetY, defaults.thumbnailOffsetY),
    badgeScale: pickScale("bscale", config?.thumbnailBadgeScale, defaults.thumbnailBadgeScale),
    blur: pickBlur(),
    rotation: pickRotation(),
    fillerBadge: pickFillerBadge(),
    fillerStyle: pickFillerStyle(),
    voteSource: pick(
      "source",
      config?.thumbnailVoteSource,
      defaults.thumbnailVoteSource,
      parseThumbnailVoteSource,
      DEFAULT_THUMBNAIL_VOTE_SOURCE,
    ),
  }
}

/** Cache-key fragment for the resolved Miniature choices (never a secret). */
function thumbnailOptionsCacheFragment(options: EpisodeThumbnailOptions): string {
  // `stills` is explicit only when it changes the representation (TVDB base);
  // the TMDB path keeps the historical fragment byte-identical. The source is
  // already carried by `:es`, this segment makes the compositor identity
  // self-describing in the key.
  const stillsFragment = options.stills === "tvdb" ? ":tstvdb" : ""
  // OFF keeps the historical fragment byte-identical; rotation is a
  // representation change and must never reuse a fixed-still body.
  const rotationFragment = options.rotation ? ":tr1" : ""
  // Filler banner: OFF keeps the historical fragment byte-identical; ON is a
  // representation change for known titles (per-episode `fill=`), so it must
  // never reuse a body composed with the banner disabled.
  const fillerFragment = options.fillerBadge ? ":fi1" : ""
  // Only a non-default layout changes the composed URLs (and therefore the
  // body): corner stays the historical fragment.
  const fillerStyleFragment = options.fillerBadge && options.fillerStyle === "strip" ? ":fsstrip" : ""
  return `:tb${options.badgeStyle}:ta${options.anchor}:tx${options.offsetX}:ty${options.offsetY}:sc${options.badgeScale}:tv${options.voteSource}:tz${options.blur ? 1 : 0}${stillsFragment}${rotationFragment}${fillerFragment}${fillerStyleFragment}`
}

/**
 * Ephemeral query override (`?thumbnails=1|0|true|false`), same shape as the
 * other meta query flags: absent/invalid = inherit config token > defaults,
 * so old URLs and bodies stay byte-identical. Only explicit values override.
 */
function parseEpisodeThumbnailsQuery(raw: string | null): boolean | undefined {
  if (raw === null) return undefined
  const value = raw.trim().toLowerCase()
  if (value === "1" || value === "true") return true
  if (value === "0" || value === "false") return false
  return undefined
}

/**
 * Replace raw TMDB w500 stills with the composited thumbnail URL.
 *
 * A per-episode picker override (`S:E`, saved on the mapping) wins for that
 * episode and is always composed against the TMDB still: it is an explicit
 * user choice, so it must not be replaced by the TVDB base. Otherwise a video
 * with a raw TMDB w500 thumbnail is rewritable directly; when the space uses
 * TVDB episode metadata the enrichment has replaced it with a TVDB cover, so
 * the pre-enrichment TMDB still (`tmdbStills`) is used as the compositor's
 * fail-open fallback and `?stills=tvdb` selects the TVDB base (same badge
 * params as the TMDB path). A video with no usable TMDB fallback stays raw:
 * fail-open, never an error or a 500.
 *
 * No global poster blur leaks in: the emitted `blur` param comes from the
 * explicit Miniature spoiler choice (`thumbnailBlur`/query) only, so
 * spoiler-blurred stills remain an intentional opt-in.
 *
 * `thumbnail-renderer` is imported dynamically so the default-OFF path never
 * pulls sharp/resvg into the /meta module graph.
 */
async function applyEpisodeThumbnails(
  req: NextRequest,
  seriesId: number,
  videos: StremioVideo[],
  options: EpisodeThumbnailOptions,
  overrides?: Record<string, string> | null,
  tmdbStills?: Map<string, string> | null,
  /**
   * Validated scoped user (multi-user). The composed image request cannot carry
   * the session headers, so the namespace id must travel in the URL (`u=`) for
   * the route to resolve the same TVDB/TMDB keys this /meta request used.
   */
  scopedUser?: string | null,
  /**
   * Absolute-episode offsets per regular season (`season` → episodes before
   * it) for the filler classification. Present only when the space enabled the
   * banner and the ordering can be resolved to a standard absolute episode
   * (standard numbering, or an Episode Group carrying the original TMDB S:E).
   */
  seasonAbsoluteOffsets?: Map<number, number> | null,
  /**
   * Visible video id → ORIGINAL TMDB S:E for Episode Group orderings (their
   * visible S:E is remapped). Present only for group videos: their filler
   * absolute is computed from this pair, never from the visible numbering.
   */
  videoStillSources?: Map<string, { season: number; episode: number }> | null,
): Promise<StremioVideo[]> {
  const rawBase = posterUrl("", "w500")
  const origin = getOriginFromRequest(req)
  const { sanitizeStillPath } = await import("@/lib/thumbnail-renderer")
  return videos.map((video) => {
    const overrideStill = sanitizeEpisodeStillPath(overrides?.[`${video.season}:${video.episode}`])
    let still: string | null = overrideStill
    // An override is a TMDB still path by contract: compose it against TMDB.
    const stillsSource: ThumbnailStillSource = overrideStill ? "tmdb" : options.stills
    if (!still) {
      const thumbnail = video.thumbnail
      if (thumbnail && thumbnail.startsWith(`${rawBase}/`)) {
        still = sanitizeStillPath(thumbnail.slice(rawBase.length))
        if (!still) return video
      } else if (stillsSource === "tvdb" && thumbnail) {
        // TVDB cover base: the pre-enrichment TMDB still is the required
        // fail-open fallback of `/api/thumbnail`.
        still = sanitizeEpisodeStillPath(tmdbStills?.get(`${video.season}:${video.episode}`)) ?? null
        if (!still) return video
      } else {
        return video
      }
    }
    const params = new URLSearchParams({
      still,
      w: String(EPISODE_THUMBNAIL_WIDTH),
      badges: EPISODE_THUMBNAIL_BADGES,
      // Persisted Miniature choices (same contract/order as the settings
      // preview): style, corner, offsets and vote source are always explicit
      // so /meta and the WYSIWYG preview produce the same request.
      bstyle: options.badgeStyle,
      anchor: options.anchor,
      ox: String(options.offsetX),
      oy: String(options.offsetY),
      bscale: String(options.badgeScale),
      source: options.voteSource,
    })
    // Only the TVDB base needs the selector; absence is the TMDB default, so
    // the TMDB path stays byte-identical to the historical URL.
    if (stillsSource === "tvdb") params.set("stills", "tvdb")
    // OFF = no param at all (byte-identical plain thumbnail), exactly like the
    // preview builder.
    if (options.blur) params.set("blur", "1")
    // Daily still rotation: opt-in only, absent keeps the historical URL.
    if (options.rotation) params.set("rotate", "1")
    // Anime filler banner: only when the snapshot classifies this absolute
    // episode. Standard videos use their own S:E; Episode Group videos use the
    // ORIGINAL TMDB S:E (the visible one is remapped). TVDB/AniZip expose
    // neither and keep offsets null, so they never get a guessed banner.
    if (options.fillerBadge && seasonAbsoluteOffsets) {
      const source = videoStillSources?.get(video.id)
      const seasonNumber = videoStillSources ? source?.season : video.season
      const episodeNumber = videoStillSources ? source?.episode : video.episode
      const absoluteStart =
        seasonNumber === undefined ? undefined : seasonAbsoluteOffsets.get(seasonNumber)
      if (absoluteStart !== undefined && episodeNumber !== undefined) {
        const fillerStatus = resolveFillerStatus(seriesId, absoluteStart + episodeNumber)
        if (fillerStatus) {
          params.set("fill", fillerStatus)
          // Layout: only the non-default `strip` travels; the compositor route
          // resolves an absent `fillStyle` from the same space defaults, but
          // token-only spaces have no namespace for that fallback, so emitting
          // it here is what keeps their Stremio thumbnails WYSIWYG.
          if (options.fillerStyle === "strip") params.set("fillStyle", "strip")
        }
      }
    }
    // Namespace keys (multi-user): absent for global requests, so legacy URLs
    // stay byte-identical.
    if (scopedUser) params.set("u", scopedUser)
    return {
      ...video,
      thumbnail: `${origin}/api/thumbnail/tv/${seriesId}/season/${video.season}/episode/${video.episode}?${params.toString()}`,
    }
  })
}

/**
 * `meta.links` (categories from stremio-core constants.rs): genre chips open
 * Stremio discover on our own Top catalog (the only built-in catalog with a
 * genre extra that always has rows), the IMDb chip opens the title page.
 * Same URL shape Cinemeta uses (`stremio:///discover/<encoded manifest>/...`).
 */
function buildMetaLinks(
  origin: string,
  stType: "movie" | "series",
  genres: string[],
  imdbId: string | null,
): StremioLink[] {
  const links: StremioLink[] = []
  const catalogId = stType === "movie" ? "pictorium-jw-movies" : "pictorium-jw-series"
  const manifestUrl = `${origin}/manifest.json`
  const seen = new Set<string>()
  for (const genre of genres) {
    const name = genre.trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    links.push({
      name,
      category: "Genres",
      url: `stremio:///discover/${encodeURIComponent(manifestUrl)}/${stType}/${catalogId}?genre=${encodeURIComponent(name)}`,
    })
  }
  if (imdbId && isValidImdbId(imdbId)) {
    links.push({
      name: "IMDb",
      category: "imdb",
      url: `https://www.imdb.com/title/${encodeURIComponent(imdbId.trim().toLowerCase())}/`,
    })
  }
  return links
}

const KNOWN_META_TYPES = new Set([
  "movie", "series", "tv", "show", "tvshow", "anime.movie", "anime.series", "anime",
])

// C4: come nei cataloghi — tipo ignoto → null (400) invece di servire
// silenziosamente dati series.
function normalizeMediaType(type: string): "movie" | "series" | null {
  const t = type.toLowerCase()
  if (!KNOWN_META_TYPES.has(t)) return null
  return (t === "movie" || t === "anime.movie") ? "movie" : "series"
}

// Come in catalog-handler.ts: la chiave MDBList resta server-side, mai nel
// poster URL servito a Stremio (M2).
async function pictoriumPosterUrl(
  req: NextRequest,
  type: "movie" | "series",
  id: number,
  configParam?: string | null,
  userParam?: string | null,
  posterLang = "it",
  posterRegion?: string,
  seasonalTheme?: string | null,
): Promise<{ poster: string; landscapePoster?: string; posterShape: "poster" | "landscape" }> {
  const scopedUser = getScopedUserId(userParam)
  const serverDefaults = scopedUser ? await getServerDefaultsForUser(scopedUser) : await getServerDefaultsChecked()
  const userConfig = configParam ? decodeConfig(configParam) : null
  const defaults = userConfig ? { ...serverDefaults, ...userConfig } : serverDefaults
  const mapping = await getById(type === "series" ? "tv" : "movie", id, scopedUser)
  // Dual-format saved title (both base families): serve both canvases,
  // `poster` = portrait (same contract as the catalogs). Single-format
  // titles keep the historical shape resolution byte-identically.
  const dualBase = mappingHasBothShapeBases(mapping)
  const posterShape: "poster" | "landscape" = dualBase ? "poster" : stremioPosterShape(mapping, defaults)
  // Ephemeral originating-catalog context (explicit `theme=` only) under
  // the saved per-title choice: explicit themed choice follows the title
  // across catalogs and meta (generic meta with no list = query absent =
  // unframed unless the mapping sets it), explicit `none` suppresses an
  // inherited list theme, absent (Automatic) follows the list. Both
  // canvases render their own frame asset; the clean banner never
  // receives a theme (hideLogo gate in the shared builder), so it stays
  // byte-identical and absent/invalid stays unframed.
  const effectiveTheme = resolveEffectiveSeasonalTheme(
    mapping?.seasonalTheme ?? null,
    normalizeSeasonalTheme(seasonalTheme),
  )
  const posterUrl = (shape: "poster" | "landscape"): string => buildStremioPosterUrl({
    origin: getOriginFromRequest(req),
    type,
    id,
    defaults,
    mapping,
    lang: posterLang,
    region: posterRegion,
    config: configParam || undefined,
    user: userParam || undefined,
    forceShape: shape,
    seasonalTheme: effectiveTheme ?? undefined,
  }).toString()
  const poster = posterUrl(posterShape)
  const landscapePoster = dualBase
    ? posterUrl("landscape")
    : posterShape === "landscape" ? poster : undefined
  return { poster, landscapePoster, posterShape }
}



/**
 * Gestore principale della risorsa `meta` di Stremio.
 * Fornisce schede complete (dettagli, cast, trailer, trame, logo e lista episodi)
 * con il poster nativo di Pictorium.
 */
export async function pictoriumMeta(
  req: NextRequest,
  mediaType: string,
  rawId: string,
  userParam: string | null,
  configParam: string | null,
): Promise<Response> {
  // Rate-limit per-utente (multi-user): come i cataloghi, il bucket segue il
  // namespace così il flood su `?u=vittima` non brucia la quota altrui.
  const preScopedUser = getScopedUserId(userParam)
  const rl = await rateLimit(preScopedUser ? userRateLimitKey(req, preScopedUser) : rateLimitKey(req), "catalog")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const cleanId = rawId.replace(/\.json$/, "")
  if (cleanId.length > 80) return metaResponse({ meta: null })

  const stType = normalizeMediaType(mediaType)
  if (!stType) {
    return new Response("Invalid type", {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    })
  }
  // Notice cards (Fase 2): id informativo, nessuna risoluzione TMDB/IMDb,
  // nessuna chiamata upstream, nessuna scrittura in cache.
  if (cleanId.startsWith(NOTICE_ID_PREFIX)) {
    return metaResponse({
      meta: buildNoticeDetail({
        id: cleanId,
        type: stType,
        poster: `${getOriginFromRequest(req)}/pictorium.png`,
      }),
    })
  }
  const tmdbMediaType = stType === "movie" ? "movie" : "tv"
  // Single request-wide budget (15s): created BEFORE upstream ID resolution
  // so even very slow /find calls stay under the total cap. It combines the
  // incoming signal (client disconnect) with the internal timeout and fires
  // on whichever comes first. Every phase below (find/details/images/
  // external_ids, episode-group listing/detail, AniZip, TVDB ordering/
  // enrichment, standard seasons) derives from it with per-phase caps via
  // combineAbortSignals.
  const requestSignal = combineAbortSignals(
    (req as { signal?: AbortSignal }).signal ?? null,
    META_TOTAL_BUDGET_MS,
  )
  // Namespace utente (multi-user): null con flag OFF o senza `?u=` → globale.
  // Spazi inventati → anonimo (v1.23.0): niente cache key separate.
  let scopedUser = getScopedUserId(userParam)
  if (scopedUser && !(await userExists(scopedUser))) scopedUser = null
  // Attività di lettura per il cleanup inattivi (throttled, fire-and-forget).
  if (scopedUser) touchUserActivity(scopedUser)
  // Chiavi effettive (slice 2): esplicite della richiesta > namespace utente
  // (solo con `?u=`) > env d'istanza. Entrano nei cache key (hash) così due
  // namespace non collidono.
  const resolvedKeys = await resolveUserApiKeys(req, scopedUser)
  const apiKey = resolvedKeys.tmdb.key
  const mdblistKey = resolvedKeys.mdblist.key
  const tvdbApiKey = resolvedKeys.tvdb.key
  const effectiveDefaults: ServerDefaults = scopedUser
    ? await getServerDefaultsForUser(scopedUser)
    : await getServerDefaultsChecked()
  let userConfig: Partial<PictoriumUserConfig> | null = null

  if (configParam) {
    userConfig = decodeConfig(configParam)
  }
  if (!userConfig) {
    userConfig = effectiveDefaults
  }

  // Episode provider precedence: config token > namespace/instance defaults >
  // "TVDB when a key is configured" (historical fallback). The catalog-only
  // config token used by local-only/profileless installs (`/c/<config>/...`)
  // never carries `episodeMetadataSource`, so falling straight from the token
  // to the key-presence branch ignored the saved TMDB/TVDB choice entirely:
  // the covers stayed on the key-derived provider no matter what the settings
  // toggle said. The `:es` cache-key fragment follows the resolved provider,
  // so a real switch now always targets a fresh meta body (never a stale 12h
  // one) instead of resolving the same provider again.
  const configuredMetadataSource =
    userConfig?.episodeMetadataSource ?? effectiveDefaults.episodeMetadataSource
  const episodeMetadataSource: "tmdb" | "tvdb" =
    configuredMetadataSource === "tmdb" || configuredMetadataSource === "tvdb"
      ? configuredMetadataSource
      : tvdbApiKey ? "tvdb" : "tmdb"
  // Base still provider for the compositor. Same semantics as the metadata
  // source: TVDB when the space resolves episodes from TheTVDB AND a key is
  // available (the route fails open to the required TMDB still otherwise).
  const stillsSource: ThumbnailStillSource =
    episodeMetadataSource === "tvdb" && tvdbApiKey ? "tvdb" : "tmdb"
  // Effective opt-in for composited episode thumbnails: ephemeral query
  // override > config token > namespace/defaults > OFF. Absent everywhere =
  // legacy raw stills and byte-identical bodies.
  const thumbnailsQuery = parseEpisodeThumbnailsQuery(req.nextUrl.searchParams.get("thumbnails"))
  const episodeThumbnailsEnabled = thumbnailsQuery ?? (
    typeof userConfig?.episodeThumbnails === "boolean"
      ? userConfig.episodeThumbnails
      : effectiveDefaults.episodeThumbnails === true
  )
  // Persisted Miniature visual choices are resolved after the mapping
  // pre-cache lookup below, so a per-title rotation override can participate:
  // query > mapping > token > defaults > renderer default.
  const region = resolveCatalogRegionWithDefaults(req, userConfig, effectiveDefaults)
  const requestedLang = req.nextUrl.searchParams.get("lang")?.toLowerCase()
  const posterLang = isSupportedUiLang(requestedLang) ? requestedLang! : region.lang2
  const tmdbLang = contentLanguageForUiLang(posterLang, region.code)
  // Ephemeral originating-catalog seasonal context (explicit `theme=` only,
  // e.g. the editor "Testa URL Stremio" flow from a Halloween/Christmas
  // list). Generic /meta without it stays byte-identical: absent/invalid normalizes to null
  // (unframed), and the shared Stremio builder keeps the clean banner
  // unthemed (hideLogo gate) while poster/landscapePoster carry the context.
  const metaSeasonalTheme = normalizeSeasonalTheme(req.nextUrl.searchParams.get("theme"))
  const metaThemeFragment = metaSeasonalTheme ? `:th${metaSeasonalTheme}` : ""

  // Risoluzione ID TMDB e IMDb
  let tmdbId: number | null = null
  let imdbId: string | null = null

  // Fall-open come i cataloghi (metas:[]): senza chiave o con upstream in
  // errore la risoluzione esterna lancia — prima il throw usciva dal try e
  // diventava 500, ora degrada a meta:null (mai cacheato: il return è prima
  // della cache key).
  try {
    if (cleanId.startsWith("tt")) {
      imdbId = cleanId
      tmdbId = await tmdbFindByImdb(cleanId, tmdbMediaType, apiKey, requestSignal)
    } else if (cleanId.startsWith("tmdb:")) {
      const parsed = parseInt(cleanId.slice(5), 10)
      if (!Number.isNaN(parsed) && parsed > 0) tmdbId = parsed
    } else if (cleanId.startsWith("tvdb:")) {
      const tvdbRaw = cleanId.slice(5)
      tmdbId = await tmdbFindByTvdb(tvdbRaw, tmdbMediaType, apiKey, requestSignal)
    } else if (cleanId.startsWith("tvdbc:")) {
      const tvdbRaw = cleanId.slice(6)
      tmdbId = await tmdbFindByTvdb(tvdbRaw, tmdbMediaType, apiKey, requestSignal)
    } else if (/^\d+$/.test(cleanId)) {
      const parsed = parseInt(cleanId, 10)
      if (!Number.isNaN(parsed) && parsed > 0) tmdbId = parsed
    }
  } catch (error) {
    // debug, non warn: le installazioni senza chiave colpiscono questo ramo
    // a ogni richiesta, un warn per-hit sarebbe log-spam.
    log.debug("Meta ID resolution failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    tmdbId = null
  }

  if (!tmdbId) {
    return metaResponse({ meta: null })
  }

  // Per le serie, il meta videos dipende dal mapping episodeGroupId; per i film
  // il poster dipende comunque dal mapping (cambio poster/stili): includere
  // episodeGroupId+updatedAt nella cache key (fetch pre-cache) altrimenti dopo
  // un save si serve lo stale fino a 12h. Il lookup è cached (memCache/KV
  // 500ms) quindi costo minimo. Prima era solo per le serie (F4).
  let preMappingForCache: {
    episodeGroupId?: string | null
    updatedAt?: string
    episodeThumbnailStills?: Record<string, string> | null
    thumbnailRotation?: boolean | null
  } | null = null
  try {
    const pre = await getById(tmdbMediaType, tmdbId, scopedUser)
    if (pre) {
      preMappingForCache = {
        episodeGroupId: pre.episodeGroupId ?? null,
        updatedAt: pre.updatedAt,
        episodeThumbnailStills: pre.episodeThumbnailStills ?? null,
        thumbnailRotation: pre.thumbnailRotation ?? null,
      }
    }
  } catch { /* ignore — fallback a auto */ }
  const egKey = preMappingForCache ? `${preMappingForCache.episodeGroupId ?? "auto"}:${preMappingForCache.updatedAt ?? ""}` : "auto"
  // Persisted Miniature visual choices, resolved only when the compositor is
  // actually used (query > mapping override > token > defaults > renderer
  // default). The per-title rotation override is a tri-state: explicit
  // true/false wins on the space default, null/absent inherits it.
  const episodeThumbnailOptions = stType === "series" && episodeThumbnailsEnabled
    ? await resolveEpisodeThumbnailOptions(
      req.nextUrl.searchParams,
      userConfig,
      effectiveDefaults,
      stillsSource,
      preMappingForCache?.thumbnailRotation,
    )
    : null
  const episodeThumbnailOptionsFragment = episodeThumbnailOptions
    ? thumbnailOptionsCacheFragment(episodeThumbnailOptions)
    : ""
  // Cache-key fragment only when the feature actually changes the body:
  // `:et1` for ON, `:et0` only for an explicit query OFF over an enabling
  // source (so it can never collide with the ON key). Every Miniature choice
  // also travels in the key, so changing style/anchor/offsets/source/blur/
  // rotation can never serve a stale Stremio body. Absent OFF keeps the
  // historical key byte-identical.
  const episodeThumbnailCacheFragment = stType === "series"
    ? (thumbnailsQuery !== undefined
      ? (thumbnailsQuery ? `:et1${episodeThumbnailOptionsFragment}` : ":et0")
      : episodeThumbnailsEnabled ? `:et1${episodeThumbnailOptionsFragment}` : "")
    : ""

  // eo2 = versione ordinamento episodi: il default automatico "Parts" (v2)
  // cambia i videos a parità di mapping — senza frammento, un meta cachato
  // con le stagioni standard resterebbe servito fino a 12h dopo il deploy.
  // Epoch globale + hash server defaults (come nei cataloghi): senza, un
  // cambio default (badge/blur/regione) via PUT restava invisibile nei meta
  // (poster URL stantio) fino a 12h, anche cross-instance dove
  // cacheInvalidate("stremio") non arriva.
  const epoch = await getCatalogEpoch(scopedUser)
  const sdHash = hashFragment(JSON.stringify(effectiveDefaults))
  const freshness = `:e${epoch}:sd${sdHash}`
  // mhv3: `imdbRating` follows Cinemeta IMDb (TMDB fail-open); mhv2 bodies
  // serve TMDB-only ratings, so they must not be reused.
  // `:es` carries the RESOLVED episode provider (token > defaults > key
  // presence, see above), so a real TMDB<->TVDB switch always targets a
  // different body; a config-token install that ignores the saved choice
  // would otherwise re-resolve the same provider under a new sd hash.
  // mhv2: dual-format saved titles emit `landscapePoster` beside the
  // portrait `poster` (mhv1 bodies served the single collapsed shape).
  // lk1: bodies without `links` (pre-manifest-health) must not be served for
  // another 12h after deploy.
  const cacheKey = `stremio:meta:${stType}:${cleanId}:pv${POSTER_URL_VERSION}${scopedUser ? `:u${hashUserFragment(scopedUser)}` : ""}:ak${apiKey ? hashFragment(apiKey) : "none"}${configParam ? `:cfg${hashFragment(configParam)}` : ""}${mdblistKey ? `:mk${hashFragment(mdblistKey)}` : ""}${tvdbApiKey ? `:tk${hashFragment(tvdbApiKey)}` : ""}:es${episodeMetadataSource}:eg${hashFragment(egKey)}:r${region.code}:l${posterLang}${stType === "series" ? ":eo2" : ""}${metaThemeFragment}${episodeThumbnailCacheFragment}:mhv3:lk1${freshness}`
  const cached = await cacheGetShared<{ meta: StremioMetaDetail; __partial?: boolean }>(cacheKey, ["stremio", "meta"])
  // __partial is only an internal signal for the hit HTTP header: never in the JSON.
  if (cached) return metaResponse({ meta: cached.meta }, cached.__partial === true)

  try {
    const details = await getFullDetails(tmdbMediaType, tmdbId, tmdbLang, apiKey, requestSignal)
    if (!details || !details.id) {
      return metaResponse({ meta: null })
    }

    if (!imdbId && details.external_ids?.imdb_id) {
      imdbId = details.external_ids.imdb_id
    }
    if (!imdbId) {
      imdbId = await resolveImdbId(tmdbMediaType, tmdbId, apiKey, 5000, requestSignal)
    }

    const primaryId = imdbId || `tmdb:${tmdbId}`
    const { poster, landscapePoster, posterShape } = await pictoriumPosterUrl(req, stType, tmdbId, configParam, userParam, posterLang, region.code, metaSeasonalTheme)
    // NuvioTV: URL del render con logo baked-in (stesso profilo del poster
    // della sua forma), inclusi i titoli forzati dal default; dual-format:
    // canvas landscape dalla propria base.
    const background = details.backdrop_path ? posterUrlOriginal(details.backdrop_path) : undefined

    // Risoluzione Logo + `imdbRating` in parallelo. `imdbRating` contract:
    // Cinemeta IMDb is authoritative, TMDB `vote_average` is the fail-open
    // fallback (miss/transient/open breaker). Both promises are non-throwing
    // for the rating path, so a Cinemeta failure never turns /meta into a 500
    // and no serial round trip is added to the logo fetch.
    let logo: string | undefined
    const [images, cinemetaRating] = await Promise.all([
      getImages(tmdbMediaType, tmdbId, `${posterLang},en,null`, apiKey, requestSignal, 5000).catch(() => null),
      fetchCinemetaRating(imdbId, stType === "movie" ? "movie" : "series", requestSignal).catch(() => null),
    ])
    try {
      if (images?.logos && images.logos.length > 0) {
        // Stessa scala del render poster (lingua → inglese → lingua originale
        // → primo): prima si prendeva il PRIMO logo disponibile appena mancava
        // quello locale, servendo a un utente ebraico un logo giapponese o
        // coreano al posto di quello inglese.
        const langLogo = selectBestLogo(images.logos, posterLang, details.original_language)
        if (langLogo?.file_path) {
          logo = posterUrlOriginal(langLogo.file_path)
        }
      }
    } catch {
      // Logo opzionale
    }

    const cast = (details.credits?.cast || []).slice(0, 10).map((c) => c.name)
    const director = (details.credits?.crew || []).filter((c) => c.job === "Director").map((c) => c.name)
    const writers = (details.credits?.crew || []).filter((c) => c.job === "Writer" || c.job === "Screenplay").map((c) => c.name)

    const trailers: StremioTrailer[] = (details.videos?.results || [])
      .filter((v) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser"))
      .slice(0, 3)
      .map((v) => ({ source: v.key, type: "Trailer" }))

    let videos: StremioVideo[] | undefined
    let isPartialSeasonData = false
    // Pre-enrichment TMDB stills (`S:E` → sanitized path). The TVDB enrichment
    // replaces the thumbnail with a TVDB cover, but `/api/thumbnail` still
    // requires a TMDB still as its fail-open fallback, so it is captured
    // before the overwrite (only when the TVDB base can actually be used).
    let tmdbStillsByEpisode: Map<string, string> | null = null
    // Filler banner numbering: `season` → absolute episodes before that season,
    // computed once from the declared regular seasons. Null unless the space
    // enabled the banner and the ordering can resolve a standard absolute.
    let seasonAbsoluteOffsets: Map<number, number> | null = null
    // Episode Group filler support: visible video id → ORIGINAL TMDB S:E, so a
    // remapped group video keeps the same absolute episode as its standard row.
    let groupStillSources: Map<string, { season: number; episode: number }> | null = null

    if (stType === "series") {
      videos = []
      const mapping = await getById("tv", tmdbId, scopedUser)

      // TVDB / AniZip ordering sentinel (shared helper) — supporta tvdb:<seasonType>
      const sentinel = mapping?.episodeGroupId || null
      const isTvdbSentinel = sentinel === "tvdb" || (sentinel?.startsWith("tvdb:") ?? false)
      if (isTvdbSentinel) {
        const seasonType = sentinel === "tvdb" ? "default" : (sentinel!.slice(5) || "default")
        try {
          const orderingSignal = combineAbortSignals(requestSignal, 10000)
          const tvdbOrdered = await buildVideosFromTvdbDetailed(imdbId, tmdbId, primaryId, tvdbApiKey || "", seasonType, apiKey, orderingSignal)
          if (tvdbOrdered.videos.length > 0) videos.push(...(tvdbOrdered.videos as StremioVideo[]))
          // Interrupted TVDB ordering: partials stay servable but with a
          // short TTL, never frozen long-term.
          if (!tvdbOrdered.complete) isPartialSeasonData = true
        } catch (e) {
          log.warn("TVDB ordering failed, fallback to standard", { error: e instanceof Error ? e.message : String(e) })
        }
      } else if (sentinel === "anizip") {
        try {
          const anizipVideos = await buildVideosFromAnizip(tmdbId, primaryId, combineAbortSignals(requestSignal, 8000))
          if (anizipVideos.length > 0) videos.push(...(anizipVideos as StremioVideo[]))
        } catch (e) {
          log.warn("AniZip ordering failed, fallback to standard", { error: e instanceof Error ? e.message : String(e) })
        }
      }

      let groupDetails: TMDBEpisodeGroupDetails | null = null
      const isGroupSentinel = sentinel !== null && sentinel !== "standard" && !isTvdbSentinel && sentinel !== "anizip"
      // true quando i videos seguono un Episode Group (esplicito o default
      // automatico): la numerazione S:E non coincide più con quella standard
      // e l'arricchimento TVDB (mappato su S:E) assegnerebbe titoli/cover
      // dell'episodio sbagliato → va saltato (vedi sotto).
      let videosFromGroup = false

      // Default: stagioni standard TMDB. Si usa un Episode Group solo se
      // l'utente ha salvato esplicitamente un episodeGroupId diverso da "standard", "tvdb:*" e "anizip".
      if (videos.length === 0 && isGroupSentinel) {
        groupDetails = await getTVEpisodeGroup(sentinel!, tmdbLang, apiKey, combineAbortSignals(requestSignal, 8000))
      }

      if (groupDetails?.groups && groupDetails.groups.length > 0) {
        const built = buildVideosFromGroupsDetailed(groupDetails, primaryId)
        videos.push(...(built.videos as StremioVideo[]))
        groupStillSources = built.stillSources
        videosFromGroup = true
      }

      // Default automatico "Parts" (es. Casa di Carta 5 parti invece di 3
      // stagioni): solo quando nessun mapping salvato sceglie esplicitamente
      // (sentinel null). "standard" esplicito resta standard, mapping salvato
      // vince sempre. Ogni fallimento degrada allo standard sotto.
      if (videos.length === 0 && sentinel === null && details.seasons && details.seasons.length > 0) {
        try {
          const regularSeasons = details.seasons.filter((s) => s.season_number > 0)
          const standardEpisodeCount = regularSeasons.reduce((n, s) => n + (s.episode_count || 0), 0)
          const totalEpisodeCountWithSpecials = details.seasons.reduce((n, s) => n + (s.episode_count || 0), 0)
          if (regularSeasons.length > 0 && standardEpisodeCount > 0) {
            const autoId = await resolveDefaultEpisodeGroupId(
              tmdbId,
              regularSeasons.length,
              standardEpisodeCount,
              apiKey,
              totalEpisodeCountWithSpecials,
              combineAbortSignals(requestSignal, 8000),
            )
            if (autoId) {
              const autoDetails = await getTVEpisodeGroup(autoId, tmdbLang, apiKey, combineAbortSignals(requestSignal, 6000)).catch(() => null)
              const count = groupDetailsEpisodeCount(autoDetails)
              const regularCount = groupDetailsRegularEpisodeCount(autoDetails)
              const countMatches =
                count === standardEpisodeCount ||
                regularCount === standardEpisodeCount ||
                (totalEpisodeCountWithSpecials > standardEpisodeCount &&
                  (count === totalEpisodeCountWithSpecials || Math.abs(count - totalEpisodeCountWithSpecials) <= 15))
              if (
                autoDetails?.groups &&
                autoDetails.groups.length > 0 &&
                countMatches
              ) {
                const built = buildVideosFromGroupsDetailed(autoDetails, primaryId)
                videos.push(...(built.videos as StremioVideo[]))
                groupStillSources = built.stillSources
                videosFromGroup = true
              }
            }
          }
        } catch {
          // fallback standard sotto
        }
      }

      // Fallback alle stagioni standard se non ci sono Episode Groups alternativi
      if (videos.length === 0 && details.seasons && details.seasons.length > 0) {
        const regularSeasons = details.seasons.filter((s) => s.season_number > 0)
        const seasonSignal = combineAbortSignals(requestSignal, 10000)
        const seasonsData = await concurrentMap(regularSeasons, (s) => getTVSeason(tmdbId, s.season_number!, tmdbLang, apiKey, seasonSignal), 5)

        for (let i = 0; i < regularSeasons.length; i++) {
          const sData = seasonsData[i]
          // Null/missing payloads, unexpectedly empty seasons (episode_count
          // > 0) and short lists mark partial (short TTL + retry); zero-count
          // seasons, future seasons and full-length lists with future episodes
          // stay complete (see helper). Evict partial seasons from the shared
          // 5-minute TMDB cache so the post-TTL retry refetches upstream.
          if (!isSeasonEpisodesComplete(sData, regularSeasons[i]?.episode_count, regularSeasons[i]?.air_date)) {
            isPartialSeasonData = true
            evictTVSeasonCache(tmdbId, regularSeasons[i]!.season_number!)
          }
          for (const ep of sData?.episodes ?? []) {
            videos.push({
              id: `${primaryId}:${ep.season_number}:${ep.episode_number}`,
              name: ep.name || `Episodio ${ep.episode_number}`,
              season: ep.season_number,
              episode: ep.episode_number,
              overview: ep.overview || undefined,
              thumbnail: ep.still_path ? posterUrl(ep.still_path, "w500") : undefined,
              released: ep.air_date ? `${ep.air_date}T00:00:00.000Z` : undefined,
              rating: ep.vote_average ? ep.vote_average.toFixed(1) : undefined,
            })
          }
        }
      }

      // Se la fonte metadati episodi è TVDB ed è presente una chiave TVDB, arricchisci con copertine e trame TVDB
      // Skip se già ordinato via TVDB (dati già TVDB nativi) o se i videos
      // seguono un Episode Group: la mappa TVDB è su S:E standard e con le
      // Parti assegnerebbe nome/cover/trama dell'episodio sbagliato.
      const isTvdbOrdering = (mapping?.episodeGroupId === "tvdb" || (mapping?.episodeGroupId?.startsWith("tvdb:") ?? false))
      if (videos.length > 0 && episodeMetadataSource === "tvdb" && tvdbApiKey && !isTvdbOrdering && !videosFromGroup) {
        if (episodeThumbnailOptions?.stills === "tvdb") {
          const rawBase = posterUrl("", "w500")
          tmdbStillsByEpisode = new Map()
          for (const v of videos) {
            if (!v.thumbnail || !v.thumbnail.startsWith(`${rawBase}/`)) continue
            const still = sanitizeEpisodeStillPath(v.thumbnail.slice(rawBase.length))
            if (still) tmdbStillsByEpisode.set(`${v.season}:${v.episode}`, still)
          }
        }
        const enrichSignal = combineAbortSignals(requestSignal, 8000)
        // Interrupted enrichment: TMDB videos stay intact but the meta goes to
        // a short TTL so TVDB covers/synopses are retried.
        const enrichComplete = await enrichVideosWithTvdbDetailed(videos, imdbId, tmdbId, tvdbApiKey, "ita", apiKey, enrichSignal)
        if (!enrichComplete) isPartialSeasonData = true
      }

      // Anime filler classification. Standard TMDB numbering resolves the
      // absolute directly; an Episode Group resolves it from the ORIGINAL TMDB
      // S:E carried by the group payload. TVDB/AniZip expose neither, so they
      // stay suppressed instead of labelling the wrong episode. The resolver
      // itself is fail-closed on unknown ids and out-of-window episodes.
      const standardFillerOrdering =
        (sentinel === null || sentinel === "standard") && !videosFromGroup
      const groupFillerOrdering =
        videosFromGroup && groupStillSources !== null && groupStillSources.size > 0
      if (episodeThumbnailOptions?.fillerBadge && (standardFillerOrdering || groupFillerOrdering)) {
        const offsets = new Map<number, number>()
        let absoluteStart = 0
        const regularSeasons = [...(details.seasons ?? [])]
          .filter((season) => typeof season.season_number === "number" && season.season_number > 0)
          .sort((a, b) => a.season_number! - b.season_number!)
        for (const season of regularSeasons) {
          offsets.set(season.season_number!, absoluteStart)
          absoluteStart += season.episode_count ?? 0
        }
        if (offsets.size > 0) seasonAbsoluteOffsets = offsets
      }
    }

    if (stType === "series" && episodeThumbnailsEnabled && episodeThumbnailOptions && videos && videos.length > 0) {
      videos = await applyEpisodeThumbnails(req, tmdbId, videos, episodeThumbnailOptions, preMappingForCache?.episodeThumbnailStills, tmdbStillsByEpisode, scopedUser, seasonAbsoluteOffsets, groupStillSources)
    }

    const genres = (details.genres || []).map((g) => g.name)
    const metaLinks = buildMetaLinks(getOriginFromRequest(req), stType, genres, imdbId)
    const meta: StremioMetaDetail = {
      id: cleanId,
      imdb_id: imdbId || undefined,
      type: stType,
      name: details.title || details.name || "",
      genres,
      poster,
      posterShape,
      background,
      landscapePoster,
      // Titoli con canvas landscape esposto (landscape o dual-format): il
      // logo è già baked-in nel rendering — esporlo separato farebbe
      // sovrapporre a Nuvio un secondo logo (anche via arricchimento card
      // dal dettaglio).
      logo: landscapePoster ? undefined : logo,
      description: details.overview || details.tagline || undefined,
      releaseInfo: (details.release_date || details.first_air_date || "").slice(0, 4) || undefined,
      released: details.release_date ? `${details.release_date}T00:00:00.000Z` : undefined,
      runtime: details.runtime ? `${details.runtime} min` : undefined,
      imdbRating: normalizeCatalogRating(cinemetaRating ?? details.vote_average),
      cast: cast.length > 0 ? cast : undefined,
      director: director.length > 0 ? director : undefined,
      writer: writers.length > 0 ? writers : undefined,
      trailers: trailers.length > 0 ? trailers : undefined,
      links: metaLinks.length > 0 ? metaLinks : undefined,
      behaviorHints: stType === "movie" ? { defaultVideoId: primaryId, hasScheduledVideos: false } : undefined,
      videos: stType === "movie" ? [] : (videos && videos.length > 0 ? videos : undefined),
    }

    const body = { meta }
    // Never freeze partial/incomplete season data (upstream timeout or error)
    // for 12h: a short TTL lets the next request retry the missing seasons.
    // __partial only travels in cache for the hit HTTP header, never in JSON.
    if (!isPartialSeasonData) {
      cacheSet(cacheKey, body, ["stremio", "meta"], 12 * 60 * 60 * 1000)
    } else {
      cacheSet(cacheKey, { ...body, __partial: true as const }, ["stremio", "meta"], 60 * 1000)
    }
    return metaResponse(body, isPartialSeasonData)
  } catch (e) {
    log.error("Meta retrieval error", { error: e instanceof Error ? e.message : String(e) })
    return metaResponse({ meta: null })
  }
}
