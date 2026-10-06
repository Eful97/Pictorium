import fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import type { BadgeStyle, RankingBadgeStyle, QualityBadgeStyle, BadgeFont, SeparateRatingsStyle, ExtraBadgeStyle } from "@/lib/badge-styles"
import type { StreamQuality } from "@/lib/quality-tiers"
import type { SashBucket } from "@/lib/badge-priority"
import type { VideoFormat } from "@/lib/av-specs"
import { isVideoFormat } from "@/lib/av-specs"
import { isBadgeStyle, isRankingBadgeStyle, isQualityBadgeStyle, isBadgeFont } from "@/lib/badge-styles"
import type { DateFormat } from "@/lib/release-badge"
import { normalizeRegion } from "@/lib/regions"
import { envWithFallback } from "@/lib/env-compat"
import { atomicWriteFile } from "@/lib/atomic-write"
import { getKv, getStorageMode } from "@/lib/kv"
import { getCatalogEpoch } from "@/lib/catalog-epoch"

const log = createLogger("server-defaults")

/**
 * Landscape render defaults: same tunable fields as portrait plus the shared
 * visuals that may diverge per shape (styles, toggles, sash priority, A/V
 * formats, network placement, pre-release, ribbon). Always shared, never per
 * shape: vote sources (`ratingSources`), Top 20 source, region, date format,
 * API keys/catalogs, logo fit and rotations (already split elsewhere).
 * Absent keys follow portrait flats; explicit `false`/`[]`/`0` win over
 * flats, `null` counts as absent (logo scale/offset keep their own
 * null-means-auto/zero contract below).
 */
export interface LandscapeServerDefaults {
  gradientHeight?: number
  blurEnabled?: boolean
  blurIntensity?: number
  blurFade?: number
  blurDarkness?: number
  tintStrength?: number
  topShade?: number
  /** Scala % logo film (null = auto-fit per aspect, come senza default). */
  logoScale?: number | null
  /** Offset px logo film (null = 0). */
  logoOffsetX?: number | null
  logoOffsetY?: number | null
  topBadgeScale?: number
  topBadgeOffsetX?: number
  topBadgeOffsetY?: number
  genreBadgeScale?: number
  genreBadgeOffsetX?: number
  genreBadgeOffsetY?: number
  qualityBadgeScale?: number
  qualityBadgeOffsetX?: number
  qualityBadgeOffsetY?: number
  /** Scala % della colonna rating separati (default 100 = resa storica). */
  separateBadgeScale?: number
  /** Offset px del gruppo rating separati (colonna/pills; bar portrait: solo Y). Default 0. */
  separateBadgeOffsetX?: number
  /** Offset px del gruppo rating separati (negativo = su, positivo = giù). Default 0. */
  separateBadgeOffsetY?: number
  /** Layout dei rating separati (default "column" = colonna destra storica). */
  separateRatingsStyle?: SeparateRatingsStyle
  networkLogoScale?: number
  networkLogoOffsetX?: number
  networkLogoOffsetY?: number
  /** Genre/rating badge style ("shadow" historic default). */
  badgeStyle?: BadgeStyle
  /** Rank badge style ("default" = auto-detect). */
  rankingBadgeStyle?: RankingBadgeStyle
  /** Standalone extra-badge style (absent = legacy `rs`). */
  extraBadgeStyle?: ExtraBadgeStyle | null
  /** Badge text font ("inter" historic default). */
  badgeFont?: BadgeFont | null
  /** Quality badge icon style (standard = text pill). */
  qualityBadgeStyle?: QualityBadgeStyle | null
  /** Enabled A/V formats (dv, hdr, hdr10plus, atmos, imax). */
  videoFormats?: VideoFormat[] | null
  globalBadges?: boolean
  rankingBadges?: boolean
  badgeGenre?: boolean
  badgeYear?: boolean
  badgeRating?: boolean
  badgeQuality?: boolean
  /** Minimum streaming quality tier (SD < HD < FHD < 4K). */
  minQuality?: StreamQuality
  /** Custom rating provider row (display). */
  customRatings?: boolean
  /** Separate ratings column (replaces the ★ average). */
  separateRatings?: boolean
  networkLogo?: boolean
  /** Network logo placement ("auto" = dynamic mirror, "top" = ribbon-side corner). */
  networkLogoPosition?: import("@/lib/types").NetworkLogoPosition
  /** Pre-digital effect (darken + Coming Soon badge, movies only). */
  preRelease?: boolean
  ribbonSide?: "left" | "right"
  /** Corner Netflix-style ribbon (false = centered rank badge). */
  ribbonEnabled?: boolean
  /** Enabled sash buckets (canonical order; empty = all off). */
  sashOrder?: SashBucket[]
}

