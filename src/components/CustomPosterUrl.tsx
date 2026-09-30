"use client"

import { useEffect, useState } from "react"
import { Link2, Loader2, Check, X, Trash2, FlaskConical } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { useT } from "@/lib/contexts/TranslationContext"
import { http, userFetch } from "@/lib/http"
import { normalizeGenreName } from "@/lib/genre-normalize"
import { toast } from "sonner"

interface ResolvedImage {
  imageUrl: string
  source: "direct" | "og:image"
  width?: number
  height?: number
}

type TestState = "idle" | "resolving" | "ok" | "error"

/**
 * Base poster da URL esterno (Pinterest/Imgur/Reddit) per il titolo
 * selezionato. Solo portrait: il landscape resta sul backdrop TMDB.
 *
 * Semantica save-only (come rotazione/esclusioni): Test verifica che l'URL
 * si risolva a un'immagine, Salva persiste `customPosterUrl` nel mapping, la
 * verifica visiva avviene nel modale "Testa URL Stremio" (meta fresca con mv
 * aggiornato). La preview live centrale non riflette i mapping salvati.
 */
export function CustomPosterUrl() {
  const selected = usePSelector((v) => v.selected)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const loadMappings = usePSelector((v) => v.loadMappings)
  const titleOf = usePSelector((v) => v.titleOf)
  const metaInfo = usePSelector((v) => v.metaInfo)
  const trendRank = usePSelector((v) => v.trendRank)
  const posterShape = usePosterEditor().posterShape
  const { t, lang } = useT()

  const key = selected ? `${selected.media_type}:${selected.id}` : null
  const hasMapping = key ? mappingsMap.has(key) : false
  const savedUrl = key ? (mappingsMap.get(key)?.customPosterUrl ?? null) : null

  const [input, setInput] = useState(savedUrl ?? "")
  const [testState, setTestState] = useState<TestState>("idle")
  const [resolved, setResolved] = useState<ResolvedImage | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Risincronizza quando cambia titolo o mapping (save da altre viste).
  useEffect(() => {
    setInput(savedUrl ?? "")
    setTestState("idle")
    setResolved(null)
    setTestError(null)
  }, [key, savedUrl])

  if (!selected || posterShape === "landscape") return null

  const handleTest = async () => {
    const url = input.trim()
    if (!url) return
    setTestState("resolving")
    setTestError(null)
    setResolved(null)
    try {
      const res = await userFetch(`/api/resolve-image?url=${encodeURIComponent(url)}`, { timeout: 25000 })
      const data = (await res.json()) as ResolvedImage & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setResolved({ imageUrl: data.imageUrl, source: data.source, width: data.width, height: data.height })
      setTestState("ok")
    } catch (e) {
      setTestError(e instanceof Error ? e.message : t("ui.customPosterError"))
      setTestState("error")
    }
  }

  const handleSave = async () => {
    if (!resolved || !selected || saving) return
    setSaving(true)
    try {
      if (hasMapping) {
        await http(`/api/mappings/${key!}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customPosterUrl: resolved.imageUrl }),
        })
      } else {
        if (!selected.poster_path) throw new Error(t("ui.customPosterError"))
        await http("/api/mappings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdbId: selected.id,
            mediaType: selected.media_type,
            title: titleOf(selected),
            posterPath: selected.poster_path,
            originalPosterPath: selected.poster_path,
            language: null,
            genreName: normalizeGenreName(metaInfo?.genres?.[0]?.name, lang) || null,
            voteAverage: metaInfo?.voteAverage || null,
            trendRank: trendRank ?? null,
            customPosterUrl: resolved.imageUrl,
          }),
        })
      }
      await loadMappings()
      setInput(resolved.imageUrl)
      setResolved(null)
      setTestState("idle")
      toast.success(t("ui.customPosterSaved"))
    } catch {
      toast.error(t("ui.saveError"))
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!key || saving) return
    setSaving(true)
    try {
      await http(`/api/mappings/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPosterUrl: null }),
      })
      await loadMappings()
      setInput("")
      setResolved(null)
      setTestState("idle")
      toast.success(t("ui.customPosterRemoved"))
    } catch {
      toast.error(t("ui.saveError"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3" data-testid="custom-poster-url">
      <div className="flex items-center gap-1.5 mb-2">
        <Link2 className="w-3.5 h-3.5 text-accent-orange" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-zinc-200">{t("ui.customPosterTitle")}</span>
        {savedUrl && (
          <span className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold">
            <Check className="w-3 h-3" aria-hidden="true" />
            {t("ui.customPosterActive")}
          </span>
        )}
      </div>
      <div className="flex gap-1.5">
        <input
          type="url"
          value={input}
          onChange={(e) => { setInput(e.target.value); setTestState("idle"); setResolved(null); setTestError(null) }}
          placeholder={t("ui.customPosterPh")}
          spellCheck={false}
          aria-label={t("ui.customPosterTitle")}
          className="min-w-0 flex-1 rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-accent-orange/60"
        />
        <button
          type="button"
          onClick={() => { void handleTest() }}
          disabled={!input.trim() || testState === "resolving"}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.07] border border-white/10 text-xs font-semibold text-zinc-200 hover:bg-white/[0.12] active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {testState === "resolving"
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            : <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />}
          {testState === "resolving" ? t("ui.customPosterResolving") : t("ui.customPosterTest")}
        </button>
      </div>
      {testState === "error" && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-red-300" role="alert">
          <X className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          {testError || t("ui.customPosterError")}
        </p>
      )}
      {testState === "ok" && resolved && (
        <div className="mt-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] p-2.5">
          <p className="text-[11px] text-emerald-200 break-all leading-snug">{resolved.imageUrl}</p>
          <p className="mt-1 text-[10px] text-zinc-400 tabular-nums">
            {resolved.width && resolved.height ? `${resolved.width}×${resolved.height} · ` : ""}{resolved.source}
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => { void handleSave() }}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-orange text-white text-xs font-semibold hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
              {t("ui.customPosterUse")}
            </button>
          </div>
        </div>
      )}
      {savedUrl && (
        <button
          type="button"
          onClick={() => { void handleRemove() }}
          disabled={saving}
          className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-red-300 transition-colors disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          {t("ui.customPosterRemove")}
        </button>
      )}
    </div>
  )
}
