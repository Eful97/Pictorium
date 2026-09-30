import { buildPosterPublicUrl } from "@/lib/poster-public-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { isRankKey } from "@/lib/i18n"
import type { ServerDefaults } from "@/lib/server-defaults"
import { effectiveDefaultsForShape } from "@/lib/server-defaults"
import { effectiveMappingForShape, isPosterShape, type Mapping, type PosterShape } from "@/lib/types"
import { NON_CLEAN_GRADIENT_HEIGHT, NON_CLEAN_BLUR_FADE } from "@/lib/gradient-defaults"

export type StremioPosterType = "movie" | "series"

export interface BuildStremioPosterUrlInput {
  readonly origin: string
  readonly type: StremioPosterType
  readonly id: number
  readonly defaults: ServerDefaults
  readonly mapping?: Mapping | null
  // Niente chiavi (vedi stremio-poster-params.ts): questo URL viene servito
  // a Stremio e persistito nel suo DB — mai segreti dentro.
  readonly animerank?: number
  readonly lang?: string | null
  readonly config?: string | null
  readonly user?: string | null
  readonly region?: string | null
  /**
   * Forza il formato canvas dell'URL (altrimenti: default landscape > mapping > poster).
   * Usato dal catalogo per i campi landscape: `banner` (sempre pulito, con
   * `hideLogo`) per i client che lo leggono e `landscapePoster` (con logo
   * baked-in) per NuvioTV — entrambi indipendenti dal posterShape del titolo.
   */
  readonly forceShape?: PosterShape
  /**
   * Nasconde il logo film dal composite. Usato solo col banner pulito
   * (insieme a forceShape, vedi sopra): senza, il baked-in duplicherebbe
   * l'overlay logo che quei client applicano da catalogo.
   */
  readonly hideLogo?: boolean
}

export function mappingVersionParam(mapping: Mapping | null | undefined): string | null {
  if (!mapping?.updatedAt) return null
  const timestamp = Date.parse(mapping.updatedAt)
  return Number.isFinite(timestamp) ? String(timestamp) : null
}

/** Il default orizzontale forza Stremio, senza riscrivere il formato salvato del titolo. */
export function stremioPosterShape(mapping: Mapping | null | undefined, defaults: ServerDefaults): PosterShape {
  if (defaults.posterShape === "landscape") return "landscape"
  return isPosterShape(mapping?.posterShape) ? mapping.posterShape : "poster"
}

