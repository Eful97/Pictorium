import sharp from "sharp"
import type { RatingItem } from "./custom-rating/types"
import { renderMultiRatings } from "./multi-rating-renderer"
import type { SeparateRating } from "./ratings"
import { renderSeparateRatingStack } from "./separate-rating-renderer"
import { cacheGet, cacheSet } from "./cache"
import { GENRE_FALLBACK, cinematicVignetteSVG, cinematicCornerGradientSVG, topShadeSVG } from "./badges"
import { applyBlur } from "./blur"
import {
  STD_W,
  STD_H,
  extractBadgeColor,
  extractSceneTint,
  fitBadgeToCanvas,
  fitCompositeToCanvas,
  isValidHex,
  BadgeRender,
  PosterComposite,
} from "./poster-render-helpers"
import { LAND_W, LAND_H } from "./image-utils"
import { renderGenreBadge, renderRankingBadge, renderExtraBadge, renderQualityBadge, renderComingSoonRibbon, comingSoonRibbonLayout, renderSVG, buildCustomPresetBadgeSVG, buildHousePresetBadgeSVG } from "./svg-badge"
import { buildLogoScrim, logoContrast, logoInkLuminance, logoScrimStrength, posterLogoZoneLuminance } from "./logo-contrast"
import { renderFirstMatchingNetworkLogoBadge, renderFirstMatchingNetworkRawBadge, renderFirstMatchingNetworkLogoBadgeHybrid, renderFirstMatchingNetworkRawBadgeHybrid, type NetworkCandidate } from "./network-svgs"
import { computeLogoLayout, logoAlignPadX, PORTRAIT_LOGO_MAX_HEIGHT_PCT, PORTRAIT_LOGO_TOP_OFFSET, LANDSCAPE_LOGO_MAX_WIDTH_PCT, LANDSCAPE_LOGO_MAX_HEIGHT_PCT, LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT, LANDSCAPE_LOGO_TOP_OFFSET, LANDSCAPE_LOGO_SHIFT_X, LANDSCAPE_LOGO_SHIFT_Y } from "./logo-layout"
import { logoDefaultScaleFromAspect } from "./logo-selection"
import fs from "fs"
import path from "path"
import { estimateTextWidth, fontFamilyFor, escSvg, badgeBoxHeight, TOP_SHADOW_PAD } from "./badge-svg-shared"
import { computeTopBadge, isNetworkStudio, type BadgeInput } from "./poster-badge"
import type { DateFormat } from "./release-badge"
import type { SashBucket } from "./badge-priority"
import { PRE_RELEASE_DIM_ALPHA, PRE_RELEASE_BLUR_SIGMA } from "./pre-release"
import type { Mapping, NetworkLogoPosition } from "./types"
import type { ServerDefaults } from "./server-defaults"
import type { WikidataResult } from "./awards"
import { directorBadgeLabel } from "./awards"
import type { BadgeT } from "./poster-badge"
import { isRibbonRankingStyle, type BadgeStyle, type RankingBadgeStyle } from "./badge-styles"
import type { PosterImageFormat } from "@/lib/poster-runtime-cache"
import { getPresetForUser } from "./badge-preset-store"
import type { BadgePreset } from "./badge-preset"
import { qualityBadgeIconPath } from "./quality-badge-styles"
import type { QualityBadgeStyle } from "./badge-styles"
import { FORMAT_ICON_PATHS, type VideoFormat } from "./av-specs"
import type { BadgeVariableContext } from "./badge-variables"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const BADGE_CACHE_TTL = 24 * 60 * 60 * 1000

// B2: scala % di un bitmap già renderizzato (un solo resize sharp).
// Condiviso dai 4 badge scalabili (rank/genere/qualità/network): stessa
// matematica dei blocchi inline sostituiti (round + max 1px, no-op se le
// dimensioni non cambiano). Lo spread preserva i campi extra (isRank, …).
async function scaleBitmapForLayout<T extends { png: Buffer; w: number; h: number }>(r: T, pct: number): Promise<T> {
  const w = Math.max(1, Math.round(r.w * pct / 100))
  const h = Math.max(1, Math.round(r.h * pct / 100))
  if (w === r.w && h === r.h) return r
  const png = await sharp(r.png).resize(w, h).toBuffer()
  return { ...r, png, w, h }
}

// TTL cache image-level (colori badge, resize logo/backdrop): le immagini TMDB
// sono immutabili per path → 24h come la badge cache. Le entry si auto-espellono
// col byte/entry limit della cache globale (tag "poster-extract").
const IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000
const IMAGE_CACHE_TAG = "poster-extract"

export interface GenerationInput {
  ratings?: RatingItem[]
  /** Colonna rating separati a destra (sostituisce la media ★), max 3. */
  separateRatings?: readonly SeparateRating[]
  // Images (already fetched)
  posterBuf: Buffer
  logoFetch: Buffer | null
  backdropFetch: Buffer | null

  // Layout
  backdropScale: number
  backdropOffsetX: number
  backdropOffsetY: number

  // Blur
  blurEnabled: boolean
  blurHeight: number
  blurIntensity: number
  blurFade: number
  blurDarkness: number
  /** Intensità tinta di scena 0-100 (default 20, convertita in frazione per applyBlur). */
  tintStrength?: number
  /**
   * Ombra lineare superiore 0-100 (default 50, come la catena di default).
   * Solo flat (vale per entrambi i canvas): incornicia il poster e
   * fa risaltare badge/testi superiori. Sotto logo e badge.
   */
  topShade?: number

  // Badge flags
  badgesEnabled: boolean
  rankingEnabled: boolean
  genreName: string | null
  voteAverage: number | null
  badgeStyle: BadgeStyle
  rankingBadgeStyle: RankingBadgeStyle
  /** Quali componenti del badge genere/rating mostrare (default tutti ON). */
  badgeGenre: boolean
  badgeYear: boolean
  badgeRating: boolean
  badgeQuality?: boolean
  quality?: string | null
  /** Stile icone del badge qualità (standard = pill testuale). */
  qualityBadgeStyle?: QualityBadgeStyle | null
  /** Formati A/V da affiancare alla qualità (dv, atmos, imax, hdr, hdr10plus). */
  videoFormats?: readonly VideoFormat[] | null
  /** Ordine/priorità sash (sottoinsieme = resto spento). Default = ordine standard. */
  sashOrder?: readonly SashBucket[] | null
  topLight: boolean
  /** Polarità del badge genere in basso (fondo chiaro → pill scura). Default = topLight (comportamento storico). */
  bottomLight?: boolean
  targetCenter: number
  /** Modalità layout nastro Netflix + logo network: "left" (Nuvio, default) o "right" (Stremio). */
  ribbonSide: "left" | "right"
  /**
   * Tinta accent sul badge classifica centrato: true quando il nastro è OFF
   * e lo stile pre-degrado era "colored" (senza nastro deve colorare il
   * badge default come riempimento piatto).
   */
  rankingBadgeAccent?: boolean
  /**
   * Nastro stile Netflix all'angolo (default true = comportamento storico).
   * Su false il Coming Soon pre-digitale viene reso come pill centrale e gli
   * stili classifica nastro sono già degradati a monte (poster-config).
   */
  ribbonEnabled?: boolean

  // Logo
  logoScale: number | null
  logoOffsetX: number | null
  logoOffsetY: number | null
  /** Disattiva la velatura di sicurezza sotto al logo (default: attiva). */
  logoScrimDisabled?: boolean

  // Badge superiore (rank/extra in alto): scala % su tutti gli stili
  // (la barra scala nativa via font per restare full-width),
  // offset px solo sugli stili centrati (nastro/barra restano ancorati).
  topBadgeScale: number
  topBadgeOffsetX: number
  topBadgeOffsetY: number
  /** Scala % del badge genere/rating in basso, su tutti gli stili (barra nativa via font). */
  genreBadgeScale: number
  /** Offset px del badge genere/rating, solo stili non-bar. */
  genreBadgeOffsetX: number
  genreBadgeOffsetY: number
  /** Scala % del badge qualità streaming. */
  qualityBadgeScale: number
  /** Offset px del badge qualità. */
  qualityBadgeOffsetX: number
  qualityBadgeOffsetY: number
  /** Scala % del logo network. */
  networkLogoScale: number
  /** Offset px del logo network. */
  networkLogoOffsetX: number
  networkLogoOffsetY: number

  // Badge data sources
  mediaType: "movie" | "tv"
  /** TMDB ID per il lookup premi certi (liste ID in award-ids.ts). */
  tmdbId?: number | null
  /** IMDb ID per le variabili preset ({{imdb}}). */
  imdbId?: string | null
  /**
   * Badge preset custom (?badgePreset=<id>&prv=<rev>): sostituisce il bitmap
   * dello slot corrispondente (target top → badge superiore, genre → badge
   * genere) preservando layout/posizioni/scale esistenti. Assente/invalido →
   * fallback silenzioso sullo stile standard (mai 500).
   */
  badgePresetId?: string | null
  /** Revisione attesa del preset (cache identity): mismatch → refetch. */
  badgePresetRev?: string | null
  /** Namespace utente per i preset privati (solo il proprietario li rende). */
  badgePresetUser?: string | null
  /** Data uscita digitale già calcolata dal pre-release: Just Added. */
  digitalReleaseDate?: string | null
  finalRank: number | null
  animeRankResult: number | null
  rankingResult: number | null
  mapping: Mapping | null
  tmdbNetworks: readonly string[]
  productionCompanies: readonly string[]
  tmdbStudios: readonly string[]
  /** Mappa name -> logo_path TMDB per fallback (SVG first -> TMDB). */
  tmdbNetworksDetailed?: readonly NetworkCandidate[]
  productionCompaniesDetailed?: readonly NetworkCandidate[]
  tvType: string | null
  tvStatus: string | null
  releaseDate: string | null
  firstAirDate: string | null
  /** Ultima messa in onda + n. stagioni + origin country (badge Nuova stagione / K-Drama). */
  lastAirDate: string | null
  seasonCount: number | null
  originCountries: readonly string[]
  wikidataResult: WikidataResult
  tmdbKeywords: readonly string[]
  locale: string
  /** Formato data badge "in uscita" (query `df` > default utente; default `locale`). */
  dateFormat?: DateFormat | null
  t: BadgeT
  qLabel: string | null
  queryExtra: string | null
  qNetLogo: string | null
  networkLogo?: boolean
  /**
   * Posizione del logo network ("top" = sempre all'angolo superiore, lato
   * del nastro effettivo; "auto" = specchio dinamico odierno). Default "auto"
   * (byte-identico al passato).
   */
  networkLogoPosition?: NetworkLogoPosition
  sd: ServerDefaults
  accentOverride: { genreColor: string; rankColor: string } | null
  /** Pre-resolved IMDb Top 250 membership. Falls back gracefully when falsy. */
  imdbTop250?: boolean
  /** Path sorgente del poster (cache image-level). Assente → niente cache. */
  posterSrc?: string | null
  /**
   * Chiave analisi pixel (luminance/tinta) costruita dalla route: identifica i
   * byte effettivi della base (`portrait:poster:…`, `landscape:backdrop:…`,
   * `landscape:pillarbox:…`), non il path nominale — pillarbox e backdrop
   * derivano da sorgenti diverse a parità di path. Assente → ricalcolo diretto.
   */
  analysisKey?: string | null
  /** Formato di output negoziazione Accept (jpeg | webp | avif). Default: jpeg. */
  format?: PosterImageFormat
  /** Path sorgente del logo (cache image-level). Assente → niente cache. */
  logoSrc?: string | null
  /** Path sorgente del backdrop (cache image-level). Assente → niente cache. */
  backdropSrc?: string | null
  /**
   * Allineamento orizzontale del blocco logo/metadati ("center" = classico,
   * "left" = Cinematic). Default center (byte-identico al passato).
   */
  logoAlign?: "left" | "center"
  /**
   * Effetto pre-digitale già risolto dalla route (flag `pre` ON + film
   * rilevato senza disponibilità digitale/streaming): velo scuro + badge
   * "Coming Soon". Solo film, indipendente dai toggle badges/ranking.
   */
  preRelease?: boolean
  /**
   * Formato canvas (prova orizzontale): "poster" (500×750, default) o
   * "landscape" (768×432, base = backdrop TMDB). La route costruisce già
   * `posterBuf` alle dimensioni giuste; qui CW/CH guidano solo overlay,
   * badge e posizioni.
   */
  shape?: "poster" | "landscape"
  /**
   * Nasconde il logo film dal composite (il fetch resta per i colori accent).
   * Solo query esplicita `hideLogo=1` (banner Nuvio pulito): il landscape
   * cuoce il logo come il portrait, coi vincoli del canvas 16:9.
   */
  hideLogo?: boolean
}

