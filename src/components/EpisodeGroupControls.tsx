"use client"

import { useState, useEffect } from "react"
import { ListOrdered, Check, Save } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { http } from "@/lib/http"
import { EpisodePreview } from "@/components/EpisodePreview"

export function EpisodeGroupControls() {
  const { t } = useT()
  const selected = usePSelector((v) => v.selected)
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const tvdbApiKey = usePSelector((v) => v.tvdbApiKey)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const loadMappings = usePSelector((v) => v.loadMappings)
  const previewPoster = usePSelector((v) => v.previewPoster)
  const posters = usePSelector((v) => v.posters)
  const saveConfig = usePSelector((v) => v.saveConfig)
  const ed = usePosterEditor()

  const [epGroups, setEpGroups] = useState<{ id: string; name: string; group_count: number; episode_count: number }[]>([])
  const [tvdbSeasonTypes, setTvdbSeasonTypes] = useState<{ type: string; name: string; alternateName?: string | null }[]>([])
  const [tvdbLoading, setTvdbLoading] = useState(false)
  const [tvdbError, setTvdbError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!selected || selected.media_type !== "tv") {
      setEpGroups([])
      return
    }
    let active = true
    fetch(`/api/tmdb/${selected.id}/episode_groups`, {
      headers: tmdbKey ? { "x-api-key": tmdbKey } : undefined,
    })
      .then((res) => res.json())
      .then((data) => {
        if (active) {
          const raw: { id: string; name: string; group_count: number; episode_count: number }[] = data.results || []
          // Nasconde gruppi vuoti (Re:ZERO ne ha 2 con 0 episodi: Director's Cut, Orden en Crunchyroll)
          // che altrimenti appaiono selezionabili ma producono fallback a stagioni standard
          // e danno l'impressione che "cambiando ordinamento non cambia nulla".
          const filtered = raw.filter((g) => g.episode_count > 0 && g.group_count > 0)
          setEpGroups(filtered.length > 0 ? filtered : raw)
        }
      })
      .catch(() => {
        if (active) setEpGroups([])
      })
    return () => { active = false }
  }, [selected, tmdbKey])

  // TVDB seasonTypes per mostrare tutti gli ordinamenti (La Casa de Papel ha 2)
  // Campi primitivi per il deps array (stesso motivo di EditView): l'oggetto
  // `selected` cambia identità a ogni render del parent.
  const selectedId = selected?.id
  const selectedImdbId = selected?.imdb_id
  const selectedMediaType = selected?.media_type
  useEffect(() => {
    if (selectedMediaType !== "tv" || !tvdbApiKey) {
      setTvdbSeasonTypes([])
      setTvdbLoading(false)
      setTvdbError(null)
      return
    }
    let active = true
    setTvdbLoading(true)
    setTvdbError(null)
    // prova con imdb prima (più affidabile per TVDB), poi tmdbId
    const candidates = [selectedImdbId, String(selectedId)].filter(Boolean) as string[]
    const fetchOne = (id: string) =>
      fetch(`/api/tvdb/${encodeURIComponent(id)}/seasonTypes?tvdb_key=${encodeURIComponent(tvdbApiKey)}&tmdb_key=${encodeURIComponent(tmdbKey || "")}`, {
        headers: { "x-api-key": tvdbApiKey, "x-tmdb-key": tmdbKey || "" },
      })
        .then(async (r) => {
          const d = await r.json().catch(() => ({ results: [] }))
          if (d?.error && active) setTvdbError(String(d.error))
          return Array.isArray(d.results) ? d.results : []
        })
        .catch((e) => {
          if (active) setTvdbError(e instanceof Error ? e.message : String(e))
          return []
        })

    ;(async () => {
      for (const cid of candidates) {
        const res = await fetchOne(cid)
        if (active && res.length > 0) {
          setTvdbSeasonTypes(res)
          setTvdbLoading(false)
          return
        }
      }
      if (active) {
        setTvdbSeasonTypes([])
        setTvdbLoading(false)
        // NB: l'errore eventualmente impostato da fetchOne resta — il vecchio
        // `if (!tvdbError) setTvdbError(null)` leggeva la stale closure del
        // render corrente (sempre null) e cancellava l'errore appena settato.
      }
    })()
    return () => { active = false }
  }, [selectedId, selectedImdbId, selectedMediaType, tvdbApiKey, tmdbKey])

  // Reset "saved" feedback after 2s
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(t)
  }, [saved])

  if (!selected || selected.media_type !== "tv") return null

  const handleSaveEpisodeGroup = async () => {
    if (!selected) return
    if ((ed.episodeGroupId === "tvdb" || ed.episodeGroupId?.startsWith("tvdb:")) && !tvdbApiKey) {
      const { toast } = await import("sonner")
      toast(t("ui.epKeyMissingToast"))
      return
    }

    setSaving(true)
    try {
      const key = `${selected.media_type}:${selected.id}`
      const existing = mappingsMap.get(key)

      if (existing) {
        // Aggiorna solo episodeGroupId sul mapping esistente (mantiene poster clean + logo)
        await http(`/api/mappings/${key}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...existing,
            episodeGroupId: ed.episodeGroupId || null,
          }),
        })
        await loadMappings()
      } else {
        // Nessun mapping precedente: usa il flusso completo di saveConfig
        // per preservare copertina clean + auto-logo best-fit (evita bug "non clean senza logo")
        if (previewPoster) {
          await saveConfig()
        } else {
          // Fallback se previewPoster non è ancora pronto: scegli il miglior clean
          const cleanPoster = posters.find((p) => p.iso_639_1 === null) || posters[0]
          const fallbackPath = cleanPoster?.file_path || selected.poster_path || null
          const fallbackLang = (cleanPoster?.iso_639_1 as string | null) ?? null
          await http("/api/mappings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tmdbId: selected.id,
              mediaType: selected.media_type,
              title: selected.name || selected.title || "",
              posterPath: fallbackPath,
              logoPath: null,
              originalPosterPath: selected.poster_path || null,
              language: fallbackLang,
              episodeGroupId: ed.episodeGroupId || null,
            }),
          })
          await loadMappings()
        }
      }

      setSaved(true)
      const { toast } = await import("sonner")
      toast(t("ui.epOrderSaved"))
    } catch {
      const { toast } = await import("sonner")
      toast(t("ui.saveError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3.5 text-xs">
      <div className="bg-surface/50 border border-surface2/60 rounded-xl p-3 space-y-2.5 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <ListOrdered className="w-3.5 h-3.5 text-accent-orange" />
            <span>{t("ui.epOrderTitle")}</span>
          </span>
          {epGroups.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-orange/15 text-accent-orange border border-accent-orange/30">
              {t("ui.groupCount", { count: epGroups.length })}
            </span>
          )}
        </div>

        <p className="text-[11px] text-zinc-400">
          {t("ui.epOrderIntro")}
        </p>

        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => ed.setEpisodeGroupId(null)}
            className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] border transition-all flex items-center justify-between cursor-pointer ${
              !ed.episodeGroupId
                ? "bg-accent-orange/15 text-white border-accent-orange/40 font-semibold"
                : "bg-surface2/40 text-zinc-300 border-surface2 hover:bg-surface2 hover:text-white"
            }`}
          >
            <div className="flex flex-col">
              <span>{t("ui.epAuto")}</span>
              <span className="text-[10px] text-zinc-400">{t("ui.epAutoDesc")}</span>
            </div>
            {!ed.episodeGroupId && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
          </button>

          <button
            type="button"
            onClick={() => ed.setEpisodeGroupId("standard")}
            className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] border transition-all flex items-center justify-between cursor-pointer ${
              ed.episodeGroupId === "standard"
                ? "bg-accent-orange/15 text-white border-accent-orange/40 font-semibold"
                : "bg-surface2/40 text-zinc-300 border-surface2 hover:bg-surface2 hover:text-white"
            }`}
          >
            <div className="flex flex-col">
              <span>{t("ui.epStandard")}</span>
              <span className="text-[10px] text-zinc-400">{t("ui.epStandardDesc")}</span>
            </div>
            {ed.episodeGroupId === "standard" && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
          </button>

          {!tvdbApiKey ? (
            <button
              type="button"
              disabled
              title={t("ui.tvdbKeyRequired")}
              className="w-full text-left px-2.5 py-2 rounded-lg text-[11px] border bg-surface2/20 text-zinc-500 border-white/5 opacity-50 cursor-not-allowed flex items-center justify-between"
            >
              <div className="flex flex-col">
                <span>🗄️ TheTVDB</span>
                <span className="text-[10px] text-zinc-400">{t("ui.tvdbKeyRequired")}</span>
              </div>
            </button>
          ) : tvdbLoading ? (
            <button
              type="button"
              disabled
              className="w-full text-left px-2.5 py-2 rounded-lg text-[11px] border bg-surface2/40 text-zinc-400 border-surface2 flex items-center justify-between cursor-wait"
            >
              <div className="flex flex-col">
                <span>🗄️ TheTVDB</span>
                <span className="text-[10px] text-zinc-400">{t("ui.tvdbLoading")}</span>
              </div>
              <span className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin shrink-0" />
            </button>
          ) : tvdbSeasonTypes.length === 0 ? (
            <div className="w-full text-left px-2.5 py-2 rounded-lg text-[11px] border bg-surface2/20 text-zinc-400 border-white/5">
              <div className="flex flex-col">
                <span>{t("ui.tvdbNoTypes")}</span>
                <span className="text-[10px] text-zinc-500">{tvdbError ? t("ui.statusError", { msg: tvdbError }) : t("ui.tvdbNoTypesDesc")}</span>
              </div>
            </div>
          ) : (
            tvdbSeasonTypes.map((st) => {
              const sentinel = `tvdb:${st.type}`
              const isSelected =
                ed.episodeGroupId === sentinel ||
                (ed.episodeGroupId === "tvdb" && (st.type === "default" || st.type === "official")) ||
                (ed.episodeGroupId === "tvdb:default" && st.type === "official") ||
                (ed.episodeGroupId === "tvdb:official" && st.type === "default")
              const label = st.alternateName
                ? `${st.name} (${st.alternateName})`
                : (st.name.toLowerCase() === st.type.toLowerCase() ? st.name : `${st.name} (${st.type})`)
              return (
                <button
                  type="button"
                  key={st.type}
                  onClick={() => ed.setEpisodeGroupId(sentinel)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] border transition-all flex items-center justify-between cursor-pointer ${
                    isSelected ? "bg-accent-orange/15 text-white border-accent-orange/40 font-semibold" : "bg-surface2/40 text-zinc-300 border-surface2 hover:bg-surface2 hover:text-white"
                  }`}
                >
                  <div className="flex flex-col">
                    <span>🗄️ TheTVDB — {label}</span>
                    <span className="text-[10px] text-zinc-400">{t("ui.tvdbOrder", { type: st.type })}</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
                </button>
              )
            })
          )}

          <button
            type="button"
            onClick={() => ed.setEpisodeGroupId("anizip")}
            className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] border transition-all flex items-center justify-between cursor-pointer ${
              ed.episodeGroupId === "anizip"
                ? "bg-accent-orange/15 text-white border-accent-orange/40 font-semibold"
                : "bg-surface2/40 text-zinc-300 border-surface2 hover:bg-surface2 hover:text-white"
            }`}
          >
            <div className="flex flex-col">
              <span>{t("ui.anizip")}</span>
              <span className="text-[10px] text-zinc-400">{t("ui.anizipDesc")}</span>
            </div>
            {ed.episodeGroupId === "anizip" && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
          </button>

          {epGroups.map((g) => {
            const isSelected = ed.episodeGroupId === g.id
            return (
              <button
                type="button"
                key={g.id}
                onClick={() => ed.setEpisodeGroupId(g.id)}
                className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] border transition-all flex items-center justify-between cursor-pointer ${
                  isSelected
                    ? "bg-accent-orange/15 text-white border-accent-orange/40 font-semibold"
                    : "bg-surface2/40 text-zinc-300 border-surface2 hover:bg-surface2 hover:text-white"
                }`}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{g.name}</span>
                  <span className="text-[10px] text-zinc-400">{t("ui.partsCount", { count: g.group_count })} · {t("ui.episodesCount", { count: g.episode_count })}</span>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0" />}
              </button>
            )
          })}

          {epGroups.length === 0 && (
            <p className="text-[11px] text-zinc-500 text-center py-2 italic">
              {t("ui.epNoGroups")}
            </p>
          )}
        </div>

        {/* Bottone Salva dedicato */}
        <button
          type="button"
          onClick={handleSaveEpisodeGroup}
          disabled={saving}
          className={`w-full mt-1 py-2 px-3 text-xs font-semibold rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 ${
            saved
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              : "btn-primary"
          }`}
        >
          {saved ? (
            <>
              <Check className="w-3.5 h-3.5" />
              {t("ui.saved")}
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              {saving ? t("ui.saving") : t("ui.epSaveOrder")}
            </>
          )}
        </button>
      </div>

      <EpisodePreview />
    </div>
  )
}
