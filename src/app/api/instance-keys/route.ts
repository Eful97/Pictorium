import { NextRequest } from "next/server"
import { adminAuthResponse, checkAdminToken, isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  getInstanceKeyStatus,
  InstanceKeysUnavailableError,
  setInstanceKeys,
} from "@/lib/instance-keys"
import { InvalidUserKeyError, USER_KEY_KINDS, type UserKeyKind } from "@/lib/user-keys"
import { BodyTooLargeError, DEFAULT_MAX_BODY_BYTES, readJsonBody } from "@/lib/read-body"

/**
 * Instance API keys (single-user deployments, follow-up UI in Settings).
 *
 * GET → presence only: `{tmdb, mdblist, tvdb, simkl, fanart}` booleans plus
 * `{storage, writable, decryptable}`. NEVER values — the same public signal
 * `GET /api/defaults` already exposes as `hasInstanceKeys`, extended with
 * honest storage health. No auth needed for presence.
 *
 * PUT → admin/PIN session only (`checkAdminToken`, fail-closed) + same-origin.
 * Body patch per kind: string = set (trimmed, 1..256 chars), `""`/`null` =
 * clear, absent = unchanged. 401 without admin, 503 when the encrypted store
 * cannot be persisted (fail-closed: keys are never written in plaintext).
 */
export async function GET(req: NextRequest) {
  // Dedicated bucket key (`instance-keys`): an isolated token bucket even
  // though it shares the default budget config.
  const rl = await rateLimit(rateLimitKey(req), "instance-keys")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const status = await getInstanceKeyStatus()
  return Response.json(status, { headers: { "Cache-Control": "no-store" } })
}

export async function PUT(req: NextRequest) {
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

  const input: Partial<Record<UserKeyKind, unknown>> = {}
  for (const kind of USER_KEY_KINDS) {
    if (kind in (body as Record<string, unknown>)) {
      input[kind] = (body as Record<string, unknown>)[kind]
    }
  }

  try {
    await setInstanceKeys(input)
  } catch (e) {
    if (e instanceof InvalidUserKeyError) {
      return Response.json({ error: e.message }, { status: 400 })
    }
    if (e instanceof InstanceKeysUnavailableError) {
      return Response.json({ error: e.message }, { status: 503 })
    }
    throw e
  }

  const status = await getInstanceKeyStatus()
  return Response.json({ ok: true, ...status }, { headers: { "Cache-Control": "no-store" } })
}