/** Solo chiavi definite (undefined = segui il flat, mai clobberare). */
function pickDefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v
  }
  return out
}

/**
 * Default effettivi per il formato richiesto: in landscape i valori definiti
 * di `defaults.landscape` vincono sui flat. Ritorna lo stesso oggetto quando
 * non c'è overlay da applicare (shape portrait o nessun profilo).
 */
export function effectiveDefaultsForShape(defaults: ServerDefaults, shape: "poster" | "landscape"): ServerDefaults {
  if (shape !== "landscape" || !defaults.landscape) return defaults
  return { ...defaults, ...pickDefined(defaults.landscape) }
}

export interface ServerDefaults {
  badgeStyle?: BadgeStyle
  rankingBadgeStyle?: RankingBadgeStyle
  /** Standalone extra-badge style (flat-only): absent = legacy `rs` fallback. */
  extraBadgeStyle?: ExtraBadgeStyle | null
  /** Font dei testi badge ("inter" = resa storica). */
  badgeFont?: BadgeFont | null
  /** Stile icone del badge qualità (standard = pill testuale). */
  qualityBadgeStyle?: QualityBadgeStyle | null
  /** Formati A/V abilitati di default (dv, hdr, hdr10plus, atmos, imax). */
  videoFormats?: VideoFormat[] | null
  defaultVideoFormats?: VideoFormat[] | null
  blurEnabled?: boolean
  blurIntensity?: number
  blurFade?: number
  blurDarkness?: number
  /** Intensità tinta di scena 0-100 (default 20). */
  tintStrength?: number
  /** Ombra lineare superiore 0-100 (default 50). */
  topShade?: number
  gradientHeight?: number
  globalBadges?: boolean
  rankingBadges?: boolean
  badgeGenre?: boolean
  badgeYear?: boolean
  badgeRating?: boolean
  badgeQuality?: boolean
  /** Soglia minima tier qualità streaming (SD < HD < FHD < 4K): sotto soglia niente badge. Default SD. */
  minQuality?: StreamQuality
  /** Riga rating custom provider (display). Default ON quando il provider è configurato. */
  customRatings?: boolean
  /** Endpoint provider custom rating (UI). Non-segreto; la chiave resta solo env. */
  customRatingEndpoint?: string
  /** Header della chiave provider (UI). Default "X-API-Key". */
  customRatingApiKeyHeader?: string
  ratingSources?: string[]
  /** Colonna rating separati a destra (sostituisce la media ★). Default OFF. */
  separateRatings?: boolean
  /** Scala % della colonna rating separati (default 100 = resa storica). */
  separateBadgeScale?: number
  /** Offset px del gruppo rating separati (colonna/pills; bar portrait: solo Y). Default 0. */
  separateBadgeOffsetX?: number
  /** Offset px del gruppo rating separati (negativo = su, positivo = giù). Default 0. */
  separateBadgeOffsetY?: number
  /** Layout dei rating separati (default "column" = colonna destra storica). */
  separateRatingsStyle?: SeparateRatingsStyle
  /** Ordine/priorità sash (sottoinsieme ammesso: non listati = spenti). Default = ordine standard. */
  sashOrder?: SashBucket[]
  autoRotateClean?: boolean
  /** Rotazione giornaliera backdrop landscape (anche titoli non salvati). Default OFF. */
  defaultAutoRotateBackdrop?: boolean
  /** Esclude i poster clean TMDB dalla selezione automatica (catena lingua -> originale -> primo). Default OFF. */
  disableCleanPosters?: boolean
  defaultLogoFitEnabled?: boolean
  /** Fit logo per-shape (toggle UI Impostazioni): vince sul legacy qui sopra.
   *  Già accettati dallo schema PUT e persistiti — mancava solo il tipo. */
  defaultPortraitFitEnabled?: boolean
  defaultLandscapeFitEnabled?: boolean
  networkLogo?: boolean
  /** Posizione del logo network ("auto" = specchio dinamico, "top" = angolo alto lato nastro). */
  networkLogoPosition?: import("@/lib/types").NetworkLogoPosition
  /** Scala % logo film (null = auto-fit per aspect, comportamento storico). */
  logoScale?: number | null
  /** Offset px logo film (null = 0). */
  logoOffsetX?: number | null
  logoOffsetY?: number | null
  /** Scala % del badge superiore (rank/extra). Default 100. */
  topBadgeScale?: number
  /** Offset px del badge superiore (solo stili centrati). Default 0. */
  topBadgeOffsetX?: number
  topBadgeOffsetY?: number
  /** Scala % del badge genere/rating in basso. Default 100. */
  genreBadgeScale?: number
  /** Offset px del badge genere/rating (solo stili non-bar). Default 0. */
  genreBadgeOffsetX?: number
  genreBadgeOffsetY?: number
  /** Scala % del badge qualità (streaming). Default 100. */
  qualityBadgeScale?: number
  /** Offset px del badge qualità. Default 0. */
  qualityBadgeOffsetX?: number
  qualityBadgeOffsetY?: number
  /** Scala % del logo network. Default 100. */
  networkLogoScale?: number
  /** Offset px del logo network. Default 0. */
  networkLogoOffsetX?: number
  networkLogoOffsetY?: number
  /** Effetto pre-digitale (darken + badge Coming Soon, solo film). Default OFF. */
  preRelease?: boolean
  ribbonSide?: "left" | "right"
  /** Nastro stile Netflix all'angolo (false = badge classifica centrato). Default ON. */
  ribbonEnabled?: boolean
  /** Formato canvas globale: "landscape" = 16:9 da backdrop TMDB. Default portrait. */
  posterShape?: import("@/lib/types").PosterShape
  /** Allineamento blocco logo/metadati (default di formato se assente). */
  logoAlign?: "left" | "center"
  episodeMetadataSource?: "tmdb" | "tvdb"
  /** Regione classifiche JustWatch/FlixPatrol + lingua titoli (codice JW, es. "IT"). */
  region?: string
  /** Formato data badge "in uscita" (default `locale` = segue la lingua). */
  dateFormat?: DateFormat
  /**
   * Tuning di resa specifico per il canvas landscape 16:9 (default globali
   * orizzontali). I campi flat restano i default portrait E il fallback per
   * ogni chiave landscape assente/undefined. Istanze senza `landscape` si
   * comportano esattamente come prima (backward compatible).
   */
  landscape?: LandscapeServerDefaults | null
  customCatalogs?: import("@/lib/types").CustomCatalogConfig[]
  /**
   * Top 20 global ranking source (custom catalog id) per slot.
   * Absent/empty = JustWatch (retrocompatible default). The resolver
   * (`ranking-source.ts`) validates existence, `enabled !== false` and type
   * compatibility (movie/series/mixed); deleted or incompatible ids return
   * JustWatch without errors.
   */
  rankingSourceMovie?: string
  rankingSourceSeries?: string
  disabledCatalogIds?: string[]
  homeDisabledCatalogIds?: string[]
  catalogOrder?: string[]
  catalogRenames?: Record<string, string>
}

