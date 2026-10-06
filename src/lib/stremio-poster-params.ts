import { POSTER_URL_VERSION } from "@/lib/render-version"
import type { BadgeStyle, RankingBadgeStyle, QualityBadgeStyle, BadgeFont, SeparateRatingsStyle, ExtraBadgeStyle } from "@/lib/badge-styles"
import { getSeparateBadgeDefaultScale, getSeparateRatingsStyleForShape } from "@/lib/badge-styles"
import type { VideoFormat } from "@/lib/av-specs"
import { parseMinQuality, type StreamQuality } from "@/lib/quality-tiers"
import { parseSashOrder, isDefaultSashOrder, type SashBucket } from "@/lib/badge-priority"
import { BADGE_PRESET_ID_RE, BADGE_PRESET_REV_RE } from "@/lib/badge-preset"
import type { PosterShape } from "@/lib/types"
import type { DateFormat } from "@/lib/release-badge"

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
  /**
   * Layout dei rating separati: emesso come `sepstyle` solo quando bottom
   * (default "column", cache stabile — gli URL esistenti non cambiano).
   * Enum a bassa cardinalità come bs/rs/bfont: resta esplicito anche in
   * compact (mai dentro `dv`, che copre solo i 24 numerici).
   */
  readonly separateRatingsStyle?: SeparateRatingsStyle | null
  /** Ordine sash (emesso come `sash` solo quando non-default). */
  readonly sashOrder?: readonly SashBucket[] | null
  readonly badgeStyle?: BadgeStyle
  readonly rankingBadgeStyle?: RankingBadgeStyle
  /** Standalone extra-badge style: emitted as `xbs` only when defined. */
  readonly extraBadgeStyle?: ExtraBadgeStyle | null
  /** Font dei testi badge ("inter" = resa storica). */
  readonly badgeFont?: BadgeFont
  /** Quality style: emitted as `qbs` only when non-standard (stable cache). */
  readonly qualityBadgeStyle?: QualityBadgeStyle | null
  /** Formati A/V abilitati: emessi come `formats` solo se specificati. */
  readonly videoFormats?: readonly VideoFormat[] | null
  readonly gradientHeight?: number
  readonly blurIntensity?: number
  readonly blurFade?: number
  readonly blurDarkness?: number
  readonly blurEnabled?: boolean
  /** Intensità tinta di scena 0-100 (default 20). Emessa sempre esplicita. */
  readonly tintStrength?: number
  /**
   * Ombra lineare superiore 0-100 (default 50). Emessa solo quando diversa
   * dal default (come qmin/sash): gli URL esistenti non cambiano e la cache
   * non si invalida in massa. Sotto compactTuning la risolve il server dal
   * mapping (stessa catena, stesso render).
   */
  readonly topShade?: number
  readonly networkLogo?: boolean
  /**
   * Posizione del logo network ("auto" = specchio dinamico).
   * Emesso come `netPos` solo in modo "top" (cache stabile: gli URL
   * esistenti non cambiano e il server risolve `auto` da solo).
   */
  readonly networkLogoPosition?: import("@/lib/types").NetworkLogoPosition
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
  /** Scala % dei rating separati (default unico 130 per tutti gli stili). */
  readonly separateBadgeScale?: number
  /** Offset px del gruppo rating separati, colonna/pills (bar portrait: solo Y). Default 0. */
  readonly separateBadgeOffsetX?: number
  /** Offset px del gruppo rating separati (negativo = su, positivo = giù). Default 0. */
  readonly separateBadgeOffsetY?: number
  /** Offset px del badge qualità (default 0). */
  readonly qualityBadgeOffsetX?: number
  readonly qualityBadgeOffsetY?: number
  /** Scala % del logo network (default 100). */
  readonly networkLogoScale?: number
  /** Offset px del logo network (default 0). */
  readonly networkLogoOffsetX?: number
  readonly networkLogoOffsetY?: number
  /** Scala % logo film (null = auto-fit per aspect). In compact coperta da `dv`. */
  readonly logoScale?: number | null
  /** Offset px logo film (null = 0). In compact coperti da `dv`. */
  readonly logoOffsetX?: number | null
  readonly logoOffsetY?: number | null
  /** Effetto pre-digitale (darken + Coming Soon, solo film). Default OFF. */
  readonly preRelease?: boolean
  /** Nasconde il logo film dal composite (banner pulito per i client che
   *  sovrappongono già il logo da catalogo). Default OFF. */
  readonly hideLogo?: boolean
  readonly ribbonSide?: "left" | "right"
  /** Nastro stile Netflix all'angolo: emesso come `ribbon=0` solo quando OFF (default ON, cache stabile). */
  readonly ribbonEnabled?: boolean
  /** Formato canvas: emesso come `shape=landscape` solo quando landscape
   *  (il portrait è il default e resta omesso per non invalidare la cache). */
  readonly posterShape?: PosterShape
  /**
   * Formato ignoto a build-time (template Nuvio `shape={shape}`): lo stile
   * si emette raw e la normalizzazione bar→pills resta dinamica server-side
   * (il portrait di quegli URL resta barra, invariato).
   */
  readonly shapeUnknown?: boolean
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
  readonly badgePresetId?: string | null
  readonly badgePresetRev?: string | null
  /**
   * Formato data badge "in uscita": emesso come `df` solo quando esplicito
   * (non-`locale`) — gli URL esistenti restano identici e la cache non si
   * invalida (il server risolve `locale` da solo).
   */
  readonly dateFormat?: DateFormat | null
  readonly config?: string | null
  readonly user?: string | null
  readonly region?: string | null
  /**
   * URL compatti (v1.23.0): omette i 24 tuning numerici ad alta cardinalità
   * (gradiente/blur/tinta + scale/offset badge + scala/offset logo). Il server li risolve da
   * mapping salvato > defaults (stessa catena, stesso render, chiave più
   * corta e convergente). Mai con `config` (il token perderebbe contro il
   * mapping). Toggle/enum/restano espliciti (bassa cardinalità + fallback
   * server incompleti per alcuni).
   */
  readonly compactTuning?: boolean
  /**
   * Template "Segui il mio spazio": omette TUTTI i valori visuali
   * (toggle, stili, tuning) così il server li risolve dallo spazio salvato
   * (override esplicito > mapping > config > spazio > default). Restano solo
   * identità (`u`), `live=1` e `rv`. Lingua e shape fisso sono omessi: li
   * risolve il server (mapping > config > spazio); la variante Nuvio aggiunge
   * `shape={shape}` fuori da questo builder. Mai con valori visuali.
   */
  readonly followSpace?: boolean
  /**
   * Politica di rivalidazione (`live=1`): il client/proxy rivalida sempre via
   * ETag. Non bypassa la cache interna né forza il render. Con `followSpace`
   * è implicito; da solo si combina con override espliciti.
   */
  readonly live?: boolean
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
  topShade: 50,
  blurEnabled: true,
  networkLogo: true,
  topBadgeScale: 100,
  topBadgeOffsetX: 0,
  topBadgeOffsetY: 0,
  genreBadgeScale: 100,
  genreBadgeOffsetX: 0,
  genreBadgeOffsetY: 0,
  qualityBadgeScale: 100,
  separateBadgeScale: 130,
  separateBadgeOffsetX: 0,
  separateBadgeOffsetY: 0,
  qualityBadgeOffsetX: 0,
  qualityBadgeOffsetY: 0,
  networkLogoScale: 100,
  networkLogoOffsetX: 0,
  networkLogoOffsetY: 0,
  logoScale: null,
  logoOffsetX: null,
  logoOffsetY: null,
} as const

