import fs from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { DATA_DIR } from "@/lib/data-dir"
import { createLogger } from "@/lib/logger"
import type { BadgeStyle, RankingBadgeStyle } from "@/lib/badge-styles"
import { isBadgeStyle, isRankingBadgeStyle } from "@/lib/badge-styles"
import { normalizeRegion } from "@/lib/regions"

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

// ── Default di stile da env d'istanza (POSTERIUM_*) ─────────────────────────
// Per istanze personali (es. Vercel senza KV): fissano il default di resa
// (Genere/Anno/Voto, stile badge, blur, network logo, nastro...) anche quando
// defaults.json è vuoto/non persiste. Il file/KV salvato (dall'editor) vince
// SEMPRE su queste env: se l'utente salva i default, quelli contano. Env non
// impostate → nessun override ({} → comportamento attuale).
// Cruciale per i CATALOGHI: i poster dei cataloghi usano getServerDefaults() e
// non il config utente, quindi senza questi default d'istanza i badge escono
// tutti ON indipendentemente dalle preferenze salvate.
function envBool(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase()
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false
  return undefined
}
function envNum(name: string): number | undefined {
  const raw = process.env[name]?.trim()
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : undefined
}
function defaultsFromEnv(): ServerDefaults {
  const d: ServerDefaults = {}
  const bG = envBool("POSTERIUM_GLOBAL_BADGES")
  const bR = envBool("POSTERIUM_RANKING_BADGES")
  const bg = envBool("POSTERIUM_BADGE_GENRE")
  const by = envBool("POSTERIUM_BADGE_YEAR")
  const br = envBool("POSTERIUM_BADGE_RATING")
  const bq = envBool("POSTERIUM_BADGE_QUALITY")
  const blurEn = envBool("POSTERIUM_BLUR_ENABLED")
  const netLogo = envBool("POSTERIUM_NETWORK_LOGO")
  const autoRotate = envBool("POSTERIUM_AUTO_ROTATE_CLEAN")
  const logoFit = envBool("POSTERIUM_LOGO_FIT_ENABLED")
  if (bG !== undefined) d.globalBadges = bG
  if (bR !== undefined) d.rankingBadges = bR
  if (bg !== undefined) d.badgeGenre = bg
  if (by !== undefined) d.badgeYear = by
  if (br !== undefined) d.badgeRating = br
  if (bq !== undefined) d.badgeQuality = bq
  const rsrcEnv = process.env.POSTERIUM_RATING_SOURCES?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (rsrcEnv && rsrcEnv.length > 0) d.ratingSources = rsrcEnv
  if (blurEn !== undefined) d.blurEnabled = blurEn
  if (netLogo !== undefined) d.networkLogo = netLogo
  if (autoRotate !== undefined) d.autoRotateClean = autoRotate
  if (logoFit !== undefined) d.defaultLogoFitEnabled = logoFit
  const bs = process.env.POSTERIUM_BADGE_STYLE?.trim()
  const rbs = process.env.POSTERIUM_RANKING_BADGE_STYLE?.trim()
  const side = process.env.POSTERIUM_RIBBON_SIDE?.trim().toLowerCase()
  const blurI = envNum("POSTERIUM_BLUR_INTENSITY")
  const blurF = envNum("POSTERIUM_BLUR_FADE")
  const blurD = envNum("POSTERIUM_BLUR_DARKNESS")
  const gradH = envNum("POSTERIUM_GRADIENT_HEIGHT")
  const epSrc = process.env.POSTERIUM_EPISODE_METADATA_SOURCE?.trim().toLowerCase()
  if (epSrc === "tmdb" || epSrc === "tvdb") d.episodeMetadataSource = epSrc
  // Regione classifiche: codice canonico, fail-closed su IT se non riconosciuta.
  if (process.env.POSTERIUM_REGION?.trim()) d.region = normalizeRegion(process.env.POSTERIUM_REGION)
  if (bs && isBadgeStyle(bs)) d.badgeStyle = bs
  if (rbs && isRankingBadgeStyle(rbs)) d.rankingBadgeStyle = rbs
  if (side === "left" || side === "right") d.ribbonSide = side
  if (blurI !== undefined) d.blurIntensity = blurI
  if (blurF !== undefined) d.blurFade = blurF
  if (blurD !== undefined) d.blurDarkness = blurD
  if (gradH !== undefined) d.gradientHeight = gradH
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