const FILE = path.join(DATA_DIR, "defaults.json")
// Lettura live (mai a module level): i test mutano le env + resetModules.
// Nome senza prefisso `use`: la regola react-hooks lo scambierebbe per un Hook.
function isKvMode(): boolean {
  return getStorageMode() === "kv"
}
const KV_KEY = "defaults"

// ── Default di stile da env d'istanza (PICTORIUM_*, con fallback alle legacy POSTERIUM_*) ─────────────────────────
// Per istanze personali (es. Vercel senza KV): fissano il default di resa
// (Genere/Anno/Voto, stile badge, blur, network logo, nastro...) anche quando
// defaults.json è vuoto/non persiste. Il file/KV salvato (dall'editor) vince
// SEMPRE su queste env: se l'utente salva i default, quelli contano. Env non
// impostate → nessun override ({} → comportamento attuale).
// Cruciale per i CATALOGHI: i poster dei cataloghi usano getServerDefaults() e
// non il config utente, quindi senza questi default d'istanza i badge escono
// tutti ON indipendentemente dalle preferenze salvate.
function getEnv(suffix: string): string | undefined {
  return envWithFallback(suffix)
}
function envBool(suffix: string): boolean | undefined {
  const raw = getEnv(suffix)?.trim().toLowerCase()
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return undefined
}
function envNum(suffix: string): number | undefined {
  const raw = getEnv(suffix)?.trim()
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : undefined
}
function defaultsFromEnv(): ServerDefaults {
  const d: ServerDefaults = {}
  const bG = envBool("GLOBAL_BADGES")
  const bR = envBool("RANKING_BADGES")
  const bg = envBool("BADGE_GENRE")
  const by = envBool("BADGE_YEAR")
  const br = envBool("BADGE_RATING")
  const bq = envBool("BADGE_QUALITY")
  const cr = envBool("CUSTOM_RATINGS")
  const blurEn = envBool("BLUR_ENABLED")
  const netLogo = envBool("NETWORK_LOGO")
  const ribbonEn = envBool("RIBBON_ENABLED")
  const preRel = envBool("PRE_RELEASE")
  const autoRotate = envBool("AUTO_ROTATE_CLEAN")
  const disableClean = envBool("DISABLE_CLEAN_POSTERS")
  const logoFit = envBool("LOGO_FIT_ENABLED")
  if (bG !== undefined) d.globalBadges = bG
  if (bR !== undefined) d.rankingBadges = bR
  if (bg !== undefined) d.badgeGenre = bg
  if (by !== undefined) d.badgeYear = by
  if (br !== undefined) d.badgeRating = br
  if (bq !== undefined) d.badgeQuality = bq
  if (cr !== undefined) d.customRatings = cr
  const rsrcEnv = getEnv("RATING_SOURCES")?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (rsrcEnv && rsrcEnv.length > 0) d.ratingSources = rsrcEnv
  const sepR = envBool("SEPARATE_RATINGS")
  if (sepR !== undefined) d.separateRatings = sepR
  // Ordine sash da env (stesso formato della query): token validi, dedup.
  // Vuoto/invalido → ignorato (default). Array salvato via UI non toccato qui.
  const sashEnv = getEnv("SASH_ORDER")?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (sashEnv && sashEnv.length > 0) {
    const valid = sashEnv.filter((s): s is SashBucket =>
      s === "upcoming" || s === "rank" || s === "new" || s === "award" || s === "extra")
    if (valid.length > 0) d.sashOrder = [...new Set(valid)]
  }
  // Soglia minima qualità (solo type-import da stream-quality: nessun ciclo
  // di dipendenze runtime). Valori non validi → ignorati (default SD).
  const qminRaw = getEnv("QUALITY_MIN")?.trim().toUpperCase()
  if (qminRaw === "SD" || qminRaw === "HD" || qminRaw === "FHD" || qminRaw === "4K") d.minQuality = qminRaw
  if (blurEn !== undefined) d.blurEnabled = blurEn
  if (netLogo !== undefined) d.networkLogo = netLogo
  if (ribbonEn !== undefined) d.ribbonEnabled = ribbonEn
  if (preRel !== undefined) d.preRelease = preRel
  if (autoRotate !== undefined) d.autoRotateClean = autoRotate
  if (disableClean !== undefined) d.disableCleanPosters = disableClean
  if (logoFit !== undefined) d.defaultLogoFitEnabled = logoFit
  const bs = getEnv("BADGE_STYLE")?.trim()
  const rbs = getEnv("RANKING_BADGE_STYLE")?.trim()
  const qbs = getEnv("QUALITY_BADGE_STYLE")?.trim()
  const bfEnv = getEnv("BADGE_FONT")?.trim().toLowerCase()
  const side = getEnv("RIBBON_SIDE")?.trim().toLowerCase()
  const shapeEnv = getEnv("POSTER_SHAPE")?.trim().toLowerCase()
  if (shapeEnv === "poster" || shapeEnv === "landscape") d.posterShape = shapeEnv
  const alignEnv = getEnv("LOGO_ALIGN")?.trim().toLowerCase()
  if (alignEnv === "left" || alignEnv === "center") d.logoAlign = alignEnv
  const blurI = envNum("BLUR_INTENSITY")
  const blurF = envNum("BLUR_FADE")
  const blurD = envNum("BLUR_DARKNESS")
  const tintS = envNum("TINT_STRENGTH")
  const topSh = envNum("TOP_SHADE")
  const gradH = envNum("GRADIENT_HEIGHT")
  const topBadgeScale = envNum("TOP_BADGE_SCALE")
  const topBadgeOX = envNum("TOP_BADGE_OFFSET_X")
  const topBadgeOY = envNum("TOP_BADGE_OFFSET_Y")
  const genreBadgeScale = envNum("GENRE_BADGE_SCALE")
  const genreBadgeOX = envNum("GENRE_BADGE_OFFSET_X")
  const genreBadgeOY = envNum("GENRE_BADGE_OFFSET_Y")
  const qualityBadgeScale = envNum("QUALITY_BADGE_SCALE")
  const qualityBadgeOX = envNum("QUALITY_BADGE_OFFSET_X")
  const qualityBadgeOY = envNum("QUALITY_BADGE_OFFSET_Y")
  const separateBadgeScale = envNum("SEPARATE_BADGE_SCALE")
  const networkLogoScale = envNum("NETWORK_LOGO_SCALE")
  const networkLogoOX = envNum("NETWORK_LOGO_OFFSET_X")
  const networkLogoOY = envNum("NETWORK_LOGO_OFFSET_Y")
  const epSrc = getEnv("EPISODE_METADATA_SOURCE")?.trim().toLowerCase()
  if (epSrc === "tmdb" || epSrc === "tvdb") d.episodeMetadataSource = epSrc
  // Endpoint provider custom rating (non-segreto; chiave solo env). Il valore
  // salvato via UI vince su questo in getServerDefaults (merge sotto).
  const ratingEndpoint = getEnv("CUSTOM_RATING_ENDPOINT")?.trim()
  if (ratingEndpoint) d.customRatingEndpoint = ratingEndpoint
  const ratingKeyHeader = getEnv("CUSTOM_RATING_API_KEY_HEADER")?.trim()
  if (ratingKeyHeader) d.customRatingApiKeyHeader = ratingKeyHeader
  // Regione classifiche: codice canonico, fail-closed su IT se non riconosciuta.
  const regionRaw = getEnv("REGION")?.trim()
  if (regionRaw) d.region = normalizeRegion(regionRaw)
  if (bs && isBadgeStyle(bs)) d.badgeStyle = bs
  if (rbs && isRankingBadgeStyle(rbs)) d.rankingBadgeStyle = rbs
  if (qbs && isQualityBadgeStyle(qbs)) d.qualityBadgeStyle = qbs
  if (bfEnv && isBadgeFont(bfEnv)) d.badgeFont = bfEnv
  if (side === "left" || side === "right") d.ribbonSide = side
  if (blurI !== undefined) d.blurIntensity = blurI
  if (blurF !== undefined) d.blurFade = blurF
  if (blurD !== undefined) d.blurDarkness = blurD
  if (tintS !== undefined) d.tintStrength = tintS
  if (topSh !== undefined) d.topShade = topSh
  if (gradH !== undefined) d.gradientHeight = gradH
  if (topBadgeScale !== undefined) d.topBadgeScale = topBadgeScale
  if (topBadgeOX !== undefined) d.topBadgeOffsetX = topBadgeOX
  if (topBadgeOY !== undefined) d.topBadgeOffsetY = topBadgeOY
  if (genreBadgeScale !== undefined) d.genreBadgeScale = genreBadgeScale
  if (genreBadgeOX !== undefined) d.genreBadgeOffsetX = genreBadgeOX
  if (genreBadgeOY !== undefined) d.genreBadgeOffsetY = genreBadgeOY
  if (qualityBadgeScale !== undefined) d.qualityBadgeScale = qualityBadgeScale
  if (qualityBadgeOX !== undefined) d.qualityBadgeOffsetX = qualityBadgeOX
  if (qualityBadgeOY !== undefined) d.qualityBadgeOffsetY = qualityBadgeOY
  if (separateBadgeScale !== undefined) d.separateBadgeScale = separateBadgeScale
  if (networkLogoScale !== undefined) d.networkLogoScale = networkLogoScale
  if (networkLogoOX !== undefined) d.networkLogoOffsetX = networkLogoOX
  if (networkLogoOY !== undefined) d.networkLogoOffsetY = networkLogoOY
  const vfEnv = getEnv("VIDEO_FORMATS")?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (vfEnv && vfEnv.length > 0) {
    const valid = vfEnv.filter(isVideoFormat)
    if (valid.length > 0) d.videoFormats = valid
  }
  return d
}
const ENV_DEFAULTS: ServerDefaults = defaultsFromEnv()

