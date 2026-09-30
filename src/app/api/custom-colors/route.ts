import { NextRequest } from "next/server"
import { sampleCustomImageColors } from "@/lib/custom-colors"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { jsonGzip } from "@/lib/json-response"
import { isAllowedResolveHost } from "@/lib/resolve-image"
import { hashKey } from "@/lib/poster-render-helpers"
import type { CustomImageColors } from "@/lib/custom-colors"

const COLORS_TTL_MS = 24 * 60 * 60 * 1000

/**
 * GET /api/custom-colors?url=<http(s)>&genre=<genere>
 * Accent/top/bottom per una base custom (stessi byte e stesse funzioni del
 * render server). Il client non può leggerli dal canvas (taint cross-origin
 * silente → colori stale). Solo host allowlist + check SSRF del percorso
 * custom; niente segreti in cache-key (l'URL è pubblico).
 */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "resolve-image")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const rawUrl = (req.nextUrl.searchParams.get("url") || "").trim()
  const genre = (req.nextUrl.searchParams.get("genre") || "").trim().slice(0, 60)
  let host: string
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return Response.json({ error: "Only HTTP/HTTPS URLs allowed" }, { status: 400 })
    }
    host = parsed.hostname
  } catch {
    return Response.json({ error: "Invalid url" }, { status: 400 })
  }
  if (!isAllowedResolveHost(host)) {
    return Response.json({ error: "Host not in the image-source allowlist" }, { status: 403 })
  }
  const cacheKey = `custom-colors:${hashKey(rawUrl)}:${genre}`
  const acceptEncoding = req.headers.get("accept-encoding")
  const cached = cacheGet<CustomImageColors>(cacheKey)
  if (cached) return jsonGzip(cached, 200, undefined, acceptEncoding)
  // Niente catch-and-cache: un fallimento non diventa un colore congelato.
  const colors = await sampleCustomImageColors(rawUrl, genre, req.signal).catch(() => null)
  if (!colors) {
    return jsonGzip({ error: "Custom image colors unavailable" }, 502, undefined, acceptEncoding)
  }
  cacheSet(cacheKey, colors, ["custom-colors"], COLORS_TTL_MS)
  return jsonGzip(colors, 200, undefined, acceptEncoding)
}
