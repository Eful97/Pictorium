import sharp from "sharp"
import { cacheGet, cacheSet } from "./cache"
import { GENRE_FALLBACK, cinematicVignetteSVG } from "./badges"
import { FONT_FILES } from "./fonts"
import { applyBlur } from "./blur"
import {
  STD_W, STD_H,
  extractBadgeColor,
  fitBadgeToCanvas,
  fitCompositeToCanvas,
  isValidHex,
  BadgeRender,
  PosterComposite,
} from "./poster-render-helpers"
import { renderGenreBadge, renderRankingBadge, renderExtraBadge, renderQualityBadge, renderComingSoonRibbon, comingSoonRibbonLayout } from "./svg-badge"
import { buildLogoScrim, logoContrast, logoInkLuminance, logoScrimStrength, posterLogoZoneLuminance } from "./logo-contrast"
import { renderFirstMatchingNetworkLogoBadge, renderFirstMatchingNetworkRawBadge, renderFirstMatchingNetworkLogoBadgeHybrid, renderFirstMatchingNetworkRawBadgeHybrid, type NetworkCandidate } from "./network-svgs"
import { computeLogoLayout } from "./logo-layout"
import fs from "fs"
import path from "path"
import { estimateTextWidth, fontFamilyFor } from "./badge-svg-shared"
import { computeTopBadge, isNetworkStudio, type BadgeInput } from "./poster-badge"
import { PRE_RELEASE_DIM_ALPHA, PRE_RELEASE_BLUR_SIGMA } from "./pre-release"
import type { Mapping } from "./types"
import type { ServerDefaults } from "./server-defaults"
import type { WikidataResult } from "./awards"
import type { BadgeT } from "./poster-badge"
import type { BadgeStyle, RankingBadgeStyle } from "./badge-styles"
import type { PosterImageFormat } from "@/lib/poster-runtime-cache"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const BADGE_CACHE_TTL = 24 * 60 * 60 * 1000

// TTL cache image-level (colori badge, resize logo/backdrop): le immagini TMDB
// sono immutabili per path → 24h come la badge cache. Le entry si auto-espellono
// col byte/entry limit della cache globale (tag "poster-extract").
const IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000
const IMAGE_CACHE_TAG = "poster-extract"

export interface GenerationInput {
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
  topLight: boolean
  targetCenter: number
  /** Modalità layout nastro Netflix + logo network: "left" (Nuvio, default) o "right" (Stremio). */
  ribbonSide: "left" | "right"

  // Logo
  logoScale: number | null
  logoOffsetX: number | null
  logoOffsetY: number | null
  /** Disattiva la velatura di sicurezza sotto al logo (default: attiva). */
  logoScrimDisabled?: boolean

  // Badge data sources
  mediaType: "movie" | "tv"
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
  t: BadgeT
  qLabel: string | null
  queryExtra: string | null
  qNetLogo: string | null
  networkLogo?: boolean
  sd: ServerDefaults
  accentOverride: { genreColor: string; rankColor: string } | null
  /** Pre-resolved IMDb Top 250 membership. Falls back gracefully when falsy. */
  imdbTop250?: boolean
  /** Path sorgente del poster (cache image-level). Assente → niente cache. */
  posterSrc?: string | null
  /** Formato di output negoziazione Accept (jpeg | webp | avif). Default: jpeg. */
  format?: PosterImageFormat
  /** Path sorgente del logo (cache image-level). Assente → niente cache. */
  logoSrc?: string | null
  /** Path sorgente del backdrop (cache image-level). Assente → niente cache. */
  backdropSrc?: string | null
  /**
   * Effetto pre-digitale già risolto dalla route (flag `pre` ON + film
   * rilevato senza disponibilità digitale/streaming): velo scuro + badge
   * "Coming Soon". Solo film, indipendente dai toggle badges/ranking.
   */
  preRelease?: boolean
}

// ---- Vignette SVG cache (constant, render once) ----
let _vignettePromise: Promise<Buffer> | null = null
async function getVignette(): Promise<Buffer> {
  if (!_vignettePromise) {
    _vignettePromise = sharp(Buffer.from(cinematicVignetteSVG(STD_W, STD_H))).png().toBuffer()
  }
  return _vignettePromise
}

