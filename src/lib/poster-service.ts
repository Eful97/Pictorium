import sharp from "sharp"
import type { RatingItem } from "./custom-rating/types"
import { renderMultiRatings } from "./multi-rating-renderer"
import type { SeparateRating } from "./ratings"
import { renderSeparateRatingStack, renderSeparateRatingsBottom } from "./separate-rating-renderer"
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
import { normalizeAutomaticAccentHex } from "./accent-color"
import { renderGenreBadge, renderRankingBadge, renderExtraBadge, renderQualityBadge, renderQualityKnockoutBadge, renderComingSoonRibbon, comingSoonRibbonLayout, renderSVG, buildCustomPresetBadgeSVG, buildHousePresetBadgeSVG } from "./svg-badge"
import { buildLogoScrim, logoContrast, logoInkLuminance, logoScrimStrength, posterLogoZoneLuminance } from "./logo-contrast"
import { renderFirstMatchingNetworkLogoBadge, renderFirstMatchingNetworkRawBadge, renderFirstMatchingNetworkLogoBadgeHybrid, renderFirstMatchingNetworkRawBadgeHybrid, type NetworkCandidate } from "./network-svgs"
import { computeLogoLayout, logoAlignPadX, PORTRAIT_LOGO_MAX_HEIGHT_PCT, PORTRAIT_LOGO_TOP_OFFSET, LANDSCAPE_LOGO_MAX_WIDTH_PCT, LANDSCAPE_LOGO_MAX_HEIGHT_PCT, LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT, LANDSCAPE_LOGO_TOP_OFFSET, LANDSCAPE_LOGO_SHIFT_X, LANDSCAPE_LOGO_SHIFT_Y } from "./logo-layout"
import { logoDefaultScaleFromAspect, FRESH_TITLE_LOGO_DEFAULT_SCALE } from "./logo-selection"
import fs from "fs"
import path from "path"
import { estimateTextWidth, fontFamilyFor, escSvg, badgeBoxHeight, TOP_SHADOW_PAD } from "./badge-svg-shared"
import { computeTopBadge, isNetworkStudio, type BadgeInput } from "./poster-badge"
import { DEMO_SAMPLE_NETWORK } from "./demo-samples"
import type { DateFormat } from "./release-badge"
import type { SashBucket } from "./badge-priority"
import { PRE_RELEASE_DIM_ALPHA, PRE_RELEASE_BLUR_SIGMA } from "./pre-release"
import type { Mapping, NetworkLogoPosition, PosterLayout, PosterFreshScope } from "./types"
import { isPosterFreshScope, DEFAULT_POSTER_FRESH_SCOPE } from "./types"
import type { ServerDefaults } from "./server-defaults"
import type { WikidataResult } from "./awards"
import { directorBadgeLabel } from "./awards"
import type { BadgeT } from "./poster-badge"
import type { BadgeFont } from "./badge-styles"
import { isRibbonRankingStyle, isBottomSeparateRatingsStyle, getSeparateRatingsStyleForShape, resolveNumberBadgeBaseOffsetX, type BadgeStyle, type RankingBadgeStyle, type ExtraBadgeStyle, type SeparateRatingsStyle, type SeparateBottomVariant } from "./badge-styles"
import { normalizeBadgeFont } from "./badge-svg-shared"
import type { PosterImageFormat } from "@/lib/poster-runtime-cache"
import { getPresetForUser } from "./badge-preset-store"
import type { BadgePreset } from "./badge-preset"
import { qualityBadgeIconPath } from "./quality-badge-styles"
import type { QualityBadgeStyle } from "./badge-styles"
import { FORMAT_ICON_PATHS, type VideoFormat } from "./av-specs"
import type { BadgeVariableContext } from "./badge-variables"
import { isRankKey } from "./i18n"
import { composeFreshOverlay, isEffectiveFreshLayout, isFreshRank, prepareFreshReconstructedBackground } from "./fresh-layout"

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

// Ancoraggio destro landscape (rightPadX in scala + shift ottico verso il
// bordo, clamp anti-overflow). UNICA definizione: il ramo genere la riusa con
// extra = gox − sepCenterShift − styleCornerShiftX e shift default 40 (resa
// byte-identica al legacy); le pills landscape passano opticalShift = 0
// (margine interno pieno 18*CW/380, niente gox/goy né compensazioni
// ★/stile-specifiche — solo geometria base).
function landscapeRightAnchorLeft(contentW: number, CW: number, extra = 0, opticalShift = 40): number {
  const rightPadX = Math.round(18 * CW / 380)
  return Math.min(CW - contentW, Math.max(0, CW - contentW - rightPadX + opticalShift + extra))
}

// Base geometrica pills landscape: -20px X / -10px Y rispetto all'ancoraggio
// neutro (margine pieno 18*CW/380 + margine basso 20*CH/570). Solo default di
// geometria: gli slider sepox/sepoy restano neutri a 0 e si sommano sopra;
// default globali separateBadgeOffset invariati (la colonna non si sposta).
export const LANDSCAPE_BOTTOM_PILLS_SHIFT_X = -20
export const LANDSCAPE_BOTTOM_PILLS_SHIFT_Y = -10

// Base geometrica separati portrait: +5px Y (verso il basso) rispetto
// all'ancoraggio storico, SOLO formato poster/verticale, stili colonna e
// bottom-pills. Solo default di geometria PRIMA degli offset utente
// (sepox/sepoy neutri a 0 e additivi dopo, con clamp dentro il canvas);
// default globali separateBadgeOffset invariati (0 resta 0, nessun fallback
// landscape toccato). Eccezione: bottom-bar portrait full-width a filo
// (top = CH - h): il +5 sarebbe annullato dal clamp, resta a filo.
export const PORTRAIT_SEPARATE_SHIFT_Y = 5

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
  /** Standalone extra-badge style: null = legacy `rankingBadgeStyle` fallback. */
  extraBadgeStyle?: ExtraBadgeStyle | null
  /** Quali componenti del badge genere/rating mostrare (default tutti ON). */
  badgeGenre: boolean
  badgeYear: boolean
  badgeRating: boolean
  badgeQuality?: boolean
  quality?: string | null
  /** Font dei testi badge ("inter" = resa storica; i preset custom/house e i loghi restano invariati). */
  badgeFont?: BadgeFont | null
  /** Stile icone del badge qualità (standard = pill testuale). */
  qualityBadgeStyle?: QualityBadgeStyle | null
  /** Formati A/V da affiancare alla qualità (dv, atmos, imax, hdr, hdr10plus). */
  videoFormats?: readonly VideoFormat[] | null
  /** Ordine/priorità sash (sottoinsieme = resto spento). Default = ordine standard. */
  sashOrder?: readonly SashBucket[] | null
  topLight: boolean
  /** Polarità del badge genere in basso (fondo chiaro → pill scura). Default = topLight (comportamento storico). */
  bottomLight?: boolean
  /**
   * Visibilità badge di riferimento per la reservation logo (solo geometria):
   * in bottom la route passa l'equivalente colonna così il logo titolo resta
   * alla stessa altezza. Assente → si usano i flag effettivi del render.
   */
  logoBadgeVisibility?: { genre: boolean; year: boolean; rating: boolean }
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
  /**
   * Tuning EXTRA superiore risolto (null = assente ovunque: il render
   * applica il fallback legacy sul tuning classifica). Opzionale: i consumer
   * esistenti restano invariati e il percorso legacy è byte-identico.
   */
  extraBadgeScale?: number | null
  extraBadgeOffsetX?: number | null
  extraBadgeOffsetY?: number | null
  /** Scala % del badge genere/rating in basso, su tutti gli stili (barra nativa via font). */
  genreBadgeScale: number
  /** Offset px del badge genere/rating, solo stili non-bar. */
  genreBadgeOffsetX: number
  genreBadgeOffsetY: number
  /** Scala % del badge qualità streaming. */
  qualityBadgeScale: number
  /** Scala % della colonna rating separati (default 100 = resa storica). */
  separateBadgeScale: number
  /**
   * Offset px del gruppo rating separati (colonna/pills interi, mai singoli
   * provider; bar portrait: solo Y, X ignorata). Opzionali con default 0:
   * i consumer esistenti (test diretti, vecchi adapter) restano invariati e
   * a 0 il percorso è byte-identico allo storico.
   */
  separateBadgeOffsetX?: number
  separateBadgeOffsetY?: number
  /**
   * Layout dei rating separati ("column" = colonna destra storica;
   * "bottom-bar"/"bottom-pills"/"bottom-mono"/"bottom-color" = riga in basso
   * con genere+anno+voto soppressi a monte via flag effettivi). Opzionale con
   * default "column": i consumer esistenti (test diretti, vecchi adapter)
   * restano invariati.
   */
  separateRatingsStyle?: SeparateRatingsStyle
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
   * Demo samples (Settings defaults preview only, route-gated with preview=1
   * plus the explicit flag): when the ordered network candidates resolve
   * nothing, retry once with the bundled brand. Real brands keep absolute
   * priority (order untouched); toggle-off never reaches the lookup.
   */
  demoSamples?: boolean
  /**
   * Posizione del logo network ("top" = sempre all'angolo superiore, lato
   * del nastro effettivo; "auto" = specchio dinamico odierno). Default "auto"
   * (byte-identico al passato).
   */
  networkLogoPosition?: NetworkLogoPosition
  /**
   * Il network segue il layout storico ancorato al titolo (default true =
   * comportamento attuale). false + coordinate fisse valorizzate = posizione
   * assoluta top-left in px nel canvas del formato: salta TUTTI i
   * reposition/shrink da titolo/badge/mirror; la scala resta ancorata
   * top-left. Opzionale: i consumer esistenti restano invariati.
   */
  networkLogoFollowTitle?: boolean
  /**
   * Coordinate assolute del box network (angolo top-left) in px nel canvas
   * del formato, solo quando `networkLogoFollowTitle === false`. Null/assenti
   * = layout storico anche con follow spento (mai (0,0) implicito).
   * Per-shape (mai fallback cross-shape): risolte in poster-config.
   */
  networkFixedX?: number | null
  networkFixedY?: number | null
  /**
   * Collettore una-tantum della geometria network effettivamente composta
   * (o null se non resa): unica fonte per il freeze senza salto (debug).
   * Solo numeri, nessun dato sensibile. Assente = nessun overhead.
   */
  onNetworkGeometry?: ((geo: NetworkGeometry | null) => void) | null
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
   * Graphical poster layout risolto dalla route (query `layout` > mapping
   * effettivo per formato > config token > defaults effettivi > "standard").
   * "fresh" compone il layout grafico alternativo nel blocco 6b (shade
   * dedicata + numerale vetro + colonna meta + provider + logo ancorato),
   * riusando base/blur/qualita/ribbon/extra standard. Opzionale: i consumer
   * esistenti restano invariati.
   */
  posterLayout?: PosterLayout | null
  /**
   * Fresh apply scope risolto dalla route (query `freshScope` > mapping
   * effettivo per formato > config token > defaults effettivi > "ranked").
   * Con "ranked" il renderer decide il layout EFFETTIVO dal rank mostrato
   * (vedi isEffectiveFreshLayout): senza rank valido rende Standard
   * byte-identico. Opzionale: assente = "ranked" (default condiviso).
   */
  posterFreshScope?: PosterFreshScope | null
  /**
   * Raw (pre-suppression) rating-component toggle for the fresh meta column.
   * The route resolves `badgeRating` raw from query/mapping/config/defaults
   * and passes the EFFECTIVE (suppressed) value in `badgeRating`; fresh needs
   * the raw toggle to apply the shared gates itself
   * (resolveSeparateDisplayState). Absent = backward compat for direct
   * service callers (raw toggle = effective `badgeRating`). Never inferred
   * from array existence: an explicit `badgeRating: false` with populated
   * arrays still renders no separate rows.
   */
  freshRawBadgeRating?: boolean
  /**
   * Raw separate-ratings toggle (`sep` chain) for the fresh meta column.
   * Same contract as `freshRawBadgeRating`: route passes the raw config,
   * absent = array-defined (direct callers declaring arrays keep them
   * active, still gated by the raw rating toggle).
   */
  freshRawSeparateRatings?: boolean
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
  /** Font della pill testuale (default "inter" = resa storica; le icone mono/color restano invariate). */
  font: BadgeFont = "inter",
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const isKnockout = qualityBadgeStyle === "knockout"
  // Knockout has no icon asset (qualityBadgeIconPath stays null by design):
  // it renders its own tag below and never falls back to the standard pill.
  const qualityIconPath = isKnockout ? null : qualityBadgeIconPath(qualityBadgeStyle, quality)
  let resBadge: { png: Buffer; w: number; h: number } | null = null
  if (qualityIconPath) {
    resBadge = await renderQualityIconBadge(qualityIconPath, pw, topLight)
  }
  if (!resBadge) {
    resBadge = isKnockout
      ? await renderQualityKnockoutBadge(quality, pw, normalizeBadgeFont(font))
      : await renderQualityBadge(quality, pw, topLight, normalizeBadgeFont(font))
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
    // Knockout keeps the Dolby mark white even on light tops (reference
    // look); every other style and format keeps the polarity behavior.
    comboIcon = await renderQualityIconBadge("quality-badges/video/dolby-vision-atmos.svg", pw, isKnockout ? false : topLight)
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
    const isDolbySingle = fmt === "dv" || fmt === "atmos"
    const icon = await renderQualityIconBadge(FORMAT_ICON_PATHS[fmt], pw, isKnockout && isDolbySingle ? false : topLight)
    if (icon) formatBadges.push(icon)
  }
  if (formatBadges.length === 0) return resBadge

  const gap = Math.round(5 * pw / 380)
  // Vertical stack for every style (knockout included): the tier tag on
  // top, every verified format below — Dolby like any other format.
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
  batinthesun: "12x16-batinthesun.png",
  horrorsection: "ths-logo-300_webp.png",
  new_line: "New_Line_Cinema.svg",
  jagged_edge: "jagged.svg",
  gracie: "Gracie_Films_logo_webp.png",
  deseo: "deseo.svg",
  bellanova: "bellanova-big.png",
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