// ---- Vignette SVG cache (una entry per dimensioni canvas) ----
const _vignetteCache = new Map<string, Promise<Buffer>>()
async function getVignette(canvasW: number = STD_W, canvasH: number = STD_H): Promise<Buffer> {
  const key = `${canvasW}x${canvasH}`
  let p = _vignetteCache.get(key)
  if (!p) {
    const fresh = sharp(Buffer.from(cinematicVignetteSVG(canvasW, canvasH))).png().toBuffer()
    // Reset su reject: una Promise respinta resterebbe cachata e avvelenerebbe
    // tutti i render futuri (stesso pattern di loadResvg in svg-badge.ts).
    fresh.catch(() => { if (_vignetteCache.get(key) === fresh) _vignetteCache.delete(key) })
    _vignetteCache.set(key, fresh)
    p = fresh
  }
  return p
}

// ---- Landscape corner scrim (una entry: 768×432 costanti) ----
let _landscapeScrimPromise: Promise<Buffer> | null = null
async function getLandscapeScrim(): Promise<Buffer> {
  if (!_landscapeScrimPromise) {
    const fresh = sharp(Buffer.from(cinematicCornerGradientSVG(LAND_W, LAND_H))).png().toBuffer()
    // Reset su reject: vedi getVignette sopra.
    fresh.catch(() => { if (_landscapeScrimPromise === fresh) _landscapeScrimPromise = null })
    _landscapeScrimPromise = fresh
  }
  return _landscapeScrimPromise
}
// ---- Pre-release dim overlay (uno per dimensioni canvas) ----
const _preReleaseDimCache = new Map<string, Promise<Buffer>>()
async function getPreReleaseDim(canvasW: number = STD_W, canvasH: number = STD_H): Promise<Buffer> {
  const key = `${canvasW}x${canvasH}`
  let p = _preReleaseDimCache.get(key)
  if (!p) {
    const fresh = sharp({
      create: {
        width: canvasW,
        height: canvasH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: PRE_RELEASE_DIM_ALPHA },
      },
    }).png().toBuffer()
    // Reset su reject: vedi getVignette sopra.
    fresh.catch(() => { if (_preReleaseDimCache.get(key) === fresh) _preReleaseDimCache.delete(key) })
    _preReleaseDimCache.set(key, fresh)
    p = fresh
  }
  return p
}

// ---- Top shade overlay (una entry per dimensioni canvas + intensità) ----
const _topShadeCache = new Map<string, Promise<Buffer>>()
async function getTopShade(canvasW: number, canvasH: number, strength: number): Promise<Buffer> {
  const s = Math.min(Math.max(Math.round(strength), 0), 100)
  const key = `${canvasW}x${canvasH}:${s}`
  let p = _topShadeCache.get(key)
  if (!p) {
    const fresh = sharp(Buffer.from(topShadeSVG(canvasW, canvasH, s))).png().toBuffer()
    // Reset su reject: vedi getVignette sopra.
    fresh.catch(() => { if (_topShadeCache.get(key) === fresh) _topShadeCache.delete(key) })
    _topShadeCache.set(key, fresh)
    p = fresh
  }
  return p
}

// ---------------------------------------------------------------------------
// Badge cache helpers (coalescing) — implementazione in poster-cache-infra.ts.
// `badgeCacheKey` è ri-esportata per compatibilità (test + consumer storici).
// ---------------------------------------------------------------------------
import { badgeCacheKey, coalesceBadgeRender } from "./poster-cache-infra"
export { badgeCacheKey } from "./poster-cache-infra"

// ---------------------------------------------------------------------------
// Badge preset lookup (M5): JSON cachato in-memory 10 min, fail-open.
// ---------------------------------------------------------------------------

const PRESET_JSON_TTL_MS = 10 * 60 * 1000
const PRESET_JSON_CACHE_MAX = 200
const presetJsonCache = new Map<string, { preset: BadgePreset; expires: number }>()

/**
 * Risolve un preset per il render poster. I pubblici rendono per chiunque,
 * i privati solo nel namespace del proprietario. Qualsiasi fallimento
 * (assente, invalido, KV irraggiungibile) → null: il chiamante degrada sullo
 * stile standard, mai 500. La revision attesa (`prv` dall'URL) invalida
 * subito la cache dopo una modifica del preset.
 */
export async function getPresetForPoster(
  id: string | null | undefined,
  expectedRev: string | null | undefined,
  userUuid: string | null | undefined,
): Promise<BadgePreset | null> {
  if (!id) return null
  const now = Date.now()
  const hit = presetJsonCache.get(id)
  if (hit && hit.expires > now && (!expectedRev || hit.preset.revision === expectedRev)) {
    return hit.preset
  }
  try {
    const stored = await getPresetForUser(id, userUuid ?? "")
    if (!stored) {
      presetJsonCache.delete(id)
      return null
    }
    presetJsonCache.set(id, { preset: stored.preset, expires: now + PRESET_JSON_TTL_MS })
    if (presetJsonCache.size > PRESET_JSON_CACHE_MAX) {
      const oldest = presetJsonCache.keys().next().value
      if (oldest !== undefined) presetJsonCache.delete(oldest)
    }
    return stored.preset
  } catch {
    // Store in panne (KV irraggiungibile, file corrotto): fail-open, il
    // chiamante degrada sullo stile standard e il poster resta 200.
    presetJsonCache.delete(id)
    return null
  }
}

/** Solo test: svuota la cache JSON dei preset. */
export function __resetPresetJsonCacheForTests(): void {
  presetJsonCache.clear()
}

// ---------------------------------------------------------------------------
// Quality badge da icone built-in (public/quality-badges, server-only).
// ---------------------------------------------------------------------------

// Sorgenti SVG memoizzati (file immutabili, cap 20): i render a varie pw e
// polarità condividono i byte sorgente.
const qualityIconMemo = new Map<string, Promise<string | null>>()
const QUALITY_ICON_MEMO_MAX = 20

function loadQualityIconSvg(iconPath: string): Promise<string | null> {
  const memo = qualityIconMemo.get(iconPath)
  if (memo) return memo
  const p = (async (): Promise<string | null> => {
    try {
      // Solo path del registro (niente ..) — il chiamante passa solo
      // qualityBadgeIconPath(); doppia guardia contro traversal.
      if (iconPath.includes("..") || path.posix.normalize(iconPath) !== iconPath) return null
      const full = path.join(process.cwd(), "public", iconPath)
      return await fs.promises.readFile(full, "utf8")
    } catch {
      return null
    }
  })()
  p.catch(() => { if (qualityIconMemo.get(iconPath) === p) qualityIconMemo.delete(iconPath) })
  if (qualityIconMemo.size >= QUALITY_ICON_MEMO_MAX) qualityIconMemo.delete(qualityIconMemo.keys().next().value!)
  qualityIconMemo.set(iconPath, p)
  return p
}

/** Solo test: svuota la memo dei sorgenti SVG qualità. */
export function __resetQualityIconCacheForTests(): void {
  qualityIconMemo.clear()
}

function qualityIconViewBox(svg: string): { w: number; h: number } | null {
  const m = svg.match(/viewBox="([\d.\-\s]+)"/)
  if (!m) return null
  const parts = m[1].trim().split(/\s+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) return null
  return { w: parts[2], h: parts[3] }
}

/**
 * Rende un'icona qualità built-in all'ingombro verticale della pill
 * standard (stesso anchor di layout). Lo stile mono è nero su fondo chiaro
 * e va ricolorato di bianco su fondo scuro (fill ereditato alla radice: i
 * path non dichiarano fill propri); il color resta originale. Ritorna null
 * se il file manca o non rasterizza: il chiamante degrada sulla pill
 * standard, mai 500.
 */
export async function renderQualityIconBadge(
  iconPath: string,
  pw: number,
  topLight?: boolean,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  try {
    const src = await loadQualityIconSvg(iconPath)
    if (!src) return null
    const vb = qualityIconViewBox(src)
    if (!vb) return null
    const isMono = !/(^|\/)color\//.test(iconPath)
    // Stessa base della pill standard (17px su griglia 380): l'icona occupa
    // lo stesso ingombro verticale, qscale/qox/qoy invariati a valle.
    const fs = Math.round(Math.max(17 * pw / 380, 10))
    const targetH = badgeBoxHeight(fs)
    const w = Math.max(1, Math.round(targetH * (vb.w / vb.h)))
    const h = Math.max(1, Math.round(w * (vb.h / vb.w)))
    const fill = isMono ? (topLight ? "#000000" : "#ffffff") : null
    const totalW = w + TOP_SHADOW_PAD * 2
    const totalH = h + TOP_SHADOW_PAD * 2
    const innerContent = src.replace(/<\?xml[^>]*\?>/g, "").replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")
    const fillAttr = fill ? ` fill="${fill}" color="${fill}"` : ""
    // Ombra reale simmetrica con feDropShadow (dx=2, dy=2, stdDev=2.5):
    // stacca l'icona mono/color da sfondi chiari o complessi, mentre
    // il padding TOP_SHADOW_PAD mantiene l'esatto ancoraggio visivo a valle.
    const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">` +
      `<defs><filter id="tds" x="-20%" y="-20%" width="180%" height="180%"><feDropShadow dx="2" dy="2" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.65"/></filter></defs>` +
      `<g filter="url(#tds)">` +
      `<svg x="${TOP_SHADOW_PAD}" y="${TOP_SHADOW_PAD}" width="${w}" height="${h}" viewBox="0 0 ${vb.w} ${vb.h}"${fillAttr}>${innerContent}</svg>` +
      `</g></svg>`
    const png = await renderSVG(compositeSvg, totalW)
    return { png, w: totalW, h: totalH }
  } catch {
    return null
  }
}

/**
 * Renderizza la colonna verticale qualità + formati A/V (es. [4K] sopra [DV] sopra [ATMOS]).
 * Se non ci sono formati o falliscono, ritorna il singolo badge di risoluzione.
 */
export async function renderQualityBadgeGroup(
  quality: string,
  qualityBadgeStyle: QualityBadgeStyle | null | undefined,
  videoFormats: readonly VideoFormat[] | null | undefined,
  pw: number,
  topLight?: boolean,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const qualityIconPath = qualityBadgeIconPath(qualityBadgeStyle, quality)
  let resBadge: { png: Buffer; w: number; h: number } | null = null
  if (qualityIconPath) {
    resBadge = await renderQualityIconBadge(qualityIconPath, pw, topLight)
  }
  if (!resBadge) {
    resBadge = await renderQualityBadge(quality, pw, topLight)
  }
  if (!resBadge) return null
  if (!videoFormats || videoFormats.length === 0) return resBadge

  const validFormats = videoFormats.filter((f) => f in FORMAT_ICON_PATHS)
  if (validFormats.length === 0) return resBadge

  const hasDV = validFormats.includes("dv")
  const hasAtmos = validFormats.includes("atmos")
  let useCombo = hasDV && hasAtmos
  let comboIcon: { png: Buffer; w: number; h: number } | null = null
  if (useCombo) {
    comboIcon = await renderQualityIconBadge("quality-badges/video/dolby-vision-atmos.svg", pw, topLight)
    if (!comboIcon) useCombo = false
  }

  const formatBadges: { png: Buffer; w: number; h: number }[] = []
  if (comboIcon) {
    formatBadges.push(comboIcon)
  }

  for (const fmt of validFormats) {
    if (useCombo && (fmt === "dv" || fmt === "atmos")) {
      continue
    }
    const icon = await renderQualityIconBadge(FORMAT_ICON_PATHS[fmt], pw, topLight)
    if (icon) formatBadges.push(icon)
  }
  if (formatBadges.length === 0) return resBadge

  const gap = Math.round(5 * pw / 380)
  const allBadges = [resBadge, ...formatBadges]
  const visWidths = allBadges.map((b) => Math.max(1, b.w - TOP_SHADOW_PAD * 2))
  const visHeights = allBadges.map((b) => Math.max(1, b.h - TOP_SHADOW_PAD * 2))
  const maxVisW = Math.max(...visWidths)
  const totalW = maxVisW + TOP_SHADOW_PAD * 2
  const totalVisH = visHeights.reduce((sum, h) => sum + h, 0) + gap * (allBadges.length - 1)
  const totalH = totalVisH + TOP_SHADOW_PAD * 2

  const composites: { input: Buffer; left: number; top: number }[] = []
  let curVisTop = TOP_SHADOW_PAD
  for (let i = 0; i < allBadges.length; i++) {
    composites.push({
      input: allBadges[i].png,
      left: Math.round((totalW - allBadges[i].w) / 2),
      top: curVisTop - TOP_SHADOW_PAD,
    })
    curVisTop += visHeights[i] + gap
  }

  const groupPng = await sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer()

  return { png: groupPng, w: totalW, h: totalH }
}



