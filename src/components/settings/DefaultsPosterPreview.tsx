"use client"

import { useEffect, useRef, useState, useId } from "react"
import { ChevronDown, ImageOff, RefreshCw, Search, Sparkles } from "lucide-react"
import { usePosterEditor, type PosterEditorCtx } from "@/lib/contexts/PosterEditorContext"
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
  /** Floating overlay mode (mobile settings): minimal live thumbnail card —
   *  same single owner, same blob URL/state/zoom modal as the other modes,
   *  only narrower chrome (no header/chip/inline search: a 44px trigger opens
   *  the shared title-search dialog, preview-only). */
  floating?: boolean
  /** Suspend overlays: while true (settings exit-confirm owns the focus) an
   *  open zoom is closed so two dialogs are never active at once. */
  suspended?: boolean
  /** Optional simplified chrome for the primary draft page only: actual
   *  poster/loading/error/zoom remain, full info chips/search secondary
   *  (change-sample-title disclosure). Default callers unaffected. */
  simpleChrome?: boolean
  /** Optional draft defaults override (guided setup): read-only field
   *  overrides for the preview builder only. Absent = live editor state.
   *  No context/provider changes; regular callers unaffected. */
  draftDefaults?: Partial<{
    defaultLogoScale: number | null
    defaultLogoOffsetX: number | null
    defaultLogoOffsetY: number | null
    defaultGlobalBadges: boolean
    defaultRankingBadges: boolean
    defaultBadgeGenre: boolean
    defaultBadgeYear: boolean
    defaultBadgeRating: boolean
    defaultBadgeQuality: boolean
    defaultCustomRatings: boolean
    defaultSeparateRatings: boolean
    defaultSeparateRatingsStyle: import("@/lib/badge-styles").SeparateRatingsStyle
    defaultRatingSources: string[]
    defaultBadgeStyle: import("@/lib/badge-styles").BadgeStyle
    defaultRankingBadgeStyle: import("@/lib/badge-styles").RankingBadgeStyle
    defaultExtraBadgeStyle: import("@/lib/badge-styles").ExtraBadgeStyle | import("@/lib/badge-styles").ExtraBadgeFollowRank | null
    defaultBadgeFont: import("@/lib/badge-styles").BadgeFont
    defaultQualityBadgeStyle: import("@/lib/badge-styles").QualityBadgeStyle
    defaultVideoFormats: readonly import("@/lib/av-specs").VideoFormat[]
    defaultBlurEnabled: boolean
    defaultBlurIntensity: number
    defaultBlurFade: number
    defaultBlurDarkness: number
    defaultTintStrength: number
    defaultTopShade: number
    defaultTopShadeHeight: number
    defaultGradientHeight: number
    defaultTopBadgeScale: number
    defaultTopBadgeOffsetX: number
    defaultTopBadgeOffsetY: number
    defaultExtraBadgeScale: number | null
    defaultExtraBadgeOffsetX: number | null
    defaultExtraBadgeOffsetY: number | null
    defaultGenreBadgeScale: number
    defaultGenreBadgeOffsetX: number
    defaultGenreBadgeOffsetY: number
    defaultQualityBadgeScale: number
    defaultQualityBadgeOffsetX: number
    defaultQualityBadgeOffsetY: number
    defaultSeparateBadgeScale: number | null
    defaultSeparateBadgeOffsetX: number | null
    defaultSeparateBadgeOffsetY: number | null
    defaultNetworkLogoScale: number
    defaultNetworkLogoOffsetX: number
    defaultNetworkLogoOffsetY: number
    defaultNetworkLogo: boolean
    defaultNetworkLogoPosition: import("@/lib/types").NetworkLogoPosition
    defaultNetworkLogoFollowTitle: boolean | null
    defaultPreRelease: boolean
    defaultRibbonEnabled: boolean
    defaultRibbonSide: "left" | "right"
    defaultPosterShape: import("@/lib/types").PosterShape
    defaultPosterLayout: import("@/lib/types").PosterLayout | null
    defaultPosterFreshScope: import("@/lib/types").PosterFreshScope | null
    defaultLogoAlign: "left" | "center" | null
    defaultSashOrder: readonly import("@/lib/badge-priority").SashBucket[]
    landscape: import("@/lib/server-defaults").LandscapeServerDefaults | null
  }>
}

