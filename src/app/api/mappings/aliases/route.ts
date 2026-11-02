import { NextRequest } from "next/server"
import { getAllAliases, setImdbAlias, removeImdbAlias, QuotaExceededError } from "@/lib/store"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheInvalidatePosterDataFor, cacheInvalidatePosterDataForUser } from "@/lib/cache"
import { bumpCatalogEpoch } from "@/lib/catalog-epoch"
import { aliasSchema } from "@/lib/validation"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { checkUserAuth, getScopedUserId, extractUserParam, invalidUserResponse, isMultiUserEnabled, userAuthResponse, userRateLimitKey } from "@/lib/user-auth"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"

/**
 * Alias manuali IMDb → TMDB per-namespace (`tt...` di franchise che TMDB /find
 * non collega all'entry di stagione, es. Monster tt13207736 → tv:299939).
 * Nella poster route l'alias vince sul /find. Stesso modello auth/scope della
 * route mappings (stile AIO): `?u=` + secret/password, admin token sul globale.
 */

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

export async function GET(req: NextRequest) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(error ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
    return Response.json({ aliases: await getAllAliases(scoped) })
  }
  if (!(await checkAdminToken(req))) return adminAuthResponse()
  return Response.json({ aliases: await getAllAliases(scoped) })
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
    if (!(await checkAdminToken(req))) return adminAuthResponse()
    if (!isSameOrigin(req)) return originMismatchResponse()
  }
  let body: unknown
  try {
    body = await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const parsed = aliasSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 })
  }
  try {
    await setImdbAlias(parsed.data, scoped)
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return Response.json({ error: e.message }, { status: 413 })
    }
    throw e
  }
  // Stessa invalidazione del save mapping: il poster di quel tt cambia subito,
  // su questa istanza e (via epoch) sulle altre.
  if (scoped) {
    cacheInvalidatePosterDataForUser(parsed.data.mediaType, parsed.data.tmdbId, scoped)
    await bumpCatalogEpoch(scoped)
    return Response.json({ ok: true })
  }
  cacheInvalidatePosterDataFor(parsed.data.mediaType, parsed.data.tmdbId)
  await bumpCatalogEpoch()
  return Response.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(error ? rateLimitKey(req) : (scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req)), "mappings")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  if (scoped) {
    const denied = await checkUserWrite(req, scoped)
    if (denied) return denied
  } else {
    if (!(await checkAdminToken(req))) return adminAuthResponse()
    if (!isSameOrigin(req)) return originMismatchResponse()
  }
  const imdbId = (req.nextUrl.searchParams.get("imdbId") || "").trim()
  if (!/^tt\d{1,20}$/.test(imdbId)) {
    return Response.json({ error: "Invalid imdbId: must match tt<number>" }, { status: 400 })
  }
  await removeImdbAlias(imdbId, scoped)
  return Response.json({ ok: true })
}
