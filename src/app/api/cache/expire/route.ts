import { NextRequest } from "next/server"
import { cacheExpire } from "@/lib/cache"
import { checkAdminToken, isSameOrigin, adminAuthResponse, originMismatchResponse } from "@/lib/auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"

export async function POST(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!(await checkAdminToken(req))) return adminAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()

  let body: { tag?: string; key?: string } = {}
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const target = body.tag || body.key
  if (!target || typeof target !== "string") {
    return Response.json({ error: "Missing or invalid 'tag' or 'key' parameter" }, { status: 400 })
  }

  const expired = cacheExpire(target)
  return Response.json({ ok: true, target, expired })
}
