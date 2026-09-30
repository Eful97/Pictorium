"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import type { TMDBImage } from "@/lib/types"
import { LANG_NAMES, groupBy, isCustomPosterUrl } from "@/lib/utils"
import { PosterBtn } from "@/components/PosterBtn"
import { PosterTabs } from "@/components/PosterTabs"
import { FitDebugPanel } from "@/components/FitDebugPanel"
import { usePSelector } from "@/lib/context"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { usePosterFit } from "@/lib/usePosterFit"
import { useFanartPosters } from "@/lib/useFanartPosters"
import { RotateCcw, Check, Clock, Sparkles, ArrowUpDown, EyeOff, ChevronDown, X, Loader2 } from "lucide-react"

interface Props {
  posters: TMDBImage[]
  posterActivePath: string | null
  lang: string
  selectPoster: (img: TMDBImage) => void
  activeGroup?: string
  onActiveGroupChange?: (key: string) => void
  showTabs?: boolean
  /** Slot sotto i tab (es. box URL poster personalizzato). */
  topSlot?: ReactNode
  /** Tile custom di sessione (URL esterni): primi in griglia, con tasto di
   *  rimozione, fuori da rotazione/esclusioni/best-fit (path TMDB only). */
  customPosters?: TMDBImage[]
  /** Tile custom salvato nel mapping: in griglia senza tasto rimozione (si
   *  rimuove dal box con "Rimuovi immagine personalizzata"). */
  savedCustomPoster?: TMDBImage | null
  /** Rimozione di un tile di sessione (solo customPosters, mai il salvato). */
  onRemoveCustomPoster?: (filePath: string) => void
}