export async function renderCombinedRankNetworkPill(rank: number, label: string, networkKey: string, pw: number, topLight: boolean, _accentColor: string | undefined, _isAnime: boolean | undefined, font: BadgeFont = "inter"): Promise<{ png: Buffer; w: number; h: number } | null> {
  const fs = Math.round(Math.max(20 * pw / 380, 13))
  const px = Math.round(fs * 0.75)
  const pt = Math.round(fs * 0.35)
  const gap = Math.round(fs * 0.25)
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const text = `#${rank} ${label}`
  const f = normalizeBadgeFont(font)
  const textW = estimateTextWidth(text, fs, f)
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillW}" height="${pillH}"><rect width="${pillW}" height="${pillH}" rx="${r}" fill="${bg}" stroke="${topLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.20)"}" stroke-width="1"/><text x="${pillW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(text, f)}" font-weight="700" font-size="${fs}" fill="${fg}">${escSvg(text)}</text><image href="data:image/png;base64,${netLogo.png.toString("base64")}" x="${logoX}" y="${Math.round(logoY - netLogo.h / 2)}" width="${netLogo.w}" height="${netLogo.h}"/></svg>`
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

export async function renderCombinedExtraNetworkPill(label: string, networkKey: string, pw: number, topLight: boolean, font: BadgeFont = "inter"): Promise<{ png: Buffer; w: number; h: number } | null> {
  const fs = Math.round(Math.max(20 * pw / 380, 13))
  const px = Math.round(fs * 0.75)
  const pt = Math.round(fs * 0.35)
  const gap = Math.round(fs * 0.25)
  const bg = topLight ? "rgba(0,0,0,0.80)" : "rgba(255,255,255,0.80)"
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const f = normalizeBadgeFont(font)
  const textW = estimateTextWidth(label, fs, f)
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pillW}" height="${pillH}"><rect width="${pillW}" height="${pillH}" rx="${r}" fill="${bg}" stroke="${topLight ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.20)"}" stroke-width="1"/><text x="${pillW / 2}" y="${textY}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(label, f)}" font-weight="700" font-size="${fs}" fill="${fg}">${escSvg(label)}</text><image href="data:image/png;base64,${netLogo.png.toString("base64")}" x="${logoX}" y="${Math.round(logoY - netLogo.h / 2)}" width="${netLogo.w}" height="${netLogo.h}"/></svg>`
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
// Corner rank layout helpers (pure, unit-tested). Corner-style only.
// ---------------------------------------------------------------------------

export interface CornerRankRect {
  readonly left: number
  readonly top: number
  readonly w: number
  readonly h: number
}

/**
 * Styles anchored to the top corner like `corner` (flat pill): `number`
 * shares the same anchor, gap, Coming Soon stacking and network/quality
 * collision handling — only the bitmap differs (bare numeral, no plate).
 */
export function isCornerAnchoredStyle(v: string | null | undefined): boolean {
  return v === "corner" || v === "number"
}

/**
 * Effective top-badge style for builders, placement, collisions and cache:
 * rank badges always use `rankingBadgeStyle`; extra badges use the standalone
 * `extraBadgeStyle` when set, else the legacy `rankingBadgeStyle` fallback
 * (absent everywhere = byte-identical legacy render).
 */
export function resolveTopBadgeStyle(params: {
  readonly topBadgeType: "rank" | "extra" | null | undefined
  readonly rankingBadgeStyle: RankingBadgeStyle
  readonly extraBadgeStyle?: ExtraBadgeStyle | null
}): RankingBadgeStyle {
  if (params.topBadgeType === "extra") return params.extraBadgeStyle ?? params.rankingBadgeStyle
  return params.rankingBadgeStyle
}

/**
 * Top offset for a `corner` rank pill: stacked below a left Coming Soon
 * ribbon sharing its corner, else the fixed top gap. The ribbon itself
 * is never moved.
 */
export function cornerRankTop(params: {
  comingSoonLeft: boolean
  ribbonExtent: number
  gap: number
  pillTopGap: number
}): number {
  if (params.comingSoonLeft) return params.ribbonExtent + params.gap
  return params.pillTopGap
}

/**
 * Left anchor for a corner-anchored top badge (`corner` or `number`): the
 * historic top-left box margin (`netPadX`), mirrored to the top-right
 * corner when `mirrorRight` (only `number` with `side="right"` mirrors;
 * `corner` always passes false). Exact historic margins — no drift.
 */
export function cornerAnchoredLeft(params: {
  readonly canvasW: number
  readonly badgeW: number
  readonly mirrorRight: boolean
  readonly offsetX: number
}): number {
  if (params.mirrorRight) return Math.round(params.canvasW - params.badgeW - 18 * params.canvasW / 380) + params.offsetX
  return Math.round(18 * params.canvasW / 380) + params.offsetX
}

/**
 * Whether a `number`-style numeral occupies the top-right corner (mirrored
 * with `side="right"`): trailing badges (quality pill, separate stack) move
 * to the left corner like with a right ribbon instead of shrinking in place
 * against the bare digits. Left-anchored numerals need nothing (quality sits
 * in the opposite corner). Other styles never match.
 */
export function isNumberRightCorner(params: {
  readonly rankingBadgeStyle: string | null | undefined
  readonly ribbonSide: string | null | undefined
  readonly hasTopBadge: boolean
}): boolean {
  return params.rankingBadgeStyle === "number" && params.ribbonSide === "right" && params.hasTopBadge
}

