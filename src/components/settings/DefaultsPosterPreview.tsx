"use client"

import { useEffect, useRef, useState, useId } from "react"
import { ChevronDown, ImageOff, RefreshCw, Sparkles } from "lucide-react"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import { useT } from "@/lib/contexts/TranslationContext"
import { buildDefaultsPreviewUrl, type DefaultsPreviewDemoMedia, type DefaultsPreviewFamily } from "@/lib/poster-url"
import { DEFAULT_SASH_ORDER, type SashBucket } from "@/lib/badge-priority"
import { usePSelector } from "@/lib/context"
import { getRegionDef } from "@/lib/regions"
import { Modal } from "@/components/ui/Modal"
import { DefaultsPreviewTitleSearch } from "@/components/settings/DefaultsPreviewTitleSearch"

interface DefaultsPosterPreviewProps {
  /** Compact mode for mobile above the controls. */
  compact?: boolean
  /** Preview-only shape (Horizontal tab): wins over the persisted
   *  `defaultPosterShape` without modifying it. Absent = follow the default. */
  previewShape?: "portrait" | "landscape" | null
  /** Preview-only demo title (default Avatar): only changes the preview
   *  `{type}/{id}` path, never mapping/default/shape. Lifted to SettingsPanel
   *  so the selection survives desktop/mobile switches (a single responsive
   *  instance is mounted at a time). */
  demoMedia?: DefaultsPreviewDemoMedia | null
  onDemoMediaChange?: (m: DefaultsPreviewDemoMedia | null) => void
  /** Preview-only editing family (owned by SettingsPanel): narrows the sample
   *  to what the user is editing without touching saved defaults. Absent =
   *  `auto` (effective saved priority). */
  previewFamily?: DefaultsPreviewFamily | null
  /** Reset callback (owned by SettingsPanel): the chip offers a return to the
   *  full `auto` preview — preview-only, never writes defaults. */
  onPreviewFamilyChange?: (f: DefaultsPreviewFamily) => void
  /** Compact collapse state (owned by SettingsPanel, in-memory): the body
   *  stays mounted when collapsed so no refetch happens. Compact only. */
  collapsed?: boolean
  onCollapsedChange?: (v: boolean) => void
}

/**
 * Preview-only sample label per informational sash bucket (Informazioni
 * family): existing badge keys, resolved server-side in the request language
 * via the `extra=` path — no new translations, no new fetch, real data still
 * wins everywhere else (only the top badge is forced, exactly like an editor
 * custom badge, and only while this family is edited).
 */
const INFO_FAMILY_SAMPLE_KEY: Record<SashBucket, string | null> = {
  upcoming: "__badge.comingSoon",
  rank: null,
  new: "__badge.newMovie",
  award: "__badge.absoluteCinema",
  extra: "__badge.trending",
}

/** Family chip label: every family reuses an existing i18n key. */
const PREVIEW_FAMILY_LABEL_KEY: Record<DefaultsPreviewFamily, string> = {
  auto: "ui.previewEditingAuto",
  rank: "ui.rankFamily",
  info: "ui.titleInfoFamily",
  genre: "ui.genreRatingBadge",
  ratings: "ui.ratingsFamily",
  quality: "ui.badgeQuality",
  logo: "ui.logoSection",
  gradient: "ui.blurSection",
}

