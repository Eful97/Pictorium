// ---------------------------------------------------------------------------
// Parsing della configurazione di resa (badge/blur/gradiente/logo) della route
// poster da query string + mapping + config token + server defaults.
// Estratto dalla route `/api/poster/[type]/[id]` per renderlo testabile in
// isolamento. Semantica identica all'originale — nessuna logica di rendering.
// ---------------------------------------------------------------------------

import type { PictoriumUserConfig } from "./config-token"
import { effectiveMappingForShape, type Mapping, type NetworkLogoPosition, type PosterShape } from "./types"
import { effectiveDefaultsForShape } from "./server-defaults"
import type { ServerDefaults } from "./server-defaults"
import { resolveLabelFor } from "./i18n"
import { resolveRatingSources } from "./ratings"
import { parseMinQuality, type StreamQuality } from "./quality-tiers"
import { parseSashOrder, normalizeSashOrder, DEFAULT_SASH_ORDER, type SashBucket } from "./badge-priority"
import {
  isBadgeStyle,
  isRankingBadgeStyle,
  isQualityBadgeStyle,
  nonRibbonRankingStyle,
  DEFAULT_BADGE_STYLE,
  DEFAULT_RANKING_BADGE_STYLE,
  DEFAULT_QUALITY_BADGE_STYLE,
  type BadgeStyle,
  type RankingBadgeStyle,
  type QualityBadgeStyle,
} from "./badge-styles"
import { NON_CLEAN_BLUR_FADE, NON_CLEAN_GRADIENT_HEIGHT } from "./gradient-defaults"

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * Formato canvas — precedenza: query `shape` > mapping salvato >
 * config token > server defaults > "poster". Solo "landscape" attiva il
 * ramo 16:9 (base = backdrop TMDB); "poster" e "square" (fallback esplicito
 * Nuvio: Pictorium non ha un canvas quadrato) selezionano il verticale.
 * Usato dalla route PRIMA del fetch (serve a scegliere la base) e dentro
 * resolvePosterRenderConfig per coerenza.
 */
export function resolvePosterShape(
  searchParams: URLSearchParams,
  mapping: Mapping | null,
  configOverride: PictoriumUserConfig | null,
  sd: ServerDefaults,
): PosterShape {
  const q = (searchParams.get("shape") || "").toLowerCase()
  if (q === "landscape") return "landscape"
  if (q === "poster" || q === "square") return "poster"
  // Placeholder Nuvio `{shape}` ricevuto senza sostituzione (o qualsiasi
  // valore non riconosciuto): nessun errore, vale il fallback sotto.
  if (mapping?.posterShape === "landscape" || mapping?.posterShape === "poster") return mapping.posterShape
  if (configOverride?.posterShape === "landscape" || configOverride?.posterShape === "poster") return configOverride.posterShape
  if (sd.posterShape === "landscape" || sd.posterShape === "poster") return sd.posterShape
  return "poster"
}

export interface PosterRenderConfigInput {
  searchParams: URLSearchParams
  mapping: Mapping | null
  configOverride: PictoriumUserConfig | null
  sd: ServerDefaults
  /** true se la richiesta fornisce poster/mapping espliciti (query o mapping salvato) */
  hasQuery: boolean
  showBadges: boolean
  rankingBadges: boolean
  /** segnali di classifica per l'auto-detect default→netflix */
  animeRank: number | null
  rankingResult: number | null
  finalRank: number | null
  /** lingua per la risoluzione delle label prefissate (__badge.*) — fix L32 */
  lang?: string
}