// ---- Pre-release dim overlay (constant black veil, render once) ----
let _preReleaseDimPromise: Promise<Buffer> | null = null
async function getPreReleaseDim(): Promise<Buffer> {
  if (!_preReleaseDimPromise) {
    _preReleaseDimPromise = sharp({
      create: {
        width: STD_W,
        height: STD_H,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: PRE_RELEASE_DIM_ALPHA },
      },
    }).png().toBuffer()
  }
  return _preReleaseDimPromise
}

// ---------------------------------------------------------------------------
// Badge cache helpers (coalescing)
// ---------------------------------------------------------------------------

function badgeCacheKey(type: string, ...parts: (string | number | boolean | undefined | null)[]): string {
  // Fix L1: i segmenti stringa vengono escapati — una label utente con ":" 
  // (es. customBadge "Top:10") prima produceva chiavi ambigue collidenti con
  // i campi successivi (segmenti di lunghezza variabile separati da ":").
  return `badge:${type}:${parts.map(p => typeof p === "number" ? Math.round(p * 10) / 10 : (typeof p === "string" ? encodeURIComponent(p) : (p ?? "x"))).join(":")}`
}

const badgeInflight = new Map<string, Promise<unknown>>()
// Fix L2: timeout difensivo sulle promise badge in-flight — un render badge
// che non si assesta (sharp appeso, bug) non deve bloccare PER SEMPRE le
// richieste future sulla stessa chiave. Dopo il timeout la chiave viene
// liberata e il prossimo render riparte da zero (l'eventuale completamento
// tardivo popola comunque la cache condivisa).
const BADGE_INFLIGHT_TIMEOUT_MS = 20_000

function coalesceBadgeRender<T>(key: string, run: () => Promise<T>): Promise<T | null> {
  const existing = badgeInflight.get(key) as Promise<T | null> | undefined
  if (existing) return existing
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`badge render timeout: ${key}`)), BADGE_INFLIGHT_TIMEOUT_MS)
    if (typeof timer.unref === "function") timer.unref()
  })
  const promise: Promise<T | null> = Promise.race([
    run().catch(() => null),
    timeoutPromise.catch(() => null),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
    if (badgeInflight.get(key) === promise) badgeInflight.delete(key)
  })
  badgeInflight.set(key, promise)
  return promise
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
  dg_cinema: "direzione-generale-cinema-e-audiovisivo-vector-logo.svg",
  dc: "DC_Studios_logo.svg",
}

