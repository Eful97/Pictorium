import fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import type { BadgeStyle, RankingBadgeStyle } from "@/lib/badge-styles"
import type { StreamQuality } from "@/lib/quality-tiers"
import type { SashBucket } from "@/lib/badge-priority"
import { isBadgeStyle, isRankingBadgeStyle } from "@/lib/badge-styles"
import { normalizeRegion } from "@/lib/regions"
import { envWithFallback } from "@/lib/env-compat"
import { atomicWriteFile } from "@/lib/atomic-write"
import { getKv, getStorageMode } from "@/lib/kv"

const log = createLogger("server-defaults")

export interface ServerDefaults {
  badgeStyle?: BadgeStyle
  rankingBadgeStyle?: RankingBadgeStyle
  blurEnabled?: boolean
  blurIntensity?: number
  blurFade?: number
  blurDarkness?: number
  /** Intensità tinta di scena 0-100 (default 20). */
  tintStrength?: number
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
  /** Ordine/priorità sash (sottoinsieme ammesso: non listati = spenti). Default = ordine standard. */
  sashOrder?: SashBucket[]
  autoRotateClean?: boolean
  defaultLogoFitEnabled?: boolean
  /** Fit logo per-shape (toggle UI Impostazioni): vince sul legacy qui sopra.
   *  Già accettati dallo schema PUT e persistiti — mancava solo il tipo. */
  defaultPortraitFitEnabled?: boolean
  defaultLandscapeFitEnabled?: boolean
  networkLogo?: boolean
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
  /** Formato canvas globale: "landscape" = 16:9 da backdrop TMDB. Default portrait. */
  posterShape?: import("@/lib/types").PosterShape
  /** Allineamento blocco logo/metadati (default di formato se assente). */
  logoAlign?: "left" | "center"
  episodeMetadataSource?: "tmdb" | "tvdb"
  /** Regione classifiche JustWatch/FlixPatrol + lingua titoli (codice JW, es. "IT"). */
  region?: string
  customCatalogs?: import("@/lib/types").CustomCatalogConfig[]
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
  const preRel = envBool("PRE_RELEASE")
  const autoRotate = envBool("AUTO_ROTATE_CLEAN")
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
  if (preRel !== undefined) d.preRelease = preRel
  if (autoRotate !== undefined) d.autoRotateClean = autoRotate
  if (logoFit !== undefined) d.defaultLogoFitEnabled = logoFit
  const bs = getEnv("BADGE_STYLE")?.trim()
  const rbs = getEnv("RANKING_BADGE_STYLE")?.trim()
  const side = getEnv("RIBBON_SIDE")?.trim().toLowerCase()
  const shapeEnv = getEnv("POSTER_SHAPE")?.trim().toLowerCase()
  if (shapeEnv === "poster" || shapeEnv === "landscape") d.posterShape = shapeEnv
  const alignEnv = getEnv("LOGO_ALIGN")?.trim().toLowerCase()
  if (alignEnv === "left" || alignEnv === "center") d.logoAlign = alignEnv
  const blurI = envNum("BLUR_INTENSITY")
  const blurF = envNum("BLUR_FADE")
  const blurD = envNum("BLUR_DARKNESS")
  const tintS = envNum("TINT_STRENGTH")
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
  if (side === "left" || side === "right") d.ribbonSide = side
  if (blurI !== undefined) d.blurIntensity = blurI
  if (blurF !== undefined) d.blurFade = blurF
  if (blurD !== undefined) d.blurDarkness = blurD
  if (tintS !== undefined) d.tintStrength = tintS
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
  if (networkLogoScale !== undefined) d.networkLogoScale = networkLogoScale
  if (networkLogoOX !== undefined) d.networkLogoOffsetX = networkLogoOX
  if (networkLogoOY !== undefined) d.networkLogoOffsetY = networkLogoOY
  return d
}
const ENV_DEFAULTS: ServerDefaults = defaultsFromEnv()

let cached: ServerDefaults | null = null
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
    const d = isKvMode() ? await kvLoadDefaults() : await loadFromDisk()
    cached = d
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
export async function setServerDefaults(d: ServerDefaults): Promise<void> {
  if (isKvMode()) {
    try {
      await getKv().set(KV_KEY, d)
      cached = { ...d }
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

const userDefaultsCache = new Map<string, { defaults: ServerDefaults; at: number }>()
const userDefaultsQueues = new Map<string, Promise<void>>()

function userDefaultsCacheGet(userId: string): ServerDefaults | null {
  const hit = userDefaultsCache.get(userId)
  if (!hit) return null
  if (Date.now() - hit.at >= USER_DEFAULTS_TTL_MS) {
    userDefaultsCache.delete(userId)
    return null
  }
  // Promote LRU.
  userDefaultsCache.delete(userId)
  userDefaultsCache.set(userId, hit)
  return hit.defaults
}

function userDefaultsCacheSet(userId: string, defaults: ServerDefaults): void {
  if (userDefaultsCache.size >= USER_DEFAULTS_CAP) {
    const oldest = userDefaultsCache.keys().next().value
    if (oldest !== undefined) userDefaultsCache.delete(oldest)
  }
  userDefaultsCache.set(userId, { defaults: { ...defaults }, at: Date.now() })
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
  const hit = userDefaultsCacheGet(userId)
  // La cache contiene il raw caricato (mai ENV): copia difensiva.
  if (hit) return { ...hit }
  return loadUserDefaults(userId)
}

/**
 * Defaults effettivi di un namespace: ENV d'istanza + salvato utente.
 * `userId` null = path globale (wrapper di getServerDefaults, per i caller).
 */
export async function getServerDefaultsForUser(userId: string | null | undefined): Promise<ServerDefaults> {
  if (!userId) return getServerDefaults()
  assertValidUserId(userId)
  const hit = userDefaultsCacheGet(userId)
  if (hit) return { ...ENV_DEFAULTS, ...hit }
  const loaded = await loadUserDefaults(userId)
  userDefaultsCacheSet(userId, loaded)
  return { ...ENV_DEFAULTS, ...loaded }
}

export async function setServerDefaultsForUser(userId: string, d: ServerDefaults): Promise<void> {
  assertValidUserId(userId)
  if (isKvMode()) {
    try {
      await getKv().set(userDefaultsKvKey(userId), d)
      userDefaultsCacheSet(userId, d)
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
      userDefaultsCacheSet(userId, d)
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
