import { NextRequest } from "next/server"
import { getServerDefaults, setServerDefaults, getServerDefaultsForUser, getStoredUserDefaults, setServerDefaultsForUser, type ServerDefaults } from "@/lib/server-defaults"
import { cacheInvalidatePosterData } from "@/lib/cache"
import { bumpCatalogEpoch } from "@/lib/catalog-epoch"
import { checkAdminToken, requireAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { checkUserAuth, getScopedUserId, extractUserParam, invalidUserResponse, isMultiUserEnabled, userAuthResponse, userRateLimitKey } from "@/lib/user-auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { getWarmupCatalogs } from "@/lib/catalog-definitions"
import { createLogger } from "@/lib/logger"
import { z } from "zod"
import { BADGE_STYLES, RANKING_BADGE_STYLES, QUALITY_BADGE_STYLES } from "@/lib/badge-styles"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"
import { envWithFallback } from "@/lib/env-compat"

const log = createLogger("defaults")

const customCatalogSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(100),
  type: z.enum(["movie", "series", "mixed"]),
  url: z.string().max(500),
  enabled: z.boolean().optional(),
  datasetId: z.string().max(64).optional(),
})

const defaultsSchema = z.object({
  badgeStyle: z.enum(BADGE_STYLES).optional(),
  rankingBadgeStyle: z.enum(RANKING_BADGE_STYLES).optional(),
  qualityBadgeStyle: z.enum(QUALITY_BADGE_STYLES).nullable().optional(),
  videoFormats: z.array(z.enum(["dv", "hdr", "hdr10plus", "atmos", "imax"])).nullable().optional(),
  defaultVideoFormats: z.array(z.enum(["dv", "hdr", "hdr10plus", "atmos", "imax"])).nullable().optional(),
  blurEnabled: z.boolean().optional(),
  blurIntensity: z.number().optional(),
  blurFade: z.number().optional(),
  blurDarkness: z.number().optional(),
  tintStrength: z.number().optional(),
  topShade: z.number().optional(),
  gradientHeight: z.number().optional(),
  topBadgeScale: z.number().optional(),
  topBadgeOffsetX: z.number().optional(),
  topBadgeOffsetY: z.number().optional(),
  genreBadgeScale: z.number().optional(),
  qualityBadgeScale: z.number().optional(),
  networkLogoScale: z.number().optional(),
  genreBadgeOffsetX: z.number().optional(),
  genreBadgeOffsetY: z.number().optional(),
  qualityBadgeOffsetX: z.number().optional(),
  qualityBadgeOffsetY: z.number().optional(),
  networkLogoOffsetX: z.number().optional(),
  networkLogoOffsetY: z.number().optional(),
  globalBadges: z.boolean().optional(),
  rankingBadges: z.boolean().optional(),
  badgeGenre: z.boolean().optional(),
  badgeYear: z.boolean().optional(),
  badgeRating: z.boolean().optional(),
  badgeQuality: z.boolean().optional(),
  customRatings: z.boolean().optional(),
  // Endpoint provider custom rating (non-segreto; la chiave resta solo env).
  // Stessi vincoli del fetch: placeholder {imdbId}, http/https, no credenziali.
  customRatingEndpoint: z.string().max(500).optional().refine((v) => {
    if (!v) return true
    if (!v.includes("{imdbId}")) return false
    try {
      const url = new URL(v)
      return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
    } catch {
      return false
    }
  }, { message: "customRatingEndpoint must be an http(s) URL containing {imdbId} without credentials" }),
  customRatingApiKeyHeader: z.string().max(64).optional(),
  ratingSources: z.array(z.string()).optional(),
  separateRatings: z.boolean().optional(),
  sashOrder: z.array(z.string().max(20)).optional(),
  autoRotateClean: z.boolean().optional(),
  defaultAutoRotateBackdrop: z.boolean().optional(),
  disableCleanPosters: z.boolean().optional(),
  defaultLogoFitEnabled: z.boolean().optional(),
  defaultPortraitFitEnabled: z.boolean().optional(),
  defaultLandscapeFitEnabled: z.boolean().optional(),
  networkLogo: z.boolean().optional(),
  networkLogoPosition: z.enum(["auto", "top"]).optional(),
  // Default logo film (null = auto-fit/0, mai spazzatura dallo storage).
  logoScale: z.number().nullable().optional(),
  logoOffsetX: z.number().nullable().optional(),
  logoOffsetY: z.number().nullable().optional(),
  preRelease: z.boolean().optional(),
  ribbonSide: z.enum(["left", "right"]).optional(),
  ribbonEnabled: z.boolean().optional(),
  posterShape: z.enum(["poster", "landscape"]).optional(),
  logoAlign: z.enum(["left", "center"]).nullable().optional(),
  episodeMetadataSource: z.enum(["tmdb", "tvdb"]).optional(),
  region: z.string().max(32).optional(),
  dateFormat: z.enum(["locale", "dmy", "mdy", "iso"]).optional(),
  // Profilo default landscape (sfumatura/blur + scale/offset badge, come
  // LandscapeServerDefaults): chiavi assenti seguono i flat. Validazione
  // speculare ai flat.
  landscape: z.object({
    gradientHeight: z.number().optional(),
    blurEnabled: z.boolean().optional(),
    blurIntensity: z.number().optional(),
    blurFade: z.number().optional(),
    blurDarkness: z.number().optional(),
    tintStrength: z.number().optional(),
    topShade: z.number().optional(),
    logoScale: z.number().nullable().optional(),
    logoOffsetX: z.number().nullable().optional(),
    logoOffsetY: z.number().nullable().optional(),
    topBadgeScale: z.number().optional(),
    topBadgeOffsetX: z.number().optional(),
    topBadgeOffsetY: z.number().optional(),
    genreBadgeScale: z.number().optional(),
    genreBadgeOffsetX: z.number().optional(),
    genreBadgeOffsetY: z.number().optional(),
    qualityBadgeScale: z.number().optional(),
    qualityBadgeOffsetX: z.number().optional(),
    qualityBadgeOffsetY: z.number().optional(),
    networkLogoScale: z.number().optional(),
    networkLogoOffsetX: z.number().optional(),
    networkLogoOffsetY: z.number().optional(),
  }).optional(),
  customCatalogs: z.array(customCatalogSchema).optional(),
  disabledCatalogIds: z.array(z.string().max(80)).optional(),
  homeDisabledCatalogIds: z.array(z.string().max(80)).optional(),
  catalogOrder: z.array(z.string().max(80)).optional(),
  catalogRenames: z.record(z.string().max(80), z.string().max(100)).optional(),
})

