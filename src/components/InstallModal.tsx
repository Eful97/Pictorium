"use client"

import React, { useState, useEffect, useRef, useMemo } from "react"
import { usePSelector } from "@/lib/context"
import { X, Check, Copy, Download, ExternalLink, Tv } from "lucide-react"
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

type InstallTab = "stremio" | "aio" | "nuvio"

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-orange focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"

/** Riga template copiabile pulita ed essenziale. */
function PatternRow({ value, copyLabel }: { value: string; copyLabel: string }) {
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
    <div className="flex items-center gap-1.5 p-1.5 bg-black/50 border border-white/10 rounded-xl focus-within:border-accent-orange/40 transition-colors">
      <input
        type="text"
        readOnly
        value={value}
        aria-label={copyLabel}
        className="w-full bg-transparent px-2.5 py-1 text-xs sm:text-sm font-mono text-zinc-200 truncate select-all focus:outline-none"
      />
      <button
        type="button"
        onClick={handleCopy}
        className={`shrink-0 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-all cursor-pointer ${FOCUS_RING} ${
          copied
            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm"
            : "bg-accent-orange hover:bg-accent-orange/90 text-white shadow-sm active:scale-95"
        }`}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-white" />}
        <span>{copied ? t("ui.manifestCopied") : t("ui.copyManifest")}</span>
      </button>
    </div>
  )
}

