"use client"

import React, { useState, useEffect, useRef, useMemo } from "react"
import { X, Check, Copy, Download, ExternalLink, Tv, Sparkles, Film, Search, Star } from "lucide-react"
import QRCode from "qrcode"
import { useT } from "@/lib/contexts/TranslationContext"
import { copyText } from "@/lib/clipboard"
import { Modal } from "@/components/ui/Modal"

interface InstallModalProps {
  isOpen: boolean
  onClose: () => void
  manifestUrl?: string
  /** Template primario con `{tmdb_id}` (esatto, niente /find). */
  posterUrlPattern?: string
  /** Template secondario con `{imdb_id}` (fallback universale). */
  posterUrlPatternImdb?: string
  /** Template auto con `{tmdb_id|imdb_id}` (Nuvio: id disponibile per la vista). */
  posterUrlPatternAuto?: string
  /** Varianti Nuvio a formato automatico (`shape={shape}`): combinano il
   *  placeholder id scelto con il placeholder shape (Nuvio sceglie
   *  poster/landscape per vista; square ricade sul verticale). */
  posterUrlPatternNuvio?: string
  posterUrlPatternNuvioImdb?: string
  posterUrlPatternNuvioAuto?: string
  /**
   * Modalità template poster (controllata dal context): "follow" = Segui il
   * mio spazio (live=1, nessun visuale congelato), "fixed" = Impostazioni
   * fisse nel link. Riguarda solo gli URL poster, mai il manifest.
   */
  linkMode?: "follow" | "fixed"
  onLinkModeChange?: (m: "follow" | "fixed") => void
  /** Spazio utente attivo: con spazio, il default iniziale è "follow". */
  hasUserSpace?: boolean
}

/** Riga template copiabile con stato "copiato" proprio. */
function PatternRow({ value, tag, copyLabel }: { value: string; tag: string; copyLabel: string }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleCopy = async () => {
    if (!(await copyText(value))) return
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 p-1 bg-black/40 border border-white/10 rounded-xl">
        <input
          type="text"
          readOnly
          value={value}
          aria-label={copyLabel}
          className="w-full bg-transparent px-2 py-1 text-[10px] font-mono text-zinc-300 truncate select-all focus:outline-none"
        />
        <button
          type="button"
          onClick={handleCopy}
          className={`shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer ${
            copied
              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
              : "bg-white/10 hover:bg-white/15 text-zinc-200 border border-white/10 active:scale-95"
          }`}
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-muted" />}
          <span>{copied ? t("ui.copied") : t("ui.copyUrl")}</span>
        </button>
      </div>
      <p className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono mt-1 px-1">{tag}</p>
    </div>
  )
}

