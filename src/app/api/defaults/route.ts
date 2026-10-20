import { NextRequest } from "next/server"
import { getServerDefaultsChecked, setServerDefaults, getServerDefaultsForUser, getStoredUserDefaults, setServerDefaultsForUser, getInstanceEnvDefaults, type ServerDefaults } from "@/lib/server-defaults"
import { cacheInvalidatePosterData } from "@/lib/cache"
import { bumpCatalogEpoch } from "@/lib/catalog-epoch"
import { checkAdminToken, requireAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { checkUserAuth, getScopedUserId, extractUserParam, invalidUserResponse, isMultiUserEnabled, userAuthResponse, userRateLimitKey } from "@/lib/user-auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { getWarmupCatalogs } from "@/lib/catalog-definitions"
import { createLogger } from "@/lib/logger"
import { z } from "zod"
import { BADGE_STYLES, RANKING_BADGE_STYLES, QUALITY_BADGE_STYLES, AGE_BADGE_STYLES, BADGE_FONTS, SEPARATE_RATINGS_STYLES, EXTRA_BADGE_STYLES, EXTRA_BADGE_FOLLOW_RANK } from "@/lib/badge-styles"
import { POSTER_LAYOUTS, POSTER_FRESH_SCOPES } from "@/lib/types"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"
import { envWithFallback } from "@/lib/env-compat"
import { SHAPE_FLAT_TO_LANDSCAPE, snapshotMissingLandscape } from "@/lib/visual-presets"
import { badgeFamilyBindingsSchema } from "@/lib/badge-preset"

const log = createLogger("defaults")

const addonExtraSchema = z.object({
  name: z.string().max(40),
  isRequired: z.boolean().optional(),
  options: z.array(z.string().max(40)).max(100).optional(),
  optionsLimit: z.number().finite().optional(),
})

const addonSourceSchema = z.object({
  manifestUrl: z.string().max(500),
  catalogId: z.string().max(100),
  catalogType: z.enum(["movie", "series"]),
  extra: z.array(addonExtraSchema).max(20).optional(),
  addonId: z.string().max(100).optional(),
  addonName: z.string().max(100).optional(),
})

const customCatalogSchema = z.object({
  id: z.string().max(64),
  name: z.string().max(100),
  type: z.enum(["movie", "series", "mixed"]),
  url: z.string().max(500),
  enabled: z.boolean().optional(),
  datasetId: z.string().max(64).optional(),
  addon: addonSourceSchema.optional(),
})

const defaultsSchema = z.object({
  badgeStyle: z.enum(BADGE_STYLES).optional(),
  /**
   * BadgeLab family map (flat global defaults): sparse per family, absent =
   * native, present `null` = explicit standard clear. The profile `landscape`
   * below merges key-by-key over it. Fail-closed schema: unknown families,
   * malformed ids/revisions and prototype keys reject the whole PUT.
   */
  badgePresets: badgeFamilyBindingsSchema,
  rankingBadgeStyle: z.enum(RANKING_BADGE_STYLES).optional(),
  /** Standalone extra-badge style (flat-only): absent/null = legacy `rs` fallback; "follow-rank" = explicit own-rank. */
  extraBadgeStyle: z.union([z.enum(EXTRA_BADGE_STYLES), z.literal(EXTRA_BADGE_FOLLOW_RANK)]).nullable().optional(),
  badgeFont: z.enum(BADGE_FONTS).optional(),
  qualityBadgeStyle: z.enum(QUALITY_BADGE_STYLES).nullable().optional(),
  videoFormats: z.array(z.enum(["dv", "hdr", "hdr10plus", "atmos", "imax"])).nullable().optional(),
  defaultVideoFormats: z.array(z.enum(["dv", "hdr", "hdr10plus", "atmos", "imax"])).nullable().optional(),
  blurEnabled: z.boolean().optional(),
  blurIntensity: z.number().optional(),
  blurFade: z.number().optional(),
  blurDarkness: z.number().optional(),
  tintStrength: z.number().optional(),
  topShade: z.number().optional(),
  topShadeHeight: z.number().optional(),
  gradientHeight: z.number().optional(),
  topBadgeScale: z.number().optional(),
  topBadgeOffsetX: z.number().optional(),
  topBadgeOffsetY: z.number().optional(),
  /** Tuning EXTRA superiore (null/assente = fallback legacy classifica). */
  extraBadgeScale: z.number().nullable().optional(),
  extraBadgeOffsetX: z.number().nullable().optional(),
  extraBadgeOffsetY: z.number().nullable().optional(),
  genreBadgeScale: z.number().optional(),
  qualityBadgeScale: z.number().optional(),
  separateBadgeScale: z.number().optional(),
  separateBadgeOffsetX: z.number().optional(),
  separateBadgeOffsetY: z.number().optional(),
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
  /** Badge età testuale (default OFF). Flat portrait (il profilo
   *  `landscape` sotto può divergere per forma). */
  ageBadge: z.boolean().optional(),
  /** Paese classificazione età (default "IT"): validazione lasca, la
   *  normalizzazione fail-closed avviene in risoluzione (poster-config). */
  ageCountry: z.string().max(8).optional(),
  /** Stile pill età (default "standard" = resa storica). Flat portrait come
   *  il toggle età (profilo `landscape` sotto per la forma orizzontale). */
  ageBadgeStyle: z.enum(AGE_BADGE_STYLES).nullable().optional(),
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
  separateRatingsStyle: z.enum(SEPARATE_RATINGS_STYLES).optional(),
  sashOrder: z.array(z.string().max(20)).optional(),
  autoRotateClean: z.boolean().optional(),
  defaultAutoRotateBackdrop: z.boolean().optional(),
  disableCleanPosters: z.boolean().optional(),
  defaultLogoFitEnabled: z.boolean().optional(),
  defaultPortraitFitEnabled: z.boolean().optional(),
  defaultLandscapeFitEnabled: z.boolean().optional(),
  networkLogo: z.boolean().optional(),
  networkLogoPosition: z.enum(["auto", "top"]).optional(),
  networkLogoFollowTitle: z.boolean().nullable().optional(),
  // Default logo film (null = auto-fit/0, mai spazzatura dallo storage).
  logoScale: z.number().nullable().optional(),
  logoOffsetX: z.number().nullable().optional(),
  logoOffsetY: z.number().nullable().optional(),
  preRelease: z.boolean().optional(),
  ribbonSide: z.enum(["left", "right"]).optional(),
  ribbonEnabled: z.boolean().optional(),
  posterShape: z.enum(["poster", "landscape"]).optional(),
  /** Graphical poster layout (flat): absent = standard historic render. */
  posterLayout: z.enum(POSTER_LAYOUTS).optional(),
  /** Fresh apply scope (flat): absent = all historic render. */
  posterFreshScope: z.enum(POSTER_FRESH_SCOPES).optional(),
  logoAlign: z.enum(["left", "center"]).nullable().optional(),
  episodeMetadataSource: z.enum(["tmdb", "tvdb"]).optional(),
  region: z.string().max(32).optional(),
  dateFormat: z.enum(["locale", "dmy", "mdy", "iso"]).optional(),
  // Landscape defaults profile (shared visuals that may diverge per shape +
  // blur/gradient + badge scales/offsets, mirroring LandscapeServerDefaults):
  // absent keys follow flats. Mirrors flat validation; explicit
  // `false`/`[]`/`0` are real values.
  landscape: z.object({
    gradientHeight: z.number().optional(),
    blurEnabled: z.boolean().optional(),
    blurIntensity: z.number().optional(),
    blurFade: z.number().optional(),
    blurDarkness: z.number().optional(),
    tintStrength: z.number().optional(),
    topShade: z.number().optional(),
    topShadeHeight: z.number().optional(),
    logoScale: z.number().nullable().optional(),
    logoOffsetX: z.number().nullable().optional(),
    logoOffsetY: z.number().nullable().optional(),
    topBadgeScale: z.number().optional(),
    topBadgeOffsetX: z.number().optional(),
    topBadgeOffsetY: z.number().optional(),
    extraBadgeScale: z.number().nullable().optional(),
    extraBadgeOffsetX: z.number().nullable().optional(),
    extraBadgeOffsetY: z.number().nullable().optional(),
    genreBadgeScale: z.number().optional(),
    genreBadgeOffsetX: z.number().optional(),
    genreBadgeOffsetY: z.number().optional(),
    qualityBadgeScale: z.number().optional(),
    qualityBadgeOffsetX: z.number().optional(),
    qualityBadgeOffsetY: z.number().optional(),
    separateBadgeScale: z.number().optional(),
    separateBadgeOffsetX: z.number().optional(),
    separateBadgeOffsetY: z.number().optional(),
    separateRatingsStyle: z.enum(SEPARATE_RATINGS_STYLES).optional(),
    posterLayout: z.enum(POSTER_LAYOUTS).optional(),
    posterFreshScope: z.enum(POSTER_FRESH_SCOPES).optional(),
    networkLogoScale: z.number().optional(),
    networkLogoOffsetX: z.number().optional(),
    networkLogoOffsetY: z.number().optional(),
    badgeStyle: z.enum(BADGE_STYLES).optional(),
    /**
     * BadgeLab family map del profilo: stesso contratto sparso del flat
     * (chiave presente — incluso null — vince, assente eredita il flat).
     */
    badgePresets: badgeFamilyBindingsSchema,
    rankingBadgeStyle: z.enum(RANKING_BADGE_STYLES).optional(),
    extraBadgeStyle: z.union([z.enum(EXTRA_BADGE_STYLES), z.literal(EXTRA_BADGE_FOLLOW_RANK)]).nullable().optional(),
    badgeFont: z.enum(BADGE_FONTS).optional(),
    qualityBadgeStyle: z.enum(QUALITY_BADGE_STYLES).nullable().optional(),
    videoFormats: z.array(z.enum(["dv", "hdr", "hdr10plus", "atmos", "imax"])).nullable().optional(),
    globalBadges: z.boolean().optional(),
    rankingBadges: z.boolean().optional(),
    badgeGenre: z.boolean().optional(),
    badgeYear: z.boolean().optional(),
    badgeRating: z.boolean().optional(),
    badgeQuality: z.boolean().optional(),
    /**
     * Badge età testuale per-shape (default = flat portrait): assente/null =
     * segue il flat, `false` esplicito vince (un portrait ON non attiva mai un
     * landscape mai configurato).
     */
    ageBadge: z.boolean().optional(),
    /** Paese classificazione età per-shape (assente/null/invalido = flat). */
    ageCountry: z.string().max(8).optional(),
    /** Stile pill età per-shape (assente/null/invalido = flat). */
    ageBadgeStyle: z.enum(AGE_BADGE_STYLES).nullable().optional(),
    minQuality: z.enum(["SD", "HD", "FHD", "4K"]).optional(),
    customRatings: z.boolean().optional(),
    separateRatings: z.boolean().optional(),
    networkLogo: z.boolean().optional(),
    networkLogoPosition: z.enum(["auto", "top"]).optional(),
    networkLogoFollowTitle: z.boolean().nullable().optional(),
    /**
     * Logo-block alignment override ("left"/"center"); absent/null = follow
     * the flat (flat null = per-shape auto). Task 3B2 shape independence.
     */
    logoAlign: z.enum(["left", "center"]).nullable().optional(),
    preRelease: z.boolean().optional(),
    ribbonSide: z.enum(["left", "right"]).optional(),
    ribbonEnabled: z.boolean().optional(),
    sashOrder: z.array(z.string().max(20)).optional(),
  }).optional(),
  customCatalogs: z.array(customCatalogSchema).optional(),
  rankingSourceMovie: z.string().max(64).optional(),
  rankingSourceSeries: z.string().max(64).optional(),
  disabledCatalogIds: z.array(z.string().max(80)).optional(),
  homeDisabledCatalogIds: z.array(z.string().max(80)).optional(),
  catalogOrder: z.array(z.string().max(80)).optional(),
  catalogRenames: z.record(z.string().max(80), z.string().max(100)).optional(),
  catalogShowEmojis: z.boolean().optional(),
  // Per-catalog card format (TaskB): persisted values ONLY poster|landscape;
  // absent/deleted key = follow the global posterShape. Unknown enums fail
  // the PUT (never silently defaulted); prototype keys are rejected and the
  // map is capped like the other catalog records.
  catalogShapes: z.record(z.string().max(80), z.enum(["poster", "landscape"])).optional().refine((v) => {
    if (!v) return true
    const keys = Object.keys(v)
    if (keys.length > 200) return false
    return !keys.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")
  }, { message: "catalogShapes must have at most 200 entries and no prototype keys" }),
  // Custom seasonal keywords per theme (user-scoped): extra whole-word/phrase
  // matches for the automatic catalog-name recognition (see seasonal-theme.ts).
  // Bounded like the other catalog records; sanitized again at match time.
  seasonalHalloweenKeywords: z.array(z.string().max(40)).max(20).optional(),
  seasonalChristmasKeywords: z.array(z.string().max(40)).max(20).optional(),
})

function isPlainLandscapeRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
}

