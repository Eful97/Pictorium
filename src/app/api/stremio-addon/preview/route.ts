import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { fetchAddonCatalogPage } from "@/lib/stremio-addon-server"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { normalizeManifestUrl } from "@/lib/stremio-addon"

/** Anteprima dei primi titoli di un catalogo addon (UI import). */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "default")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const url = req.nextUrl.searchParams.get("url")?.trim() || ""
  const catalogId = req.nextUrl.searchParams.get("catalogId")?.trim() || ""
  const type = (req.nextUrl.searchParams.get("type")?.trim() || "").toLowerCase()
  if (!url || !catalogId || (type !== "movie" && type !== "series")) {
    return Response.json({ error: "Missing url/catalogId/type" }, { status: 400 })
  }
  const normalized = normalizeManifestUrl(url)
  if (!normalized) return Response.json({ error: "invalid_url" }, { status: 400 })
  const origin = getOriginFromRequest(req)
  const page = await fetchAddonCatalogPage(normalized, type, catalogId, {}, origin, "preview")
  if ("error" in page && page.error) {
    return Response.json({ error: page.error, items: [] }, { status: 502 })
  }
  const items = ("items" in page ? page.items : []).slice(0, 3).map((m) => ({
    id: typeof m.id === "string" ? m.id : "",
    title: typeof m.name === "string" && m.name ? m.name : typeof m.title === "string" ? m.title : "",
  }))
  return Response.json({ items, total: ("items" in page ? page.items.length : 0) })
}