const NETWORKS_DIR_COMBINED = path.join(process.cwd(), "public", "networks")
const NETWORK_FILES_COMBINED: Record<string, string> = {
  netflix: "Netflix_2016_N_logo.svg",
  hbo: "HBO_logo.svg",
  disney: "Disney+_logo.svg",
  prime: "Prime_Video_logo_(2024).svg",
  apple: "Apple_TV_logo.svg",
  paramount: "Paramount_Plus.svg",
  rai: "Logo_of_RAI_(2016).svg",
  crunchyroll: "cr_logo_noTagline.svg",
  sky: "Now_logo.svg",
  mediaset: "Mediaset_Infinity_logo.svg",
  tubi: "Tubi logo.svg",
  pluto: "Pluto_TV_logo_2024.svg",
  amc: "Amc_logo.svg",
  abc: "American_Broadcasting_Company_Logo.svg",
  cbs: "CBS_logo_(2020).svg",
  fox: "FOX_wordmark.svg",
  fx: "FX_International_logo.svg",
  hulu: "Hulu_logo_(2018).svg",
  natgeo: "National-Geographic-Logo.svg",
  nbc: "NBC_logo.svg",
  mbs: "Mainichi_Broadcasting_System_logo.svg",
  showtime: "Showtime_logo.svg",
  warner: "Warner_Bros_logo.svg",
  universal: "Universal_Pictures_logo.svg",
  century: "20th_Century_Studios_(2020) [Recuperato].svg",
  columbia: "Columbia_Pictures.svg",
  sony: "Sony_logo.svg",
  disney_pictures: "Walt_Disney_Pictures_text_logo.svg",
  marvel: "Marvel_Studios_2016_logo.svg",
  pixar: "Pixar_logo.svg",
  a24: "A24_logo.svg",
  legendary: "Legendary_Entertainment_logo.svg",
  lionsgate: "Lionsgate_Logo.svg",
  fandango: "Fandango_logotipo.svg",
  medusa: "Medusa_Film_-_logo_(Italy,_2017-).svg",
  ghibli: "Studio_Ghibli.svg",
  mgm: "metro-goldwyn-mayer.svg",
  mgm_plus: "MGM+_logo.svg",
  lucasfilm: "Lucasfilm_logo.svg",
  miramax: "Miramax_logo.svg",
  castle_rock: "castle-rock-entertainment.svg",
  dreamworks: "dreamworks-animation-logo-vector.svg",
  indiana: "Indiana_Production.svg",
  sky_cinema: "Sky_Cinema_-_Logo_2021.svg",
  taodue: "Taodue_logo.svg",
  bandai: "Bandai_Visual_corporate_logo.svg",
  mappa: "MAPPA_Logo.svg",
  skydance: "Skydance_Media_2020.svg",
  studiocanal: "Studiocanal_2011_logo.svg",
  dg_cinema: "direzione-generale-cinema-e-audiovisivo-vector-logo.svg",
  dc: "DC_Studios_logo.svg",
  bigtalk: "Big+Talk+Studios+-+Logo+-+Brandmark.webp",
}

// B4: memo per (networkKey, targetH, fg). Gli SVG in public/networks/ sono
// immutabili → memo permanente (cap 200). Prima ogni cold render ripeteva
// existsSync + readFile + metadata + resize + composite per lo stesso logo.
const pillLogoMemo = new Map<string, Promise<{ png: Buffer; w: number; h: number } | null>>()
const PILL_LOGO_MEMO_MAX = 200
async function loadNetworkLogoForPill(networkKey: string, targetH: number, fg: string): Promise<{ png: Buffer; w: number; h: number } | null> {
  const memoKey = `${networkKey}:${targetH}:${fg}`
  const memo = pillLogoMemo.get(memoKey)
  if (memo) return memo
  const p = loadNetworkLogoForPillUncached(networkKey, targetH, fg)
  p.catch(() => { if (pillLogoMemo.get(memoKey) === p) pillLogoMemo.delete(memoKey) })
  if (pillLogoMemo.size >= PILL_LOGO_MEMO_MAX) pillLogoMemo.delete(pillLogoMemo.keys().next().value!)
  pillLogoMemo.set(memoKey, p)
  return p
}

async function loadNetworkLogoForPillUncached(networkKey: string, targetH: number, fg: string): Promise<{ png: Buffer; w: number; h: number } | null> {
  const filename = NETWORK_FILES_COMBINED[networkKey]
  if (!filename) return null
  const filePath = path.join(NETWORKS_DIR_COMBINED, filename)
  if (!fs.existsSync(filePath)) return null
  try {
    const sharp = (await import("sharp")).default
    const svgBuffer = await fs.promises.readFile(filePath)
    // Recupera dimensione originale per scala corretta
    let density = 72
    try {
      const meta = await sharp(svgBuffer).metadata()
      if (meta.width && meta.height && meta.height < targetH * 3) {
        // Stima density per rendere nitido a targetH
        density = Math.min(Math.ceil((72 * targetH * 2) / meta.height), 2400)
      }
    } catch {}
    const { data, info } = await sharp(svgBuffer, { density })
      .resize(Math.round(targetH * 3), targetH, { fit: "inside", withoutEnlargement: false })
      .png()
      .toBuffer({ resolveWithObject: true })
    if (networkKey === "marvel" || networkKey === "dc") {
      return { png: data, w: info.width, h: info.height }
    }
    // Ricolora a fg (bianco/nero) per interno pill
    const isWhite = fg.includes("255")
    const fgBg = isWhite ? { r: 255, g: 255, b: 255, alpha: 0.95 } : { r: 18, g: 18, b: 22, alpha: 0.95 }
    const fgSolid = await sharp({ create: { width: info.width, height: info.height, channels: 4, background: fgBg } }).png().toBuffer()
    const recolored = await sharp(fgSolid).composite([{ input: data, blend: "dest-in" }]).png().toBuffer()
    return { png: recolored, w: info.width, h: info.height }
  } catch { return null }
}

export async function renderCombinedRankNetworkPill(rank: number, label: string, networkKey: string, pw: number, topLight: boolean, _accentColor: string | undefined, _isAnime: boolean | undefined): Promise<{ png: Buffer; w: number; h: number } | null> {
  const fs = Math.round(Math.max(20 * pw / 380, 13))
  const px = Math.round(fs * 0.75)
  const pt = Math.round(fs * 0.35)
  const gap = Math.round(fs * 0.25)
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const text = `#${rank} ${label}`
  const textW = estimateTextWidth(text, fs)
  const netTargetH = Math.round(fs * 0.55)
  const netLogo = await loadNetworkLogoForPill(networkKey, netTargetH, fg)
  if (!netLogo) return null
  // Layout verticale: scritta sopra, logo sotto, centrati orizzontalmente
  const pillW = Math.max(textW, netLogo.w) + px * 2
  const pillH = pt + fs + gap + netLogo.h + pt
  const r = Math.round(pillH / 2)
  const textY = pt + fs / 2
  const logoY = pt + fs + gap + netLogo.h / 2
  const logoX = Math.round((pillW - netLogo.w) / 2)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillW}" height="${pillH}"><rect width="${pillW}" height="${pillH}" rx="${r}" fill="${bg}" stroke="${topLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.20)"}" stroke-width="1"/><text x="${pillW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(text)}" font-weight="700" font-size="${fs}" fill="${fg}">${escSvg(text)}</text><image href="data:image/png;base64,${netLogo.png.toString("base64")}" x="${logoX}" y="${Math.round(logoY - netLogo.h / 2)}" width="${netLogo.w}" height="${netLogo.h}"/></svg>`
  // Render via resvg (stesso path degli altri badge — renderSVG hoisted)
  const png = await renderSVG(svg, pillW)
  return { png, w: pillW, h: pillH }
}

export async function renderNetworkOnlyLargePill(networkKey: string, pw: number, topLight: boolean): Promise<{ png: Buffer; w: number; h: number } | null> {
  const fs = Math.round(Math.max(20 * pw / 380, 13))
  const px = Math.round(fs * 0.75)
  const pt = Math.round(fs * 0.35)
  const pillH = fs + pt * 2
  const r = Math.round(pillH / 2)
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const netTargetH = Math.round(fs * 0.85)
  const netLogo = await loadNetworkLogoForPill(networkKey, netTargetH, fg)
  if (!netLogo) return null
  const pillW = netLogo.w + px * 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillW}" height="${pillH}"><rect width="${pillW}" height="${pillH}" rx="${r}" fill="${bg}" stroke="${topLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.20)"}" stroke-width="1"/><image href="data:image/png;base64,${netLogo.png.toString("base64")}" x="${px}" y="${Math.round((pillH - netLogo.h) / 2)}" width="${netLogo.w}" height="${netLogo.h}"/></svg>`
  const png = await renderSVG(svg, pillW)
  return { png, w: pillW, h: pillH }
}