let cached: ServerDefaults | null = null
// Revisione epoch vista insieme a `cached`: se l'epoch globale è avanzata,
// i default in memoria sono stantii e vanno ricaricati (multi-istanza).
let cachedEpoch: string | null = null
let globalReload: Promise<ServerDefaults> | null = null
let warmPromise: Promise<void> | null = null
let writeQueue = Promise.resolve()

function logDefaultsError(action: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  log.warn(action, { error: message })
}

async function loadFromDisk(): Promise<ServerDefaults> {
  try {
    const raw = await fs.readFile(FILE, "utf-8")
    return JSON.parse(raw) as ServerDefaults
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist yet — fine
    } else {
      logDefaultsError("failed to load defaults", error)
    }
    return {}
  }
}

async function kvLoadDefaults(): Promise<ServerDefaults> {
  try {
    const raw = await getKv().get<ServerDefaults>(KV_KEY)
    return raw ?? {}
  } catch (error) {
    logDefaultsError("failed to load defaults (KV)", error)
    return {}
  }
}

/** Carica i defaults in cache (una sola volta per cold start). */
function warmDefaults(): Promise<void> {
  if (warmPromise) return warmPromise
  warmPromise = (async () => {
    const previous = cached
    const d = isKvMode() ? await kvLoadDefaults() : await loadFromDisk()
    // A checked reload or save may have completed while this cold read waited.
    if (cached === previous) cached = d
  })().catch(() => {})
  return warmPromise
}

