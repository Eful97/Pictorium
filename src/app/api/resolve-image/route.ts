import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { checkUserAuth, getScopedUserId, extractUserParam, invalidUserResponse, isMultiUserEnabled, userAuthResponse } from "@/lib/user-auth"
import { resolveToImageUrl, ResolveImageError } from "@/lib/resolve-image"
import { createLogger } from "@/lib/logger"

const log = createLogger("resolve-image")

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "resolve-image")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  // Stesso gate delle mappings: dentro uno spazio utente serve l'unlock,
  // fuori serve l'admin token (fail-open senza token). Il resolver è un
  // fetch oracle: in più si richiede same-origin come per le scritture.
  const rawUser = extractUserParam(req)
  if (rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)) {
    return invalidUserResponse()
  }
  const scoped = getScopedUserId(rawUser)
  if (scoped) {
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  } else if (!checkAdminToken(req)) {
    return adminAuthResponse()
  }
  if (!isSameOrigin(req)) return originMismatchResponse()

  const rawUrl = req.nextUrl.searchParams.get("url")
  if (!rawUrl) {
    return Response.json({ error: "Missing url parameter" }, { status: 400 })
  }

  try {
    const result = await resolveToImageUrl(rawUrl)
    return Response.json(result, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (e) {
    if (e instanceof ResolveImageError) {
      return Response.json({ error: e.message }, { status: e.status })
    }
    log.error("Resolve image failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json({ error: "Failed to resolve image URL" }, { status: 500 })
  }
}
