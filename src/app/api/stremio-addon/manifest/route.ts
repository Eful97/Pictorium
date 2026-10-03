import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { fetchAddonManifest } from "@/lib/stremio-addon-server"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { addonCatalogIncompatibility, selectableAddonCatalogs } from "@/lib/stremio-addon"

export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const url = req.nextUrl.searchParams.get("url")?.trim() || ""
  if (!url) return Response.json({ error: "Missing url" }, { status: 400 })
  const origin = getOriginFromRequest(req)
  const result = await fetchAddonManifest(url, origin)
  if (result.error || !result.manifest) {
    const status = result.error === "private_url" ? 400 : result.error === "invalid_url" ? 400 : 502
    return Response.json({ error: result.error || "unavailable" }, { status })
  }
  const m = result.manifest
  const selectable = selectableAddonCatalogs(m)
  return Response.json({
    id: m.id,
    name: m.name,
    version: m.version,
    catalogs: selectable.map((c) => ({
      id: c.id,
      type: String(c.type).toLowerCase(),
      name: c.name || c.id,
      extra: c.extra || [],
      incompatible: addonCatalogIncompatibility(c),
    })),
    skipped: m.catalogs.length - selectable.length,
  })
}
