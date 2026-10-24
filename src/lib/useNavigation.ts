"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import type { SearchResult, TMDBImage } from "./types"
import { detectSeasonalThemeFromCatalogName, type SeasonalCustomKeywordsInput, type SeasonalTheme } from "./seasonal-theme"
import { pushView, replaceView, goBack, type View } from "./router"

export function useNavigation() {
  const [view, setViewState] = useState<View>("edit")
  const [selected, setSelected] = useState<SearchResult | null>(null)
  const [previewPoster, setPreviewPoster] = useState<TMDBImage | null>(null)
  const [selectedLogo, setSelectedLogo] = useState<TMDBImage | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [posters, setPosters] = useState<TMDBImage[]>([])
  const [logos, setLogos] = useState<TMDBImage[]>([])
  const fetchIdRef = useRef(0)

  const [sourceView, setSourceView] = useState<View | null>(null)

  // Contesto effimero della lista/catalogo di origine (nome visibile della
  // lista da cui il titolo è stato aperto): guida SOLO il `theme=` della
  // preview editor (stesso renderer condiviso di Stremio). Si azzera a ogni
  // navigazione senza nome, all'uscita (goHome/reset/popstate) e da liste
  // non-matching — mai leakage verso altri titoli o viste.
  const [seasonalTheme, setSeasonalTheme] = useState<SeasonalTheme | null>(null)
  // Contesto effimero rank/region di lista (decisione A: il badge automatico
  // mostrato corrisponde alla posizione nella lista di origine). `listRank`
  // 0..100 viaggia come `rk=` (0 = unranked esplicito), `listRegion` come
  // `region=` di selezione (paese chart, mai il default globale). Si azzera
  // con lo stesso ciclo del theme (goHome/reset/popstate/navigazione senza
  // contesto) — mai persistito in mapping/defaults/token.
  const [listRank, setListRank] = useState<number | null>(null)
  const [listRegion, setListRegion] = useState<string | null>(null)

  const setView = useCallback((v: View) => {
    setViewState(v)
  }, [])

  // Router centralizzato: gestisce history + stato view insieme.
  const router = useMemo(() => ({
    push: (v: View) => { pushView(v); setViewState(v) },
    replace: (v: View) => { replaceView(v); setViewState(v) },
    back: () => { goBack() },
  }), [])

  const resetState = useCallback(() => {
    ++fetchIdRef.current
    setViewState("edit")
    setSelected(null)
    setPreviewPoster(null)
    setSelectedLogo(null)
    setPreviewId(null)
    setPosters([])
    setLogos([])
    setSourceView(null)
    setSeasonalTheme(null)
    setListRank(null)
    setListRegion(null)
  }, [])

  const incrementFetchId = useCallback(() => {
    return ++fetchIdRef.current
  }, [])

  const navigateToPoster = useCallback((item: SearchResult, _source?: string, _originatingListName?: string | null, _seasonalKeywords?: SeasonalCustomKeywordsInput | null) => {
    const src = (_source as View) || view || "edit"
    setSourceView(src)
    // Il tema deriva SOLO dal nome visibile della lista di origine (mai dal
    // titolo del film): omesso/null = si azzera (niente leakage). Le keyword
    // custom dell'utente estendono lo stesso match sui nomi lista (mai regex,
    // precedenza Halloween invariata); senza, valgono i soli built-in.
    setSeasonalTheme(detectSeasonalThemeFromCatalogName(_originatingListName, _seasonalKeywords ?? null))
    // Rank/region di lista viaggiano solo se validi e bounded (0..100 int per
    // il rank, stringa non vuota per la region): garbage = assente (legacy,
    // nessun fetch skip avvelenato). Lettura da `item` (toSearchResult li
    // preserva) così la firma resta invariata per i caller senza contesto.
    const lr = (item as SearchResult).listRank
    setListRank(typeof lr === "number" && Number.isInteger(lr) && lr >= 0 && lr <= 100 ? lr : null)
    const rg = (item as SearchResult).listRegion
    setListRegion(typeof rg === "string" && rg.trim().length > 0 ? rg.trim() : null)
    replaceView(src)
    pushView("edit", { source: src })
  }, [view])

  const goHome = useCallback(() => {
    setViewState("edit")
    setSelected(null)
    setPreviewPoster(null)
    setSelectedLogo(null)
    setPreviewId(null)
    setPosters([])
    setSourceView(null)
    setSeasonalTheme(null)
    setListRank(null)
    setListRegion(null)
  }, [])

  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      incrementFetchId()
      setSeasonalTheme(null)
      setListRank(null)
      setListRegion(null)
      const source = e.state?.source
      const targetView = e.state?.view || source

      if (targetView === "cataloghi" || source === "cataloghi") {
        setViewState("cataloghi")
        setSelected(null)
        setPreviewPoster(null)
        setSelectedLogo(null)
        setPreviewId(null)
      } else if (targetView === "myposters" || source === "myposters") {
        setViewState("myposters")
        setSelected(null)
        setPreviewPoster(null)
        setSelectedLogo(null)
        setPreviewId(null)
      } else if (targetView === "search" || source === "search") {
        setViewState("search")
        setSelected(null)
        setPreviewPoster(null)
        setSelectedLogo(null)
        setPreviewId(null)
      } else if (targetView === "edit") {
        setViewState("edit")
        if (!e.state?.selected) {
          setSelected(null)
          setPreviewPoster(null)
          setSelectedLogo(null)
          setPreviewId(null)
        }
      } else {
        resetState()
      }
    }
    addEventListener("popstate", handler)
    return () => removeEventListener("popstate", handler)
  }, [resetState, incrementFetchId])

  return {
    view, setView,
    router,
    sourceView, setSourceView,
    seasonalTheme, setSeasonalTheme,
    listRank, setListRank,
    listRegion, setListRegion,
    selected, setSelected,
    previewPoster, setPreviewPoster,
    selectedLogo, setSelectedLogo,
    previewId, setPreviewId,
    posters, setPosters,
    logos, setLogos,
    fetchIdRef,
    incrementFetchId,
    navigateToPoster,
    goHome,
    resetState,
  }
}