async function loadNetworkLogoForPill(networkKey: string, targetH: number, fg: string): Promise<{ png: Buffer; w: number; h: number } | null> {
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillW}" height="${pillH}"><rect width="${pillW}" height="${pillH}" rx="${r}" fill="${bg}" stroke="${topLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.20)"}" stroke-width="1"/><text x="${pillW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(text)}" font-weight="700" font-size="${fs}" fill="${fg}">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text><image href="data:image/png;base64,${netLogo.png.toString("base64")}" x="${logoX}" y="${Math.round(logoY - netLogo.h / 2)}" width="${netLogo.w}" height="${netLogo.h}"/></svg>`
  // Render via resvg (stesso path degli altri badge)
  const { Resvg } = await import("@resvg/resvg-js")
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: pillW }, font: { fontFiles: [...FONT_FILES], loadSystemFonts: false } })
  const png = Buffer.from(resvg.render().asPng())
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
  const { Resvg } = await import("@resvg/resvg-js")
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: pillW }, font: { fontFiles: [...FONT_FILES], loadSystemFonts: false } })
  const png = Buffer.from(resvg.render().asPng())
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillW}" height="${pillH}"><rect width="${pillW}" height="${pillH}" rx="${r}" fill="${bg}" stroke="${topLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.20)"}" stroke-width="1"/><text x="${pillW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label)}" font-weight="700" font-size="${fs}" fill="${fg}">${label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</text><image href="data:image/png;base64,${netLogo.png.toString("base64")}" x="${logoX}" y="${Math.round(logoY - netLogo.h / 2)}" width="${netLogo.w}" height="${netLogo.h}"/></svg>`
  const { Resvg: Resvg2 } = await import("@resvg/resvg-js")
  const resvg2 = new Resvg2(svg, { fitTo: { mode: "width", value: pillW }, font: { fontFiles: [...FONT_FILES], loadSystemFonts: false } })
  const png2 = Buffer.from(resvg2.render().asPng())
  return { png: png2, w: pillW, h: pillH }
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
  const resized = await sharp(logoFetch).resize(width, height, { fit: "inside" }).png({ compressionLevel: 1 }).toBuffer()
  const rMeta = await sharp(resized).metadata()
  const result: ResizedImage = { input: resized, w: rMeta.width || width, h: rMeta.height || height }
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
    badgesEnabled, rankingEnabled, genreName, voteAverage, badgeStyle,
    rankingBadgeStyle, badgeGenre, badgeYear, badgeRating, badgeQuality, quality,
    topLight, targetCenter, ribbonSide,
    logoScale, logoOffsetX, logoOffsetY,
    mediaType, finalRank, animeRankResult,
    mapping, tmdbNetworks, productionCompanies, tmdbStudios,
    tmdbNetworksDetailed, productionCompaniesDetailed,
    tvType, tvStatus, releaseDate, firstAirDate,
    lastAirDate, seasonCount, originCountries,
    wikidataResult, tmdbKeywords, locale, t,
    qLabel, queryExtra, qNetLogo, networkLogo, sd, accentOverride, imdbTop250,
    posterSrc, logoSrc, backdropSrc,
    preRelease = false,
    logoScrimDisabled,
  } = input

  // -----------------------------------------------------------------------
  // 1. Backdrop composite layer
  // -----------------------------------------------------------------------
  const composites: PosterComposite[] = []

  if (backdropFetch) {
    const bMeta = await backdropMetaCached(backdropFetch, backdropSrc)
    const bw = bMeta.width
    const bh = bMeta.height
    const bScale = backdropScale / 100
    let bResizedW = Math.round(STD_W * bScale)
    let bResizedH = Math.round(bh * (bResizedW / bw))
    if (bResizedW > STD_W) { bResizedH = Math.round(bResizedH * (STD_W / bResizedW)); bResizedW = STD_W }
    if (bResizedH > STD_H) { bResizedW = Math.round(bResizedW * (STD_H / bResizedH)); bResizedH = STD_H }
    const bX = Math.round((STD_W - bResizedW) / 2 + backdropOffsetX)
    const bY = Math.round((STD_H - bResizedH) / 2 + backdropOffsetY)
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

  const [blurOverlay, badgeColors, logoResult] = await Promise.all([
    applyBlur({ posterBuf, blurEnabled, blurHeight, blurIntensity, blurFade, blurDarkness }),
    hasGenreBadge
      ? (accentOverride
          ? Promise.resolve(accentOverride)
          : resolveBadgeColors(posterBuf, logoFetch, genreName, posterSrc, logoSrc))
      : Promise.resolve(undefined),
    logoFetch
      ? (async () => {
          const lMeta = await sharp(logoFetch).metadata()
          const lw = lMeta.width || 200
          const lh = lMeta.height || 100
          const defScale = Math.min(Math.round(37.5 * lw / lh), 75)
          const uScale = logoScale ?? defScale
          const uOx = logoOffsetX ?? 0
          const uOy = logoOffsetY ?? 0
          const layout = computeLogoLayout({
            posterW: STD_W, posterH: STD_H, logoW: lw, logoH: lh,
            logoScale: uScale, logoOffsetX: uOx, logoOffsetY: uOy,
            hasBadges: hasGenreBadge,
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
  const vigBuf = await getVignette()
  composites.push({ input: vigBuf, top: 0, left: 0 })
  // Velo pre-digitale: sopra poster/vignetta ma sotto logo e badge (restano
  // luminosi e leggibili). Costante cachata, nessun cambio di output a flag spento.
  if (preRelease) {
    composites.push({ input: await getPreReleaseDim(), top: 0, left: 0 })
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
      const png = await buildLogoScrim(logoResult.w, logoResult.h, strength, (inkLum ?? 0) > 0.5, STD_W, STD_H)
      if (!png) return null
      const meta = await sharp(png).metadata()
      const sw = meta.width ?? 0
      const sh = meta.height ?? 0
      // Anche centrata, la velatura può sporgere: sharp rifiuta un composite che
      // esce dalla tela, quindi la posizione si blocca dentro i bordi.
      return {
        input: png,
        top: Math.min(Math.max(0, Math.round(logoResult.top + logoResult.h / 2 - sh / 2)), Math.max(0, STD_H - sh)),
        left: Math.min(Math.max(0, Math.round(logoResult.left + logoResult.w / 2 - sw / 2)), Math.max(0, STD_W - sw)),
      }
    })().catch(() => null)
    if (scrim) composites.push(scrim)
    composites.push(logoResult)
  }

  // -----------------------------------------------------------------------
  // 4. Badge computation
  // -----------------------------------------------------------------------
  const accentColorGenre = badgeColors?.genreColor || (GENRE_FALLBACK[genreName || ""] || "#555555")
  const accentColorRank = badgeColors?.rankColor || "#555555"

  const badgeInput: BadgeInput = {
    mediaType,
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
    director: wikidataResult.director,
    tvType: tvType ?? null,
    tvStatus,
    keywords: [...tmdbKeywords],
    imdbTop250: !!imdbTop250,
  }
  const computed = computeTopBadge(badgeInput, t, locale)
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
  const ribbonLayout = showComingSoon ? comingSoonRibbonLayout(STD_W) : null

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

  const networkLogoResult = netLogoEnabled
    ? hasDetailed
      ? await renderFirstMatchingNetworkLogoBadgeHybrid(networkCandidatesHybrid as NetworkCandidate[], STD_W, topLight)
      : await renderFirstMatchingNetworkLogoBadge(stringCandidates, STD_W, topLight)
    : null

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
  // Network: sempre visibile quando abilitato, subito sopra il logo film, quasi attaccato — SVG resta raw, TMDB fallback è A (ricolor + ombra) per non risultare scuro.
  const networkRawResult = networkLogoResult
    ? hasDetailed
      ? await renderFirstMatchingNetworkRawBadgeHybrid(networkCandidatesHybrid as NetworkCandidate[], STD_W, topLight)
      : await renderFirstMatchingNetworkRawBadge(stringCandidates, STD_W)
    : null

  const genreBadgeKey = hasGenreBadge
    ? badgeCacheKey("genre", genreName, voteAverage, STD_W, year, badgeStyle, accentColorGenre, topLight, badgeGenre, badgeYear, badgeRating)
    : null
  const rankBadgeKey = !showComingSoon && topBadge
    ? badgeCacheKey("rank", topBadge.type === "extra" ? topBadge.label : `${(topBadge as { rank: number }).rank}:${topBadge!.label}`, STD_W, topLight, rankingBadgeStyle, accentColorRank, ribbonSide, isAnimeRank)
    : null
  const qualityBadgeKey = hasQualityBadge
    ? badgeCacheKey("quality", quality, STD_W, topLight)
    : null
  const comingSoonKey = showComingSoon
    ? badgeCacheKey("comingsoon", comingSoonLabel, STD_W, topLight, ribbonSide)
    : null

  const [genreBadgeResult, rankBadgeResult, qualityBadgeResult, comingSoonResult] = await Promise.all([
    genreBadgeKey
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(genreBadgeKey)
          || coalesceBadgeRender(genreBadgeKey, () =>
              renderGenreBadge(genreName ?? "", voteAverage ?? 0, STD_W, year, badgeStyle, accentColorGenre, topLight, { showGenre: badgeGenre, showYear: badgeYear, showRating: badgeRating })
                .then((r) => { if (r) cacheSet(genreBadgeKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
      : Promise.resolve(null),
    rankBadgeKey
      ? (cacheGet<{ png: Buffer; w: number; h: number; isRank?: boolean }>(rankBadgeKey)
          || coalesceBadgeRender(rankBadgeKey, () => {
              if (topBadge!.type === "extra") {
                return renderExtraBadge(topBadge!.label, STD_W, topLight, rankingBadgeStyle, accentColorRank)
                  .then((r) => { const v = { ...r, isRank: false }; cacheSet(rankBadgeKey, v, ["badge"], BADGE_CACHE_TTL); return v })
              }
              return renderRankingBadge((topBadge as { rank: number }).rank, STD_W, topBadge!.label, topLight, rankingBadgeStyle, accentColorRank, ribbonSide, isAnimeRank)
                .then((r) => { const v = { ...r, isRank: true }; cacheSet(rankBadgeKey, v, ["badge"], BADGE_CACHE_TTL); return v })
            }))
      : Promise.resolve(null),
    qualityBadgeKey
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(qualityBadgeKey)
          || coalesceBadgeRender(qualityBadgeKey, () =>
              renderQualityBadge(quality!, STD_W, topLight)
                .then((r) => { if (r) cacheSet(qualityBadgeKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
      : Promise.resolve(null),
    comingSoonKey
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(comingSoonKey)
          || coalesceBadgeRender(comingSoonKey, () =>
              renderComingSoonRibbon(comingSoonLabel, STD_W, ribbonSide === "right" ? "right" : "left")
                .then((r) => { if (r) cacheSet(comingSoonKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
      : Promise.resolve(null),
  ])

  // -----------------------------------------------------------------------
  // 6. Position badges + network logo
  // -----------------------------------------------------------------------
  const [safeGenreBadgeResult, safeRankBadgeResult, safeQualityBadgeResult, safeComingSoonResult] = await Promise.all([
    genreBadgeResult ? fitBadgeToCanvas(genreBadgeResult, STD_W, STD_H) : Promise.resolve(null),
    rankBadgeResult ? fitBadgeToCanvas(rankBadgeResult, STD_W, STD_H) : Promise.resolve(null),
    qualityBadgeResult ? fitBadgeToCanvas(qualityBadgeResult, STD_W, STD_H) : Promise.resolve(null),
    comingSoonResult ? fitBadgeToCanvas(comingSoonResult, STD_W, STD_H) : Promise.resolve(null),
  ])

  if (safeGenreBadgeResult) {
    if (badgeStyle === "bar") {
      composites.push({ input: safeGenreBadgeResult.png, top: STD_H - safeGenreBadgeResult.h, left: 0 })
    } else {
      const badgeY = STD_H - safeGenreBadgeResult.h - Math.max(0, Math.round(targetCenter - safeGenreBadgeResult.h / 2))
      composites.push({ input: safeGenreBadgeResult.png, top: badgeY, left: Math.round((STD_W - safeGenreBadgeResult.w) / 2) })
    }
  }
  const isRightRibbon = ribbonSide === "right"
  let finalRankBadge = safeRankBadgeResult as { png: Buffer; w: number; h: number } | null
  let finalRankLeft: number | null = null
  let finalRankTop = 0
  if (safeRankBadgeResult) {
    const isBar = rankingBadgeStyle === "bar"
    // Il nastro Netflix è ancorato a sinistra SOLO quando il badge è davvero un
    // ranking "netflix" (type rank). Un badge personalizzato/extra va SEMPRE
    // centrato, anche se lo stile selezionato è "netflix": altrimenti esce
    // decentrato a sinistra.
    const isNetflixRibbon = rankingBadgeStyle === "netflix" && topBadge?.type === "rank"
    let left: number
    if (isBar) {
      left = 0 // bar full-width: resta ancorata a sinistra
    } else if (isNetflixRibbon && isRightRibbon) {
      left = Math.round(STD_W - safeRankBadgeResult.w) // nastro Netflix a destra (Stremio)
    } else if (isNetflixRibbon) {
      left = 0 // nastro Netflix a sinistra (Nuvio, default)
    } else {
      // Badge grande al centro, dimensione invariata: in caso di sovrapposizione
      // si rimpiccioliscono i badge laterali (network top-left, qualità top-right).
      left = Math.round((STD_W - safeRankBadgeResult.w) / 2)
    }
    finalRankBadge = safeRankBadgeResult
    finalRankLeft = left
    finalRankTop = 0

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
      left: ribbonSide === "right" ? Math.round(STD_W - safeComingSoonResult.w + ribbonLayout.offset) : -ribbonLayout.offset,
    })
  }
  // Network: in alto a sinistra di default; centrato sopra il logo film SOLO
  // con nastro Netflix o Coming Soon. Senza logo film resta il layout storico
  // (top-left, o a fianco del nastro).
  // netTopLeftBottom traccia il fondo del logo network quando occupa il top-left (per qualità Stremio sotto).
  let netTopLeftBottom: number | null = null
  if (networkRawResult) {
    const gap = Math.round(6 * STD_H / 570)
    let fittedRaw = await fitBadgeToCanvas(networkRawResult, STD_W, STD_H)
    if (fittedRaw) {
      let top: number
      let left: number
      const isNetflixRibbon = rankingBadgeStyle === "netflix" && topBadge?.type === "rank"
      const hasComingSoonCorner = showComingSoon && !!ribbonLayout && !!safeComingSoonResult
      const netPadX = Math.round(18 * STD_W / 380)
      const netPadY = Math.round(18 * STD_H / 570)

      // Il badge centrale resta invariato: se si sovrappone al network,
      // rimpicciolisce il network (fino a 0.55x).
      const shrinkToAvoidRank = async <T extends BadgeRender>(box: T, top: number, left: number): Promise<T> => {
        if (finalRankBadge && finalRankLeft !== null && rankingBadgeStyle !== "bar") {
          const rankL = finalRankLeft
          const rankR = finalRankLeft + finalRankBadge.w
          const rankB = finalRankBadge.h
          let curW = box.w
          let curH = box.h
          let curPng = box.png
          const overlapsRank = () =>
            left < rankR + 6 && left + curW > rankL - 6 && top < rankB + 4 && top + curH > netPadY - 4
          if (overlapsRank()) {
            let scale = 1
            const minScale = 0.55
            while (scale > minScale && overlapsRank()) {
              scale -= 0.07
              if (scale < minScale) scale = minScale
              const newW = Math.max(1, Math.round(box.w * scale))
              const newH = Math.max(1, Math.round(box.h * scale))
              if (newW === curW && newH === curH) break
              curW = newW
              curH = newH
              curPng = await sharp(box.png).resize(newW, newH).toBuffer()
              if (scale <= minScale) break
            }
            return { ...box, png: curPng, w: curW, h: curH }
          }
        }
        return box
      }

      if (logoResult && (isNetflixRibbon || hasComingSoonCorner)) {
        // Con logo film + nastro Netflix o Coming Soon: subito sopra il logo film
        top = Math.max(0, logoResult.top - fittedRaw.h - gap)
        left = Math.round((STD_W - fittedRaw.w) / 2)
      } else if (!isNetflixRibbon && !logoResult) {
        // Senza logo film e senza nastro Netflix: in alto a sinistra;
        // con il nastro Coming Soon impilato sotto di esso (stesso angolo).
        top = (showComingSoon && ribbonLayout && ribbonSide !== "right") ? ribbonLayout.extent + gap : netPadY
        left = netPadX
        fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        netTopLeftBottom = top + fittedRaw.h
      } else if (logoResult) {
        // Con logo film ma SENZA nastro Netflix né Coming Soon: in alto a
        // sinistra (resta a sinistra anche con side="right").
        top = netPadY
        left = netPadX
        fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        netTopLeftBottom = top + fittedRaw.h
      } else {
        // Con nastro Netflix senza logo film: top-left o a fianco del nastro
        top = netPadY
        left = netPadX
        const isNetflixLeftRibbon = ribbonSide !== "right" && finalRankBadge && finalRankLeft !== null
        if (isNetflixLeftRibbon) {
          const ribbonRight = finalRankLeft! + finalRankBadge!.w
          const netRight = left + fittedRaw.w
          const netBottom = top + fittedRaw.h
          const overlapX = left < ribbonRight + 6 && netRight > finalRankLeft! - 6
          const overlapY = top < finalRankBadge!.h + 4 && netBottom > finalRankTop - 4
          if (overlapX && overlapY) {
            left = Math.round(ribbonRight + 10)
            const maxLeft = STD_W - fittedRaw.w - netPadX
            if (left > maxLeft) left = maxLeft
          }
        }
        netTopLeftBottom = top + fittedRaw.h
      }
      composites.push({ input: fittedRaw.png, top, left })
    }
  }

  // Qualità: in alto a destra di default; con nastro Netflix o Coming Soon a destra (Stremio)
  // va a sinistra per non restargli accanto — sopra il logo network se libero,
  // altrimenti impilata sotto di esso. Top allineato al logo network.
  // Il badge centrale resta invariato: se si sovrappone alla qualità,
  // rimpicciolisce la qualità (fino a 0.55x).
  if (safeQualityBadgeResult) {
    const netBaseTop = Math.round(18 * STD_H / 570)
    const netPadX = Math.round(18 * STD_W / 380)
    const isNetflixRight = rankingBadgeStyle === "netflix" && ribbonSide === "right" && topBadge?.type === "rank"
    const isComingSoonRight = showComingSoon && ribbonSide === "right" && !!ribbonLayout
    const isRightRibbonCorner = (isNetflixRight && !!finalRankBadge) || isComingSoonRight

    let top = netBaseTop
    let left = isRightRibbonCorner ? netPadX : Math.round(STD_W - safeQualityBadgeResult.w - netPadX)
    let finalQualityBadge = safeQualityBadgeResult

    if (isRightRibbonCorner) {
      // Nastro a destra (Netflix o Coming Soon): qualità a sinistra, speculare
      // all'angolo destro standard — impilata sotto il logo network se presente.
      if (netTopLeftBottom !== null) {
        top = netTopLeftBottom + Math.round(6 * STD_H / 570)
      }
    }

    if (finalRankBadge && finalRankLeft !== null && rankingBadgeStyle !== "bar") {
      const rankL = finalRankLeft
      const rankR = finalRankLeft + finalRankBadge.w
      const rankB = finalRankBadge.h
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
          curLeft = isRightRibbonCorner ? netPadX : Math.round(STD_W - curW - netPadX)
          if (scale <= minScale) break
        }
        finalQualityBadge = { ...finalQualityBadge, png: curPng, w: curW, h: curH }
        left = curLeft
      }
    }

    composites.push({
      input: finalQualityBadge.png,
      top,
      left,
    })
  }


  // -----------------------------------------------------------------------
  // 7. Final composite
  // -----------------------------------------------------------------------
  const safeComposites = (await Promise.all(composites.map((layer) => fitCompositeToCanvas(layer, STD_W, STD_H))))
    .filter((layer): layer is PosterComposite => layer !== null)

  // Il blur è un overlay RGBA grezzo (nessun PNG intermedio): entra come primo
  // layer, sotto backdrop/vignetta/badge — stesso ordine del vecchio blur "cotto"
  // nella base. Il modulate sulla base (posterBuf) vive nella stessa pipeline del
  // composite finale → 1 decode + 1 encode totali invece del roundtrip PNG
  // blur→modulate (che ri-decodava il PNG del blur a ogni render).
  const layers: Array<PosterComposite | { input: Buffer; raw: { width: number; height: number; channels: 4 }; top: number; left: number }> = blurOverlay
    ? [{ input: blurOverlay.overlay, raw: { width: STD_W, height: blurOverlay.height, channels: 4 }, top: blurOverlay.top, left: 0 }, ...safeComposites]
    : safeComposites

  let pipeline = sharp(posterBuf)
    .modulate({ brightness: 1.01, saturation: 1.06 })

  if (showComingSoon) {
    pipeline = pipeline.blur(PRE_RELEASE_BLUR_SIGMA)
  }

  pipeline = pipeline.composite(layers)

  if (input.format === "avif") {
    return await pipeline.avif({ quality: 75, effort: 2 }).toBuffer()
  }
  if (input.format === "webp") {
    return await pipeline.webp({ quality: 80, effort: 2 }).toBuffer()
  }
  return await pipeline.jpeg({ quality: 70 }).toBuffer()
}