export async function GET(req: NextRequest) {
  const rawUser = extractUserParam(req)
  const rawInvalid = !!rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)
  const scoped = getScopedUserId(rawUser)
  // Rate-limit come il PUT (prima era senza: oracolo password + scrypt senza
  // alcun freno oltre al fail limiter centrale).
  const rl = await rateLimit(rawInvalid ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "defaults")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (rawInvalid) return invalidUserResponse()
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
    // Namespace: effettivo utente, mai serverKeys (slice 2 per le chiavi).
    const d = await getServerDefaultsForUser(scoped)
    return Response.json({ ...d })
  }
  const d = getServerDefaults()
  // Flag pubblici (solo booleani): dicono al client se l'istanza ha chiavi
  // env, così la welcome screen appare solo quando non c'è chiave da nessuna
  // parte (né browser né server). I VALORI restano dietro requireAdminToken
  // qui sotto — un booleano non espone alcun segreto (l'health endpoint
  // rivela già lo stesso segnale via status degraded/healthy).
  const hasInstanceKeys = {
    tmdbKey: !!(envWithFallback("TMDB_KEY") || process.env.TMDB_API_KEY),
    mdblistKey: !!(envWithFallback("MDBLIST_KEY") || process.env.MDBLIST_API_KEY),
    tvdbKey: !!(envWithFallback("TVDB_API_KEY") || process.env.TVDB_API_KEY),
  }
  // Le chiavi d'istanza non devono mai trapelare su istanze pubbliche:
  // checkAdminToken è true per chiunque con PICTORIUM_PUBLIC_INSTANCE=1,
  // quindi qui serve requireAdminToken (solo ADMIN_TOKEN o sessione PIN valida).
  if (requireAdminToken(req)) {
    const serverKeys = {
      tmdbKey: envWithFallback("TMDB_KEY") || process.env.TMDB_API_KEY || "",
      mdblistApiKey: envWithFallback("MDBLIST_KEY") || process.env.MDBLIST_API_KEY || "",
      tvdbApiKey: envWithFallback("TVDB_API_KEY") || process.env.TVDB_API_KEY || "",
    }
    return Response.json({ ...d, hasInstanceKeys, serverKeys })
  }
  return Response.json({ ...d, hasInstanceKeys })
}

