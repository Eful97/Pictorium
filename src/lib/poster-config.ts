// ---------------------------------------------------------------------------
// Parsing della configurazione di resa (badge/blur/gradiente/logo) della route
// poster da query string + mapping + config token + server defaults.
// Estratto dalla route `/api/poster/[type]/[id]` per renderlo testabile in
// isolamento. Semantica identica all'originale — nessuna logica di rendering.
// ---------------------------------------------------------------------------

import type { PictoriumUserConfig } from "./config-token"
import { effectiveMappingForShape, type Mapping, type PosterShape } from "./types"
import type { ServerDefaults } from "./server-defaults"
import { resolveLabelFor } from "./i18n"
import { resolveRatingSources } from "./ratings"
import { parseMinQuality, type StreamQuality } from "./quality-tiers"
import { parseSashOrder, normalizeSashOrder, DEFAULT_SASH_ORDER, type SashBucket } from "./badge-priority"
import {
  isBadgeStyle,
  isRankingBadgeStyle,
  DEFAULT_BADGE_STYLE,
  DEFAULT_RANKING_BADGE_STYLE,
  type BadgeStyle,
  type RankingBadgeStyle,
} from "./badge-styles"
import { NON_CLEAN_GRADIENT_HEIGHT, NON_CLEAN_BLUR_FADE } from "./gradient-defaults"

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

