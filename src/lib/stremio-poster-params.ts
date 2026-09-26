import { POSTER_URL_VERSION } from "@/lib/render-version"
import type { BadgeStyle, RankingBadgeStyle } from "@/lib/badge-styles"
import { parseMinQuality, type StreamQuality } from "@/lib/quality-tiers"
import { parseSashOrder, isDefaultSashOrder, type SashBucket } from "@/lib/badge-priority"
import type { PosterShape } from "@/lib/types"

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
  /** Soglia minima tier qualità (emessa come `qmin` solo quando non-SD per non invalidare la cache). */
  readonly minQuality?: StreamQuality | null
  /** Riga rating custom provider (display). `false` emette `cr=0`. */
  readonly customRatings?: boolean
  readonly ratingSources?: string[]
  /** Colonna rating separati: emessa come `sep=1` solo quando attiva (default OFF, cache stabile). */
  readonly separateRatings?: boolean
  /** Ordine sash (emesso come `sash` solo quando non-default). */
  readonly sashOrder?: readonly SashBucket[] | null
  readonly badgeStyle?: BadgeStyle
  readonly rankingBadgeStyle?: RankingBadgeStyle
  readonly gradientHeight?: number
  readonly blurIntensity?: number
  readonly blurFade?: number
  readonly blurDarkness?: number
  readonly blurEnabled?: boolean
  /** Intensità tinta di scena 0-100 (default 20). Emessa sempre esplicita. */
  readonly tintStrength?: number
  readonly networkLogo?: boolean
  /** Scala % del badge superiore (default 100). */
  readonly topBadgeScale?: number
  /** Offset px del badge superiore, solo stili centrati (default 0). */
  readonly topBadgeOffsetX?: number
  readonly topBadgeOffsetY?: number
  /** Scala % del badge genere/rating in basso (default 100). */
  readonly genreBadgeScale?: number
  /** Offset px del badge genere/rating, solo stili non-bar (default 0). */
  readonly genreBadgeOffsetX?: number
  readonly genreBadgeOffsetY?: number
  /** Scala % del badge qualità streaming (default 100). */
  readonly qualityBadgeScale?: number
  /** Offset px del badge qualità (default 0). */
  readonly qualityBadgeOffsetX?: number
  readonly qualityBadgeOffsetY?: number
  /** Scala % del logo network (default 100). */
  readonly networkLogoScale?: number
  /** Offset px del logo network (default 0). */
  readonly networkLogoOffsetX?: number
  readonly networkLogoOffsetY?: number
  /** Effetto pre-digitale (darken + Coming Soon, solo film). Default OFF. */
  readonly preRelease?: boolean
  /** Nasconde il logo film dal composite (banner Nuvio: Nuvio lo sovrappone già). Default OFF. */
  readonly hideLogo?: boolean
  readonly ribbonSide?: "left" | "right"
  /** Formato canvas: emesso come `shape=landscape` solo quando landscape
   *  (il portrait è il default e resta omesso per non invalidare la cache). */
  readonly posterShape?: PosterShape
  /**
   * Allineamento blocco logo/metadati. Emesso solo quando diverso dal
   * default di formato (landscape "left", poster "center"): i default
   * non invalidano la cache e il server li risolve da solo.
   */
  readonly logoAlign?: "left" | "center"
  /** Badge extra testuale per-titolo (dal mapping): emesso come `extra`. */
  readonly customBadge?: string | null
  /** Titolo per-titolo (dal mapping): match JustWatch per rilevamento
   *  pre-digitale e qualità. Senza, il server ripiega su valori generici. */
  readonly title?: string | null
  readonly config?: string | null
  readonly user?: string | null
  readonly region?: string | null
  /**
   * URL compatti (v1.23.0): omette i 17 tuning numerici ad alta cardinalità
   * (gradiente/blur/tinta + scale/offset badge). Il server li risolve da
   * mapping salvato > defaults (stessa catena, stesso render, chiave più
   * corta e convergente). Mai con `config` (il token perderebbe contro il
   * mapping). Toggle/enum/restano espliciti (bassa cardinalità + fallback
   * server incompleti per alcuni).
   */
  readonly compactTuning?: boolean
}

