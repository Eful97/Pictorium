import type { Mapping, PosterShape, SearchResult, TMDBImage } from "./types"
import { isCustomPosterUrl, splitCustomPosterSave, titleOf } from "./utils"
import { normalizeGenreName } from "./genre-normalize"

/**
 * Cover-only save ("Salva solo poster" / "Save poster only").
 *
 * Persists the cover + logo identity plus non-visual title metadata via the
 * existing full-replace
 * POST /api/mappings (never PUT: the PUT merge preserves absent styling
 * fields, so it cannot clear previously frozen values). Everything not in
 * the allowlist below is omitted, so a full replacement clears any
 * previously frozen custom styling and the title follows the global
 * defaults again (query > mapping > config > defaults chain).
 *
 * Allowlist:
 * - cover identity: tmdbId/mediaType/title, posterPath/customPosterUrl
 *   (split via splitCustomPosterSave), originalPosterPath, language
 * - logo identity: logoPath from the selected logo (when enabled), explicit
 *   logoDisabled=true when the user intentionally disabled the logo (same
 *   semantics as the remove-logo PUT). Logo TRANSFORMS (scale/offsets) are
 *   still omitted: they follow the global defaults / server auto-fit.
 * - stable non-visual identity: imdbId/wikidataId (TMDB details fast-paths),
 *   episodeGroupId (catalog ordering)
 * - non-visual title metadata (identity, NOT styling): genreName, voteAverage,
 *   releaseDate/firstAirDate, tvType/tvStatus — same values the full save
 *   persists. The mapped poster branch (route) renders ONLY from the mapping
 *   (no TMDB details fetch when a mapping exists), so omitting them blanks
 *   the Genre/Rating/Year badge on the saved Stremio URL even with defaults
 *   ON. These describe the title, not user style: badge toggles/styles still
 *   follow the global defaults (never frozen). Rank snapshots (badgeRank,
 *   trendRank, animeRank) stay omitted: rank resolves live at render.
 * - canvas shape (required: an omitted shape would inherit the global
 *   default and could flip the canvas the cover was picked for)
 * - the OTHER format's image/rotation/exclusion (untouched by this save)
 *
 * Explicitly omitted (inherit global defaults after save): all badge /
 * rank snapshots, rating styling/toggles, accent, every style/toggle/transform flat
 * (including logoScale/logoOffsetX/logoOffsetY), the whole `landscape`
 * tuning profile, and defaultBadgeStyles. Selected-format rotation lists
 * are omitted too (the existing opt-out: without cleanPosters/cleanBackdrops
 * + auto flags the 24h rotation in poster-rotation.ts stays idle, so the
 * pinned cover cannot be rotated away). Exclusion lists are preserved from
 * the previous mapping (user curation, inert without rotation lists).
 */
export interface CoverOnlySaveInput {
  selected: SearchResult
  /** Poster tile selected in the editor (portrait cover). */
  previewPoster: TMDBImage | null
  /** Backdrop selected in the editor (landscape cover). */
  selectedBackdrop: TMDBImage | null
  /** Logo tile selected in the editor (null = none/auto). */
  selectedLogo: TMDBImage | null
  /** True when the user intentionally disabled the logo (no-logo choice). */
  logoDisabled: boolean
  /** Existing saved mapping, if any (other-format preservation). */
  prevMapping: Mapping | null
  metaInfo: {
    genres?: { id: number; name: string }[]
    voteAverage?: number
    type?: string | null
    status?: string | null
    release_date?: string | null
    first_air_date?: string | null
    imdb_id?: string | null
    wikidata_id?: string | null
  }
  /** UI language for genreName normalization (same as the full save). */
  lang: string
  episodeGroupId?: string | null
  /** Canvas in editing: decides which image is the cover. */
  posterShape: PosterShape
}

