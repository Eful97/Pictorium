import { NextRequest } from "next/server"
import { getAll, getById, upsert, removeAll, QuotaExceededError } from "@/lib/store"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheInvalidate, cacheInvalidatePosterData, cacheInvalidatePosterDataFor, cacheInvalidatePosterDataForUser } from "@/lib/cache"
import { bumpCatalogEpoch } from "@/lib/catalog-epoch"
import { mappingSchema } from "@/lib/validation"
import { checkAdminToken, requireAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { checkUserAuth, getScopedUserId, extractUserParam, invalidUserResponse, isMultiUserEnabled, userAuthResponse, userRateLimitKey } from "@/lib/user-auth"
import { getWarmupCatalogs } from "@/lib/catalog-definitions"
import { getServerDefaults } from "@/lib/server-defaults"
import { buildStremioPosterUrl } from "@/lib/stremio-poster-url"
import { resolveRequestApiKey } from "@/lib/tmdb"
import { createLogger } from "@/lib/logger"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"

const log = createLogger("mappings")

/**
 * Namespace della richiesta (multi-user): `?u=`/`?user=` validato, solo con
 * flag ON. Ritorna `{ scoped }` o una Response di errore (400 uuid invalido).
 * Con flag OFF o senza param → `{ scoped: null }` = path globale invariato.
 */
function resolveScope(req: NextRequest): { scoped: string | null; error?: Response } {
  const rawUser = extractUserParam(req)
  if (rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)) {
    return { scoped: null, error: invalidUserResponse() }
  }
  return { scoped: getScopedUserId(rawUser) }
}

async function checkUserWrite(req: NextRequest, scoped: string): Promise<Response | null> {
  // Secret oppure password (stile AIO): intercambiabili su tutti gli scoped.
  if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  return null
}

export async function GET(req: NextRequest) {
  const { scoped, error } = resolveScope(req)
  // Rate limit per-utente (multi-user): il bucket segue il namespace, non
  // l'IP — la quota di A non brucia quella di B e viceversa.
  const rl = await rateLimit(error ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) {
      return userAuthResponse()
    }
    const mappings = await getAll(scoped)
    return Response.json({ mappings })
  }
  // Fail-open senza ADMIN_TOKEN (istanza pubblica HF Spaces); fail-closed con token.
  if (!checkAdminToken(req)) return adminAuthResponse()
  const mappings = await getAll()
  return Response.json({ mappings })
}

