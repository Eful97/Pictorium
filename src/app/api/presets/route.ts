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
import { slugifyPresetTag } from "@/lib/badge-preset"
import {
  listPublicPresets,
  listUserPresets,
  savePreset,
  PresetQuotaError,
  PresetValidationError,
  type PublicPresetSort,
} from "@/lib/badge-preset-store"
import { createLogger } from "@/lib/logger"

const log = createLogger("api-presets")

/** Body cap: il preset JSON non supera mai 16KB (quota store). */
const MAX_PRESET_BODY_BYTES = 32 * 1024

function resolveScope(req: NextRequest): { scoped: string | null; error?: Response } {
  const rawUser = extractUserParam(req)
  if (rawUser && isMultiUserEnabled() && !getScopedUserId(rawUser)) {
    return { scoped: null, error: invalidUserResponse() }
  }
  return { scoped: getScopedUserId(rawUser) }
}

export async function GET(req: NextRequest) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(
    error ? rateLimitKey(req) : scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req),
    "presets",
  )
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  const sp = req.nextUrl.searchParams

  // "My Presets": richiede namespace + auth (i privati non escono mai anonimi).
  if (sp.get("mine") === "1") {
    if (!scoped) return invalidUserResponse()
    if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
    const presets = await listUserPresets(scoped)
    return Response.json({ presets }, { headers: { "Cache-Control": "no-store" } })
  }

  // Catalogo pubblico: sort + filtri q/tag/target + paginazione a cursore.
  const sortParam = sp.get("sort") ?? "downloads"
  if (sortParam !== "downloads" && sortParam !== "newest") {
    return Response.json({ error: "Invalid sort (downloads|newest)" }, { status: 400 })
  }
  const sort = sortParam as PublicPresetSort
  const targetParam = sp.get("target")
  if (targetParam !== null && targetParam !== "top" && targetParam !== "genre") {
    return Response.json({ error: "Invalid target (top|genre)" }, { status: 400 })
  }
  const tagParam = sp.get("tag")
  const tag = tagParam === null ? null : slugifyPresetTag(tagParam)
  const q = (sp.get("q") ?? "").trim().toLowerCase().slice(0, 60)
  const rawLimit = sp.get("limit")
  const limit = rawLimit === null ? 24 : Math.min(Math.max(parseInt(rawLimit, 10) || 24, 1), 100)
  const rawCursor = sp.get("cursor")
  const cursor = rawCursor === null ? 0 : Math.max(parseInt(rawCursor, 10) || 0, 0)

  // I filtri si applicano sul ranking: si scorre finché non si raccolgono
  // `limit` match (cap anti-scan: 500 entry, poi si chiude la pagina).
  const items: Awaited<ReturnType<typeof listPublicPresets>>["items"] = []
  let nextCursor: number | null = cursor
  let scanned = 0
  while (items.length < limit && nextCursor !== null && scanned < 500) {
    const page = await listPublicPresets(sort, Math.min(50, limit - items.length + 10), nextCursor)
    scanned += 50
    for (const item of page.items) {
      if (targetParam && item.preset.target !== targetParam) continue
      if (tag && !item.preset.metadata.tags.includes(tag)) continue
      if (q) {
        const hay = `${item.preset.metadata.name} ${item.preset.metadata.description ?? ""}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      if (items.length < limit) items.push(item)
    }
    nextCursor = page.nextCursor
  }
  return Response.json(
    { items, nextCursor },
    { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } },
  )
}

export async function POST(req: NextRequest) {
  const { scoped, error } = resolveScope(req)
  const rl = await rateLimit(error ? rateLimitKey(req) : scoped ? userRateLimitKey(req, scoped) : rateLimitKey(req), "presets")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  if (error) return error
  // I preset sono sempre namespaced (ownerUuid obbligatorio): senza ?u= → 400.
  if (!scoped) return invalidUserResponse()
  if (!(await checkUserAuth(req, scoped))) return userAuthResponse()
  if (!isSameOrigin(req)) return originMismatchResponse()
  let body: unknown
  try {
    body = await readJsonBody(req, MAX_PRESET_BODY_BYTES)
  } catch (e) {
    if (e instanceof BodyTooLargeError) return Response.json({ error: "Request body too large" }, { status: 413 })
    if (e instanceof InvalidJsonBodyError) return Response.json({ error: "Invalid JSON body" }, { status: 400 })
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  try {
    const stored = await savePreset(
      scoped,
      body as Parameters<typeof savePreset>[1],
    )
    return Response.json(stored, { status: 201 })
  } catch (e) {
    if (e instanceof PresetQuotaError) return Response.json({ error: e.message }, { status: 413 })
    if (e instanceof PresetValidationError) return Response.json({ error: e.message }, { status: 400 })
    if (e instanceof ZodError) return Response.json({ error: "Validation failed", details: e.flatten() }, { status: 400 })
    log.error("Preset save failed", { error: e instanceof Error ? e.message : String(e) })
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }
}