export interface PosterRenderConfig {
  badgeStyle: BadgeStyle
  rankingBadgeStyle: RankingBadgeStyle
  /** Stile icone del badge qualità (standard = pill testuale). */
  qualityBadgeStyle: QualityBadgeStyle
  blurEnabled: boolean
  blurHeight: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  /** Intensità tinta di scena 0-100 (default 20). */
  tintStrength: number
  /**
   * Ombra lineare superiore 0-100 (default 50). Catena completa come la tinta:
   * query `ts` > mapping per-titolo > config token > server defaults
   * (`PICTORIUM_TOP_SHADE`) > 50. Solo flat (vale per entrambi i canvas).
   */
  topShade: number
  badgesEnabled: boolean
  rankingEnabled: boolean
  /** Quali componenti del badge genere/rating mostrare (default tutti ON). */
  badgeGenre: boolean
  badgeYear: boolean
  badgeRating: boolean
  badgeQuality: boolean
  /** Soglia minima tier qualità streaming — catena: query `qmin` > server defaults > "SD". Globale (nessun per-titolo). */
  minQuality: StreamQuality
  /** Ordine/priorità sash — catena: query `sash` > server defaults > default. Globale (nessun per-titolo). */
  sashOrder: SashBucket[]
  /** Riga rating custom provider (display). Default ON quando il provider è configurato. */
  customRatings: boolean
  ratingSources: string[]
  /** Colonna rating separati a destra (sostituisce la media ★). Default OFF. Solo portrait (il gate è al sito d'uso). */
  separateRatings: boolean
  logoScale: number | null
  logoOffsetX: number | null
  logoOffsetY: number | null
  /** Scala % del badge superiore (default 100). Offset solo stili centrati. */
  topBadgeScale: number
  topBadgeOffsetX: number
  topBadgeOffsetY: number
  /** Scala % del badge genere/rating in basso (default 100). */
  genreBadgeScale: number
  /** Offset px del badge genere/rating, solo stili non-bar. */
  genreBadgeOffsetX: number
  genreBadgeOffsetY: number
  /** Scala % del badge qualità streaming (default 100). */
  qualityBadgeScale: number
  /** Offset px del badge qualità. */
  qualityBadgeOffsetX: number
  qualityBadgeOffsetY: number
  /** Scala % del logo network (default 100). */
  networkLogoScale: number
  /** Offset px del logo network. */
  networkLogoOffsetX: number
  networkLogoOffsetY: number
  queryExtra: string | null
  qNetLogo: string | null
  networkLogo: boolean
  /**
   * Posizione del logo network — catena: query `netPos` ("top", garbage =
   * auto) > mapping per-titolo > config token > server defaults > "auto"
   * (specchio dinamico odierno, byte-identico).
   */
  networkLogoPosition: NetworkLogoPosition
  ribbonSide: "left" | "right"
  /**
   * Nastro stile Netflix all'angolo — catena: query `ribbon` > mapping
   * per-titolo > config token > server defaults > true. Su false gli stili
   * nastro degradano all'equivalente centrato (mai nascosti).
   */
  ribbonEnabled: boolean
  /**
   * Tinta accent sul badge classifica centrato: true quando il nastro è OFF
   * e lo stile pre-degrado era "colored" (senza nastro deve colorare il
   * badge default come riempimento piatto). Col nastro ON è ininfluente
   * (lo stile "colored" colora già da sé).
   */
  rankingBadgeAccent: boolean
  /** Stato pre-digitale (darken + badge Coming Soon, solo film). Default OFF. */
  preRelease: boolean
  /** Formato canvas (query `shape` > mapping > config > defaults > "poster"). */
  posterShape: PosterShape
  /**
   * Nasconde il logo film dal composite (solo query `hideLogo`, default false).
   * Veicolo del banner pulito (i client che lo leggono sovrappongono già il
   * logo da catalogo: il baked-in creerebbe un doppione). Il fetch resta per
   * i colori accent.
   */
  hideLogo: boolean
  /**
   * Allineamento blocco logo/metadati — precedenza: query `align` > server
   * defaults > default di formato (landscape "left", poster "center").
   * Globale: nessun override per-titolo (il mapping non ha il campo).
   */
  logoAlign: "left" | "center"
}

