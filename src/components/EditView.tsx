"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import { usePSelector } from "@/lib/context"
import { currentPathUuid, USER_UNLOCK_EVENT } from "@/lib/user-token"
import { isMultiUserServer } from "@/lib/guest-guard"
import { UserSpacesList } from "@/components/UserSpaceSection"
import { useT } from "@/lib/contexts/TranslationContext"
import { usePosterEditor } from "@/lib/contexts/PosterEditorContext"
import type { TMDBImage } from "@/lib/types"
import { effectiveMappingForShape, type LandscapeSettings } from "@/lib/types"
import { PosterOptions } from "@/components/PosterOptions"
import { BackdropOptions } from "@/components/BackdropOptions"
import { LogoOptions } from "@/components/LogoOptions"
import { EditorPanel } from "@/components/EditorPanel"
import { copyText } from "@/lib/clipboard"
import { userFetch } from "@/lib/http"
import { SearchBar } from "@/components/SearchBar"
import { PosterCarousel } from "@/components/PosterCarousel"
import { ScrollReveal } from "@/components/ScrollReveal"
import { HomeHero } from "@/components/HomeHero"
import { PosterPreview } from "@/components/PosterPreview"
import { PosterDepthEdge, PosterDepthSheen } from "@/components/PosterDepthGlow"
import { BadgeControls } from "@/components/BadgeControls"
import { TransformControls } from "@/components/TransformControls"
import { EpisodeGroupControls } from "@/components/EpisodeGroupControls"
import { JwRankBadge } from "@/components/JwRankBadge"
import { usePosterPreview } from "@/lib/usePosterPreview"
import { Check, Clock, Save, Trash2, X, ChevronLeft, RectangleVertical, RectangleHorizontal, Tv } from "lucide-react"

