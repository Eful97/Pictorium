import { buildPosterPublicUrl } from "@/lib/poster-public-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { isRankKey } from "@/lib/i18n"
import type { ServerDefaults } from "@/lib/server-defaults"
import { effectiveMappingForShape, type Mapping, type PosterShape } from "@/lib/types"
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
   * Forza il formato canvas dell'URL (default: mapping > defaults).
   * Usato dal catalogo per il `banner` Nuvio: sempre landscape renderizzato,
   * indipendente dal posterShape del titolo — la modalità orizzontale di
   * Nuvio carica `banner` (non `poster`), così mostra comunque il rendering
   * Pictorium invece del backdrop TMDB grezzo.
   */
  readonly forceShape?: PosterShape
  /**
   * Nasconde il logo film dal composite. Usato dal banner Nuvio insieme a
   * forceShape (vedi sopra): senza, il baked-in duplicherebbe l'overlay logo
   * che Nuvio applica da catalogo.
   */
  readonly hideLogo?: boolean
}

export function mappingVersionParam(mapping: Mapping | null | undefined): string | null {
  if (!mapping?.updatedAt) return null
  const timestamp = Date.parse(mapping.updatedAt)
  return Number.isFinite(timestamp) ? String(timestamp) : null
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
  const effShape: PosterShape = input.forceShape ?? (mapping?.posterShape === "landscape" ? "landscape" : "poster")
  const eff = effectiveMappingForShape(mapping, effShape)
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
    region: input.region ?? input.defaults.region,
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
    globalBadges: mapping?.showBadges ?? input.defaults.globalBadges,
    rankingBadges: mapping?.rankingBadges ?? input.defaults.rankingBadges,
    badgeGenre: input.mapping?.badgeGenre ?? input.defaults.badgeGenre,
    badgeYear: input.mapping?.badgeYear ?? input.defaults.badgeYear,
    badgeRating: input.mapping?.badgeRating ?? input.defaults.badgeRating,
    badgeQuality: input.mapping?.badgeQuality ?? input.defaults.badgeQuality,
    minQuality: input.defaults.minQuality ?? undefined,
    customRatings: mapping?.customRatings ?? input.defaults.customRatings,
    ratingSources: mapping?.ratingSources ?? input.defaults.ratingSources,
    separateRatings: mapping?.separateRatings ?? input.defaults.separateRatings ?? undefined,
    sashOrder: input.defaults.sashOrder ?? undefined,
    badgeStyle: mapping?.badgeStyle ?? input.defaults.badgeStyle,
    rankingBadgeStyle: mapping?.rankingBadgeStyle ?? input.defaults.rankingBadgeStyle,
    topBadgeScale: eff?.topBadgeScale ?? input.defaults.topBadgeScale,
    topBadgeOffsetX: eff?.topBadgeOffsetX ?? input.defaults.topBadgeOffsetX,
    topBadgeOffsetY: eff?.topBadgeOffsetY ?? input.defaults.topBadgeOffsetY,
    genreBadgeScale: eff?.genreBadgeScale ?? input.defaults.genreBadgeScale,
    qualityBadgeScale: eff?.qualityBadgeScale ?? input.defaults.qualityBadgeScale,
    genreBadgeOffsetX: eff?.genreBadgeOffsetX ?? input.defaults.genreBadgeOffsetX,
    genreBadgeOffsetY: eff?.genreBadgeOffsetY ?? input.defaults.genreBadgeOffsetY,
    qualityBadgeOffsetX: eff?.qualityBadgeOffsetX ?? input.defaults.qualityBadgeOffsetX,
    qualityBadgeOffsetY: eff?.qualityBadgeOffsetY ?? input.defaults.qualityBadgeOffsetY,
    networkLogoScale: eff?.networkLogoScale ?? input.defaults.networkLogoScale,
    networkLogoOffsetX: eff?.networkLogoOffsetX ?? input.defaults.networkLogoOffsetX,
    networkLogoOffsetY: eff?.networkLogoOffsetY ?? input.defaults.networkLogoOffsetY,
    gradientHeight: eff?.gradientHeight ?? (mapping?.language != null ? NON_CLEAN_GRADIENT_HEIGHT : input.defaults.gradientHeight),
    blurIntensity: eff?.blurIntensity ?? input.defaults.blurIntensity,
    // Default sfumatura dedicato al formato (come logoAlign): in landscape
    // serve una transizione più lunga; il portrait resta sul default globale.
    // Mapping non-clean senza valori congelati: 20/80 per tipo poster (come
    // l'editor all'apertura) invece dei default globali.
    blurFade: eff?.blurFade ?? ((input.forceShape ?? mapping?.posterShape ?? input.defaults.posterShape) === "landscape" ? 70 : (mapping?.language != null ? NON_CLEAN_BLUR_FADE : input.defaults.blurFade)),
    blurDarkness: eff?.blurDarkness ?? input.defaults.blurDarkness,
    blurEnabled: eff?.blurEnabled ?? input.defaults.blurEnabled,
    tintStrength: eff?.tintStrength ?? input.defaults.tintStrength,
    customBadge,
    title: mapping?.title ?? undefined,
    networkLogo: (input.defaults.networkLogo !== false) && (mapping?.networkLogo !== false),
    preRelease: input.defaults.preRelease,
    // hideLogo viaggia solo sul banner (il chiamante lo imposta insieme a
    // forceShape): poster/preview/Stremio non lo vedono mai.
    hideLogo: input.hideLogo,
    // ribbonSide solo globale: i mapping storici con valore salvato lo ignorano.
    ribbonSide: input.defaults.ribbonSide,
    // Formato canvas: per-titolo vince sul default globale (come gli altri
    // parametri espliciti). Emesso solo quando landscape (vedi params).
    // forceShape (banner Nuvio) scavalca entrambi.
    posterShape: input.forceShape ?? mapping?.posterShape ?? input.defaults.posterShape,
    // Allineamento: solo globale (il mapping non ha il campo) e solo
    // landscape — i portrait non portano mai `align` (sempre centrati).
    logoAlign: (input.forceShape ?? mapping?.posterShape ?? input.defaults.posterShape) === "landscape"
      ? input.defaults.logoAlign
      : undefined,
  })

  params.forEach((value, key) => url.searchParams.set(key, value))
  const mappingVersion = mappingVersionParam(input.mapping)
  if (mappingVersion) url.searchParams.set("mv", mappingVersion)
  return url
}