export function resolvePosterRenderConfig(input: PosterRenderConfigInput): PosterRenderConfig {
  const { searchParams: q, mapping, configOverride, sd, hasQuery, showBadges, rankingBadges } = input

  // Ranking style — precedenza: query `rs` > mapping salvato > config token > server defaults > default.
  // (Coerente con `badgeStyle` sotto: la query vince sul mapping — M6 WYSIWYG.
  // Il sentinel "default" del mapping è trattato come "nessun override", identico
  // a come "shadow" lo è per badgeStyle.)
  const rawRs =
    q.get("rs") ||
    (mapping?.rankingBadgeStyle && mapping.rankingBadgeStyle !== "default" ? mapping.rankingBadgeStyle : undefined) ||
    configOverride?.rankingBadgeStyle ||
    sd.rankingBadgeStyle
  let rankingBadgeStyle: RankingBadgeStyle = isRankingBadgeStyle(rawRs) ? rawRs : DEFAULT_RANKING_BADGE_STYLE

  const qRankParam = q.get("rank")
  const hasRank = !!(input.animeRank || input.rankingResult || mapping?.badgeRank || mapping?.trendRank || qRankParam || input.finalRank)
  // Nastro stile Netflix — catena: query `ribbon=0/1` > mapping per-titolo >
  // config token > server defaults > true (ON storico). Su false gli stili
  // nastro degradano all'equivalente centrato (mai nascosti, WYSIWYG).
  const qRibbon = q.get("ribbon")
  const ribbonEnabled = qRibbon !== null
    ? qRibbon !== "0"
    : (mapping?.ribbonEnabled ?? configOverride?.ribbonEnabled ?? sd.ribbonEnabled ?? true)
  // "default" = auto-detect: mostra il badge stile Netflix se c'è un rank,
  // altrimenti badge standard. Se il sorgente (mapping/query/config) specifica
  // un valore esplicito (pill/colored/bordo/vetro/netflix), viene rispettato
  // senza override ("bar" rimosso: degrada a "default" via isRankingBadgeStyle).
  if (hasRank && rankingBadgeStyle === "default" && ribbonEnabled) {
    rankingBadgeStyle = "netflix"
  } else if (!hasRank && rankingBadgeStyle === "netflix") {
    rankingBadgeStyle = "default"
  }
  // Senza nastro il "colored" deve colorare il badge default (tinta accent
  // come riempimento piatto): il flag viaggia fino al builder, che colora
  // solo questo caso (i default scelti dall'utente restano satinati).
  let rankingBadgeAccent = false
  if (!ribbonEnabled) {
    rankingBadgeAccent = rankingBadgeStyle === "colored"
    rankingBadgeStyle = nonRibbonRankingStyle(rankingBadgeStyle)
  }

  // Formato canvas presto: serve al default del gradiente sotto (20% in
  // landscape per non annerire mezza scena). Stessa catena degli altri
  // parametri — vedi resolvePosterShape.
  const posterShape = resolvePosterShape(q, mapping, configOverride, sd)
  // Profili per-formato (dual format My Posters): in landscape il tuning
  // salvato in `mapping.landscape` vince sui campi flat chiave-per-chiave.
  // La catena query > mapping > config > defaults sotto resta invariata.
  const m = effectiveMappingForShape(mapping, posterShape)
  // Default sfumatura per formato (Impostazioni · Orizzontale): in landscape
  // il profilo server vince sui flat chiave-per-chiave. Solo le 5 chiavi
  // blur — i badge restano condivisi (flat) per scelta.
  const esd = effectiveDefaultsForShape(sd, posterShape)

  // Allineamento Cinematic: vale SOLO in landscape (i portrait restano
  // rigorosamente centrati per contratto — nessun parametro query o default
  // globale deve mai spostarli a sinistra).
  // In landscape: query `align=left|center` > server defaults > default "left".
  const qAlign = (q.get("align") || "").toLowerCase()
  const logoAlign: "left" | "center" = posterShape === "landscape"
    ? (qAlign === "left" || qAlign === "center"
        ? qAlign
        : (sd.logoAlign === "left" || sd.logoAlign === "center" ? sd.logoAlign : "left"))
    : "center"

  // Fix M3: includere i campi blur salvati nel mapping nella catena di fallback
  // (query > mapping > configOverride > default), come già fatto per badgeGenre/badgeStyle.
  // Prima il mapping salvato con blur custom non veniva mai applicato.
  // Percorso live (`live=1`, Segui-spazio): i parametri assenti seguono lo
  // spazio salvato (vedi badges/blur sotto). Dichiarata qui perché il primo
  // uso (blurEnabled) precede il blocco badges.
  const isLiveFollow = q.get("live") === "1"
  const blurEnabled = q.get("be") !== null
    ? q.get("be") !== "0"
    : (m?.blurEnabled != null ? m.blurEnabled : (configOverride !== null ? configOverride.blurEnabled : (isLiveFollow ? (esd.blurEnabled ?? true) : true)))
  // Clamp espliciti: impediscono a valori estremi (query o config) di arrivare a
  // sharp.blur con sigma enormi o gradienti fuori scala (potenziale DoS CPU).
  // Mapping non-clean senza valori congelati: default per tipo poster (come
  // l'editor all'apertura e gli URL Stremio), non i default globali. Vale solo
  // a language esplicita: i mapping storici senza campo restano sul globale.
  const mappingNonClean = m?.language != null
  const rawGradHeight = q.get("gradHeight") ? Number(q.get("gradHeight")) : NaN
  const blurHeight = Number.isFinite(rawGradHeight)
    ? clamp(rawGradHeight, 5, 100)
    : (m?.gradientHeight != null && Number.isFinite(m.gradientHeight)
        ? clamp(m.gradientHeight, 5, 100)
        : (configOverride !== null ? clamp(configOverride.gradientHeight, 5, 100) : (esd.gradientHeight != null && Number.isFinite(esd.gradientHeight) ? clamp(esd.gradientHeight, 5, 100) : (posterShape === "landscape" ? 20 : (mappingNonClean ? NON_CLEAN_GRADIENT_HEIGHT : 30)))))
  const rawBlur = q.get("blur") ? Number(q.get("blur")) : NaN
  const blurIntensity = Number.isFinite(rawBlur)
    ? clamp(rawBlur, 1, 100)
    : (m?.blurIntensity != null && Number.isFinite(m.blurIntensity)
        ? clamp(m.blurIntensity, 1, 100)
        : (configOverride !== null ? clamp(configOverride.blurIntensity, 1, 100) : (esd.blurIntensity != null && Number.isFinite(esd.blurIntensity) ? clamp(esd.blurIntensity, 1, 100) : 20)))
  // Fade di default: 70 in landscape, 50 nel portrait (look Naturale), 80
  // per i mapping non-clean senza valori congelati (profilo per tipo, come
  // l'altezza 20 — sync con stremio-poster-url e ramo Stremio unmapped).
  const rawBf = q.get("bf") ? Number(q.get("bf")) : NaN
  const blurFade = Number.isFinite(rawBf)
    ? clamp(rawBf, 0, 100)
    : (m?.blurFade != null && Number.isFinite(m.blurFade)
        ? clamp(m.blurFade, 0, 100)
        : (configOverride !== null ? clamp(configOverride.blurFade, 0, 100) : (esd.blurFade != null && Number.isFinite(esd.blurFade) ? clamp(esd.blurFade, 0, 100) : (posterShape === "landscape" ? 70 : (mappingNonClean ? NON_CLEAN_BLUR_FADE : 50)))))
  const rawBd = q.get("bd") ? Number(q.get("bd")) : NaN
  const blurDarkness = Number.isFinite(rawBd)
    ? clamp(rawBd, 0, 100)
    : (m?.blurDarkness != null && Number.isFinite(m.blurDarkness)
        ? clamp(m.blurDarkness, 0, 100)
        : (configOverride !== null ? clamp(configOverride.blurDarkness, 0, 100) : (esd.blurDarkness != null && Number.isFinite(esd.blurDarkness) ? clamp(esd.blurDarkness, 0, 100) : 30)))

  // Intensità tinta 0-100 — stessa catena (query > mapping.landscape >
  // mapping flat > config > defaults(.landscape) > 20). Vale per formato.
  const rawTint = q.get("tint") ? Number(q.get("tint")) : NaN
  const tintStrength = q.get("tint") !== null
    ? (Number.isFinite(rawTint) ? clamp(Math.round(rawTint), 0, 100) : 20)
    : (m?.tintStrength != null && Number.isFinite(m.tintStrength)
        ? clamp(Math.round(m.tintStrength), 0, 100)
        : (configOverride?.tintStrength != null && Number.isFinite(configOverride.tintStrength)
            ? clamp(Math.round(configOverride.tintStrength), 0, 100)
            : (esd.tintStrength != null && Number.isFinite(esd.tintStrength)
                ? clamp(Math.round(esd.tintStrength), 0, 100)
                : 20)))

  // Ombra superiore 0-100 — catena completa (query > mapping.landscape >
  // mapping flat > config > defaults(.landscape) > 50). Stessi clamp anti-DoS.
  const rawTs = q.get("ts") ? Number(q.get("ts")) : NaN
  const topShade = q.get("ts") !== null
    ? (Number.isFinite(rawTs) ? clamp(Math.round(rawTs), 0, 100) : 50)
    : (m?.topShade != null && Number.isFinite(m.topShade)
        ? clamp(Math.round(m.topShade), 0, 100)
        : (configOverride?.topShade != null && Number.isFinite(configOverride.topShade)
            ? clamp(Math.round(configOverride.topShade), 0, 100)
            : (esd.topShade != null && Number.isFinite(esd.topShade)
                ? clamp(Math.round(esd.topShade), 0, 100)
                : 50)))

  const qBadges = q.get("badges")
  const qRanking = q.get("ranking")
  // OFF/ON espliciti in query vincono sempre (anche su titolo non salvato
  // senza token): senza, badges=0/ranking=0 venivano ignorati (hasQuery false).
  // Percorso live (`live=1`, Segui-spazio): il parametro assente segue lo
  // spazio (mapping > config > sd), non il default ON — altrimenti un `false`
  // salvato diventerebbe `true`. Fuori dal live, comportamento invariato.
  const badgesEnabled = qBadges !== null
    ? qBadges !== "0"
    : (isLiveFollow
      ? (mapping?.showBadges ?? configOverride?.globalBadges ?? sd.globalBadges ?? showBadges)
      : (hasQuery
      ? (configOverride !== null
        ? configOverride.globalBadges
        : showBadges)
      : true))
  const rankingEnabled = qRanking !== null
    ? qRanking !== "0"
    : (isLiveFollow
      ? (mapping?.rankingBadges ?? configOverride?.rankingBadges ?? sd.rankingBadges ?? rankingBadges)
      : (hasQuery
      ? (configOverride !== null
        ? configOverride.rankingBadges
        : rankingBadges)
      : true))

  // Componenti badge genere/rating — precedenza: query `bg/by/br` > mapping salvato
  // > config token/profilo > server defaults > true (tutti ON di default).
  const qBg = q.get("bg")
  const qBy = q.get("by")
  const qBr = q.get("br")
  const qBq = q.get("bq")
  const badgeGenre = qBg !== null ? qBg !== "0" : (mapping?.badgeGenre ?? configOverride?.badgeGenre ?? sd.badgeGenre ?? true)
  const badgeYear = qBy !== null ? qBy !== "0" : (mapping?.badgeYear ?? configOverride?.badgeYear ?? sd.badgeYear ?? true)
  const badgeRating = qBr !== null ? qBr !== "0" : (mapping?.badgeRating ?? configOverride?.badgeRating ?? sd.badgeRating ?? true)
  const badgeQuality = qBq !== null ? qBq !== "0" : (mapping?.badgeQuality ?? configOverride?.badgeQuality ?? sd.badgeQuality ?? true)

  // Soglia minima qualità streaming — globale: query `qmin` > server defaults
  // > "SD" (tutto mostrato). Valori non validi → default. Nessun override
  // per-titolo/config in Fase 1 (il mapping non ha il campo).
  const minQuality: StreamQuality = parseMinQuality(q.get("qmin")) ?? parseMinQuality(sd.minQuality ?? null) ?? "SD"

  // Ordine sash — globale: query `sash` (sottoinsieme ordinato, non listati =
  // spenti) > server defaults > default. Token non validi ignorati, mai garbage.
  const sashOrder: SashBucket[] = parseSashOrder(q.get("sash"))
    ?? normalizeSashOrder(sd.sashOrder) ?? [...DEFAULT_SASH_ORDER]

  // Riga rating custom provider (display) — precedenza: query `cr` > mapping
  // salvato > config token/profilo > server defaults > true (ON di default).
  // L'effettivo rendering richiede comunque il provider configurato (env).
  const qCr = q.get("cr")
  const customRatings = qCr !== null ? qCr !== "0" : (mapping?.customRatings ?? configOverride?.customRatings ?? sd.customRatings ?? true)

  // Fonti voto medio ★ — catena canonica: query `rsrc` > mapping per-titolo >
  // config token > server defaults > imdb+tmdb. Stessa dell'URL Stremio.
  const ratingSources: string[] = resolveRatingSources(
    q.get("rsrc"),
    mapping?.ratingSources,
    configOverride?.ratingSources,
    sd.ratingSources,
  )

  // Colonna rating separati — stessa catena (query `sep` > mapping > config >
  // server defaults > false). Vale per entrambi i canvas: la colonna segue
  // il badge qualità anche in landscape.
  const qSep = q.get("sep")
  const separateRatings = qSep !== null ? qSep !== "0" : (mapping?.separateRatings ?? configOverride?.separateRatings ?? sd.separateRatings ?? false)

  // Badge style — confinamento della query string al union type: valori non validi
  // cadono sul default (il renderer in passato li trattava come "shadow" nel ramo else).
  // Vale per entrambi i formati (i default per-formato scelgono lo stile landscape).
  const rawBs = q.get("bs")
    || (mapping?.badgeStyle && mapping.badgeStyle !== "shadow" ? mapping.badgeStyle : undefined)
    || configOverride?.badgeStyle
    || sd.badgeStyle
  let badgeStyle: BadgeStyle = isBadgeStyle(rawBs) ? rawBs : DEFAULT_BADGE_STYLE
  // Stile "bar" non disponibile in landscape (full-width incoerente con
  // l'ancoraggio basso-destra 16:9): degrada a shadow come il ranking bar
  // degrada a default. Vale per preview e Stremio (stesso endpoint).
  if (posterShape === "landscape" && badgeStyle === "bar") badgeStyle = DEFAULT_BADGE_STYLE

  // Stile icone qualità — catena: query `qbs` > mapping salvato >
  // config token > server defaults > "standard". Valori non validi → standard.
  const rawQbs = q.get("qbs")
    || mapping?.qualityBadgeStyle
    || configOverride?.qualityBadgeStyle
    || sd.qualityBadgeStyle
  const qualityBadgeStyle: QualityBadgeStyle = isQualityBadgeStyle(rawQbs) ? rawQbs : DEFAULT_QUALITY_BADGE_STYLE

  const qScale = q.get("scale")
  const qOx = q.get("ox")
  const qOy = q.get("oy")
  // Bound anti-DoS (R1): scale fuori 10..200 arrivava a resizeLogoCached con
  // dimensioni assurde (sharp OOM); scale negativa addirittura crashava il
  // resize → 500 permanente. `scale=0`/non-numerico resta null come prima.
  const qScaleNum = qScale ? Number(qScale) : NaN
  // Catena: query esplicita > mapping salvato > default globali (Orizzontale
  // in landscape) > auto-fit per aspect (null). I default globali null
  // equivalgono ad assenti (auto-fit preserved).
  const logoScale = qScale
    ? (Number.isFinite(qScaleNum) && qScaleNum !== 0 ? clamp(Math.round(qScaleNum), 10, 200) : null)
    : (m?.logoScale ?? esd.logoScale ?? null)
  // Offset: clamp ±2000px (oltre è comunque fuori canvas). A differenza di
  // prima, `ox=0` esplicito vince sul mapping (0 reale invece di null).
  // Offset logo: query esplicita > mapping salvato > default globali
  // (Orizzontale nel formato). Null = nessun nudge utente: la calibrazione
  // geometrica (+10/-10 in landscape) vive nel renderer, invisibile ai param.
  const qOxNum = qOx ? Number(qOx) : NaN
  const logoOffsetX = qOx
    ? (Number.isFinite(qOxNum) ? clamp(Math.round(qOxNum), -2000, 2000) : null)
    : (m?.logoOffsetX ?? esd.logoOffsetX ?? null)
  const qOyNum = qOy ? Number(qOy) : NaN
  const logoOffsetY = qOy
    ? (Number.isFinite(qOyNum) ? clamp(Math.round(qOyNum), -2000, 2000) : null)
    : (m?.logoOffsetY ?? esd.logoOffsetY ?? null)

  // Badge superiore — stessa catena di blur/gradient (query > mapping > config
  // > server defaults > default), stessi bound del logo (scala %, offset px).
  const qTScaleNum = q.get("tscale") ? Number(q.get("tscale")) : NaN
  const topBadgeScale = q.get("tscale") !== null
    ? (Number.isFinite(qTScaleNum) && qTScaleNum !== 0 ? clamp(Math.round(qTScaleNum), 10, 200) : 100)
    : (m?.topBadgeScale != null && Number.isFinite(m.topBadgeScale)
        ? clamp(Math.round(m.topBadgeScale), 10, 200)
        : (configOverride?.topBadgeScale != null && Number.isFinite(configOverride.topBadgeScale)
            ? clamp(Math.round(configOverride.topBadgeScale), 10, 200)
            : (esd.topBadgeScale != null && Number.isFinite(esd.topBadgeScale)
                ? clamp(Math.round(esd.topBadgeScale), 10, 200)
                : 100)))
  const qToxNum = q.get("tox") ? Number(q.get("tox")) : NaN
  const topBadgeOffsetX = q.get("tox") !== null
    ? (Number.isFinite(qToxNum) ? clamp(Math.round(qToxNum), -2000, 2000) : 0)
    : (m?.topBadgeOffsetX ?? configOverride?.topBadgeOffsetX ?? esd.topBadgeOffsetX ?? 0)
  const qToyNum = q.get("toy") ? Number(q.get("toy")) : NaN
  const topBadgeOffsetY = q.get("toy") !== null
    ? (Number.isFinite(qToyNum) ? clamp(Math.round(qToyNum), -2000, 2000) : 0)
    : (m?.topBadgeOffsetY ?? configOverride?.topBadgeOffsetY ?? esd.topBadgeOffsetY ?? 0)

  // Badge genere/rating in basso — stessa catena (query > mapping > config >
  // server defaults > default), stessi bound della scala (%, 10..200).
  const qGScaleNum = q.get("gscale") ? Number(q.get("gscale")) : NaN
  const genreBadgeScale = q.get("gscale") !== null
    ? (Number.isFinite(qGScaleNum) && qGScaleNum !== 0 ? clamp(Math.round(qGScaleNum), 10, 200) : 100)
    : (m?.genreBadgeScale != null && Number.isFinite(m.genreBadgeScale)
        ? clamp(Math.round(m.genreBadgeScale), 10, 200)
        : (configOverride?.genreBadgeScale != null && Number.isFinite(configOverride.genreBadgeScale)
            ? clamp(Math.round(configOverride.genreBadgeScale), 10, 200)
            : (esd.genreBadgeScale != null && Number.isFinite(esd.genreBadgeScale)
                ? clamp(Math.round(esd.genreBadgeScale), 10, 200)
                : 100)))

  // Offset badge genere — stessa catena, clamp px come il logo.
  const qGoxNum = q.get("gox") ? Number(q.get("gox")) : NaN
  const genreBadgeOffsetX = q.get("gox") !== null
    ? (Number.isFinite(qGoxNum) ? clamp(Math.round(qGoxNum), -2000, 2000) : 0)
    : (m?.genreBadgeOffsetX ?? configOverride?.genreBadgeOffsetX ?? esd.genreBadgeOffsetX ?? 0)
  const qGoyNum = q.get("goy") ? Number(q.get("goy")) : NaN
  const genreBadgeOffsetY = q.get("goy") !== null
    ? (Number.isFinite(qGoyNum) ? clamp(Math.round(qGoyNum), -2000, 2000) : 0)
    : (m?.genreBadgeOffsetY ?? configOverride?.genreBadgeOffsetY ?? esd.genreBadgeOffsetY ?? 0)

  // Badge qualità streaming — stessa catena, stessi bound (%, 10..200).
  const qQScaleNum = q.get("qscale") ? Number(q.get("qscale")) : NaN
  const qualityBadgeScale = q.get("qscale") !== null
    ? (Number.isFinite(qQScaleNum) && qQScaleNum !== 0 ? clamp(Math.round(qQScaleNum), 10, 200) : 100)
    : (m?.qualityBadgeScale != null && Number.isFinite(m.qualityBadgeScale)
        ? clamp(Math.round(m.qualityBadgeScale), 10, 200)
        : (configOverride?.qualityBadgeScale != null && Number.isFinite(configOverride.qualityBadgeScale)
            ? clamp(Math.round(configOverride.qualityBadgeScale), 10, 200)
            : (esd.qualityBadgeScale != null && Number.isFinite(esd.qualityBadgeScale)
                ? clamp(Math.round(esd.qualityBadgeScale), 10, 200)
                : 100)))

  // Offset badge qualità — stessa catena, clamp px come il logo.
  const qQoxNum = q.get("qox") ? Number(q.get("qox")) : NaN
  const qualityBadgeOffsetX = q.get("qox") !== null
    ? (Number.isFinite(qQoxNum) ? clamp(Math.round(qQoxNum), -2000, 2000) : 0)
    : (m?.qualityBadgeOffsetX ?? configOverride?.qualityBadgeOffsetX ?? esd.qualityBadgeOffsetX ?? 0)
  const qQoyNum = q.get("qoy") ? Number(q.get("qoy")) : NaN
  const qualityBadgeOffsetY = q.get("qoy") !== null
    ? (Number.isFinite(qQoyNum) ? clamp(Math.round(qQoyNum), -2000, 2000) : 0)
    : (m?.qualityBadgeOffsetY ?? configOverride?.qualityBadgeOffsetY ?? esd.qualityBadgeOffsetY ?? 0)

  // Logo network — stessa catena, stessi bound (%, 10..200).
  const qNScaleNum = q.get("netscale") ? Number(q.get("netscale")) : NaN
  const networkLogoScale = q.get("netscale") !== null
    ? (Number.isFinite(qNScaleNum) && qNScaleNum !== 0 ? clamp(Math.round(qNScaleNum), 10, 200) : 100)
    : (m?.networkLogoScale != null && Number.isFinite(m.networkLogoScale)
        ? clamp(Math.round(m.networkLogoScale), 10, 200)
        : (configOverride?.networkLogoScale != null && Number.isFinite(configOverride.networkLogoScale)
            ? clamp(Math.round(configOverride.networkLogoScale), 10, 200)
            : (esd.networkLogoScale != null && Number.isFinite(esd.networkLogoScale)
                ? clamp(Math.round(esd.networkLogoScale), 10, 200)
                : 100)))

  // Offset logo network — stessa catena, clamp px come il logo.
  const qNoxNum = q.get("nox") ? Number(q.get("nox")) : NaN
  const networkLogoOffsetX = q.get("nox") !== null
    ? (Number.isFinite(qNoxNum) ? clamp(Math.round(qNoxNum), -2000, 2000) : 0)
    : (m?.networkLogoOffsetX ?? configOverride?.networkLogoOffsetX ?? esd.networkLogoOffsetX ?? 0)
  const qNoyNum = q.get("noy") ? Number(q.get("noy")) : NaN
  const networkLogoOffsetY = q.get("noy") !== null
    ? (Number.isFinite(qNoyNum) ? clamp(Math.round(qNoyNum), -2000, 2000) : 0)
    : (m?.networkLogoOffsetY ?? configOverride?.networkLogoOffsetY ?? esd.networkLogoOffsetY ?? 0)

  // Fix L32: le label prefissate (__badge.*) vengono risolte con la lingua
  // della richiesta — prima un customBadge "__badge.anime" dal config token
  // arrivava letterale al renderer (la preview invece la risolveva → desync).
  const rawExtra = q.get("extra") || configOverride?.customBadge || null
  const queryExtra = rawExtra ? resolveLabelFor(rawExtra, input.lang || "it") : null
  const rawNetLogo = q.get("netLogo")
  const networkLogo: boolean = rawNetLogo !== null
    ? rawNetLogo !== "0"
    : (mapping?.networkLogo ?? (configOverride !== null ? configOverride.networkLogo : undefined) ?? sd.networkLogo ?? true)
  const qNetLogo = networkLogo ? (rawNetLogo ?? (configOverride !== null ? (configOverride.networkLogo ? "1" : null) : null)) : "0"
  // Posizione logo network: query esplicita (`top` o `auto`) vince sempre;
  // poi il valore salvato per-titolo (anche `auto`), poi config token, poi
  // server defaults. Assente o garbage cade al livello successivo della catena.
  const qNetPosRaw = q.get("netPos")
  const qNetPosNorm = (qNetPosRaw || "").toLowerCase()
  const savedNetPos = mapping?.networkLogoPosition === "top" || mapping?.networkLogoPosition === "auto"
    ? mapping.networkLogoPosition
    : null
  const configNetPos = configOverride?.networkLogoPosition === "top" || configOverride?.networkLogoPosition === "auto"
    ? configOverride.networkLogoPosition
    : null
  const networkLogoPosition: NetworkLogoPosition = qNetPosNorm === "top"
    ? "top"
    : qNetPosNorm === "auto"
      ? "auto"
      : (savedNetPos ?? configNetPos ?? (sd.networkLogoPosition === "top" ? "top" : "auto"))
  // Modalità layout nastro Netflix + logo network: query `side=right` (Stremio)
  // o `side=left` (Nuvio), poi config/profilo. Globale: nessun override
  // per-titolo (il mapping storico con ribbonSide viene ignorato).
  const qSide = q.get("side")
  const ribbonSide: "left" | "right" = qSide === "right"
    ? "right"
    : qSide === "left"
      ? "left"
      : ((configOverride?.ribbonSide ?? (isLiveFollow ? sd.ribbonSide : undefined)) === "right" ? "right" : "left")

  // Pre-release pre-digitale (solo film): query `pre` > config token > server
  // defaults > false. Globale, nessun override per-titolo.
  const qPre = q.get("pre")
  const preRelease = qPre !== null ? qPre !== "0" : (configOverride?.preRelease ?? sd.preRelease ?? false)

  // Nascondi logo film: solo query `hideLogo=1` (banner Nuvio), default false.
  // Nessuna catena mapping/config: non esiste il concetto per-titolo/globale.
  const qHideLogo = q.get("hideLogo")
  const hideLogo = qHideLogo !== null ? qHideLogo !== "0" : false

  return {
    badgeStyle,
    rankingBadgeStyle,
    qualityBadgeStyle,
    blurEnabled,
    blurHeight,
    blurIntensity,
    blurFade,
    blurDarkness,
    tintStrength,
    topShade,
    badgesEnabled,
    rankingEnabled,
    badgeGenre,
    badgeYear,
    badgeRating,
    badgeQuality,
    minQuality,
    sashOrder,
    customRatings,
    ratingSources,
    separateRatings,
    logoScale,
    logoOffsetX,
    logoOffsetY,
    topBadgeScale,
    topBadgeOffsetX,
    topBadgeOffsetY,
    genreBadgeScale,
    qualityBadgeScale,
    genreBadgeOffsetX,
    genreBadgeOffsetY,
    qualityBadgeOffsetX,
    qualityBadgeOffsetY,
    networkLogoScale,
    networkLogoOffsetX,
    networkLogoOffsetY,
    queryExtra,
    qNetLogo,
    networkLogo,
    networkLogoPosition,
    ribbonSide,
    ribbonEnabled,
    rankingBadgeAccent,
    preRelease,
    posterShape,
    logoAlign,
    hideLogo,
  }
}
