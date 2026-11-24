import { NextRequest } from "next/server"
import { ZodError } from "zod"
import { checkAdminToken, isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { extractUserParam, getScopedUserId, isMultiUserEnabled, checkUserAuth, invalidUserResponse, userAuthResponse } from "@/lib/user-auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { readJsonBody, BodyTooLargeError, InvalidJsonBodyError } from "@/lib/read-body"
import { listSharedPresets, publishSharedPreset, unpublishSharedPreset, updateSharedPreset } from "@/lib/shared-preset-store"
import { visualPresetShapeSchema, type VisualPresetShape } from "@/lib/visual-presets"
import { createLogger } from "@/lib/logger"

const log = createLogger("shared-presets")
const noStore = { "Cache-Control": "no-store" }

/**
 * Community gallery of published presets. Exists only with MULTI_USER=1 and
 * only for authenticated instance users (no anonymous listing).
 */
async function handle(req: NextRequest, operation?: "publish" | "update" | "unpublish") {
  if (!isMultiUserEnabled()) return Response.json({ error: "Not found" }, { status: 404 })
  const rl = await rateLimit(rateLimitKey(req), "presets")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const user = getScopedUserId(extractUserParam(req))
  if (!user) return invalidUserResponse()
  if (!await checkUserAuth(req, user)) return userAuthResponse()
  if (operation && !isSameOrigin(req)) return originMismatchResponse()
  try {
    if (!operation) {
      const rawShape = req.nextUrl.searchParams.get("shape") ?? "portrait"
      const parsed = visualPresetShapeSchema.safeParse(rawShape)
      if (!parsed.success) return Response.json({ error: "Invalid shape" }, { status: 400 })
      const shape: VisualPresetShape = parsed.data
      return Response.json({ presets: await listSharedPresets(user, shape, await checkAdminToken(req)) }, { headers: noStore })
    }
    const body = await readJsonBody(req, 16 * 1024)
    const presets = operation === "publish"
      ? await publishSharedPreset(user, body)
      : operation === "update"
        ? await updateSharedPreset(user, body, await checkAdminToken(req))
        : await unpublishSharedPreset(user, body, await checkAdminToken(req))
    return Response.json({ presets }, { headers: noStore })
  } catch (error) {
    if (error instanceof ZodError || error instanceof InvalidJsonBodyError) return Response.json({ error: "Invalid preset" }, { status: 400 })
    if (error instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    if (error instanceof Error && error.message === "Shared preset limit reached") return Response.json({ error: error.message }, { status: 409 })
    if (error instanceof Error && error.message === "Preset not found") return Response.json({ error: error.message }, { status: 404 })
    if (error instanceof Error && error.message === "Forbidden") return Response.json({ error: error.message }, { status: 403 })
    log.error("Shared preset storage failed", { error: error instanceof Error ? error.message : String(error) })
    return Response.json({ error: "Shared preset storage unavailable" }, { status: 500 })
  }
}

export const GET = (req: NextRequest) => handle(req)
export const POST = (req: NextRequest) => handle(req, "publish")
/** Rename (`{id, name}`, author) or like/unlike (`{id, like}`, non-author). */
export const PATCH = (req: NextRequest) => handle(req, "update")
export const DELETE = (req: NextRequest) => handle(req, "unpublish")
