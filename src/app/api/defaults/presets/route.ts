import { NextRequest } from "next/server"
import { ZodError } from "zod"
import { checkAdminToken, adminAuthResponse, isSameOrigin, originMismatchResponse } from "@/lib/auth"
import { extractUserParam, getScopedUserId, isMultiUserEnabled, checkUserAuth, invalidUserResponse, userAuthResponse } from "@/lib/user-auth"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { readJsonBody, BodyTooLargeError, InvalidJsonBodyError } from "@/lib/read-body"
import { listVisualPresets, mutateVisualPreset } from "@/lib/visual-preset-store"
import { visualPresetShapeSchema, type VisualPresetShape } from "@/lib/visual-presets"
import { createLogger } from "@/lib/logger"

const log = createLogger("visual-presets")

async function handle(req: NextRequest, operation?: "save" | "delete") {
  const rl = await rateLimit(rateLimitKey(req), "presets")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const user = getScopedUserId(extractUserParam(req))
  if (isMultiUserEnabled() && !user) return invalidUserResponse()
  if (user ? !await checkUserAuth(req, user) : !checkAdminToken(req)) return user ? userAuthResponse() : adminAuthResponse()
  if (operation && !isSameOrigin(req)) return originMismatchResponse()
  try {
    if (!operation) {
      // Legacy GET without `shape` reads the portrait list only.
      const rawShape = req.nextUrl.searchParams.get("shape")
      let shape: VisualPresetShape = "portrait"
      if (rawShape !== null) {
        const parsed = visualPresetShapeSchema.safeParse(rawShape)
        if (!parsed.success) return Response.json({ error: "Invalid shape" }, { status: 400 })
        shape = parsed.data
      }
      return Response.json({ presets: await listVisualPresets(user, shape) }, { headers: { "Cache-Control": "no-store" } })
    }
    const presets = await mutateVisualPreset(user, operation, await readJsonBody(req, 16 * 1024))
    return Response.json({ presets }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof ZodError || error instanceof InvalidJsonBodyError) return Response.json({ error: "Invalid preset" }, { status: 400 })
    if (error instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    if (error instanceof Error && error.message === "Preset limit reached") return Response.json({ error: error.message }, { status: 409 })
    log.error("Preset storage failed", { error: error instanceof Error ? error.message : String(error) })
    return Response.json({ error: "Preset storage unavailable" }, { status: 500 })
  }
}

export const GET = (req: NextRequest) => handle(req)
export const POST = (req: NextRequest) => handle(req, "save")
export const DELETE = (req: NextRequest) => handle(req, "delete")
