"use client"

import { useCallback, useRef } from "react"
import type { PosterShape, TMDBImage } from "./types"
import { isManualAccent } from "./accent-color"
import { normalizeGenreName } from "./genre-normalize"
import { posterUrl } from "./utils"
import { useRootColors } from "./useRootColors"

type ColorSetter = (v: string | null) => void

interface AutoRootColorsInput {
  posterShape: PosterShape
  selectedBackdrop: TMDBImage | null
  previewPoster: TMDBImage | null
  firstGenreName: string | undefined
  lang: string
  accentColor: string | null
  autoAccentColor: string | null
  setAccentColor: ColorSetter
  setAutoAccentColor: ColorSetter
  setTopEdgeColor: ColorSetter
  setBottomEdgeColor: ColorSetter
  onResolved: (posterKey: string | null) => void
}

/**
 * Campiona accent/bordi auto dal poster di preview (backdrop in landscape,
 * stessa immagine del server) senza mai sovrascrivere un accent manuale.
 */
export function useAutoRootColors({
  posterShape,
  selectedBackdrop,
  previewPoster,
  firstGenreName,
  lang,
  accentColor,
  autoAccentColor,
  setAccentColor,
  setAutoAccentColor,
  setTopEdgeColor,
  setBottomEdgeColor,
  onResolved,
}: AutoRootColorsInput): void {
  // In landscape la base è il backdrop: accent/topLight auto si campionano
  // da lì (w780, tier backdrop), come fa il server sulla stessa immagine —
  // altrimenti `ac=`/`tl=` in preview contraddicono il render.
  const landscapePreview = posterShape === "landscape"
  // Ricalcolo auto mai distruttivo (correction 1/3): l'effetto async di
  // useRootColors ricampiona l'auto a ogni cambio poster, ma un manuale
  // esplicito (salvato ripristinato all'apertura, o ripristinato dallo stash
  // al cambio formato) non deve esserne clobberato — altrimenti aprire un
  // manuale mostrerebbe auto e il save dropperebbe il manuale. Solo il canale
  // auto segue il ricalcolo; il manuale resta finché l'utente non lo azzera
  // (Reset) o ne sceglie un altro. I ref specchiano lo stato così la guardia
  // vede i valori live senza riavviare l'effetto (mai loop su deps).
  const accentColorRef = useRef<string | null>(null)
  const autoAccentColorRef = useRef<string | null>(null)
  accentColorRef.current = accentColor
  autoAccentColorRef.current = autoAccentColor
  const setAccentColorFromAuto = useCallback((v: string | null) => {
    if (isManualAccent(accentColorRef.current, autoAccentColorRef.current)) return
    setAccentColor(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- il setter di stato è stabile
  }, [])
  useRootColors(
    landscapePreview ? (selectedBackdrop ?? previewPoster) : previewPoster,
    normalizeGenreName(firstGenreName, lang) || undefined,
    posterUrl,
    { setAccentColor: setAccentColorFromAuto, setAutoAccentColor, setTopEdgeColor, setBottomEdgeColor },
    landscapePreview ? "w780" : "w342",
    onResolved,
  )
}