export function DefaultsPosterPreview({ compact, previewShape, demoMedia, onDemoMediaChange, previewFamily, onPreviewFamilyChange, collapsed = false, onCollapsedChange }: DefaultsPosterPreviewProps) {
  const ed = usePosterEditor()
  const { t, lang } = useT()
  const bodyId = useId()
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const userId = usePSelector((v) => v.currentUserId)
  const serverHasTmdbKey = usePSelector((v) => v.serverHasTmdbKey)

  const [debouncedUrl, setDebouncedUrl] = useState("")
  const [imgSrc, setImgSrc] = useState("")
  const [prevSrc, setPrevSrc] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)
  const [imageError, setImageError] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [zoomed, setZoomed] = useState(false)

  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const loadDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevObjUrlRef = useRef("")
  const shownRef = useRef("")
  const lastProgressRef = useRef(-1)

  const demoTitle = demoMedia?.title?.trim() ? demoMedia.title.trim() : "Avatar"
  const searchLanguage = getRegionDef(ed.defaultRegion).lang

  // Previewed shape mirrors the builder rule (`land ?? flat` only applies in
  // landscape): portrait always reads the shared flats.
  const previewIsLandscape =
    previewShape === "landscape" || (previewShape == null && ed.defaultPosterShape === "landscape")
  // Effective sash + master for the previewed shape (same rule as the
  // builder): drives the info-family sample only, never persisted.
  const effPreviewSashForFamily =
    (previewIsLandscape ? ed.landscape.sashOrder : undefined) ?? ed.defaultSashOrder ?? [...DEFAULT_SASH_ORDER]
  const effPreviewRankingForFamily =
    ((previewIsLandscape ? ed.landscape.rankingBadges : undefined) ?? ed.defaultRankingBadges) !== false
  // First enabled informational bucket in saved priority order: no enabled
  // info bucket (or master off) = no sample, never a phantom badge.
  const infoSampleBucket =
    previewFamily === "info" && effPreviewRankingForFamily
      ? effPreviewSashForFamily.find((b) => b === "upcoming" || b === "new" || b === "award" || b === "extra")
      : undefined
  const previewExtra = infoSampleBucket ? INFO_FAMILY_SAMPLE_KEY[infoSampleBucket] : null

  // Calcolo URL con debounce a 200ms per non sovraccaricare il server durante lo scorrimento dei controlli
  useEffect(() => {
    const url = buildDefaultsPreviewUrl({
      tmdbKey,
      userId,
      lang,
      demoMedia: demoMedia ?? null,
      defaultLogoScale: ed.defaultLogoScale,
      defaultLogoOffsetX: ed.defaultLogoOffsetX,
      defaultLogoOffsetY: ed.defaultLogoOffsetY,
      defaultGlobalBadges: ed.defaultGlobalBadges,
      defaultRankingBadges: ed.defaultRankingBadges,
      defaultBadgeGenre: ed.defaultBadgeGenre,
      defaultBadgeYear: ed.defaultBadgeYear,
      defaultBadgeRating: ed.defaultBadgeRating,
      defaultBadgeQuality: ed.defaultBadgeQuality,
      defaultCustomRatings: ed.defaultCustomRatings,
      defaultSeparateRatings: ed.defaultSeparateRatings,
      defaultRatingSources: ed.defaultRatingSources,
      defaultBadgeStyle: ed.defaultBadgeStyle,
      defaultRankingBadgeStyle: ed.defaultRankingBadgeStyle,
      defaultExtraBadgeStyle: ed.defaultExtraBadgeStyle,
      defaultBadgeFont: ed.defaultBadgeFont,
      defaultQualityBadgeStyle: ed.defaultQualityBadgeStyle,
      defaultVideoFormats: ed.defaultVideoFormats,
      defaultBlurEnabled: ed.defaultBlurEnabled,
      defaultBlurIntensity: ed.defaultBlurIntensity,
      defaultBlurFade: ed.defaultBlurFade,
      defaultBlurDarkness: ed.defaultBlurDarkness,
      defaultTintStrength: ed.defaultTintStrength,
      defaultTopShade: ed.defaultTopShade,
      defaultGradientHeight: ed.defaultGradientHeight,
      defaultTopBadgeScale: ed.defaultTopBadgeScale,
      defaultTopBadgeOffsetX: ed.defaultTopBadgeOffsetX,
      defaultTopBadgeOffsetY: ed.defaultTopBadgeOffsetY,
      defaultGenreBadgeScale: ed.defaultGenreBadgeScale,
      defaultGenreBadgeOffsetX: ed.defaultGenreBadgeOffsetX,
      defaultGenreBadgeOffsetY: ed.defaultGenreBadgeOffsetY,
      defaultQualityBadgeScale: ed.defaultQualityBadgeScale,
      defaultQualityBadgeOffsetX: ed.defaultQualityBadgeOffsetX,
      defaultQualityBadgeOffsetY: ed.defaultQualityBadgeOffsetY,
      defaultSeparateBadgeScale: ed.defaultSeparateBadgeScale,
      defaultSeparateBadgeOffsetX: ed.defaultSeparateBadgeOffsetX,
      defaultSeparateBadgeOffsetY: ed.defaultSeparateBadgeOffsetY,
      defaultSeparateRatingsStyle: ed.defaultSeparateRatingsStyle,
      defaultNetworkLogoScale: ed.defaultNetworkLogoScale,
      defaultNetworkLogoOffsetX: ed.defaultNetworkLogoOffsetX,
      defaultNetworkLogoOffsetY: ed.defaultNetworkLogoOffsetY,
      defaultNetworkLogo: ed.defaultNetworkLogo,
      defaultNetworkLogoPosition: ed.defaultNetworkLogoPosition,
      defaultRibbonEnabled: ed.defaultRibbonEnabled,
      defaultRibbonSide: ed.defaultRibbonSide,
      defaultPosterShape: ed.defaultPosterShape,
      defaultLogoAlign: ed.defaultLogoAlign,
      defaultDateFormat: ed.defaultDateFormat,
      defaultRegion: ed.defaultRegion,
      // Profilo Orizzontale live (stessi slider del Verticale): chiavi definite
      // vincono sui flat SOLO con shape Orizzontale (regola `land ?? flat` nel
      // builder). Nessun persist/mapping qui: sola lettura per la preview.
      landscape: ed.landscape,
      previewShape: previewShape ?? null,
      defaultSashOrder: ed.defaultSashOrder,
      previewFamily: previewFamily ?? null,
      previewExtra,
    })

    const timer = setTimeout(() => {
      setDebouncedUrl(url)
    }, 200)

    return () => clearTimeout(timer)
  }, [
    tmdbKey,
    userId,
    lang,
    demoMedia,
    ed.defaultLogoScale,
    ed.defaultLogoOffsetX,
    ed.defaultLogoOffsetY,
    ed.defaultGlobalBadges,
    ed.defaultRankingBadges,
    ed.defaultBadgeGenre,
    ed.defaultBadgeYear,
    ed.defaultBadgeRating,
    ed.defaultBadgeQuality,
    ed.defaultCustomRatings,
    ed.defaultSeparateRatings,
    ed.defaultRatingSources,
    ed.defaultBadgeStyle,
    ed.defaultRankingBadgeStyle,
    ed.defaultExtraBadgeStyle,
    ed.defaultBadgeFont,
    ed.defaultQualityBadgeStyle,
    ed.defaultVideoFormats,
    ed.defaultBlurEnabled,
    ed.defaultBlurIntensity,
    ed.defaultBlurFade,
    ed.defaultBlurDarkness,
    ed.defaultTintStrength,
    ed.defaultTopShade,
    ed.defaultGradientHeight,
    ed.defaultTopBadgeScale,
    ed.defaultTopBadgeOffsetX,
    ed.defaultTopBadgeOffsetY,
    ed.defaultGenreBadgeScale,
    ed.defaultGenreBadgeOffsetX,
    ed.defaultGenreBadgeOffsetY,
    ed.defaultQualityBadgeScale,
    ed.defaultQualityBadgeOffsetX,
    ed.defaultQualityBadgeOffsetY,
    ed.defaultSeparateBadgeScale,
    ed.defaultSeparateBadgeOffsetX,
    ed.defaultSeparateBadgeOffsetY,
    ed.defaultSeparateRatingsStyle,
    ed.defaultNetworkLogoScale,
    ed.defaultNetworkLogoOffsetX,
    ed.defaultNetworkLogoOffsetY,
    ed.defaultNetworkLogo,
    ed.defaultNetworkLogoPosition,
    ed.defaultRibbonEnabled,
    ed.defaultRibbonSide,
    ed.defaultPosterShape,
    ed.defaultLogoAlign,
    ed.defaultDateFormat,
    ed.defaultRegion,
    ed.defaultSashOrder,
    ed.landscape,
    previewShape,
    previewFamily,
    previewExtra,
    retryNonce,
  ])

  // Anti-blank tra anteprime (buffer precedente mantenuto finché il nuovo non è pronto)
  useEffect(() => {
    if (!imgSrc) {
      shownRef.current = ""
      setPrevSrc(null)
      return
    }
    if (imgSrc === shownRef.current) return
    setPrevSrc(shownRef.current || null)
  }, [imgSrc])

  const handleImgLoad = () => {
    shownRef.current = imgSrc
    setPrevSrc(null)
  }

  // Caricamento via XHR blob come usePosterPreview per visualizzazione fluida senza scatti
  useEffect(() => {
    setImageError(false)
    setLoadProgress(0)
    lastProgressRef.current = 0

    if (!debouncedUrl) {
      if (prevObjUrlRef.current) {
        URL.revokeObjectURL(prevObjUrlRef.current)
        prevObjUrlRef.current = ""
      }
      setImgSrc("")
      setPreviewLoading(false)
      return
    }

    loadDelayRef.current = setTimeout(() => setPreviewLoading(true), 200)

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open("GET", debouncedUrl, true)
    xhr.responseType = "blob"
    xhr.timeout = 45000

    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100)
        if (lastProgressRef.current < 0 || pct - lastProgressRef.current >= 5 || pct >= 100) {
          lastProgressRef.current = pct
          setLoadProgress(pct)
        }
      }
    }

    xhr.onload = () => {
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
      if (xhr.status === 200) {
        const blob = xhr.response
        const objUrl = URL.createObjectURL(blob)
        if (prevObjUrlRef.current) URL.revokeObjectURL(prevObjUrlRef.current)
        prevObjUrlRef.current = objUrl
        setImgSrc(objUrl)
        setLoadProgress(100)
        setPreviewLoading(false)
      } else {
        setImageError(true)
        setPreviewLoading(false)
      }
    }

    xhr.onerror = () => {
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
      setImageError(true)
      setPreviewLoading(false)
    }

    xhr.ontimeout = () => {
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
      setImageError(true)
      setPreviewLoading(false)
    }

    xhr.send()

    return () => {
      if (loadDelayRef.current) {
        clearTimeout(loadDelayRef.current)
        loadDelayRef.current = null
      }
      xhr.abort()
    }
  }, [debouncedUrl, retryNonce])

  // Pulizia blob al disinnesco
  useEffect(() => {
    return () => {
      if (prevObjUrlRef.current) {
        URL.revokeObjectURL(prevObjUrlRef.current)
        prevObjUrlRef.current = ""
      }
    }
  }, [])

  // Aspect conforme all'URL (stessa shape effettiva del builder): switch
  // immediato, senza mixing durante il debounce (l'immagine precedente resta
  // in buffer finché la nuova non è pronta).
  const isLandscape = previewShape === "landscape" || (previewShape == null && ed.defaultPosterShape === "landscape")

  // Accessible zoom (shared Modal: focus trap, Escape, backdrop, focus/scroll
  // restore): overlay above the settings dialog (z-[80]). A second click on
  // the enlarged image closes (restore) with no layout shift underneath
  // (Modal locks scroll in a portal).
  const zoomModal = (
    <Modal
      isOpen={zoomed}
      onClose={() => setZoomed(false)}
      labelledBy="defaults-preview-zoom-title"
      overlayClassName="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      className="max-w-3xl text-center"
    >
      <h3 id="defaults-preview-zoom-title" className="sr-only">{demoTitle}</h3>
      {imgSrc ? (
        <button
          type="button"
          onClick={() => setZoomed(false)}
          aria-label={t("ui.defaultsPreviewZoomClose")}
          className="block w-full cursor-zoom-out"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt={demoTitle}
            className="mx-auto max-h-[78dvh] w-auto max-w-full object-contain rounded-xl"
          />
        </button>
      ) : null}
    </Modal>
  )

  const editingFamily: DefaultsPreviewFamily = previewFamily ?? "auto"
  // "What am I editing" chip: always visible (compact mobile included), text
  // only — never moves focus, never unmounts controls. A small reset button
  // appears while a family is targeted so the full `auto` preview is one
  // click away (preview-only: it only lifts "auto" to the owner).
  const editingChip = (
    <div className="w-full flex justify-center [@media(max-height:760px)]:order-2">
      <span
        data-testid="defaults-preview-editing"
        title={t("ui.previewEditingHint")}
        className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent-orange/15 border border-accent-orange/30 text-accent-orange text-[10px] font-semibold px-2 py-0.5 truncate"
      >
        <span className="truncate">
          {t("ui.previewEditingNow")}:{" "}
          {isLandscape ? t("ui.posterShapeLandscape") : t("ui.posterShapePortrait")} ·{" "}
          {t(PREVIEW_FAMILY_LABEL_KEY[editingFamily])}
        </span>
        {editingFamily !== "auto" && onPreviewFamilyChange && (
          <button
            type="button"
            data-testid="defaults-preview-reset-family"
            onClick={() => onPreviewFamilyChange("auto")}
            aria-label={t("ui.reset")}
            title={t("ui.previewEditingHint")}
            className="shrink-0 ml-1 underline decoration-dotted underline-offset-2 hover:text-white transition-colors cursor-pointer"
          >
            {"× "}
            {t(PREVIEW_FAMILY_LABEL_KEY.auto)}
          </button>
        )}
      </span>
    </div>
  )

  const searchRow = (
    <DefaultsPreviewTitleSearch
      tmdbKey={tmdbKey}
      hasServerKey={serverHasTmdbKey}
      language={searchLanguage}
      demoMedia={demoMedia ?? null}
      onDemoMediaChange={(m) => onDemoMediaChange?.(m)}
      compact={compact}
    />
  )

  if (compact) {
    return (
      <div className="w-full bg-surface/60 border border-surface2/80 rounded-2xl p-2 mb-2 shadow-md">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 min-w-0">
            <Sparkles className="w-3.5 h-3.5 text-accent-orange shrink-0" />
            <span className="truncate">{t("ui.defaultsPreviewTitle")}</span>
          </div>
          <div className="flex items-center gap-1 min-w-0">
            <span className="text-[10px] text-zinc-400 font-mono truncate">
              {demoMedia?.title ? demoTitle : t("ui.defaultsPreviewSubtitle")}
            </span>
            <button
              type="button"
              data-testid="defaults-preview-collapse"
              onClick={() => onCollapsedChange?.(!collapsed)}
              aria-expanded={!collapsed}
              aria-controls={bodyId}
              aria-label={t(collapsed ? "ui.previewExpand" : "ui.previewCollapse")}
              title={t(collapsed ? "ui.previewExpand" : "ui.previewCollapse")}
              className="shrink-0 min-w-[44px] min-h-[44px] -my-2 -mr-2 px-2 flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-all active:scale-90 cursor-pointer touch-manipulation"
            >
              <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`} />
            </button>
          </div>
        </div>
        <div id={bodyId} className={collapsed ? "hidden" : undefined}>
        {editingChip}

        <div className="flex justify-center">
          <div data-testid="defaults-preview-media" className={`relative select-none bg-zinc-950/80 rounded-xl overflow-hidden shadow-inner border border-white/10 ${
            isLandscape ? "w-full aspect-video" : "w-[120px] max-w-[44vw] aspect-[2/3]"
          }`}>
            {previewLoading && (
              <div className="absolute top-0 inset-x-0 h-0.5 bg-accent-orange/30 z-30 overflow-hidden">
                <div
                  className="h-full bg-accent-orange transition-all duration-200"
                  style={{ width: `${Math.max(loadProgress, 10)}%` }}
                />
              </div>
            )}

            {prevSrc && prevSrc !== imgSrc && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={prevSrc}
                alt=""
                aria-hidden="true"
                className={`absolute inset-0 w-full h-full ${isLandscape ? "object-contain" : "object-cover"}`}
              />
            )}

            {imgSrc ? (
              <button
                type="button"
                onClick={() => setZoomed(true)}
                aria-label={t("ui.defaultsPreviewZoomOpen")}
                aria-expanded={zoomed}
                className="absolute inset-0 w-full h-full cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt={demoTitle}
                  onLoad={handleImgLoad}
                  className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${isLandscape ? "object-contain" : "object-cover"}`}
                />
              </button>
            ) : (
              <div className="absolute inset-0 bg-surface2/40 animate-pulse" />
            )}

            {imageError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-center p-2 z-20">
                <ImageOff className="w-5 h-5 text-zinc-500 mb-1" />
                <p className="text-[10px] text-zinc-400 font-medium">{t("ui.posterLoadError")}</p>
                <button
                  type="button"
                  onClick={() => setRetryNonce((n) => n + 1)}
                  className="mt-1.5 px-2 py-0.5 text-[10px] text-zinc-200 bg-white/10 hover:bg-white/20 rounded flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-2.5 h-2.5" />
                  {t("ui.retry")}
                </button>
              </div>
            )}
          </div>
        </div>
        {searchRow}
        </div>
        {zoomModal}
      </div>
    )
  }

  return (
    <div className="w-full flex flex-col items-center bg-surface/40 border border-surface2/60 rounded-2xl p-4 shadow-md">
      <div className="w-full flex items-center justify-between mb-3 px-1 [@media(max-height:760px)]:order-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
          <Sparkles className="w-3.5 h-3.5 text-accent-orange" />
          <span>{t("ui.defaultsPreviewTitle")}</span>
        </div>
        <span className="text-[10px] text-zinc-400 font-mono">
          {demoMedia?.title ? demoTitle : t("ui.defaultsPreviewSubtitle")}
        </span>
      </div>
      {editingChip}
      <p className="text-[10px] text-zinc-500 text-center mt-1.5 px-2 select-none leading-relaxed [@media(max-height:760px)]:order-4">
        {t("ui.previewEditingHint")}
      </p>

      <div className={`relative select-none bg-zinc-950/90 rounded-2xl overflow-hidden shadow-2xl border border-white/10 w-full [@media(max-height:760px)]:order-3 ${
        isLandscape ? "aspect-video" : "aspect-[2/3] max-w-[calc(58dvh_-_200px)]"
      }`}>
        {previewLoading && (
          <div className="absolute top-0 inset-x-0 h-1 bg-accent-orange/20 z-30 overflow-hidden">
            <div
              className="h-full bg-accent-orange transition-all duration-200 shadow-sm"
              style={{ width: `${Math.max(loadProgress, 10)}%` }}
            />
          </div>
        )}

        {previewLoading && (
          <div className="absolute top-2.5 right-2.5 z-30 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-[10px] text-zinc-300 font-medium flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full border-2 border-accent-orange/40 border-t-accent-orange animate-spin" />
            <span>{t("ui.previewUpdating")}</span>
          </div>
        )}

        {prevSrc && prevSrc !== imgSrc && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={prevSrc}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full ${isLandscape ? "object-contain" : "object-cover"}`}
          />
        )}

        {imgSrc ? (
          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label={t("ui.defaultsPreviewZoomOpen")}
            aria-expanded={zoomed}
            className="absolute inset-0 w-full h-full cursor-zoom-in"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgSrc}
              alt={demoTitle}
              onLoad={handleImgLoad}
              className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${isLandscape ? "object-contain" : "object-cover"}`}
            />
          </button>
        ) : (
          <div className="absolute inset-0 bg-surface2/40 animate-pulse flex items-center justify-center">
            <span className="w-5 h-5 rounded-full border-2 border-accent-orange/40 border-t-accent-orange animate-spin" />
          </div>
        )}

        {imageError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-center p-4 z-20">
            <ImageOff className="w-8 h-8 text-zinc-500 mb-2" />
            <p className="text-xs text-zinc-300 font-medium">{t("ui.imageNotAvailable")}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">{t("ui.posterLoadError")}</p>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="mt-3 px-3 py-1.5 text-xs text-zinc-200 bg-white/10 hover:bg-white/20 border border-white/15 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              {t("ui.retry")}
            </button>
          </div>
        )}
      </div>

      <div className="w-full [@media(max-height:760px)]:order-2">
        {searchRow}
      </div>
      <p className="text-[10px] text-amber-200/70 text-center mt-2 px-2 select-none leading-relaxed [@media(max-height:760px)]:order-4">
        {t("ui.defaultsPreviewSamplesNotice")}
      </p>
      {zoomModal}

      <p className="text-[10px] text-zinc-500 text-center mt-2.5 px-2 select-none leading-relaxed [@media(max-height:760px)]:order-5">
        {t("ui.settingsGlobalDesc")}
      </p>
    </div>
  )
}
