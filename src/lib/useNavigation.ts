"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import type { SearchResult, TMDBImage } from "./types"
import { detectSeasonalThemeFromCatalogName, type SeasonalCustomKeywordsInput, type SeasonalTheme } from "./seasonal-theme"
import { pushView, replaceView, goBack, type View } from "./router"

/**
 * SPA navigation guard for the per-title editor draft.
 *
 * A browser Back/Forward (popstate) leaves the editor view and clears the open
 * title, which rehydrates the live editor from the SAVED mapping: every
 * unstaged edit would be lost. The editor registers its live dirty state here;
 * a dirty popstate is cancelled (the editor history entry is restored) and the
 * editor's existing three-way confirm dialog is requested instead. Clean
 * drafts keep the historic immediate navigation, so no global nav regression.
 *
 * Single registration by design: only the open per-title editor can own a
 * draft. `requestConfirm` is expected to open the same dialog used by the
 * in-app exit affordances (save / keep editing / discard).
 */
export interface EditorNavigationGuard {
  /** Live dirty state of the open title (same `isMappingDirty` as the dialog). */
  isDirty: () => boolean
  /** Ask before discarding; `discard` performs the pending SPA transition. */
  requestConfirm: (discard: () => void) => void
}

let editorNavigationGuard: EditorNavigationGuard | null = null

/** Register the (single) editor guard; returns the unmount cleanup. */
export function registerEditorNavigationGuard(guard: EditorNavigationGuard): () => void {
  editorNavigationGuard = guard
  return () => {
    if (editorNavigationGuard === guard) editorNavigationGuard = null
  }
}

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
  // Ultima view effettiva (lettura sincrona dal popstate, che gira fuori dal
  // render): serve a ripristinare l'entry dell'editor quando un back SPA con
  // bozza dirty viene annullato.
  const viewRef = useRef<View>("edit")
  viewRef.current = view
  // Un solo salto "sbloccato" dopo la conferma di scarto: senza, il goBack
  // richiesto dal dialog verrebbe ri-guardato all'infinito.
  const guardBypassRef = useRef(false)

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
      // Il bypass vale per UN solo salto: è il goBack() richiesto dal dialog
      // dopo la conferma di scarto (o il default pulito, che non lo attiva).
      const bypass = guardBypassRef.current
      guardBypassRef.current = false
      const guard = editorNavigationGuard
      if (!bypass && guard?.isDirty()) {
        // Il browser ha già spostato la history: ripristina l'entry
        // dell'editor (truncate del forward) così lo stato non viene perso,
        // poi chiedi conferma con lo stesso dialog delle uscite in-app.
        pushView(viewRef.current)
        guard.requestConfirm(() => {
          guardBypassRef.current = true
          goBack()
        })
        return
      }
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
      } else if (targetView === "thumbnails" || source === "thumbnails") {
        setViewState("thumbnails")
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
