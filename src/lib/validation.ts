import { z } from "zod"
import { BADGE_STYLES, RANKING_BADGE_STYLES } from "./badge-styles"

export const mappingSchema = z.object({
  tmdbId: z.number().int().positive(),
  mediaType: z.enum(["movie", "tv"]),
  title: z.string().min(1),
  posterPath: z.string().min(1),
  logoPath: z.string().nullable().optional(),
  originalPosterPath: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  logoScale: z.number().int().min(10).max(200).nullable().optional(),
  logoOffsetX: z.number().int().nullable().optional(),
  logoOffsetY: z.number().int().nullable().optional(),
  topBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
  topBadgeOffsetX: z.number().int().nullable().optional(),
  topBadgeOffsetY: z.number().int().nullable().optional(),
  genreBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
  genreBadgeOffsetX: z.number().int().nullable().optional(),
  genreBadgeOffsetY: z.number().int().nullable().optional(),
  qualityBadgeScale: z.number().int().min(10).max(200).nullable().optional(),
  qualityBadgeOffsetX: z.number().int().nullable().optional(),
  qualityBadgeOffsetY: z.number().int().nullable().optional(),
  networkLogoScale: z.number().int().min(10).max(200).nullable().optional(),
  networkLogoOffsetX: z.number().int().nullable().optional(),
  networkLogoOffsetY: z.number().int().nullable().optional(),
  showBadges: z.boolean().nullable().optional(),
  rankingBadges: z.boolean().nullable().optional(),
  badgeGenre: z.boolean().nullable().optional(),
  badgeYear: z.boolean().nullable().optional(),
  badgeRating: z.boolean().nullable().optional(),
  customRatings: z.boolean().nullable().optional(),
  genreName: z.string().nullable().optional(),
  voteAverage: z.number().min(0).max(10).nullable().optional(),
  trendRank: z.number().int().min(0).nullable().optional(),
  trendPeriod: z.string().nullable().optional(),
  tvType: z.string().nullable().optional(),
  tvStatus: z.string().nullable().optional(),
  // accentColor deve essere un colore hex valido (#rgb/#rrggbb) per non
  // far arrivare stringhe arbitrarie al rendering SVG dei badge. Allineata
  // a poster-render-helpers.isValidHex (#rgb / #rrggbb) — finding 6.
  accentColor: z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/).nullable().optional(),
  badgeExtra: z.string().nullable().optional(),
  badgeRank: z.number().int().min(0).nullable().optional(),
  badgeLabel: z.string().nullable().optional(),
  // Rank anime salvato al momento del salvataggio: permette al poster salvato
  // di mostrare il badge Anime anche senza chiave MDBList/profilo lato server.
  animeRank: z.number().int().min(1).nullable().optional(),
  customBadge: z.string().max(40).nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  firstAirDate: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
  // Stessi bound del ramo query della poster route (bscale): un valore 0 o
  // negativo arrivava a resizeBackdropCached (fit 'fill') → sharp lancia →
  // 500 + negative cache per un titolo permanentemente rotto (fix M5).
  backdropScale: z.number().int().min(5).max(500).nullable().optional(),
  backdropOffsetX: z.number().int().nullable().optional(),
  backdropOffsetY: z.number().int().nullable().optional(),
  blurEnabled: z.boolean().nullable().optional(),
  blurIntensity: z.number().nullable().optional(),
  blurFade: z.number().nullable().optional(),
  blurDarkness: z.number().nullable().optional(),
  gradientHeight: z.number().nullable().optional(),
  badgeStyle: z.enum(BADGE_STYLES).nullable().optional(),
  rankingBadgeStyle: z.enum(RANKING_BADGE_STYLES).nullable().optional(),
  cleanPosters: z.array(z.string()).nullable().optional(),
  cleanPosterIndex: z.number().int().min(0).nullable().optional(),
  cleanPosterUpdatedAt: z.string().nullable().optional(),
  autoRotateClean: z.boolean().nullable().optional(),
  excludedPosters: z.array(z.string()).nullable().optional(),
  logoDisabled: z.boolean().nullable().optional(),
  networkLogo: z.boolean().nullable().optional(),
  ribbonSide: z.enum(["left", "right"]).nullable().optional(),
  networkLogoPath: z.string().nullable().optional(),
  networkLogoName: z.string().nullable().optional(),
  defaultBadgeStyle: z.enum(BADGE_STYLES).nullable().optional(),
  defaultRankingBadgeStyle: z.enum(RANKING_BADGE_STYLES).nullable().optional(),
  episodeGroupId: z.string().max(80).nullable().optional(),
})

export type MappingInput = z.infer<typeof mappingSchema>