/**
 * Strict shape-independence backfill for direct API edits (task 3B1,
 * generalization of the age-trio snapshot): a partial PUT that touches flat
 * (portrait) keys without providing the matching `landscape` keys freezes
 * the PRE-merge effective flat values into the profile, so later portrait
 * edits can't leak into a never-configured landscape. Per key: only keys
 * present in the body AND missing both in the body profile and in the stored
 * profile are frozen; explicit stored values (incl. `false`/`0`/`[]` and the
 * explicit logo/extra `null`s) are never touched nor rebased. Arrays are
 * cloned. `storedBase` is the persisted profile (merge base, never env);
 * `effectiveFlats` is the pre-merge effective flat namespace (stored + env,
 * so operator instance defaults survive in the snapshot).
 */
function backfillLandscapeOnFlatEdit(
  storedBase: Record<string, unknown>,
  effectiveFlats: Record<string, unknown>,
  data: Record<string, unknown>,
): void {
  const landPatch = isPlainLandscapeRecord(data.landscape)
    ? (data.landscape as Record<string, unknown>)
    : null
  const presence = { ...storedBase, ...(landPatch ?? {}) }
  const changedFlatKeys: string[] = []
  const flatsRecord: Record<string, unknown> = {}
  for (const [flatKey] of Object.entries(SHAPE_FLAT_TO_LANDSCAPE)) {
    const bareKey = flatKey.charAt(7).toLowerCase() + flatKey.slice(8)
    flatsRecord[flatKey] = effectiveFlats[bareKey]
    if (bareKey in data) changedFlatKeys.push(flatKey)
  }
  const adds = snapshotMissingLandscape(flatsRecord, presence, changedFlatKeys) as Record<string, unknown>
  // Deep-merge the profile (never a wholesale replace): a partial `landscape`
  // patch must not discard unrelated stored profile fields. Stored base
  // first, snapshot fills gaps, the explicit body patch wins.
  data.landscape = { ...storedBase, ...adds, ...(landPatch ?? {}) }
}

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
  const d = await getServerDefaultsChecked()
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
      // dinamica, nel file finiscono solo scelte dell'utente. Lo snapshot
      // landscape usa l'effettivo (storato + env d'istanza) come sorgente
      // così i default d'istanza dell'operatore sopravvivono al freeze.
      const stored = await getStoredUserDefaults(scoped)
      const storedLand = isPlainLandscapeRecord(stored.landscape)
        ? (stored.landscape as unknown as Record<string, unknown>)
        : {}
      backfillLandscapeOnFlatEdit(
        storedLand,
        { ...getInstanceEnvDefaults(), ...stored } as unknown as Record<string, unknown>,
        parsed.data as unknown as Record<string, unknown>,
      )
      const next: Record<string, unknown> = { ...stored, ...parsed.data }
      await setServerDefaultsForUser(scoped, next as ServerDefaults)
      // Il cambio defaults ruota le chiavi catalogo/meta del namespace via
      // epoch utente — niente wipe globale (il save di A non tocca B).
      await bumpCatalogEpoch(scoped)
      return Response.json({ ok: true })
    }
    const current = await getServerDefaultsChecked()
    // Merge invece di replace: un payload parziale NON deve azzerare i default
    // già salvati (altrimenti salvare un solo campo cancellerebbe gli altri).
    // Snapshot landscape prima del merge (vedi backfill sopra); `current` è
    // già l'effettivo (storato + env) quindi la sorgente include i default
    // d'istanza. Il profilo `landscape` fonde per-chiave (mai replace).
    const currentLand = isPlainLandscapeRecord(current.landscape)
      ? (current.landscape as unknown as Record<string, unknown>)
      : {}
    backfillLandscapeOnFlatEdit(
      currentLand,
      current as unknown as Record<string, unknown>,
      parsed.data as unknown as Record<string, unknown>,
    )
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