/**
 * Firma del tuning omesso negli URL compatti (`compactTuning`): i 24 numerici
 * ad alta cardinalità non viaggiano nell'URL ma guidano il render server-side
 * (mapping > defaults). Senza firma, un cambio default lascerebbe URL identici
 * e browser/edge/Stremio servirebbero i byte vecchi all'infinito. FNV-1a 32bit
 * (8 hex): cache-buster, non sicurezza — niente import, funziona anche client.
 * Copre ESATTAMENTE i campi omessi in compact, con gli stessi fallback
 * dell'emissione esplicita qui sotto.
 */
function tuningSignature(input: StremioPosterParamsInput): string {
  const D = DEFAULT_STREMIO_POSTER_PARAMS
  const parts = [
    input.gradientHeight ?? D.gradientHeight,
    input.blurIntensity ?? D.blurIntensity,
    input.tintStrength ?? D.tintStrength,
    input.blurFade ?? D.blurFade,
    input.blurDarkness ?? D.blurDarkness,
    input.topShade ?? D.topShade,
    input.topBadgeScale ?? D.topBadgeScale,
    input.topBadgeOffsetX ?? D.topBadgeOffsetX,
    input.topBadgeOffsetY ?? D.topBadgeOffsetY,
    input.genreBadgeScale ?? D.genreBadgeScale,
    input.genreBadgeOffsetX ?? D.genreBadgeOffsetX,
    input.genreBadgeOffsetY ?? D.genreBadgeOffsetY,
    input.qualityBadgeScale ?? D.qualityBadgeScale,
    input.separateBadgeScale ?? getSeparateBadgeDefaultScale(input.separateRatingsStyle),
    input.separateBadgeOffsetX ?? D.separateBadgeOffsetX,
    input.separateBadgeOffsetY ?? D.separateBadgeOffsetY,
    input.qualityBadgeOffsetX ?? D.qualityBadgeOffsetX,
    input.qualityBadgeOffsetY ?? D.qualityBadgeOffsetY,
    input.networkLogoScale ?? D.networkLogoScale,
    input.networkLogoOffsetX ?? D.networkLogoOffsetX,
    input.networkLogoOffsetY ?? D.networkLogoOffsetY,
    input.logoScale ?? D.logoScale,
    input.logoOffsetX ?? D.logoOffsetX,
    input.logoOffsetY ?? D.logoOffsetY,
  ]
  let h = 0x811c9dc5
  const s = parts.join(",")
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, "0")
}

