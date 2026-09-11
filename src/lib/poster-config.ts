// ---------------------------------------------------------------------------
// Parsing della configurazione di resa (badge/blur/gradiente/logo) della route
// poster da query string + mapping + config token + server defaults.
// Estratto dalla route `/api/poster/[type]/[id]` per renderlo testabile in
// isolamento. Semantica identica all'originale — nessuna logica di rendering.
// ---------------------------------------------------------------------------

import type { PictoriumUserConfig } from "./config-token"
import type { Mapping } from "./types"
import type { ServerDefaults } from "./server-defaults"
import { resolveLabelFor } from "./i18n"
import { SUPPORTED_RATING_SOURCES, DEFAULT_RATING_SOURCES } from "./ratings"
import {
  isBadgeStyle,
  isRankingBadgeStyle,
  DEFAULT_BADGE_STYLE,
  DEFAULT_RANKING_BADGE_STYLE,
  type BadgeStyle,
  type RankingBadgeStyle,
} from "./badge-styles"

export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
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
  badgesEnabled: boolean
  rankingEnabled: boolean
  /** Quali componenti del badge genere/rating mostrare (default tutti ON). */
  badgeGenre: boolean
  badgeYear: boolean
  badgeRating: boolean
  badgeQuality: boolean
  ratingSources: string[]
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
  // un valore esplicito (bar/pill/colored/netflix), viene rispettato senza override.
  if (hasRank && rankingBadgeStyle === "default") {
    rankingBadgeStyle = "netflix"
  } else if (!hasRank && rankingBadgeStyle === "netflix") {
    rankingBadgeStyle = "default"
  }

  // Fix M3: includere i campi blur salvati nel mapping nella catena di fallback
  // (query > mapping > configOverride > default), come già fatto per badgeGenre/badgeStyle.
  // Prima il mapping salvato con blur custom non veniva mai applicato.
  const blurEnabled = q.get("be") !== null
    ? q.get("be") !== "0"
    : (mapping?.blurEnabled != null ? mapping.blurEnabled : (configOverride !== null ? configOverride.blurEnabled : true))
  // Clamp espliciti: impediscono a valori estremi (query o config) di arrivare a
  // sharp.blur con sigma enormi o gradienti fuori scala (potenziale DoS CPU).
  const rawGradHeight = q.get("gradHeight") ? Number(q.get("gradHeight")) : NaN
  const blurHeight = Number.isFinite(rawGradHeight)
    ? clamp(rawGradHeight, 5, 100)
    : (mapping?.gradientHeight != null && Number.isFinite(mapping.gradientHeight)
        ? clamp(mapping.gradientHeight, 5, 100)
        : (configOverride !== null ? clamp(configOverride.gradientHeight, 5, 100) : 30))
  const rawBlur = q.get("blur") ? Number(q.get("blur")) : NaN
  const blurIntensity = Number.isFinite(rawBlur)
    ? clamp(rawBlur, 1, 100)
    : (mapping?.blurIntensity != null && Number.isFinite(mapping.blurIntensity)
        ? clamp(mapping.blurIntensity, 1, 100)
        : (configOverride !== null ? clamp(configOverride.blurIntensity, 1, 100) : 5))
  const rawBf = q.get("bf") ? Number(q.get("bf")) : NaN
  const blurFade = Number.isFinite(rawBf)
    ? clamp(rawBf, 0, 100)
    : (mapping?.blurFade != null && Number.isFinite(mapping.blurFade)
        ? clamp(mapping.blurFade, 0, 100)
        : (configOverride !== null ? clamp(configOverride.blurFade, 0, 100) : 60))
  const rawBd = q.get("bd") ? Number(q.get("bd")) : NaN
  const blurDarkness = Number.isFinite(rawBd)
    ? clamp(rawBd, 0, 100)
    : (mapping?.blurDarkness != null && Number.isFinite(mapping.blurDarkness)
        ? clamp(mapping.blurDarkness, 0, 100)
        : (configOverride !== null ? clamp(configOverride.blurDarkness, 0, 100) : 40))

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

  const qRsrc = q.get("rsrc")
  const validSources = SUPPORTED_RATING_SOURCES as readonly string[]
  const ratingSources: string[] = qRsrc !== null
    ? qRsrc.split(",").map((s) => s.trim().toLowerCase()).filter((s) => validSources.includes(s))
    : (configOverride?.ratingSources ?? [...DEFAULT_RATING_SOURCES])

  // Badge style — confinamento della query string al union type: valori non validi
  // cadono sul default (il renderer in passato li trattava come "shadow" nel ramo else).
  const rawBs = q.get("bs")
    || (mapping?.badgeStyle && mapping.badgeStyle !== "shadow" ? mapping.badgeStyle : undefined)
    || configOverride?.badgeStyle
    || sd.badgeStyle
  const badgeStyle: BadgeStyle = isBadgeStyle(rawBs) ? rawBs : DEFAULT_BADGE_STYLE

  const qScale = q.get("scale")
  const qOx = q.get("ox")
  const qOy = q.get("oy")
  // Bound anti-DoS (R1): scale fuori 10..200 arrivava a resizeLogoCached con
  // dimensioni assurde (sharp OOM); scale negativa addirittura crashava il
  // resize → 500 permanente. `scale=0`/non-numerico resta null come prima.
  const qScaleNum = qScale ? Number(qScale) : NaN
  const logoScale = qScale
    ? (Number.isFinite(qScaleNum) && qScaleNum !== 0 ? clamp(Math.round(qScaleNum), 10, 200) : null)
    : mapping?.logoScale ?? null
  // Offset: clamp ±2000px (oltre è comunque fuori canvas). A differenza di
  // prima, `ox=0` esplicito vince sul mapping (0 reale invece di null).
  const qOxNum = qOx ? Number(qOx) : NaN
  const logoOffsetX = qOx
    ? (Number.isFinite(qOxNum) ? clamp(Math.round(qOxNum), -2000, 2000) : null)
    : mapping?.logoOffsetX ?? null
  const qOyNum = qOy ? Number(qOy) : NaN
  const logoOffsetY = qOy
    ? (Number.isFinite(qOyNum) ? clamp(Math.round(qOyNum), -2000, 2000) : null)
    : mapping?.logoOffsetY ?? null

  // Badge superiore — stessa catena di blur/gradient (query > mapping > config
  // > server defaults > default), stessi bound del logo (scala %, offset px).
  const qTScaleNum = q.get("tscale") ? Number(q.get("tscale")) : NaN
  const topBadgeScale = q.get("tscale") !== null
    ? (Number.isFinite(qTScaleNum) && qTScaleNum !== 0 ? clamp(Math.round(qTScaleNum), 10, 200) : 100)
    : (mapping?.topBadgeScale != null && Number.isFinite(mapping.topBadgeScale)
        ? clamp(Math.round(mapping.topBadgeScale), 10, 200)
        : (configOverride?.topBadgeScale != null && Number.isFinite(configOverride.topBadgeScale)
            ? clamp(Math.round(configOverride.topBadgeScale), 10, 200)
            : (sd.topBadgeScale != null && Number.isFinite(sd.topBadgeScale)
                ? clamp(Math.round(sd.topBadgeScale), 10, 200)
                : 100)))
  const qToxNum = q.get("tox") ? Number(q.get("tox")) : NaN
  const topBadgeOffsetX = q.get("tox") !== null
    ? (Number.isFinite(qToxNum) ? clamp(Math.round(qToxNum), -2000, 2000) : 0)
    : (mapping?.topBadgeOffsetX ?? configOverride?.topBadgeOffsetX ?? sd.topBadgeOffsetX ?? 0)
  const qToyNum = q.get("toy") ? Number(q.get("toy")) : NaN
  const topBadgeOffsetY = q.get("toy") !== null
    ? (Number.isFinite(qToyNum) ? clamp(Math.round(qToyNum), -2000, 2000) : 0)
    : (mapping?.topBadgeOffsetY ?? configOverride?.topBadgeOffsetY ?? sd.topBadgeOffsetY ?? 0)

  // Badge genere/rating in basso — stessa catena (query > mapping > config >
  // server defaults > default), stessi bound della scala (%, 10..200).
  const qGScaleNum = q.get("gscale") ? Number(q.get("gscale")) : NaN
  const genreBadgeScale = q.get("gscale") !== null
    ? (Number.isFinite(qGScaleNum) && qGScaleNum !== 0 ? clamp(Math.round(qGScaleNum), 10, 200) : 100)
    : (mapping?.genreBadgeScale != null && Number.isFinite(mapping.genreBadgeScale)
        ? clamp(Math.round(mapping.genreBadgeScale), 10, 200)
        : (configOverride?.genreBadgeScale != null && Number.isFinite(configOverride.genreBadgeScale)
            ? clamp(Math.round(configOverride.genreBadgeScale), 10, 200)
            : (sd.genreBadgeScale != null && Number.isFinite(sd.genreBadgeScale)
                ? clamp(Math.round(sd.genreBadgeScale), 10, 200)
                : 100)))

  // Offset badge genere — stessa catena, clamp px come il logo.
  const qGoxNum = q.get("gox") ? Number(q.get("gox")) : NaN
  const genreBadgeOffsetX = q.get("gox") !== null
    ? (Number.isFinite(qGoxNum) ? clamp(Math.round(qGoxNum), -2000, 2000) : 0)
    : (mapping?.genreBadgeOffsetX ?? configOverride?.genreBadgeOffsetX ?? sd.genreBadgeOffsetX ?? 0)
  const qGoyNum = q.get("goy") ? Number(q.get("goy")) : NaN
  const genreBadgeOffsetY = q.get("goy") !== null
    ? (Number.isFinite(qGoyNum) ? clamp(Math.round(qGoyNum), -2000, 2000) : 0)
    : (mapping?.genreBadgeOffsetY ?? configOverride?.genreBadgeOffsetY ?? sd.genreBadgeOffsetY ?? 0)

  // Badge qualità streaming — stessa catena, stessi bound (%, 10..200).
  const qQScaleNum = q.get("qscale") ? Number(q.get("qscale")) : NaN
  const qualityBadgeScale = q.get("qscale") !== null
    ? (Number.isFinite(qQScaleNum) && qQScaleNum !== 0 ? clamp(Math.round(qQScaleNum), 10, 200) : 100)
    : (mapping?.qualityBadgeScale != null && Number.isFinite(mapping.qualityBadgeScale)
        ? clamp(Math.round(mapping.qualityBadgeScale), 10, 200)
        : (configOverride?.qualityBadgeScale != null && Number.isFinite(configOverride.qualityBadgeScale)
            ? clamp(Math.round(configOverride.qualityBadgeScale), 10, 200)
            : (sd.qualityBadgeScale != null && Number.isFinite(sd.qualityBadgeScale)
                ? clamp(Math.round(sd.qualityBadgeScale), 10, 200)
                : 100)))

  // Offset badge qualità — stessa catena, clamp px come il logo.
  const qQoxNum = q.get("qox") ? Number(q.get("qox")) : NaN
  const qualityBadgeOffsetX = q.get("qox") !== null
    ? (Number.isFinite(qQoxNum) ? clamp(Math.round(qQoxNum), -2000, 2000) : 0)
    : (mapping?.qualityBadgeOffsetX ?? configOverride?.qualityBadgeOffsetX ?? sd.qualityBadgeOffsetX ?? 0)
  const qQoyNum = q.get("qoy") ? Number(q.get("qoy")) : NaN
  const qualityBadgeOffsetY = q.get("qoy") !== null
    ? (Number.isFinite(qQoyNum) ? clamp(Math.round(qQoyNum), -2000, 2000) : 0)
    : (mapping?.qualityBadgeOffsetY ?? configOverride?.qualityBadgeOffsetY ?? sd.qualityBadgeOffsetY ?? 0)

  // Logo network — stessa catena, stessi bound (%, 10..200).
  const qNScaleNum = q.get("netscale") ? Number(q.get("netscale")) : NaN
  const networkLogoScale = q.get("netscale") !== null
    ? (Number.isFinite(qNScaleNum) && qNScaleNum !== 0 ? clamp(Math.round(qNScaleNum), 10, 200) : 100)
    : (mapping?.networkLogoScale != null && Number.isFinite(mapping.networkLogoScale)
        ? clamp(Math.round(mapping.networkLogoScale), 10, 200)
        : (configOverride?.networkLogoScale != null && Number.isFinite(configOverride.networkLogoScale)
            ? clamp(Math.round(configOverride.networkLogoScale), 10, 200)
            : (sd.networkLogoScale != null && Number.isFinite(sd.networkLogoScale)
                ? clamp(Math.round(sd.networkLogoScale), 10, 200)
                : 100)))

  // Offset logo network — stessa catena, clamp px come il logo.
  const qNoxNum = q.get("nox") ? Number(q.get("nox")) : NaN
  const networkLogoOffsetX = q.get("nox") !== null
    ? (Number.isFinite(qNoxNum) ? clamp(Math.round(qNoxNum), -2000, 2000) : 0)
    : (mapping?.networkLogoOffsetX ?? configOverride?.networkLogoOffsetX ?? sd.networkLogoOffsetX ?? 0)
  const qNoyNum = q.get("noy") ? Number(q.get("noy")) : NaN
  const networkLogoOffsetY = q.get("noy") !== null
    ? (Number.isFinite(qNoyNum) ? clamp(Math.round(qNoyNum), -2000, 2000) : 0)
    : (mapping?.networkLogoOffsetY ?? configOverride?.networkLogoOffsetY ?? sd.networkLogoOffsetY ?? 0)

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

  return {
    badgeStyle,
    rankingBadgeStyle,
    blurEnabled,
    blurHeight,
    blurIntensity,
    blurFade,
    blurDarkness,
    badgesEnabled,
    rankingEnabled,
    badgeGenre,
    badgeYear,
    badgeRating,
    badgeQuality,
    ratingSources,
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
  }
}