const DEFAULT_STREMIO_POSTER_PARAMS = {
  globalBadges: true,
  rankingBadges: true,
  badgeStyle: "shadow",
  rankingBadgeStyle: "default",
  gradientHeight: 30,
  blurIntensity: 20,
  blurFade: 50,
  blurDarkness: 30,
  tintStrength: 20,
  blurEnabled: true,
  networkLogo: true,
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  genreBadgeScale: 100,
  genreBadgeOffsetX: 0,
  genreBadgeOffsetY: 0,
  qualityBadgeScale: 100,
  qualityBadgeOffsetX: 0,
  qualityBadgeOffsetY: 0,
  networkLogoScale: 100,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
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
  const mq = parseMinQuality(input.minQuality ?? null)
  if (mq && mq !== "SD") params.set("qmin", mq)
  if (input.customRatings === false) params.set("cr", "0")
  if (input.separateRatings) params.set("sep", "1")
  if (input.ratingSources && input.ratingSources.length > 0) params.set("rsrc", input.ratingSources.join(","))
  if (input.sashOrder && !isDefaultSashOrder(input.sashOrder)) {
    const parsed = parseSashOrder(input.sashOrder.join(","))
    if (parsed) params.set("sash", parsed.join(","))
  }
  if (input.customBadge) params.set("extra", input.customBadge)
  if (input.title) params.set("title", input.title)
  if (!networkLogo) params.set("netLogo", "0")
  if (input.preRelease) params.set("pre", "1")
  if (input.hideLogo) params.set("hideLogo", "1")
  if (input.ribbonSide === "right") params.set("side", "right")
  else if (input.ribbonSide === "left") params.set("side", "left")
  if (input.posterShape === "landscape") {
    params.set("shape", "landscape")
    if (input.logoAlign === "center") params.set("align", "center")
  }
  params.set("lang", input.lang || "it")
  if (!blurEnabled) params.set("be", "0")
  // compactTuning: solo stile ad alta cardinalità omesso (vedi sopra) — il
  // resto resta esplicito per fedeltà ai default e ai token.
  if (!input.compactTuning) {
    params.set("gradHeight", String(input.gradientHeight ?? DEFAULT_STREMIO_POSTER_PARAMS.gradientHeight))
    params.set("blur", String(input.blurIntensity ?? DEFAULT_STREMIO_POSTER_PARAMS.blurIntensity))
    params.set("tint", String(input.tintStrength ?? DEFAULT_STREMIO_POSTER_PARAMS.tintStrength))
    params.set("bf", String(input.blurFade ?? DEFAULT_STREMIO_POSTER_PARAMS.blurFade))
    params.set("bd", String(input.blurDarkness ?? DEFAULT_STREMIO_POSTER_PARAMS.blurDarkness))
  }
  params.set("bs", input.badgeStyle || DEFAULT_STREMIO_POSTER_PARAMS.badgeStyle)
  params.set("rs", input.rankingBadgeStyle || DEFAULT_STREMIO_POSTER_PARAMS.rankingBadgeStyle)
  if (!input.compactTuning) {
    params.set("tscale", String(input.topBadgeScale ?? DEFAULT_STREMIO_POSTER_PARAMS.topBadgeScale))
    params.set("tox", String(input.topBadgeOffsetX ?? DEFAULT_STREMIO_POSTER_PARAMS.topBadgeOffsetX))
    params.set("toy", String(input.topBadgeOffsetY ?? DEFAULT_STREMIO_POSTER_PARAMS.topBadgeOffsetY))
    params.set("gscale", String(input.genreBadgeScale ?? DEFAULT_STREMIO_POSTER_PARAMS.genreBadgeScale))
    params.set("gox", String(input.genreBadgeOffsetX ?? DEFAULT_STREMIO_POSTER_PARAMS.genreBadgeOffsetX))
    params.set("goy", String(input.genreBadgeOffsetY ?? DEFAULT_STREMIO_POSTER_PARAMS.genreBadgeOffsetY))
    params.set("qscale", String(input.qualityBadgeScale ?? DEFAULT_STREMIO_POSTER_PARAMS.qualityBadgeScale))
    params.set("qox", String(input.qualityBadgeOffsetX ?? DEFAULT_STREMIO_POSTER_PARAMS.qualityBadgeOffsetX))
    params.set("qoy", String(input.qualityBadgeOffsetY ?? DEFAULT_STREMIO_POSTER_PARAMS.qualityBadgeOffsetY))
    params.set("netscale", String(input.networkLogoScale ?? DEFAULT_STREMIO_POSTER_PARAMS.networkLogoScale))
    params.set("nox", String(input.networkLogoOffsetX ?? DEFAULT_STREMIO_POSTER_PARAMS.networkLogoOffsetX))
    params.set("noy", String(input.networkLogoOffsetY ?? DEFAULT_STREMIO_POSTER_PARAMS.networkLogoOffsetY))
  }
  params.set("rv", String(POSTER_URL_VERSION))
  return params
}