export function buildStremioPosterSearchParams(input: StremioPosterParamsInput): URLSearchParams {
  const params = new URLSearchParams()
  // Segui-spazio: solo identità + live + versione. Niente visuali, niente
  // lingua/shape fissi (li risolve il server), niente firma dv (nulla da
  // invalidare: l'URL è stabile, aggiorna la rivalidazione HTTP).
  if (input.followSpace) {
    if (input.config) params.set("config", input.config)
    if (input.user) params.set("u", input.user)
    params.set("live", "1")
    params.set("rv", String(POSTER_URL_VERSION))
    return params
  }
  const live = input.live ?? false
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
  if (input.config) {
    // Con token stateless il server applica query > mapping > config: un ON
    // per-titolo omesso perderebbe contro un master OFF del token mentre la
    // preview manda ON esplicito — emetti sempre esplicito (ON e OFF).
    params.set("badges", globalBadges ? "1" : "0")
    params.set("ranking", rankingBadges ? "1" : "0")
  } else {
    if (!globalBadges) params.set("badges", "0")
    if (!rankingBadges) params.set("ranking", "0")
  }
  if (input.badgeGenre === false) params.set("bg", "0")
  if (input.badgeYear === false) params.set("by", "0")
  if (input.badgeRating === false) params.set("br", "0")
  if (input.badgeQuality === false) params.set("bq", "0")
  const mq = parseMinQuality(input.minQuality ?? null)
  if (mq && mq !== "SD") params.set("qmin", mq)
  if (input.customRatings === false) params.set("cr", "0")
  if (input.separateRatings) params.set("sep", "1")
  // Stile normalizzato per formato noto (bar landscape → pills, come il
  // server); a formato ignoto (template Nuvio) si emette raw e normalizza il
  // server per formato effettivo. Raw salvati sempre intatti.
  const effSepStyle = input.shapeUnknown || input.posterShape !== "landscape"
    ? input.separateRatingsStyle
    : getSeparateRatingsStyleForShape(input.separateRatingsStyle ?? "column", "landscape")
  if (effSepStyle === "bottom-bar" || effSepStyle === "bottom-pills") {
    params.set("sepstyle", effSepStyle)
  }
  if (input.ratingSources && input.ratingSources.length > 0) params.set("rsrc", input.ratingSources.join(","))
  if (input.sashOrder && !isDefaultSashOrder(input.sashOrder)) {
    const parsed = parseSashOrder(input.sashOrder.join(","))
    if (parsed) params.set("sash", parsed.join(","))
  }
  if (input.customBadge) params.set("extra", input.customBadge)
  if (input.badgePresetId && BADGE_PRESET_ID_RE.test(input.badgePresetId)) {
    params.set("badgePreset", input.badgePresetId)
    if (input.badgePresetRev && BADGE_PRESET_REV_RE.test(input.badgePresetRev)) {
      params.set("prv", input.badgePresetRev)
    }
  }
  if (input.dateFormat && input.dateFormat !== "locale") {
    params.set("df", input.dateFormat)
  }
  if (input.title) params.set("title", input.title)
  if (!networkLogo) params.set("netLogo", "0")
  if (input.networkLogoPosition === "top") {
    params.set("netPos", "top")
  }
  if (input.preRelease) params.set("pre", "1")
  if (input.hideLogo) params.set("hideLogo", "1")
  if (input.ribbonSide === "right") params.set("side", "right")
  else if (input.ribbonSide === "left") params.set("side", "left")
  if (input.ribbonEnabled === false) params.set("ribbon", "0")
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
    // Ombra superiore solo quando diversa dal default: a 50 l'URL resta
    // identico al passato (la risolve il server).
    const ts = input.topShade ?? DEFAULT_STREMIO_POSTER_PARAMS.topShade
    if (ts !== DEFAULT_STREMIO_POSTER_PARAMS.topShade) params.set("ts", String(ts))
  }
  // dv: firma del tuning quando è omesso (compact) — senza, un cambio default
  // lascerebbe URL identici e cache stantie ovunque (browser/edge/Stremio).
  // Con tuning esplicito (template, ?config=) i valori invalidano da soli.
  if (input.compactTuning) params.set("dv", tuningSignature(input))
  params.set("bs", input.badgeStyle || DEFAULT_STREMIO_POSTER_PARAMS.badgeStyle)
  params.set("rs", input.rankingBadgeStyle || DEFAULT_STREMIO_POSTER_PARAMS.rankingBadgeStyle)
  // Standalone extra style: opt-in only (absent = legacy `rs` fallback,
  // existing Stremio URLs stay byte-identical). Low cardinality like bs/rs:
  // stays explicit in compact mode, never inside `dv`.
  if (input.extraBadgeStyle) params.set("xbs", input.extraBadgeStyle)
  // Font badge sempre esplicito (come bs/rs): assente ≠ default nella catena
  // query > mapping > config > defaults (un mapping salvato non-"inter"
  // vincerebbe sul default dello spazio senza il parametro).
  params.set("bfont", input.badgeFont || "inter")
  // Quality style only when non-standard: existing URLs stay identical
  // and the cache is not invalidated (the server resolves standard alone).
  if (input.qualityBadgeStyle === "mono" || input.qualityBadgeStyle === "color" || input.qualityBadgeStyle === "knockout") {
    params.set("qbs", input.qualityBadgeStyle)
  }
  if (input.videoFormats !== undefined && input.videoFormats !== null) {
    params.set("formats", input.videoFormats.length === 0 ? "none" : input.videoFormats.join(","))
  }
  if (!input.compactTuning) {
    params.set("tscale", String(input.topBadgeScale ?? DEFAULT_STREMIO_POSTER_PARAMS.topBadgeScale))
    params.set("tox", String(input.topBadgeOffsetX ?? DEFAULT_STREMIO_POSTER_PARAMS.topBadgeOffsetX))
    params.set("toy", String(input.topBadgeOffsetY ?? DEFAULT_STREMIO_POSTER_PARAMS.topBadgeOffsetY))
    params.set("gscale", String(input.genreBadgeScale ?? DEFAULT_STREMIO_POSTER_PARAMS.genreBadgeScale))
    params.set("gox", String(input.genreBadgeOffsetX ?? DEFAULT_STREMIO_POSTER_PARAMS.genreBadgeOffsetX))
    params.set("goy", String(input.genreBadgeOffsetY ?? DEFAULT_STREMIO_POSTER_PARAMS.genreBadgeOffsetY))
    params.set("qscale", String(input.qualityBadgeScale ?? DEFAULT_STREMIO_POSTER_PARAMS.qualityBadgeScale))
    params.set("sepscale", String(input.separateBadgeScale ?? getSeparateBadgeDefaultScale(input.separateRatingsStyle)))
    params.set("sepox", String(input.separateBadgeOffsetX ?? DEFAULT_STREMIO_POSTER_PARAMS.separateBadgeOffsetX))
    params.set("sepoy", String(input.separateBadgeOffsetY ?? DEFAULT_STREMIO_POSTER_PARAMS.separateBadgeOffsetY))
    params.set("qox", String(input.qualityBadgeOffsetX ?? DEFAULT_STREMIO_POSTER_PARAMS.qualityBadgeOffsetX))
    params.set("qoy", String(input.qualityBadgeOffsetY ?? DEFAULT_STREMIO_POSTER_PARAMS.qualityBadgeOffsetY))
    params.set("netscale", String(input.networkLogoScale ?? DEFAULT_STREMIO_POSTER_PARAMS.networkLogoScale))
    params.set("nox", String(input.networkLogoOffsetX ?? DEFAULT_STREMIO_POSTER_PARAMS.networkLogoOffsetX))
    params.set("noy", String(input.networkLogoOffsetY ?? DEFAULT_STREMIO_POSTER_PARAMS.networkLogoOffsetY))
  }
  params.set("rv", String(POSTER_URL_VERSION))
  if (live) params.set("live", "1")
  return params
}