/**
 * Preview-only sample label per informational sash bucket (`info` family, and
 * the `extra` family which prioritizes the `extra` entry): existing badge
 * keys, resolved server-side in the request language via the `extra=` path —
 * no new translations, no new fetch, real data still wins everywhere else
 * (only the top badge is forced, exactly like an editor custom badge, and
 * only while this family is edited).
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
  extra: "ui.titleInfoFamily",
  genre: "ui.genreRatingBadge",
  ratings: "ui.ratingsFamily",
  quality: "ui.badgeQuality",
  logo: "ui.logoSection",
  gradient: "ui.blurSection",
}

export interface DefaultsPreviewBuildOpts {
  tmdbKey: string
  userId: string | null
  lang: string
  demoMedia: DefaultsPreviewDemoMedia | null
  previewShape: "portrait" | "landscape" | null
  previewFamily: DefaultsPreviewFamily | null
}

/**
 * URL preview defaults costruito dagli stessi input della preview
 * visualizzata (stesso builder, stesso sample, stessa shape): unica fonte
 * anche per il freeze geometria (nessuna duplicazione dei parametri).
 * Ritorna anche la shape canvas ("poster"/"landscape") per il routing
 * per-shape dello stato.
 */
export function buildDefaultsPreviewUrlFromEditor(
  ed: PosterEditorCtx,
  opts: DefaultsPreviewBuildOpts & { draftDefaults?: DefaultsPosterPreviewProps["draftDefaults"] },
): { url: string; shape: "poster" | "landscape" } {
  // Draft override (guided setup): read-only field overlays for preview
  // only. Absent = live editor state (existing callers byte-identical).
  // Landscape merges key-wise so a sparse draft profile still inherits.
  if (opts.draftDefaults !== undefined) {
    const { landscape: draftLand, ...draftFlat } = opts.draftDefaults as Record<string, unknown>
    ed = {
      ...ed,
      ...draftFlat,
      ...(draftLand !== undefined
        ? { landscape: { ...ed.landscape, ...(draftLand as object) } }
        : null),
    } as PosterEditorCtx
  }
  // Previewed shape mirrors the builder rule (`land ?? flat` only applies in
  // landscape): portrait always reads the shared flats.
  const previewIsLandscape =
    opts.previewShape === "landscape" || (opts.previewShape == null && ed.defaultPosterShape === "landscape")
  // Effective sash + master for the previewed shape (same rule as the
  // builder): drives the info-family sample only, never persisted.
  const effPreviewSashForFamily =
    (previewIsLandscape ? ed.landscape.sashOrder : undefined) ?? ed.defaultSashOrder ?? [...DEFAULT_SASH_ORDER]
  const effPreviewRankingForFamily =
    ((previewIsLandscape ? ed.landscape.rankingBadges : undefined) ?? ed.defaultRankingBadges) !== false
  // First enabled informational bucket in saved priority order: no enabled
  // info bucket (or master off) = no sample, never a phantom badge.
  // The `extra` family originates from the standalone extra-badge style
  // control: it prioritizes the existing `extra`-bucket sample (whose look the
  // `xbs` choice drives) whenever that bucket is allowed (ranking master on +
  // `extra` in the effective sash for the previewed shape). When `extra` is
  // disabled but another non-rank bucket is enabled, the first enabled one is
  // used instead — every forced `extra=` sample renders as an extra-type top
  // badge, so `xbs` stays visible and nothing unsupported is enabled. With no
  // enabled info bucket (or master off) there is no sample at all: the preview
  // falls back to the genuine data path rather than forcing a badge whose
  // category the user switched off.
  const enabledInfoBuckets =
    effPreviewRankingForFamily
      ? effPreviewSashForFamily.filter((b) => b === "upcoming" || b === "new" || b === "award" || b === "extra")
      : []
  const infoSampleBucket =
    opts.previewFamily === "extra"
      ? (enabledInfoBuckets.includes("extra") ? ("extra" as const) : enabledInfoBuckets[0])
      : opts.previewFamily === "info"
        ? enabledInfoBuckets[0]
        : undefined
  const previewExtra = infoSampleBucket ? INFO_FAMILY_SAMPLE_KEY[infoSampleBucket] : null
  const url = buildDefaultsPreviewUrl({
    tmdbKey: opts.tmdbKey,
    userId: opts.userId,
    lang: opts.lang,
    demoMedia: opts.demoMedia ?? null,
    defaultLogoScale: ed.defaultLogoScale,
      defaultLogoOffsetX: ed.defaultLogoOffsetX,
      defaultLogoOffsetY: ed.defaultLogoOffsetY,
      defaultGlobalBadges: ed.defaultGlobalBadges,
      defaultRankingBadges: ed.defaultRankingBadges,
      defaultBadgeGenre: ed.defaultBadgeGenre,
      defaultBadgeYear: ed.defaultBadgeYear,
      defaultBadgeRating: ed.defaultBadgeRating,
      defaultBadgeQuality: ed.defaultBadgeQuality,
      defaultAgeBadge: ed.defaultAgeBadge,
      defaultAgeCountry: ed.defaultAgeCountry,
      defaultAgeBadgeStyle: ed.defaultAgeBadgeStyle,
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
      defaultTopShadeHeight: ed.defaultTopShadeHeight,
      defaultGradientHeight: ed.defaultGradientHeight,
      defaultTopBadgeScale: ed.defaultTopBadgeScale,
      defaultTopBadgeOffsetX: ed.defaultTopBadgeOffsetX,
      defaultTopBadgeOffsetY: ed.defaultTopBadgeOffsetY,
      defaultExtraBadgeScale: ed.defaultExtraBadgeScale,
      defaultExtraBadgeOffsetX: ed.defaultExtraBadgeOffsetX,
      defaultExtraBadgeOffsetY: ed.defaultExtraBadgeOffsetY,
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
      defaultNetworkLogoFollowTitle: ed.defaultNetworkLogoFollowTitle,
      defaultPreRelease: ed.defaultPreRelease,
      defaultRibbonEnabled: ed.defaultRibbonEnabled,
      defaultRibbonSide: ed.defaultRibbonSide,
      defaultPosterShape: ed.defaultPosterShape,
      defaultPosterLayout: ed.defaultPosterLayout,
      defaultPosterFreshScope: ed.defaultPosterFreshScope,
      defaultLogoAlign: ed.defaultLogoAlign,
      defaultDateFormat: ed.defaultDateFormat,
      defaultRegion: ed.defaultRegion,
      // Profilo Orizzontale live (stessi slider del Verticale): chiavi definite
      // vincono sui flat SOLO con shape Orizzontale (regola `land ?? flat` nel
      // builder). Nessun persist/mapping qui: sola lettura per la preview.
      landscape: ed.landscape,
      previewShape: opts.previewShape ?? null,
      defaultSashOrder: ed.defaultSashOrder,
      defaultDisabledContentTags: ed.defaultDisabledContentTags ?? undefined,
      defaultDisabledNetworks: ed.defaultDisabledNetworks ?? undefined,
      previewFamily: opts.previewFamily ?? null,
      previewExtra,
    })
  return { url, shape: previewIsLandscape ? "landscape" as const : "poster" as const }
}

