"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import type { TMDBImage } from "@/lib/types"
import { PosterBtn } from "@/components/PosterBtn"
import { usePSelector } from "@/lib/context"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterFit } from "@/lib/usePosterFit"
import { ArrowUpDown, Check, ChevronDown, Clock, EyeOff, RotateCcw, Sparkles } from "lucide-react"

/** Sfondi visibili prima del "carica altri" (come i poster: paging, non scroll infinito). */
const VISIBLE_BACKDROP_COUNT = 10

/** Candidati inviati all'analisi best-fit: i primi bastano (il best sta in
 *  testa a TMDB), il resto resta visibile ma non pagato in fetch/CPU. */
const FIT_CANDIDATE_COUNT = 8

interface BackdropOptionsProps {
  backdrops: TMDBImage[]
  backdropActivePath: string | null
  selectBackdrop: (img: TMDBImage) => void
  clearBackdrop: () => void
  /** True mentre le immagini del titolo stanno ancora caricando. */
  loading?: boolean
}

/**
 * Selettore sfondi TMDB per la vista orizzontale: sostituisce PosterOptions
 * nel pannello sinistro quando `posterShape === "landscape"`.
 * Ricliccare lo sfondo attivo lo deseleziona (torna all'auto TMDB).
 * Include il best-fit orizzontale (shape landscape, 768×432, Cinematic Left):
 * ordinamento TMDB/Best Fit, badge sul vincente e selezione in 1 click.
 */
