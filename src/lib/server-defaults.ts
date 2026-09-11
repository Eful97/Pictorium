import fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import type { BadgeStyle, RankingBadgeStyle } from "@/lib/badge-styles"
import { isBadgeStyle, isRankingBadgeStyle } from "@/lib/badge-styles"
import { normalizeRegion } from "@/lib/regions"
import { envWithFallback } from "@/lib/env-compat"

const log = createLogger("server-defaults")

export interface ServerDefaults {
  badgeStyle?: BadgeStyle
  rankingBadgeStyle?: RankingBadgeStyle
  blurEnabled?: boolean
  blurIntensity?: number
  blurFade?: number
  blurDarkness?: number
  gradientHeight?: number
  globalBadges?: boolean
  rankingBadges?: boolean
  badgeGenre?: boolean
  badgeYear?: boolean
  badgeRating?: boolean
  badgeQuality?: boolean
  ratingSources?: string[]
  autoRotateClean?: boolean
  defaultLogoFitEnabled?: boolean
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
const useKv = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN
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
  const rsrcEnv = getEnv("RATING_SOURCES")?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (rsrcEnv && rsrcEnv.length > 0) d.ratingSources = rsrcEnv
  if (blurEn !== undefined) d.blurEnabled = blurEn
  if (netLogo !== undefined) d.networkLogo = netLogo
  if (preRel !== undefined) d.preRelease = preRel
  if (autoRotate !== undefined) d.autoRotateClean = autoRotate
  if (logoFit !== undefined) d.defaultLogoFitEnabled = logoFit
  const bs = getEnv("BADGE_STYLE")?.trim()
  const rbs = getEnv("RANKING_BADGE_STYLE")?.trim()
  const side = getEnv("RIBBON_SIDE")?.trim().toLowerCase()
  const blurI = envNum("BLUR_INTENSITY")
  const blurF = envNum("BLUR_FADE")
  const blurD = envNum("BLUR_DARKNESS")
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
  // Regione classifiche: codice canonico, fail-closed su IT se non riconosciuta.
  const regionRaw = getEnv("REGION")?.trim()
  if (regionRaw) d.region = normalizeRegion(regionRaw)
  if (bs && isBadgeStyle(bs)) d.badgeStyle = bs
  if (rbs && isRankingBadgeStyle(rbs)) d.rankingBadgeStyle = rbs
  if (side === "left" || side === "right") d.ribbonSide = side
  if (blurI !== undefined) d.blurIntensity = blurI
  if (blurF !== undefined) d.blurFade = blurF
  if (blurD !== undefined) d.blurDarkness = blurD
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
    const { kv } = await import("@vercel/kv")
    const raw = await kv.get<ServerDefaults>(KV_KEY)
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
    const d = useKv ? await kvLoadDefaults() : await loadFromDisk()
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
  if (!useKv) {
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
  if (useKv) {
    try {
      const { kv } = await import("@vercel/kv")
      await kv.set(KV_KEY, d)
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
      await fs.writeFile(FILE, JSON.stringify(d, null, 2))
      cached = { ...d }
    } catch (error) {
      logDefaultsError("failed to write defaults", error)
      throw error
    }
  })()
  await writeQueue
}