export function buildCoverOnlyPayload(input: CoverOnlySaveInput): Record<string, unknown> | null {
  const { selected, previewPoster, selectedBackdrop, selectedLogo, logoDisabled, prevMapping, metaInfo, lang, episodeGroupId, posterShape } = input
  const isLandscape = posterShape === "landscape"

  // Portrait cover file. In portrait it is the chosen tile (required).
  // In landscape the SAME save must not rewrite the OTHER (portrait)
  // identity from an unsaved preview: the saved portrait cover/custom is
  // strict-preserved when it exists, the live preview is only the fallback
  // for titles without a saved portrait (so the vertical canvas never ends
  // up imageless).
  const savedPortraitFile =
    prevMapping?.customPosterUrl && isCustomPosterUrl(prevMapping.customPosterUrl)
      ? prevMapping.customPosterUrl
      : (prevMapping?.posterPath ?? null)
  const portraitFile = isLandscape
    ? (savedPortraitFile ?? previewPoster?.file_path ?? selected.poster_path ?? null)
    : (previewPoster?.file_path ??
      savedPortraitFile ??
      selected.poster_path ??
      null)
  if (!isLandscape && !previewPoster) return null
  if (!portraitFile) return null

  const tmdbRef = selected.poster_path ?? prevMapping?.posterPath ?? null
  const split = splitCustomPosterSave(portraitFile, tmdbRef)

  const body: Record<string, unknown> = {
    tmdbId: selected.id,
    mediaType: selected.media_type,
    title: titleOf(selected),
    posterPath: split.posterPath,
    customPosterUrl: split.customPosterUrl,
    originalPosterPath: selected.poster_path,
    // Presence-based language: an explicit clean tile (iso_639_1 === null)
    // is meaningful and must clear a previous 'en'/other — never fall back
    // to the previous mapping when a tile is selected. In landscape with a
    // saved portrait the language follows the preserved portrait identity.
    language: isLandscape
      ? (savedPortraitFile ? (prevMapping?.language ?? null) : (previewPoster ? previewPoster.iso_639_1 : (prevMapping?.language ?? null)))
      : (previewPoster ? previewPoster.iso_639_1 : (prevMapping?.language ?? null)),
    // Logo identity follows the cover: chosen logo persists, an intentional
    // no-logo choice persists as logoDisabled=true (remove-logo semantics).
    // Transforms stay omitted (global defaults / server auto-fit).
    logoPath: logoDisabled ? null : (selectedLogo?.file_path ?? null),
    imdbId: metaInfo.imdb_id || null,
    wikidataId: metaInfo.wikidata_id || null,
    // Title metadata identity (NOT styling): the mapped render branch reads
    // genre/vote/dates/tv fields ONLY from the mapping — without them the
    // Genre/Rating/Year badge blanks on Test URL/Stremio after save.
    genreName: normalizeGenreName(metaInfo.genres?.[0]?.name, lang) || null,
    voteAverage: metaInfo.voteAverage || null,
    tvType: metaInfo.type || null,
    tvStatus: metaInfo.status || null,
    releaseDate: metaInfo.release_date || null,
    firstAirDate: metaInfo.first_air_date || null,
    posterShape,
  }
  if (episodeGroupId) body.episodeGroupId = episodeGroupId
  if (logoDisabled) body.logoDisabled = true

  if (isLandscape) {
    // The landscape cover IS the backdrop: chosen one, or null for the
    // automatic TMDB backdrop (an intentional choice, never auto-filled
    // here — the editor already auto-picks the first visible backdrop on
    // entering landscape, so null means the user cleared it on purpose).
    // Portrait rotation/exclusion from the previous mapping is preserved
    // untouched (other format); backdrop rotation is omitted so the pinned
    // backdrop cannot rotate away.
    body.backdropPath = selectedBackdrop?.file_path ?? null
    if (prevMapping?.cleanPosters !== undefined) body.cleanPosters = prevMapping.cleanPosters
    if (prevMapping?.cleanPosterIndex !== undefined) body.cleanPosterIndex = prevMapping.cleanPosterIndex
    if (prevMapping?.cleanPosterUpdatedAt !== undefined) body.cleanPosterUpdatedAt = prevMapping.cleanPosterUpdatedAt
    if (prevMapping?.autoRotateClean !== undefined) body.autoRotateClean = prevMapping.autoRotateClean
    if (prevMapping?.excludedPosters !== undefined) body.excludedPosters = prevMapping.excludedPosters
    if (prevMapping?.excludedBackdrops !== undefined) body.excludedBackdrops = prevMapping.excludedBackdrops
  } else {
    // Portrait save preserves the other-format (landscape) image, rotation
    // and exclusions; without them every vertical save would wipe the 16:9
    // cover. Portrait rotation is omitted (pinned poster opt-out, see above).
    body.backdropPath = prevMapping?.backdropPath ?? null
    if (prevMapping?.cleanBackdrops !== undefined) body.cleanBackdrops = prevMapping.cleanBackdrops
    if (prevMapping?.cleanBackdropIndex !== undefined) body.cleanBackdropIndex = prevMapping.cleanBackdropIndex
    if (prevMapping?.cleanBackdropUpdatedAt !== undefined) body.cleanBackdropUpdatedAt = prevMapping.cleanBackdropUpdatedAt
    if (prevMapping?.autoRotateBackdrop !== undefined) body.autoRotateBackdrop = prevMapping.autoRotateBackdrop
    if (prevMapping?.excludedBackdrops !== undefined) body.excludedBackdrops = prevMapping.excludedBackdrops
    if (prevMapping?.excludedPosters !== undefined) body.excludedPosters = prevMapping.excludedPosters
  }
  return body
}