export function PosterOptions({ posters, posterActivePath, lang, selectPoster, activeGroup: controlledActiveGroup, onActiveGroupChange, showTabs = true, topSlot, customPosters = [], savedCustomPoster = null, onRemoveCustomPoster }: Props) {
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const selected = usePSelector((v) => v.selected)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const autoSaveExcludedPosters = usePSelector((v) => v.autoSaveExcludedPosters)
  const { t } = useT()
  const ed = usePosterEditor()

  const excludedSet = useMemo(() => new Set(ed.excludedPosters), [ed.excludedPosters])

  const cleanPosters = useMemo(() => posters.filter((img) => img.iso_639_1 === null && !excludedSet.has(img.file_path) && !isCustomPosterUrl(img.file_path)), [posters, excludedSet])
  const customCount = customPosters.length + (savedCustomPoster ? 1 : 0)
  const hasClean = cleanPosters.length > 0 || customCount > 0
  const langGroups = useMemo(
    () => Object.entries(groupBy(posters.filter((img) => img.iso_639_1 !== null), (img) => img.iso_639_1 || "other")).sort(([a], [b]) => {
      if (a === lang) return -1; if (b === lang) return 1
      if (a === "en") return -1; if (b === "en") return 1
      return a.localeCompare(b)
    }),
    [lang, posters],
  )

  const [internalActiveGroup, setInternalActiveGroup] = useState("clean")
  const activeGroup = controlledActiveGroup ?? internalActiveGroup
  const setActiveGroup = onActiveGroupChange ?? setInternalActiveGroup

  // Fanart.tv: fetch lazy solo a tab aperta (mai all'apertura del titolo).
  const fanart = useFanartPosters(activeGroup === "fanart")

  const posterTabs = useMemo(() => {
    const tabs: { key: string; label: string; count: number }[] = []
    if (hasClean) tabs.push({ key: "clean", label: "Clean", count: cleanPosters.length + customPosters.length + (savedCustomPoster ? 1 : 0) })
    for (const [language, imgs] of langGroups) {
      if (imgs.length > 0) tabs.push({ key: language, label: LANG_NAMES[language] || language, count: imgs.length })
    }
    // Tab Fanart.tv alla pari delle lingue: solo a titolo selezionato.
    if (selected) tabs.push({ key: "fanart", label: t("ui.fanartTitle"), count: fanart.posters.length })
    return tabs
  }, [hasClean, cleanPosters.length, customPosters.length, savedCustomPoster, langGroups, selected, fanart.posters.length, t])

  useEffect(() => {
    if (posterTabs.length > 0 && !posterTabs.some((t) => t.key === activeGroup)) {
      setActiveGroup(posterTabs[0]?.key ?? "clean")
    }
  }, [posterTabs, activeGroup, setActiveGroup])

  let idx = 0

  const { bestFitPath, results, loading: fitLoading, error: fitError } = usePosterFit({
    enabled: ed.defaultPortraitFitEnabled,
    selectedLogo: selectedLogo,
    cleanPosters,
    logoScale: ed.logoScale,
    logoOffsetX: ed.logoOffsetX,
    logoOffsetY: ed.logoOffsetY,
    hasBadges: ed.globalBadges,
  })

  const scoreMap = useMemo(() => new Map(results.map((r) => [r.posterPath, r.adjustedScore])), [results])
  const hasFitData = results.length > 0

  const bestResult = bestFitPath ? results.find((r) => r.posterPath === bestFitPath) : undefined
  const bestScore = bestResult?.adjustedScore ?? 0
  const bestPoster = bestFitPath ? cleanPosters.find((p) => p.file_path === bestFitPath) : undefined
  const isBestSelected = bestPoster ? posterActivePath === bestPoster.file_path : false

  const isSavedPoster = useMemo(() => {
    if (!selected) return false
    const mediaType = selected.media_type === "tv" ? "tv" : "movie"
    return mappingsMap.has(`${mediaType}:${selected.id}`)
  }, [mappingsMap, selected])

  const topFitRotationPosters = useMemo(() => {
    if (results.length === 0) return []
    const cleanPosterPaths = new Set(cleanPosters.map((poster) => poster.file_path))
    return results
      .filter((result) => cleanPosterPaths.has(result.posterPath))
      .slice(0, 10)
      .map((result) => result.posterPath)
  }, [cleanPosters, results])

  const populatedRotationRef = useRef(false)
  useEffect(() => {
    populatedRotationRef.current = false
  }, [selected?.id])
  useEffect(() => {
    if (isSavedPoster) return
    if (topFitRotationPosters.length === 0 || fitLoading) return
    if (ed.rotationPosters.length > 0) { populatedRotationRef.current = false; return }
    if (populatedRotationRef.current) return
    populatedRotationRef.current = true
    ed.setRotationPosters(topFitRotationPosters)
    if (ed.defaultAutoRotateClean && topFitRotationPosters.length > 1) {
      ed.setAutoRotateClean(true)
    }
  }, [topFitRotationPosters, fitLoading, isSavedPoster]) // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only on fit results

  const [sortByFit, setSortByFit] = useState(false)
  const [showFitDebug, setShowFitDebug] = useState(false)
  const autoSelectedFitKeyRef = useRef<string | null>(null)

  useEffect(() => {
    setSortByFit(false)
    autoSelectedFitKeyRef.current = null
  }, [selected?.id])

  const autoSelectFitKey = useMemo(() => {
    if (!ed.defaultPortraitFitEnabled || !bestPoster || !selectedLogo) return null
    return JSON.stringify([
      bestPoster.file_path,
      cleanPosters.map((poster) => poster.file_path),
      selectedLogo.file_path,
      ed.globalBadges,
    ])
  }, [
    bestPoster,
    cleanPosters,
    ed.defaultPortraitFitEnabled,
    ed.globalBadges,
    selectedLogo,
  ])

  useEffect(() => {
    if (isSavedPoster) {
      autoSelectedFitKeyRef.current = null
      return
    }
    if (!autoSelectFitKey || !bestPoster || fitLoading) {
      if (!autoSelectFitKey) autoSelectedFitKeyRef.current = null
      return
    }
    if (isBestSelected) {
      autoSelectedFitKeyRef.current = autoSelectFitKey
      return
    }
    if (autoSelectedFitKeyRef.current === autoSelectFitKey) return
    autoSelectedFitKeyRef.current = autoSelectFitKey
    setSortByFit(true)
    selectPoster(bestPoster)
  }, [autoSelectFitKey, bestPoster, fitLoading, isBestSelected, isSavedPoster, selectPoster])

  const displayPosters = useMemo(() => {
    if (!sortByFit) return cleanPosters
    return [...cleanPosters].sort(
      (a, b) => (scoreMap.get(b.file_path) ?? -1) - (scoreMap.get(a.file_path) ?? -1),
    )
  }, [sortByFit, cleanPosters, scoreMap])

  const [visibleCleanCount, setVisibleCleanCount] = useState(12)
  const [visibleLangCount, setVisibleLangCount] = useState(12)

  useEffect(() => {
    setVisibleCleanCount(12)
    setVisibleLangCount(12)
  }, [selected?.id, activeGroup, sortByFit])

  const visibleCleanPosters = useMemo(() => {
    return displayPosters.slice(0, visibleCleanCount)
  }, [displayPosters, visibleCleanCount])

  const activeClean = activeGroup === "clean"
  const activeFanart = activeGroup === "fanart"
  const activeLangImgs = useMemo(() => {
    return !activeClean && !activeFanart ? langGroups.find(([l]) => l === activeGroup)?.[1] ?? [] : []
  }, [activeClean, activeFanart, langGroups, activeGroup])

  const visibleLangImgs = useMemo(() => {
    return activeLangImgs.slice(0, visibleLangCount)
  }, [activeLangImgs, visibleLangCount])

  const toggleRotation = (filePath: string) => {
    ed.setRotationPosters((prev) => {
      if (prev.includes(filePath)) return prev.filter((f) => f !== filePath)
      return [...prev, filePath]
    })
  }

  const toggleAutoRotateClean = () => {
    const next = !ed.autoRotateClean
    if (next && topFitRotationPosters.length > 0) {
      ed.setRotationPosters(topFitRotationPosters)
    }
    ed.setAutoRotateClean(next)
  }

  const [excludedSaveState, setExcludedSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")

  const excludePoster = (filePath: string) => {
    // Fix L29: rollback su errore — prima l'exclude ottimistico restava in UI
    // anche se il salvataggio falliva (mostrava escluso, disco no).
    const prevExcluded = ed.excludedPosters
    const prevRotation = ed.rotationPosters
    const nextExcluded = Array.from(new Set([...ed.excludedPosters, filePath]))
    const nextRotationPosters = ed.rotationPosters.filter((path) => path !== filePath)
    ed.setExcludedPosters(nextExcluded)
    ed.setRotationPosters(nextRotationPosters)
    setExcludedSaveState("saving")
    // Se escludiamo il poster attivo, seleziona un fallback valido e passalo al
    // save: altrimenti il mapping resterebbe agganciato al poster appena escluso.
    // Cerca prima tra i clean, poi tra tutti i poster (incluse le lingue) non esclusi.
    let fallback: TMDBImage | undefined
    if (posterActivePath === filePath) {
      fallback =
        cleanPosters.find((poster) => poster.file_path !== filePath) ??
        posters.find((poster) => poster.file_path !== filePath && !nextExcluded.includes(poster.file_path))
      if (fallback) selectPoster(fallback)
    }
    autoSaveExcludedPosters(nextExcluded, nextRotationPosters, fallback)
      .then(() => { setExcludedSaveState("saved"); toast.success(t("ui.posterExcluded")) })
      .catch(() => {
        // Rollback dello stato ottimistico: l'UI torna a riflettere il disco.
        ed.setExcludedPosters(prevExcluded)
        ed.setRotationPosters(prevRotation)
        setExcludedSaveState("error")
        toast.error(t("ui.saveError"))
      })
  }

  function shortPath(p: string): string {
    return p.length > 18 ? `${p.slice(0, 10)}...${p.slice(-6)}` : p
  }

  function scoreClass(s: number): string {
    if (s >= 0.65) return "text-green-400"
    if (s >= 0.45) return "text-amber-400"
    return "text-danger"
  }

  return (
    <div>
      {showTabs && (
        <PosterTabs tabs={posterTabs} activeGroup={activeGroup} onSelect={setActiveGroup} />
      )}
      {topSlot}

      {activeClean && hasClean && (
        <div className="space-y-2 mb-2 px-1">
          {isBestSelected && (
            <div className="editor-pill">
              <Check className="w-3 h-3" />{t("ui.bestFitSelected")}
            </div>
          )}
          {ed.rotationPosters.length > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted flex items-center gap-1"><Clock className="w-3 h-3" />{t("ui.autoRotate")}</span>
              <button type="button"
                aria-label={ed.autoRotateClean ? t("ui.removeFromRotation") : t("ui.autoRotate")}
                onClick={toggleAutoRotateClean}
                className={`px-2 py-1 text-[11px] font-semibold rounded-lg border transition-all ${ed.autoRotateClean ? "bg-accent-orange/20 text-accent-orange border-accent-orange/25 animate-pulse-ring" : "bg-white/5 text-muted border-white/10"}`}
              >
                {ed.autoRotateClean ? <><Check className="w-3 h-3 inline mr-1" />ON</> : "OFF"}
              </button>
            </div>
          )}
          {hasFitData && (
            <div className="flex items-center justify-between">
              <span className="control-label flex items-center gap-1"><ArrowUpDown className="w-3 h-3" />{t("ui.posterOrder")}</span>
              <div className="segmented-control">
                <button type="button"
                  aria-label={t("ui.sortByTmdb")}
                  onClick={() => setSortByFit(false)}
                  className={`segmented-option ${!sortByFit ? "segmented-option-active" : ""}`}
                >
                  {t("ui.tmdb")}
                </button>
                <button type="button"
                  aria-label={t("ui.sortByBestFit")}
                  onClick={() => setSortByFit(true)}
                  className={`segmented-option ${sortByFit ? "segmented-option-active" : ""}`}
                >
                  {t("ui.bestFit")}
                </button>
              </div>
            </div>
          )}
          {(bestPoster && !isBestSelected && !fitLoading) && (
            <button type="button"
              aria-label={t("ui.chooseBestPosterAria")}
              onClick={() => selectPoster(bestPoster)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all duration-150 bg-accent-orange/15 text-accent-orange hover:bg-accent-orange/25 active:scale-[0.98]"
            >
              <Sparkles className="w-3 h-3" />{t("ui.chooseBestPoster")}
            </button>
          )}
          {fitLoading && (
            <div className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-zinc-500">
              <Clock className="w-3 h-3 animate-spin" />{t("ui.analyzing")}
            </div>
          )}
          {fitError && !fitLoading && (
            <div className="px-3 py-1.5 text-[10px] text-amber-400/90 leading-relaxed">
              {fitError}
            </div>
          )}
          {hasFitData && (
            <button
              type="button"
              aria-label={showFitDebug ? t("ui.hideDebug") : t("ui.showDebug")}
              onClick={() => setShowFitDebug((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-medium rounded-lg transition-all duration-150 text-zinc-600 hover:text-muted hover:bg-white/[0.03]"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              {showFitDebug ? t("ui.hide") : t("ui.debugFit")}
            </button>
          )}
        </div>
      )}

      {activeClean && hasClean && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {/* Tile custom di sessione: primi in griglia, con tasto rimozione. */}
            {customPosters.map((img, ci) => (
              <div key={`custom:${img.file_path}`} className="relative group rounded-xl overflow-hidden">
                <PosterBtn staggerIndex={ci} img={img} active={posterActivePath === img.file_path} onSelect={selectPoster} title={t("ui.customPosterActive")} />
                {onRemoveCustomPoster && (
                  <div className="absolute top-1.5 right-1.5 z-20 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button type="button"
                      aria-label={t("ui.remove")}
                      title={t("ui.remove")}
                      onClick={(e) => { e.stopPropagation(); onRemoveCustomPoster(img.file_path) }}
                      className="w-6 h-6 rounded-lg flex items-center justify-center backdrop-blur-md border transition-all duration-150 bg-black/55 border-white/10 text-zinc-300 hover:bg-red-500/90 hover:text-white hover:border-red-400/60"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {/* Tile custom salvato: in griglia senza rimozione (dal box). */}
            {savedCustomPoster && (
              <div key={`custom-saved:${savedCustomPoster.file_path}`}>
                <PosterBtn staggerIndex={customPosters.length} img={savedCustomPoster} active={posterActivePath === savedCustomPoster.file_path} onSelect={selectPoster} title={t("ui.customPosterActive")} />
              </div>
            )}
            {visibleCleanPosters.map((img) => {
              const stagger = idx++
              const inRotation = ed.rotationPosters.includes(img.file_path)
              const isBestFit = bestFitPath === img.file_path
              const showBadge = isBestFit && bestScore >= 0.45
              const isHighScore = bestScore >= 0.65
              return (
                <div key={img.file_path} className={`relative group rounded-xl overflow-hidden ${isBestFit && bestScore >= 0.45 ? `ring-1 ${isHighScore ? "ring-orange-400/70 shadow-[0_0_18px_rgba(232,93,42,0.12)]" : "ring-amber-400/50"}` : ""}`}>
                  <PosterBtn staggerIndex={stagger} img={img} active={posterActivePath === img.file_path} onSelect={selectPoster} />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 to-transparent opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity" />
                  {showBadge && (
                    <div className={`fit-badge z-20 ${isHighScore ? "fit-badge-amber" : ""}`}>
                      <Sparkles className="w-2.5 h-2.5 inline mr-0.5" />
                      {isHighScore ? t("ui.bestFit") : t("ui.bestFitAlt")}
                    </div>
                  )}
                  <div className="absolute top-1.5 right-1.5 z-20 flex flex-col gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button type="button"
                      aria-label={inRotation ? t("ui.removeFromRotation") : t("ui.addToRotation")}
                      onClick={(e) => { e.stopPropagation(); toggleRotation(img.file_path) }}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center backdrop-blur-md border transition-all duration-150 ${inRotation ? "bg-accent-orange text-white border-accent-orange shadow-sm shadow-accent-orange/40" : "bg-black/55 border-white/10 text-zinc-200 hover:bg-accent-orange/90 hover:text-white hover:border-accent-orange/60"}`}
                      title={inRotation ? t("ui.removeFromRotation") : t("ui.addToRotation")}
                    >
                      {inRotation ? <Check className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    </button>
                    <button type="button"
                      aria-label={t("ui.excludePoster")}
                      onClick={(e) => { e.stopPropagation(); excludePoster(img.file_path) }}
                      className="w-6 h-6 rounded-lg flex items-center justify-center backdrop-blur-md border transition-all duration-150 bg-black/55 border-white/10 text-zinc-300 hover:bg-red-500/90 hover:text-white hover:border-red-400/60"
                      title={t("ui.excludePoster")}
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {displayPosters.length > visibleCleanCount && (
            <button
              type="button"
              aria-label={t("ui.loadMorePostersAria")}
              onClick={() => setVisibleCleanCount((prev) => prev + 12)}
              className="btn-secondary w-full mt-3 py-2 px-3 text-xs"
            >
              <ChevronDown className="w-4 h-4" />
              {t("ui.loadMorePosters", { count: Math.min(12, displayPosters.length - visibleCleanCount) })}
              <span className="text-[10px] text-zinc-500 font-normal">{t("ui.xOfY", { current: visibleCleanCount, total: displayPosters.length })}</span>
            </button>
          )}
        </>
      )}

      {activeClean && showFitDebug && hasFitData && (
        <FitDebugPanel results={results} bestResult={bestResult} shortPath={shortPath} scoreClass={scoreClass} t={t} />
      )}

      {activeClean && !hasClean && (
        <p className="text-center py-12 text-muted text-xs">{t("ui.loading")}</p>
      )}

      {!activeClean && !activeFanart && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {visibleLangImgs.map((img) => {
              const stagger = idx++
              return <PosterBtn key={img.file_path} staggerIndex={stagger} img={img} active={posterActivePath === img.file_path} onSelect={selectPoster} />
            })}
          </div>

          {activeLangImgs.length > visibleLangCount && (
            <button
              type="button"
              aria-label={t("ui.loadMorePostersAria")}
              onClick={() => setVisibleLangCount((prev) => prev + 12)}
              className="btn-secondary w-full mt-3 py-2 px-3 text-xs"
            >
              <ChevronDown className="w-4 h-4" />
              {t("ui.loadMorePosters", { count: Math.min(12, activeLangImgs.length - visibleLangCount) })}
              <span className="text-[10px] text-zinc-500 font-normal">{t("ui.xOfY", { current: visibleLangCount, total: activeLangImgs.length })}</span>
            </button>
          )}
        </>
      )}

      {activeFanart && (
        <div data-testid="fanart-tab-panel">
          {(fanart.status === "idle" || fanart.status === "loading") && (
            <p className="flex items-center justify-center gap-1.5 py-12 text-[11px] text-zinc-500" role="status">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              {t("ui.fanartLoading")}
            </p>
          )}
          {fanart.status === "empty" && (
            <p className="py-12 text-center text-[11px] text-zinc-500">{t("ui.fanartEmpty")}</p>
          )}
          {fanart.status === "not_configured" && (
            <p className="py-12 px-2 text-center text-[11px] text-zinc-500 leading-relaxed">{t("ui.fanartNotConfigured")}</p>
          )}
          {fanart.status === "unavailable" && (
            <div className="py-8 text-center">
              <p className="text-[11px] text-zinc-500">{t("ui.fanartUnavailable")}</p>
              <button
                type="button"
                onClick={() => fanart.reload()}
                className="mt-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] font-semibold text-zinc-300 hover:text-white hover:bg-white/10 transition-all"
              >
                {t("ui.retry")}
              </button>
            </div>
          )}
          {fanart.status === "ready" && (
            <div className="grid grid-cols-3 gap-2">
              {fanart.posters.map((tile, i) => {
                const m = fanart.meta[i]
                const lang = m?.lang ?? null
                const langLabel = !lang || lang === "00" ? t("ui.fanartLangUnknown") : LANG_NAMES[lang] || lang
                return (
                  <PosterBtn
                    key={tile.file_path}
                    staggerIndex={i}
                    img={tile}
                    active={posterActivePath === tile.file_path}
                    onSelect={selectPoster}
                    title={`${langLabel} · ♥ ${m?.likes ?? 0}`}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {activeClean && ed.rotationPosters.length > 0 && (
        <p className="text-[11px] text-zinc-500 mt-1.5 px-1">{ed.rotationPosters.length} {t("ui.selectedCount", { count: ed.rotationPosters.length })}</p>
      )}
      {activeClean && ed.excludedPosters.length > 0 && (
        <div className="mt-2 flex items-center justify-between rounded-lg border border-surface2/70 bg-white/5 px-2.5 py-2">
          <span className="text-[11px] text-muted flex items-center gap-1.5">
            <span>{ed.excludedPosters.length} {ed.excludedPosters.length === 1 ? t("ui.excludedCountOne") : t("ui.excludedCountMany")}</span>
            {excludedSaveState === "saving" && <span className="text-[10px] text-zinc-500 animate-pulse">{t("ui.saveStateSaving")}</span>}
            {excludedSaveState === "saved" && <span className="text-[10px] text-green-500">{t("ui.saveStateSaved")}</span>}
            {excludedSaveState === "error" && <span className="text-[10px] text-danger">{t("ui.saveStateError")}</span>}
          </span>
          <button type="button" onClick={() => { ed.setExcludedPosters([]); setExcludedSaveState("saving"); autoSaveExcludedPosters([], ed.rotationPosters).then(() => { setExcludedSaveState("saved"); toast.success(t("ui.cancel")) }).catch(() => { setExcludedSaveState("error"); toast.error(t("ui.saveError")) }) }} className="text-[11px] text-accent-orange hover:text-orange-300">
            {t("ui.restore")}
          </button>
        </div>
      )}

      {posters.length === 0 && <p className="text-center py-12 text-muted">{t("ui.loading")}</p>}
    </div>
  )
}