export async function renderCombinedExtraNetworkPill(label: string, networkKey: string, pw: number, topLight: boolean): Promise<{ png: Buffer; w: number; h: number } | null> {
  const fs = Math.round(Math.max(20 * pw / 380, 13))
  const px = Math.round(fs * 0.75)
  const pt = Math.round(fs * 0.35)
  const gap = Math.round(fs * 0.25)
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const textW = estimateTextWidth(label, fs)
  const netTargetH = Math.round(fs * 0.55)
  const netLogo = await loadNetworkLogoForPill(networkKey, netTargetH, fg)
  if (!netLogo) return null
  // Layout verticale: scritta sopra, logo sotto, centrati orizzontalmente
  const pillW = Math.max(textW, netLogo.w) + px * 2
  const pillH = pt + fs + gap + netLogo.h + pt
  const r = Math.round(pillH / 2)
  const textY = pt + fs / 2
  const logoX = Math.round((pillW - netLogo.w) / 2)
  const logoY = pt + fs + gap + netLogo.h / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillW}" height="${pillH}"><rect width="${pillW}" height="${pillH}" rx="${r}" fill="${bg}" stroke="${topLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.20)"}" stroke-width="1"/><text x="${pillW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label)}" font-weight="700" font-size="${fs}" fill="${fg}">${escSvg(label)}</text><image href="data:image/png;base64,${netLogo.png.toString("base64")}" x="${logoX}" y="${Math.round(logoY - netLogo.h / 2)}" width="${netLogo.w}" height="${netLogo.h}"/></svg>`
  const png = await renderSVG(svg, pillW)
  return { png, w: pillW, h: pillH }
}

// ---------------------------------------------------------------------------
// Image-level caches (colori badge, resize logo/backdrop)
// ---------------------------------------------------------------------------
// Questi passaggi sharp si ripetono a OGNI render freddo, anche per lo stesso
// titolo: cache key poster diverse (config token, rank che cambia, preview
// WYSIWYG, versioni mapping) condividono lo stesso poster/logo/backdrop. Il
// risultato dipende solo dall'immagine sorgente (URL TMDB immutabili per path)
// → si può cachare per path. Nessun cambio dell'output visivo: stesse operazioni
// sharp, stesso ordine, stessi parametri — solo eseguite una volta.

export interface BadgeColorsResult {
  readonly genreColor: string
  readonly rankColor: string
}

/** Colori accent (genere + rank) con cache per (posterSrc, logoSrc, genreName, hueMode, bottomFraction). */
export async function resolveBadgeColors(
  posterBuf: Buffer,
  logoFetch: Buffer | null,
  genreName: string | null,
  posterSrc?: string | null,
  logoSrc?: string | null,
): Promise<BadgeColorsResult> {
  const key = posterSrc ? `extract:${posterSrc}:${logoSrc ?? "x"}:${genreName ?? "x"}` : null
  const cached = key ? cacheGet<BadgeColorsResult>(key) : null
  if (cached) return cached
  const [gColor, rColor] = await Promise.all([
    extractBadgeColor(posterBuf, logoFetch, genreName, 'bottom'),
    extractBadgeColor(posterBuf, logoFetch, null, 'top'),
  ])
  const colors: BadgeColorsResult = {
    genreColor: isValidHex(gColor) ? gColor : (genreName ? GENRE_FALLBACK[genreName] : undefined) || "#555555",
    rankColor: isValidHex(rColor) ? rColor : "#555555",
  }
  if (key) cacheSet(key, colors, [IMAGE_CACHE_TAG], IMAGE_CACHE_TTL)
  return colors
}

export interface ResizedImage {
  readonly input: Buffer
  readonly w: number
  readonly h: number
}

/** Resize logo (con re-encode PNG) cachato per (logoSrc, dimensioni target). */
export async function resizeLogoCached(
  logoFetch: Buffer,
  width: number,
  height: number,
  logoSrc?: string | null,
): Promise<ResizedImage> {
  const key = logoSrc ? `logo-resize:${logoSrc}:${width}:${height}` : null
  const cached = key ? cacheGet<ResizedImage>(key) : null
  if (cached) return cached
  const { data: input, info } = await sharp(logoFetch).resize(width, height, { fit: "inside" }).png({ compressionLevel: 1 }).toBuffer({ resolveWithObject: true })
  const result: ResizedImage = { input, w: info.width || width, h: info.height || height }
  if (key) cacheSet(key, result, [IMAGE_CACHE_TAG], IMAGE_CACHE_TTL)
  return result
}

/** Dimensioni originali del backdrop, cachate per src (salta il metadata() ripetuto). */
export async function backdropMetaCached(
  backdropFetch: Buffer,
  backdropSrc?: string | null,
): Promise<{ readonly width: number; readonly height: number }> {
  const key = backdropSrc ? `backdrop-meta:${backdropSrc}` : null
  const cached = key ? cacheGet<{ width: number; height: number }>(key) : null
  if (cached) return cached
  const meta = await sharp(backdropFetch).metadata()
  const result = { width: meta.width || 1920, height: meta.height || 1080 }
  if (key) cacheSet(key, result, [IMAGE_CACHE_TAG], IMAGE_CACHE_TTL)
  return result
}

/** Resize backdrop cachato per (backdropSrc, dimensioni target). */
export async function resizeBackdropCached(
  backdropFetch: Buffer,
  width: number,
  height: number,
  backdropSrc?: string | null,
): Promise<ResizedImage> {
  const key = backdropSrc ? `backdrop-resize:${backdropSrc}:${width}:${height}` : null
  const cached = key ? cacheGet<ResizedImage>(key) : null
  if (cached) return cached
  const resized = await sharp(backdropFetch).resize(width, height, { fit: 'fill' }).toBuffer()
  const result: ResizedImage = { input: resized, w: width, h: height }
  if (key) cacheSet(key, result, [IMAGE_CACHE_TAG], IMAGE_CACHE_TTL)
  return result
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function generatePosterBuffer(input: GenerationInput): Promise<Buffer> {
  const {
    posterBuf, logoFetch, backdropFetch,
    backdropScale, backdropOffsetX, backdropOffsetY,
    blurEnabled, blurHeight, blurIntensity, blurFade, blurDarkness,
    // Default 20 quando il chiamante non lo passa (test diretti, vecchi adapter).
    tintStrength = 20,
    // Ombra superiore: default 50 = catena di default (test diretti inclusi).
    topShade = 50,
    badgesEnabled, rankingEnabled, genreName, voteAverage, badgeStyle,
    rankingBadgeStyle, badgeGenre, badgeYear, badgeRating, badgeQuality, quality,
    qualityBadgeStyle, videoFormats,
    sashOrder,
    topLight, targetCenter, ribbonSide,
    // Nastro stile Netflix all'angolo: default true (comportamento storico per
    // i chiamanti diretti/test che non passano il campo).
    ribbonEnabled = true,
    // Tinta accent sul default centrato (degrado "colored" senza nastro).
    rankingBadgeAccent = false,
    bottomLight: bottomLightOpt,
    logoScale, logoOffsetX, logoOffsetY,
    topBadgeScale, topBadgeOffsetX, topBadgeOffsetY,
    genreBadgeScale, qualityBadgeScale, networkLogoScale,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    mediaType, finalRank, animeRankResult,
    mapping, tmdbNetworks, productionCompanies, tmdbStudios,
    tmdbNetworksDetailed, productionCompaniesDetailed,
    tvType, tvStatus, releaseDate, firstAirDate,
    lastAirDate, seasonCount, originCountries,
    wikidataResult, tmdbKeywords, locale, t,
    qLabel, queryExtra, qNetLogo, networkLogo, networkLogoPosition = "auto", sd, accentOverride, imdbTop250,
    logoSrc, backdropSrc, analysisKey,
    preRelease = false,
    hideLogo = false,
    logoScrimDisabled,
    logoAlign,
    shape,
    imdbId,
    badgePresetId,
    badgePresetRev,
    badgePresetUser,
  } = input

  // Il badge genere in basso segue la luce del fondo, non del top (su poster
  // con alto chiaro e fondo scuro la pill restava grafite su nero). Chiamanti
  // vecchi/test diretti che non passano bottomLight ricadono sul top.
  const bottomLight = bottomLightOpt ?? topLight

  // Dimensioni canvas: portrait (default, byte-identico al passato) o
  // landscape 16:9 (prova ?shape=landscape, base = backdrop TMDB).
  const CW = shape === "landscape" ? LAND_W : STD_W
  const CH = shape === "landscape" ? LAND_H : STD_H
  // Layout logo per formato: in portrait è SEMPRE "center" per contratto.
  // In landscape può essere "left" (Cinematic) o "center", col logo
  // contenuto nei vincoli del canvas 16:9 (come i bound slider client).
  const align = shape === "landscape" && logoAlign === "left" ? "left" : "center"
  const isLandscape = shape === "landscape"
  const isLandscapeLeft = shape === "landscape" && align === "left"
  // I badge si rendono alla larghezza portrait (stessi pixel assoluti del
  // verticale): sul canvas 16:9 non devono dominare la scena. Posizioni,
  // overflow-protection e chiavi cache restano sul canvas vero (CW/CH):
  // le chiavi in particolare NON usano badgePw, altrimenti i bitmap
  // portrait (stesso pw=500) colliderebbero — fatale per gli stili `bar`
  // full-width.
  const badgePw = shape === "landscape" ? STD_W : CW
  // Il badge superiore centrale (rank/extra) in landscape è reso al 120%:
  // sul canvas 16:9 deve restare il protagonista in alto.
  const topBadgePw = shape === "landscape" ? Math.round(badgePw * 1.2) : badgePw

  // -----------------------------------------------------------------------
  // 1. Backdrop composite layer
  // -----------------------------------------------------------------------
  const composites: PosterComposite[] = []

  if (backdropFetch) {
    const bMeta = await backdropMetaCached(backdropFetch, backdropSrc)
    const bw = bMeta.width
    const bh = bMeta.height
    const bScale = backdropScale / 100
    let bResizedW = Math.round(CW * bScale)
    let bResizedH = Math.round(bh * (bResizedW / bw))
    if (bResizedW > CW) { bResizedH = Math.round(bResizedH * (CW / bResizedW)); bResizedW = CW }
    if (bResizedH > CH) { bResizedW = Math.round(bResizedW * (CH / bResizedH)); bResizedH = CH }
    const bX = Math.round((CW - bResizedW) / 2 + backdropOffsetX)
    const bY = Math.round((CH - bResizedH) / 2 + backdropOffsetY)
    const backdropResized = await resizeBackdropCached(backdropFetch, bResizedW, bResizedH, backdropSrc)
    composites.push({ input: backdropResized.input, top: bY, left: bX })
  }

  // -----------------------------------------------------------------------
  // 2. Blur + badge colors + logo resize (parallel)
  // -----------------------------------------------------------------------
  const year = releaseDate?.slice(0, 4) || firstAirDate?.slice(0, 4) || undefined
  const genreAvailable = !!genreName
  const ratingAvailable = !!(voteAverage && voteAverage > 0)
  const yearAvailable = !!year
  // Il badge è visibile se almeno uno dei 3 componenti è abilitato E disponibile.
  const hasGenreBadge = badgesEnabled
    && ((genreAvailable && badgeGenre) || (ratingAvailable && badgeRating) || (yearAvailable && badgeYear))

  // Tinta di scena same-hue UNICA per badge + blur (coerenza dalla stessa
  // radice). Niente crop per-zone: il bottom-40% falliva sui portrait con
  // facce in basso (es. Silo: votava pelle/tuta #86642d invece dello
  // smeraldo della scena). L'override `ac=` esplicito vince sempre; rete di
  // sicurezza: fallback genere/grigio. resolveBadgeColors resta esportata e
  // testata ma non è più sul path render.
  const sceneTintHex = (blurEnabled || hasGenreBadge || rankingEnabled)
    ? await extractSceneTint(posterBuf, genreName, analysisKey ? `${analysisKey}:${genreName ?? "x"}` : null)
    : null

  const accentColorGenre = accentOverride?.genreColor ?? sceneTintHex ?? (GENRE_FALLBACK[genreName || ""] || "#555555")
  const accentColorRank = accentOverride?.rankColor ?? sceneTintHex ?? "#555555"

  // Override esplicito `ac=` vince sempre; poi tinta di scena; rete di sicurezza: fallback genere
  const blurTintHex = accentOverride?.genreColor ?? sceneTintHex ?? accentColorGenre

  // Logo baked-in in entrambi i formati (hideLogo esplicito lo salta:
  // veicolo del banner Nuvio pulito). In landscape valgono i vincoli del
  // canvas 16:9 — stessi di context.tsx e poster-fit-score.ts (Golden Rule).
  const [blurOverlay, logoResult] = await Promise.all([
    applyBlur({
      posterBuf,
      blurEnabled,
      blurHeight,
      blurIntensity,
      blurFade,
      blurDarkness,
      tintStrength: tintStrength / 100,
      canvasW: CW,
      canvasH: CH,
      accentColor: blurTintHex,
    }),
    logoFetch && !hideLogo
      ? (async () => {
          const lMeta = await sharp(logoFetch).metadata()
          const lw = lMeta.width || 200
          const lh = lMeta.height || 100
          // Single source: logoDefaultScaleFromAspect (logo-selection.ts).
          // (lw/lh hanno sempre fallback > 0, niente guardia null.)
          const defScale = logoDefaultScaleFromAspect(lw, lh) ?? 75
          const uScale = logoScale ?? defScale
          const uOx = logoOffsetX ?? 0
          const uOy = logoOffsetY ?? 0
          const layout = computeLogoLayout({
            posterW: CW, posterH: CH, logoW: lw, logoH: lh,
            logoScale: uScale,
            // Calibrazione geometrica landscape invisibile agli slider (+10 X /
            // -10 Y): si somma agli offset utente espliciti (anche 0), come
            // PORTRAIT_LOGO_TOP_OFFSET in portrait. Gli slider mostrano 0.
            logoOffsetX: uOx + (isLandscape ? LANDSCAPE_LOGO_SHIFT_X : 0),
            logoOffsetY: uOy + (isLandscape ? LANDSCAPE_LOGO_SHIFT_Y : 0),
            hasBadges: hasGenreBadge,
            // Fondo logo in linea col badge genere (~10px dal bordo, vedi
            // costanti landscape in logo-layout.ts). In portrait margine
            // maggiorato solo col badge genere (12% vs 10% storico).
            bottomMarginPct: isLandscape ? LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT : (hasGenreBadge ? 12 : undefined),
            // Vincoli logo per formato (stessi di context.tsx e
            // poster-fit-score.ts): portrait cap solo altezza + calibrazione
            // +10px; landscape contenuto 40% larghezza / 24% altezza.
            ...(isLandscape
              ? { maxWidthPct: LANDSCAPE_LOGO_MAX_WIDTH_PCT, maxHeightPct: LANDSCAPE_LOGO_MAX_HEIGHT_PCT, topOffset: LANDSCAPE_LOGO_TOP_OFFSET }
              : {
                  maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT,
                  topOffset: PORTRAIT_LOGO_TOP_OFFSET,
                }),
            align,
          })
          const resized = await resizeLogoCached(logoFetch, layout.width, layout.height, logoSrc)
          const aW = resized.w
          const aH = resized.h
          return { input: resized.input, top: Math.max(0, Math.round(layout.top + (layout.height - aH))), left: Math.round(layout.left + ((layout.width - aW) / 2)), w: aW, h: aH } as const
        })()
      : Promise.resolve(null),
  ])

  // -----------------------------------------------------------------------
  // 3. Vignette + logo (il blur resta un overlay grezzo, composto nel passo 7)
  // -----------------------------------------------------------------------
  const vigBuf = await getVignette(CW, CH)
  composites.push({ input: vigBuf, top: 0, left: 0 })
  // Cinematic Left: scrim d'angolo per la leggibilità del blocco a sinistra
  // (si somma alla fascia blur bassa, che resta controllata dall'utente).
  if (isLandscapeLeft) {
    composites.push({ input: await getLandscapeScrim(), top: 0, left: 0 })
  }
  // Velo pre-digitale: sopra poster/vignetta ma sotto logo e badge (restano
  // luminosi e leggibili). Costante cachata, nessun cambio di output a flag spento.
  if (preRelease) {
    composites.push({ input: await getPreReleaseDim(CW, CH), top: 0, left: 0 })
  }
  // Ombra lineare superiore (default 50): sopra vignetta/velo ma sotto logo
  // e badge (restano luminosi). A 0 nessun composite (zero pixel cambiati).
  if (topShade > 0) {
    composites.push({ input: await getTopShade(CW, CH, topShade), top: 0, left: 0 })
  }
  if (logoResult) {
    // Rete di sicurezza per la leggibilità: quando il logo e la fascia di poster
    // sotto hanno quasi la stessa luminosità, il logo sparisce. La selezione a
    // monte prova già a evitarlo, ma su un titolo con un solo logo e un solo
    // poster non c'è niente da scegliere. La velatura è proporzionale a quanto
    // manca alla soglia: sopra 3:1 non dipinge nemmeno un pixel.
    const scrim = await (async () => {
      if (logoScrimDisabled) return null
      const [inkLum, zoneLum] = await Promise.all([
        logoInkLuminance(logoFetch!),
        posterLogoZoneLuminance(posterBuf, { left: logoResult.left, top: logoResult.top, width: logoResult.w, height: logoResult.h }),
      ])
      const strength = logoScrimStrength(logoContrast(inkLum, zoneLum))
      if (strength <= 0) return null
      const png = await buildLogoScrim(logoResult.w, logoResult.h, strength, (inkLum ?? 0) > 0.5, CW, CH)
      if (!png) return null
      const meta = await sharp(png).metadata()
      const sw = meta.width ?? 0
      const sh = meta.height ?? 0
      // Anche centrata, la velatura può sporgere: sharp rifiuta un composite che
      // esce dalla tela, quindi la posizione si blocca dentro i bordi.
      return {
        input: png,
        top: Math.min(Math.max(0, Math.round(logoResult.top + logoResult.h / 2 - sh / 2)), Math.max(0, CH - sh)),
        left: Math.min(Math.max(0, Math.round(logoResult.left + logoResult.w / 2 - sw / 2)), Math.max(0, CW - sw)),
      }
    })().catch(() => null)
    if (scrim) composites.push(scrim)
    composites.push(logoResult)
  }

  // -----------------------------------------------------------------------
  // 4. Badge computation
  // -----------------------------------------------------------------------

  const badgeInput: BadgeInput = {
    mediaType,
    tmdbId: input.tmdbId ?? null,
    digitalReleaseDate: input.digitalReleaseDate ?? null,
    releaseDate: releaseDate ?? null,
    firstAirDate: firstAirDate ?? null,
    lastAirDate: lastAirDate ?? null,
    seasonCount: seasonCount ?? null,
    originCountries: [...originCountries],
    voteAverage: voteAverage ?? 0,
    trendRank: finalRank,
    animeRank: animeRankResult,
    awards: wikidataResult.awards,
    nominations: wikidataResult.nominations,
    studios: wikidataResult.studios,
    director: directorBadgeLabel(wikidataResult.director, t),
    tvType: tvType ?? null,
    tvStatus,
    keywords: [...tmdbKeywords],
    imdbTop250: !!imdbTop250,
  }
  const computed = computeTopBadge(badgeInput, t, locale, sashOrder ?? null, input.dateFormat ?? "locale")
  const studioBadge = computed.studioBadge
  const isNetStudio = isNetworkStudio(studioBadge)

  let topBadge: { type: "extra"; label: string } | { type: "rank"; rank: number; label: string } | null = null
  if (rankingEnabled) {
    if (queryExtra) {
      topBadge = { type: "extra" as const, label: queryExtra }
    } else if (computed.badge) {
      const b = computed.badge
      if (b.type === "extra") {
        topBadge = { type: "extra" as const, label: b.label }
      } else {
        topBadge = { type: "rank" as const, rank: b.rank!, label: qLabel || b.rankLabel || b.label }
      }
    }
  }
  // Badge Coming Soon: vince sul badge calcolato ma non sul custom esplicito
  // (`queryExtra`) né sull'upcomingRelease teatrale (che ha già la data).
  // Indipendente da rankingEnabled: è stato del contenuto, non decorazione.
  // Reso come nastro angolare rosso in alto a sinistra (non pill centrale).
  const comingSoonLabel = t("badge.comingSoon")
  if (preRelease && !queryExtra) {
    const isUpcoming = computed.upcomingRelease
      && topBadge?.type === "extra"
      && topBadge.label === computed.upcomingRelease
    if (!isUpcoming) {
      topBadge = { type: "extra" as const, label: comingSoonLabel }
    }
  }
  const showComingSoon = !!preRelease && !queryExtra
    && topBadge?.type === "extra" && topBadge.label === comingSoonLabel
    // Nastro disattivato: il Coming Soon resta come badge extra centrale
    // (ramo rank standard) invece del nastro angolare rosso.
    && ribbonEnabled
  const ribbonLayout = showComingSoon ? comingSoonRibbonLayout(badgePw) : null

  // Network logo (parallel with badge render) — SVG first, TMDB fallback
  const netLogoEnabled = networkLogo ?? (qNetLogo !== null ? qNetLogo !== "0" : (sd.networkLogo !== false && (mapping?.networkLogo ?? true) !== false))
  // Se i candidati dettagliati sono disponibili, usali (con logo_path); altrimenti fallback a soli nomi per retrocompat.
  const hasDetailed = !!(tmdbNetworksDetailed?.length || productionCompaniesDetailed?.length)
  const detailedCandidates: NetworkCandidate[] = hasDetailed
    ? [
        ...(tmdbNetworksDetailed ?? []),
        ...(productionCompaniesDetailed ?? []),
        // Wikidata studios non hanno logo_path TMDB -> solo name
        ...wikidataResult.studios.map((s) => ({ name: s, logoPath: null as string | null })),
        ...tmdbStudios.map((s) => ({ name: s, logoPath: null })),
        ...(isNetStudio ? [] : studioBadge ? [{ name: studioBadge, logoPath: null as string | null }] : []),
        // Mapping salvato come fallback extra (se presente)
        ...(mapping?.networkLogoName ? [{ name: mapping.networkLogoName!, logoPath: mapping.networkLogoPath ?? null }] : []),
      ]
    : []
  const stringCandidates = [
    ...tmdbNetworks,
    ...productionCompanies,
    ...wikidataResult.studios,
    ...tmdbStudios,
    isNetStudio ? null : studioBadge,
  ].filter(Boolean) as string[]
  // Unifica: se abbiamo detailed, usiamo hybrid; altrimenti legacy string path
  const networkCandidatesHybrid: (NetworkCandidate | string)[] = hasDetailed ? detailedCandidates : stringCandidates

  // B1: pass pill + raw in parallelo (prima sequenziali). Semantica
  // preservata: il raw resta usato solo se la pill matcha (stesso match,
  // resa diversa: pill stilizzata vs colori originali). Il doppio
  // download/scan TMDB è eliminato dalla memo in network-svgs.
  const [pillLogoResult, rawLogoResult] = netLogoEnabled
    ? await Promise.all([
        hasDetailed
          ? renderFirstMatchingNetworkLogoBadgeHybrid(networkCandidatesHybrid as NetworkCandidate[], badgePw, topLight)
          : renderFirstMatchingNetworkLogoBadge(stringCandidates, badgePw, topLight),
        hasDetailed
          ? renderFirstMatchingNetworkRawBadgeHybrid(networkCandidatesHybrid as NetworkCandidate[], badgePw, topLight)
          : renderFirstMatchingNetworkRawBadge(stringCandidates, badgePw),
      ])
    : [null, null]
  const networkLogoResult = pillLogoResult
  // Network: sempre visibile quando abilitato, subito sopra il logo film, quasi attaccato — SVG resta raw, TMDB fallback è A (ricolor + ombra) per non risultare scuro.
  const networkRawResult = networkLogoResult ? rawLogoResult : null

  if (networkLogoResult && topBadge && topBadge.type === "extra") {
    const lbl = topBadge.label.toLowerCase().trim()
    const netName = networkLogoResult.matchedName.toLowerCase().trim()
    if (lbl === netName || lbl.includes(netName) || isNetworkStudio(topBadge.label)) {
      topBadge = null
    }
  }

  // -----------------------------------------------------------------------
  // 5. Render genre + ranking badges (parallel with coalescing)
  // -----------------------------------------------------------------------
  // Anime ranking: il badge anime mostra il numero grande con "anime" sotto.
  // Rilevato quando il topBadge è un rank derivato da animeRankResult.
  const isAnimeRank = topBadge?.type === "rank" && animeRankResult !== null && topBadge.rank === animeRankResult

  const hasQualityBadge = badgeQuality !== false && !!quality
  // Icona built-in per stile+tier (null = pill standard). Lo stile entra
  // nella chiave cache: cambio stile = bitmap nuovi, mai collisione.
  const qualityIconPath = qualityBadgeIconPath(qualityBadgeStyle, quality)

  // Placca staccata: solo gli stili centrati (il nastro resta ancorato)
  // con offset Y esplicito arrotondano tutti e 4 gli angoli. Calcolato qui
  // (non nel layout sotto) perché entra nella chiave cache: il bitmap cambia.
  const isRankNetflixRibbonStyle = isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank"
  const isRankDetached = !!topBadge && !isRankNetflixRibbonStyle && topBadgeOffsetY !== 0

  const genreBadgeKey = hasGenreBadge
    ? badgeCacheKey("genre", genreName, voteAverage, CW, year, badgeStyle, accentColorGenre, bottomLight, badgeGenre, badgeYear, badgeRating, genreBadgeScale)
    : null
  const rankBadgeKey = !showComingSoon && topBadge
    ? badgeCacheKey("rank", topBadge.type === "extra" ? topBadge.label : `${(topBadge as { rank: number }).rank}:${topBadge!.label}`, CW, topLight, rankingBadgeStyle, accentColorRank, ribbonSide, isAnimeRank, topBadgeScale, isRankDetached ? "detached" : undefined, rankingBadgeAccent ? "accent" : undefined)
    : null
  const formatsKey = (videoFormats && videoFormats.length > 0) ? videoFormats.join(",") : "none"
  const qualityBadgeKey = hasQualityBadge
    ? badgeCacheKey("quality", quality, CW, topLight, qualityBadgeScale, qualityIconPath ?? "std", formatsKey)
    : null
  const comingSoonKey = showComingSoon
    ? badgeCacheKey("comingsoon", comingSoonLabel, CW, topLight, ribbonSide)
    : null

  // Badge preset custom (?badgePreset=<id>&prv=<rev>): il design sostituisce
  // il bitmap dello slot corrispondente, preservando layout/posizioni/scale
  // esistenti. Il preset segue i master toggle dello slot (badgesEnabled /
  // rankingEnabled) ma non richiede valori computati; assente, privato
  // altrui o con testo vuoto → fallback silenzioso sullo stile standard.
  const presetForPoster = await getPresetForPoster(badgePresetId, badgePresetRev, badgePresetUser)
  const presetVarCtx: BadgeVariableContext = {
    rating: voteAverage ? voteAverage.toFixed(1) : null,
    year: year ?? null,
    genre: genreName,
    rank: finalRank ?? animeRankResult ?? null,
    imdb: imdbId ?? null,
    tmdb: input.tmdbId != null ? String(input.tmdbId) : null,
  }
  const useGenrePreset = !!presetForPoster && presetForPoster.target === "genre" && badgesEnabled
  const useTopPreset = !!presetForPoster && presetForPoster.target === "top" && rankingEnabled && !showComingSoon
  const genrePresetKey = useGenrePreset && presetForPoster
    ? badgeCacheKey("preset-genre", presetForPoster.id, presetForPoster.revision, badgePw, voteAverage, year, genreName, finalRank, animeRankResult ?? "noanime-rank", imdbId ?? "noimdb", input.tmdbId ?? "notmdb", topLight ? "tl1" : "tl0", bottomLight ? "bl1" : "bl0", accentColorGenre ?? "noac", ribbonSide, isAnimeRank ? "anime" : "noanime")
    : null
  const topPresetKey = useTopPreset && presetForPoster
    ? badgeCacheKey("preset-top", presetForPoster.id, presetForPoster.revision, topBadgePw, voteAverage, year, genreName, finalRank, animeRankResult ?? "noanime-rank", imdbId ?? "noimdb", input.tmdbId ?? "notmdb", topLight ? "tl1" : "tl0", bottomLight ? "bl1" : "bl0", accentColorRank ?? "noac", ribbonSide, isAnimeRank ? "anime" : "noanime")
    : null

  // Render standard esternalizzati per il fallback: se il preset risolve un
  // testo vuoto (es. {{rank}} senza rank), si degrada sullo stile
  // preesistente invece di lasciare lo slot vuoto.
  const renderStandardGenre = async (): Promise<{ png: Buffer; w: number; h: number } | null> =>
    genreBadgeKey
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(genreBadgeKey)
          || coalesceBadgeRender(genreBadgeKey, () =>
                renderGenreBadge(genreName ?? "", voteAverage ?? 0, badgePw, year, badgeStyle, accentColorGenre, bottomLight, { showGenre: badgeGenre, showYear: badgeYear, showRating: badgeRating }, badgeStyle === "bar" ? genreBadgeScale : 100)
                .then((r) => { if (r) cacheSet(genreBadgeKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
      : Promise.resolve(null)
  const renderStandardRank = async (): Promise<{ png: Buffer; w: number; h: number; isRank?: boolean } | null> =>
    rankBadgeKey
      ? (cacheGet<{ png: Buffer; w: number; h: number; isRank?: boolean }>(rankBadgeKey)
          || coalesceBadgeRender(rankBadgeKey, () => {
              if (topBadge!.type === "extra") {
                // Senza nastro il "colored" colora il badge default (il builder
                // extra centra già di suo con tinta accent: stesso contratto).
                return renderExtraBadge(topBadge!.label, topBadgePw, topLight, rankingBadgeAccent ? "colored" : rankingBadgeStyle, accentColorRank, isRankDetached)
                  .then((r) => { const v = { ...r, isRank: false }; cacheSet(rankBadgeKey, v, ["badge"], BADGE_CACHE_TTL); return v })
              }
              return renderRankingBadge((topBadge as { rank: number }).rank, isRibbonRankingStyle(rankingBadgeStyle) ? badgePw : topBadgePw, topBadge!.label, topLight, rankingBadgeStyle, accentColorRank, ribbonSide, isAnimeRank, isRankDetached, rankingBadgeAccent)
                .then((r) => { const v = { ...r, isRank: true }; cacheSet(rankBadgeKey, v, ["badge"], BADGE_CACHE_TTL); return v })
            }))
      : Promise.resolve(null)
  const renderPresetGenre = async (): Promise<{ png: Buffer; w: number; h: number } | null> =>
    genrePresetKey && presetForPoster
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(genrePresetKey)
          || coalesceBadgeRender(genrePresetKey, () =>
                (presetForPoster.variant === "house"
                  ? buildHousePresetBadgeSVG(presetForPoster, presetVarCtx, badgePw, {
                      topLight,
                      bottomLight,
                      accentColor: accentColorGenre,
                    })
                  : buildCustomPresetBadgeSVG(presetForPoster, presetVarCtx, badgePw)
                )
                .then((r) => { if (r) cacheSet(genrePresetKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
      : Promise.resolve(null)
  const renderPresetTop = async (): Promise<{ png: Buffer; w: number; h: number; isRank?: boolean } | null> =>
    topPresetKey && presetForPoster
      ? (cacheGet<{ png: Buffer; w: number; h: number; isRank?: boolean }>(topPresetKey)
          || coalesceBadgeRender(topPresetKey, () =>
                (presetForPoster.variant === "house"
                  ? buildHousePresetBadgeSVG(presetForPoster, presetVarCtx, topBadgePw, {
                      topLight,
                      bottomLight,
                      accentColor: accentColorRank,
                      side:
                        isRibbonRankingStyle(presetForPoster.house?.style) && presetForPoster.house?.side
                          ? presetForPoster.house.side
                          : ribbonSide === "right"
                            ? "right"
                            : "left",
                      isAnime: isAnimeRank,
                    })
                  : buildCustomPresetBadgeSVG(presetForPoster, presetVarCtx, topBadgePw)
                )
                .then((r) => { const v = r ? { ...r, isRank: false } : null; if (v) cacheSet(topPresetKey, v, ["badge"], BADGE_CACHE_TTL); return v })
            ))
      : Promise.resolve(null)

  const [genreBadgeResult, rankBadgeResult, qualityBadgeResult, comingSoonResult] = await Promise.all([
    useGenrePreset && presetForPoster
      ? renderPresetGenre().then((r) => r ?? renderStandardGenre())
      : renderStandardGenre(),
    useTopPreset && presetForPoster
      ? renderPresetTop().then((r) => r ?? renderStandardRank())
      : renderStandardRank(),
    qualityBadgeKey
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(qualityBadgeKey)
          || coalesceBadgeRender(qualityBadgeKey, async () => {
              const res = await renderQualityBadgeGroup(quality!, qualityBadgeStyle, videoFormats, badgePw, topLight)
              if (res) cacheSet(qualityBadgeKey, res, ["badge"], BADGE_CACHE_TTL)
              return res
            }))
      : Promise.resolve(null),
    comingSoonKey
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(comingSoonKey)
          || coalesceBadgeRender(comingSoonKey, () =>
              renderComingSoonRibbon(comingSoonLabel, badgePw, ribbonSide === "right" ? "right" : "left")
                .then((r) => { if (r) cacheSet(comingSoonKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
      : Promise.resolve(null),
  ])

  // -----------------------------------------------------------------------
  // 6. Position badges + network logo
  // -----------------------------------------------------------------------
  // Scale %: resize dei bitmap dopo il render (tutti gli stili; la barra
  // genere scala nativa via font nel builder per restare full-width), prima
  // del fit — così fitBadgeToCanvas garantisce comunque il contenimento nel
  // canvas. B2: 4 await sequenziali → un Promise.all.
  // La cache resta valida (chiave senza scala): la scala si applica a valle.
  // Tutta la matematica di posizione/overlap sotto usa già le dimensioni
  // scalate. La posizione del badge genere usa safeGenreBadgeResult.h.
  const [rankBadgeForLayout, genreBadgeForLayout, qualityBadgeForLayout, networkLogoForLayout] = await Promise.all([
    rankBadgeResult
      ? (async () => {
          // Landscape: scala % + riduzione -20px in UN solo resize (prima due
          // resize sharp in serie sullo stesso bitmap). Stesse dimensioni
          // finali del vecchio codice, un solo passaggio di ricampionamento.
          if (shape === "landscape") {
            const scaledH = Math.max(1, Math.round(rankBadgeResult.h * topBadgeScale / 100))
            const scaledW = Math.max(1, Math.round(rankBadgeResult.w * topBadgeScale / 100))
            const targetH = Math.max(1, scaledH - 20)
            const targetW = Math.max(1, Math.round(scaledW * (targetH / scaledH)))
            if (targetH !== rankBadgeResult.h || targetW !== rankBadgeResult.w) {
              const png = await sharp(rankBadgeResult.png).resize(targetW, targetH).toBuffer()
              return { ...rankBadgeResult, png, w: targetW, h: targetH }
            }
            return rankBadgeResult
          }
          return topBadgeScale !== 100
            ? await scaleBitmapForLayout(rankBadgeResult, topBadgeScale)
            : rankBadgeResult
        })()
      : Promise.resolve(null),
    genreBadgeResult && genreBadgeScale !== 100 && (badgeStyle !== "bar" || useGenrePreset)
      ? scaleBitmapForLayout(genreBadgeResult, genreBadgeScale)
      : Promise.resolve(genreBadgeResult),
    qualityBadgeResult && qualityBadgeScale !== 100
      ? scaleBitmapForLayout(qualityBadgeResult, qualityBadgeScale)
      : Promise.resolve(qualityBadgeResult),
    networkRawResult && networkLogoScale !== 100
      ? scaleBitmapForLayout(networkRawResult, networkLogoScale)
      : Promise.resolve(networkRawResult),
  ])
  const [safeGenreBadgeResult, safeRankBadgeResult, safeQualityBadgeResult, safeComingSoonResult] = await Promise.all([
    genreBadgeForLayout ? fitBadgeToCanvas(genreBadgeForLayout, CW, CH) : Promise.resolve(null),
    rankBadgeForLayout ? fitBadgeToCanvas(rankBadgeForLayout, CW, CH) : Promise.resolve(null),
    qualityBadgeForLayout ? fitBadgeToCanvas(qualityBadgeForLayout, CW, CH) : Promise.resolve(null),
    comingSoonResult ? fitBadgeToCanvas(comingSoonResult, CW, CH) : Promise.resolve(null),
  ])

  if (safeGenreBadgeResult) {
    const landscapeShiftX = shape === "landscape" ? -55 : 0
    // Landscape: badge in basso a DESTRA invece che centrato (vale per
    // preview, poster e banner — unica verità visiva). Il portrait resta storico.
    // Micro-calibrazione ottica dell'ancoraggio destro: +40px verso il bordo
    // (clamp anti-overflow: mai fuori canvas).
    const anchorRight = shape === "landscape"
    const anchorShiftX = anchorRight ? 40 : 0
    const rightPadX = Math.round(18 * CW / 380)
    if (badgeStyle === "bar") {
      // In landscape la barra è resa a badgePw (non full-width): col banner
      // va a destra come gli altri stili; altrimenti (portrait) resta
      // full-width ancorata a sinistra. (Nel ramo false shape è di certo
      // portrait per costruzione di anchorRight: niente ternario shape.)
      const barLeft = anchorRight
        ? Math.min(CW - safeGenreBadgeResult.w, Math.max(0, CW - safeGenreBadgeResult.w - rightPadX + anchorShiftX))
        : (isLandscapeLeft
          ? logoAlignPadX(CW) + genreBadgeOffsetX
          : 0) + landscapeShiftX
      composites.push({ input: safeGenreBadgeResult.png, top: CH - safeGenreBadgeResult.h, left: barLeft })
    } else {
      // Offset solo stili centrati: la barra resta ancorata full-width.
      // In Cinematic Left la riga metadati sta sotto il logo a sinistra.
      // Posizione unificata: altezza standardizzata per tutti gli stili, la baseline del testo non salta.
      // Bordo/vetro in landscape: troppo incollati all'angolo → -30px X,
      // -15px Y (con e senza separati: si somma allo shift sep).
      const styleCornerShiftX = anchorRight && (badgeStyle === "bordo" || badgeStyle === "vetro") ? 30 : 0
      const styleCornerShiftY = anchorRight && (badgeStyle === "bordo" || badgeStyle === "vetro") ? 15 : 0
      // Ombra/minimale in landscape: testo nudo, +10px verso l'alto per
      // staccarlo dal bordo (con e senza separati).
      const styleLiftY = anchorRight && (badgeStyle === "shadow" || badgeStyle === "minimal") ? 10 : 0
      const genreTopFor = (h: number) => Math.min(CH - h, CH - h - Math.max(0, Math.round(targetCenter - h / 2)) + genreBadgeOffsetY - styleCornerShiftY - styleLiftY)
      // Separati attivi: il segmento ★ sparisce e la pill si restringe —
      // ancorata a destra, la massa visiva andrebbe a destra. Si compensa di
      // metà larghezza rimossa così il centro resta dov'era con ★ (solo
      // landscape: in portrait è già centrato). Misura dal render reale con
      // ★ (stesso builder, chiave cache dedicata: niente stime che
      // divergono con shrink overflow e metriche dei font).
      let sepCenterShift = 0
      if (anchorRight && !useGenrePreset && genreBadgeResult && (input.separateRatings?.length ?? 0) > 0) {
        const fullKey = badgeCacheKey("genre", genreName, voteAverage, CW, year, badgeStyle, accentColorGenre, bottomLight, badgeGenre, badgeYear, true, genreBadgeScale)
        const fullHit = cacheGet<{ png: Buffer; w: number; h: number }>(fullKey)
        const fullW = fullHit
          ? fullHit.w
          : await coalesceBadgeRender(fullKey, () =>
              renderGenreBadge(genreName ?? "", voteAverage ?? 0, badgePw, year, badgeStyle, accentColorGenre, bottomLight, { showGenre: badgeGenre, showYear: badgeYear, showRating: true }, 100)
                .then((r) => { if (r) cacheSet(fullKey, r, ["badge"], BADGE_CACHE_TTL); return r }),
            ).then((r) => (r ? r.w : null), () => null)
        if (fullW != null && fullW > genreBadgeResult.w) {
          sepCenterShift = Math.round(((fullW - genreBadgeResult.w) / 2) * (genreBadgeScale / 100))
        }
      }
      const genreLeftFor = (w: number) => anchorRight
        ? Math.min(CW - w, Math.max(0, CW - w - rightPadX + anchorShiftX + genreBadgeOffsetX - sepCenterShift - styleCornerShiftX))
        : (isLandscapeLeft
          ? logoAlignPadX(CW) + genreBadgeOffsetX
          : Math.round((CW - w) / 2) + genreBadgeOffsetX) + landscapeShiftX
      let genreBox = safeGenreBadgeResult
      let genreTop = genreTopFor(genreBox.h)
      let genreLeft = genreLeftFor(genreBox.w)
      // Logo film grande + badge genere: se si sovrappongono si rimpicciolisce
      // il badge (mai il logo: è il protagonista e la sua scala è un controllo
      // utente esplicito). Min 0.7 (testo, deve restare leggibile), poi
      // ri-ancoraggio come sopra.
      if (logoResult) {
        const overlapsLogo = (w: number, h: number, left: number, top: number) =>
          left < logoResult.left + logoResult.w && left + w > logoResult.left &&
          top < logoResult.top + logoResult.h && top + h > logoResult.top
        if (overlapsLogo(genreBox.w, genreBox.h, genreLeft, genreTop)) {
          let scale = 1
          const minScale = 0.7
          let curW = genreBox.w
          let curH = genreBox.h
          while (scale > minScale && overlapsLogo(curW, curH, genreLeftFor(curW), genreTopFor(curH))) {
            scale -= 0.1
            if (scale < minScale) scale = minScale
            const newW = Math.max(1, Math.round(genreBox.w * scale))
            const newH = Math.max(1, Math.round(genreBox.h * scale))
            if (newW === curW && newH === curH) break
            curW = newW
            curH = newH
            if (scale <= minScale) break
          }
          if (curW !== genreBox.w || curH !== genreBox.h) {
            const png = await sharp(genreBox.png).resize(curW, curH).toBuffer()
            genreBox = { ...genreBox, png, w: curW, h: curH }
            genreTop = genreTopFor(curH)
            genreLeft = genreLeftFor(curW)
          }
        }
      }
      composites.push({ input: genreBox.png, top: genreTop, left: genreLeft })
    }
  }
  // Riga custom provider: se renderizzata, la colonna separati si nasconde
  // (mai due stack di rating impilati — il provider vince).
  let customRowRendered = false
  if (input.ratings?.length) {
    // Optional enrichment must never prevent the original poster from rendering.
    // La riga sta sopra il badge genere, in basso: stessa polarità del fondo.
    const row = await renderMultiRatings(input.ratings, CW - 40, bottomLight).catch(() => null)
    if (row) {
      const legacyTop = safeGenreBadgeResult
        ? (badgeStyle === "bar" ? CH - safeGenreBadgeResult.h
          : CH - safeGenreBadgeResult.h - Math.max(0, Math.round(targetCenter - safeGenreBadgeResult.h / 2)) + genreBadgeOffsetY)
        : CH - 20
      composites.push({ input: row.png, left: Math.round((CW - row.w) / 2), top: Math.max(0, legacyTop - row.h - 10) })
      customRowRendered = true
    }
  }
  const isRightRibbon = ribbonSide === "right"
  // Nastro preset: lato effettivo (house side vince sul mapping; custom segue
  // il mapping). Serve sopra (ancoraggio) e sotto (qualità a sinistra).
  const presetIsRibbon = !!useTopPreset && !!presetForPoster && (presetForPoster.design?.shape === "ribbon" || (presetForPoster.variant === "house" && isRibbonRankingStyle(presetForPoster.house?.style)))
  const presetRibbonRight =
    presetIsRibbon &&
    (presetForPoster?.variant === "house" &&
    isRibbonRankingStyle(presetForPoster.house?.style) &&
    presetForPoster.house?.side
      ? presetForPoster.house.side === "right"
      : isRightRibbon)
  let finalRankBadge = safeRankBadgeResult as { png: Buffer; w: number; h: number } | null
  let finalRankLeft: number | null = null
  let finalRankTop = 0
  if (safeRankBadgeResult) {
    // Il nastro Netflix è ancorato a sinistra SOLO quando il badge è davvero un
    // ranking "netflix" (type rank). Un badge personalizzato/extra va SEMPRE
    // centrato, anche se lo stile selezionato è "netflix": altrimenti esce
    // decentrato a sinistra. Eccezione: un preset top ribbon/netflix è un
    // nastro per costruzione e segue l'ancoraggio d'angolo.
    const isNetflixRibbon =
      (isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank") || presetIsRibbon
    // Offset X/Y solo sui centrati: il nastro resta ancorato (per scelta
    // utente esplicita gli offset non lo toccano).
    const isCentered = !isNetflixRibbon
    // La pill centrale è staccata di 10px dal bordo alto (misura fissa decisa
    // in editor). Default a filo top. Solo pill, indipendente dal badge qualità.
    const pillTopGap = rankingBadgeStyle === "pill" ? 10 : 0
    let left: number
    if (isNetflixRibbon && (presetIsRibbon ? presetRibbonRight : isRightRibbon)) {
      left = Math.round(CW - safeRankBadgeResult.w) // nastro a destra (Stremio o side del preset)
    } else if (isNetflixRibbon) {
      left = 0 // nastro Netflix a sinistra (Nuvio, default)
    } else {
      // Badge grande al centro, dimensione invariata: in caso di sovrapposizione
      // si rimpiccioliscono i badge laterali (network e qualità agli angoli opposti).
      left = Math.round((CW - safeRankBadgeResult.w) / 2) + topBadgeOffsetX
    }
    finalRankBadge = safeRankBadgeResult
    finalRankLeft = left
    finalRankTop = isCentered ? topBadgeOffsetY + pillTopGap : 0

    // Il badge centrale resta invariato — la gestione overlap vive nei blocchi
    // network/qualità qui sotto (shrink dei laterali).
  }
  if (finalRankBadge && finalRankLeft !== null) {
    composites.push({
      input: finalRankBadge.png,
      top: finalRankTop,
      left: finalRankLeft,
    })
  }
  // Nastro Coming Soon: angolo in alto (a sinistra; a destra con side="right"), sopra il badge centrale
  // (quando coesistono per custom esplicito) e sopra il velo pre-digitale.
  if (safeComingSoonResult && ribbonLayout) {
    composites.push({
      input: safeComingSoonResult.png,
      top: -ribbonLayout.offset,
      left: ribbonSide === "right" ? Math.round(CW - safeComingSoonResult.w + ribbonLayout.offset) : -ribbonLayout.offset,
    })
  }
  // Network: centrato sopra il logo film quando c'è un badge alto
  // (nastro Netflix, badge centrale rank/extra, o angolo Coming Soon);
  // angolo in alto negli altri casi (a destra in vista Stremio con nastro,
  // altrimenti a sinistra). Senza logo film resta
  // il layout storico (top-left, o a fianco del nastro).
  // netTopLeftBottom traccia il fondo del logo network quando occupa il top-left (per qualità Stremio sotto).
  // Tuning editoriale globale (default per tutti i poster): pill network +10px Y.
  const NETWORK_LOGO_SHIFT_Y = 10
  let netTopLeftBottom: number | null = null
  // Modalità "in alto" (query `netPos=top` > mapping > config > defaults):
  // sempre all'angolo superiore. "auto" = specchio dinamico odierno.
  const netForceTop = networkLogoPosition === "top"
  // La qualità legge da qui se il network è finito a destra in modo "top"
  // (trasloca a sinistra come col nastro a destra).
  let netAnchoredRight = false
  if (networkLogoForLayout) {
    const gap = Math.round(6 * CH / 570)
    let fittedRaw = await fitBadgeToCanvas(networkLogoForLayout, CW, CH)
    if (fittedRaw) {
      let top: number
      let left: number
      const isNetflixRibbon = isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank"
      const hasComingSoonCorner = showComingSoon && !!ribbonLayout && !!safeComingSoonResult
      const netPadX = Math.round(18 * CW / 380)
      const netPadY = Math.round(18 * CH / 570)

      // Vista Stremio: il logo network specchia a destra quando l'angolo
      // destro è occupato — di fianco al nastro rank (come a sinistra in
      // vista Nuvio), sotto il Coming Soon (come a sinistra). La qualità va
      // già a sinistra in quei casi. Senza occupante destro resta a sinistra
      // (coesistenza pacifica con la qualità top-right).
      const rightRankRibbonOccupied =
        (((isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank") || presetIsRibbon) &&
          (presetIsRibbon ? presetRibbonRight : ribbonSide === "right") &&
          !!finalRankBadge)
      const comingSoonRightOccupied = showComingSoon && !!ribbonLayout && !!safeComingSoonResult && ribbonSide === "right"
      const rightRankRibbonLeft = rightRankRibbonOccupied && finalRankBadge && finalRankLeft !== null ? finalRankLeft : null
      const mirrorNetworkBeside = rightRankRibbonLeft !== null
      const mirrorNetworkBelow = !mirrorNetworkBeside && comingSoonRightOccupied
      const comingSoonRightBottom = (comingSoonRightOccupied && ribbonLayout) ? ribbonLayout.extent : 0
      const rightAnchoredLeft = Math.max(0, CW - fittedRaw.w - netPadX)

      // Il badge centrale resta invariato: se si sovrappone al network,
      // rimpicciolisce il network (fino a 0.55x). B2: la scala finale è
      // calcolata aritmeticamente (l'overlap dipende solo da w/h, funzioni
      // deterministiche della scala) + UN solo resize — prima ogni step
      // intermedio faceva un resize sharp poi scartato (fino a ~7).
      const shrinkToAvoidRank = async <T extends BadgeRender>(box: T, top: number, left: number): Promise<T> => {
        if (finalRankBadge && finalRankLeft !== null) {
          const rankL = finalRankLeft
          const rankR = finalRankLeft + finalRankBadge.w
          const rankB = finalRankTop + finalRankBadge.h
          const overlapsAt = (w: number, h: number) =>
            left < rankR + 6 && left + w > rankL - 6 && top < rankB + 4 && top + h > netPadY - 4
          let scale = 1
          const minScale = 0.55
          let curW = box.w
          let curH = box.h
          while (scale > minScale && overlapsAt(curW, curH)) {
            scale -= 0.07
            if (scale < minScale) scale = minScale
            const newW = Math.max(1, Math.round(box.w * scale))
            const newH = Math.max(1, Math.round(box.h * scale))
            if (newW === curW && newH === curH) break
            curW = newW
            curH = newH
            if (scale <= minScale) break
          }
          if (curW !== box.w || curH !== box.h) {
            const png = await sharp(box.png).resize(curW, curH).toBuffer()
            return { ...box, png, w: curW, h: curH }
          }
        }
        return box
      }

      if (netForceTop) {
        // Angolo superiore, lato del nastro EFFETTIVO (reso, non impostato):
        // solo con nastro rank/preset o Coming Soon a destra va a destra,
        // con tutti gli altri badge (o senza) resta a sinistra — anche in
        // vista Stremio. Restano: stacking sotto il Coming Soon del lato,
        // shift a fianco del nastro sullo stesso lato (stessa matematica dei
        // rami storici) e shrink vs badge centrale. Il ramo "sopra il logo
        // film" non vale in "top": l'angolo è l'angolo.
        const sideRight = rightRankRibbonOccupied || comingSoonRightOccupied
        const csExtent = ribbonLayout ? ribbonLayout.extent : 0
        const csOnSide = showComingSoon && !!ribbonLayout && !!safeComingSoonResult &&
          (sideRight ? ribbonSide === "right" : ribbonSide !== "right")
        if (sideRight && rightRankRibbonLeft !== null) {
          // Stessa riga a fianco del nastro destro (specchio Nuvio).
          top = netPadY
          left = Math.max(0, rightRankRibbonLeft - 10 - fittedRaw.w)
        } else if (csOnSide) {
          top = csExtent + gap
          left = sideRight ? rightAnchoredLeft : netPadX
        } else {
          top = netPadY
          left = sideRight ? rightAnchoredLeft : netPadX
          if (!sideRight) {
            const leftRibbon =
              ((isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank") || presetIsRibbon) &&
              (presetIsRibbon ? !presetRibbonRight : ribbonSide !== "right")
            if (leftRibbon && finalRankBadge && finalRankLeft !== null) {
              const ribbonRight = finalRankLeft + finalRankBadge.w
              const netRight = left + fittedRaw.w
              const netBottom = top + fittedRaw.h
              const overlapX = left < ribbonRight + 6 && netRight > finalRankLeft - 6
              const overlapY = top < finalRankTop + finalRankBadge.h + 4 && netBottom > finalRankTop - 4
              if (overlapX && overlapY) {
                left = Math.round(ribbonRight + 10)
                const maxLeft = CW - fittedRaw.w - netPadX
                if (left > maxLeft) left = maxLeft
              }
            }
          }
        }
        fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        // Solo a sinistra alimenta lo stacking qualità (a destra la qualità
        // ha già traslocato a sinistra, niente da impilare).
        if (!sideRight) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
        else netAnchoredRight = true
      } else if (isLandscape && logoResult) {
        // Landscape col logo film: mai sopra il logo (zona bassa) — sempre
        // in alto: a fianco del nastro se occupa l'angolo sinistro (stile
        // Netflix), sotto il Coming Soon se occupa quell'angolo, altrimenti
        // top-left (con shrink vs badge centrale). Solo landscape: il
        // portrait resta sul ramo storico sotto.
        const leftRibbon =
          ((isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank") || presetIsRibbon) &&
          (presetIsRibbon ? !presetRibbonRight : ribbonSide !== "right")
        if (leftRibbon && finalRankBadge && finalRankLeft !== null) {
          top = netPadY
          left = netPadX
          const ribbonRight = finalRankLeft + finalRankBadge.w
          const netRight = left + fittedRaw.w
          const netBottom = top + fittedRaw.h
          const overlapX = left < ribbonRight + 6 && netRight > finalRankLeft - 6
          const overlapY = top < finalRankTop + finalRankBadge.h + 4 && netBottom > finalRankTop - 4
          if (overlapX && overlapY) {
            left = Math.round(ribbonRight + 10)
            const maxLeft = CW - fittedRaw.w - netPadX
            if (left > maxLeft) left = maxLeft
          }
        } else if (rightRankRibbonLeft !== null) {
          // Di fianco al nastro a destra, stessa riga (specchio Nuvio).
          top = netPadY
          left = Math.max(0, rightRankRibbonLeft - 10 - fittedRaw.w)
          fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        } else if (mirrorNetworkBelow) {
          // Sotto il Coming Soon a destra, ancorato a destra.
          top = comingSoonRightBottom + gap
          left = rightAnchoredLeft
          fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        } else if (showComingSoon && ribbonLayout && ribbonSide !== "right") {
          top = ribbonLayout.extent + gap
          left = netPadX
        } else {
          top = netPadY
          left = netPadX
          fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        }
        if (rightRankRibbonLeft === null && !mirrorNetworkBelow) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      } else if (logoResult && (finalRankBadge || hasComingSoonCorner)) {
        // Con logo film + badge alto (nastro Netflix, badge centrale
        // rank/extra, o Coming Soon): subito sopra il logo film
        // (in Cinematic Left allineato a sinistra come sopratitolo, non centrato).
        top = Math.max(0, logoResult.top - fittedRaw.h - gap)
        left = isLandscapeLeft ? logoResult.left : Math.round((CW - fittedRaw.w) / 2)
      } else if (!isNetflixRibbon && !logoResult) {
        // Senza logo film e senza nastro Netflix: in alto a sinistra;
        // con il nastro Coming Soon impilato sotto di esso (stesso angolo).
        // Specchio Stremio: sotto il Coming Soon destro, ancorato a destra.
        if (mirrorNetworkBelow) {
          top = comingSoonRightBottom + gap
          left = rightAnchoredLeft
        } else {
          top = (showComingSoon && ribbonLayout && ribbonSide !== "right") ? ribbonLayout.extent + gap : netPadY
          left = netPadX
        }
        fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        if (!mirrorNetworkBelow) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      } else if (logoResult) {
        // Con logo film ma SENZA alcun badge alto (né nastro Netflix, né
        // Coming Soon, né badge centrale): angolo in alto (sotto il Coming
        // Soon destro in vista Stremio, altrimenti a sinistra).
        if (mirrorNetworkBelow) {
          top = comingSoonRightBottom + gap
          left = rightAnchoredLeft
        } else {
          top = netPadY
          left = netPadX
        }
        fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        if (!mirrorNetworkBelow) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      } else {
        // Con nastro Netflix senza logo film: top-left o a fianco del nastro;
        // specchio Stremio: sotto l'occupante destro, ancorato a destra.
        top = netPadY
        left = netPadX
        const isNetflixLeftRibbon = ribbonSide !== "right" && finalRankBadge && finalRankLeft !== null
        if (isNetflixLeftRibbon) {
          const ribbonRight = finalRankLeft! + finalRankBadge!.w
          const netRight = left + fittedRaw.w
          const netBottom = top + fittedRaw.h
          const overlapX = left < ribbonRight + 6 && netRight > finalRankLeft! - 6
          const overlapY = top < finalRankTop + finalRankBadge!.h + 4 && netBottom > finalRankTop - 4
          if (overlapX && overlapY) {
            left = Math.round(ribbonRight + 10)
            const maxLeft = CW - fittedRaw.w - netPadX
            if (left > maxLeft) left = maxLeft
          }
        } else if (rightRankRibbonLeft !== null) {
          // Di fianco al nastro a destra, stessa riga (specchio Nuvio).
          top = netPadY
          left = Math.max(0, rightRankRibbonLeft - 10 - fittedRaw.w)
          fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        } else if (mirrorNetworkBelow) {
          // Sotto il Coming Soon a destra, ancorato a destra.
          top = comingSoonRightBottom + gap
          left = rightAnchoredLeft
          fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        }
        if (rightRankRibbonLeft === null && !mirrorNetworkBelow) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      }
      composites.push({
        input: fittedRaw.png,
        // Offset applicati DOPO il posizionamento automatico (come il badge
        // qualità): la logica overlap/shrink ragiona sulla posizione ancorata.
        // NETWORK_LOGO_SHIFT_Y è default globale (tuning editoriale), non
        // offset utente: sposta anche l'ancora netTopLeftBottom sotto.
        top: top + networkLogoOffsetY + NETWORK_LOGO_SHIFT_Y,
        left: left + networkLogoOffsetX,
      })
    }
  }

  // Qualità: in alto a destra di default; con nastro Netflix o Coming Soon a destra (Stremio)
  // va a sinistra per non restargli accanto — sopra il logo network se libero,
  // altrimenti impilata sotto di esso. Top allineato al logo network.
  // Il badge centrale resta invariato: se si sovrappone alla qualità,
  // rimpicciolisce la qualità (fino a 0.55x).
  let qualityStackAnchor: { top: number; centerX: number; leftCorner: boolean } | null = null
  if (safeQualityBadgeResult) {
    const netBaseTop = Math.round(18 * CH / 570)
    const netPadX = Math.round(18 * CW / 380)
    const isNetflixRight = isRibbonRankingStyle(rankingBadgeStyle) && ribbonSide === "right" && topBadge?.type === "rank"
    const isComingSoonRight = showComingSoon && ribbonSide === "right" && !!ribbonLayout
    // Network "in alto" finito a destra: la qualità trasloca a sinistra
    // come col nastro a destra (stesso branch, niente overlap sull'angolo).
    const isRightRibbonCorner = (isNetflixRight && !!finalRankBadge) || isComingSoonRight || (presetRibbonRight && !!finalRankBadge) || (!!networkLogoForLayout && netAnchoredRight)

    // Ancoraggio base: top = netBaseTop - 10 + 5 (storia editoriale: era -20).
    // Griglia laterale a box: il respiro del box qualità è uguale a quello del
    // network (netPadX) su entrambi i lati. Il bitmap include il padding ombra
    // simmetrico: il pad scala col rapporto w finale/w render.
    // Lo stacking sotto il logo network resta invariato (lì conta non
    // sovrapporsi, non la misura).
    const qPad = qualityBadgeResult?.w
      ? Math.round(TOP_SHADOW_PAD * safeQualityBadgeResult.w / qualityBadgeResult.w)
      : TOP_SHADOW_PAD
    let top = netBaseTop - 10 + 5
    let left = isRightRibbonCorner
      ? netPadX - qPad
      : CW - netPadX - (safeQualityBadgeResult.w - qPad)
    let finalQualityBadge = safeQualityBadgeResult

    if (isRightRibbonCorner) {
      // Nastro a destra (Netflix o Coming Soon): qualità a sinistra, speculare
      // all'angolo destro standard — impilata sotto il logo network se presente.
      if (netTopLeftBottom !== null) {
        top = netTopLeftBottom + Math.round(6 * CH / 570)
      }
    }

    if (finalRankBadge && finalRankLeft !== null) {
      const rankL = finalRankLeft
      const rankR = finalRankLeft + finalRankBadge.w
      const rankB = finalRankTop + finalRankBadge.h
      let curW = finalQualityBadge.w
      let curH = finalQualityBadge.h
      let curPng = finalQualityBadge.png
      let curLeft = left
      const overlapsRank = () =>
        curLeft < rankR + 6 && curLeft + curW > rankL - 6 && top < rankB + 4 && top + curH > netBaseTop - 4
      if (overlapsRank()) {
        let scale = 1
        const minScale = 0.55
        while (scale > minScale && overlapsRank()) {
          scale -= 0.07
          if (scale < minScale) scale = minScale
          const newW = Math.max(1, Math.round(safeQualityBadgeResult.w * scale))
          const newH = Math.max(1, Math.round(safeQualityBadgeResult.h * scale))
          if (newW === curW && newH === curH) break
          curW = newW
          curH = newH
          curPng = await sharp(safeQualityBadgeResult.png).resize(newW, newH).toBuffer()
          // Lo shrink scala anche il pad: l'ancora resta a box.
          const curPad = Math.round(qPad * scale)
          curLeft = isRightRibbonCorner ? netPadX - curPad : CW - netPadX - (curW - curPad)
          if (scale <= minScale) break
        }
        finalQualityBadge = { ...finalQualityBadge, png: curPng, w: curW, h: curH }
        left = curLeft
      }
    }

    composites.push({
      input: finalQualityBadge.png,
      // Offset applicato DOPO lo shrink anti-overlap (che ragiona sulla
      // posizione ancorata): con offset estremi il badge può sovrapporsi ad
      // altri elementi — scelta utente, WYSIWYG. fitCompositeToCanvas lo
      // tiene comunque dentro la tela.
      top: top + qualityBadgeOffsetY,
      left: left + qualityBadgeOffsetX,
    })
    // Ancoraggio della colonna separati: sotto il box visibile del badge
    // qualità (asse centrale allineato) con gap ottico 6px. L'ancora sottrae
    // il padding ombra inferiore (in scala): prima lo stack partiva dal fondo
    // bitmap + 5, cioè ~19px di vuoto sotto la capsula.
    // Senza qualità lo stack "sale" al top (vedi sotto).
    const qBottomPad = qualityBadgeResult?.h
      ? Math.round(TOP_SHADOW_PAD * finalQualityBadge.h / qualityBadgeResult.h)
      : TOP_SHADOW_PAD
    qualityStackAnchor = {
      top: top + qualityBadgeOffsetY + finalQualityBadge.h - qBottomPad,
      centerX: (left + qualityBadgeOffsetX) + finalQualityBadge.w / 2,
      leftCorner: isRightRibbonCorner,
    }
  }

  // Colonna rating separati: UN solo bitmap con
  // pill verticali logo-sopra/punteggio-sotto a larghezza uniforme,
  // centrato sull'asse verticale del badge qualità (o all'angolo quando la
  // qualità manca). Vale per entrambi i canvas. Mai col custom provider.
  if (!customRowRendered && input.separateRatings?.length) {
    const items = input.separateRatings.slice(0, 3)
    const netPadX = Math.round(18 * CW / 380)
    const netBaseTop = Math.round(18 * CH / 570)
    // Senza qualità ma con nastro a destra, lo stack segue a sinistra come
    // farebbe la qualità (stessa condizione del blocco sopra).
    const rightCorner = qualityStackAnchor
      ? qualityStackAnchor.leftCorner
      : ((isRibbonRankingStyle(rankingBadgeStyle) && ribbonSide === "right" && topBadge?.type === "rank" && !!finalRankBadge)
        || (showComingSoon && ribbonSide === "right" && !!ribbonLayout))
    const stackTop = qualityStackAnchor ? qualityStackAnchor.top + 6 : netBaseTop - 10
    const stackKey = badgeCacheKey("separate", items.map((i) => `${i.id}${i.value}`).join(","), CW, topLight)
    const cached = cacheGet<{ png: Buffer; w: number; h: number }>(stackKey)
    const stack = cached ?? await coalesceBadgeRender(stackKey, () =>
      renderSeparateRatingStack(items, badgePw, topLight)
        .then((r) => { if (r) cacheSet(stackKey, r, ["badge"], BADGE_CACHE_TTL); return r })
    )
    const fitted = stack ? await fitBadgeToCanvas(stack, CW, CH) : null
    if (fitted) {
      const leftPos = qualityStackAnchor
        ? Math.round(qualityStackAnchor.centerX - fitted.w / 2)
        : (rightCorner ? netPadX : Math.round(CW - netPadX + 10 - fitted.w))
      composites.push({ input: fitted.png, top: Math.max(0, stackTop), left: Math.max(0, Math.min(CW - fitted.w, leftPos)) })
    }
  }


  // -----------------------------------------------------------------------
  // 7. Final composite
  // -----------------------------------------------------------------------
  const safeComposites = (await Promise.all(composites.map((layer) => fitCompositeToCanvas(layer, CW, CH))))
    .filter((layer): layer is PosterComposite => layer !== null)

  // Il blur è un overlay RGBA grezzo (nessun PNG intermedio): entra come primo
  // layer, sotto backdrop/vignetta/badge — stesso ordine del vecchio blur "cotto"
  // nella base. La base (posterBuf) non subisce ritocchi colore: niente modulate,
  // l'artwork TMDB passa invariato nel composite finale.
  const layers: Array<PosterComposite | { input: Buffer; raw: { width: number; height: number; channels: 4 }; top: number; left: number }> = blurOverlay
    ? [{ input: blurOverlay.overlay, raw: { width: CW, height: blurOverlay.height, channels: 4 }, top: blurOverlay.top, left: 0 }, ...safeComposites]
    : safeComposites

  let pipeline = sharp(posterBuf)

  if (showComingSoon) {
    pipeline = pipeline.blur(PRE_RELEASE_BLUR_SIGMA)
  }

  pipeline = pipeline.composite(layers)

  if (input.format === "avif") {
    return await pipeline.avif({ quality: 75, effort: 2 }).toBuffer()
  }
  if (input.format === "webp") {
    return await pipeline.webp({ quality: 85, effort: 2 }).toBuffer()
  }
  return await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
}