export async function POST(req: NextRequest) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(error ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  if (scoped) {
    const denied = await checkUserWrite(req, scoped)
    if (denied) return denied
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
  const parsed = mappingSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 })
  }
  // Logo manuale anche su portrait non-clean: nessun strip, la scelta
  // esplicita persiste (il default nessun auto resta a monte).
  const newMapping = {
    ...parsed.data,
    logoPath: parsed.data.logoPath ?? null,
    originalPosterPath: parsed.data.originalPosterPath ?? null,
    language: parsed.data.language ?? null,
    genreName: parsed.data.genreName ?? undefined,
    voteAverage: parsed.data.voteAverage ?? undefined,
    trendRank: parsed.data.trendRank ?? undefined,
    trendPeriod: parsed.data.trendPeriod ?? undefined,
    tvType: parsed.data.tvType ?? undefined,
    tvStatus: parsed.data.tvStatus ?? undefined,
    accentColor: parsed.data.accentColor ?? undefined,
    badgeExtra: parsed.data.badgeExtra ?? undefined,
    badgeRank: parsed.data.badgeRank ?? undefined,
    badgeLabel: parsed.data.badgeLabel ?? undefined,
    animeRank: parsed.data.animeRank ?? undefined,
    customBadge: parsed.data.customBadge ?? undefined,
    releaseDate: parsed.data.releaseDate ?? undefined,
    firstAirDate: parsed.data.firstAirDate ?? undefined,
    backdropPath: parsed.data.backdropPath ?? null,
    logoDisabled: parsed.data.logoDisabled ?? undefined,
    networkLogoPath: parsed.data.networkLogoPath ?? null,
    networkLogoName: parsed.data.networkLogoName ?? null,
    episodeGroupId: parsed.data.episodeGroupId ?? undefined,
    updatedAt: new Date().toISOString(),
  }

  try {
    await upsert(newMapping, scoped)
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return Response.json({ error: e.message }, { status: 413 })
    }
    log.error("Mapping upsert failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }

  if (scoped) {
    // Invalidazione mirata al namespace: il save di A non tocca B. Il bump
    // dell'epoch utente ruota le sue chiavi catalogo/meta (stesso meccanismo
    // cross-instance del globale) — niente wipe globale, niente warmup
    // per-utente (piano v4: solo cataloghi globali).
    cacheInvalidatePosterDataForUser(parsed.data.mediaType, parsed.data.tmdbId, scoped)
    await bumpCatalogEpoch(scoped)
    return Response.json({ ok: true })
  }

  // Invalidazione mirata al mapping salvato, non globale (i default impattano
  // tutto, un singolo mapping solo il suo poster/badge).
  cacheInvalidatePosterDataFor(parsed.data.mediaType, parsed.data.tmdbId)
  // Bump epoch cataloghi (F3): invalida cross-instance — la cacheInvalidate
  // sopra non raggiunge le altre istanze serverless.
  await bumpCatalogEpoch()
  // Il meta videos (Stremio) dipende da episodeGroupId: invalidare anche i
  // meta cache (tags stremio/meta) altrimenti dopo un cambio ordinamento
  // si serve lo stale 12h e l'utente vede ancora le stagioni vecchie.
  cacheInvalidate("stremio")
  // Warm poster cache — impopola cache TMDB + poster prima che Stremio/utenti richiedano.
  // Guardia VERCEL (fix M11): il self-fetch su 127.0.0.1 non esiste su Vercel
  // serverless; prima il warmup falliva sempre e loggava warning ingannevoli.
  if (!process.env.VERCEL) {
    const internalOrigin = `http://127.0.0.1:${process.env.PORT || "3000"}`
    void (async () => {
      const savedMapping = await getById(parsed.data.mediaType, parsed.data.tmdbId)
      const warmUrl = buildStremioPosterUrl({
        origin: internalOrigin,
        type: parsed.data.mediaType === "tv" ? "series" : "movie",
        id: parsed.data.tmdbId,
        defaults: getServerDefaults(),
        mapping: savedMapping,
        lang: parsed.data.language || "it",
      })
      await fetch(warmUrl, { signal: AbortSignal.timeout(25000) })
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      log.warn("Poster warmup failed", { error: message })
    })
    // Warm catalog cache — ricostruisci cataloghi principali in background.
    // Fix M11: la chiave TMDB della richiesta viene inoltrata — senza, i
    // cataloghi keyed (JW) venivano cachati vuoti per 60s sotto la cache
    // key `aknone` che nessuna richiesta reale riusa. La chiave viaggia
    // nell'header x-api-key (policy di tmdb.ts) e non nella query string,
    // anche se il self-fetch è su loopback: così l'URL resta pulito nei log.
    const requestApiKey = resolveRequestApiKey(req)
    const warmHeaders: HeadersInit | undefined = requestApiKey ? { "x-api-key": requestApiKey } : undefined
    for (const catalog of getWarmupCatalogs()) {
      const catalogUrl = `${internalOrigin}/catalog/${catalog.type}/${catalog.id}.json`
      void fetch(catalogUrl, { signal: AbortSignal.timeout(15000), headers: warmHeaders }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        log.warn("Catalog warmup failed", { catalog: catalog.id, error: message })
      })
    }
  }
  return Response.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  // Wipe-all: richiede SEMPRE admin token, anche su istanze pubbliche senza
  // ADMIN_TOKEN configurato (fail-closed). Nessun client lo invoca.
  if (!requireAdminToken(req)) return adminAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  await removeAll()
  cacheInvalidatePosterData()
  await bumpCatalogEpoch()
  return Response.json({ ok: true })
}
