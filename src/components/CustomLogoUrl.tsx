"use client"

import { useEffect, useRef, useState } from "react"
import { Link2, Loader2, Check, X, Trash2, Plus } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { userFetch } from "@/lib/http"
import { isCustomPosterUrl } from "@/lib/utils"
import { toast } from "sonner"

interface ResolvedImage {
  imageUrl: string
  source: "direct" | "og:image"
  width?: number
  height?: number
}

interface Props {
  /** Called with the resolved direct URL: the parent appends the grid tile. */
  onAdd: (image: { url: string; width: number; height: number }) => void
  /** Called with the removed saved URL: the parent clears tiles and falls back. */
  onRemove: (removedUrl: string) => void
  /** Enables collapsible mode with an open/close toggle (default false). */
  collapsible?: boolean
  /** Initial open state when collapsible=true (default false). */
  defaultOpen?: boolean
  /** Mirrors the logo grid disabled state so the import box never bypasses it. */
  disabled?: boolean
}

/**
 * Logo from an external URL (same allowlist policy as the custom base:
 * Pinterest/Imgur/Reddit/Postimages + direct TPDb asset links /api/assets/<id>/view —
 * resolved via /api/resolve-image, raster-only, no SVG).
 *
 * Add-only semantics like CustomPosterUrl: "Add" resolves the URL and
 * immediately appends the tile to the grid (selected). Saving stays on the
 * main Save button (freezes `logoPath` into the mapping); visual verification
 * is live in the central preview. Removal clears the saved custom logo.
 *
 * Anti-stale: every resolve carries a monotonically increasing id bound to the
 * current title; only the latest resolve for the open title applies `onAdd`
 * (older resolves, title changes, or unmount are ignored). Editing the input
 * while a resolve is in flight invalidates that request, so a late response
 * can neither select the obsolete URL nor wipe the newer input.
 */
export function CustomLogoUrl({ onAdd, onRemove, collapsible = false, defaultOpen = false, disabled = false }: Props) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const selected = usePSelector((v) => v.selected)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const loadMappings = usePSelector((v) => v.loadMappings)
  const { t: tt } = useT()

  const key = selected ? `${selected.media_type}:${selected.id}` : null
  const savedLogoPath = key ? (mappingsMap.get(key)?.logoPath ?? null) : null
  const savedUrl = savedLogoPath && isCustomPosterUrl(savedLogoPath) ? savedLogoPath : null

  const [input, setInput] = useState("")
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)

  // Anti-stale generation: bumped on every title change; resolves from
  // previous generations never apply onAdd/onRemove.
  const generationRef = useRef(0)
  const requestRef = useRef(0)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Clear the input on title change (session tiles live in the parent).
  useEffect(() => {
    generationRef.current += 1
    setInput("")
    setError(null)
    setResolving(false)
  }, [key])

  if (!selected) return null

  const handleInputChange = (value: string) => {
    setInput(value)
    setError(null)
    // Editing while a resolve is in flight invalidates it: the pending
    // response must neither select the now-obsolete URL nor clear this newer
    // input. The late response hits the request-id guard below and is dropped.
    if (resolving) {
      requestRef.current += 1
      setResolving(false)
    }
  }

  const handleAdd = async () => {
    const url = input.trim()
    if (!url || resolving || disabled) return
    const generation = generationRef.current
    const requestId = ++requestRef.current
    const submittedUrl = url
    setResolving(true)
    setError(null)
    try {
      const res = await userFetch(`/api/resolve-image?url=${encodeURIComponent(url)}`, { timeout: 25000 })
      const data = (await res.json()) as ResolvedImage & { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      // Only the latest resolve of the current generation applies the
      // selection: slow responses superseded by newer requests or by a title
      // change are dropped (never a stale selection).
      if (!mountedRef.current || generation !== generationRef.current || requestId !== requestRef.current) return
      // Clear the field only when it still holds the submitted URL: an edit
      // made in the gap before this continuation ran must survive.
      setInput((prev) => (prev.trim() === submittedUrl ? "" : prev))
      onAdd({ url: data.imageUrl, width: data.width ?? 0, height: data.height ?? 0 })
      toast.success(tt("ui.customLogoAdded"))
    } catch (e) {
      if (!mountedRef.current || generation !== generationRef.current || requestId !== requestRef.current) return
      setError(e instanceof Error ? e.message : tt("ui.customLogoError"))
    } finally {
      if (mountedRef.current && generation === generationRef.current && requestId === requestRef.current) {
        setResolving(false)
      }
    }
  }

  const handleRemove = async () => {
    if (!key || removing || disabled) return
    const removeKey = key
    const removedUrl = savedUrl
    if (!removedUrl) return
    const generation = generationRef.current
    setRemoving(true)
    try {
      const { http } = await import("@/lib/http")
      await http(`/api/mappings/${removeKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoPath: null }),
      })
      await loadMappings()
      // The title may have changed (or the component unmounted) while the
      // requests were in flight: never clear the *current* title's logo with
      // a stale completion.
      if (!mountedRef.current || generation !== generationRef.current) return
      onRemove(removedUrl)
      toast.success(tt("ui.customLogoRemoved"))
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return
      toast.error(tt("ui.saveError"))
    } finally {
      if (mountedRef.current) setRemoving(false)
    }
  }

  if (collapsible && !isOpen) {
    return (
      <div className="mt-2 mb-3" data-testid="custom-logo-url">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label={tt("ui.customLogoTitle")}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-xs font-medium text-zinc-300 hover:text-white transition-all cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <Link2 className="w-3.5 h-3.5 text-accent-orange group-hover:scale-110 transition-transform" aria-hidden="true" />
            <span className="text-[11px] font-semibold">{tt("ui.customLogoTitle")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {savedUrl && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold">
                <Check className="w-3 h-3" aria-hidden="true" />
                {tt("ui.customLogoActive")}
              </span>
            )}
            <Plus className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-200" aria-hidden="true" />
          </div>
        </button>
      </div>
    )
  }

  return (
    <div className="mt-2 mb-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 animate-fade-in" data-testid="custom-logo-url">
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <div className="flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-accent-orange" aria-hidden="true" />
          <span className="text-[11px] font-semibold text-zinc-200">{tt("ui.customLogoTitle")}</span>
        </div>
        <div className="flex items-center gap-2">
          {savedUrl && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-semibold">
              <Check className="w-3 h-3" aria-hidden="true" />
              {tt("ui.customLogoActive")}
            </span>
          )}
          {collapsible && (
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label={tt("ui.cancel") || "Chiudi"}
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
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAdd() } }}
          placeholder={tt("ui.customLogoPh")}
          spellCheck={false}
          aria-label={tt("ui.customLogoTitle")}
          disabled={disabled}
          // Machine-readable image URL: always LTR even under RTL document.
          dir="ltr"
          className="min-w-0 flex-1 rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-accent-orange/60 disabled:opacity-40"
        />
        <button
          type="button"
          onClick={() => { void handleAdd() }}
          disabled={!input.trim() || resolving || disabled}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-orange text-white text-xs font-semibold hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {resolving
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            : <Plus className="w-3.5 h-3.5" aria-hidden="true" />}
          {resolving ? tt("ui.customLogoResolving") : tt("ui.customLogoAdd")}
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
          disabled={removing || disabled}
          className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-red-300 transition-colors disabled:opacity-40"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          {tt("ui.customLogoRemove")}
        </button>
      )}
    </div>
  )
}
