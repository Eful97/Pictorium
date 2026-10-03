import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { fetchAddonCatalogPage } from "@/lib/stremio-addon-server"
import { getOriginFromRequest } from "@/lib/poster-public-url"
import { normalizeManifestUrl, parseSupportedTmdbRef } from "@/lib/stremio-addon"
import { getDetails, tmdbFindByImdb, tmdbFindByTvdb, resolveRouteApiKey } from "@/lib/tmdb"

const FANOUT = 5

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

/** Griglia UI per cataloghi addon: pagina preservando ordine/ID originali. */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)
  const url = req.nextUrl.searchParams.get("url")?.trim() || ""
  const catalogId = req.nextUrl.searchParams.get("catalogId")?.trim() || ""
  const type = (req.nextUrl.searchParams.get("type")?.trim() || "").toLowerCase()
  const rawSkip = req.nextUrl.searchParams.get("skip")
  const skip = rawSkip === null ? 0 : Number(rawSkip)
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("limit") || "30", 10) || 30, 1), 100)
  if (!url || !catalogId || (type !== "movie" && type !== "series")) {
    return Response.json({ error: "Missing url/catalogId/type" }, { status: 400 })
  }
  if (rawSkip !== null && (!/^\d+$/.test(rawSkip) || !Number.isSafeInteger(skip) || skip > 1000)) {
    return Response.json({ error: "Invalid catalog page" }, { status: 400 })
  }
  const normalized = normalizeManifestUrl(url)
  if (!normalized) return Response.json({ error: "invalid_url" }, { status: 400 })
  const origin = getOriginFromRequest(req)
  const apiKey = await resolveRouteApiKey(req)
  // Finestra remota: la fonte pagina nativamente con skip; chiediamo la pagina richiesta.
  const page = await fetchAddonCatalogPage(
    normalized,
    type,
    catalogId,
    { ...(typeof skip === "number" && skip > 0 ? { skip } : {}) },
    origin,
    "ui",
  )
  if ("error" in page && page.error) {
    return Response.json({ items: [], status: "unavailable" })
  }
  const all = ("items" in page ? page.items : []) as Array<Record<string, unknown>>
  const window = all.slice(0, limit)
  const mediaType = type === "series" ? "tv" : "movie"
  const items = await mapLimit(window, FANOUT, async (raw) => {
    const rawId = typeof raw.id === "string" ? raw.id : ""
    const title = typeof raw.name === "string" && raw.name ? raw.name : typeof raw.title === "string" ? raw.title : ""
    const year = Number((raw as { year?: unknown }).year) || Number(String((raw as { releaseInfo?: unknown }).releaseInfo || "").slice(0, 4)) || 0
    let tmdbId: number | undefined
    let posterPath: string | null = null
    const ref = parseSupportedTmdbRef(rawId)
    if (ref?.kind === "tmdb") tmdbId = ref.tmdbId
    else if (ref?.kind === "imdb" && apiKey) {
      try {
        tmdbId = (await tmdbFindByImdb(ref.imdb, mediaType, apiKey)) || undefined
      } catch {
        tmdbId = undefined
      }
    } else if (ref?.kind === "tvdb" && apiKey) {
      try {
        tmdbId = (await tmdbFindByTvdb(ref.tvdb, mediaType, apiKey).catch(() => null)) || undefined
      } catch {
        tmdbId = undefined
      }
    }
    if (tmdbId && apiKey) {
      try {
        const d = await getDetails(mediaType, tmdbId, "it-IT", apiKey)
        posterPath = d?.poster_path || null
      } catch {
        posterPath = null
      }
    }
    // Fallback all'artwork originale quando l'arricchimento fallisce.
    const originalPoster = typeof raw.poster === "string" ? raw.poster : null
    return {
      id: tmdbId || rawId,
      tmdbId,
      media_type: type === "series" ? "tv" : "movie",
      title: title || rawId,
      name: title || rawId,
      poster_path: posterPath,
      poster: originalPoster,
      year,
    }
  })
  // La fonte pagina nativamente con skip, ma la sua pagina (fino a 100 voci)
  // può essere più larga della finestra UI: l'offset successivo avanza solo
  // degli elementi effettivamente restituiti, altrimenti le voci intermedie
  // (es. 30..49 con 50 remoti e limit=30) verrebbero saltate. Finestra piena
  // = potrebbero essercene altre; finestra corta = fonte esaurita.
  const nextOffset = items.length >= limit ? skip + items.length : null
  return Response.json({ items, total: null, nextOffset, status: "ok" })
}