export async function PUT(req: NextRequest) {
  const rawUser = extractUserParam(req)
  const rawInvalid = !!rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)
  const scoped = getScopedUserId(rawUser)
  const rl = await rateLimit(rawInvalid ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "defaults")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (rawInvalid) return invalidUserResponse()
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
    if (!isSameOrigin(req)) return originMismatchResponse()
  } else {
    if (!checkAdminToken(req)) return adminAuthResponse()
    if (!isSameOrigin(req)) return originMismatchResponse()
  }
  let body: unknown
  try {
    body = await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = defaultsSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 })
  }
  if (parsed.data.videoFormats === undefined && parsed.data.defaultVideoFormats !== undefined) {
    parsed.data.videoFormats = parsed.data.defaultVideoFormats
  }
  try {
    if (scoped) {
      // Merge sullo STORATO (mai sull'effettivo ENV+storato): l'env resta
      // dinamica, nel file finiscono solo scelte dell'utente.
      const stored = await getStoredUserDefaults(scoped)
      const next: Record<string, unknown> = { ...stored, ...parsed.data }
      await setServerDefaultsForUser(scoped, next as ServerDefaults)
      // Il cambio defaults ruota le chiavi catalogo/meta del namespace via
      // epoch utente — niente wipe globale (il save di A non tocca B).
      await bumpCatalogEpoch(scoped)
      return Response.json({ ok: true })
    }
    const current = getServerDefaults()
    // Merge invece di replace: un payload parziale NON deve azzerare i default
    // già salvati (altrimenti salvare un solo campo cancellerebbe gli altri).
    const next: Record<string, unknown> = { ...current, ...parsed.data }
    // Await: la 200 arriva solo a persistenza completata (altrimenti una GET
    // successiva può leggere ancora i vecchi default).
    await setServerDefaults(next as ServerDefaults)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: `Failed to save: ${message}` }, { status: 500 })
  }
  cacheInvalidatePosterData()
  // Bump epoch cataloghi (F3): il cambio default globali impatta tutti i
  // poster URL (con lo sd-hash nel key come seconda rete di sicurezza).
  await bumpCatalogEpoch()
  // Warm catalog cache — ricostruisci cataloghi principali in background.
  // Usa un origin interno fisso (127.0.0.1) invece dell'origin derivato dall'
  // header Host della richiesta: quest'ultimo è controllabile dal client
  // (host header injection → SSRF). Su Vercel (serverless) il self-fetch non
  // esiste: lo saltiamo per evitare warning ingannevoli.
  if (!process.env.VERCEL) {
    const internalOrigin = `http://127.0.0.1:${process.env.PORT || "3000"}`
    for (const catalog of getWarmupCatalogs()) {
      const catalogUrl = `${internalOrigin}/catalog/${catalog.type}/${catalog.id}.json`
      void fetch(catalogUrl, { signal: AbortSignal.timeout(15000) }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        log.warn(`Catalog warmup failed for ${catalog.id}`, { error: message })
      })
    }
  }
  return Response.json({ ok: true })
}