/** QR code con placeholder di caricamento. */
function QrFigure({ svg, label, generatingLabel }: { svg: string; label: string; generatingLabel: string }) {
  if (!svg) {
    return (
      <div className="w-[144px] h-[144px] bg-white/5 rounded-xl border border-white/10 flex items-center justify-center text-zinc-500 text-xs sm:text-sm">
        {generatingLabel}
      </div>
    )
  }
  return (
    <div
      className="bg-white p-2 rounded-xl shadow-md ring-1 ring-black/10 [&>svg]:block [&>svg]:w-[144px] [&>svg]:h-[144px]"
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export function InstallModal({
  isOpen,
  onClose,
  manifestUrl: propManifestUrl,
  posterUrlPattern,
  posterUrlPatternImdb,
  posterUrlPatternAuto,
  posterUrlPatternNuvio,
  posterUrlPatternNuvioImdb,
  posterUrlPatternNuvioAuto,
  linkMode: controlledLinkMode,
  onLinkModeChange,
  hasUserSpace,
}: InstallModalProps) {
  const { t } = useT()
  // Device config token (local-only spaces): the install carries the device
  // catalog selection where no namespace exists.
  const localConfigToken = usePSelector((v) => v.localConfigToken)
  // Scheda attiva: "stremio" di default.
  const [activeTab, setActiveTab] = useState<InstallTab>("stremio")
  const [hubMode, setHubMode] = useState<"all" | "catalogs" | "search">("all")
  const [copied, setCopied] = useState(false)
  // Quale placeholder id usa il template: Auto (default), TMDB o IMDb.
  const [patternKind, setPatternKind] = useState<"tmdb" | "imdb" | "auto">("auto")
  // Modalità template poster: "follow" / "fixed"
  const [internalLinkMode, setInternalLinkMode] = useState<"follow" | "fixed">(hasUserSpace ? "follow" : "fixed")
  const linkMode = controlledLinkMode ?? internalLinkMode
  const setLinkMode = onLinkModeChange ?? setInternalLinkMode
  const [qrSvg, setQrSvg] = useState<string>("")
  const [baseManifestUrl, setBaseManifestUrl] = useState(propManifestUrl || "")
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

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
    // Namespace-less spaces (local-only): carry the device catalog selection
    // in a signed token instead of the empty global defaults.
    if (localConfigToken) {
      setBaseManifestUrl(`${window.location.origin}/c/${encodeURIComponent(localConfigToken)}/manifest.json`)
      return
    }
    setBaseManifestUrl(`${window.location.origin}/manifest.json`)
  }, [propManifestUrl, isOpen, localConfigToken])

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

  // Destinazioni esterne: ciascuna visibile solo se i relativi template sono forniti.
  const hasAio = Boolean(posterUrlPattern || posterUrlPatternImdb || posterUrlPatternAuto)
  const hasNuvio = Boolean(posterUrlPatternNuvio || posterUrlPatternNuvioImdb || posterUrlPatternNuvioAuto)

  const availableTabs = useMemo<InstallTab[]>(() => {
    const tabs: InstallTab[] = ["stremio"]
    if (hasAio) tabs.push("aio")
    if (hasNuvio) tabs.push("nuvio")
    return tabs
  }, [hasAio, hasNuvio])

  const hasTabs = availableTabs.length > 1

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab("stremio")
    }
  }, [activeTab, availableTabs])

  // Template per AIOMetadata (base, nessun placeholder shape)
  const displayedPatternAio = useMemo(() => {
    return (
      (patternKind === "tmdb" ? posterUrlPattern : patternKind === "imdb" ? posterUrlPatternImdb : posterUrlPatternAuto) ||
      posterUrlPattern ||
      posterUrlPatternImdb ||
      posterUrlPatternAuto ||
      ""
    )
  }, [patternKind, posterUrlPattern, posterUrlPatternImdb, posterUrlPatternAuto])

  // Template per Nuvio (formato automatico con shape={shape})
  const displayedPatternNuvio = useMemo(() => {
    return (
      (patternKind === "tmdb"
        ? posterUrlPatternNuvio
        : patternKind === "imdb"
        ? posterUrlPatternNuvioImdb
        : posterUrlPatternNuvioAuto) ||
      posterUrlPatternNuvio ||
      posterUrlPatternNuvioImdb ||
      posterUrlPatternNuvioAuto ||
      ""
    )
  }, [patternKind, posterUrlPatternNuvio, posterUrlPatternNuvioImdb, posterUrlPatternNuvioAuto])

  useEffect(() => {
    if (!isOpen || !resolvedManifestUrl) return
    QRCode.toString(resolvedManifestUrl, {
      type: "svg",
      margin: 1,
      width: 160,
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

  const handleTabKeyDown = (e: React.KeyboardEvent, tab: InstallTab) => {
    const idx = availableTabs.indexOf(tab)
    if (idx === -1) return
    let next: number | null = null
    if (e.key === "ArrowRight") next = (idx + 1) % availableTabs.length
    else if (e.key === "ArrowLeft") next = (idx - 1 + availableTabs.length) % availableTabs.length
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = availableTabs.length - 1
    if (next === null) return
    e.preventDefault()
    const nextTab = availableTabs[next]
    setActiveTab(nextTab)
    tabRefs.current[next]?.focus()
  }

  const tabClass = (selected: boolean) =>
    `flex-1 py-1.5 px-3 rounded-lg text-xs sm:text-sm font-semibold transition-all cursor-pointer ${FOCUS_RING} ${
      selected
        ? "bg-white/15 text-foreground shadow-sm border border-white/10"
        : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
    }`

  const hubModeClass = (selected: boolean) =>
    `py-2 px-2.5 rounded-xl text-center text-xs sm:text-sm font-semibold transition-all cursor-pointer border ${FOCUS_RING} ${
      selected
        ? "bg-accent-orange/15 border-accent-orange/50 text-foreground shadow-sm"
        : "bg-white/[0.03] border-white/10 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
    }`

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      labelledBy="install-hub-title"
      className="max-w-md w-full max-h-[90vh] overflow-y-auto p-0 space-y-0"
    >
      <div className="w-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-accent-orange">
              <Download className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 id="install-hub-title" className="text-base font-bold text-foreground tracking-tight leading-snug">
                {t("ui.installHubTitle")}
              </h2>
              <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">{t("ui.installHubSub")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("ui.close")}
            className={`p-2 text-zinc-400 hover:text-white rounded-xl hover:bg-white/10 active:scale-95 transition-all cursor-pointer ${FOCUS_RING}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5 space-y-4">
          {/* Schede Stremio · AIOMetadata · Nuvio */}
          {hasTabs && (
            <div
              role="tablist"
              aria-label={t("ui.installHubTitle")}
              className="flex gap-1 p-1 bg-black/40 border border-white/10 rounded-xl"
            >
              {availableTabs.map((tab, idx) => (
                <button
                  key={tab}
                  ref={(el) => {
                    tabRefs.current[idx] = el
                  }}
                  type="button"
                  role="tab"
                  id={`install-tab-${tab}`}
                  aria-selected={activeTab === tab}
                  aria-controls={`install-panel-${tab}`}
                  tabIndex={activeTab === tab ? 0 : -1}
                  onClick={() => setActiveTab(tab)}
                  onKeyDown={(e) => handleTabKeyDown(e, tab)}
                  className={tabClass(activeTab === tab)}
                >
                  {tab === "stremio" && t("ui.installTabStremio")}
                  {tab === "aio" && t("ui.installTabAio")}
                  {tab === "nuvio" && t("ui.installTabNuvio")}
                </button>
              ))}
            </div>
          )}

          {/* Scheda Stremio */}
          <div
            {...(hasTabs
              ? { role: "tabpanel", id: "install-panel-stremio", "aria-labelledby": "install-tab-stremio" }
              : {})}
            hidden={hasTabs && activeTab !== "stremio"}
          >
            <div className="space-y-4">
              {/* 1. Titolo "Cosa vuoi includere?" */}
              <div className="space-y-2">
                <h3 id="install-mode-heading" className="text-xs sm:text-sm font-semibold text-zinc-200">
                  {t("ui.installWhatInclude")}
                </h3>
                {/* 2. Selettore Completo / Cataloghi / Ricerca */}
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setHubMode("all")}
                    aria-pressed={hubMode === "all"}
                    className={hubModeClass(hubMode === "all")}
                  >
                    {t("ui.modeAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHubMode("catalogs")}
                    aria-pressed={hubMode === "catalogs"}
                    className={hubModeClass(hubMode === "catalogs")}
                  >
                    {t("ui.modeCatalogs")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHubMode("search")}
                    aria-pressed={hubMode === "search"}
                    className={hubModeClass(hubMode === "search")}
                  >
                    {t("ui.modeSearch")}
                  </button>
                </div>
                {/* 3. Una sola descrizione breve senza riquadro */}
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed pt-0.5">
                  {hubMode === "all" && t("ui.hubDescAll")}
                  {hubMode === "catalogs" && t("ui.hubDescCatalogs")}
                  {hubMode === "search" && t("ui.hubDescSearch")}
                </p>
              </div>

              {/* 4. Pulsante principale a larghezza piena */}
              <a
                href={stremioDeepLink}
                className={`w-full py-2.5 px-4 rounded-xl bg-accent-orange hover:bg-accent-orange/90 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all shadow-md shadow-accent-orange/20 active:scale-[0.98] ${FOCUS_RING}`}
              >
                <Download className="w-4 h-4" />
                <span>{t("ui.installInApp")}</span>
              </a>

              {/* 5. Azioni secondarie "Copia link" e "Apri Stremio Web" */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className={`w-full py-2 px-3 rounded-xl border text-xs sm:text-sm font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer ${FOCUS_RING} ${
                    copied
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm"
                      : "bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 border-white/10"
                  }`}
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-zinc-400" />}
                  <span>{copied ? t("ui.manifestCopied") : t("ui.copyManifest")}</span>
                </button>
                <a
                  href={stremioWebLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`w-full py-2 px-3 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] text-xs sm:text-sm font-medium text-zinc-300 hover:text-white flex items-center justify-center gap-1.5 transition-colors ${FOCUS_RING}`}
                >
                  <span>{t("ui.openWebStremio")}</span>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                </a>
              </div>

              {/* 6. Sezione espandibile QR code (desktop e mobile) */}
              <details className="border border-white/10 bg-white/[0.02] rounded-xl overflow-hidden group">
                <summary
                  className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer text-xs sm:text-sm font-medium text-zinc-300 hover:text-white transition-colors select-none ${FOCUS_RING}`}
                >
                  <span className="flex items-center gap-2">
                    <Tv className="w-4 h-4 text-accent-orange" />
                    <span>{t("ui.installOtherDevice")}</span>
                  </span>
                  <span className="text-[10px] text-zinc-500 group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="flex flex-col items-center gap-2.5 p-4 border-t border-white/5 bg-black/20">
                  <QrFigure svg={qrSvg} label={t("ui.qrAria")} generatingLabel={t("ui.qrGenerating")} />
                  <p className="text-xs text-zinc-400 text-center">{t("ui.scanQr")}</p>
                </div>
              </details>
            </div>
          </div>

          {/* Scheda AIOMetadata */}
          {hasAio && (
            <div
              role="tabpanel"
              id="install-panel-aio"
              aria-labelledby="install-tab-aio"
              hidden={activeTab !== "aio"}
            >
              <div className="space-y-4">
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  {t("ui.installAioDesc")}
                </p>

                {/* Campo URL con pulsante Copia link */}
                <PatternRow
                  value={displayedPatternAio}
                  copyLabel={t("ui.aiomLinkTitle")}
                />

                {/* Breve indicazione modalità corrente */}
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  <strong className="text-zinc-200">{t(linkMode === "follow" ? "ui.linkModeFollow" : "ui.linkModeFixed")}</strong>:{" "}
                  {t(linkMode === "follow" ? "ui.linkModeFollowSub" : "ui.linkModeFixedSub")}
                </p>

                {/* Opzioni avanzate */}
                <details className="text-xs sm:text-sm border border-white/10 bg-white/[0.02] rounded-xl overflow-hidden group">
                  <summary
                    className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer font-medium text-zinc-300 hover:text-white transition-colors select-none ${FOCUS_RING}`}
                  >
                    <span>{t("ui.linkModeAdvanced")}</span>
                    <span className="text-[10px] text-zinc-500 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="p-3.5 border-t border-white/5 space-y-3 bg-black/20">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="pattern-kind-select-aio" className="text-xs sm:text-sm text-zinc-400 font-medium shrink-0">
                        ID:
                      </label>
                      <select
                        id="pattern-kind-select-aio"
                        value={patternKind}
                        onChange={(e) => setPatternKind(e.target.value === "imdb" ? "imdb" : e.target.value === "auto" ? "auto" : "tmdb")}
                        className="bg-black/60 border border-white/10 rounded-xl px-3 py-1.5 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-accent-orange/50 cursor-pointer"
                      >
                        <option value="auto">{t("ui.patternAuto")}</option>
                        <option value="tmdb">TMDB ID</option>
                        <option value="imdb">IMDb ID</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2.5 cursor-pointer text-zinc-300 hover:text-white">
                      <input
                        type="checkbox"
                        checked={linkMode === "fixed"}
                        onChange={(e) => setLinkMode(e.target.checked ? "fixed" : "follow")}
                        className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-accent-orange focus:ring-accent-orange cursor-pointer"
                      />
                      <span>{t("ui.linkModeFixed")}</span>
                    </label>
                  </div>
                </details>
              </div>
            </div>
          )}

          {/* Scheda Nuvio */}
          {hasNuvio && (
            <div
              role="tabpanel"
              id="install-panel-nuvio"
              aria-labelledby="install-tab-nuvio"
              hidden={activeTab !== "nuvio"}
            >
              <div className="space-y-4">
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  {t("ui.installNuvioDesc")}
                </p>

                {/* Campo URL con pulsante Copia link (formato Nuvio auto-shape) */}
                <PatternRow
                  value={displayedPatternNuvio}
                  copyLabel={t("ui.aiomLinkTitle")}
                />

                {/* Breve indicazione modalità corrente */}
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  <strong className="text-zinc-200">{t(linkMode === "follow" ? "ui.linkModeFollow" : "ui.linkModeFixed")}</strong>:{" "}
                  {t(linkMode === "follow" ? "ui.linkModeFollowSub" : "ui.linkModeFixedSub")}
                </p>

                {/* Opzioni avanzate */}
                <details className="text-xs sm:text-sm border border-white/10 bg-white/[0.02] rounded-xl overflow-hidden group">
                  <summary
                    className={`flex items-center justify-between px-3.5 py-2.5 cursor-pointer font-medium text-zinc-300 hover:text-white transition-colors select-none ${FOCUS_RING}`}
                  >
                    <span>{t("ui.linkModeAdvanced")}</span>
                    <span className="text-[10px] text-zinc-500 group-open:rotate-180 transition-transform">▼</span>
                  </summary>
                  <div className="p-3.5 border-t border-white/5 space-y-3 bg-black/20">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="pattern-kind-select-nuvio" className="text-xs sm:text-sm text-zinc-400 font-medium shrink-0">
                        ID:
                      </label>
                      <select
                        id="pattern-kind-select-nuvio"
                        value={patternKind}
                        onChange={(e) => setPatternKind(e.target.value === "imdb" ? "imdb" : e.target.value === "auto" ? "auto" : "tmdb")}
                        className="bg-black/60 border border-white/10 rounded-xl px-3 py-1.5 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-accent-orange/50 cursor-pointer"
                      >
                        <option value="auto">{t("ui.patternAuto")}</option>
                        <option value="tmdb">TMDB ID</option>
                        <option value="imdb">IMDb ID</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2.5 cursor-pointer text-zinc-300 hover:text-white">
                      <input
                        type="checkbox"
                        checked={linkMode === "fixed"}
                        onChange={(e) => setLinkMode(e.target.checked ? "fixed" : "follow")}
                        className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-accent-orange focus:ring-accent-orange cursor-pointer"
                      />
                      <span>{t("ui.linkModeFixed")}</span>
                    </label>
                  </div>
                </details>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
