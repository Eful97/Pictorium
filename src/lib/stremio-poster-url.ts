import { buildPosterPublicUrl } from "@/lib/poster-public-url"
import { buildStremioPosterSearchParams } from "@/lib/stremio-poster-params"
import { normalizeSeasonalTheme, type SeasonalTheme } from "@/lib/seasonal-theme"
import { getQualityBadgeOffsetDefault, isExtraBadgeStyle, isExtraFollowRank } from "@/lib/badge-styles"
import { isRankKey } from "@/lib/i18n"
import type { ServerDefaults } from "@/lib/server-defaults"
import { effectiveDefaultsForShape } from "@/lib/server-defaults"
import { effectiveMappingForShape, isPosterShape, type Mapping, type PosterShape } from "@/lib/types"
import { NON_CLEAN_GRADIENT_HEIGHT, NON_CLEAN_BLUR_FADE } from "@/lib/gradient-defaults"
import {
  resolveEffectiveNetworkFollow,
  resolveLandscapeNetworkOffsets,
  resolveNetworkFixedCoords,
  resolveNetworkFollowTitle,
} from "@/lib/network-follow"

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
  readonly rankBuster?: number | string | null
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
  /**
   * Seasonal frame theme (ephemeral originating-catalog context). Emitted
   * into the URL for poster AND landscapePoster (each canvas renders its OWN
   * 500×750 / 768×432 asset, never a stretch). The CLEAN banner
   * (forceShape landscape + hideLogo) NEVER carries it — see the hideLogo
   * gate below — so it stays byte-identical to legacy. Invalid values
   * normalize to absent (unframed).
   */
  readonly seasonalTheme?: SeasonalTheme | string | null
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
  // Custom badge testuale per-titolo con indipendenza per formato: il valore
  // effettivo della forma (profilo landscape vince sul flat, assente/null =
  // vedi effectiveMappingForShape) è emesso come `extra` (il server risolve
  // le label prefissate __badge.* con la lingua della richiesta).
  // Le rank-key (__badge.today/anime/movie/series e label equivalenti) sono
  // ESCLUSE: la preview WYSIWYG le rende come badge rank via rank/label, e il
  // server le riproduce da solo (rank live + fallback mapping.badgeRank/
  // trendRank/animeRank). Emetterle come `extra` duplicherebbe il badge perché
  // queryExtra vince sul badge calcolato (poster-service).
  const customBadge = eff?.customBadge && !isRankKey(eff.customBadge)
    ? eff.customBadge
    : undefined
  // Follow/coords network per-shape a unità di layer (stessi resolver del
  // server; il token resta opaco e si risolve server-side): in fissa gli
  // assoluti risolti alimentano sia dv che query esplicita, altrimenti i
  // merged offset legacy (byte-identici quando niente è configurato).
  const netFollowRaw = resolveNetworkFollowTitle(new URLSearchParams(), mapping, null, input.defaults, effShape)
  const netFixedRaw = resolveNetworkFixedCoords(new URLSearchParams(), mapping, null, input.defaults, effShape)
  const netFollowEff = resolveEffectiveNetworkFollow(netFollowRaw, netFixedRaw)
  const netFixedOff = netFollowEff ? { x: null, y: null } : netFixedRaw
  // Offset landscape con guardia fixed-layer (assoluti di altra shape mai
  // come relativi); portrait sul ramo storico byte-identico.
  const netLandOffsets = effShape === "landscape"
    ? resolveLandscapeNetworkOffsets(new URLSearchParams(), mapping, null, input.defaults)
    : null
  // Shape-local extra legacy marker (task 3B2): with an owned landscape key —
  // including explicit `null` (follow own rank) — the portrait flat must not
  // travel into the landscape URL (these builders emit per shape, so omission
  // resolves own-rank server-side, pixels intact, legacy URLs byte-identical
  // while the profile stays absent). Per-title mapping precedence is
  // shape-effective (`eff` above already overlays the title's landscape
  // style keys, so a title-owned landscape style shadows the flat here).
  // Shape-local extra follow marker: owned follow-rank shadows the flat;
  // legacy null/absent/invalid inherits (byte-identical).
  const rawLandForXbs = effShape === "landscape" ? input.defaults.landscape : null
  let shapeExtraStyle: import("@/lib/badge-styles").ExtraBadgeStyle | import("@/lib/badge-styles").ExtraBadgeFollowRank | null | undefined
  if (rawLandForXbs != null && "extraBadgeStyle" in rawLandForXbs) {
    const v = (rawLandForXbs as { extraBadgeStyle?: unknown }).extraBadgeStyle
    if (isExtraFollowRank(v) || isExtraBadgeStyle(typeof v === "string" ? v : null)) {
      shapeExtraStyle = v as import("@/lib/badge-styles").ExtraBadgeStyle | import("@/lib/badge-styles").ExtraBadgeFollowRank
    } else {
      shapeExtraStyle = input.defaults.extraBadgeStyle ?? undefined
    }
  } else {
    shapeExtraStyle = sd.extraBadgeStyle ?? input.defaults.extraBadgeStyle ?? undefined
  }
  const params = buildStremioPosterSearchParams({
    config: input.config,
    animerank: input.animerank,
    rankBuster: input.rankBuster,
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
    globalBadges: eff?.showBadges ?? sd.globalBadges,
    rankingBadges: eff?.rankingBadges ?? sd.rankingBadges,
    badgeGenre: eff?.badgeGenre ?? sd.badgeGenre,
    badgeYear: eff?.badgeYear ?? sd.badgeYear,
    badgeRating: eff?.badgeRating ?? sd.badgeRating,
    badgeQuality: eff?.badgeQuality ?? sd.badgeQuality,
    // Badge età per-titolo con indipendenza per formato (stessa effettività
    // del server — query > mapping effettivo > config > defaults): il titolo
    // vince sui default globali con emissione esplicita in query (come gli
    // altri visual sopra). Mapping legacy senza chiavi = default effettivi
    // della forma (`sd` è già landscape-aware), URL legacy byte-identici.
    // Con `config` viaggiano espliciti così la query vince sul token
    // condiviso (stesso contratto config/age degli altri visual).
    ageBadge: eff?.ageBadge ?? sd.ageBadge,
    ageCountry: eff?.ageCountry ?? sd.ageCountry ?? undefined,
    ageBadgeStyle: eff?.ageBadgeStyle ?? sd.ageBadgeStyle ?? undefined,
    minQuality: sd.minQuality ?? undefined,
    customRatings: eff?.customRatings ?? sd.customRatings,
    ratingSources: mapping?.ratingSources ?? sd.ratingSources,
    separateRatings: eff?.separateRatings ?? sd.separateRatings ?? undefined,
    separateRatingsStyle: eff?.separateRatingsStyle ?? sd.separateRatingsStyle,
    separateBadgeScale: eff?.separateBadgeScale ?? sd.separateBadgeScale,
    separateBadgeOffsetX: eff?.separateBadgeOffsetX ?? sd.separateBadgeOffsetX,
    separateBadgeOffsetY: eff?.separateBadgeOffsetY ?? sd.separateBadgeOffsetY,
    sashOrder: sd.sashOrder ?? undefined,
    // Esclusioni automatiche space-wide (flat condivisi, nessun per-titolo):
    // emesse come `dct`/`dnet` solo quando non-vuote (URL legacy invariati).
    disabledContentTags: sd.disabledContentTags ?? undefined,
    disabledNetworks: sd.disabledNetworks ?? undefined,
    badgeStyle: eff?.badgeStyle ?? sd.badgeStyle,
    rankingBadgeStyle: eff?.rankingBadgeStyle ?? sd.rankingBadgeStyle,
    extraBadgeStyle: eff?.extraBadgeStyle ?? shapeExtraStyle ?? undefined,
    badgeFont: eff?.badgeFont ?? sd.badgeFont ?? input.defaults.badgeFont ?? undefined,
    qualityBadgeStyle: eff?.qualityBadgeStyle ?? sd.qualityBadgeStyle,
    videoFormats: eff?.videoFormats ?? sd.videoFormats ?? input.defaults.videoFormats,
    topBadgeScale: eff?.topBadgeScale ?? sd.topBadgeScale,
    topBadgeOffsetX: eff?.topBadgeOffsetX ?? sd.topBadgeOffsetX,
    topBadgeOffsetY: eff?.topBadgeOffsetY ?? sd.topBadgeOffsetY,
    // Extra tuning: explicit layers only (mapping/profile/flat, null = absent) —
    // undefined keeps URLs and `dv` byte-identical to legacy until migrated.
    extraBadgeScale: eff?.extraBadgeScale ?? sd.extraBadgeScale ?? undefined,
    extraBadgeOffsetX: eff?.extraBadgeOffsetX ?? sd.extraBadgeOffsetX ?? undefined,
    extraBadgeOffsetY: eff?.extraBadgeOffsetY ?? sd.extraBadgeOffsetY ?? undefined,
    genreBadgeScale: eff?.genreBadgeScale ?? sd.genreBadgeScale,
    qualityBadgeScale: eff?.qualityBadgeScale ?? sd.qualityBadgeScale,
    genreBadgeOffsetX: eff?.genreBadgeOffsetX ?? sd.genreBadgeOffsetX,
    genreBadgeOffsetY: eff?.genreBadgeOffsetY ?? sd.genreBadgeOffsetY,
    qualityBadgeOffsetX: eff?.qualityBadgeOffsetX ?? sd.qualityBadgeOffsetX ?? getQualityBadgeOffsetDefault(effShape, "x"),
    qualityBadgeOffsetY: eff?.qualityBadgeOffsetY ?? sd.qualityBadgeOffsetY ?? getQualityBadgeOffsetDefault(effShape, "y"),
    networkLogoScale: eff?.networkLogoScale ?? sd.networkLogoScale,
    // Offset network: in fissa gli assoluti risolti, altrimenti merged legacy
    // (landscape con guardia fixed-layer, portrait storico byte-identico).
    // Stessi valori in dv e in chiaro: stessa chiave, stesso render.
    networkLogoOffsetX: (netFixedOff.x ?? (netLandOffsets ? netLandOffsets.x : undefined))
      ?? eff?.networkLogoOffsetX ?? sd.networkLogoOffsetX,
    networkLogoOffsetY: (netFixedOff.y ?? (netLandOffsets ? netLandOffsets.y : undefined))
      ?? eff?.networkLogoOffsetY ?? sd.networkLogoOffsetY,
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
    // negli URL legacy = default del server. Stessa regola per l'altezza
    // (25 = look storico).
    topShade: eff?.topShade ?? sd.topShade ?? 50,
    topShadeHeight: eff?.topShadeHeight ?? sd.topShadeHeight ?? 25,
    customBadge,
    dateFormat: sd.dateFormat ?? undefined,
    title: mapping?.title ?? undefined,
    networkLogo: eff?.networkLogo ?? sd.networkLogo,
    // Follow spento effettivo viaggia (acceso/assente resta omesso per URL e
    // cache stabili; il server risolverebbe lo stesso dagli stessi dati).
    networkLogoFollowTitle: netFollowEff ? undefined : false,
    // Ancoraggio network: effettivo per formato (profilo landscape vince sul
    // flat), poi default globale (come networkLogo).
    networkLogoPosition: eff?.networkLogoPosition ?? sd.networkLogoPosition,
    preRelease: sd.preRelease,
    // hideLogo viaggia solo sul banner (il chiamante lo imposta insieme a
    // forceShape): poster/preview/Stremio non lo vedono mai.
    hideLogo: input.hideLogo,
    // ribbonSide solo globale: i mapping storici con valore salvato lo ignorano.
    ribbonSide: sd.ribbonSide,
    // Nastro: effettivo per formato (profilo landscape vince sul flat), poi
    // default globale (come networkLogo).
    ribbonEnabled: eff?.ribbonEnabled ?? sd.ribbonEnabled,
    // Il default orizzontale prevale sui mapping portrait solo per Stremio.
    // Emesso solo quando landscape (vedi params); forceShape resta esplicito.
    posterShape: effShape,
    // Seasonal frame: each canvas renders its OWN asset (portrait 500×750,
    // landscape 768×432 — never a stretch). Only the clean banner
    // (shape=landscape + hideLogo) stays byte-identical to legacy: it never
    // carries a theme even when the caller passes originating-list context.
    // A portrait with hideLogo keeps its frame (hideLogo hides only the
    // logo, never the frame). Invalid = absent (unframed).
    seasonalTheme: input.hideLogo && effShape === "landscape" ? undefined : normalizeSeasonalTheme(input.seasonalTheme),
    // Graphical layout: raw effective per-title value per shape, then raw
    // effective global default (landscape included) — NEVER a synthesized
    // "standard": absent stays absent (legacy unspecified URLs keep no param
    // and stay byte-identical), while an explicit standard travels as
    // `layout=standard` (see params) so it overrides inherited fresh.
    posterLayout: eff?.posterLayout ?? sd.posterLayout,
    // Fresh apply scope: same raw/absent contract as `layout` above — absent
    // stays absent (legacy URLs keep no param, server resolves "ranked"), while
    // an explicit `all` travels as `freshScope=all` so it overrides an
    // inherited ranked for unsaved/template consumers.
    posterFreshScope: eff?.posterFreshScope ?? sd.posterFreshScope,
    // Allineamento: per-shape nei default (`sd` è già landscape-aware:
    // override del profilo, poi flat, poi auto di formato) e solo landscape
    // — i portrait non portano mai `align` (sempre centrati). Il mapping non
    // ha il campo (resta globale rispetto al per-titolo). Il `?? undefined`
    // normalizza il flat null (auto) per il builder tipizzato.
    logoAlign: effShape === "landscape"
      ? (sd.logoAlign ?? undefined)
      : undefined,
  })

  params.forEach((value, key) => url.searchParams.set(key, value))
  const mappingVersion = mappingVersionParam(input.mapping)
  if (mappingVersion) url.searchParams.set("mv", mappingVersion)
  return url
}