export function getServerDefaults(): ServerDefaults {
  // Il risultato fonde gli ENV_DEFAULTS (default d'istanza, opt-in) con i
  // defaults salvati (file/KV): il salvato vince sull'env. Non mutiamo `cached`
  // così setServerDefaults scrive solo i valori dell'utente e l'env continua a
  // coprire solo i campi NON salvati.
  if (cached) return { ...ENV_DEFAULTS, ...cached }
  let loaded: ServerDefaults | null = null
  if (!isKvMode()) {
    try {
      if (existsSync(FILE)) {
        const raw = readFileSync(FILE, "utf-8")
        loaded = JSON.parse(raw) as ServerDefaults
      }
    } catch (error) {
      logDefaultsError("failed to load defaults (cold start)", error)
    }
  }
  cached = loaded ?? {}
  warmDefaults()
  return { ...ENV_DEFAULTS, ...cached }
}
/**
 * Defaults globali con controllo revisione (multi-istanza): prima di riusare
 * `cached` confronta l'epoch persistita; se avanzata, ricarica dal backend.
 * Doppia lettura epoch attorno al load: mai associare default vecchi a una
 * revisione nuova (bump durante il load → secondo load). Letture concorrenti
 * deduplicate; finestra residua = TTL lettura epoch (500ms, 0 nei test).
 */
