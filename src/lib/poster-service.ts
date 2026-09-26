import sharp from "sharp"
import type { RatingItem } from "./custom-rating/types"
import { renderMultiRatings } from "./multi-rating-renderer"
import type { SeparateRating } from "./ratings"
import { renderSeparateRatingStack } from "./separate-rating-renderer"
import { cacheGet, cacheSet } from "./cache"
import { GENRE_FALLBACK, cinematicVignetteSVG, cinematicCornerGradientSVG } from "./badges"
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
import { renderGenreBadge, renderRankingBadge, renderExtraBadge, renderQualityBadge, renderComingSoonRibbon, comingSoonRibbonLayout, renderSVG } from "./svg-badge"
import { buildLogoScrim, logoContrast, logoInkLuminance, logoScrimStrength, posterLogoZoneLuminance } from "./logo-contrast"
import { renderFirstMatchingNetworkLogoBadge, renderFirstMatchingNetworkRawBadge, renderFirstMatchingNetworkLogoBadgeHybrid, renderFirstMatchingNetworkRawBadgeHybrid, type NetworkCandidate } from "./network-svgs"
import { computeLogoLayout, logoAlignPadX, PORTRAIT_LOGO_MAX_HEIGHT_PCT, PORTRAIT_LOGO_TOP_OFFSET } from "./logo-layout"
import { logoDefaultScaleFromAspect } from "./logo-selection"
import fs from "fs"
import path from "path"
import { estimateTextWidth, fontFamilyFor, escSvg, TOP_SHADOW_PAD } from "./badge-svg-shared"
import { computeTopBadge, isNetworkStudio, type BadgeInput } from "./poster-badge"
import type { SashBucket } from "./badge-priority"
import { PRE_RELEASE_DIM_ALPHA, PRE_RELEASE_BLUR_SIGMA } from "./pre-release"
import type { Mapping } from "./types"
import type { ServerDefaults } from "./server-defaults"
import type { WikidataResult } from "./awards"
import { directorBadgeLabel } from "./awards"
import type { BadgeT } from "./poster-badge"
import type { BadgeStyle, RankingBadgeStyle } from "./badge-styles"
import type { PosterImageFormat } from "@/lib/poster-runtime-cache"
import { RENDER_VERSION } from "./render-version"

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
  /** Colonna rating separati a destra (sostituisce la media ★). Solo portrait, max 3. */
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
  /** Ordine/priorità sash (sottoinsieme = resto spento). Default = ordine standard. */
  sashOrder?: readonly SashBucket[] | null
  topLight: boolean
  /** Polarità del badge genere in basso (fondo chiaro → pill scura). Default = topLight (comportamento storico). */
  bottomLight?: boolean
  targetCenter: number
  /** Modalità layout nastro Netflix + logo network: "left" (Nuvio, default) o "right" (Stremio). */
  ribbonSide: "left" | "right"

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
   * In landscape il logo è SEMPRE nascosto (layout senza baked-in: a valle
   * tutto si comporta come "senza logo"); in portrait serve query esplicita.
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

// ---------------------------------------------------------------------------
// Badge cache helpers (coalescing)
// ---------------------------------------------------------------------------

