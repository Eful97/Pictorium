import { NextRequest } from "next/server"
import { ZodError } from "zod"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import {
  checkUserAuth,
  getScopedUserId,
  extractUserParam,
  invalidUserResponse,
  isMultiUserEnabled,
  userAuthResponse,
  userRateLimitKey,
} from "@/lib/user-auth"
import { isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { readJsonBody, BodyTooLargeError, InvalidJsonBodyError } from "@/lib/read-body"
import { isBadgePresetId } from "@/lib/badge-preset"
import {
  deletePreset,
  getPresetForUser,
  updatePreset,
  PresetForbiddenError,
  PresetNotFoundError,
  PresetValidationError,
} from "@/lib/badge-preset-store"
import { createLogger } from "@/lib/logger"

const log = createLogger("api-presets")

type RouteParams = { id: string }

/** Body cap: il preset JSON non supera mai 16KB (quota store). */
const MAX_PRESET_BODY_BYTES = 32 * 1024

function resolveScope(req: NextRequest): { scoped: string | null; error?: Response } {
  const rawUser = extractUserParam(req)
  if (rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)) {
    return { scoped: null, error: invalidUserResponse() }
  }
  return { scoped: getScopedUserId(rawUser) }
}

export async function GET(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(error ? rateLimitKey(req) : scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req), "presets")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  const { id } = await params
  if (!isBadgePresetId(id)) return Response.json({ error: "Invalid preset id" }, { status: 400 })
  const stored = await getPresetForUser(id, scoped ?? "")
  if (!stored) return Response.json({ error: "not found" }, { status: 404 })
  // Pubblici immutabili-per-revision: cachabili. Privati: mai in cache.
  const cache =
    stored.preset.visibility === "public"
      ? "public, max-age=300, stale-while-revalidate=600"
      : "no-store"
  return Response.json(stored, { headers: { "Cache-Control": cache } })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(error ? rateLimitKey(req) : scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req), "presets")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  if (!scoped) return invalidUserResponse()
  if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  const { id } = await params
  if (!isBadgePresetId(id)) return Response.json({ error: "Invalid preset id" }, { status: 400 })
  let body: unknown
  try {
    body = await readJsonBody(req, MAX_PRESET_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    if (e instanceof InvalidJsonBodyError) return Response.json({ error: "Invalid JSON body" }, { status: 400 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  try {
    const stored = await updatePreset(scoped, id, (body ?? {}) as Parameters<typeof updatePreset>[2])
    return Response.json(stored)
  } catch (e) {
    if (e instanceof PresetNotFoundError) return Response.json({ error: "not found" }, { status: 404 })
    if (e instanceof PresetForbiddenError) return Response.json({ error: "forbidden" }, { status: 403 })
    if (e instanceof PresetValidationError) return Response.json({ error: e.message }, { status: 400 })
    if (e instanceof ZodError) return Response.json({ error: "Validation failed", details: e.flatten() }, { status: 400 })
    log.error("Preset update failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<RouteParams> }) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(error ? rateLimitKey(req) : scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req), "presets")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  if (!scoped) return invalidUserResponse()
  if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  const { id } = await params
  if (!isBadgePresetId(id)) return Response.json({ error: "Invalid preset id" }, { status: 400 })
  try {
    const deleted = await deletePreset(scoped, id)
    if (!deleted) return Response.json({ error: "not found" }, { status: 404 })
    return Response.json({ ok: true })
  } catch (e) {
    if (e instanceof PresetForbiddenError) return Response.json({ error: "forbidden" }, { status: 403 })
    if (e instanceof PresetValidationError) return Response.json({ error: e.message }, { status: 400 })
    log.error("Preset delete failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