export async function getServerDefaultsChecked(): Promise<ServerDefaults> {
  const e1 = await getCatalogEpoch(null)
  if (cached && cachedEpoch === e1) return { ...ENV_DEFAULTS, ...cached }
  if (globalReload) return globalReload
  globalReload = (async () => {
    const d = isKvMode() ? await kvLoadDefaults() : await loadFromDisk()
    const e2 = await getCatalogEpoch(null)
    if (e2 !== e1) {
      const d2 = isKvMode() ? await kvLoadDefaults() : await loadFromDisk()
      cached = d2
      cachedEpoch = e2
    } else {
      cached = d
      cachedEpoch = e1
    }
    return { ...ENV_DEFAULTS, ...cached }
  })().finally(() => {
    globalReload = null
  })
  return globalReload
}
export async function setServerDefaults(d: ServerDefaults): Promise<void> {
  if (isKvMode()) {
    try {
      await getKv().set(KV_KEY, d)
      cached = { ...d }
      cachedEpoch = await getCatalogEpoch(null).catch(() => cachedEpoch)
    } catch (error) {
      logDefaultsError("failed to write defaults (KV)", error)
      throw error
    }
    return
  }
  const existing = writeQueue
  writeQueue = (async () => {
    await existing
    try {
      await fs.mkdir(DATA_DIR, { recursive: true })
      await atomicWriteFile(FILE, JSON.stringify(d, null, 2))
      cached = { ...d }
      cachedEpoch = await getCatalogEpoch(null).catch(() => cachedEpoch)
    } catch (error) {
      logDefaultsError("failed to write defaults", error)
      throw error
    }
  })()
  await writeQueue
}

