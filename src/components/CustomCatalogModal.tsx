"use client"

import React, { useState, useRef, useEffect } from "react"
import { X, Plus, ListPlus, Film, Tv, Shuffle, Check, AlertCircle } from "lucide-react"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { detectCatalogProvider, catalogStatusErrorKey, buildMDBListListUrl } from "@/lib/catalog-provider-detect"
import { requestSettingsTab } from "@/lib/settings-tab"
import { parseImdbCsv, IMDB_CSV_MAX_BYTES } from "@/lib/imdb-csv"
import { userFetch } from "@/lib/http"
import { EmojiPicker } from "@/components/ui"
import { customCatalogSortKeys, sanitizeCustomCatalogSort, type CustomCatalogType } from "@/lib/types"

interface CustomCatalogModalProps {
  isOpen: boolean
  onClose: () => void
}

export function CustomCatalogModal({ isOpen, onClose }: CustomCatalogModalProps) {
  const { t } = useT()
  const addCustomCatalog = usePSelector((v) => v.addCustomCatalog)
  const setSettingsOpen = usePSelector((v) => v.setSettingsOpen)
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const mdblistApiKey = usePSelector((v) => v.mdblistApiKey)
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [type, setType] = useState<CustomCatalogType>("movie")
  // Optional provider sort (validated allowlist below): empty = provider
  // default. Trakt defaults to its curated `rank`/`asc` order server-side.
  const [sortBy, setSortBy] = useState("")
  const [sortHow, setSortHow] = useState<"asc" | "desc">("asc")
  // MDBList browse picker: read-only top-list discovery, URL synthesized
  // through the same client-safe detector used for manual input.
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browseStatus, setBrowseStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle")
  const [browseLists, setBrowseLists] = useState<Array<{
    name: string
    url?: string | null
    id?: number | null
    slug?: string | null
    userName?: string | null
    itemCount?: number | null
  }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewItems, setPreviewItems] = useState<Array<{ title: string; year: number }> | null>(null)
  // Esito tipizzato dell'ultima preview (provider + status): serve il prompt
  // di collegamento Trakt quando il proprietario deve (ri)collegare
  // l'account nelle Impostazioni. Resettato a ogni nuovo invio.
  const [previewStatus, setPreviewStatus] = useState<string | null>(null)
  const [previewProvider, setPreviewProvider] = useState<string | null>(null)
  // Import CSV IMDb: anteprima parsata in locale, snapshot salvato server-side.
  const [mode, setMode] = useState<"url" | "csv">("url")
  const [csvText, setCsvText] = useState<string | null>(null)
  const [csvFileName, setCsvFileName] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const popoverRef = useRef<HTMLDivElement>(null)

  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl)
    const trimmed = newUrl.trim()
    if (trimmed) {
      const detection = detectCatalogProvider(trimmed)
      if (detection) {
        if (!name && detection.nameSuggestion) {
          setName(detection.nameSuggestion)
        }
        if (detection.defaultType) {
          setType(detection.defaultType)
        }
      }
      // Provider change can invalidate the chosen sort field: reset only when
      // the new provider cannot honor it (never silently translate keys).
      const allowed = customCatalogSortKeys(detection?.provider)
      if (!allowed) {
        setSortBy("")
        setSortHow("asc")
      } else if (sortBy && !allowed.includes(sortBy)) {
        setSortBy("")
      }
    }
  }

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    const timer = setTimeout(() => {
      window.addEventListener("click", handleClickOutside)
    }, 50)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("click", handleClickOutside)
      clearTimeout(timer)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleCsvFile = async (file: File | undefined) => {
    setError(null)
    setPreviewItems(null)
    setCsvText(null)
    if (!file) return
    if (file.size > IMDB_CSV_MAX_BYTES) {
      setError(t("ui.customCsvTooLarge"))
      return
    }
    const text = await file.text().catch(() => "")
    const result = parseImdbCsv(text)
    if (!result.ok) {
      setError(result.error === "too_large" ? t("ui.customCsvTooLarge") : t("ui.customCsvInvalid"))
      return
    }
    setCsvText(text)
    setCsvFileName(file.name)
    setPreviewItems(result.items.slice(0, 3).map((it) => ({
      title: it.title || t("ui.untitled"),
      year: it.year || 0,
    })))
    if (!name) {
      setName(file.name.replace(/\.csv$/i, ""))
    }
    setType("mixed")
  }

  const handleTestAndSaveCsv = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError(t("ui.customErrName"))
      return
    }
    if (!csvText) {
      setError(t("ui.customNoTitles"))
      return
    }
    const trimmedSource = sourceUrl.trim()
    if (trimmedSource) {
      const detection = detectCatalogProvider(trimmedSource)
      if (!detection || detection.provider !== "imdb") {
        setError(t("ui.customErrInvalid"))
        return
      }
    }

    setLoading(true)
    try {
      const res = await userFetch("/api/mdblist/custom-imdb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvText, name: trimmedName, ...(trimmedSource ? { sourceUrl: trimmedSource } : {}) }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => null)

      if (!res || !res.ok) {
        setError(t("ui.customNoTitles"))
        setLoading(false)
        return
      }
      const data = await res.json()
      if (!data?.datasetId || !data?.itemCount) {
        setError(t("ui.customNoTitles"))
        setLoading(false)
        return
      }

      addCustomCatalog({
        name: trimmedName,
        type,
        url: trimmedSource || `imdb-csv:${data.datasetId}`,
        datasetId: data.datasetId,
        enabled: true,
      })

      setTimeout(() => {
        setUrl("")
        setName("")
        setSourceUrl("")
        setCsvText(null)
        setCsvFileName("")
        setPreviewItems(null)
        setLoading(false)
        onClose()
      }, 700)
    } catch {
      setError(t("ui.customNoTitles"))
      setLoading(false)
      return
    }
  }

  // Esito tipizzato del preview server (Fase 5): niente più generico
  // "nessun titolo" quando la causa è nota (privata, 404, rate limit...).
  const handleTestAndSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setPreviewStatus(null)
    setPreviewProvider(null)
    const trimmedUrl = url.trim()
    const trimmedName = name.trim()

    if (!trimmedUrl) {
      setError(t("ui.customErrUrl"))
      return
    }
    if (!trimmedName) {
      setError(t("ui.customErrName"))
      return
    }

    const detection = detectCatalogProvider(trimmedUrl)
    if (!detection) {
      setError(t("ui.customErrInvalid"))
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams({
        url: trimmedUrl,
        limit: "10",
      })
      if (tmdbKey) params.set("api_key", tmdbKey)
      if (mdblistApiKey) params.set("mdblist_key", mdblistApiKey)

      const res = await userFetch(`/api/mdblist/custom?${params.toString()}`, {
        headers: tmdbKey ? { "x-api-key": tmdbKey } : undefined,
        signal: AbortSignal.timeout(8000),
      }).catch(() => null)

      let previewCount = 0
      let previewStatus: string | undefined
      let previewProvider: string | undefined
      if (res && res.ok) {
        const data = await res.json()
        previewStatus = typeof data?.status === "string" ? data.status : undefined
        previewProvider = typeof data?.provider === "string" ? data.provider : undefined
        if (Array.isArray(data?.items) && data.items.length > 0) {
          previewCount = data.items.length
          setPreviewItems(data.items.slice(0, 3).map((it: { title?: string; name?: string; year?: number }) => ({
            title: it.title || it.name || t("ui.untitled"),
            year: it.year || 0,
          })))
        }
      } else if (res && !res.ok) {
        // Preview auth failure (owner-private Trakt senza login valido):
        // mai un vuoto generico — il proprietario va guidato al collegamento
        // nelle Impostazioni. Gli altri provider restano invariati.
        const errData = await res.json().catch(() => null)
        if (typeof errData?.status === "string") previewStatus = errData.status
        if (typeof errData?.provider === "string") previewProvider = errData.provider
        if (res.status === 401 && detection?.provider === "trakt") {
          previewStatus = "connection_required"
          previewProvider = "trakt"
        }
      }
      setPreviewStatus(previewStatus ?? null)
      setPreviewProvider(previewProvider ?? null)

      // Mai salvare un catalogo morto: senza titoli la preview su Stremio e
      // nella sezione Cataloghi resterebbe vuota (provider non supportato,
      // chiave mancante o lista inaccessibile).
      if (previewCount === 0) {
        setError(t(catalogStatusErrorKey(previewStatus, previewProvider)))
        setLoading(false)
        return
      }

      const sort = sanitizeCustomCatalogSort(detection.provider, sortBy, sortHow)
      addCustomCatalog({
        name: trimmedName,
        type,
        url: trimmedUrl,
        enabled: true,
        ...(sort ? { sortBy: sort.sortBy, sortHow: sort.sortHow } : {}),
      })

      setTimeout(() => {
        setUrl("")
        setName("")
        setSortBy("")
        setSortHow("asc")
        setPreviewItems(null)
        setLoading(false)
        onClose()
      }, 700)
    } catch {
      setError(t("ui.customNoTitles"))
      setLoading(false)
      return
    }
  }

  // Picker MDBList: top list lette in sola lettura dalla route dedicata
  // (cache 60min/quota server-side). Nessun segreto nel client oltre alla
  // chiave che l'utente già possiede, passata come le altre preview.
  const loadBrowse = async () => {
    setBrowseStatus("loading")
    try {
      const params = new URLSearchParams({ mode: "top", limit: "20" })
      if (mdblistApiKey) params.set("mdblist_key", mdblistApiKey)
      const res = await userFetch(`/api/mdblist/lists?${params.toString()}`, {
        signal: AbortSignal.timeout(8000),
      }).catch(() => null)
      const data = res && res.ok ? await res.json().catch(() => null) : null
      const lists = Array.isArray(data?.lists) ? data.lists : []
      setBrowseLists(lists)
      setBrowseStatus(lists.length > 0 ? "ready" : "empty")
    } catch {
      setBrowseStatus("error")
    }
  }

  const handleBrowseToggle = () => {
    const next = !browseOpen
    setBrowseOpen(next)
    if (next && browseStatus === "idle") void loadBrowse()
  }

  const handleBrowsePick = (entry: (typeof browseLists)[number]) => {
    const target = entry.url || buildMDBListListUrl({
      userName: entry.userName,
      slug: entry.slug,
      id: entry.id,
    })
    if (!target) return
    handleUrlChange(target)
    if (!name.trim() && entry.name) setName(entry.name)
    setBrowseOpen(false)
  }

  // Prompt di collegamento Trakt: la preview owner-private richiede
  // l'account collegato — apre le Impostazioni sul tab Spazio (stesso
  // idioma della scorciatoia UUID in AppShell). Solo provider/status
  // noti: mai un bottone su flussi pubblici o altri provider.
  const showTraktConnect = previewProvider === "trakt" && previewStatus === "connection_required"
  const handleTraktConnect = () => {
    onClose()
    requestSettingsTab("spazio")
    setSettingsOpen(true)
  }

  // Provider-specific sort allowlist (empty for providers without a sort
  // contract). Only accepted keys are offered: a foreign value can never be
  // submitted, and the server re-validates the same leaf.
  const urlDetection = url.trim() ? detectCatalogProvider(url.trim()) : null
  const sortKeys = customCatalogSortKeys(urlDetection?.provider)

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-full mt-2 w-[360px] max-w-[calc(100vw-2rem)] z-50 bg-surface/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-scale-in"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-surface2/40">
        <div className="flex items-center gap-2">
          <ListPlus className="w-4 h-4 text-accent-orange" />
          <h3 className="text-xs font-bold text-foreground">{t("ui.newCatalog")}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("ui.close")}
          className="p-1 rounded-lg text-muted hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Body */}
      <form onSubmit={mode === "csv" ? handleTestAndSaveCsv : handleTestAndSave} className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setMode("url")}
            className={`py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition ${
              mode === "url"
                ? "bg-accent-orange/20 border-accent-orange/40 text-accent-orange"
                : "bg-surface2/60 border-white/5 text-muted hover:text-white"
            }`}
          >
            {t("ui.customModeUrl")}
          </button>
          <button
            type="button"
            onClick={() => setMode("csv")}
            className={`py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition ${
              mode === "csv"
                ? "bg-accent-orange/20 border-accent-orange/40 text-accent-orange"
                : "bg-surface2/60 border-white/5 text-muted hover:text-white"
            }`}
          >
            {t("ui.customModeCsv")}
          </button>
        </div>
        {mode === "url" ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-[11px] font-semibold text-zinc-300">
              {t("ui.customUrlLabel")}
            </label>
            <span className="text-[10px] text-zinc-400 font-normal">
              Letterboxd, Trakt, TMDb, MDBList, IMDb CSV
            </span>
          </div>
          <input
            type="text"
            placeholder={t("ui.customUrlPh")}
            value={url}
            onChange={(e) => handleUrlChange(e.target.value)}
            // Machine-readable list URL: always LTR even under RTL document.
            // (The catalog display name below stays dir-inherited: free text.)
            dir="ltr"
            className="w-full px-3 py-2 bg-surface2 border border-white/10 rounded-xl text-xs text-foreground placeholder-zinc-500 focus:outline-none focus:border-accent-orange transition-colors"
            required
            autoFocus
          />
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-400">Letterboxd</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-400">Trakt</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-400">TMDb Saga</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-400">TMDb Lista</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-400">MDBList</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-400">IMDb CSV</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-zinc-400">TVDB</span>
          </div>
          <div className="mt-2">
            <button
              type="button"
              onClick={handleBrowseToggle}
              aria-expanded={browseOpen}
              aria-label="MDBList"
              className="w-full py-1.5 px-2 rounded-xl text-[11px] font-semibold border border-white/10 bg-white/5 text-zinc-300 hover:text-white hover:bg-white/10 transition"
            >
              MDBList
            </button>
            {browseOpen && (
              <div className="mt-1.5 rounded-xl border border-white/10 bg-surface2/60 p-2 max-h-44 overflow-y-auto">
                {browseStatus === "loading" && (
                  <p className="py-2 text-center text-[10px] text-zinc-400">{t("ui.loading")}</p>
                )}
                {browseStatus === "empty" && (
                  <p className="py-2 text-center text-[10px] text-zinc-400">{t("ui.customNoTitles")}</p>
                )}
                {browseStatus === "error" && (
                  <div className="py-2 text-center">
                    <p className="text-[10px] text-zinc-400">{t("ui.customErrUnavailable")}</p>
                    <button
                      type="button"
                      onClick={() => void loadBrowse()}
                      className="mt-1 px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-[10px] font-semibold text-zinc-300 hover:text-white hover:bg-white/10 transition"
                    >
                      {t("ui.retry")}
                    </button>
                  </div>
                )}
                {browseStatus === "ready" && browseLists.map((entry, idx) => (
                  <button
                    key={`${entry.userName ?? ""}:${entry.slug ?? entry.id ?? idx}`}
                    type="button"
                    onClick={() => handleBrowsePick(entry)}
                    className="w-full text-left px-2 py-1.5 rounded-lg text-[11px] text-zinc-300 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <span className="block truncate">{entry.name}</span>
                    {typeof entry.itemCount === "number" && entry.itemCount > 0 && (
                      <span className="block text-[9px] text-zinc-500">{entry.itemCount}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
              {t("ui.customCsvLabel")}
            </label>
            <label className="flex items-center justify-center gap-2 w-full px-3 py-3 bg-surface2 border border-dashed border-white/15 rounded-xl text-xs text-zinc-300 hover:border-accent-orange/60 hover:text-white transition-colors cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
              <span className="truncate">{csvFileName || t("ui.customCsvPh")}</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => void handleCsvFile(e.target.files?.[0])}
              />
            </label>
            <p className="mt-1 text-[10px] text-zinc-500">{t("ui.customCsvHint")}</p>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
              {t("ui.customSourceUrlLabel")}
            </label>
            <input
              type="text"
              placeholder="https://www.imdb.com/list/ls..."
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              // Machine-readable IMDb list URL: always LTR even under RTL document.
              dir="ltr"
              className="w-full px-3 py-2 bg-surface2 border border-white/10 rounded-xl text-xs text-foreground placeholder-zinc-500 focus:outline-none focus:border-accent-orange transition-colors"
            />
          </div>
        </div>
        )}

        {mode === "url" && sortKeys && (
          <div>
            <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
              {t("ui.ordering")}
            </label>
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-2 py-2 bg-surface2 border border-white/10 rounded-xl text-xs text-foreground focus:outline-none focus:border-accent-orange transition-colors"
              >
                <option value="">—</option>
                {sortKeys.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
              <select
                value={sortHow}
                onChange={(e) => setSortHow(e.target.value === "desc" ? "desc" : "asc")}
                disabled={!sortBy}
                className="px-2 py-2 bg-surface2 border border-white/10 rounded-xl text-xs text-foreground focus:outline-none focus:border-accent-orange transition-colors disabled:opacity-40"
              >
                <option value="asc">↑ asc</option>
                <option value="desc">↓ desc</option>
              </select>
            </div>
          </div>
        )}

        <div>
          <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
            {t("ui.customNameLabel")}
          </label>
          <EmojiPicker
            currentName={name}
            onSelectEmoji={(em) => {
              const cleaned = name.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic}|\p{Emoji})\s*/u, "")
              setName(`${em} ${cleaned}`)
            }}
          />
          <input
            type="text"
            placeholder={t("ui.customNamePh")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-surface2 border border-white/10 rounded-xl text-xs text-foreground placeholder-zinc-500 focus:outline-none focus:border-accent-orange transition-colors"
            required
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-zinc-300 mb-1">
            {t("ui.contentType")}
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => setType("movie")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition ${
                type === "movie"
                  ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                  : "bg-surface2/60 border-white/5 text-muted hover:text-white"
              }`}
            >
              <Film className="w-3 h-3" /> {t("ui.movie")}
            </button>
            <button
              type="button"
              onClick={() => setType("series")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition ${
                type === "series"
                  ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                  : "bg-surface2/60 border-white/5 text-muted hover:text-white"
              }`}
            >
              <Tv className="w-3 h-3" /> {t("ui.tvSeries")}
            </button>
            <button
              type="button"
              onClick={() => setType("mixed")}
              className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition ${
                type === "mixed"
                  ? "bg-accent-orange/20 border-accent-orange/40 text-accent-orange"
                  : "bg-surface2/60 border-white/5 text-muted hover:text-white"
              }`}
            >
              <Shuffle className="w-3 h-3" /> {t("ui.mixedType")}
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[11px]">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {showTraktConnect && (
          <button
            type="button"
            onClick={handleTraktConnect}
            className="w-full py-2 rounded-xl text-[11px] font-semibold bg-amber-500 text-black hover:bg-amber-400 active:scale-[0.99] transition cursor-pointer"
          >
            {t("ui.customTraktConnect")}
          </button>
        )}

        {previewItems && previewItems.length > 0 && (
          <div className="p-2.5 rounded-xl bg-green-500/10 border border-green-500/20 text-[11px] text-green-300 space-y-1">
            <div className="flex items-center gap-1 font-semibold text-green-400">
              <Check className="w-3.5 h-3.5" /> {t("ui.verifiedList")}
            </div>
            <p className="text-[10px] text-zinc-300 truncate">
              {previewItems.map((p) => p.title).join(", ")}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-[11px] font-medium text-muted hover:text-white transition-colors"
          >
            {t("ui.cancel")}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent-orange text-white text-[11px] font-semibold hover:bg-accent-orange/90 active:scale-95 transition shadow-md disabled:opacity-50"
          >
            {loading ? t("ui.saving") : <><Plus className="w-3 h-3" /> {t("ui.addCatalogBtn")}</>}
          </button>
        </div>
      </form>
    </div>
  )
}