export function badgeCacheKey(type: string, ...parts: (string | number | boolean | undefined | null)[]): string {
  // Fix L1: i segmenti stringa vengono escapati — una label utente con ":"
  // (es. customBadge "Top:10") prima produceva chiavi ambigue collidenti con
  // i campi successivi (segmenti di lunghezza variabile separati da ":").
  // La versione di resa invalida le bitmap quando il codice di rendering
  // cambia (altrimenti resterebbero in cache fino a BADGE_CACHE_TTL).
  return `badge:${type}:${RENDER_VERSION}:${parts.map(p => typeof p === "number" ? Math.round(p * 10) / 10 : (typeof p === "string" ? encodeURIComponent(p) : (p ?? "x"))).join(":")}`
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
    badgesEnabled, rankingEnabled, genreName, voteAverage, badgeStyle,
    rankingBadgeStyle, badgeGenre, badgeYear, badgeRating, badgeQuality, quality,
    sashOrder,
    topLight, targetCenter, ribbonSide,
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
    qLabel, queryExtra, qNetLogo, networkLogo, sd, accentOverride, imdbTop250,
    logoSrc, backdropSrc,
    preRelease = false,
    hideLogo = false,
    logoScrimDisabled,
    logoAlign,
    shape,
  } = input

  // Il badge genere in basso segue la luce del fondo, non del top (su poster
  // con alto chiaro e fondo scuro la pill restava grafite su nero). Chiamanti
  // vecchi/test diretti che non passano bottomLight ricadono sul top.
  const bottomLight = bottomLightOpt ?? topLight

  // Dimensioni canvas: portrait (default, byte-identico al passato) o
  // landscape 16:9 (prova ?shape=landscape, base = backdrop TMDB).
  const CW = shape === "landscape" ? LAND_W : STD_W
  const CH = shape === "landscape" ? LAND_H : STD_H
  // Allineamento blocco logo/metadati: in portrait è SEMPRE "center" per contratto.
  // In landscape può essere "left" (Cinematic Left) o "center".
  const align = shape === "landscape" && logoAlign === "left" ? "left" : "center"
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
    ? await extractSceneTint(posterBuf, genreName)
    : null

  const accentColorGenre = accentOverride?.genreColor ?? sceneTintHex ?? (GENRE_FALLBACK[genreName || ""] || "#555555")
  const accentColorRank = accentOverride?.rankColor ?? sceneTintHex ?? "#555555"

  // Override esplicito `ac=` vince sempre; poi tinta di scena; rete di sicurezza: fallback genere
  const blurTintHex = accentOverride?.genreColor ?? sceneTintHex ?? accentColorGenre

  // Layout landscape = senza logo baked-in (vale per preview, poster e
  // banner: unica verità visiva). hideLogo esplicito copre anche il portrait.
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
    logoFetch && !hideLogo && shape !== "landscape"
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
            logoScale: uScale, logoOffsetX: uOx, logoOffsetY: uOy,
            hasBadges: hasGenreBadge,
            // Margine maggiorato solo col badge genere (12% vs 10% storico):
            // solleva il logo sopra il badge basso senza spostare i poster clean.
            bottomMarginPct: hasGenreBadge ? 12 : undefined,
            // Cap altezza portrait: i loghi quadrati/verticali non superano
            // il 25% dell'altezza poster (solo altezza, larghezza libera).
            maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT,
            // Calibrazione portrait: logo 10px più in basso (solo portrait:
            // questo ramo non baked-in mai il landscape).
            topOffset: PORTRAIT_LOGO_TOP_OFFSET,
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
  const computed = computeTopBadge(badgeInput, t, locale, sashOrder ?? null)
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

  // Placca staccata: solo gli stili centrati (il nastro resta ancorato)
  // con offset Y esplicito arrotondano tutti e 4 gli angoli. Calcolato qui
  // (non nel layout sotto) perché entra nella chiave cache: il bitmap cambia.
  const isRankNetflixRibbonStyle = rankingBadgeStyle === "netflix" && topBadge?.type === "rank"
  const isRankDetached = !!topBadge && !isRankNetflixRibbonStyle && topBadgeOffsetY !== 0

  const genreBadgeKey = hasGenreBadge
    ? badgeCacheKey("genre", genreName, voteAverage, CW, year, badgeStyle, accentColorGenre, bottomLight, badgeGenre, badgeYear, badgeRating, genreBadgeScale)
    : null
  const rankBadgeKey = !showComingSoon && topBadge
    ? badgeCacheKey("rank", topBadge.type === "extra" ? topBadge.label : `${(topBadge as { rank: number }).rank}:${topBadge!.label}`, CW, topLight, rankingBadgeStyle, accentColorRank, ribbonSide, isAnimeRank, topBadgeScale, isRankDetached ? "detached" : undefined)
    : null
  const qualityBadgeKey = hasQualityBadge
    ? badgeCacheKey("quality", quality, CW, topLight, qualityBadgeScale)
    : null
  const comingSoonKey = showComingSoon
    ? badgeCacheKey("comingsoon", comingSoonLabel, CW, topLight, ribbonSide)
    : null

  const [genreBadgeResult, rankBadgeResult, qualityBadgeResult, comingSoonResult] = await Promise.all([
    genreBadgeKey
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(genreBadgeKey)
          || coalesceBadgeRender(genreBadgeKey, () =>
                renderGenreBadge(genreName ?? "", voteAverage ?? 0, badgePw, year, badgeStyle, accentColorGenre, bottomLight, { showGenre: badgeGenre, showYear: badgeYear, showRating: badgeRating }, badgeStyle === "bar" ? genreBadgeScale : 100)
                .then((r) => { if (r) cacheSet(genreBadgeKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
      : Promise.resolve(null),
    rankBadgeKey
      ? (cacheGet<{ png: Buffer; w: number; h: number; isRank?: boolean }>(rankBadgeKey)
          || coalesceBadgeRender(rankBadgeKey, () => {
              if (topBadge!.type === "extra") {
                return renderExtraBadge(topBadge!.label, topBadgePw, topLight, rankingBadgeStyle, accentColorRank, isRankDetached)
                  .then((r) => { const v = { ...r, isRank: false }; cacheSet(rankBadgeKey, v, ["badge"], BADGE_CACHE_TTL); return v })
              }
              return renderRankingBadge((topBadge as { rank: number }).rank, rankingBadgeStyle === "netflix" ? badgePw : topBadgePw, topBadge!.label, topLight, rankingBadgeStyle, accentColorRank, ribbonSide, isAnimeRank, isRankDetached)
                .then((r) => { const v = { ...r, isRank: true }; cacheSet(rankBadgeKey, v, ["badge"], BADGE_CACHE_TTL); return v })
            }))
      : Promise.resolve(null),
    qualityBadgeKey
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(qualityBadgeKey)
          || coalesceBadgeRender(qualityBadgeKey, () =>
              renderQualityBadge(quality!, badgePw, topLight)
                .then((r) => { if (r) cacheSet(qualityBadgeKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
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
    genreBadgeResult && genreBadgeScale !== 100 && badgeStyle !== "bar"
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
    // Micro-calibrazione ottica dell'ancoraggio destro: +40px verso il bordo,
    // -10px verso l'alto (clamp anti-overflow: mai fuori canvas).
    const anchorRight = shape === "landscape"
    const anchorShiftX = anchorRight ? 40 : 0
    const anchorShiftY = anchorRight ? -10 : 0
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
      const badgeY = Math.min(CH - safeGenreBadgeResult.h, CH - safeGenreBadgeResult.h - Math.max(0, Math.round(targetCenter - safeGenreBadgeResult.h / 2)) + genreBadgeOffsetY + anchorShiftY)
      const badgeLeft = anchorRight
        ? Math.min(CW - safeGenreBadgeResult.w, Math.max(0, CW - safeGenreBadgeResult.w - rightPadX + anchorShiftX + genreBadgeOffsetX))
        : (isLandscapeLeft
          ? logoAlignPadX(CW) + genreBadgeOffsetX
          : Math.round((CW - safeGenreBadgeResult.w) / 2) + genreBadgeOffsetX) + landscapeShiftX
      composites.push({ input: safeGenreBadgeResult.png, top: badgeY, left: badgeLeft })
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
  let finalRankBadge = safeRankBadgeResult as { png: Buffer; w: number; h: number } | null
  let finalRankLeft: number | null = null
  let finalRankTop = 0
  if (safeRankBadgeResult) {
    // Il nastro Netflix è ancorato a sinistra SOLO quando il badge è davvero un
    // ranking "netflix" (type rank). Un badge personalizzato/extra va SEMPRE
    // centrato, anche se lo stile selezionato è "netflix": altrimenti esce
    // decentrato a sinistra.
    const isNetflixRibbon = rankingBadgeStyle === "netflix" && topBadge?.type === "rank"
    // Offset X/Y solo sui centrati: il nastro resta ancorato (per scelta
    // utente esplicita gli offset non lo toccano).
    const isCentered = !isNetflixRibbon
    // La pill centrale è staccata di 10px dal bordo alto (misura fissa decisa
    // in editor). Default a filo top. Solo pill, indipendente dal badge qualità.
    const pillTopGap = rankingBadgeStyle === "pill" ? 10 : 0
    let left: number
    if (isNetflixRibbon && isRightRibbon) {
      left = Math.round(CW - safeRankBadgeResult.w) // nastro Netflix a destra (Stremio)
    } else if (isNetflixRibbon) {
      left = 0 // nastro Netflix a sinistra (Nuvio, default)
    } else {
      // Badge grande al centro, dimensione invariata: in caso di sovrapposizione
      // si rimpiccioliscono i badge laterali (network top-left, qualità top-right).
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
  // Network: in alto a sinistra di default; centrato sopra il logo film SOLO
  // con nastro Netflix o Coming Soon. Senza logo film resta il layout storico
  // (top-left, o a fianco del nastro).
  // netTopLeftBottom traccia il fondo del logo network quando occupa il top-left (per qualità Stremio sotto).
  // Tuning editoriale globale (default per tutti i poster): pill network +10px Y.
  const NETWORK_LOGO_SHIFT_Y = 10
  let netTopLeftBottom: number | null = null
  if (networkLogoForLayout) {
    const gap = Math.round(6 * CH / 570)
    let fittedRaw = await fitBadgeToCanvas(networkLogoForLayout, CW, CH)
    if (fittedRaw) {
      let top: number
      let left: number
      const isNetflixRibbon = rankingBadgeStyle === "netflix" && topBadge?.type === "rank"
      const hasComingSoonCorner = showComingSoon && !!ribbonLayout && !!safeComingSoonResult
      const netPadX = Math.round(18 * CW / 380)
      const netPadY = Math.round(18 * CH / 570)

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

      if (logoResult && (isNetflixRibbon || hasComingSoonCorner)) {
        // Con logo film + nastro Netflix o Coming Soon: subito sopra il logo film
        // (in Cinematic Left allineato a sinistra come sopratitolo, non centrato).
        top = Math.max(0, logoResult.top - fittedRaw.h - gap)
        left = isLandscapeLeft ? logoResult.left : Math.round((CW - fittedRaw.w) / 2)
      } else if (!isNetflixRibbon && !logoResult) {
        // Senza logo film e senza nastro Netflix: in alto a sinistra;
        // con il nastro Coming Soon impilato sotto di esso (stesso angolo).
        top = (showComingSoon && ribbonLayout && ribbonSide !== "right") ? ribbonLayout.extent + gap : netPadY
        left = netPadX
        fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      } else if (logoResult) {
        // Con logo film ma SENZA nastro Netflix né Coming Soon: in alto a
        // sinistra (resta a sinistra anche con side="right").
        top = netPadY
        left = netPadX
        fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
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
          const overlapY = top < finalRankTop + finalRankBadge!.h + 4 && netBottom > finalRankTop - 4
          if (overlapX && overlapY) {
            left = Math.round(ribbonRight + 10)
            const maxLeft = CW - fittedRaw.w - netPadX
            if (left > maxLeft) left = maxLeft
          }
        }
        netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
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
    const isNetflixRight = rankingBadgeStyle === "netflix" && ribbonSide === "right" && topBadge?.type === "rank"
    const isComingSoonRight = showComingSoon && ribbonSide === "right" && !!ribbonLayout
    const isRightRibbonCorner = (isNetflixRight && !!finalRankBadge) || isComingSoonRight

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

  // Colonna rating separati a destra (solo portrait): UN solo bitmap con
  // pill verticali logo-sopra/punteggio-sotto a larghezza uniforme,
  // centrato sull'asse verticale del badge qualità (o all'angolo quando la
  // qualità manca). Mai col custom provider.
  if (!customRowRendered && input.separateRatings?.length && shape !== "landscape") {
    const items = input.separateRatings.slice(0, 3)
    const netPadX = Math.round(18 * CW / 380)
    const netBaseTop = Math.round(18 * CH / 570)
    // Senza qualità ma con nastro a destra, lo stack segue a sinistra come
    // farebbe la qualità (stessa condizione del blocco sopra).
    const rightCorner = qualityStackAnchor
      ? qualityStackAnchor.leftCorner
      : ((rankingBadgeStyle === "netflix" && ribbonSide === "right" && topBadge?.type === "rank" && !!finalRankBadge)
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
  // nella base. Il modulate sulla base (posterBuf) vive nella stessa pipeline del
  // composite finale → 1 decode + 1 encode totali invece del roundtrip PNG
  // blur→modulate (che ri-decodava il PNG del blur a ogni render).
  const layers: Array<PosterComposite | { input: Buffer; raw: { width: number; height: number; channels: 4 }; top: number; left: number }> = blurOverlay
    ? [{ input: blurOverlay.overlay, raw: { width: CW, height: blurOverlay.height, channels: 4 }, top: blurOverlay.top, left: 0 }, ...safeComposites]
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
