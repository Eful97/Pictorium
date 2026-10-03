"use client"

import React, { useRef, useState } from "react"
import { X, Plus, Check, AlertCircle, Film, Tv } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { normalizeManifestUrl } from "@/lib/stremio-addon"
import { userFetch } from "@/lib/http"
import { useOutsideDismiss } from "@/lib/useOutsideDismiss"

interface AddonManifestCatalog {
  id: string
  type: string
  name: string
  extra: Array<{ name: string; isRequired?: boolean; options?: string[] }>
  incompatible: string | null
}

export function AddonCatalogModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useT()
  const addCustomCatalog = usePSelector((v) => v.addCustomCatalog)
  const customCatalogs = usePSelector((v) => v.customCatalogs)
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addonName, setAddonName] = useState("")
  const [addonId, setAddonId] = useState("")
  const [catalogs, setCatalogs] = useState<AddonManifestCatalog[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [previews, setPreviews] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)
  // URL normalizzato del manifest effettivamente caricato: il salvataggio è
  // vincolato a questo, mai all'input live (che può essere già cambiato).
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const urlRef = useRef("")
  const loadSeqRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  useOutsideDismiss({
    active: isOpen,
    ref: popoverRef,
    onDismiss: onClose,
    delayMs: 50,
  })

  if (!isOpen) return null

  const invalidateLoaded = () => {
    setCatalogs([])
    setSelected(new Set())
    setPreviews({})
    setAddonName("")
    setAddonId("")
    setLoadedUrl(null)
  }

  const handleUrlChange = (value: string) => {
    setUrl(value)
    urlRef.current = value
    // L'input non rappresenta più il manifest caricato: scarta identificativo
    // e selezione invece di salvarli con l'URL nuovo.
    if (loadedUrl && normalizeManifestUrl(value) !== loadedUrl) invalidateLoaded()
  }

  const loadManifest = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    invalidateLoaded()
    const normalized = normalizeManifestUrl(url.trim())
    if (!normalized) {
      setError(t("ui.addonErrInvalid"))
      return
    }
    // Una sola richiesta viva: la precedente viene abortita e il suo esito
    // scartato anche se arriva dopo (cambio URL a richiesta pendente).
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const mySeq = ++loadSeqRef.current
    urlRef.current = url
    const stale = () => loadSeqRef.current !== mySeq || ctrl.signal.aborted
    setLoading(true)
    try {
      const res = await userFetch(`/api/stremio-addon/manifest?url=${encodeURIComponent(normalized)}`, {
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(15000)]),
      }).catch(() => null)
      if (stale()) return
      // L'input è cambiato mentre la risposta viaggiava: scarta, la nuova
      // richiesta (o la sua assenza) è la verità corrente.
      if (normalizeManifestUrl(urlRef.current.trim()) !== normalized) return
      if (!res || !res.ok) {
        const data = await res?.json().catch(() => null)
        // Come sotto: la lettura del body è un await, ricontrolla prima di
        // toccare lo stato (URL cambiato o nuova richiesta nel frattempo).
        if (stale()) return
        if (normalizeManifestUrl(urlRef.current.trim()) !== normalized) return
        const code = typeof data?.error === "string" ? data.error : ""
        setError(t(code === "private_url" ? "ui.addonErrPrivate" : "ui.addonErrUnavailable"))
        setLoading(false)
        return
      }
      const data = await res.json()
      if (stale()) return
      // L'input può essere cambiato durante l'await qui sopra: senza questo
      // secondo controllo i cataloghi di A ricomparirebbero con B nell'input.
      if (normalizeManifestUrl(urlRef.current.trim()) !== normalized) return
      setAddonName(typeof data?.name === "string" ? data.name : "")
      setAddonId(typeof data?.id === "string" ? data.id : "")
      setLoadedUrl(normalized)
      const list: AddonManifestCatalog[] = Array.isArray(data?.catalogs) ? data.catalogs : []
      setCatalogs(list)
      if (list.length === 0) setError(t("ui.addonNoCatalogs"))
      // Preseleziona i compatibili.
      setSelected(new Set(list.filter((c) => !c.incompatible).map((c) => `${c.type}:${c.id}`)))
      // Anteprima titoli per i compatibili (max 5 cataloghi, best-effort).
      setPreviews({})
      const previewable = list.filter((c) => !c.incompatible).slice(0, 5)
      void Promise.all(
        previewable.map(async (c) => {
          try {
            const pv = await userFetch(
              `/api/stremio-addon/preview?url=${encodeURIComponent(normalized)}&catalogId=${encodeURIComponent(c.id)}&type=${encodeURIComponent(c.type)}`,
              { signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(15000)]) },
            ).catch(() => null)
            if (stale() || !pv || !pv.ok) return
            const pdata = await pv.json().catch(() => null)
            // Stessa race del manifest qui sopra: fetch risolta prima del
            // cambio URL/load successivo, body letto dopo. Senza ricontrollo,
            // l'anteprima obsoleta sovrascrive quella nuova (stessa chiave).
            if (stale()) return
            if (normalizeManifestUrl(urlRef.current.trim()) !== normalized) return
            const titles = Array.isArray(pdata?.items)
              ? pdata.items.map((it: { title?: string }) => it.title).filter((x: unknown): x is string => typeof x === "string" && !!x).slice(0, 3)
              : []
            if (titles.length > 0) setPreviews((prev) => ({ ...prev, [`${c.type}:${c.id}`]: titles }))
          } catch {
            // Anteprima best-effort: mai bloccare la selezione.
          }
        }),
      )
    } catch {
      if (!stale()) setError(t("ui.addonErrUnavailable"))
    } finally {
      if (!stale()) setLoading(false)
    }
  }

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const save = async () => {
    setError(null)
    // Vincolato al manifest caricato: se l'input è cambiato senza ricaricare,
    // lo stato è già stato invalidato (picked vuoto) e qui si rifiuta.
    const current = normalizeManifestUrl(url.trim())
    if (!current || current !== loadedUrl) {
      setError(t("ui.addonErrInvalid"))
      return
    }
    const manifestUrl = loadedUrl
    const picked = catalogs.filter((c) => selected.has(`${c.type}:${c.id}`) && !c.incompatible)
    if (picked.length === 0) {
      setError(t("ui.addonNoCatalogs"))
      return
    }
    setSaving(true)
    try {
      for (const c of picked) {
        const remoteType = c.type === "series" ? "series" : "movie"
        // Nome distinguibile + ID locale stabile senza collisioni (id random
        // esistente; due addon con stesso ID remoto convivono, due config
        // della stessa fonte restano distinguibili dal nome).
        const baseName = `${addonName || "Addon"} — ${c.name || c.id}`.slice(0, 100)
        const exists = (n: string) => customCatalogs.some((x) => x.name === n)
        let name = baseName
        let n = 2
        while (exists(name) && n < 10) {
          name = `${baseName} (${n})`.slice(0, 100)
          n++
        }
        // Evita doppi import identici (stesso manifest + stesso catalogo).
        const duplicate = customCatalogs.some(
          (x) => x.addon?.manifestUrl === manifestUrl && x.addon?.catalogId === c.id && x.addon?.catalogType === remoteType,
        )
        if (duplicate) continue
        addCustomCatalog({
          name,
          type: remoteType,
          url: manifestUrl,
          enabled: true,
          addon: {
            manifestUrl,
            catalogId: c.id,
            catalogType: remoteType,
            extra: (c.extra || []).slice(0, 20),
            ...(addonId ? { addonId: addonId.slice(0, 100) } : {}),
            ...(addonName ? { addonName: addonName.slice(0, 100) } : {}),
          },
        })
      }
      setUrl("")
      urlRef.current = ""
      invalidateLoaded()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-2 w-[420px] max-w-[calc(100vw-2rem)] z-50 bg-surface/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-scale-in"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-surface2/40">
        <h3 className="text-xs font-bold text-white">{t("ui.addonMode")}</h3>
        <button type="button" onClick={onClose} aria-label={t("ui.close")} className="p-1 rounded-lg text-muted hover:text-white hover:bg-white/5 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <form onSubmit={loadManifest} className="p-4 space-y-3">
        <p className="text-[10px] text-zinc-400 leading-relaxed">{t("ui.addonLimit")}</p>
        <div>
          <label className="block text-[11px] font-semibold text-zinc-300 mb-1">{t("ui.addonUrlLabel")}</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t("ui.addonUrlPh")}
              value={url}
              onChange={(e) => handleUrlChange(e.target.value)}
              className="flex-1 px-3 py-2 bg-surface2 border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-accent-orange transition-colors"
              required
              autoFocus
            />
            <button
              type="submit"
              disabled={loading}
              className="shrink-0 px-3 py-2 rounded-xl bg-surface2 border border-white/10 text-xs font-semibold text-zinc-200 hover:text-white disabled:opacity-50"
            >
              {loading ? t("ui.addonLoading") : t("ui.addonLoad")}
            </button>
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {catalogs.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-zinc-300">{t("ui.addonSelect")}</p>
            <p className="text-[10px] text-zinc-400 leading-relaxed">{t("ui.addonSourceNote")}</p>
            <div className="max-h-56 overflow-y-auto space-y-1.5">
              {catalogs.map((c) => {
                const key = `${c.type}:${c.id}`
                const checked = selected.has(key)
                return (
                  <label
                    key={key}
                    className={`flex items-start gap-2 p-2 rounded-xl border text-left ${c.incompatible ? "opacity-60 bg-white/[0.02] border-white/5" : checked ? "bg-accent-orange/10 border-accent-orange/30" : "bg-surface2/60 border-white/10"}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!!c.incompatible}
                      onChange={() => toggle(key)}
                      className="mt-0.5"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                        {c.type === "series" ? <Tv className="w-3 h-3" /> : <Film className="w-3 h-3" />}
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="block text-[10px] text-zinc-400 truncate">
                        {c.type} · {c.id} · {(c.extra || []).map((e) => e.name + (e.isRequired ? "*" : "")).join(", ") || "—"}
                      </span>
                      {previews[key] && previews[key].length > 0 && (
                        <span className="block text-[10px] text-zinc-500 truncate">
                          {previews[key].join(", ")}
                        </span>
                      )}
                      {c.incompatible && <span className="block text-[10px] text-red-400">{t("ui.addonErrIncompatible")}</span>}
                    </span>
                    {checked && !c.incompatible && <Check className="w-3.5 h-3.5 text-accent-orange shrink-0 mt-0.5" />}
                  </label>
                )
              })}
            </div>
            <p className="text-[10px] text-zinc-500">{t("ui.addonProprietaryNote")}</p>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-xl text-[11px] font-medium text-muted hover:text-white transition-colors">
            {t("ui.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || selected.size === 0}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent-orange text-white text-[11px] font-semibold hover:bg-accent-orange/90 active:scale-95 transition-all shadow-md disabled:opacity-50"
          >
            <Plus className="w-3 h-3" /> {t("ui.addCatalogBtn")}
          </button>
        </div>
      </form>
    </div>
  )
}
