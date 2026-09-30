"use client"

import { useEffect, useState } from "react"
import { Link2, Loader2, Check, X, Trash2, Plus } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { useT } from "@/lib/contexts/TranslationContext"
import { userFetch } from "@/lib/http"
import { toast } from "sonner"

interface ResolvedImage {
  imageUrl: string
  source: "direct" | "og:image"
  width?: number
  height?: number
}

interface Props {
  /** Chiamato con l'URL diretto risolto: il parent aggiunge il tile in griglia. */
  onAdd: (image: { url: string; width: number; height: number }) => void
  /** Chiamato dopo la rimozione del custom salvato: il parent pulisce i tile. */
  onRemove: () => void
  /** Abilita modalità collassabile con pulsante apri/chiudi (default false). */
  collapsible?: boolean
  /** Stato aperto iniziale quando collapsible=true (default false). */
  defaultOpen?: boolean
}

/**
 * Base poster da URL esterno (Pinterest/Imgur/Reddit) per il titolo
 * selezionato. Solo portrait: il landscape resta sul backdrop TMDB.
 *
 * Semantica add-only: "Aggiungi" risolve l'URL e aggiunge subito il tile in
 * griglia (selezionato). Il salvataggio resta sul bottone Salva principale
 * (congela `customPosterUrl` nel mapping); la verifica visiva è live nella
 * preview centrale. La rimozione cancella il custom salvato.
 */
export function CustomPosterUrl({ onAdd, onRemove, collapsible = false, defaultOpen = false }: Props) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const selected = usePSelector((v) => v.selected)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const loadMappings = usePSelector((v) => v.loadMappings)
  const posterShape = usePosterEditor().posterShape
  const { t } = useT()

  const key = selected ? `${selected.media_type}:${selected.id}` : null
  const savedUrl = key ? (mappingsMap.get(key)?.customPosterUrl ?? null) : null

  const [input, setInput] = useState("")
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  // Pulisci l'input al cambio titolo (i tile di sessione vivono nel parent).
  useEffect(() => {
    setInput("")
    setError(null)
  }, [key])

  if (!selected || posterShape === "landscape") return null

  const handleAdd = async () => {
    const url = input.trim()
    if (!url || resolving) return
    setResolving(true)
    setError(null)
    try {
      const res = await userFetch(`/api/resolve-image?url=${encodeURIComponent(url)}`, { timeout: 25000 })
      const data = (await res.json()) as ResolvedImage & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setInput("")
      onAdd({ url: data.imageUrl, width: data.width ?? 0, height: data.height ?? 0 })
      toast.success(t("ui.customPosterAdded"))
    } catch (e) {
      setError(e instanceof Error ? e.message : t("ui.customPosterError"))
    } finally {
      setResolving(false)
    }
  }

  const handleRemove = async () => {
    if (!key || removing) return
    setRemoving(true)
    try {
      const { http } = await import("@/lib/http")
      await http(`/api/mappings/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customPosterUrl: null }),
      })
      await loadMappings()
      onRemove()
      toast.success(t("ui.customPosterRemoved"))
    } catch {
      toast.error(t("ui.saveError"))
    } finally {
      setRemoving(false)
    }
  }

  if (collapsible && !isOpen) {
    return (
      <div className="mt-2 mb-3" data-testid="custom-poster-url">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label={t("ui.customPosterTitle")}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-xs font-medium text-zinc-300 hover:text-white transition-all cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5 text-accent-orange group-hover:scale-110 transition-transform" aria-hidden="true" />
            <span className="text-[11px] font-semibold">{t("ui.customPosterTitle")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {savedUrl && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold">
                <Check className="w-3 h-3" aria-hidden="true" />
                {t("ui.customPosterActive")}
              </span>
            )}
            <Plus className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200" aria-hidden="true" />
          </div>
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2 mb-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 animate-fade-in" data-testid="custom-poster-url">
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <div className="flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-accent-orange" aria-hidden="true" />
          <span className="text-[11px] font-semibold text-zinc-200">{t("ui.customPosterTitle")}</span>
        </div>
        <div className="flex items-center gap-2">
          {savedUrl && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold">
              <Check className="w-3 h-3" aria-hidden="true" />
              {t("ui.customPosterActive")}
            </span>
          )}
          {collapsible && (
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label={t("ui.cancel") || "Chiudi"}
              className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-1.5">
        <input
          type="url"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAdd() } }}
          placeholder={t("ui.customPosterPh")}
          spellCheck={false}
          aria-label={t("ui.customPosterTitle")}
          className="min-w-0 flex-1 rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-accent-orange/60"
        />
        <button
          type="button"
          onClick={() => { void handleAdd() }}
          disabled={!input.trim() || resolving}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-orange text-white text-xs font-semibold hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {resolving
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            : <Plus className="w-3.5 h-3.5" aria-hidden="true" />}
          {resolving ? t("ui.customPosterResolving") : t("ui.customPosterAdd")}
        </button>
      </div>
      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-red-300" role="alert">
          <X className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          {error}
        </p>
      )}
      {savedUrl && (
        <button
          type="button"
          onClick={() => { void handleRemove() }}
          disabled={removing}
          className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-red-300 transition-colors disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          {t("ui.customPosterRemove")}
        </button>
      )}
    </div>
  )
}