// Query string del poster: bound anti-DoS/cache-flood (R1). La cache key
// contiene i raw params e i testi finiscono negli SVG: una stringa da 10KB
// in `extra`/`title`/path significherebbe render enormi + entry cache enormi
// + key explosion (ogni valore distinto = miss). Valori oltre i bound → 400
// prima di slot/inflight/cache (route). I bound sono generosi: nessun client
// legittimo li supera (path TMDB <100, titoli <200, rank int piccoli,
// numerici a poche cifre). I valori numerici restano validati anche al sito
// d'uso con clamp (poster-config) — qui basta il bound di lunghezza.
const boundedQueryString = (max: number) => z.string().max(max).optional()
const intQueryString = (maxDigits: number) =>
  z.string().regex(new RegExp(`^-?\\d{1,${maxDigits}}$`)).optional()

export const posterQuerySchema = z.object({
  extra: boundedQueryString(80),
  label: boundedQueryString(80),
  title: boundedQueryString(200),
  genreName: boundedQueryString(60),
  poster: boundedQueryString(160),
  logo: boundedQueryString(160),
  backdrop: boundedQueryString(160),
  quality: boundedQueryString(16),
  lang: boundedQueryString(20),
  rsrc: boundedQueryString(200),
  imdbId: z.string().regex(/^tt\d{1,20}$/).optional(),
  rank: intQueryString(7),
  animerank: intQueryString(7),
  scale: boundedQueryString(12),
  ox: boundedQueryString(12),
  oy: boundedQueryString(12),
  tscale: boundedQueryString(12),
  tox: boundedQueryString(12),
  toy: boundedQueryString(12),
  gscale: boundedQueryString(12),
  gox: boundedQueryString(12),
  goy: boundedQueryString(12),
  qscale: boundedQueryString(12),
  qox: boundedQueryString(12),
  qoy: boundedQueryString(12),
  netscale: boundedQueryString(12),
  nox: boundedQueryString(12),
  noy: boundedQueryString(12),
  bscale: boundedQueryString(12),
  box: boundedQueryString(12),
  boy: boundedQueryString(12),
  gradHeight: boundedQueryString(12),
  blur: boundedQueryString(12),
  bf: boundedQueryString(12),
  bd: boundedQueryString(12),
  voteAverage: boundedQueryString(12),
  year: boundedQueryString(16),
  rd: boundedQueryString(10),
  fad: boundedQueryString(10),
  mv: boundedQueryString(32),
  fmt: boundedQueryString(8),
  format: boundedQueryString(8),
})

export type PosterQuery = z.infer<typeof posterQuerySchema>

/**
 * Ritorna il messaggio d'errore se un query param supera i bound, altrimenti
 * null. I parametri ignoti passano (semantica inerte o clamp al sito d'uso).
 */
export function validatePosterQuery(searchParams: URLSearchParams): string | null {
  const input: Record<string, string> = {}
  for (const key of new Set(searchParams.keys())) {
    const v = searchParams.get(key)
    if (v !== null) input[key] = v
  }
  const parsed = posterQuerySchema.safeParse(input)
  if (parsed.success) return null
  const first = parsed.error.issues[0]
  const name = first && first.path.length > 0 ? String(first.path[0]) : "query"
  return `Invalid query parameter: ${name}`
}

export const mappingUpdateSchema = mappingSchema.partial().omit({ tmdbId: true, mediaType: true })

export type MappingUpdate = z.infer<typeof mappingUpdateSchema>

// FlixPatrol catalog entry from scraper
export const flixpatrolEntrySchema = z.object({
  rank: z.number().int().positive(),
  title: z.string(),
  tmdb: z.object({
    id: z.number().int().positive(),
    media_type: z.string(),
    release_date: z.string().optional(),
  }).nullable(),
})

export type FlixPatrolEntry = z.infer<typeof flixpatrolEntrySchema>

// MDBList anime list item
export const mdblistAnimeSchema = z.object({
  tmdb: z.number().int().positive().nullable().optional(),
  id: z.number().int().positive().nullable().optional(),
  imdb: z.string().nullable().optional(),
  title: z.string().optional(),
})

export type MDBListAnimeItem = z.infer<typeof mdblistAnimeSchema>

// Enriched anime item returned by /api/mdblist/anime
export interface EnrichedAnimeItem {
  id: number
  title: string
  poster_path: string
  rank: number
  media_type: string
}

// TMDB search result (partial - what we use)
export const tmdbSearchResultSchema = z.object({
  id: z.number().int().positive(),
  media_type: z.enum(["movie", "tv"]),
  title: z.string().optional(),
  name: z.string().optional(),
  poster_path: z.string().nullable(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  imdb_id: z.string().nullable().optional(),
})

export type TMDBSearchResult = z.infer<typeof tmdbSearchResultSchema>

// TMDB details (partial)
export const tmdbDetailsSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  name: z.string().optional(),
  genres: z.array(z.object({ id: z.number(), name: z.string() })),
  vote_average: z.number(),
  type: z.string().optional(),
  status: z.string().optional(),
  release_date: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
  networks: z.array(z.object({ id: z.number(), name: z.string(), logo_path: z.string().nullable(), origin_country: z.string() })).optional(),
  production_companies: z.array(z.object({ id: z.number(), name: z.string(), logo_path: z.string().nullable(), origin_country: z.string() })).optional(),
  original_language: z.string().optional(),
})