export function InstallModal({ isOpen, onClose, manifestUrl: propManifestUrl, posterUrlPattern, posterUrlPatternImdb, posterUrlPatternAuto, posterUrlPatternNuvio, posterUrlPatternNuvioImdb, posterUrlPatternNuvioAuto, linkMode: controlledLinkMode, onLinkModeChange, hasUserSpace }: InstallModalProps) {
  const { t } = useT()
  const [hubMode, setHubMode] = useState<"all" | "catalogs" | "search">("all")
  const [copied, setCopied] = useState(false)
  // Quale placeholder id usa il template: Auto (Nuvio/AIO sostituiscono
  // l'id disponibile per la vista, default), TMDB (primario, esatto) o IMDb
  // (fallback universale). Una sola riga visibile alla volta.
  const [patternKind, setPatternKind] = useState<"tmdb" | "imdb" | "auto">("auto")
  // Formato automatico Nuvio (`shape={shape}`): Nuvio sceglie poster/landscape
  // per vista (square → poster verticale). Nessuna persistenza: solo display.
  const [nuvioShape, setNuvioShape] = useState(false)
  // Modalità template poster: "follow" (Segui il mio spazio) / "fixed"
  // (Impostazioni fisse nel link). Controllata dal context quando disponibile,
  // altrimenti stato locale (default follow con spazio utente).
  const [internalLinkMode, setInternalLinkMode] = useState<"follow" | "fixed">(hasUserSpace ? "follow" : "fixed")
  const linkMode = controlledLinkMode ?? internalLinkMode
  const setLinkMode = onLinkModeChange ?? setInternalLinkMode
  const [qrSvg, setQrSvg] = useState<string>("")
  const [baseManifestUrl, setBaseManifestUrl] = useState(propManifestUrl || "")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (propManifestUrl) {
      setBaseManifestUrl(propManifestUrl)
      return
    }
    if (typeof window === "undefined") return
    const path = window.location.pathname
    const params = new URLSearchParams(window.location.search)
    const cParam = params.get("config") || params.get("c")
    const uParam = params.get("u") || params.get("user")

    if (path.startsWith("/c/")) {
      const seg = path.split("/")[2]
      if (seg && seg !== "manifest.json" && seg !== "configure") {
        setBaseManifestUrl(`${window.location.origin}/c/${seg}/manifest.json`)
        return
      }
    }
    if (path.startsWith("/u/")) {
      const seg = path.split("/")[2]
      if (seg && seg !== "manifest.json" && seg !== "configure") {
        setBaseManifestUrl(`${window.location.origin}/u/${seg}/manifest.json`)
        return
      }
    }
    if (cParam) {
      setBaseManifestUrl(`${window.location.origin}/c/${cParam}/manifest.json`)
      return
    }
    if (uParam) {
      setBaseManifestUrl(`${window.location.origin}/u/${uParam}/manifest.json`)
      return
    }
    setBaseManifestUrl(`${window.location.origin}/manifest.json`)
  }, [propManifestUrl, isOpen])

  const resolvedManifestUrl = useMemo(() => {
    if (!baseManifestUrl) return ""
    if (hubMode === "all") return baseManifestUrl
    try {
      const urlObj = new URL(baseManifestUrl)
      urlObj.searchParams.set("mode", hubMode)
      return urlObj.toString()
    } catch {
      const sep = baseManifestUrl.includes("?") ? "&" : "?"
      return `${baseManifestUrl}${sep}mode=${hubMode}`
    }
  }, [baseManifestUrl, hubMode])

  const stremioDeepLink = (resolvedManifestUrl || "").replace(/^https?:\/\//, "stremio://")
  const stremioWebLink = `https://web.stremio.com/#/addons?addon=${encodeURIComponent(resolvedManifestUrl || "")}`

  useEffect(() => {
    if (!isOpen || !resolvedManifestUrl) return
    QRCode.toString(resolvedManifestUrl, {
      type: "svg",
      margin: 1,
      width: 170,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then((svg) => setQrSvg(svg))
      .catch(() => setQrSvg(""))
  }, [isOpen, resolvedManifestUrl])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!isOpen) return null

  const handleCopy = async () => {
    if (!(await copyText(resolvedManifestUrl))) return
    setCopied(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="install-hub-title" className="max-w-sm max-h-[90vh] overflow-y-auto p-0 space-y-0">
      <div className="w-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-accent-orange/20 border border-accent-orange/30 flex items-center justify-center text-accent-orange">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <h2 id="install-hub-title" className="text-sm font-bold text-white leading-tight">{t("ui.installHubTitle")}</h2>
              <p className="text-[11px] text-muted">{t("ui.installHubSub")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("ui.close")}
            className="p-1.5 text-muted hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3.5">
          {/* Mode Selector Segmented Control */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-zinc-300">
              {t("ui.installMode")}
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-white/5 border border-white/5 rounded-xl">
              <button
                type="button"
                onClick={() => setHubMode("all")}
                className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-lg text-center transition-all ${
                  hubMode === "all"
                    ? "bg-accent-orange text-white shadow-md font-semibold"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 mb-0.5" />
                <span className="text-[11px] font-medium leading-tight">{t("ui.modeAll")}</span>
                <span className="text-[9px] opacity-80 leading-tight">{t("ui.modeAllSub")}</span>
              </button>

              <button
                type="button"
                onClick={() => setHubMode("catalogs")}
                className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-lg text-center transition-all ${
                  hubMode === "catalogs"
                    ? "bg-accent-orange text-white shadow-md font-semibold"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <Film className="w-3.5 h-3.5 mb-0.5" />
                <span className="text-[11px] font-medium leading-tight">{t("ui.modeCatalogs")}</span>
                <span className="text-[9px] opacity-80 leading-tight">{t("ui.modeCatalogsSub")}</span>
              </button>

              <button
                type="button"
                onClick={() => setHubMode("search")}
                className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-lg text-center transition-all ${
                  hubMode === "search"
                    ? "bg-accent-orange text-white shadow-md font-semibold"
                    : "text-zinc-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <Search className="w-3.5 h-3.5 mb-0.5" />
                <span className="text-[11px] font-medium leading-tight">{t("ui.modeSearch")}</span>
                <span className="text-[9px] opacity-80 leading-tight">{t("ui.modeSearchSub")}</span>
              </button>
            </div>
          </div>

          {/* QR Code Card */}
          <div className="flex flex-col items-center justify-center p-3.5 bg-white/5 rounded-xl border border-white/5 space-y-2">
            <div className="flex items-center gap-1.5 text-zinc-300 text-[11px] font-medium">
              <Tv className="w-3.5 h-3.5 text-accent-orange" />
              <span>{t("ui.scanQr")}</span>
            </div>
            {qrSvg ? (
              <div
                className="bg-white p-2 rounded-xl shadow-lg"
                role="img"
                aria-label={t("ui.qrAria")}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : (
              <div className="w-[170px] h-[170px] bg-white/10 rounded-xl flex items-center justify-center text-muted text-xs">
                {t("ui.qrGenerating")}
              </div>
            )}
            <p className="text-[10px] text-muted text-center max-w-[240px]">
              {hubMode === "all" && t("ui.hubDescAll")}
              {hubMode === "catalogs" && t("ui.hubDescCatalogs")}
              {hubMode === "search" && t("ui.hubDescSearch")}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2">
            {/* Direct App Install */}
            <a
              href={stremioDeepLink}
              className="w-full py-2.5 px-4 rounded-xl bg-accent-orange hover:bg-accent-orange/90 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-accent-orange/20 active:scale-[0.98]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t("ui.installInApp")}</span>
            </a>

            {/* Copy Manifest URL */}
            <button
              type="button"
              onClick={handleCopy}
              className={`w-full py-2 px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                copied
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm"
                  : "bg-surface2 hover:bg-surface2/80 text-zinc-200 border-white/10"
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-muted" />}
              <span>{copied ? t("ui.manifestCopied") : t("ui.copyManifest")}</span>
            </button>

            {/* Open in Web Stremio */}
            <a
              href={stremioWebLink}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-1 px-3 rounded-xl text-[11px] font-medium text-muted hover:text-zinc-200 flex items-center justify-center gap-1.5 transition-colors"
            >
              <span>{t("ui.openWebStremio")}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* AIOMetadata & External Poster URL: selettore TMDB/IMDb/Auto + una riga */}
          {(posterUrlPattern || posterUrlPatternImdb || posterUrlPatternAuto) && (
            <div className="pt-3 border-t border-white/10 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-zinc-300 text-[11px] font-semibold">
                  <Sparkles className="w-3.5 h-3.5 text-accent-orange" />
                  <span>{t("ui.aiomLinkTitle") || "Link per AIO e custom URL:"}</span>
                </div>
                <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono">Template URL</span>
              </div>

              <p className="text-[10px] text-zinc-400 leading-tight">
                {t("ui.aiomLinkDesc")}
              </p>

              <div className="text-[10px] text-zinc-400 leading-tight">
                <span className="block font-semibold text-zinc-300">{t(linkMode === "follow" ? "ui.linkModeFollow" : "ui.linkModeFixed")}</span>
                <span className="block mt-0.5">{t(linkMode === "follow" ? "ui.linkModeFollowSub" : "ui.linkModeFixedSub")}</span>
              </div>
              <details className="text-[10px] text-zinc-400">
                <summary className="cursor-pointer">{t("ui.linkModeAdvanced")}</summary>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={linkMode === "fixed"}
                    onChange={(e) => setLinkMode(e.target.checked ? "fixed" : "follow")}
                    className="h-3.5 w-3.5 accent-orange-500 cursor-pointer"
                  />
                  {t("ui.linkModeFixed")}
                </label>
              </details>

              <div className="flex items-center gap-1.5">
                <label
                  htmlFor="pattern-kind-select"
                  className="text-[10px] text-zinc-500 shrink-0"
                >
                  ID:
                </label>
                <select
                  id="pattern-kind-select"
                  value={patternKind}
                  onChange={(e) => setPatternKind(e.target.value === "imdb" ? "imdb" : e.target.value === "auto" ? "auto" : "tmdb")}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-white/25 cursor-pointer"
                >
                  <option value="auto">{t("ui.patternAuto")}</option>
                  <option value="tmdb">TMDB ID</option>
                  <option value="imdb">IMDb ID</option>
                </select>
              </div>

              <label
                htmlFor="pattern-nuvio-shape"
                className="flex items-start gap-2 cursor-pointer"
              >
                <input
                  id="pattern-nuvio-shape"
                  type="checkbox"
                  checked={nuvioShape}
                  onChange={(e) => setNuvioShape(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-orange-500 cursor-pointer"
                />
                <span className="text-[10px] text-zinc-400 leading-tight">
                  <span className="block font-semibold text-zinc-300">{t("ui.patternNuvio")}</span>
                  <span className="block mt-0.5">{t("ui.nuvioShapeDesc")}</span>
                </span>
              </label>

              <PatternRow
                value={(() => {
                  if (!nuvioShape) {
                    return (patternKind === "tmdb" ? posterUrlPattern : patternKind === "imdb" ? posterUrlPatternImdb : posterUrlPatternAuto) || posterUrlPattern || posterUrlPatternImdb || posterUrlPatternAuto || ""
                  }
                  const nuvio = (patternKind === "tmdb" ? posterUrlPatternNuvio : patternKind === "imdb" ? posterUrlPatternNuvioImdb : posterUrlPatternNuvioAuto)
                    || posterUrlPatternNuvio || posterUrlPatternNuvioImdb || posterUrlPatternNuvioAuto || ""
                  // Fallback: se il context non ha ancora generato la variante
                  // Nuvio, resta il template base (mai riga vuota).
                  return nuvio || (patternKind === "tmdb" ? posterUrlPattern : patternKind === "imdb" ? posterUrlPatternImdb : posterUrlPatternAuto) || posterUrlPattern || posterUrlPatternImdb || posterUrlPatternAuto || ""
                })()}
                tag={(() => {
                  const base = patternKind === "tmdb" ? t("ui.patternTagTmdb") : patternKind === "imdb" ? t("ui.patternTagImdb") : t("ui.patternTagAuto")
                  return nuvioShape ? `${base} · {shape}` : base
                })()}
                copyLabel={t("ui.aiomLinkTitle") || "AIOMetadata URL"}
              />
            </div>
          )}

          {/* GitHub Star Support Footer */}
          <div className="pt-2.5 border-t border-white/5 flex items-center justify-center">
            <a
              href="https://github.com/Eful97/Pictorium"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Star Pictorium on GitHub"
              className="group flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <span>Ti piace Pictorium?</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-400/10 border border-amber-400/20 text-amber-400 font-semibold group-hover:bg-amber-400/20 transition-all">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                <span>Lascia una stella su GitHub</span>
              </span>
            </a>
          </div>
        </div>
      </div>
    </Modal>
  )
}