/**
 * Formato canvas — precedenza: query `shape` > mapping salvato >
 * config token > server defaults > "poster". Solo "landscape" attiva il
 * ramo 16:9 (base = backdrop TMDB); qualsiasi altro valore → portrait.
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
  if (q === "poster") return "poster"
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
  blurEnabled: boolean
  blurHeight: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  /** Intensità tinta di scena 0-100 (default 20). */
  tintStrength: number
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
  ribbonSide: "left" | "right"
  /** Stato pre-digitale (darken + badge Coming Soon, solo film). Default OFF. */
  preRelease: boolean
  /** Formato canvas (query `shape` > mapping > config > defaults > "poster"). */
  posterShape: PosterShape
  /**
   * Nasconde il logo film dal composite (solo query `hideLogo`, default false).
   * Veicolo del banner Nuvio: Nuvio sovrappone già il logo da catalogo, il
   * baked-in creerebbe un doppione. Il fetch resta per i colori accent.
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
  // "default" = auto-detect: mostra il badge stile Netflix se c'è un rank,
  // altrimenti badge standard. Se il sorgente (mapping/query/config) specifica
  // un valore esplicito (pill/colored/bordo/vetro/netflix), viene rispettato
  // senza override ("bar" rimosso: degrada a "default" via isRankingBadgeStyle).
  if (hasRank && rankingBadgeStyle === "default") {
    rankingBadgeStyle = "netflix"
  } else if (!hasRank && rankingBadgeStyle === "netflix") {
    rankingBadgeStyle = "default"
  }

  // Formato canvas presto: serve al default del gradiente sotto (20% in
  // landscape per non annerire mezza scena). Stessa catena degli altri
  // parametri — vedi resolvePosterShape.
  const posterShape = resolvePosterShape(q, mapping, configOverride, sd)
  // Profili per-formato (dual format My Posters): in landscape il tuning
  // salvato in `mapping.landscape` vince sui campi flat chiave-per-chiave.
  // La catena query > mapping > config > defaults sotto resta invariata.
  const m = effectiveMappingForShape(mapping, posterShape)

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
  const blurEnabled = q.get("be") !== null
    ? q.get("be") !== "0"
    : (m?.blurEnabled != null ? m.blurEnabled : (configOverride !== null ? configOverride.blurEnabled : true))
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
        : (configOverride !== null ? clamp(configOverride.gradientHeight, 5, 100) : (sd.gradientHeight != null && Number.isFinite(sd.gradientHeight) ? clamp(sd.gradientHeight, 5, 100) : (posterShape === "landscape" ? 20 : (mappingNonClean ? NON_CLEAN_GRADIENT_HEIGHT : 30)))))
  const rawBlur = q.get("blur") ? Number(q.get("blur")) : NaN
  const blurIntensity = Number.isFinite(rawBlur)
    ? clamp(rawBlur, 1, 100)
    : (m?.blurIntensity != null && Number.isFinite(m.blurIntensity)
        ? clamp(m.blurIntensity, 1, 100)
        : (configOverride !== null ? clamp(configOverride.blurIntensity, 1, 100) : (sd.blurIntensity != null && Number.isFinite(sd.blurIntensity) ? clamp(sd.blurIntensity, 1, 100) : 20)))
  const rawBf = q.get("bf") ? Number(q.get("bf")) : NaN
  const blurFade = Number.isFinite(rawBf)
    ? clamp(rawBf, 0, 100)
    : (m?.blurFade != null && Number.isFinite(m.blurFade)
        ? clamp(m.blurFade, 0, 100)
        : (configOverride !== null ? clamp(configOverride.blurFade, 0, 100) : (sd.blurFade != null && Number.isFinite(sd.blurFade) ? clamp(sd.blurFade, 0, 100) : (posterShape === "landscape" ? 70 : (mappingNonClean ? NON_CLEAN_BLUR_FADE : 50)))))
  const rawBd = q.get("bd") ? Number(q.get("bd")) : NaN
  const blurDarkness = Number.isFinite(rawBd)
    ? clamp(rawBd, 0, 100)
    : (m?.blurDarkness != null && Number.isFinite(m.blurDarkness)
        ? clamp(m.blurDarkness, 0, 100)
        : (configOverride !== null ? clamp(configOverride.blurDarkness, 0, 100) : (sd.blurDarkness != null && Number.isFinite(sd.blurDarkness) ? clamp(sd.blurDarkness, 0, 100) : 30)))

  // Intensità tinta 0-100 — stessa catena (query > mapping > config >
  // server defaults > 20). Nessun profilo landscape dedicato: vale per
  // entrambi i canvas (vedi types.ts).
  const rawTint = q.get("tint") ? Number(q.get("tint")) : NaN
  const tintStrength = q.get("tint") !== null
    ? (Number.isFinite(rawTint) ? clamp(Math.round(rawTint), 0, 100) : 20)
    : (m?.tintStrength != null && Number.isFinite(m.tintStrength)
        ? clamp(Math.round(m.tintStrength), 0, 100)
        : (configOverride?.tintStrength != null && Number.isFinite(configOverride.tintStrength)
            ? clamp(Math.round(configOverride.tintStrength), 0, 100)
            : (sd.tintStrength != null && Number.isFinite(sd.tintStrength)
                ? clamp(Math.round(sd.tintStrength), 0, 100)
                : 20)))

  const qBadges = q.get("badges")
  const qRanking = q.get("ranking")
  const badgesEnabled = hasQuery ? (qBadges !== null ? qBadges !== "0" : (configOverride !== null ? configOverride.globalBadges : showBadges)) : true
  const rankingEnabled = hasQuery ? (qRanking !== null ? qRanking !== "0" : (configOverride !== null ? configOverride.rankingBadges : rankingBadges)) : true

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
  // server defaults > false). Il gate portrait-only è al sito d'uso (route):
  // qui il flag resta puro per preview/WYSIWYG.
  const qSep = q.get("sep")
  const separateRatings = qSep !== null ? qSep !== "0" : (mapping?.separateRatings ?? configOverride?.separateRatings ?? sd.separateRatings ?? false)

  // Badge style — confinamento della query string al union type: valori non validi
  // cadono sul default (il renderer in passato li trattava come "shadow" nel ramo else).
  // In landscape vale SOLO il default (shadow): gli altri stili sono disegnati
  // per il 2:3 e sul 16:9 risultano osceni — per ora forzato, non rimosso
  // (il contratto bs= resta valido in portrait).
  const rawBs = q.get("bs")
    || (mapping?.badgeStyle && mapping.badgeStyle !== "shadow" ? mapping.badgeStyle : undefined)
    || configOverride?.badgeStyle
    || sd.badgeStyle
  const badgeStyle: BadgeStyle = posterShape === "landscape"
    ? DEFAULT_BADGE_STYLE
    : (isBadgeStyle(rawBs) ? rawBs : DEFAULT_BADGE_STYLE)

  const qScale = q.get("scale")
  const qOx = q.get("ox")
  const qOy = q.get("oy")
  // Bound anti-DoS (R1): scale fuori 10..200 arrivava a resizeLogoCached con
  // dimensioni assurde (sharp OOM); scale negativa addirittura crashava il
  // resize → 500 permanente. `scale=0`/non-numerico resta null come prima.
  const qScaleNum = qScale ? Number(qScale) : NaN
  const logoScale = qScale
    ? (Number.isFinite(qScaleNum) && qScaleNum !== 0 ? clamp(Math.round(qScaleNum), 10, 200) : null)
    : m?.logoScale ?? null
  // Offset: clamp ±2000px (oltre è comunque fuori canvas). A differenza di
  // prima, `ox=0` esplicito vince sul mapping (0 reale invece di null).
  const qOxNum = qOx ? Number(qOx) : NaN
  const logoOffsetX = qOx
    ? (Number.isFinite(qOxNum) ? clamp(Math.round(qOxNum), -2000, 2000) : null)
    : m?.logoOffsetX ?? null
  const qOyNum = qOy ? Number(qOy) : NaN
  const logoOffsetY = qOy
    ? (Number.isFinite(qOyNum) ? clamp(Math.round(qOyNum), -2000, 2000) : null)
    : m?.logoOffsetY ?? null

  // Badge superiore — stessa catena di blur/gradient (query > mapping > config
  // > server defaults > default), stessi bound del logo (scala %, offset px).
  const qTScaleNum = q.get("tscale") ? Number(q.get("tscale")) : NaN
  const topBadgeScale = q.get("tscale") !== null
    ? (Number.isFinite(qTScaleNum) && qTScaleNum !== 0 ? clamp(Math.round(qTScaleNum), 10, 200) : 100)
    : (m?.topBadgeScale != null && Number.isFinite(m.topBadgeScale)
        ? clamp(Math.round(m.topBadgeScale), 10, 200)
        : (configOverride?.topBadgeScale != null && Number.isFinite(configOverride.topBadgeScale)
            ? clamp(Math.round(configOverride.topBadgeScale), 10, 200)
            : (sd.topBadgeScale != null && Number.isFinite(sd.topBadgeScale)
                ? clamp(Math.round(sd.topBadgeScale), 10, 200)
                : 100)))
  const qToxNum = q.get("tox") ? Number(q.get("tox")) : NaN
  const topBadgeOffsetX = q.get("tox") !== null
    ? (Number.isFinite(qToxNum) ? clamp(Math.round(qToxNum), -2000, 2000) : 0)
    : (m?.topBadgeOffsetX ?? configOverride?.topBadgeOffsetX ?? sd.topBadgeOffsetX ?? 0)
  const qToyNum = q.get("toy") ? Number(q.get("toy")) : NaN
  const topBadgeOffsetY = q.get("toy") !== null
    ? (Number.isFinite(qToyNum) ? clamp(Math.round(qToyNum), -2000, 2000) : 0)
    : (m?.topBadgeOffsetY ?? configOverride?.topBadgeOffsetY ?? sd.topBadgeOffsetY ?? 0)

  // Badge genere/rating in basso — stessa catena (query > mapping > config >
  // server defaults > default), stessi bound della scala (%, 10..200).
  const qGScaleNum = q.get("gscale") ? Number(q.get("gscale")) : NaN
  const genreBadgeScale = q.get("gscale") !== null
    ? (Number.isFinite(qGScaleNum) && qGScaleNum !== 0 ? clamp(Math.round(qGScaleNum), 10, 200) : 100)
    : (m?.genreBadgeScale != null && Number.isFinite(m.genreBadgeScale)
        ? clamp(Math.round(m.genreBadgeScale), 10, 200)
        : (configOverride?.genreBadgeScale != null && Number.isFinite(configOverride.genreBadgeScale)
            ? clamp(Math.round(configOverride.genreBadgeScale), 10, 200)
            : (sd.genreBadgeScale != null && Number.isFinite(sd.genreBadgeScale)
                ? clamp(Math.round(sd.genreBadgeScale), 10, 200)
                : 100)))

  // Offset badge genere — stessa catena, clamp px come il logo.
  const qGoxNum = q.get("gox") ? Number(q.get("gox")) : NaN
  const genreBadgeOffsetX = q.get("gox") !== null
    ? (Number.isFinite(qGoxNum) ? clamp(Math.round(qGoxNum), -2000, 2000) : 0)
    : (m?.genreBadgeOffsetX ?? configOverride?.genreBadgeOffsetX ?? sd.genreBadgeOffsetX ?? 0)
  const qGoyNum = q.get("goy") ? Number(q.get("goy")) : NaN
  const genreBadgeOffsetY = q.get("goy") !== null
    ? (Number.isFinite(qGoyNum) ? clamp(Math.round(qGoyNum), -2000, 2000) : 0)
    : (m?.genreBadgeOffsetY ?? configOverride?.genreBadgeOffsetY ?? sd.genreBadgeOffsetY ?? 0)

  // Badge qualità streaming — stessa catena, stessi bound (%, 10..200).
  const qQScaleNum = q.get("qscale") ? Number(q.get("qscale")) : NaN
  const qualityBadgeScale = q.get("qscale") !== null
    ? (Number.isFinite(qQScaleNum) && qQScaleNum !== 0 ? clamp(Math.round(qQScaleNum), 10, 200) : 100)
    : (m?.qualityBadgeScale != null && Number.isFinite(m.qualityBadgeScale)
        ? clamp(Math.round(m.qualityBadgeScale), 10, 200)
        : (configOverride?.qualityBadgeScale != null && Number.isFinite(configOverride.qualityBadgeScale)
            ? clamp(Math.round(configOverride.qualityBadgeScale), 10, 200)
            : (sd.qualityBadgeScale != null && Number.isFinite(sd.qualityBadgeScale)
                ? clamp(Math.round(sd.qualityBadgeScale), 10, 200)
                : 100)))

  // Offset badge qualità — stessa catena, clamp px come il logo.
  const qQoxNum = q.get("qox") ? Number(q.get("qox")) : NaN
  const qualityBadgeOffsetX = q.get("qox") !== null
    ? (Number.isFinite(qQoxNum) ? clamp(Math.round(qQoxNum), -2000, 2000) : 0)
    : (m?.qualityBadgeOffsetX ?? configOverride?.qualityBadgeOffsetX ?? sd.qualityBadgeOffsetX ?? 0)
  const qQoyNum = q.get("qoy") ? Number(q.get("qoy")) : NaN
  const qualityBadgeOffsetY = q.get("qoy") !== null
    ? (Number.isFinite(qQoyNum) ? clamp(Math.round(qQoyNum), -2000, 2000) : 0)
    : (m?.qualityBadgeOffsetY ?? configOverride?.qualityBadgeOffsetY ?? sd.qualityBadgeOffsetY ?? 0)

  // Logo network — stessa catena, stessi bound (%, 10..200).
  const qNScaleNum = q.get("netscale") ? Number(q.get("netscale")) : NaN
  const networkLogoScale = q.get("netscale") !== null
    ? (Number.isFinite(qNScaleNum) && qNScaleNum !== 0 ? clamp(Math.round(qNScaleNum), 10, 200) : 100)
    : (m?.networkLogoScale != null && Number.isFinite(m.networkLogoScale)
        ? clamp(Math.round(m.networkLogoScale), 10, 200)
        : (configOverride?.networkLogoScale != null && Number.isFinite(configOverride.networkLogoScale)
            ? clamp(Math.round(configOverride.networkLogoScale), 10, 200)
            : (sd.networkLogoScale != null && Number.isFinite(sd.networkLogoScale)
                ? clamp(Math.round(sd.networkLogoScale), 10, 200)
                : 100)))

  // Offset logo network — stessa catena, clamp px come il logo.
  const qNoxNum = q.get("nox") ? Number(q.get("nox")) : NaN
  const networkLogoOffsetX = q.get("nox") !== null
    ? (Number.isFinite(qNoxNum) ? clamp(Math.round(qNoxNum), -2000, 2000) : 0)
    : (m?.networkLogoOffsetX ?? configOverride?.networkLogoOffsetX ?? sd.networkLogoOffsetX ?? 0)
  const qNoyNum = q.get("noy") ? Number(q.get("noy")) : NaN
  const networkLogoOffsetY = q.get("noy") !== null
    ? (Number.isFinite(qNoyNum) ? clamp(Math.round(qNoyNum), -2000, 2000) : 0)
    : (m?.networkLogoOffsetY ?? configOverride?.networkLogoOffsetY ?? sd.networkLogoOffsetY ?? 0)

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
  // Modalità layout nastro Netflix + logo network: query `side=right` (Stremio)
  // o `side=left` (Nuvio), poi config/profilo. Globale: nessun override
  // per-titolo (il mapping storico con ribbonSide viene ignorato).
  const qSide = q.get("side")
  const ribbonSide: "left" | "right" = qSide === "right"
    ? "right"
    : qSide === "left"
      ? "left"
      : (configOverride?.ribbonSide === "right" ? "right" : "left")

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
    blurEnabled,
    blurHeight,
    blurIntensity,
    blurFade,
    blurDarkness,
    tintStrength,
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
    ribbonSide,
    preRelease,
    posterShape,
    logoAlign,
    hideLogo,
  }
}