export function BackdropOptions({ backdrops, backdropActivePath, selectBackdrop, clearBackdrop, loading }: BackdropOptionsProps) {
  const { t } = useT()
  const ed = usePosterEditor()
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const selected = usePSelector((v) => v.selected)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const autoSaveExcludedBackdrops = usePSelector((v) => v.autoSaveExcludedBackdrops)

  const excludedSet = useMemo(() => new Set(ed.excludedBackdrops), [ed.excludedBackdrops])

  const cleanBackdrops = useMemo(
    () => backdrops.filter((img) => img.iso_639_1 === null && !excludedSet.has(img.file_path)),
    [backdrops, excludedSet],
  )

  const fitCandidates = useMemo(
    () => cleanBackdrops.slice(0, FIT_CANDIDATE_COUNT),
    [cleanBackdrops],
  )

  const { bestFitPath, results, loading: fitLoading, error: fitError } = usePosterFit({
    enabled: ed.defaultLandscapeFitEnabled,
    selectedLogo,
    cleanPosters: fitCandidates,
    logoScale: ed.logoScale,
    logoOffsetX: ed.logoOffsetX,
    logoOffsetY: ed.logoOffsetY,
    hasBadges: ed.globalBadges,
    shape: "landscape",
    posterSize: "w780",
  })

  const scoreMap = useMemo(() => new Map(results.map((r) => [r.posterPath, r.adjustedScore])), [results])
  const hasFitData = results.length > 0

  const bestResult = bestFitPath ? results.find((r) => r.posterPath === bestFitPath) : undefined
  const bestScore = bestResult?.adjustedScore ?? 0
  const bestBackdrop = bestFitPath ? cleanBackdrops.find((p) => p.file_path === bestFitPath) : undefined
  const isBestSelected = bestBackdrop ? backdropActivePath === bestBackdrop.file_path : false

  const isSavedBackdrop = useMemo(() => {
    if (!selected) return false
    const mediaType = selected.media_type === "tv" ? "tv" : "movie"
    return mappingsMap.has(`${mediaType}:${selected.id}`)
  }, [mappingsMap, selected])

  const [sortByFit, setSortByFit] = useState(false)
  const [visibleCount, setVisibleCount] = useState(VISIBLE_BACKDROP_COUNT)
  const autoSelectedFitKeyRef = useRef<string | null>(null)
  // Explicit user gesture per title (media:id): a manual pick or a voluntary
  // clear wins over late automation (best-fit) while the same title stays
  // open — no choice override, no automatic reorder.
  const userPickedKeyRef = useRef<string | null>(null)
  const titleKey = selected ? `${selected.media_type === "tv" ? "tv" : "movie"}:${selected.id}` : null
  const markUserPicked = () => {
    if (titleKey) userPickedKeyRef.current = titleKey
  }

  useEffect(() => {
    setSortByFit(false)
    setVisibleCount(VISIBLE_BACKDROP_COUNT)
    autoSelectedFitKeyRef.current = null
    // A new title re-arms automation. Keyed by media:id (not bare id) so
    // movie:7 -> tv:7 also resets; same-title rerenders never reach here.
    userPickedKeyRef.current = null
  }, [titleKey])

  // Auto-selezione best backdrop (mirror dei verticali): solo titoli non
  // salvati, solo al cambio chiave (niente loop con l'effetto "primo sfondo"
  // di EditView, che non tocca una selezione già impostata).
  const autoSelectFitKey = useMemo(() => {
    if (!ed.defaultLandscapeFitEnabled || !bestBackdrop || !selectedLogo) return null
    return JSON.stringify([
      bestBackdrop.file_path,
      fitCandidates.map((b) => b.file_path),
      selectedLogo.file_path,
      ed.globalBadges,
    ])
  }, [
    bestBackdrop,
    fitCandidates,
    ed.defaultLandscapeFitEnabled,
    ed.globalBadges,
    selectedLogo,
  ])

  useEffect(() => {
    if (isSavedBackdrop) {
      autoSelectedFitKeyRef.current = null
      return
    }
    // An explicit manual choice for the same title: late results neither
    // override it nor reorder the grid on their own. Without any gesture,
    // automation stays (preserved feature).
    if (titleKey && userPickedKeyRef.current === titleKey) return
    if (!autoSelectFitKey || !bestBackdrop || fitLoading) {
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
    selectBackdrop(bestBackdrop)
  }, [autoSelectFitKey, bestBackdrop, fitLoading, isBestSelected, isSavedBackdrop, selectBackdrop, titleKey])

  useEffect(() => {
    setVisibleCount(VISIBLE_BACKDROP_COUNT)
  }, [sortByFit])

  const displayBackdrops = useMemo(() => {
    if (!sortByFit) return cleanBackdrops
    return [...cleanBackdrops].sort(
      (a, b) => (scoreMap.get(b.file_path) ?? -1) - (scoreMap.get(a.file_path) ?? -1),
    )
  }, [sortByFit, cleanBackdrops, scoreMap])

  const visibleBackdrops = useMemo(() => {
    return displayBackdrops.slice(0, visibleCount)
  }, [displayBackdrops, visibleCount])

  // Rotazione 24h (mirror dei verticali): top-fit popola la lista per i
  // titoli non salvati, toggle per card, auto-rotate ON/OFF per-titolo.
  const topFitRotationBackdrops = useMemo(() => {
    if (results.length === 0) return []
    const cleanPaths = new Set(cleanBackdrops.map((b) => b.file_path))
    return results
      .filter((result) => cleanPaths.has(result.posterPath))
      .slice(0, 10)
      .map((result) => result.posterPath)
  }, [cleanBackdrops, results])

  const populatedRotationRef = useRef(false)
  useEffect(() => {
    populatedRotationRef.current = false
  }, [selected?.id])
  useEffect(() => {
    if (isSavedBackdrop) return
    if (topFitRotationBackdrops.length === 0 || fitLoading) return
    if (ed.rotationBackdrops.length > 0) { populatedRotationRef.current = false; return }
    if (populatedRotationRef.current) return
    populatedRotationRef.current = true
    ed.setRotationBackdrops(topFitRotationBackdrops)
    if (ed.defaultAutoRotateBackdrop && topFitRotationBackdrops.length > 1) {
      ed.setAutoRotateBackdrop(true)
    }
  }, [topFitRotationBackdrops, fitLoading, isSavedBackdrop]) // eslint-disable-line react-hooks/exhaustive-deps -- intenzionale: solo sui risultati fit

  const toggleRotation = (filePath: string) => {
    ed.setRotationBackdrops((prev) => {
      if (prev.includes(filePath)) return prev.filter((f) => f !== filePath)
      return [...prev, filePath]
    })
  }

  const toggleAutoRotateBackdrop = () => {
    const next = !ed.autoRotateBackdrop
    if (next && topFitRotationBackdrops.length > 0) {
      ed.setRotationBackdrops(topFitRotationBackdrops)
    }
    ed.setAutoRotateBackdrop(next)
  }

  const [excludedSaveState, setExcludedSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")

  const excludeBackdrop = (filePath: string) => {
    // Mirror di excludePoster: rollback su errore + fallback se attivo.
    const prevExcluded = ed.excludedBackdrops
    const prevRotation = ed.rotationBackdrops
    const nextExcluded = Array.from(new Set([...ed.excludedBackdrops, filePath]))
    const nextRotationBackdrops = ed.rotationBackdrops.filter((path) => path !== filePath)
    ed.setExcludedBackdrops(nextExcluded)
    ed.setRotationBackdrops(nextRotationBackdrops)
    setExcludedSaveState("saving")
    let fallback: TMDBImage | undefined
    let backdropOverride: TMDBImage | null | undefined
    if (backdropActivePath === filePath) {
      fallback = cleanBackdrops.find((b) => b.file_path !== filePath)
      if (fallback) selectBackdrop(fallback)
      else clearBackdrop()
      backdropOverride = fallback ?? null
    }
    autoSaveExcludedBackdrops(nextExcluded, nextRotationBackdrops, backdropOverride)
      .then(() => { setExcludedSaveState("saved"); toast.success(t("ui.backdropExcluded")) })
      .catch(() => {
        ed.setExcludedBackdrops(prevExcluded)
        ed.setRotationBackdrops(prevRotation)
        setExcludedSaveState("error")
        toast.error(t("ui.saveError"))
      })
  }

  const handleSelect = (img: TMDBImage) => {
    markUserPicked()
    if (backdropActivePath === img.file_path) clearBackdrop()
    else selectBackdrop(img)
  }

  if (backdrops.length === 0) {
    return (
      <p className="text-center py-12 text-muted text-xs">
        {loading ? t("ui.loading") : t("ui.noBackdrops")}
      </p>
    )
  }

  return (
    <div>
      <div className="space-y-2 mb-2 px-1">
        {isBestSelected && (
          <div className="editor-pill">
            <Check className="w-3 h-3" />{t("ui.bestFitSelected")}
          </div>
        )}
        {ed.rotationBackdrops.length > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted flex items-center gap-1"><Clock className="w-3 h-3" />{t("ui.autoRotate")}</span>
            <button type="button"
              aria-label={ed.autoRotateBackdrop ? t("ui.removeFromRotation") : t("ui.autoRotate")}
              onClick={toggleAutoRotateBackdrop}
              className={`px-2 py-1 text-[11px] font-semibold rounded-lg border transition-all ${ed.autoRotateBackdrop ? "bg-accent-orange/20 text-accent-orange border-accent-orange/25 animate-pulse-ring" : "bg-white/5 text-muted border-white/10"}`}
            >
              {ed.autoRotateBackdrop ? <><Check className="w-3 h-3 inline mr-1" />ON</> : "OFF"}
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
        {(bestBackdrop && !isBestSelected && !fitLoading) && (
          <button type="button"
            aria-label={t("ui.chooseBestBackdropAria")}
            onClick={() => { markUserPicked(); selectBackdrop(bestBackdrop) }}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-all duration-150 bg-accent-orange/15 text-accent-orange hover:bg-accent-orange/25 active:scale-[0.98]"
          >
            <Sparkles className="w-3 h-3" />{t("ui.chooseBestBackdrop")}
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
      </div>
      <div className="grid grid-cols-2 gap-2">
        {visibleBackdrops.map((img, i) => {
          const isBestFit = bestFitPath === img.file_path
          const showBadge = isBestFit && bestScore >= 0.45
          const isHighScore = bestScore >= 0.65
          const inRotation = ed.rotationBackdrops.includes(img.file_path)
          return (
            <div key={img.file_path} className={`relative group rounded-xl overflow-hidden ${showBadge ? `ring-1 ${isHighScore ? "ring-orange-400/70 shadow-[0_0_18px_rgba(232,93,42,0.12)]" : "ring-amber-400/50"}` : ""}`}>
              <PosterBtn
                staggerIndex={i}
                img={img}
                landscape
                imgSize="w300"
                active={backdropActivePath === img.file_path}
                onSelect={handleSelect}
              />
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
                  className={`poster-image-action w-6 h-6 rounded-lg flex items-center justify-center backdrop-blur-md border transition-all duration-150 ${inRotation ? "bg-accent-orange text-white border-accent-orange shadow-sm shadow-accent-orange/40" : "bg-black/55 border-white/10 text-zinc-200 hover:bg-accent-orange/90 hover:text-white hover:border-accent-orange/60"}`}
                  title={inRotation ? t("ui.removeFromRotation") : t("ui.addToRotation")}
                >
                  {inRotation ? <Check className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                </button>
                <button type="button"
                  aria-label={t("ui.excludeBackdrop")}
                  onClick={(e) => { e.stopPropagation(); excludeBackdrop(img.file_path) }}
                  className="poster-image-action w-6 h-6 rounded-lg flex items-center justify-center backdrop-blur-md border transition-all duration-150 bg-black/55 border-white/10 text-zinc-300 hover:bg-red-500/90 hover:text-white hover:border-red-400/60"
                  title={t("ui.excludeBackdrop")}
                >
                  <EyeOff className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      {displayBackdrops.length > visibleCount && (
        <button
          type="button"
          aria-label={t("ui.loadMoreBackdropsAria")}
          onClick={() => setVisibleCount((prev) => prev + VISIBLE_BACKDROP_COUNT)}
          className="btn-secondary w-full mt-3 py-2 px-3 text-xs"
        >
          <ChevronDown className="w-4 h-4" />
          {t("ui.loadMoreBackdrops", { count: Math.min(VISIBLE_BACKDROP_COUNT, displayBackdrops.length - visibleCount) })}
          <span className="text-[10px] text-zinc-500 font-normal">{t("ui.xOfY", { current: visibleCount, total: displayBackdrops.length })}</span>
        </button>
      )}
      {!backdropActivePath && (
        <p className="text-[11px] text-zinc-500 mt-1.5 px-1">{t("ui.backdropAuto")}</p>
      )}
      {ed.rotationBackdrops.length > 0 && (
        <p className="text-[11px] text-zinc-500 mt-1.5 px-1">{ed.rotationBackdrops.length} {t("ui.selectedCount", { count: ed.rotationBackdrops.length })}</p>
      )}
      {ed.excludedBackdrops.length > 0 && (
        <div className="mt-2 flex items-center justify-between rounded-lg border border-surface2/70 bg-white/5 px-2.5 py-2">
          <span className="text-[11px] text-muted flex items-center gap-1.5">
            <span>{ed.excludedBackdrops.length} {ed.excludedBackdrops.length === 1 ? t("ui.excludedBackdropCountOne") : t("ui.excludedBackdropCountMany")}</span>
            {excludedSaveState === "saving" && <span className="text-[10px] text-zinc-500 animate-pulse">{t("ui.saveStateSaving")}</span>}
            {excludedSaveState === "saved" && <span className="text-[10px] text-green-500">{t("ui.saveStateSaved")}</span>}
            {excludedSaveState === "error" && <span className="text-[10px] text-danger">{t("ui.saveStateError")}</span>}
          </span>
          <button type="button" onClick={() => { ed.setExcludedBackdrops([]); setExcludedSaveState("saving"); autoSaveExcludedBackdrops([], ed.rotationBackdrops).then(() => { setExcludedSaveState("saved"); toast.success(t("ui.cancel")) }).catch(() => { setExcludedSaveState("error"); toast.error(t("ui.saveError")) }) }} className="text-[11px] text-accent-orange hover:text-orange-300">
            {t("ui.restore")}
          </button>
        </div>
      )}
    </div>
  )
}
