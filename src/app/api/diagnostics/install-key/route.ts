import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { createLogger } from "@/lib/logger"
import { readJsonBody, BodyTooLargeError } from "@/lib/read-body"
import {
  checkUserAuth,
  getScopedUserId,
  invalidUserResponse,
  isMultiUserEnabled,
  userRateLimitKey,
} from "@/lib/user-auth"
import { checkTmdbEndpoint, resolveUserApiKeys } from "@/lib/tmdb"
import { decodeConfig, MAX_CONFIG_TOKEN_LENGTH } from "@/lib/config-token"

const log = createLogger("install-key")

type InstallKeyCode = "ok" | "missing" | "invalid" | "unauthorized" | "bad-config" | "bad-request"

function json(code: InstallKeyCode, init: Record<string, unknown>, status = 200): Response {
  return Response.json({ ok: code === "ok", code, ...init }, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
}

/**
 * LIVE diagnostic of the effective TMDB key for the install context
 * (POST /api/diagnostics/install-key).
 *
 * The client (InstallModal → "Check my configuration") sends ONLY the context
 * (`u` namespace and/or `config` token derived from the selected manifest URL):
 * NEVER keys, NEVER secrets, NEVER arbitrary URLs. The server resolves the
 * effective key exactly as Stremio would see it — request-explicit key
 * excluded (Stremio never sends one), encrypted namespace only with verified
 * auth, instance fallback per policy — and probes it against live TMDB. The
 * response reports only the outcome (`ok`/`code`/`source`), never the key or raw errors.
 *
 * Anti-oracle policy (same as /api/health): `?u=`/`u` without the space
 * credential inherits no foreign keys and does NOT fall through to the green
 * global fallback — it is 401 `unauthorized`. Without a namespace the global
 * scope applies (fallback included).
 */
export async function POST(req: NextRequest): Promise<Response> {
  let rawUser: string | null = null
  try {
    const sp = req.nextUrl.searchParams
    rawUser = sp.get("u") ?? sp.get("user")
  } catch {
    rawUser = null
  }
  const claimedForRl = rawUser && isMultiUserEnabled() ? getScopedUserId(rawUser) : null
  const rl = await rateLimit(
    claimedForRl ? userRateLimitKey(req, claimedForRl) : rateLimitKey(req),
    "validate-key",
  )
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  // Same-origin only (the UI): no cross-site probing. Without Origin
  // (curl/tooling) it passes like elsewhere.
  if (!isSameOrigin(req)) return originMismatchResponse()

  let body: { u?: unknown; config?: unknown }
  try {
    body = (await readJsonBody(req, 4096)) as { u?: unknown; config?: unknown }
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return json("bad-request", { error: "Request body too large" }, 413)
    }
    return json("bad-request", { error: "Invalid JSON body" }, 400)
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json("bad-request", { error: "Invalid body" }, 400)
  }

  const bodyUser = typeof body.u === "string" ? body.u : null
  if (body.u !== undefined && body.u !== null && typeof body.u !== "string") {
    return json("bad-request", { error: "Invalid user id" }, 400)
  }
  const effectiveRawUser = bodyUser ?? rawUser
  if (effectiveRawUser && isMultiUserEnabled() && !getScopedUserId(effectiveRawUser)) {
    return invalidUserResponse()
  }
  const claimedUser = getScopedUserId(effectiveRawUser)
  const scopedUserId = claimedUser && (await checkUserAuth(req, claimedUser)) ? claimedUser : null
  if (claimedUser && !scopedUserId) {
    // Foreign/locked space: NEVER fall back to the green global key.
    return json("unauthorized", { source: "none", authenticated: false, hasConfig: false }, 401)
  }

  const rawConfig = body.config
  let hasConfig = false
  if (rawConfig !== undefined && rawConfig !== null) {
    if (typeof rawConfig !== "string" || rawConfig.length > MAX_CONFIG_TOKEN_LENGTH) {
      return json("bad-config", { source: "none", authenticated: !!scopedUserId, hasConfig: false }, 400)
    }
    if (rawConfig.length > 0) {
      if (!decodeConfig(rawConfig)) {
        return json("bad-config", { source: "none", authenticated: !!scopedUserId, hasConfig: false }, 400)
      }
      hasConfig = true
    }
  }

  // Honest Stremio-context resolution: NO request-explicit key
  // (the editor may hold one on the device that Stremio will never
  // have) — only the authenticated namespace + instance fallback per policy.
  const keyReq = {
    headers: { get: (_name: string): string | null => null },
    nextUrl: { searchParams: new URLSearchParams() },
  }
  const resolved = await resolveUserApiKeys(keyReq, scopedUserId)
  const key = resolved.tmdb.key
  const source = resolved.tmdb.source
  if (!key) {
    return json("missing", { source: "none", authenticated: !!scopedUserId, hasConfig })
  }

  const probe = await checkTmdbEndpoint("/authentication", key)
  if (!probe.ok) {
    log.warn("Install key check failed", { source, authenticated: !!scopedUserId })
    return json("invalid", { source, authenticated: !!scopedUserId, hasConfig })
  }
  return json("ok", { source, authenticated: !!scopedUserId, hasConfig })
}
