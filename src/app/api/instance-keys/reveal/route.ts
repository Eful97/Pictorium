import { NextRequest } from "next/server"
import { adminAuthResponse, checkAdminToken, isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { revealInstanceKey } from "@/lib/instance-keys"
import { USER_KEY_KINDS, type UserKeyKind } from "@/lib/user-keys"
import { BodyTooLargeError, DEFAULT_MAX_BODY_BYTES, readJsonBody } from "@/lib/read-body"

/**
 * POST `{kind}` → `{kind, value}`: the single explicit read of an instance
 * secret (Settings → Data, "Show saved key"). GET /api/instance-keys stays
 * presence-only; this is the only path that returns a stored value.
 *
 * Admin/PIN session (`checkAdminToken`, fail-closed) + same-origin, on the
 * shared `instance-keys` rate-limit bucket. Body validation: malformed body
 * 400, unknown kind 404 (nothing to reveal), known-but-unset kind 404. The
 * value travels in the JSON body only, never in a URL/log/cache
 * (`Cache-Control: no-store`).
 */
export async function POST(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "instance-keys")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (!checkAdminToken(req)) return adminAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()

  let body: unknown
  try {
    body = await readJsonBody(req, DEFAULT_MAX_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Invalid body" }, { status: 400 })
  }
  const kind = (body as Record<string, unknown>).kind
  if (typeof kind !== "string" || !kind.trim()) {
    return Response.json({ error: "Invalid body: expected {kind}" }, { status: 400 })
  }
  // Unknown kind = nothing exists to reveal (404, same as a known-but-unset
  // kind): the endpoint never hints at which kinds the store may hold.
  if (!(USER_KEY_KINDS as readonly string[]).includes(kind)) {
    return Response.json({ error: "Unknown key kind" }, { status: 404 })
  }

  const value = await revealInstanceKey(kind as UserKeyKind)
  if (!value) return Response.json({ error: "Key not set" }, { status: 404 })
  return Response.json({ kind, value }, { headers: { "Cache-Control": "no-store" } })
}