export function DefaultsPosterPreview({ compact, floating, suspended, previewShape, demoMedia, onDemoMediaChange, previewFamily, onPreviewFamilyChange, collapsed = false, onCollapsedChange, draftDefaults, simpleChrome }: DefaultsPosterPreviewProps) {
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
  // Floating-only title search (mobile): a 44x44 icon trigger overlaid
  // inside the existing thumbnail (top-right, above the zoom target) opens
  // ONE bounded dialog reusing the existing isolated
  // DefaultsPreviewTitleSearch (same preview-only onDemoMediaChange, no
  // navigation, no persisted defaults). Overlaid + absolute = the mini
  // preview outer footprint is unchanged (no added row height over the
  // controls). The preview owner stays mounted (no refetch on open); the
  // dialog unmounts on close (desktop owns the always-open inline search
  // instead).
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const searchDialogBodyId = useId()

  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const loadDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevObjUrlRef = useRef("")
  const shownRef = useRef("")
  const lastProgressRef = useRef(-1)

  const demoTitle = demoMedia?.title?.trim() ? demoMedia.title.trim() : "Avatar"
  const searchLanguage = getRegionDef(ed.defaultRegion).lang

  // Draft overlay (guided setup): read through a ref so the debounced URL
  // effect below depends only on the stable stringified identity — the
  // same builder/loading path serves draft and live callers alike.
  const draftDefaultsRef = useRef(draftDefaults)
  draftDefaultsRef.current = draftDefaults
  const draftKey = JSON.stringify(draftDefaults ?? null)
  // Calcolo URL con debounce a 200ms per non sovraccaricare il server durante lo scorrimento dei controlli
  useEffect(() => {
    const { url } = buildDefaultsPreviewUrlFromEditor(ed, {
      tmdbKey,
      userId,
      lang,
      demoMedia: demoMedia ?? null,
      previewShape: previewShape ?? null,
      previewFamily: previewFamily ?? null,
      draftDefaults: draftDefaultsRef.current ?? undefined,
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
    ed.defaultAgeBadge,
    ed.defaultAgeCountry,
    ed.defaultAgeBadgeStyle,
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
    ed.defaultNetworkLogoFollowTitle,
    ed.defaultPreRelease,
    ed.defaultRibbonEnabled,
    ed.defaultRibbonSide,
    ed.defaultPosterShape,
    ed.defaultPosterLayout,
    ed.defaultPosterFreshScope,
    ed.defaultLogoAlign,
    ed.defaultDateFormat,
    ed.defaultRegion,
    ed.defaultSashOrder,
    ed.landscape,
    previewShape,
    previewFamily,
    retryNonce,
    ed,
    // Draft overlay identity: stringified so draft edits rebuild the URL
    // through the same builder path (existing callers: stable undefined).
    draftKey,
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

  // Exit-confirm supersedes the zoom overlay: close it so two dialogs are
  // never active (the shared Modal skips focus-restore when focus already
  // moved to the superseding dialog; closing here never discards or saves).
  // The floating search dialog yields the same way.
  useEffect(() => {
    if (suspended) {
      setZoomed(false)
      setMobileSearchOpen(false)
    }
  }, [suspended])

  // Desktop owns the always-open inline search: letting the floating dialog
  // survive a resize to the static column would mount two title-search
  // owners (duplicate fetches), so it closes on the flip.
  useEffect(() => {
    if (!floating && mobileSearchOpen) setMobileSearchOpen(false)
  }, [floating, mobileSearchOpen])

  const openMobileSearch = () => {
    setZoomed(false)
    setMobileSearchOpen(true)
  }

  // Aspect conforme all'URL (stessa shape effettiva del builder): switch
  // immediato, senza mixing durante il debounce (l'immagine precedente resta
  // in buffer finché la nuova non è pronta).
  const isLandscape = previewShape === "landscape" || (previewShape == null && ed.defaultPosterShape === "landscape")

  // Accessible zoom (shared Modal: focus trap, Escape, backdrop, focus/scroll
  // restore): overlay above the settings dialog (z-[80]). A second click on
  // the enlarged image closes (restore) with no layout shift underneath
  // (Modal locks scroll in a portal). `min-w-0`: the panel is a flex item of
  // the overlay — without it `min-width: auto` lets the poster's intrinsic
  // width force the panel past narrow viewports (cropped zoom on 320px).
  const zoomModal = (
    <Modal
      isOpen={zoomed}
      onClose={() => setZoomed(false)}
      labelledBy="defaults-preview-zoom-title"
      overlayClassName="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      className="max-w-3xl text-center min-w-0"
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
  // click away (preview-only: it only lifts "auto" to the owner). The full
  // hint sentence stays available as its accessible tooltip.
  const editingChip = (
    <div className="w-full flex justify-center">
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
    simpleChrome ? (
      <details data-testid="defaults-preview-sample-disclosure" className="w-full rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1">
        <summary data-testid="defaults-preview-sample-toggle" className="cursor-pointer text-[11px] font-semibold text-zinc-300 min-h-[44px] flex items-center">{t("ui.defaultsPreviewChangeSample")}</summary>
        <div className="pb-1">
          <DefaultsPreviewTitleSearch
            tmdbKey={tmdbKey}
            hasServerKey={serverHasTmdbKey}
            language={searchLanguage}
            demoMedia={demoMedia ?? null}
            onDemoMediaChange={(m) => onDemoMediaChange?.(m)}
            compact={compact}
          />
        </div>
      </details>
    ) : (
    <DefaultsPreviewTitleSearch
      tmdbKey={tmdbKey}
      hasServerKey={serverHasTmdbKey}
      language={searchLanguage}
      demoMedia={demoMedia ?? null}
      onDemoMediaChange={(m) => onDemoMediaChange?.(m)}
      compact={compact}
    />
    )
  )
  const editingChipRendered = simpleChrome ? null : editingChip

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
        {editingChipRendered}

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

  // Floating overlay mode (mobile settings): a minimal LIVE thumbnail card —
  // the same single owner, same blob URL/state/zoom modal as every other
  // mode, only narrower chrome (no header, chip or inline search: a 44x44
  // search icon overlaid top-right INSIDE the thumbnail opens the shared
  // title-search dialog preview-only, so the outer footprint stays at the
  // true ratio with no row below it; the owner wrapper provides minimize +
  // corner controls). The frame keeps the true ratio (2/3 portrait, 16/9
  // landscape) and the full image is always visible (no inner scroll).
  if (floating) {
    return (
      <div className="overflow-hidden rounded-2xl border border-white/15 bg-zinc-950/90 shadow-xl">
        <div data-testid="defaults-preview-media" className={`relative w-full select-none bg-zinc-950/80 ${
          isLandscape ? "aspect-video" : "aspect-[2/3]"
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
              draggable={false}
              className={`absolute inset-0 w-full h-full ${isLandscape ? "object-contain" : "object-cover"}`}
            />
          )}

          {imgSrc ? (
            <button
              type="button"
              data-testid="defaults-preview-zoom-open"
              onClick={() => setZoomed(true)}
              aria-label={t("ui.defaultsPreviewZoomOpen")}
              aria-expanded={zoomed}
              className="absolute inset-0 w-full h-full cursor-zoom-in"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgSrc}
                alt={demoTitle}
                draggable={false}
                onLoad={handleImgLoad}
                className={`absolute inset-0 w-full h-full transition-opacity duration-150 ${isLandscape ? "object-contain" : "object-cover"}`}
              />
            </button>
          ) : (
            <div className="absolute inset-0 bg-surface2/40 animate-pulse" />
          )}

          {imageError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 text-center p-1 z-20">
              <ImageOff className="w-4 h-4 text-zinc-500 mb-0.5" />
              <button
                type="button"
                onClick={() => setRetryNonce((n) => n + 1)}
                aria-label={t("ui.retry")}
                title={t("ui.retry")}
                className="mt-1 px-2 py-0.5 text-[10px] text-zinc-200 bg-white/10 hover:bg-white/20 rounded flex items-center gap-1 cursor-pointer min-w-[44px] min-h-[44px] justify-center"
              >
                <RefreshCw className="w-2.5 h-2.5" />
              </button>
            </div>
          )}
            {/* Overlaid 44x44 search trigger: absolute INSIDE the existing
                thumbnail (sibling of the zoom target, never nested in it) so
                the card footprint is unchanged. Above the zoom layer (z-30):
                the tap reaches this button, never the zoom. Pointer-down is
                stopped so the floating corner-drag never starts from here. */}
            <button
              type="button"
              data-testid="floating-preview-search"
              onClick={(e) => { e.stopPropagation(); openMobileSearch(); }}
              onPointerDown={(e) => { e.stopPropagation(); }}
              aria-expanded={mobileSearchOpen}
              aria-controls={searchDialogBodyId}
              aria-label={t("ui.defaultsPreviewSearchLabel")}
              title={t("ui.defaultsPreviewSearchLabel")}
              className="absolute right-1 top-1 z-30 flex h-[44px] w-[44px] items-center justify-center rounded-xl bg-black/60 border border-white/15 text-zinc-200 transition-all hover:bg-white/10 hover:text-white active:scale-90 cursor-pointer touch-manipulation"
            >
              <Search className="w-4 h-4 shrink-0 text-accent-orange" />
            </button>
          </div>
        <Modal
          isOpen={mobileSearchOpen}
          onClose={() => setMobileSearchOpen(false)}
          labelledBy="floating-preview-search-title"
          testId="floating-preview-search-dialog"
          overlayClassName="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto"
          className="max-w-sm w-full text-left min-w-0 max-h-[calc(100dvh-2rem)] overflow-y-auto"
        >
          {/* Portal-bubbled pointer gestures reach the floating drag wrapper
              through the React tree: stop them here so typing/scrolling the
              results never starts a corner drag. */}
          <div id={searchDialogBodyId} onPointerDown={(e) => e.stopPropagation()}>
            <h3 id="floating-preview-search-title" className="text-sm font-bold text-zinc-100">
              {t("ui.defaultsPreviewSearchLabel")}
            </h3>
            <div className="mt-2">
              <DefaultsPreviewTitleSearch
                tmdbKey={tmdbKey}
                hasServerKey={serverHasTmdbKey}
                language={searchLanguage}
                demoMedia={demoMedia ?? null}
                onDemoMediaChange={(m) => onDemoMediaChange?.(m)}
              />
            </div>
            <button
              type="button"
              data-testid="floating-preview-search-close"
              onClick={() => setMobileSearchOpen(false)}
              className="mt-3 w-full min-h-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-zinc-100 transition-all active:scale-95 cursor-pointer touch-manipulation"
            >
              {t("ui.close")}
            </button>
          </div>
        </Modal>
        {zoomModal}
      </div>
    )
  }

  // Desktop global preview (Impostazioni globali): deliberate compact layout —
  // header, editing chip, poster, title search DIRECTLY BELOW the poster,
  // then the demo-data caution only. DOM order matches visual order (no
  // flex-order swaps), so keyboard/AT navigation follows what sighted users
  // see. The
  // longer explanations (previewEditingHint, settingsGlobalDesc) are
  // intentionally dropped here: the dialog title, format target and footer
  // already carry that context, and the hint survives as the chip tooltip.
  // The column itself scrolls (owner wrapper) at short heights/zoom, so the
  // search stays reachable without scrolling at ordinary desktop sizes while
  // the wheel still works when space is tight. The poster box is bounded on
  // BOTH axes and driven by width (`w-full` + a `min(100%,…)` cap derived
  // from the dialog height), so it grows at taller viewports (1440x900)
  // yet shrinks to fit the remaining column height at 1280x720/1024x768
  // with no column scroll; the `min-h` floor keeps it visually useful and
  // forces the allowed column scroll at short heights instead of shrinking
  // to 1px. No `overflow-hidden` clipping on the card: the bottom stays
  // reachable. The results dropdown renders in-flow below the search input
  // with its own `max-h-44 overflow-y-auto` scroller, so it never pushes
  // the column into scroll at ordinary heights.
  return (
    <div className="w-full flex flex-col items-center bg-surface/40 border border-surface2/60 rounded-2xl p-2 shadow-md min-h-0">
      <div className="w-full flex items-center justify-between mb-0.5 px-1 shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
          <Sparkles className="w-3.5 h-3.5 text-accent-orange" />
          <span>{t("ui.defaultsPreviewTitle")}</span>
        </div>
        <span className="text-[10px] text-zinc-400 font-mono">
          {demoMedia?.title ? demoTitle : t("ui.defaultsPreviewSubtitle")}
        </span>
      </div>
      {editingChipRendered}

      <div data-testid="defaults-preview-media" className={`relative select-none bg-zinc-950/90 rounded-2xl overflow-hidden shadow-2xl border border-white/10 mx-auto mt-1 w-full shrink-0 ${
        isLandscape ? "aspect-video max-w-[min(100%,calc((88dvh_-_493px)*1.778))] max-h-[calc(88dvh_-_493px)] min-h-[90px]" : "aspect-[2/3] max-w-[min(100%,calc((88dvh_-_493px)*0.667))] max-h-[calc(88dvh_-_493px)] min-h-[120px]"
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

      <div className="w-full mt-1 shrink-0">
        {searchRow}
      </div>

      <p className="text-[10px] text-amber-200/70 text-center mt-1 px-2 select-none leading-snug shrink-0">
        {t("ui.defaultsPreviewSamplesNotice")}
      </p>
      {zoomModal}
    </div>
  )
}