export function buildStremioPosterUrl(input: BuildStremioPosterUrlInput): URL {
  const url = buildPosterPublicUrl(`/api/poster/${input.type}/${input.id}`, {
    origin: input.origin,
  })

  const mapping = input.mapping ?? null
  // Profili per-formato: in landscape l'URL esplicita il tuning del profilo
  // orizzontale (stessa effettività del server — query > landscape > flat).
  // forceShape scavalca la selezione da mapping (vedi sopra) ma il profilo
  // resta quello del mapping salvato (fallback flat chiave-per-chiave).
  const effShape = input.forceShape ?? stremioPosterShape(mapping, input.defaults)
  const eff = effectiveMappingForShape(mapping, effShape)
  // Default di resa per formato: in landscape il profilo `landscape` vince sui
  // flat chiave-per-chiave (chiavi fuori dal subset restano flat per tipo).
  const sd = effectiveDefaultsForShape(input.defaults, effShape)
  // Custom badge testuale salvato per-titolo: emesso come `extra` (il server
  // risolve le label prefissate __badge.* con la lingua della richiesta).
  // Le rank-key (__badge.today/anime/movie/series e label equivalenti) sono
  // ESCLUSE: la preview WYSIWYG le rende come badge rank via rank/label, e il
  // server le riproduce da solo (rank live + fallback mapping.badgeRank/
  // trendRank/animeRank). Emetterle come `extra` duplicherebbe il badge perché
  // queryExtra vince sul badge calcolato (poster-service).
  const customBadge = mapping?.customBadge && !isRankKey(mapping.customBadge)
    ? mapping.customBadge
    : undefined
  const params = buildStremioPosterSearchParams({
    config: input.config,
    animerank: input.animerank,
    user: input.user,
    region: input.region ?? sd.region,
    lang: input.lang || "it",
    // URL compatti senza token stateless: il tuning numerico si risolve
    // server-side (mapping > defaults dello spazio). Con `config` resta
    // esplicito (il token perderebbe contro query assente). I template
    // manuali (buildUrlPattern) restano sempre espliciti.
    compactTuning: !input.config,
    // Per-titolo vince sui default globali, con emissione ESPLICITA in query:
    // il fallback server (mapping quando il parametro manca) è fragile —
    // con installazioni ?config= il token scavalca il mapping (poster-config:
    // configOverride.globalBadges vince su mapping.showBadges). Il server
    // applica query > mapping > config > defaults, quindi l'esplicito è
    // sempre fedele al mapping senza alterare i titoli senza mapping.
    globalBadges: mapping?.showBadges ?? sd.globalBadges,
    rankingBadges: mapping?.rankingBadges ?? sd.rankingBadges,
    badgeGenre: input.mapping?.badgeGenre ?? sd.badgeGenre,
    badgeYear: input.mapping?.badgeYear ?? sd.badgeYear,
    badgeRating: input.mapping?.badgeRating ?? sd.badgeRating,
    badgeQuality: input.mapping?.badgeQuality ?? sd.badgeQuality,
    minQuality: sd.minQuality ?? undefined,
    customRatings: mapping?.customRatings ?? sd.customRatings,
    ratingSources: mapping?.ratingSources ?? sd.ratingSources,
    separateRatings: mapping?.separateRatings ?? sd.separateRatings ?? undefined,
    sashOrder: sd.sashOrder ?? undefined,
    badgeStyle: mapping?.badgeStyle ?? sd.badgeStyle,
    rankingBadgeStyle: mapping?.rankingBadgeStyle ?? sd.rankingBadgeStyle,
    qualityBadgeStyle: mapping?.qualityBadgeStyle ?? sd.qualityBadgeStyle,
    videoFormats: mapping?.videoFormats ?? sd.videoFormats,
    topBadgeScale: eff?.topBadgeScale ?? sd.topBadgeScale,
    topBadgeOffsetX: eff?.topBadgeOffsetX ?? sd.topBadgeOffsetX,
    topBadgeOffsetY: eff?.topBadgeOffsetY ?? sd.topBadgeOffsetY,
    genreBadgeScale: eff?.genreBadgeScale ?? sd.genreBadgeScale,
    qualityBadgeScale: eff?.qualityBadgeScale ?? sd.qualityBadgeScale,
    genreBadgeOffsetX: eff?.genreBadgeOffsetX ?? sd.genreBadgeOffsetX,
    genreBadgeOffsetY: eff?.genreBadgeOffsetY ?? sd.genreBadgeOffsetY,
    qualityBadgeOffsetX: eff?.qualityBadgeOffsetX ?? sd.qualityBadgeOffsetX,
    qualityBadgeOffsetY: eff?.qualityBadgeOffsetY ?? sd.qualityBadgeOffsetY,
    networkLogoScale: eff?.networkLogoScale ?? sd.networkLogoScale,
    networkLogoOffsetX: eff?.networkLogoOffsetX ?? sd.networkLogoOffsetX,
    networkLogoOffsetY: eff?.networkLogoOffsetY ?? sd.networkLogoOffsetY,
    // Scala/offset logo: in compact viaggiano solo dentro `dv` (firma), ma
    // vanno passati espliciti al builder altrimenti un cambio dei default
    // non invaliderebbe l'URL (cache stantia su browser/edge/Stremio).
    logoScale: eff?.logoScale ?? sd.logoScale ?? undefined,
    logoOffsetX: eff?.logoOffsetX ?? sd.logoOffsetX ?? undefined,
    logoOffsetY: eff?.logoOffsetY ?? sd.logoOffsetY ?? undefined,
    gradientHeight: eff?.gradientHeight ?? (mapping?.language != null ? NON_CLEAN_GRADIENT_HEIGHT : sd.gradientHeight),
    blurIntensity: eff?.blurIntensity ?? sd.blurIntensity,
    // Default sfumatura dedicato al formato (come logoAlign): in landscape
    // serve una transizione più lunga; il portrait resta sul default globale.
    // Mapping non-clean senza valori congelati: 20/80 per tipo poster (come
    // l'editor all'apertura) invece dei default globali. Il default effettivo
    // di formato (sd, già landscape-aware) vince sempre sul fallback 70.
    blurFade: eff?.blurFade ?? sd.blurFade ?? (effShape === "landscape" ? 70 : (mapping?.language != null ? NON_CLEAN_BLUR_FADE : 50)),
    blurDarkness: eff?.blurDarkness ?? sd.blurDarkness,
    blurEnabled: eff?.blurEnabled ?? sd.blurEnabled,
    tintStrength: eff?.tintStrength ?? sd.tintStrength,
    // Ombra superiore: profilo effettivo per-titolo (landscape incluso),
    // poi default globale, poi 50 (default di formato invariato). Assente
    // negli URL legacy = default del server.
    topShade: eff?.topShade ?? sd.topShade ?? 50,
    customBadge,
    badgePresetId: mapping?.badgePresetId,
    badgePresetRev: mapping?.badgePresetRev,
    dateFormat: sd.dateFormat ?? undefined,
    title: mapping?.title ?? undefined,
    networkLogo: (sd.networkLogo !== false) && (mapping?.networkLogo !== false),
    // Ancoraggio network: per-titolo vince sul default globale (come networkLogo).
    networkLogoPosition: mapping?.networkLogoPosition ?? sd.networkLogoPosition,
    preRelease: sd.preRelease,
    // hideLogo viaggia solo sul banner (il chiamante lo imposta insieme a
    // forceShape): poster/preview/Stremio non lo vedono mai.
    hideLogo: input.hideLogo,
    // ribbonSide solo globale: i mapping storici con valore salvato lo ignorano.
    ribbonSide: sd.ribbonSide,
    // Nastro: per-titolo vince sul default globale (come networkLogo).
    ribbonEnabled: mapping?.ribbonEnabled ?? sd.ribbonEnabled,
    // Il default orizzontale prevale sui mapping portrait solo per Stremio.
    // Emesso solo quando landscape (vedi params); forceShape resta esplicito.
    posterShape: effShape,
    // Allineamento: solo globale (il mapping non ha il campo) e solo
    // landscape — i portrait non portano mai `align` (sempre centrati).
    logoAlign: effShape === "landscape"
      ? sd.logoAlign
      : undefined,
  })

  params.forEach((value, key) => url.searchParams.set(key, value))
  const mappingVersion = mappingVersionParam(input.mapping)
  if (mappingVersion) url.searchParams.set("mv", mappingVersion)
  return url
}