/**
 * Single composition behind both right-corner checks (quality pill at 2253
 * and separate stack at 2357): the `number` test runs on the effective
 * top-badge style, so an explicit extra style can never split quality left
 * and stack right. Rank numerals keep the legacy behavior.
 */
export function isTopBadgeNumberRightCorner(params: {
  readonly topBadgeType: "rank" | "extra" | null | undefined
  readonly rankingBadgeStyle: RankingBadgeStyle
  readonly extraBadgeStyle?: ExtraBadgeStyle | null
  readonly ribbonSide: string | null | undefined
  readonly hasTopBadge: boolean
}): boolean {
  return isNumberRightCorner({
    rankingBadgeStyle: resolveTopBadgeStyle({
      topBadgeType: params.topBadgeType,
      rankingBadgeStyle: params.rankingBadgeStyle,
      extraBadgeStyle: params.extraBadgeStyle,
    }),
    ribbonSide: params.ribbonSide,
    hasTopBadge: params.hasTopBadge,
  })
}

/**
 * Whether a `number`-style numeral shares its corner with the Coming Soon
 * ribbon and must stack below it. The numeral mirrors with `side="right"`,
 * so unlike the historic left-only corner rule the shared corner is
 * whichever side the numeral sits on: overlap is tested against the real
 * boxes (Coming Soon composite rect + numeral rect at its unstacked
 * candidate top), so explicit tox/toy that move the numeral away don't
 * force a useless stack. Corner keeps its historic rule (never calls this).
 */
export function numberSharesComingSoonCorner(params: {
  readonly canvasW: number
  readonly hasTopBadge: boolean
  readonly showComingSoon: boolean
  readonly ribbonSide: string | null | undefined
  /** Fitted Coming Soon bitmap width; null when no ribbon is rendered. */
  readonly ribbonW: number | null
  /** Negative composite offset of the Coming Soon layer (`ribbonLayout.offset`). */
  readonly ribbonOffset: number | null
  /** Visible extent of the ribbon from the corner (`ribbonLayout.extent`). */
  readonly ribbonExtent: number | null
  /** Numeral rect at its unstacked candidate top (final left incl. tox). */
  readonly numLeft: number
  readonly numTop: number
  readonly numW: number
  readonly numH: number
}): boolean {
  if (!params.hasTopBadge || !params.showComingSoon) return false
  if (params.ribbonW == null || params.ribbonOffset == null || params.ribbonExtent == null) return false
  const csLeft = params.ribbonSide === "right"
    ? Math.round(params.canvasW - params.ribbonW + params.ribbonOffset)
    : -params.ribbonOffset
  const overlapX = params.numLeft < csLeft + params.ribbonW && params.numLeft + params.numW > csLeft
  const overlapY = params.numTop < params.ribbonExtent && params.numTop + params.numH > 0
  return overlapX && overlapY
}

/**
 * Geometria network effettivamente composta (final composite, shift e offset
 * inclusi) oppure assenza. Unica fonte per il freeze senza salto: il client
 * non duplica mai il layout network.
 */
export interface NetworkGeometry {
  readonly top: number
  readonly left: number
  readonly w: number
  readonly h: number
  /**
   * Dimensioni nominali pre-shrink (stessa scala, prima dell'anti-overlap):
   * uguali a w/h senza shrink. Servono al freeze dopo shrink — la UI
   * ricalibra la scala effettiva come actual/nominal (ancora top-left).
   */
  readonly nominalW: number
  readonly nominalH: number
  /** false = posizione assoluta congelata; true = layout storico che segue il titolo. */
  readonly followTitle: boolean
}

/**
 * Editorial nudge applied to every network pill at composite time
 * (`top + NETWORK_LOGO_SHIFT_Y`): global tuning, not a user offset.
 * Anchor math must subtract it so the on-poster gap stays exact.
 */
export const NETWORK_LOGO_SHIFT_Y = 10

export interface CornerNetworkAboveTitleInput {
  readonly logoTop: number
  readonly logoLeft: number
  readonly logoW: number
  readonly netW: number
  readonly netH: number
  readonly gap: number
  /**
   * Visible Y shift applied at composite time (defaults to
   * NETWORK_LOGO_SHIFT_Y): subtracted here so the on-poster gap stays `gap`.
   */
  readonly visibleShiftY?: number
}

/**
 * Anchor for a `corner`-style network pill above the title logo (landscape
 * default): same formula as the portrait branch (`logoTop - netH - gap`),
 * corrected for the visible shift and centered on the title bounding box in
 * every layout — centered, Cinematic Left or explicitly shifted titles all
 * share the title center (`logoLeft + (logoW - netW) / 2`). Null when there
 * is no room above the title — callers fall back to the historic top-left
 * anchor. Never moves the title. Rank and extra alike: only the corner
 * anchor matters, never the badge kind.
 */
export function cornerNetworkAboveTitle(
  input: CornerNetworkAboveTitleInput,
): { top: number; left: number } | null {
  const shift = input.visibleShiftY ?? NETWORK_LOGO_SHIFT_Y
  const top = input.logoTop - input.netH - input.gap - shift
  if (top < 0) return null
  const left = Math.round(input.logoLeft + (input.logoW - input.netW) / 2)
  return { top, left }
}

/**
 * Top coordinate stacking the network logo below a `corner` top pill when
 * its anchored box overlaps the pill; null when there is no collision (or
 * when there is no corner top badge). Corner-style only — every other
 * style keeps its own placement, and shrinking alone is not enough once
 * the logo dwarfs to its floor while staying in place.
 */