// ── Defaults per-utente (multi-user, slice 1) ─────────────────────────────
// `getServerDefaults()` sopra resta SINCRONA e invariata (hot path poster).
// Il namespace utente vive qui: LRU con cap + TTL, miss = fetch reale con
// attesa (mai fallback inventato). Isolamento stretto: i defaults salvati
// GLOBALI non entrano nell'effettivo utente (solo ENV_DEFAULTS + salvato
// utente) — altrimenti un cambio globale toccherebbe i poster altrui.

function userDefaultsFile(userId: string): string {
  return path.join(DATA_DIR, "users", userId, "defaults.json")
}

function userDefaultsKvKey(userId: string): string {
  return `defaults:${userId}`
}

function assertValidUserId(userId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id")
}

const USER_DEFAULTS_TTL_MS = 5 * 60 * 1000
const USER_DEFAULTS_CAP = 500

// La entry porta anche la revisione epoch vista al load: a revisione cambiata
// i default in memoria sono stantii anche dentro il TTL (altra istanza ha salvato).
const userDefaultsCache = new Map<string, { defaults: ServerDefaults; at: number; epoch: string }>()
const userDefaultsQueues = new Map<string, Promise<void>>()
const userDefaultsInflight = new Map<string, Promise<ServerDefaults>>()

function userDefaultsCachePeek(userId: string): { defaults: ServerDefaults; at: number; epoch: string } | null {
  const hit = userDefaultsCache.get(userId)
  if (!hit) return null
  if (Date.now() - hit.at >= USER_DEFAULTS_TTL_MS) {
    userDefaultsCache.delete(userId)
    return null
  }
  return hit
}

function userDefaultsCacheSet(userId: string, defaults: ServerDefaults, epoch: string = "0"): void {
  if (userDefaultsCache.size >= USER_DEFAULTS_CAP) {
    const oldest = userDefaultsCache.keys().next().value
    if (oldest !== undefined) userDefaultsCache.delete(oldest)
  }
  userDefaultsCache.set(userId, { defaults: { ...defaults }, at: Date.now(), epoch })
}

/**
 * Load dei default utente con controllo revisione (multi-istanza): a epoch
 * invariata riusa la memoria (TTL 5min, LRU 500), a epoch cambiata ricarica
 * dal backend. Doppia lettura epoch attorno al load (mai default vecchi con
 * revisione nuova); letture concorrenti deduplicate per namespace; isolamento
 * stretto tra utenti (epoch per-namespace).
 */