export default function EditView() {
  const accentColor = usePSelector((v) => v.accentColor)
  const clearRecentSearches = usePSelector((v) => v.clearRecentSearches)
  const doSearch = usePSelector((v) => v.doSearch)
  const goHome = usePSelector((v) => v.goHome)
  const loadingImages = usePSelector((v) => v.loadingImages)
  const logos = usePSelector((v) => v.logos)
  const mappingsMap = usePSelector((v) => v.mappingsMap)
  const posterActivePath = usePSelector((v) => v.posterActivePath)
  const posters = usePSelector((v) => v.posters)
  const previewPoster = usePSelector((v) => v.previewPoster)
  const query = usePSelector((v) => v.query)
  const recentSearches = usePSelector((v) => v.recentSearches)
  const removeLogo = usePSelector((v) => v.removeLogo)
  const removeMapping = usePSelector((v) => v.removeMapping)
  const removeRecentSearch = usePSelector((v) => v.removeRecentSearch)
  const router = usePSelector((v) => v.router)
  const saveConfig = usePSelector((v) => v.saveConfig)
  const selected = usePSelector((v) => v.selected)
  const selectedLogo = usePSelector((v) => v.selectedLogo)
  const selectLogo = usePSelector((v) => v.selectLogo)
  const selectPoster = usePSelector((v) => v.selectPoster)
  const selectBackdrop = usePSelector((v) => v.selectBackdrop)
  const removeBackdrop = usePSelector((v) => v.removeBackdrop)
  const setPreviewId = usePSelector((v) => v.setPreviewId)
  const setPreviewPoster = usePSelector((v) => v.setPreviewPoster)
  const setQuery = usePSelector((v) => v.setQuery)
  const setSelected = usePSelector((v) => v.setSelected)
  const setSelectedLogo = usePSelector((v) => v.setSelectedLogo)
  const setSettingsOpen = usePSelector((v) => v.setSettingsOpen)
  const stremioPreview = usePSelector((v) => v.stremioPreview)
  const setStremioPreview = usePSelector((v) => v.setStremioPreview)
  const titleOf = usePSelector((v) => v.titleOf)
  const tmdbKey = usePSelector((v) => v.tmdbKey)
  const serverHasTmdbKey = usePSelector((v) => v.serverHasTmdbKey)
  // Chiave disponibile = browser oppure env d'istanza (fallback server):
  // solo quando mancano entrambe si mostra il pannello di benvenuto.
  const hasTmdbKey = !!tmdbKey || serverHasTmdbKey
  const tvdbApiKey = usePSelector((v) => v.tvdbApiKey)
  const serverKeyStatus = usePSelector((v) => v.serverKeyStatus)
  // Chiave TVDB effettiva = device oppure namespace (risolta dal server via ?u=).
  const hasTvdbKey = !!tvdbApiKey || !!serverKeyStatus?.tvdb
  const yearOf = usePSelector((v) => v.yearOf)
  const { t, lang } = useT()
  const ed = usePosterEditor()
  const [searchFocused, setSearchFocused] = useState(false)
  const [tvdbId, setTvdbId] = useState<number | null>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Fix L30: timer del "copied" ripulito su unmount (setState post-unmount).
  const urlCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saveFlash, setSaveFlash] = useState(false)
  const [mobileSection, setMobileSection] = useState<"poster" | "preview" | "customize">("preview")
  const [activeRightTab, setActiveRightTab] = useState<"logo" | "badge" | "transform" | "stagioni">("logo")
  // Gate profili stile AIO: con multi-user attivo e senza UUID nel path, la
  // home diventa creazione/selezione spazio — ricerca ed editor restano
  // bloccati finché non apri il tuo spazio (/u/<uuid>/configure). Il gate
  // NON dipende da `selected`: una selezione arrivata da altre viste
  // (Cataloghi, I Miei Poster) non deve sbloccare l'editor da sola.
  const [pathUuid, setPathUuid] = useState<string | null>(null)
  const [multiUserOn, setMultiUserOn] = useState(false)
  useEffect(() => {
    // Risincronizza a ogni unlock/popstate: back/forward e SPA che riusano
    // l'albero lascerebbero il gate su un path vecchio (bloccato per sempre
    // fino al refresh).
    const syncPath = () => setPathUuid(currentPathUuid())
    syncPath()
    let live = true
    isMultiUserServer()
      .then((v) => { if (live) setMultiUserOn(v) })
      .catch(() => { if (live) setMultiUserOn(false) })
    window.addEventListener(USER_UNLOCK_EVENT, syncPath)
    window.addEventListener("popstate", syncPath)
    return () => {
      live = false
      window.removeEventListener(USER_UNLOCK_EVENT, syncPath)
      window.removeEventListener("popstate", syncPath)
    }
  }, [])
  const profileGate = multiUserOn && !pathUuid
  const [activePosterTab, setActivePosterTab] = useState("clean")
  const stremioPreviewUrl = usePSelector((v) => v.stremioPreviewUrl)
  const [stremioModalOpen, setStremioModalOpen] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)

  const closeStremioModal = useCallback(() => {
    setStremioModalOpen(false)
    setStremioPreview(false)
  }, [setStremioPreview])

  // Quando si seleziona un nuovo titolo, mostra sempre prima i clean (iso_639_1 === null)
  useEffect(() => {
    if (selected?.id) setActivePosterTab("clean")
  }, [selected?.id])

  const { imageError, setImageError, previewLoading, loadProgress, imgSrc, retry } = usePosterPreview()

  const selectedMappingKey = selected ? `${selected.media_type}:${selected.id}` : null
  const selectedMapping = selectedMappingKey ? mappingsMap.get(selectedMappingKey) : undefined
  const hasMapping = !!selectedMapping

  const handleSave = useCallback(async () => {
    await saveConfig()
    // Feedback tangibile sull'artefatto (non solo toast): anello smeraldo +
    // sweep per 600ms sullo stage della preview.
    setSaveFlash(true)
    if (saveFlashTimerRef.current) clearTimeout(saveFlashTimerRef.current)
    saveFlashTimerRef.current = setTimeout(() => setSaveFlash(false), 600)
  }, [saveConfig])

  // Mobile: dopo il tap su un poster salta ad "Anteprima" (nella tab Poster
  // non si vedrebbe alcun feedback). Solo sotto lg, dove lo switcher esiste;
  // su desktop resti dove sei per confrontare varianti.
  // Landscape: senza sfondo esplicito seleziona in automatico uno sfondo.
  // - Titolo con mapping che HA un backdrop: ripristina quello salvato
  //   (mai sovrascritto dal primo TMDB).
  // - Mapping senza backdrop o titolo nuovo: primo sfondo TMDB.
  useEffect(() => {
    if (ed.posterShape !== "landscape") return
    if (ed.selectedBackdrop) return
    if (selectedMapping?.backdropPath) {
      // Ripristino diretto (NON selectBackdrop: quello azzererebbe
      // backdropScale/offset già caricati dal mapping).
      const saved = ed.backdrops.find((b) => b.file_path === selectedMapping.backdropPath)
      ed.setSelectedBackdrop(saved ?? { file_path: selectedMapping.backdropPath, iso_639_1: null, vote_average: 0, width: 0, height: 0 })
      return
    }
    if (hasMapping) return
    if (ed.backdrops.length === 0) return
    void selectBackdrop(ed.backdrops[0])
  }, [ed.posterShape, ed.selectedBackdrop, hasMapping, selectedMapping, ed.backdrops, selectBackdrop]) // eslint-disable-line react-hooks/exhaustive-deps -- dipendenze granulari intenzionali: `ed` intero rifarebbe scattare l'effetto a ogni tick editor e riselezionerebbe dopo una deselezione volontaria

  // Dual-format: stash degli slider non salvati per formato. Senza, passare
  // da A a B e ritorno perderebbe in silenzio le modifiche non salvate di A
  // (lo switch caricherebbe i valori salvati di B sopra quelle di A). Lo
  // stash è per-titolo: cambiando titolo si azzera (selectedMappingKey).
  const shapeStashRef = useRef<Partial<Record<"poster" | "landscape", LandscapeSettings>>>({})
  const shapeStashKeyRef = useRef<string | null>(null)
  // Cambio formato: portrait deseleziona sempre lo sfondo (in verticale
  // `poster=` + `backdrop=` comporrebbero la banda sopra il poster),
  // landscape lascia fare all'effetto sopra. Gli slider passano al profilo
  // del formato scelto (stash non salvato > profilo salvato), così la
  // preview WYSIWYG mostra il tuning reale di quel formato.
  const handleShapeChange = useCallback((next: "poster" | "landscape") => {
    const prev = ed.posterShape
    if (prev === next) return
    const stashKey = selectedMappingKey ?? "new"
    if (shapeStashKeyRef.current !== stashKey) {
      shapeStashRef.current = {}
      shapeStashKeyRef.current = stashKey
    }
    shapeStashRef.current[prev] = {
      logoScale: ed.logoScale, logoOffsetX: ed.logoOffsetX, logoOffsetY: ed.logoOffsetY,
      topBadgeScale: ed.topBadgeScale, topBadgeOffsetX: ed.topBadgeOffsetX, topBadgeOffsetY: ed.topBadgeOffsetY,
      genreBadgeScale: ed.genreBadgeScale, genreBadgeOffsetX: ed.genreBadgeOffsetX, genreBadgeOffsetY: ed.genreBadgeOffsetY,
      qualityBadgeScale: ed.qualityBadgeScale, qualityBadgeOffsetX: ed.qualityBadgeOffsetX, qualityBadgeOffsetY: ed.qualityBadgeOffsetY,
      networkLogoScale: ed.networkLogoScale, networkLogoOffsetX: ed.networkLogoOffsetX, networkLogoOffsetY: ed.networkLogoOffsetY,
      gradientHeight: ed.gradientHeight, blurEnabled: ed.blurEnabled,
      blurIntensity: ed.blurIntensity, blurFade: ed.blurFade, blurDarkness: ed.blurDarkness,
    }
    if (next === "poster") removeBackdrop()
    ed.setPosterShape(next)
    ed.setLogoAlign(next === "landscape" ? (ed.defaultLogoAlign ?? "left") : "center")
    const src = shapeStashRef.current[next]
      ?? (selectedMapping ? effectiveMappingForShape(selectedMapping, next) : null)
    if (src) {
      ed.setLogoScale(src.logoScale ?? ed.logoScale)
      ed.setLogoOffsetX(src.logoOffsetX ?? ed.logoOffsetX)
      ed.setLogoOffsetY(src.logoOffsetY ?? ed.logoOffsetY)
      ed.setTopBadgeScale(src.topBadgeScale ?? ed.topBadgeScale)
      ed.setTopBadgeOffsetX(src.topBadgeOffsetX ?? ed.topBadgeOffsetX)
      ed.setTopBadgeOffsetY(src.topBadgeOffsetY ?? ed.topBadgeOffsetY)
      ed.setGenreBadgeScale(src.genreBadgeScale ?? ed.genreBadgeScale)
      ed.setGenreBadgeOffsetX(src.genreBadgeOffsetX ?? ed.genreBadgeOffsetX)
      ed.setGenreBadgeOffsetY(src.genreBadgeOffsetY ?? ed.genreBadgeOffsetY)
      ed.setQualityBadgeScale(src.qualityBadgeScale ?? ed.qualityBadgeScale)
      ed.setQualityBadgeOffsetX(src.qualityBadgeOffsetX ?? ed.qualityBadgeOffsetX)
      ed.setQualityBadgeOffsetY(src.qualityBadgeOffsetY ?? ed.qualityBadgeOffsetY)
      ed.setNetworkLogoScale(src.networkLogoScale ?? ed.networkLogoScale)
      ed.setNetworkLogoOffsetX(src.networkLogoOffsetX ?? ed.networkLogoOffsetX)
      ed.setNetworkLogoOffsetY(src.networkLogoOffsetY ?? ed.networkLogoOffsetY)
      ed.setGradientHeight(src.gradientHeight ?? ed.gradientHeight)
      ed.setBlurEnabled(src.blurEnabled ?? ed.blurEnabled)
      ed.setBlurIntensity(src.blurIntensity ?? ed.blurIntensity)
      ed.setBlurFade(src.blurFade ?? ed.blurFade)
      ed.setBlurDarkness(src.blurDarkness ?? ed.blurDarkness)
    }
  }, [ed, removeBackdrop, selectedMapping, selectedMappingKey])

  const handleSelectPoster = useCallback((img: TMDBImage) => {
    void selectPoster(img)
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023.5px)").matches) {
      setMobileSection("preview")
    }
  }, [selectPoster])

  // Landscape: tap sullo sfondo salta all'anteprima (come i poster).
  const handleSelectBackdrop = useCallback((img: TMDBImage) => {
    void selectBackdrop(img)
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023.5px)").matches) {
      setMobileSection("preview")
    }
  }, [selectBackdrop])

  // Mobile: tap su un logo salta all'anteprima (come poster e backdrop).
  const handleSelectLogo = useCallback((img: TMDBImage) => {
    void selectLogo(img)
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023.5px)").matches) {
      setMobileSection("preview")
    }
  }, [selectLogo])

  const searchBar = (
    <div className={selected ? "w-full max-w-lg relative z-[100] isolate" : "max-w-lg mx-auto relative z-[100] isolate mb-8"}>
      <SearchBar tmdbKey={tmdbKey} hasServerKey={serverHasTmdbKey} value={query} onChange={setQuery} onSearch={(q) => { setQuery(q); router.push("search"); doSearch(q) }} large onFocus={() => setSearchFocused(true)} onBlur={() => { blurTimerRef.current = setTimeout(() => setSearchFocused(false), 200) }} />
      {searchFocused && recentSearches.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl p-2 shadow-2xl shadow-black/50 z-50 animate-fade-scale-in">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/[0.06] mb-1">
            <p className="text-xs text-muted font-semibold">{t("ui.recentSearches")}</p>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                clearRecentSearches()
              }}
              className="text-[11px] text-zinc-400 hover:text-rose-400 font-medium flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded hover:bg-rose-500/10 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              <span>{t("ui.clearRecentSearches")}</span>
            </button>
          </div>
          {recentSearches.map((s) => (
            <button type="button" key={s} onMouseDown={(e) => e.preventDefault()} onClick={() => { setQuery(s); router.push("search"); doSearch(s); setSearchFocused(false) }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent-orange/10 text-sm text-zinc-300 hover:text-accent transition-all duration-150 text-left">
              <Clock className="w-4 h-4 text-zinc-500 shrink-0" />
              <span className="flex-1 truncate">{s}</span>
              <span onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }} onClick={(e) => { e.stopPropagation(); removeRecentSearch(s) }} aria-label={t("ui.remove")} className="text-danger hover:text-red-300 transition-all duration-150 text-sm px-2 shrink-0"><X className="w-3.5 h-3.5" /></span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
      if (urlCopiedTimerRef.current) clearTimeout(urlCopiedTimerRef.current)
      if (saveFlashTimerRef.current) clearTimeout(saveFlashTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener("keydown", fn)
    return () => window.removeEventListener("keydown", fn)
  }, [handleSave])

  // TVDB id per i dettagli titolo (usa TMDB external_ids via seasonTypes route con tmdbKey)
  // Campi primitivi estratti per il deps array: l'oggetto `selected` cambia
  // identità a ogni update del parent anche quando i campi rilevanti non
  // cambiano — dipendere dall'oggetto rifarebbe il fetch TVDB a ogni render.
  const selectedId = selected?.id
  const selectedImdbId = selected?.imdb_id
  const selectedMediaType = selected?.media_type
  useEffect(() => {
    if (selectedMediaType !== "tv" || !hasTvdbKey) {
      setTvdbId(null)
      return
    }
    let active = true
    const candidates = [selectedImdbId, String(selectedId)].filter(Boolean) as string[]
    const fetchTvdbId = async (cid: string) => {
      try {
        const sp = new URLSearchParams()
        if (tvdbApiKey) sp.set("tvdb_key", tvdbApiKey)
        if (tmdbKey) sp.set("tmdb_key", tmdbKey)
        const query = sp.toString() ? `?${sp.toString()}` : ""
        const headers: Record<string, string> = {}
        if (tvdbApiKey) headers["x-api-key"] = tvdbApiKey
        if (tmdbKey) headers["x-tmdb-key"] = tmdbKey
        const res = await userFetch(`/api/tvdb/${encodeURIComponent(cid)}/seasonTypes${query}`, {
          headers: Object.keys(headers).length > 0 ? headers : undefined,
        })
        const d = await res.json().catch(() => ({}))
        if (d?.tvdbId && Number.isFinite(d.tvdbId)) return d.tvdbId as number
        // fallback: se non c'è tvdbId ma ci sono results, prova a inferire da cache? altrimenti null
        return null
      } catch { return null }
    }
    ;(async () => {
      for (const cid of candidates) {
        const id = await fetchTvdbId(cid)
        if (active && id) { setTvdbId(id); return }
      }
      if (active) setTvdbId(null)
    })()
    return () => { active = false }
  }, [selectedId, selectedImdbId, selectedMediaType, hasTvdbKey, tvdbApiKey, tmdbKey])

  const cleanPoster = previewPoster?.iso_639_1 === null
  const isLandscape = ed.posterShape === "landscape"

  // Memoizzato: l'array entra nel deps array dell'effect sotto e non deve
  // cambiare identità a ogni render (react-hooks/exhaustive-deps).
  const rightTabs = useMemo(() => [
    { key: "logo", label: t("ui.logoSection") },
    { key: "badge", label: t("ui.badgeSection") },
    // Sempre visibile: ospita anche badge superiore e sfocatura, che valgono
    // pure senza logo film (la sezione logo resta condizionata dentro).
    { key: "transform", label: t("ui.transform") },
    ...(selected?.media_type === "tv" ? [{ key: "stagioni", label: t("ui.seasons") || "Stagioni" }] : []),
  ], [t, selected?.media_type])

  useEffect(() => {
    if (!rightTabs.some((tab) => tab.key === activeRightTab)) {
      setActiveRightTab("logo")
    }
    // `rightTabs` è derivato da selectedLogo/selected?.media_type: dipendere
    // dall'array (ricreato a ogni render) è equivalente e idempotente — il
    // body non fa setState quando la tab attiva è ancora valida.
  }, [rightTabs, activeRightTab])

  return (
    <div>
      {selected && !profileGate && (
        <div className="flex flex-col items-center w-full">
          {/* Desktop Header */}
          <header className="hidden lg:flex w-full px-4 md:px-6 -mt-1 md:-mt-4 mb-3 flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo locale */}
            <img
              onClick={goHome}
              src="/pictorium.svg"
              alt="Pictorium"
              decoding="async"
              className="header-logo h-20 md:h-24 w-auto cursor-pointer hover:brightness-110 active:scale-95 transition-all duration-150 mb-1"
            />
            <p className="header-tagline text-xs md:text-sm text-muted">{t("ui.homeTagline")}</p>
          </header>

          {/* Mobile Sticky Controls Header (Top Bar + Segmented Switcher) */}
          <div className="sticky top-0 z-30 flex flex-col items-center w-full bg-background/95 backdrop-blur-xl pt-1 pb-3 px-2 lg:hidden shadow-md shadow-black/20">
            {/* Mobile Top Bar: Back / Title / Quick Save */}
            <div className="flex items-center justify-between w-full mb-2.5 gap-2 max-w-md mx-auto">
              <button
                type="button"
                onClick={() => { setSelected(null); setPreviewPoster(null); setSelectedLogo(null); setPreviewId(null) }}
                className="flex items-center gap-1 px-3 py-2 rounded-xl bg-surface border border-white/10 text-xs font-semibold text-zinc-300 hover:text-white active:scale-95 transition-all shrink-0 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>{t("ui.back")}</span>
              </button>
              <div className="flex-1 min-w-0 text-center px-1">
                <p className="text-xs font-bold text-zinc-100 truncate">{titleOf(selected)}</p>
                <p className="text-[10px] text-zinc-400 font-mono">{yearOf(selected)} · {selected.media_type === "movie" ? t("ui.movie") : t("ui.tvSeries")}</p>
              </div>
              {previewPoster && (
                <button
                  type="button"
                  aria-label={t("ui.savePoster")}
                  onClick={handleSave}
                  className="btn-primary flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-white font-semibold text-xs shrink-0 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{t("ui.save")}</span>
                </button>
              )}
            </div>

            {/* Mobile Segmented Switcher (Scegli Poster o Sfondi / Anteprima / Modifica) */}
            <div className="relative flex items-center justify-center p-1 bg-surface/90 backdrop-blur-md rounded-2xl border border-white/[0.08] w-full max-w-md mx-auto shadow-lg shadow-black/20 overflow-hidden">
              {/* Sliding Pill Indicator (GPU-accelerated) */}
              <div
                className="absolute top-1 bottom-1 rounded-xl bg-accent-orange shadow-md shadow-accent-orange/25 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] pointer-events-none"
                style={{
                  width: "calc((100% - 8px) / 3)",
                  left: "4px",
                  transform:
                    mobileSection === "poster"
                      ? "translateX(0%)"
                      : mobileSection === "preview"
                        ? "translateX(100%)"
                        : "translateX(200%)",
                }}
              />
              <button
                type="button"
                onClick={() => setMobileSection("poster")}
                className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                  mobileSection === "poster"
                    ? "text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span>{isLandscape ? (t("ui.backdrops") || "Sfondi") : t("ui.poster")}</span>
                <span className="text-[10px] opacity-75 font-mono">({isLandscape ? ed.backdrops.length : posters.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileSection("preview")}
                className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                  mobileSection === "preview"
                    ? "text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span>{t("ui.preview")}</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileSection("customize")}
                className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-semibold transition-colors duration-200 cursor-pointer ${
                  mobileSection === "customize"
                    ? "text-white"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <span>{t("ui.customize")}</span>
              </button>
            </div>
          </div>

          <div className="editor-workspace w-full px-2 sm:px-4 md:px-6 lg:h-[clamp(660px,calc(100dvh-260px),830px)] lg:min-h-0">

            {/* LEFT: Poster (verticale) o Sfondi (orizzontale) */}
            <div className={mobileSection === "poster" ? "block w-full" : "hidden lg:block h-full min-w-0"}>
              <EditorPanel className="animate-fade-scale-in-panel-left h-full" aria-label={`${selected?.title || ""} — Poster selection`} title={isLandscape ? t("ui.backdropAvailable") : t("ui.posterAvailable")} headerRight={<span className="text-[10px] font-mono text-muted px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/10 tabular-nums">{isLandscape ? ed.backdrops.length : posters.length}</span>}>
                {loadingImages ? (
                  <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 rounded-lg skeleton-shimmer" />)}</div>
                ) : isLandscape ? (
                  <BackdropOptions backdrops={ed.backdrops} backdropActivePath={ed.selectedBackdrop?.file_path ?? null} selectBackdrop={handleSelectBackdrop} clearBackdrop={removeBackdrop} loading={loadingImages} />
                ) : (
                  <PosterOptions posters={posters} posterActivePath={posterActivePath}
                    lang={lang} selectPoster={handleSelectPoster} activeGroup={activePosterTab} onActiveGroupChange={setActivePosterTab}
                    showTabs />
                )}
              </EditorPanel>
            </div>

            {/* CENTER: Preview */}
            <div className={mobileSection === "preview" ? "block w-full" : "hidden lg:block h-full min-w-0"}>
              <EditorPanel className="animate-fade-scale-in h-full" title={<><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle shadow-[0_0_6px_rgba(52,211,153,0.7)]" aria-hidden="true" />{stremioPreview ? "Stremio" : t("ui.previewLive")}</>} headerRight={
                <div className="flex gap-1" role="group" aria-label={t("ui.posterShape")}>
                  <button
                    type="button"
                    title={t("ui.posterShapePortrait")}
                    aria-label={t("ui.posterShapePortrait")}
                    aria-pressed={ed.posterShape !== "landscape"}
                    onClick={() => handleShapeChange("poster")}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150 cursor-pointer ${
                      ed.posterShape !== "landscape"
                        ? "bg-white/20 text-white shadow-sm"
                        : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                    }`}
                  >
                    <RectangleVertical className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    title={t("ui.posterShapeLandscape")}
                    aria-label={t("ui.posterShapeLandscape")}
                    aria-pressed={ed.posterShape === "landscape"}
                    onClick={() => handleShapeChange("landscape")}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150 cursor-pointer ${
                      ed.posterShape === "landscape"
                        ? "bg-white/20 text-white shadow-sm"
                        : "bg-white/5 text-muted hover:bg-white/10 hover:text-zinc-200"
                    }`}
                  >
                    <RectangleHorizontal className="w-4 h-4" />
                  </button>
                </div>
              } footer={
                previewPoster && selected ? (
                  <div className="w-full">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {(() => {
                      if (!selected) return null
                      const key = `${selected.media_type}:${selected.id}`
                      const hasMapping = mappingsMap.get(key)
                      if (!hasMapping) return null
                      return (
                        <button type="button" aria-label={t("ui.remove")} onClick={() => { removeMapping(hasMapping).catch((e) => console.error("[pictorium] Remove mapping failed:", e)); setSelected(null); setPreviewPoster(null); setSelectedLogo(null); setPreviewId(null) }} className="btn-danger min-h-[44px] px-4 rounded-xl text-xs">
                          <Trash2 className="w-4 h-4" />
                          {t("ui.remove")}
                        </button>
                      )
                    })()}
                    <button type="button" aria-label={t("ui.testStremioUrl")} onClick={() => {
                      setStremioPreview(true)
                      setStremioModalOpen(true)
                      setMobileSection("preview")
                    }} className="btn-secondary min-h-[44px] px-4 rounded-xl text-xs">
                      <Tv className="w-4 h-4" />
                      {t("ui.testStremioUrl")}
                    </button>
                    <button type="button" aria-label={t("ui.savePoster")} onClick={handleSave} className="btn-primary min-h-[44px] px-5 rounded-xl">
                      <Save className="w-4 h-4" />
                      {t("ui.savePoster")}
                    </button>
                  </div>
                  </div>
              ) : undefined}>
              <div className="flex flex-col items-center h-full min-h-0">
                <div className="flex-1 min-h-0 w-full flex items-center justify-center">
                  <div className={`editor-preview-fit relative ${isLandscape ? "editor-preview-fit-landscape" : ""}`}>
                    <div className={`editor-stage editor-stage-fill isolate ${previewPoster?.file_path ? "editor-stage-glow" : ""} ${saveFlash ? "editor-stage-save-flash" : ""}`}>
                      {/* NuvioDesktop-style depth edge */}
                      <PosterDepthEdge edgeStrength={40} edgeCoverage={10} />
                      {/* Accent Glow (firma Pictorium: si ritinta col colore dominante) */}
                      <div
                        className="absolute -inset-8 rounded-3xl opacity-45 blur-3xl pointer-events-none transition-all duration-700 ease-out z-0"
                        style={{
                          background: accentColor
                            ? `radial-gradient(circle at 50% 50%, ${accentColor}, transparent 70%)`
                            : "radial-gradient(circle at 50% 50%, rgba(232, 93, 42, 0.40), transparent 70%)",
                        }}
                      />
                      <div className="absolute inset-0 z-[1]">
                        <PosterPreview
                          previewLoading={previewLoading}
                          loadProgress={loadProgress}
                          imageError={imageError}
                          setImageError={setImageError}
                          imgSrc={imgSrc}
                          onRetry={retry}
                          landscape={ed.posterShape === "landscape"}
                        />
                      </div>
                      <PosterDepthSheen sheenStrength={20} />
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-zinc-400 text-center mt-3 shrink-0">{selectedLogo ? t("ui.logoSelected") : previewPoster?.iso_639_1 === null ? `${t("ui.clean")} ${t("ui.selected").toLowerCase()}` : previewPoster ? t("ui.logoHint") : t("ui.noPosterSelected")}</p>
              </div>
            </EditorPanel>
            </div>

            {/* RIGHT: Edit */}
            <div className={mobileSection === "customize" ? "block w-full" : "hidden lg:block h-full min-w-0"}>
              <EditorPanel className="animate-fade-scale-in-panel-right h-full" title={t("ui.customize")} tabs={rightTabs} activeTab={activeRightTab} onTabChange={(k) => setActiveRightTab(k as typeof activeRightTab)}>
                {selected && (
                  <div className="mb-3 pb-3 border-b border-white/[0.08]">
                    <h3 className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">{t("ui.details")}</h3>
                    <p className="text-sm font-bold tracking-tight text-zinc-50 truncate">{titleOf(selected)}</p>
                    <p className="text-[11px] font-mono text-zinc-400 mt-1">{yearOf(selected)} · {selected.media_type === "movie" ? t("ui.movie") : t("ui.tvSeries")} · TMDB <a href={`https://www.themoviedb.org/${selected.media_type}/${selected.id}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white underline underline-offset-2">{selected.id}</a>{selected.imdb_id ? <> · IMDB <a href={`https://www.imdb.com/title/${selected.imdb_id}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white underline underline-offset-2">{selected.imdb_id}</a></> : ""}{tvdbId ? <> · TVDB <a href={`https://thetvdb.com/?tab=series&id=${tvdbId}`} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-white underline underline-offset-2">{tvdbId}</a></> : ""}</p>

                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      {cleanPoster && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-muted uppercase tracking-wide">{t("ui.clean")}</span>
                      )}
                      {(() => {
                        const key = `${selected.media_type}:${selected.id}`
                        if (!mappingsMap.get(key)) return null
                        return (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 flex items-center gap-1">
                            <Check className="w-3 h-3 stroke-[3]" />
                            {t("ui.savedShort")}
                          </span>
                        )
                      })()}
                      <JwRankBadge tmdbId={selected.id} type={selected.media_type === "movie" ? "movie" : "tv"} regionCode={ed.defaultRegion} />
                    </div>
                  </div>
                )}
                <div className="animate-tab-fade-in space-y-3">
                {activeRightTab === "logo" && <>
                  <LogoOptions logos={logos} selectedLogo={selectedLogo} lang={lang} selectLogo={handleSelectLogo} removeLogo={removeLogo} disabled={!cleanPoster} />
                  {!cleanPoster && <p className="text-xs text-zinc-400 text-center mt-2 px-1">{t("ui.logoHint")}</p>}
                </>}
                {activeRightTab === "badge" && <BadgeControls />}
                {activeRightTab === "transform" && <TransformControls />}
                {activeRightTab === "stagioni" && <EpisodeGroupControls />}
                </div>

              </EditorPanel>
            </div>

          </div>
        </div>
      )}
      {profileGate && (
        <div className="max-w-md mx-auto mt-16 mb-16 animate-fade-scale-in-hero">
          <div className="text-center mb-5">
            <div className="mb-4"><span className="hero-kicker">{t("ui.profileGateKicker")}</span></div>
            <h2 className="text-lg font-bold text-zinc-100 mb-2">{t("ui.profileGateTitle")}</h2>
            <p className="text-sm text-muted leading-relaxed">{t("ui.profileGateDesc")}</p>
          </div>
          <UserSpacesList />
        </div>
      )}
      {!selected && !profileGate && !hasTmdbKey && (
        <div>
          {searchBar}
        </div>
      )}
      {!selected && !profileGate && !hasTmdbKey && (
        <div className="max-w-md mx-auto mt-16 mb-16">
          <div className="glass-panel relative overflow-hidden p-8 flex flex-col items-center text-center animate-fade-scale-in-hero">
            <div className="welcome-accent" />
            <span className="hero-kicker mb-4">{t("ui.welcomePanelKicker")}</span>
            <div className="w-14 h-14 rounded-2xl bg-accent-orange/15 border border-accent-orange/20 flex items-center justify-center mb-5">
              <svg className="w-7 h-7 text-accent-orange" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <polygon points="9.5 8 15.5 12 9.5 16 9.5 8" fill="currentColor" stroke="none"/>
              </svg>
            </div>
            <h2 className="text-lg font-bold text-zinc-100 mb-2">{t("ui.welcomePanelTitle")}</h2>
            <p className="text-sm text-muted mb-6 leading-relaxed">{t("ui.noKey")}</p>
            <button type="button" onClick={() => setSettingsOpen(true)} className="btn-primary px-5 py-2.5 text-sm">
              {t("ui.openSettings")}
            </button>
            <div className="grid grid-cols-3 gap-3 mt-8 w-full">
              <div className="feature-card">
                <div className="feature-icon">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="feature-card-title">{t("ui.welcomeFeature1Title")}</span>
                  <span className="feature-card-desc">{t("ui.welcomeFeature1Desc")}</span>
                </div>
              </div>
              <div className="feature-card">
                <div className="feature-icon">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><polygon points="9.5 8 15.5 12 9.5 16 9.5 8" fill="currentColor" stroke="none"/></svg>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="feature-card-title">{t("ui.welcomeFeature2Title")}</span>
                  <span className="feature-card-desc">{t("ui.welcomeFeature2Desc")}</span>
                </div>
              </div>
              <div className="feature-card">
                <div className="feature-icon">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="feature-card-title">{t("ui.welcomeFeature3Title")}</span>
                  <span className="feature-card-desc">{t("ui.welcomeFeature3Desc")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {!selected && !profileGate && hasTmdbKey && (
        <>
          <HomeHero search={searchBar} />
          <ScrollReveal animation="fade-up" threshold={0.05}>
            <PosterCarousel />
          </ScrollReveal>
        </>
      )}

      {stremioModalOpen && stremioPreview && stremioPreviewUrl && createPortal(
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm overflow-y-auto animate-fade-scale-in" onClick={closeStremioModal} role="dialog" aria-modal="true" aria-label="Stremio">
          <div className="max-w-md mx-auto px-4 py-8 min-h-full flex flex-col justify-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-zinc-50">Stremio</h3>
              <button type="button" onClick={closeStremioModal} aria-label={t("ui.close")} className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface2 hover:bg-zinc-700 text-muted hover:text-zinc-200 transition-all"><X className="w-5 h-5" /></button>
            </div>
            <div className="rounded-2xl overflow-hidden border border-white/10 bg-surface shadow-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- poster reale renderizzato dal server */}
              <img src={stremioPreviewUrl} alt="Stremio" className="w-full" />
            </div>
            <div className="mt-4 flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-3 py-2">
              <code className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-mono text-muted select-text">{stremioPreviewUrl}</code>
            </div>
            <div className="mt-3">
              <button type="button" onClick={async () => {
                // copyText non lancia mai: false se la clipboard non è disponibile.
                if (!(await copyText(stremioPreviewUrl))) return
                setUrlCopied(true)
                if (urlCopiedTimerRef.current) clearTimeout(urlCopiedTimerRef.current)
                urlCopiedTimerRef.current = setTimeout(() => setUrlCopied(false), 2000)
              }} className="btn-secondary min-h-[44px] rounded-xl text-xs w-full">{urlCopied ? t("ui.copied") : t("ui.copyUrl")}</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
