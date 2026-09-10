import { POSTER_URL_VERSION } from "@/lib/render-version"
import type { BadgeStyle, RankingBadgeStyle } from "@/lib/badge-styles"

export interface StremioPosterParamsInput {
  // NOTA SICUREZZA (M2): niente chiavi qui. Questo builder serve URL poster
  // che finiscono nel DB di Stremio, log CDN/proxy e link condivisi: api_key
  // e mdblist_key non devono mai comparirvi. Il server le legge dalla
  // richiesta catalogo/meta (query) o dall'env d'istanza al momento del
  // render. Unico caso con chiavi in URL: `buildUrlPattern` (template che
  // l'utente copia per sé, come la manifest URL) le accoda da solo.
  readonly animerank?: number
  readonly lang?: string | null
  readonly globalBadges?: boolean
  readonly rankingBadges?: boolean
  /** Componenti del badge genere/rating: `false` disabilita quel componente. */
  readonly badgeGenre?: boolean
  readonly badgeYear?: boolean
  readonly badgeRating?: boolean
  readonly badgeQuality?: boolean
  readonly ratingSources?: string[]
  readonly badgeStyle?: BadgeStyle
  readonly rankingBadgeStyle?: RankingBadgeStyle
  readonly gradientHeight?: number
  readonly blurIntensity?: number
  readonly blurFade?: number
  readonly blurDarkness?: number
  readonly blurEnabled?: boolean
  readonly networkLogo?: boolean
  /** Scala % del badge superiore (default 100). */
  readonly topBadgeScale?: number
  /** Offset px del badge superiore, solo stili centrati (default 0). */
  readonly topBadgeOffsetX?: number
  readonly topBadgeOffsetY?: number
  /** Scala % del badge genere/rating in basso (default 100). */
  readonly genreBadgeScale?: number
  /** Scala % del badge qualità streaming (default 100). */
  readonly qualityBadgeScale?: number
  /** Scala % del logo network (default 100). */
  readonly networkLogoScale?: number
  /** Effetto pre-digitale (darken + Coming Soon, solo film). Default OFF. */
  readonly preRelease?: boolean
  readonly ribbonSide?: "left" | "right"
  /** Badge extra testuale per-titolo (dal mapping): emesso come `extra`. */
  readonly customBadge?: string | null
  /** Titolo per-titolo (dal mapping): match JustWatch per rilevamento
   *  pre-digitale e qualità. Senza, il server ripiega su valori generici. */
  readonly title?: string | null
  readonly config?: string | null
  readonly user?: string | null
  readonly region?: string | null
}

const DEFAULT_STREMIO_POSTER_PARAMS = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  gradientHeight: 30,
  blurIntensity: 5,
  blurFade: 60,
  blurDarkness: 40,
  blurEnabled: true,
  networkLogo: true,
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  genreBadgeScale: 100,
  qualityBadgeScale: 100,
  networkLogoScale: 100,
} as const

export function buildStremioPosterSearchParams(input: StremioPosterParamsInput): URLSearchParams {
  const params = new URLSearchParams()
  const globalBadges = input.globalBadges ?? DEFAULT_STREMIO_POSTER_PARAMS.globalBadges
  const rankingBadges = input.rankingBadges ?? DEFAULT_STREMIO_POSTER_PARAMS.rankingBadges
  const blurEnabled = input.blurEnabled ?? DEFAULT_STREMIO_POSTER_PARAMS.blurEnabled
  const networkLogo = input.networkLogo ?? DEFAULT_STREMIO_POSTER_PARAMS.networkLogo

  if (input.config) params.set("config", input.config)
  if (input.user) params.set("u", input.user)
  if (input.region) params.set("region", input.region)
  // Rank anime noto al catalogo (posizione in lista): rende il badge Anime
  // deterministico su Stremio, indipendentemente dalle chiavi lato server.
  if (input.animerank) params.set("animerank", String(input.animerank))
  if (!globalBadges) params.set("badges", "0")
  if (!rankingBadges) params.set("ranking", "0")
  if (input.badgeGenre === false) params.set("bg", "0")
  if (input.badgeYear === false) params.set("by", "0")
  if (input.badgeRating === false) params.set("br", "0")
  if (input.badgeQuality === false) params.set("bq", "0")
  if (input.ratingSources && input.ratingSources.length > 0) params.set("rsrc", input.ratingSources.join(","))
  if (input.customBadge) params.set("extra", input.customBadge)
  if (input.title) params.set("title", input.title)
  if (!networkLogo) params.set("netLogo", "0")
  if (input.preRelease) params.set("pre", "1")
  if (input.ribbonSide === "right") params.set("side", "right")
  else if (input.ribbonSide === "left") params.set("side", "left")
  params.set("lang", input.lang || "it")
  if (!blurEnabled) params.set("be", "0")
  params.set("gradHeight", String(input.gradientHeight ?? DEFAULT_STREMIO_POSTER_PARAMS.gradientHeight))
  params.set("blur", String(input.blurIntensity ?? DEFAULT_STREMIO_POSTER_PARAMS.blurIntensity))
  params.set("bf", String(input.blurFade ?? DEFAULT_STREMIO_POSTER_PARAMS.blurFade))
  params.set("bd", String(input.blurDarkness ?? DEFAULT_STREMIO_POSTER_PARAMS.blurDarkness))
  params.set("bs", input.badgeStyle || DEFAULT_STREMIO_POSTER_PARAMS.badgeStyle)
  params.set("rs", input.rankingBadgeStyle || DEFAULT_STREMIO_POSTER_PARAMS.rankingBadgeStyle)
  params.set("tscale", String(input.topBadgeScale ?? DEFAULT_STREMIO_POSTER_PARAMS.topBadgeScale))
  params.set("tox", String(input.topBadgeOffsetX ?? DEFAULT_STREMIO_POSTER_PARAMS.topBadgeOffsetX))
  params.set("toy", String(input.topBadgeOffsetY ?? DEFAULT_STREMIO_POSTER_PARAMS.topBadgeOffsetY))
  params.set("gscale", String(input.genreBadgeScale ?? DEFAULT_STREMIO_POSTER_PARAMS.genreBadgeScale))
  params.set("qscale", String(input.qualityBadgeScale ?? DEFAULT_STREMIO_POSTER_PARAMS.qualityBadgeScale))
  params.set("netscale", String(input.networkLogoScale ?? DEFAULT_STREMIO_POSTER_PARAMS.networkLogoScale))
  params.set("rv", String(POSTER_URL_VERSION))
  return params
}