async function loadUserDefaultsChecked(userId: string): Promise<ServerDefaults> {
  const e1 = await getCatalogEpoch(userId)
  const hit = userDefaultsCachePeek(userId)
  if (hit && hit.epoch === e1) {
    // Promote LRU.
    userDefaultsCache.delete(userId)
    userDefaultsCache.set(userId, hit)
    return { ...hit.defaults }
  }
  const inflight = userDefaultsInflight.get(userId)
  if (inflight) return inflight
  const run = (async () => {
    const loaded = await loadUserDefaults(userId)
    const e2 = await getCatalogEpoch(userId)
    if (e2 !== e1) {
      const reloaded = await loadUserDefaults(userId)
      userDefaultsCacheSet(userId, reloaded, e2)
      return { ...reloaded }
    }
    userDefaultsCacheSet(userId, loaded, e1)
    return { ...loaded }
  })().finally(() => {
    userDefaultsInflight.delete(userId)
  })
  userDefaultsInflight.set(userId, run)
  return run
}

async function loadUserDefaults(userId: string): Promise<ServerDefaults> {
  if (isKvMode()) {
    try {
      const raw = await getKv().get<ServerDefaults>(userDefaultsKvKey(userId))
      return raw ?? {}
    } catch (error) {
      logDefaultsError("failed to load user defaults (KV)", error)
      return {}
    }
  }
  try {
    const raw = await fs.readFile(userDefaultsFile(userId), "utf-8")
    return JSON.parse(raw) as ServerDefaults
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")) {
      logDefaultsError("failed to load user defaults", error)
    }
    return {}
  }
}

/**
 * Defaults SALVATI del namespace, senza ENV d'istanza. Serve ai merge di PUT:
 * fondere sul merge effettivo (ENV + salvato) cuocerebbe i valori env nel file
 * utente, e un successivo cambio env dell'operatore non avrebbe più effetto
 * per quell'utente (shadowing implicito mai scelto). Lettura effettiva resta
 * getServerDefaultsForUser (ENV + questi).
 */
export async function getStoredUserDefaults(userId: string | null | undefined): Promise<ServerDefaults> {
  if (!userId) return {}
  assertValidUserId(userId)
  // Revisionata via epoch: il merge di PUT non deve fondere su uno storato
  // stantio scritto da un'altra istanza. La cache resta raw (mai ENV).
  return loadUserDefaultsChecked(userId)
}

/**
 * Defaults effettivi di un namespace: ENV d'istanza + salvato utente.
 * `userId` null = path globale (wrapper di getServerDefaults, per i caller).
 */
export async function getServerDefaultsForUser(userId: string | null | undefined): Promise<ServerDefaults> {
  if (!userId) return getServerDefaultsChecked()
  assertValidUserId(userId)
  const loaded = await loadUserDefaultsChecked(userId)
  return { ...ENV_DEFAULTS, ...loaded }
}

export async function setServerDefaultsForUser(userId: string, d: ServerDefaults): Promise<void> {
  assertValidUserId(userId)
  // Dopo la scrittura la route fa bump dell'epoch: si registra l'epoch
  // corrente così la prossima lettura revisionata rileva il bump e ricarica
  // (mai default nuovi associati alla revisione vecchia).
  if (isKvMode()) {
    try {
      await getKv().set(userDefaultsKvKey(userId), d)
      userDefaultsCacheSet(userId, d, await getCatalogEpoch(userId).catch(() => "0"))
    } catch (error) {
      logDefaultsError("failed to write user defaults (KV)", error)
      throw error
    }
    return
  }
  const existing = userDefaultsQueues.get(userId) ?? Promise.resolve()
  const run = existing.then(async () => {
    try {
      await fs.mkdir(path.dirname(userDefaultsFile(userId)), { recursive: true })
      await atomicWriteFile(userDefaultsFile(userId), JSON.stringify(d, null, 2))
      userDefaultsCacheSet(userId, d, await getCatalogEpoch(userId).catch(() => "0"))
    } catch (error) {
      logDefaultsError("failed to write user defaults", error)
      throw error
    }
  })
  userDefaultsQueues.set(userId, run.catch(() => {}))
  await run
}

/** Evict della cache defaults del namespace (wipe account). Solo test + user-activity. */
export function __evictUserDefaultsCache(userId: string): void {
  userDefaultsCache.delete(userId)
}