export function stackNetworkBelowCornerRank(params: {
  rankingBadgeStyle: string | null | undefined
  hasTopBadge: boolean
  rank: CornerRankRect | null
  netLeft: number
  netTop: number
  netW: number
  netH: number
  gap: number
}): number | null {
  if (!isCornerAnchoredStyle(params.rankingBadgeStyle) || !params.hasTopBadge || !params.rank) return null
  const rankR = params.rank.left + params.rank.w
  const rankB = params.rank.top + params.rank.h
  const netR = params.netLeft + params.netW
  const netB = params.netTop + params.netH
  const overlapX = params.netLeft < rankR + 6 && netR > params.rank.left - 6
  const overlapY = params.netTop < rankB + 4 && netB > params.rank.top - 4
  if (overlapX && overlapY) return rankB + params.gap
  return null
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
    rankingBadgeStyle, extraBadgeStyle, badgeGenre, badgeYear, badgeRating, badgeQuality, quality,
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
    extraBadgeScale, extraBadgeOffsetX, extraBadgeOffsetY,
    genreBadgeScale, qualityBadgeScale, networkLogoScale,
    separateBadgeScale,
    separateBadgeOffsetX, separateBadgeOffsetY,
    genreBadgeOffsetX, genreBadgeOffsetY, qualityBadgeOffsetX, qualityBadgeOffsetY,
    networkLogoOffsetX, networkLogoOffsetY,
    mediaType, finalRank, animeRankResult,
    mapping, tmdbNetworks, productionCompanies, tmdbStudios,
    tmdbNetworksDetailed, productionCompaniesDetailed,
    tvType, tvStatus, releaseDate, firstAirDate,
    lastAirDate, seasonCount, originCountries,
    wikidataResult, tmdbKeywords, locale, t,
    qLabel, queryExtra, qNetLogo, networkLogo, networkLogoPosition = "auto", networkLogoFollowTitle, networkFixedX, networkFixedY, onNetworkGeometry, sd, accentOverride, imdbTop250,
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
  // Font badge normalizzato (assente/invalido → "inter" = resa storica).
  const badgeFont = normalizeBadgeFont(input.badgeFont)
  // Fresh apply scope (assente/invalido → default condiviso "ranked",
  // fail-closed: senza rank valido rende Standard). Il layout
  // EFFETTIVO si decide sotto, DOPO la selezione del topBadge (il rank
  // mostrato determina l'eleggibilità, non l'appartenenza al catalogo).
  const rawFreshScope = isPosterFreshScope(input.posterFreshScope) ? input.posterFreshScope : DEFAULT_POSTER_FRESH_SCOPE

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
  // 0. Badge computation (prima dei layer: il topBadge mostrato decide il
  // layout Fresh EFFETTIVO sotto scope "ranked"). Blocco puro spostato qui
  // dal passo 4: stessi input, stesso ordine, nessun cambio di output — solo
  // la posizione, così ogni gate `!isFresh` sotto (backdrop, vignetta, logo,
  // badge) usa già l'effettivo.
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

  let topBadge: { type: "extra"; label: string } | { type: "rank"; rank: number; label: string; ribbonLabel?: string } | null = null
  if (rankingEnabled) {
    if (queryExtra) {
      topBadge = { type: "extra" as const, label: queryExtra }
    } else if (computed.badge) {
      const b = computed.badge
      if (b.type === "extra") {
        topBadge = { type: "extra" as const, label: b.label }
      } else {
        // Sottotitolo nastro: override custom esplicito (non rank-key) vince,
        // altrimenti il periodo computato ("Oggi", anche per gli anime).
        const customRibbon = qLabel && !isRankKey(qLabel) ? qLabel : undefined
        topBadge = { type: "rank" as const, rank: b.rank!, label: qLabel || b.rankLabel || b.label, ribbonLabel: customRibbon ?? b.ribbonLabel ?? b.label }
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

  // Fresh opt-in layout EFFETTIVO: stessa risoluzione input, composizione
  // separata. Ogni gate sotto è `&& !isFresh` attorno a un push/ramo: a false
  // (default, assente, "standard", o "ranked" senza rank valido mostrato) il
  // percorso standard esegue le stesse operazioni byte-identiche. Deciso QUI
  // — prima dei rami layout-specific soppressi e con lo stesso helper del
  // numerale (isFreshRank via isEffectiveFreshLayout, nessuna seconda
  // derivazione del rank): il rank è quello mostrato (topBadge numerale, già
  // rankingEnabled-gated sopra), mai l'appartenenza al catalogo.
  const isFresh = isEffectiveFreshLayout(
    input.posterLayout,
    rawFreshScope,
    topBadge?.type === "rank" ? topBadge.rank : null,
  )

  // Task16 experiment (ONE reversible candidate, Fresh WITH valid numeral
  // ONLY): the full-bleed base shifts right ~6% CW with the vacated left gap
  // filled by a blurred mirrored edge extension (prepare helper in
  // fresh-layout). `freshBaseBuf` is the pipeline base + the buffer forwarded
  // to composeFreshOverlay (glass + left-blur sample the NEW view); color
  // analysis above/below stays on the ORIGINAL `posterBuf`. Standard,
  // Fresh-unranked and invalid-rank paths keep the original buffer
  // byte-identically (no extra ops, no re-encode).
  const freshBgRank = topBadge?.type === "rank" ? topBadge.rank : null
  const useFreshReconstructedBg = isFresh && isFreshRank(freshBgRank)
  const freshBaseBuf = useFreshReconstructedBg
    ? (await prepareFreshReconstructedBackground(posterBuf, CW, CH)).png
    : posterBuf

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
    // Fresh: base full-bleed già in posterBuf, nessun layer backdrop storico.
    if (!isFresh) composites.push({ input: backdropResized.input, top: bY, left: bX })
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
  // Reservation logo: in bottom i flag effettivi sono soppressi ma il titolo
  // resta alla stessa altezza della colonna equivalente (stesse preferenze e
  // metadati, anche a 0 provider). La route passa `logoBadgeVisibility` con i
  // flag colonna; assente → flag effettivi (comportamento storico).
  const refVis = input.logoBadgeVisibility
  const logoHasBadges = badgesEnabled
    && ((genreAvailable && (refVis?.genre ?? badgeGenre)) || (ratingAvailable && (refVis?.rating ?? badgeRating)) || (yearAvailable && (refVis?.year ?? badgeYear)))

  // Riga bottom (bottom-bar/bottom-pills): stile già risolto a monte, max 3
  // provider. Vince difensivamente sul custom provider anche se l'input
  // portasse entrambi (la route già esclude il custom in bottom).
  // Difesa: bottom-bar mai in landscape (normalizzazione DOPO cascata, come
  // in poster-config — copre URL vecchi/mapping/default/token e chiamanti
  // diretti del service; i raw salvati restano intatti).
  const bottomStyle = input.separateRatingsStyle ?? "column"
  const effBottomStyle = getSeparateRatingsStyleForShape(bottomStyle, isLandscape ? "landscape" : "poster")
  const isBottomStyle = isBottomSeparateRatingsStyle(effBottomStyle)
  const bottomVariant: SeparateBottomVariant | null = isBottomStyle ? effBottomStyle : null
  const bottomItemCount = bottomVariant ? (input.separateRatings?.length ?? 0) : 0
  // Offset gruppo rating separati (default 0 = percorso storico byte-identico):
  // l'intero gruppo si sposta di (ox, oy); positivo Y = giù come gli altri badge.
  const sepOX = separateBadgeOffsetX ?? 0
  const sepOY = separateBadgeOffsetY ?? 0

  // Single same-hue scene tint for badges + blur (consistent from the same
  // root). No per-zone crop: the bottom-40% voted skin/suit #86642d on
  // portraits with faces at the bottom (e.g. Silo) instead of the scene
  // emerald. An explicit `ac=` override always wins; safety net: genre/gray
  // fallback. resolveBadgeColors stays exported and tested but is no longer
  // on the render path. The gate also covers the extra top badge with
  // ranking off (via preRelease, the only branch turning it on without
  // rankingEnabled): the corner tint stays automatic there too.
  const sceneTintHex = (blurEnabled || hasGenreBadge || rankingEnabled || preRelease)
    ? await extractSceneTint(posterBuf, genreName, analysisKey ? `${analysisKey}:${genreName ?? "x"}` : null)
    : null

  // Automatic badge accent at fixed 5/12 HSL lightness (Windows dialog
  // 100/240): scene-tint hue/saturation stay, only L is normalized — this
  // also applies to the automatic genre/gray fallbacks. The manual `ac=`
  // override never goes through normalization. Blur stays on the natural
  // tint (never from the normalized badge): with no scene the fallback is
  // the natural genre/gray, not the normalized accent.
  const accentColorGenre = accentOverride?.genreColor ?? normalizeAutomaticAccentHex(sceneTintHex ?? (GENRE_FALLBACK[genreName || ""] || "#555555"))
  const accentColorRank = accentOverride?.rankColor ?? normalizeAutomaticAccentHex(sceneTintHex ?? "#555555")

  // Override esplicito `ac=` vince sempre; poi tinta di scena; rete di sicurezza: fallback genere
  const blurTintHex = accentOverride?.genreColor ?? sceneTintHex ?? (GENRE_FALLBACK[genreName || ""] || "#555555")

  // Logo baked-in in entrambi i formati (hideLogo esplicito lo salta:
  // veicolo del banner Nuvio pulito). In landscape valgono i vincoli del
  // canvas 16:9 — stessi di context.tsx e poster-fit-score.ts (Golden Rule).
  const [blurOverlay, logoResult] = await Promise.all([
    applyBlur({
      posterBuf: freshBaseBuf,
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
          // Fresh EFFETTIVO + scala auto (null) = 100 (task8a: il default
          // Fresh non segue la curva aspect da 75 — impostazione 100, non
          // canvas 100%: il bound resta il title cap fresh + canvas).
          // Espliciti (anche 75) invariati; fallback Standard effettivo
          // (fresh+ranked senza rank valido) resta sulla curva aspect.
          const defScale = isFresh && logoScale == null
            ? FRESH_TITLE_LOGO_DEFAULT_SCALE
            : (logoDefaultScaleFromAspect(lw, lh) ?? 75)
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
            hasBadges: logoHasBadges,
            // Fondo logo in linea col badge genere (~10px dal bordo, vedi
            // costanti landscape in logo-layout.ts). In portrait margine
            // maggiorato solo col badge genere (12% vs 10% storico).
            bottomMarginPct: isLandscape ? LANDSCAPE_LOGO_BOTTOM_MARGIN_PCT : (logoHasBadges ? 12 : undefined),
            // Vincoli logo per formato (stessi di context.tsx e
            // poster-fit-score.ts): portrait cap solo altezza + calibrazione
            // +10px; landscape contenuto 40% larghezza / 24% altezza.
            // Fresh EFFETTIVO: l'utente comanda fino al canvas — i cap di
            // formato standard cadono SEMPRE (auto e esplicito condividono lo
            // stesso percorso: auto fresh vale 100 come esplicito 100, quindi
            // auto==esplicito100 byte-identici; l'unico bound resta il title
            // cap fresh, ingrandito della stessa % nel blocco 6b, più il
            // canvas). Standard e fallback Standard (ranked senza rank)
            // restano storici, quindi i render neutrali non-fresh sono
            // byte-identici.
            ...(isFresh
              ? {}
              : (isLandscape
                ? { maxWidthPct: LANDSCAPE_LOGO_MAX_WIDTH_PCT, maxHeightPct: LANDSCAPE_LOGO_MAX_HEIGHT_PCT, topOffset: LANDSCAPE_LOGO_TOP_OFFSET }
                : {
                    maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT,
                    topOffset: PORTRAIT_LOGO_TOP_OFFSET,
                  })),
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
  // Fresh: leggibilità via shade dedicata (composeFreshOverlay), non vignetta.
  if (!isFresh) composites.push({ input: vigBuf, top: 0, left: 0 })
  // Cinematic Left: scrim d'angolo per la leggibilità del blocco a sinistra
  // (si somma alla fascia blur bassa, che resta controllata dall'utente).
  if (isLandscapeLeft && !isFresh) {
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
  // Fresh: il logo titolo riusa il bitmap già ridimensionato ma ancorato in
  // basso a destra (composeFreshOverlay) — qui nessun composite storico.
  if (logoResult && !isFresh) {
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
  // 4. Badge computation — vedi passo 0 sopra: badgeInput/computed/topBadge/
  // Coming Soon sono già risolti prima dei layer (decidono `isFresh` via
  // `isEffectiveFreshLayout`).
  // -----------------------------------------------------------------------

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
  let [pillLogoResult, rawLogoResult] = netLogoEnabled
    ? await Promise.all([
        hasDetailed
          ? renderFirstMatchingNetworkLogoBadgeHybrid(networkCandidatesHybrid as NetworkCandidate[], badgePw, topLight)
          : renderFirstMatchingNetworkLogoBadge(stringCandidates, badgePw, topLight),
        hasDetailed
          ? renderFirstMatchingNetworkRawBadgeHybrid(networkCandidatesHybrid as NetworkCandidate[], badgePw, topLight)
          : renderFirstMatchingNetworkRawBadge(stringCandidates, badgePw),
      ])
    : [null, null]
  // Demo samples network fallback: the ordered candidates above keep full
  // priority (real brands, wikidata studios, saved mapping); the bundled
  // brand renders solely when nothing matched. Same renderer, zero network.
  if (netLogoEnabled && !pillLogoResult && input.demoSamples) {
    const demoCandidates = [{ name: DEMO_SAMPLE_NETWORK.name, logoPath: DEMO_SAMPLE_NETWORK.logoPath }]
    pillLogoResult = await renderFirstMatchingNetworkLogoBadgeHybrid(demoCandidates, badgePw, topLight)
    rawLogoResult = pillLogoResult
      ? await renderFirstMatchingNetworkRawBadgeHybrid(demoCandidates, badgePw, topLight)
      : null
  }
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
  // Effective top-badge style (rank = `rs`, extra = `xbs ?? rs` legacy).
  // Number mirroring and corner anchoring follow this, never `rs` alone: an
  // explicit extra style detaches the extra badge from the ranking style.
  const topBadgeStyle = resolveTopBadgeStyle({ topBadgeType: topBadge?.type, rankingBadgeStyle, extraBadgeStyle })

  // Independent CLASSIFICA vs EXTRA tuning: the effective top-badge tuning
  // follows the KIND of the final topBadge (selected above, after network
  // suppression), never the other group's values. Rank (ribbon included)
  // always uses the legacy classifica tuning; extra uses its own once
  // migrated, else the legacy fallback — editing one never moves or resizes
  // the other.
  const isExtraTopBadge = topBadge?.type === "extra"
  const effTopBadgeScale = isExtraTopBadge ? (extraBadgeScale ?? topBadgeScale) : topBadgeScale
  const effTopBadgeOffsetX = isExtraTopBadge ? (extraBadgeOffsetX ?? topBadgeOffsetX) : topBadgeOffsetX
  const effTopBadgeOffsetY = isExtraTopBadge ? (extraBadgeOffsetY ?? topBadgeOffsetY) : topBadgeOffsetY

  const hasQualityBadge = badgeQuality !== false && !!quality
  // Built-in icon per style+tier (null = standard pill or knockout tag).
  // The style enters the cache key in both cases: style change = new
  // bitmaps, never a collision (knockout and standard share "std").
  const qualityIconPath = qualityBadgeStyle === "knockout" ? null : qualityBadgeIconPath(qualityBadgeStyle, quality)

  // Placca staccata: solo gli stili centrati (il nastro resta ancorato)
  // con offset Y esplicito arrotondano tutti e 4 gli angoli. Calcolato qui
  // (non nel layout sotto) perché entra nella chiave cache: il bitmap cambia.
  const isRankNetflixRibbonStyle = isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank"
  const isRankDetached = !!topBadge && !isRankNetflixRibbonStyle && topBadgeStyle !== "number" && effTopBadgeOffsetY !== 0

  const genreBadgeKey = hasGenreBadge
    ? badgeCacheKey("genre", genreName, voteAverage, CW, year, badgeStyle, badgeFont, accentColorGenre, bottomLight, badgeGenre, badgeYear, badgeRating, genreBadgeScale)
    : null
  const rankBadgeKey = !showComingSoon && topBadge
    ? badgeCacheKey("rank", topBadge.type === "extra" ? topBadge.label : `${(topBadge as { rank: number }).rank}:${topBadge!.label}:${(topBadge as { ribbonLabel?: string }).ribbonLabel ?? ""}`, CW, topLight, topBadgeStyle, badgeFont, accentColorRank, ribbonSide, isAnimeRank, effTopBadgeScale, isRankDetached ? "detached" : undefined, rankingBadgeAccent ? "accent" : undefined)
    : null
  const formatsKey = (videoFormats && videoFormats.length > 0) ? videoFormats.join(",") : "none"
  const qualityBadgeKey = hasQualityBadge
    ? badgeCacheKey("quality", quality, CW, topLight, badgeFont, qualityBadgeScale, qualityBadgeStyle ?? "standard", qualityIconPath ?? "std", formatsKey)
    : null
  const comingSoonKey = showComingSoon
    ? badgeCacheKey("comingsoon", comingSoonLabel, CW, badgeFont, topLight, ribbonSide)
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
                renderGenreBadge(genreName ?? "", voteAverage ?? 0, badgePw, year, badgeStyle, accentColorGenre, bottomLight, { showGenre: badgeGenre, showYear: badgeYear, showRating: badgeRating }, badgeStyle === "bar" ? genreBadgeScale : 100, badgeFont)
                .then((r) => { if (r) cacheSet(genreBadgeKey, r, ["badge"], BADGE_CACHE_TTL); return r })
            ))
      : Promise.resolve(null)
  const renderStandardRank = async (): Promise<{ png: Buffer; w: number; h: number; isRank?: boolean } | null> =>
    rankBadgeKey
      ? (cacheGet<{ png: Buffer; w: number; h: number; isRank?: boolean }>(rankBadgeKey)
          || coalesceBadgeRender(rankBadgeKey, () => {
              if (topBadge!.type === "extra") {
                // Extra badges render with the standalone style when set, else
                // the legacy `rs` fallback (plus the no-ribbon accent rule).
                return renderExtraBadge(topBadge!.label, topBadgePw, topLight, extraBadgeStyle ?? (rankingBadgeAccent ? "colored" : rankingBadgeStyle), accentColorRank, isRankDetached, badgeFont)
                  .then((r) => { const v = { ...r, isRank: false }; cacheSet(rankBadgeKey, v, ["badge"], BADGE_CACHE_TTL); return v })
              }
              return renderRankingBadge((topBadge as { rank: number }).rank, isRibbonRankingStyle(rankingBadgeStyle) ? badgePw : topBadgePw, topBadge!.label, topLight, rankingBadgeStyle, accentColorRank, ribbonSide, isAnimeRank, isRankDetached, rankingBadgeAccent, (topBadge as { ribbonLabel?: string }).ribbonLabel, badgeFont)
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
              const res = await renderQualityBadgeGroup(quality!, qualityBadgeStyle, videoFormats, badgePw, topLight, badgeFont)
              if (res) cacheSet(qualityBadgeKey, res, ["badge"], BADGE_CACHE_TTL)
              return res
            }))
      : Promise.resolve(null),
    comingSoonKey
      ? (cacheGet<{ png: Buffer; w: number; h: number }>(comingSoonKey)
          || coalesceBadgeRender(comingSoonKey, () =>
              renderComingSoonRibbon(comingSoonLabel, badgePw, ribbonSide === "right" ? "right" : "left", badgeFont)
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
            const scaledH = Math.max(1, Math.round(rankBadgeResult.h * effTopBadgeScale / 100))
            const scaledW = Math.max(1, Math.round(rankBadgeResult.w * effTopBadgeScale / 100))
            const targetH = Math.max(1, scaledH - 20)
            const targetW = Math.max(1, Math.round(scaledW * (targetH / scaledH)))
            if (targetH !== rankBadgeResult.h || targetW !== rankBadgeResult.w) {
              const png = await sharp(rankBadgeResult.png).resize(targetW, targetH).toBuffer()
              return { ...rankBadgeResult, png, w: targetW, h: targetH }
            }
            return rankBadgeResult
          }
          return effTopBadgeScale !== 100
            ? await scaleBitmapForLayout(rankBadgeResult, effTopBadgeScale)
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

  // Rettangolo finale del badge genere (per il contenimento colonna separati
  // sotto: solo shrink quando lo stack sfora, mai enlarge — a scala 100 lo
  // spazio basta sempre e il percorso resta byte-identico).
  let genreBadgeRect: { top: number; left: number; w: number; h: number } | null = null
  // Fresh: la colonna meta sostituisce il badge genere (nessun duplicato).
  if (safeGenreBadgeResult && !isFresh) {
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
      const barTop = CH - safeGenreBadgeResult.h
      genreBadgeRect = { top: barTop, left: barLeft, w: safeGenreBadgeResult.w, h: safeGenreBadgeResult.h }
      composites.push({ input: safeGenreBadgeResult.png, top: barTop, left: barLeft })
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
        const fullKey = badgeCacheKey("genre", genreName, voteAverage, CW, year, badgeStyle, badgeFont, accentColorGenre, bottomLight, badgeGenre, badgeYear, true, genreBadgeScale)
        const fullHit = cacheGet<{ png: Buffer; w: number; h: number }>(fullKey)
        const fullW = fullHit
          ? fullHit.w
          : await coalesceBadgeRender(fullKey, () =>
              renderGenreBadge(genreName ?? "", voteAverage ?? 0, badgePw, year, badgeStyle, accentColorGenre, bottomLight, { showGenre: badgeGenre, showYear: badgeYear, showRating: true }, 100, badgeFont)
                .then((r) => { if (r) cacheSet(fullKey, r, ["badge"], BADGE_CACHE_TTL); return r }),
            ).then((r) => (r ? r.w : null), () => null)
        if (fullW != null && fullW > genreBadgeResult.w) {
          sepCenterShift = Math.round(((fullW - genreBadgeResult.w) / 2) * (genreBadgeScale / 100))
        }
      }
      const genreLeftFor = (w: number) => anchorRight
        ? landscapeRightAnchorLeft(w, CW, genreBadgeOffsetX - sepCenterShift - styleCornerShiftX)
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
      genreBadgeRect = { top: genreTop, left: genreLeft, w: genreBox.w, h: genreBox.h }
      composites.push({ input: genreBox.png, top: genreTop, left: genreLeft })
    }
  }
  // Riga custom provider: se renderizzata, la colonna separati si nasconde
  // (mai due stack di rating impilati — il provider vince). In modalità
  // bottom la riga non si rende mai (vince il bottom, mai duplicati — anche
  // senza dati: non inventa/fallback provider mentre la route sopprime
  // genere/anno/voto).
  let customRowRendered = false
  // Fresh: i provider custom vivono come righe testo nella colonna meta.
  if (input.ratings?.length && !isBottomStyle && !isFresh) {
    // Optional enrichment must never prevent the original poster from rendering.
    // La riga sta sopra il badge genere, in basso: stessa polarità del fondo.
    const row = await renderMultiRatings(input.ratings, CW - 40, bottomLight, badgeFont).catch(() => null)
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
    // The pill (centered or corner) sits 10px below the top edge (fixed
    // editorial measure). Default is flush with the top. Pill/corner only,
    // independent of the quality badge.
    const pillTopGap = topBadgeStyle === "pill" || isCornerAnchoredStyle(topBadgeStyle) ? 10 : 0
    let left: number
    if (isNetflixRibbon && (presetIsRibbon ? presetRibbonRight : isRightRibbon)) {
      left = Math.round(CW - safeRankBadgeResult.w) // nastro a destra (Stremio o side del preset)
    } else if (isNetflixRibbon) {
      left = 0 // nastro Netflix a sinistra (Nuvio, default)
    } else if (isCornerAnchoredStyle(topBadgeStyle) && topBadge) {
      // Corner style: flat pill anchored to the top-left corner
      // (same box margin as the network logo: netPadX) for every top
      // badge, rank or extra. A colliding network logo stacks below the
      // pill via stackNetworkBelowCornerRank; quality avoids it via
      // shrinkToAvoidRank (generic over the top rect).
      // Number style: same anchor, mirrored to the top-right corner with
      // side="right" (the existing ribbon side switch). Corner keeps its
      // historic left anchor (mirrorRight=false).
      const mirrorRight = topBadgeStyle === "number" && ribbonSide === "right"
      // Rank numerals sit on the style baseline (NUMBER_BADGE_BASE_OFFSET_X):
      // the effective offset stays the user adjustment relative to it
      // (stored values untouched, no new params). Extra badges on the legacy
      // `rs=number` fallback keep the historic anchor (no -20 for extra).
      // The final left below feeds the collision rects (quality/network
      // stacking, Coming Soon), so they follow the shifted numeral with no
      // extra change.
      left = cornerAnchoredLeft({
        canvasW: CW,
        badgeW: safeRankBadgeResult.w,
        mirrorRight,
        offsetX: effTopBadgeOffsetX + resolveNumberBadgeBaseOffsetX(topBadge?.type, topBadgeStyle),
      })
    } else {
      // Badge grande al centro, dimensione invariata: in caso di sovrapposizione
      // si rimpiccioliscono i badge laterali (network e qualità agli angoli opposti).
      left = Math.round((CW - safeRankBadgeResult.w) / 2) + effTopBadgeOffsetX
    }
    finalRankBadge = safeRankBadgeResult
    finalRankLeft = left
    // Corner top badge stacked below a left Coming Soon ribbon sharing its
    // corner (the ribbon itself is untouched); otherwise the fixed top gap.
    // Historic corner keeps its left-only rule. Number mirrors with
    // side="right", so the shared corner is whichever side the numeral sits
    // on: overlap is tested against the real boxes (Coming Soon composite
    // rect + numeral rect at its unstacked candidate top), so explicit
    // tox/toy that move the numeral away don't force a useless stack.
    const isCornerTop = isCornerAnchoredStyle(topBadgeStyle) && !!topBadge
    const comingSoonSharesCorner = topBadgeStyle === "number"
      ? numberSharesComingSoonCorner({
          canvasW: CW,
          hasTopBadge: !!topBadge,
          showComingSoon,
          ribbonSide,
          ribbonW: safeComingSoonResult?.w ?? null,
          ribbonOffset: ribbonLayout?.offset ?? null,
          ribbonExtent: ribbonLayout?.extent ?? null,
          numLeft: left,
          numTop: effTopBadgeOffsetY + pillTopGap,
          numW: safeRankBadgeResult.w,
          numH: safeRankBadgeResult.h,
        })
      : showComingSoon && !!ribbonLayout && !!safeComingSoonResult && ribbonSide !== "right"
    const cornerTop = isCornerTop
      ? cornerRankTop({
          comingSoonLeft: comingSoonSharesCorner,
          ribbonExtent: ribbonLayout?.extent ?? 0,
          gap: Math.round(6 * CH / 570),
          pillTopGap,
        })
      : pillTopGap
    finalRankTop = isCentered ? effTopBadgeOffsetY + cornerTop : 0

    // Il badge centrale resta invariato — la gestione overlap vive nei blocchi
    // network/qualità qui sotto (shrink dei laterali).
  }
  // Fresh: il rank vive nel numerale vetro (sotto); qui solo gli extra.
  if (finalRankBadge && finalRankLeft !== null && !isFresh) {
    composites.push({
      input: finalRankBadge.png,
      top: finalRankTop,
      left: finalRankLeft,
    })
  }
  // Nastro Coming Soon: angolo in alto (a sinistra; a destra con side="right"), sopra il badge centrale
  // (quando coesistono per custom esplicito) e sopra il velo pre-digitale.
  // Fresh: l'insertion point dei layer fresh è qui — shade/numerale/meta
  // stanno SOPRA velo/ombra (come i badge standard, restano luminosi) ma
  // SOTTO il chrome conservato (Coming Soon, qualità, extra), così la shade
  // non scurisce mai il chrome e il ribbon resta visibile.
  // (Dichiarata qui, usata nel blocco 6b: splice prima del chrome.)
  let freshInsertAt: number | null = null
  if (isFresh) freshInsertAt = composites.length
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
  // Tuning editoriale globale (default per tutti i poster): pill network
  // +10px Y (module-scope NETWORK_LOGO_SHIFT_Y, shared with the anchor).
  let netTopLeftBottom: number | null = null
  // Modalità "in alto" (query `netPos=top` > mapping > config > defaults):
  // sempre all'angolo superiore. "auto" = specchio dinamico odierno.
  const netForceTop = networkLogoPosition === "top"
  // La qualità legge da qui se il network è finito a destra in modo "top"
  // (trasloca a sinistra come col nastro a destra).
  let netAnchoredRight = false
  // Posizione assoluta congelata (checkbox OFF): salta TUTTI i rami di
  // reposition/shrink da titolo/badge/mirror sotto. Le coordinate sono gli
  // actual finali (shift editoriale e offset già inclusi al freeze): nessun
  // clamp dimensionale, nessun ricalcolo. Null/assenti = layout storico.
  const isFixedNetwork = networkLogoFollowTitle === false && networkFixedX != null && networkFixedY != null
  // Actual finale per il freeze senza salto (solo numeri): valorizzato al
  // composite, null se il network non viene reso.
  let netGeo: NetworkGeometry | null = null
  // Fresh: il mark provider riusa il bitmap raw nella colonna meta (sotto).
  if (networkLogoForLayout && !isFresh) {
    const gap = Math.round(6 * CH / 570)
    let fittedRaw = await fitBadgeToCanvas(networkLogoForLayout, CW, CH)
    if (fittedRaw) {
      let top: number
      let left: number
      const isNetflixRibbon = isRibbonRankingStyle(rankingBadgeStyle) && topBadge?.type === "rank"
      const hasComingSoonCorner = showComingSoon && !!ribbonLayout && !!safeComingSoonResult
      const netPadX = Math.round(18 * CW / 380)
      const netPadY = Math.round(18 * CH / 570)
      // Corner rank rect for the below-pill network stacking (null unless a
      // corner rank badge was rendered). Corner-style only.
      const cornerRankRect: CornerRankRect | null =
        finalRankBadge && finalRankLeft !== null
          ? { left: finalRankLeft, top: finalRankTop, w: finalRankBadge.w, h: finalRankBadge.h }
          : null
      // Anchored network size for the collision check (insertions run before
      // any shrink, so this is the full-size box).
      const netRawW = fittedRaw.w
      const netRawH = fittedRaw.h
      const stackBelowCornerRank = (top: number, left: number): { top: number; left: number } => {
        const stacked = stackNetworkBelowCornerRank({
          rankingBadgeStyle: topBadgeStyle,
          hasTopBadge: !!topBadge,
          rank: cornerRankRect,
          netLeft: left,
          netTop: top,
          netW: netRawW,
          netH: netRawH,
          gap,
        })
        return stacked !== null ? { top: stacked, left: netPadX } : { top, left }
      }

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

      if (isFixedNetwork) {
        // OFF: coordinate assolute, nessun reposition/shrink. La scala resta
        // ancorata top-left (fittedRaw invariato qui).
        top = networkFixedY as number
        left = networkFixedX as number
      } else if (netForceTop) {
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
        // Corner rank at the same corner: stack below the pill instead of
        // shrinking in place (corner-style only, no-op otherwise).
        const cornerStackedTop = stackBelowCornerRank(top, left)
        top = cornerStackedTop.top
        left = cornerStackedTop.left
        fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
        // Solo a sinistra alimenta lo stacking qualità (a destra la qualità
        // ha già traslocato a sinistra, niente da impilare).
        if (!sideRight) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
        else netAnchoredRight = true
      } else if (isLandscape && logoResult) {
        // Landscape with a title logo: never above the logo (bottom zone) —
        // always on top: beside the ribbon when it takes the left corner
        // (Netflix style), below Coming Soon when it takes that corner,
        // otherwise top-left (with shrink vs the centered badge), EXCEPT the
        // `corner` style (rank or extra): by default the network pill sits
        // above the title logo as in portrait (same formula, centered on the
        // title box). Portrait keeps the historic branch below.
        // Explicit netPos=top lives in the branch above and is unchanged.
        let cornerAboveTitlePlaced = false
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
          // Corner style with a title logo: try above the title first (same
          // anchor as portrait, shift-corrected and centered on the title
          // box). The corner pill itself never moves: on collision the
          // network only shrinks in place, and when it still collides (or
          // there is no room above the title) the historic top-left anchor
          // below applies.
          let aboveTitle: { top: number; left: number } | null = null
          if (isCornerAnchoredStyle(topBadgeStyle) && topBadge && cornerRankRect) {
            const anchor = cornerNetworkAboveTitle({
              logoTop: logoResult.top,
              logoLeft: logoResult.left,
              logoW: logoResult.w,
              netW: netRawW,
              netH: netRawH,
              gap,
            })
            if (anchor) {
              const shrunk = await shrinkToAvoidRank(fittedRaw, anchor.top, anchor.left)
              // Recompute the anchor on the final (possibly shrunk) size so
              // the title centering and the visible gap hold exactly; a
              // smaller box can only move down, never above y=0.
              const finalAnchor = cornerNetworkAboveTitle({
                logoTop: logoResult.top,
                logoLeft: logoResult.left,
                logoW: logoResult.w,
                netW: shrunk.w,
                netH: shrunk.h,
                gap,
              }) ?? anchor
              const clash = stackNetworkBelowCornerRank({
                rankingBadgeStyle: topBadgeStyle,
                hasTopBadge: !!topBadge,
                rank: cornerRankRect,
                netLeft: finalAnchor.left,
                netTop: finalAnchor.top,
                netW: shrunk.w,
                netH: shrunk.h,
                gap,
              })
              // Keep the above-title placement only once the collision is
              // resolved: never moved back over the corner pill.
              if (clash === null) {
                aboveTitle = finalAnchor
                fittedRaw = shrunk
              }
            }
          }
          if (aboveTitle) {
            top = aboveTitle.top
            left = aboveTitle.left
            cornerAboveTitlePlaced = true
          } else {
            top = netPadY
            left = netPadX
            const cornerStackedLandscape = stackBelowCornerRank(top, left)
            top = cornerStackedLandscape.top
            left = cornerStackedLandscape.left
            fittedRaw = await shrinkToAvoidRank(fittedRaw, top, left)
          }
        }
        // Above the title the network does not take the top-left corner:
        // quality keeps its corner anchor (netTopLeftBottom stays null).
        if (rightRankRibbonLeft === null && !mirrorNetworkBelow && !cornerAboveTitlePlaced) netTopLeftBottom = top + NETWORK_LOGO_SHIFT_Y + fittedRaw.h
      } else if (logoResult && (finalRankBadge || hasComingSoonCorner)) {
        // Con logo film + badge alto (nastro Netflix, badge centrale
        // rank/extra, o Coming Soon): subito sopra il logo film
        // (in Cinematic Left allineato a sinistra come sopratitolo, non centrato).
        top = Math.max(0, logoResult.top - fittedRaw.h - gap)
        left = isLandscapeLeft ? logoResult.left : Math.round((CW - fittedRaw.w) / 2)
        const cornerStackedLogoTop = stackBelowCornerRank(top, left)
        top = cornerStackedLogoTop.top
        left = cornerStackedLogoTop.left
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
        const cornerStackedPlain = stackBelowCornerRank(top, left)
        top = cornerStackedPlain.top
        left = cornerStackedPlain.left
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
        const cornerStackedLogo = stackBelowCornerRank(top, left)
        top = cornerStackedLogo.top
        left = cornerStackedLogo.left
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
      // In fissa le coordinate sono già gli actual finali (shift e offset
      // inclusi al freeze): composite esatto. In storica restano gli offset
      // post-ancoraggio + shift editoriale.
      const finalNetTop = isFixedNetwork ? top : top + networkLogoOffsetY + NETWORK_LOGO_SHIFT_Y
      const finalNetLeft = isFixedNetwork ? left : left + networkLogoOffsetX
      if (isFixedNetwork) {
        // Il fondo effettivo alimenta lo stacking qualità (che resta); la
        // qualità non sposta mai il network.
        netTopLeftBottom = finalNetTop + fittedRaw.h
      }
      netGeo = { top: finalNetTop, left: finalNetLeft, w: fittedRaw.w, h: fittedRaw.h, nominalW: netRawW, nominalH: netRawH, followTitle: !isFixedNetwork }
      composites.push({
        input: fittedRaw.png,
        // Offset applicati DOPO il posizionamento automatico (come il badge
        // qualità): la logica overlap/shrink ragiona sulla posizione ancorata.
        // NETWORK_LOGO_SHIFT_Y è default globale (tuning editoriale), non
        // offset utente: sposta anche l'ancora netTopLeftBottom sotto.
        top: finalNetTop,
        left: finalNetLeft,
      })
    }
  }
  onNetworkGeometry?.(netGeo)

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
    // Number mirrored right occupies the top-right corner exactly like a
    // right ribbon: the quality pill moves left instead of overlapping the
    // bare digits (shrink-in-place bottoms out at 0.55x and still collides).
    // Follows the effective top-badge style (same source as the separate
    // stack below): an explicit extra style never mirrors, so quality and
    // stack stay on the same corner.
    const isNumberRight = isTopBadgeNumberRightCorner({
      topBadgeType: topBadge?.type,
      rankingBadgeStyle,
      extraBadgeStyle,
      ribbonSide,
      hasTopBadge: !!finalRankBadge,
    })
    // Network "in alto" finito a destra: la qualità trasloca a sinistra
    // come col nastro a destra (stesso branch, niente overlap sull'angolo).
    const isRightRibbonCorner = (isNetflixRight && !!finalRankBadge) || isComingSoonRight || (presetRibbonRight && !!finalRankBadge) || (!!networkLogoForLayout && netAnchoredRight) || isNumberRight

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
  // Solo stile colonna: in modalità bottom gli items vanno alla riga sotto.
  // Fresh: i valori vivono come righe testo nella colonna meta (sotto).
  if (!customRowRendered && !isBottomStyle && input.separateRatings?.length && !isFresh) {
    const items = input.separateRatings.slice(0, 3)
    const netPadX = Math.round(18 * CW / 380)
    const netBaseTop = Math.round(18 * CH / 570)
    // Senza qualità ma con nastro a destra, lo stack segue a sinistra come
    // farebbe la qualità (stessa condizione del blocco sopra). Vale anche
    // per il numerale specchiato a destra (stesso angolo occupato).
    const rightCorner = qualityStackAnchor
      ? qualityStackAnchor.leftCorner
      : ((isRibbonRankingStyle(rankingBadgeStyle) && ribbonSide === "right" && topBadge?.type === "rank" && !!finalRankBadge)
        || (showComingSoon && ribbonSide === "right" && !!ribbonLayout)
        || isTopBadgeNumberRightCorner({ topBadgeType: topBadge?.type, rankingBadgeStyle, extraBadgeStyle, ribbonSide, hasTopBadge: !!finalRankBadge }))
    const stackTop = (qualityStackAnchor ? qualityStackAnchor.top + 6 : netBaseTop - 10)
      + (isLandscape ? 0 : PORTRAIT_SEPARATE_SHIFT_Y)
    const stackKey = badgeCacheKey("separate", items.map((i) => `${i.id}${i.value}`).join(","), CW, badgeFont, topLight, separateBadgeScale)
    const cached = cacheGet<{ png: Buffer; w: number; h: number }>(stackKey)
    const stack = cached ?? await coalesceBadgeRender(stackKey, () =>
      renderSeparateRatingStack(items, badgePw, topLight, badgeFont, separateBadgeScale)
        .then((r) => { if (r) cacheSet(stackKey, r, ["badge"], BADGE_CACHE_TTL); return r })
    )
    const fitted = stack ? await fitBadgeToCanvas(stack, CW, CH) : null
    // Contenimento colonna sopra il badge genere: SOLO per ingrandimenti
    // (separateBadgeScale > 100). La resa default 100 è un contratto storico
    // e non viene mai alterata, nemmeno con tuning preesistenti (offset o
    // scale altrui) che riducono lo spazio disponibile. Soglia 40px: con
    // offset arbitrari lo spazio può restare insufficiente anche dopo lo
    // shrink — quel caso è fuori scope (garantito solo il layout normale) e
    // si conserva leggibilità minima invece di collassare la colonna;
    // nessuna promessa di zero overlap universale. Mai enlarge.
    let stackFitted = fitted
    if (stackFitted && genreBadgeRect && separateBadgeScale > 100) {
      const finalTop = Math.max(0, stackTop)
      const maxStackH = genreBadgeRect.top - finalTop - 6
      if (stackFitted.h > maxStackH && maxStackH >= 40) {
        stackFitted = await scaleBitmapForLayout(stackFitted, (maxStackH / stackFitted.h) * 100)
      }
    }
    if (stackFitted) {
      const leftPos = qualityStackAnchor
        ? Math.round(qualityStackAnchor.centerX - stackFitted.w / 2)
        : (rightCorner ? netPadX : Math.round(CW - netPadX + 10 - stackFitted.w))
      // Clamp dentro il canvas come gli altri badge (a offset 0 identico allo storico).
      const sepLeft = Math.max(0, Math.min(CW - stackFitted.w, leftPos + sepOX))
      const sepTop = Math.max(0, Math.min(CH - stackFitted.h, stackTop + sepOY))
      composites.push({ input: stackFitted.png, top: sepTop, left: sepLeft })
    }
  }

  // Riga bottom (bottom-bar/bottom-pills/bottom-mono/bottom-color):
  // rimpiazza colonna e badge genere
  // (già soppresso a monte via flag effettivi) sul bordo inferiore. La barra
  // in portrait è full-width a filo; in landscape la barra non esiste più
  // (normalizzata a pills a monte): le righe non-bar in landscape sono
  // ancorate a DESTRA
  // con la stessa geometria base del badge genere (landscapeRightAnchorLeft,
  // extra = 0, opticalShift = 0: margine interno pieno 18*CW/380, senza il
  // +40 ottico del genere), non centrate sul canvas, con base geometrica
  // landscape -20 X / -10 Y (LANDSCAPE_BOTTOM_PILLS_SHIFT_*). Forma canvas invariata.
  // Fresh: nessun bitmap bottom storico (i valori sono nella colonna meta).
  if (bottomItemCount > 0 && badgesEnabled && bottomVariant && !isFresh) {
    const items = input.separateRatings!.slice(0, 3)
    const isBar = bottomVariant === "bottom-bar"
    const availW = isBar && !isLandscape ? CW : (isLandscape ? CW - 80 : CW - 36)
    const bottomKey = badgeCacheKey("separate-bottom", bottomVariant, items.map((i) => `${i.id}${i.value}`).join(","), CW, badgeFont, separateBadgeScale, availW, bottomLight ? "bl1" : "bl0")
    const cached = cacheGet<{ png: Buffer; w: number; h: number }>(bottomKey)
    const bottom = cached ?? await coalesceBadgeRender(bottomKey, () =>
      renderSeparateRatingsBottom(items, badgePw, bottomVariant, badgeFont, separateBadgeScale, availW, bottomLight)
        .then((r) => { if (r) cacheSet(bottomKey, r, ["badge"], BADGE_CACHE_TTL); return r })
    )
    const fitted = bottom ? await fitBadgeToCanvas(bottom, CW, CH) : null
    if (fitted) {
      const margin = Math.round(20 * CH / 570)
      const barFlush = isBar && !isLandscape
      // Base righe non-bar in landscape: shift geometrico -20/-10 PRIMA di
      // offset utente (sepox/sepoy additivi dopo) e collision handling logo.
      // Portrait non-bar +5 Y (PORTRAIT_SEPARATE_SHIFT_Y) prima degli offset;
      // colonna portrait coperta dal ramo colonna; bottom-bar portrait a filo
      // invariata (il +5 sarebbe annullato dal clamp); bottom-bar
      // normalizzata a pills coperta dallo stesso ramo (in landscape i bare
      // restano invariati, solo la barra normalizza).
      const isLandscapePills = isLandscape && !isBar
      const isPortraitPills = !isLandscape && !isBar
      const topFor = (h: number) => barFlush ? CH - h : CH - h - margin + (isLandscapePills ? LANDSCAPE_BOTTOM_PILLS_SHIFT_Y : 0) + (isPortraitPills ? PORTRAIT_SEPARATE_SHIFT_Y : 0)
      const leftFor = (w: number) => barFlush ? 0 : isLandscape ? landscapeRightAnchorLeft(w, CW, 0, 0) + (isLandscapePills ? LANDSCAPE_BOTTOM_PILLS_SHIFT_X : 0) : Math.round((CW - w) / 2)
      // Offset sul gruppo intero con clamp dentro il canvas; la barra
      // portrait è full-width a filo: la X è ignorata esplicitamente (la UI
      // disabilita lo slider), la Y resta attiva. A offset 0 identico allo storico.
      const topForOff = (h: number) => Math.max(0, Math.min(CH - h, topFor(h) + sepOY))
      const leftForOff = (w: number) => barFlush ? 0 : Math.max(0, Math.min(CW - w, leftFor(w) + sepOX))
      // Righe non-bar in landscape + logo titolo a sinistra: se la riga copre
      // il logo si rimpicciolisce la riga (stessa regola del badge genere,
      // min 0.7 — mai il logo, scala utente esplicita). Solo non-bar in
      // landscape: portrait byte-identico al passato.
      let rowBox = fitted
      if (logoResult && isLandscape && !isBar) {
        const overlapsLogo = (w: number, h: number, l: number, t: number) =>
          l < logoResult.left + logoResult.w && l + w > logoResult.left &&
          t < logoResult.top + logoResult.h && t + h > logoResult.top
        if (overlapsLogo(rowBox.w, rowBox.h, leftForOff(rowBox.w), topForOff(rowBox.h))) {
          let scale = 1
          const minScale = 0.7
          let curW = rowBox.w
          let curH = rowBox.h
          while (scale > minScale && overlapsLogo(curW, curH, leftForOff(curW), topForOff(curH))) {
            scale -= 0.1
            if (scale < minScale) scale = minScale
            const newW = Math.max(1, Math.round(rowBox.w * scale))
            const newH = Math.max(1, Math.round(rowBox.h * scale))
            if (newW === curW && newH === curH) break
            curW = newW
            curH = newH
            if (scale <= minScale) break
          }
          if (curW !== rowBox.w || curH !== rowBox.h) {
            const png = await sharp(rowBox.png).resize(curW, curH).toBuffer()
            rowBox = { ...rowBox, png, w: curW, h: curH }
          }
        }
      }
      const top = topForOff(rowBox.h)
      const left = leftForOff(rowBox.w)
      composites.push({ input: rowBox.png, top, left })
    }
  }


  // -----------------------------------------------------------------------
  // 6b. Fresh composition (solo layout=fresh): shade dedicata + numerale
  // vetro + colonna meta + provider + logo titolo. I layer entrano
  // all'insertion point registrato prima del chrome conservato (Coming Soon
  // e qualità già in `composites`, extra subito dopo): la shade resta sotto
  // il chrome e non lo scurisce mai. Velo pre-digitale e ombra superiore
  // restano sotto come nello standard (i badge fresh restano luminosi come
  // quelli standard); blur pipeline e ribbon invariati.
  // -----------------------------------------------------------------------
  if (isFresh) {
    // Stessa priorità dello standard: il rank arriva dal topBadge già
    // risolto (queryExtra > computato > Coming Soon). Mai inventato: solo un
    // rank reale disegna il numerale.
    const freshRank = topBadge?.type === "rank" ? topBadge.rank : null
    // La route pre-filtra già gli input rating per lo standard (flag
    // effettivi, custom soppresso in bottom, separate definiti solo quando
    // attivi) e passa i toggle raw equivalenti nei campi freshRaw* —
    // così freshMetaRows applica gli stessi gate condivisi
    // (resolveSeparateDisplayState) sui valori RAW, non su quelli effettivi
    // (già soppressi: con la colonna attiva l'effettivo sarebbe sempre OFF
    // e fresh non mostrerebbe mai i separati). I chiamanti diretti del
    // service senza campi freshRaw* usano `badgeRating` così com'è (mai
    // riacceso dall'esistenza degli array) e l'array definito come toggle
    // separato — `badgeRating: false` + array popolati = nessuna riga
    // separata, come nello standard.
    const freshRawBadgeRating = input.freshRawBadgeRating ?? input.badgeRating
    const freshRawSeparateEnabled = input.freshRawSeparateRatings ?? (input.separateRatings !== undefined)
    const freshLayers = await composeFreshOverlay({
      posterBuf: freshBaseBuf,
      CW,
      CH,
      rank: freshRank,
      meta: {
        badgesEnabled,
        badgeGenre,
        badgeYear,
        badgeRating: freshRawBadgeRating,
        separateRatingsEnabled: freshRawSeparateEnabled,
        separateRatingsStyle: isBottomStyle && bottomVariant ? bottomVariant : "column",
        customRatingsEnabled: input.ratings !== undefined,
        genreName,
        year,
        voteAverage,
        separateRatings: input.separateRatings,
        customRatings: input.ratings,
      },
      logo: logoResult ? { png: logoResult.input, w: logoResult.w, h: logoResult.h } : null,
      provider: networkLogoForLayout ? { png: networkLogoForLayout.png, w: networkLogoForLayout.w, h: networkLogoForLayout.h } : null,
      badgeFont,
      // Existing per-shape Transform controls, no new params: the rank
      // numeral follows the classifica tuning, the meta column the genre
      // tuning, the provider its offsets (+ the follow/fixed contract), the
      // title logo its offsets once. Provider/logo SCALES ride the bitmaps
      // above (`netscale` in networkLogoForLayout, `logoScale` in
      // logoResult) and are never re-applied as a second resize inside
      // fresh-layout: the same % only enlarges the slot caps there, so one
      // fit grows the mark linearly until the canvas edge (neutral 100 =
      // historic caps, byte-identical; null logoScale counts as 100).
      transforms: {
        numeralScale: topBadgeScale,
        numeralOffsetX: topBadgeOffsetX,
        numeralOffsetY: topBadgeOffsetY,
        metaScale: genreBadgeScale,
        metaOffsetX: genreBadgeOffsetX,
        metaOffsetY: genreBadgeOffsetY,
        providerScale: networkLogoScale,
        providerOffsetX: networkLogoOffsetX,
        providerOffsetY: networkLogoOffsetY,
        providerFollowTitle: networkLogoFollowTitle ?? true,
        providerFixedX: networkFixedX ?? null,
        providerFixedY: networkFixedY ?? null,
        logoScale: logoScale ?? null,
        logoOffsetX: logoOffsetX ?? null,
        logoOffsetY: logoOffsetY ?? null,
      },
    })
    composites.splice(freshInsertAt ?? composites.length, 0, ...freshLayers)
    // Badge extra non-rank: bitmap standard riusato al top (stesso anchor).
    if (isExtraTopBadge && finalRankBadge && finalRankLeft !== null) {
      composites.push({ input: finalRankBadge.png, top: finalRankTop, left: finalRankLeft })
    }
  }


  // -----------------------------------------------------------------------
  // 7. Final composite
  // -----------------------------------------------------------------------
  const safeComposites = (await Promise.all(composites.map((layer) => fitCompositeToCanvas(layer, CW, CH))))
    .filter((layer): layer is PosterComposite => layer !== null)

  // Il blur è un overlay RGBA grezzo (nessun PNG intermedio): entra come primo
  // layer, sotto backdrop/vignetta/badge — stesso ordine del vecchio blur "cotto"
  // nella base. La base non subisce ritocchi colore: niente modulate,
  // l'artwork TMDB passa invariato nel composite finale (task16: la base è il
  // background ricostruito solo in Fresh-ranked, originale altrove).
  const layers: Array<PosterComposite | { input: Buffer; raw: { width: number; height: number; channels: 4 }; top: number; left: number }> = blurOverlay
    ? [{ input: blurOverlay.overlay, raw: { width: CW, height: blurOverlay.height, channels: 4 }, top: blurOverlay.top, left: 0 }, ...safeComposites]
    : safeComposites

  let pipeline = sharp(freshBaseBuf)

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
