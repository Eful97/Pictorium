import { NextRequest } from "next/server"
import { rateLimit, rateLimitKey, rateLimitResponse } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/cache"
import { getTvdbSeasonTypes, getTvdbSeriesId } from "@/lib/tvdb"
import crypto from "node:crypto"

function hashFragment(v: string): string {
  return crypto.createHash("sha1").update(v).digest("hex").slice(0, 8)
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(rateLimitKey(req), "tmdb")
  if (!rl.ok) return rateLimitResponse(rl.retAfter)

  const { id } = await context.params
  const rawId = (id || "").trim()
  if (!rawId) return Response.json({ error: "Missing id" }, { status: 400 })

  const rawTvdbKey = req.headers.get("x-api-key") || req.headers.get("x-tvdb-key") || req.nextUrl.searchParams.get("tvdb_key") || process.env.PICTORIUM_TVDB_API_KEY || process.env.POSTERIUM_TVDB_API_KEY || process.env.TVDB_API_KEY || ""
  const tvdbKey = rawTvdbKey.trim()
  if (!tvdbKey) return Response.json({ results: [], error: "TVDB key missing — imposta in Impostazioni" }, { status: 200 })

  // tmdb key opzionale: permette di risolvere tvdb_id via TMDB external_ids (molto più affidabile di search/remoteid per id numerici)
  const tmdbKey = req.headers.get("x-tmdb-key") || req.nextUrl.searchParams.get("tmdb_key") || req.nextUrl.searchParams.get("api_key") || req.headers.get("x-api-key-tvdb") || process.env.PICTORIUM_TMDB_KEY || process.env.POSTERIUM_TMDB_KEY || ""
  const cacheKey = `tvdb:seasonTypes:raw${rawId}:ak${hashFragment(tvdbKey)}:tk${hashFragment(tmdbKey || "")}`
  const cached = cacheGet<{ results: { id: number; name: string; type: string; alternateName?: string | null }[]; tvdbId?: number | null }>(cacheKey)
  if (cached) return Response.json(cached, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=3600" } })

  try {
    let tvdbSeriesId: number | null = null
    const asNum = parseInt(rawId, 10)
    const isNumeric = String(asNum) === rawId && asNum > 0
    // 1) Se rawId è numerico, prova a risolvere tvdb_id via TMDB external_ids (via più affidabile)
    if (isNumeric) {
      try {
        const { getExternalIds } = await import("@/lib/tmdb")
        const ext = await getExternalIds("tv", asNum, tmdbKey.trim() || undefined)
        if (ext?.tvdb_id && ext.tvdb_id > 0) {
          tvdbSeriesId = ext.tvdb_id
        } else if (ext?.imdb_id) {
          tvdbSeriesId = await getTvdbSeriesId(ext.imdb_id, tvdbKey)
        }
      } catch {}
    }
    if (!tvdbSeriesId) {
      if (isNumeric) {
        tvdbSeriesId = await getTvdbSeriesId(rawId, tvdbKey)
        if (!tvdbSeriesId) {
          const trial = await getTvdbSeasonTypes(asNum, tvdbKey)
          if (trial.length > 0) {
            const body = { results: trial.map((t) => ({ id: t.id, name: t.name, type: t.type, alternateName: t.alternateName })), tvdbId: asNum }
            cacheSet(cacheKey, body, ["tvdb"], 24 * 60 * 60 * 1000)
            return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=3600" } })
          }
        }
      } else {
        tvdbSeriesId = await getTvdbSeriesId(rawId, tvdbKey)
      }
    }
    if (!tvdbSeriesId) {
      if (Number.isFinite(asNum) && asNum > 0) {
        const trial = await getTvdbSeasonTypes(asNum, tvdbKey)
        if (trial.length > 0) {
          const body = { results: trial.map((t) => ({ id: t.id, name: t.name, type: t.type, alternateName: t.alternateName })), tvdbId: asNum }
          cacheSet(cacheKey, body, ["tvdb"], 24 * 60 * 60 * 1000)
          return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=3600" } })
        }
      }
      // diagnostica: prova login per capire se chiave è invalida
      const { getTvdbToken } = await import("@/lib/tvdb")
      const token = await getTvdbToken(tvdbKey)
      if (!token) {
        return Response.json({ results: [], error: "TVDB login fallito — chiave non valida o rete down" }, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=60" } })
      }
      return Response.json({ results: [], error: `Nessuna serie TVDB per id ${rawId}` }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=600" } })
    }

    const types = await getTvdbSeasonTypes(tvdbSeriesId, tvdbKey)
    if (types.length === 0) {
      return Response.json({ results: [], tvdbId: tvdbSeriesId, error: `Nessun seasonType per serie ${tvdbSeriesId}` }, { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=600" } })
    }
    const body = { results: types.map((t) => ({ id: t.id, name: t.name, type: t.type, alternateName: t.alternateName })), tvdbId: tvdbSeriesId }
    cacheSet(cacheKey, body, ["tvdb"], 24 * 60 * 60 * 1000)
    return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=3600" } })
  } catch (e) {
    return Response.json({ results: [], error: e instanceof Error ? e.message : String(e) }, { status: 200 })
  }
}
