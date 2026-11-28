import { NextRequest } from "next/server"
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit"
import {
  checkUserAuth,
  invalidUserResponse,
  isMultiUserEnabled,
  sanitizeUserId,
  userAuthResponse,
  userRateLimitKey,
} from "@/lib/user-auth"
import { isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { getUserKeys, USER_KEY_KINDS, type UserKeyKind } from "@/lib/user-keys"
import { readJsonBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from "@/lib/read-body"

type RouteParams = { uuid: string }

/**
 * POST `{kind}` → `{kind, value}`: unica lettura di un segreto, solo al
 * proprietario autenticato (secret o password), solo same-origin, bucket
 * stretto anti brute-force su chiave composita IP+UUID. Il valore non
 * compare mai nei log (solo la kind). 404 se non impostata, 400 kind ignota.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  if (!isMultiUserEnabled()) {
    return Response.json({ error: "Multi-user is disabled" }, { status: 404 })
  }
  const { uuid } = await params
  const userId = sanitizeUserId(uuid)
  if (!userId) return invalidUserResponse()
  const rl = await rateLimit(userRateLimitKey(req, userId), "users-password")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!(await checkUserAuth(req, userId))) return userAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  let body: unknown
  try {
    body = await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const kind = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).kind
    : undefined
  if (typeof kind !== "string" || !(USER_KEY_KINDS as readonly string[]).includes(kind)) {
    return Response.json({ error: "Invalid kind: use tmdb, mdblist, tvdb or simkl" }, { status: 400 })
  }
  // Azione esplicita del proprietario: restituisce anche le kind
  // disattivate (serve alla riattivazione senza ridigitare).
  const value = (await getUserKeys(userId, { includeDisabled: true }))[kind as UserKeyKind]
  if (!value) return Response.json({ error: "Key not set" }, { status: 404 })
  return Response.json({ kind, value }, { headers: { "Cache-Control": "no-store" } })
}
