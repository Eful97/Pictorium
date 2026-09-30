import { NextRequest } from "next/server"
import { getById, remove, removeAliasesFor, upsert } from "@/lib/store"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheInvalidate, cacheInvalidatePosterDataFor, cacheInvalidatePosterDataForUser } from "@/lib/cache"
import { bumpCatalogEpoch } from "@/lib/catalog-epoch"
import { mappingUpdateSchema } from "@/lib/validation"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { checkUserAuth, getScopedUserId, extractUserParam, invalidUserResponse, isMultiUserEnabled, userAuthResponse, userRateLimitKey } from "@/lib/user-auth"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"

type RouteParams = { id: string }

function resolveScope(req: NextRequest): { scoped: string | null; error?: Response } {
  const rawUser = extractUserParam(req)
  if (rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)) {
    return { scoped: null, error: invalidUserResponse() }
  }
  return { scoped: getScopedUserId(rawUser) }
}

async function checkUserWrite(req: NextRequest, scoped: string): Promise<Response | null> {
  if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  return null
}

export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(error ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  const { id } = await params
  const [type, tmdbIdStr] = id.split(":")
  const tmdbId = Number(tmdbIdStr)
  // Stessa validazione di PUT/DELETE (finding 17): evita chiavi arbitrarie
  // (es. "garbage:NaN") verso lo store.
  if (!tmdbId || !type || (type !== "movie" && type !== "tv")) {
    return Response.json({ error: "Invalid id format" }, { status: 400 })
  }
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  }
  const mapping = await getById(type as "movie" | "tv", tmdbId, scoped)
  if (!mapping) return Response.json({ error: "not found" }, { status: 404 })
  // Fix L34: header cache esplicito. Nota fail-open: su istanza pubblica senza
  // ADMIN_TOKEN questa GET è aperta (l'editor la usa per il WYSIWYG) — i dati
  // dei mapping non sono segreti (stesso livello dei poster pubblici), ma sono
  // mutabili: no-store evita che browser/CDN servano copie stantie.
  return Response.json(mapping, { headers: { "Cache-Control": "no-store" } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
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
  const { id } = await params
  const [type, tmdbIdStr] = id.split(":")
  const tmdbId = Number(tmdbIdStr)
  if (!tmdbId || !type || (type !== "movie" && type !== "tv")) {
    return Response.json({ error: "Invalid id format" }, { status: 400 })
  }
  const existingPromise = getById(type as "movie" | "tv", tmdbId, scoped)
  let body: unknown
  try {
    body = await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const existing = await existingPromise
  const parsed = mappingUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 })
  }
  if (!existing) return Response.json({ error: "not found" }, { status: 404 })
  const hasField = <K extends keyof typeof parsed.data>(key: K) =>
    Object.prototype.hasOwnProperty.call(parsed.data, key)
  await upsert({
    ...existing,
    ...parsed.data,
    logoPath: hasField("logoPath") ? (parsed.data.logoPath ?? null) : existing.logoPath,
    backdropPath: hasField("backdropPath") ? (parsed.data.backdropPath ?? null) : existing.backdropPath,
    customBadge: hasField("customBadge") ? (parsed.data.customBadge ?? null) : existing.customBadge,
    badgeExtra: hasField("badgeExtra") ? (parsed.data.badgeExtra ?? null) : existing.badgeExtra,
    originalPosterPath: parsed.data.originalPosterPath ?? existing.originalPosterPath,
    language: parsed.data.language ?? existing.language,
    genreName: parsed.data.genreName ?? existing.genreName,
    voteAverage: parsed.data.voteAverage ?? existing.voteAverage,
    trendRank: parsed.data.trendRank ?? existing.trendRank,
    trendPeriod: parsed.data.trendPeriod ?? existing.trendPeriod,
    tvType: parsed.data.tvType ?? existing.tvType,
    tvStatus: parsed.data.tvStatus ?? existing.tvStatus,
    accentColor: parsed.data.accentColor ?? existing.accentColor,
    badgeRank: parsed.data.badgeRank ?? existing.badgeRank,
    badgeLabel: parsed.data.badgeLabel ?? existing.badgeLabel,
    animeRank: hasField("animeRank") ? (parsed.data.animeRank ?? null) : existing.animeRank,
    // Base custom da URL esterno: presente → salva (null = rimuovi), assente →
    // preserva. updatedAt viene sempre bumpato → `mv` negli URL Stremio e
    // `:mu` nella cache key invalidano il poster precedente.
    customPosterUrl: hasField("customPosterUrl") ? (parsed.data.customPosterUrl ?? null) : existing.customPosterUrl,
    releaseDate: parsed.data.releaseDate ?? existing.releaseDate,
    firstAirDate: parsed.data.firstAirDate ?? existing.firstAirDate,
    logoDisabled: parsed.data.logoDisabled ?? existing.logoDisabled,
    episodeGroupId: hasField("episodeGroupId") ? (parsed.data.episodeGroupId ?? null) : existing.episodeGroupId,
    tmdbId: existing.tmdbId,
    mediaType: existing.mediaType,
    updatedAt: new Date().toISOString(),
  }, scoped)
  if (scoped) {
    cacheInvalidatePosterDataForUser(type, tmdbId, scoped)
    await bumpCatalogEpoch(scoped)
    return Response.json({ ok: true })
  }
  cacheInvalidatePosterDataFor(type, tmdbId)
  cacheInvalidate("stremio")
  // Bump epoch cataloghi (F3): invalidazione cross-instance.
  await bumpCatalogEpoch()
  return Response.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
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
  const { id } = await params
  const [type, tmdbIdStr] = id.split(":")
  const tmdbId = Number(tmdbIdStr)
  // Stessa validazione del PUT: evita remove() con type/chiavi malformati
  if (!tmdbId || !type || (type !== "movie" && type !== "tv")) {
    return Response.json({ error: "Invalid id format" }, { status: 400 })
  }
  await remove(type as "movie" | "tv", tmdbId, scoped)
  // Cascata alias: senza, un alias orfano continuerebbe a dirottare il tt sul
  // tmdbId eliminato (fail-open verso il vecchio 404, mai crash — ma meglio pulire).
  await removeAliasesFor(type as "movie" | "tv", tmdbId, scoped)
  if (scoped) {
    cacheInvalidatePosterDataForUser(type as "movie" | "tv", tmdbId, scoped)
    await bumpCatalogEpoch(scoped)
    return Response.json({ ok: true })
  }
  cacheInvalidatePosterDataFor(type as "movie" | "tv", tmdbId)
  cacheInvalidate("stremio")
  await bumpCatalogEpoch()
  return Response.json({ ok: true })
}
