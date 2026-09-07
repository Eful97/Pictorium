"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Film, Calendar, Star } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"

interface PreviewVideo {
  id: string
  name: string
  season: number
  episode: number
  overview?: string
  thumbnail?: string
  released?: string
  rating?: string
}

interface PreviewSeason {
  season: number
  name: string
  overview?: string
  episodes: PreviewVideo[]
}

interface PreviewPayload {
  videos: PreviewVideo[]
  seasons: PreviewSeason[]
  totalEpisodes: number
  totalSeasons: number
  autoDefault?: { groupId: string; name: string } | null
}

export function EpisodePreview() {
  const selected = usePSelector((v) => v.selected)
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const tvdbApiKey = usePSelector((v) => v.tvdbApiKey)
  const ed = usePosterEditor()

  const [data, setData] = useState<PreviewPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const episodeGroupId = ed.episodeGroupId

  useEffect(() => {
    if (!selected || selected.media_type !== "tv") {
      setData(null)
      return
    }
    let active = true
    setLoading(true)
    setError(null)

    const params = new URLSearchParams({
      tmdbId: String(selected.id),
      lang: "it-IT",
    })
    if (episodeGroupId && episodeGroupId !== "standard") {
      params.set("episodeGroupId", episodeGroupId)
    } else if (episodeGroupId === "standard") {
      // "standard" esplicito: disattiva il default automatico Parts
      params.set("episodeGroupId", "standard")
    }
    // episodeGroupId null = nessuna scelta: parametro omesso → il server
    // applica il default automatico Parts quando rilevato (meta-handler sync)
    if (tvdbApiKey) params.set("tvdb_key", tvdbApiKey)
    // per l'anteprima TVDB mostra sempre thumbnail TVDB se disponibile
    if (episodeGroupId === "tvdb" || episodeGroupId?.startsWith("tvdb:")) params.set("source", "tvdb")

    fetch(`/api/preview/episodes?${params.toString()}`, {
      headers: tmdbKey ? { "x-api-key": tmdbKey } : undefined,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json) => {
        if (!active) return
        setData(json)
        setExpanded(new Set())
      })
      .catch((e) => {
        if (!active) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selected is object identity, we want id+type
  }, [selected?.id, selected?.media_type, episodeGroupId, tmdbKey, tvdbApiKey])

  if (!selected || selected.media_type !== "tv") return null

  const toggle = (season: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(season)) next.delete(season)
      else next.add(season)
      return next
    })
  }

  return (
    <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-zinc-200 flex items-center gap-1.5 text-xs">
          <Film className="w-3.5 h-3.5 text-accent-orange" />
          Anteprima Stagioni & Episodi
        </span>
        {!loading && data && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-300 border border-white/10">
            {data.totalSeasons} stagioni · {data.totalEpisodes} ep
          </span>
        )}
      </div>

      {!loading && !error && data?.autoDefault && (
        <div className="rounded-lg bg-accent-orange/10 border border-accent-orange/30 px-3 py-2">
          <p className="text-[11px] text-zinc-200">✨ Default automatico: <span className="font-semibold">{data.autoDefault.name}</span> — lo stesso ordinamento che vedrà Stremio senza salvare nulla.</p>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg skeleton-shimmer" />
          ))}
          <p className="text-[11px] text-zinc-500 text-center py-1">Carico episodi da {(episodeGroupId === "tvdb" || episodeGroupId?.startsWith("tvdb:")) ? "TheTVDB" : "TMDB"}…</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
          <p className="text-[11px] text-red-300">Errore anteprima: {error}</p>
        </div>
      )}

      {(episodeGroupId === "tvdb" || episodeGroupId?.startsWith("tvdb:")) && !tvdbApiKey && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <p className="text-[11px] text-amber-300">⚠️ Chiave TVDB mancante — inseriscila in Impostazioni. Anteprima in fallback su Standard TMDB.</p>
        </div>
      )}

      {!loading && !error && data && data.seasons.length === 0 && (
        <p className="text-[11px] text-zinc-500 text-center py-4 italic">Nessun episodio disponibile per questa configurazione.</p>
      )}

      {!loading && !error && data && data.seasons.length > 0 && (
        <div className="space-y-2 max-h-[420px] overflow-y-auto scrollbar-none pr-1">
          {data.seasons.map((season) => {
            const isExpanded = expanded.has(season.season)
            return (
              <div key={season.season} className="rounded-lg border border-white/10 bg-white/[0.04] overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggle(season.season)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />}
                    <div className="flex flex-col min-w-0">
                      <span className="text-[12px] font-semibold text-zinc-100 truncate">
                        {season.season === 0 ? "Specials" : season.name} <span className="font-normal text-zinc-400">· S{season.season}</span>
                      </span>
                      {season.overview && <span className="text-[10px] text-zinc-500 truncate max-w-[220px]">{season.overview}</span>}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface2/60 text-zinc-300 border border-white/10 shrink-0 ml-2">
                    {season.episodes.length} ep
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-white/10 divide-y divide-white/[0.06] bg-black/20">
                    {season.episodes.map((ep) => (
                      <div key={ep.id} className="flex gap-2.5 px-3 py-2">
                        <div className="w-14 h-8 rounded-md overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
                          {ep.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={ep.thumbnail} alt={ep.name} className="w-full h-full object-cover" loading="lazy" />
                          ) : (
                            <Film className="w-3.5 h-3.5 text-zinc-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-zinc-100 truncate">
                            <span className="font-mono text-zinc-400 mr-1">S{ep.season}:E{ep.episode}</span>
                            {ep.name}
                          </p>
                          {ep.overview && <p className="text-[10px] text-zinc-400 line-clamp-2 leading-tight mt-0.5">{ep.overview}</p>}
                          <div className="flex items-center gap-2 mt-1">
                            {ep.released && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
                                <Calendar className="w-3 h-3" />
                                {ep.released.slice(0, 10)}
                              </span>
                            )}
                            {ep.rating && (
                              <span className="inline-flex items-center gap-1 text-[10px] text-amber-300">
                                <Star className="w-3 h-3 fill-amber-300 stroke-amber-300" />
                                {ep.rating}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[10px] text-zinc-500 leading-relaxed">
        È la stessa lista che Stremio riceverà su <span className="font-mono text-zinc-400">/meta/series/{selected?.id}.json</span>. Cambia l&apos;ordinamento sopra e verifica qui prima di salvare.
      </p>
    </div>
  )
}
