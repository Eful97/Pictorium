import sharp from "sharp"
import { fitCompositeToCanvas, insertFrostedGlassUnderlays, type PosterComposite } from "./poster-render-helpers"
import { renderTypeIcon } from "./type-icon-render"
import { PRE_RELEASE_BLUR_SIGMA } from "./pre-release"
import { loadSeasonalFrame } from "./poster-overlay-cache"
import type { SeasonalTheme } from "./seasonal-theme"
import type { PosterImageFormat } from "@/lib/poster-runtime-cache"
import { DEFAULT_IMAGE_QUALITY, POSTER_ENCODE_QUALITY, type ImageQuality } from "@/lib/image-quality"

/**
 * Passo 7 della pipeline poster: ordina i layer (cornice stagionale, blur
 * grezzo, Fresh), compone con sharp e codifica nel formato richiesto.
 * Estratto da generatePosterBuffer senza cambiare logica né ordine dei layer.
 */
export interface FinalCompositeArgs {
  readonly composites: PosterComposite[]
  readonly CW: number
  readonly CH: number
  readonly isLandscape: boolean
  readonly isCard: boolean
  readonly cardPng: Buffer | null
  readonly freshBaseBuf: Buffer
  readonly freshBottomShadeLayer: PosterComposite | null
  readonly seasonalTheme: SeasonalTheme | null
  readonly seasonalFrameAfter: PosterComposite | null
  readonly blurOverlay: { readonly overlay: Buffer; readonly top: number; readonly height: number } | null
  readonly showComingSoon: boolean
  readonly glassLayers: ReadonlySet<PosterComposite>
  readonly glassBlurOverrides: ReadonlyMap<PosterComposite, number>
  readonly typeIcon: boolean | undefined
  readonly typeIconInlineAux: boolean
  /** true quando l'icona tipo è già resa inline dal badge genere standard. */
  readonly genreTypeIconInline: boolean
  readonly mediaType: "movie" | "tv"
  readonly badgePw: number
  readonly format?: PosterImageFormat
  readonly imageQuality?: ImageQuality
}

export async function composeFinalPoster(args: FinalCompositeArgs): Promise<Buffer> {
  const {
    composites, CW, CH, isLandscape, isCard, cardPng, freshBaseBuf, freshBottomShadeLayer,
    seasonalTheme, seasonalFrameAfter, blurOverlay, showComingSoon, glassLayers, glassBlurOverrides,
    typeIcon, typeIconInlineAux, genreTypeIconInline, mediaType, badgePw,
  } = args
  // Icona tipo film/serie, fallback senza badge genere standard: solo glifo in
  // basso a sinistra, sopra il resto del chrome (fail-open: poster storico).
  if (typeIcon && !typeIconInlineAux && !genreTypeIconInline) {
    const icon = await renderTypeIcon(mediaType, Math.round(badgePw * 0.04))
    if (icon) {
      const margin = Math.round(badgePw * (isLandscape ? 0.03 : 0.015))
      composites.push({ input: icon.png, top: CH - icon.h - margin, left: margin })
    }
  }

  const safeComposites = (await Promise.all(composites.map((layer) => fitCompositeToCanvas(layer, CW, CH))))
    .filter((layer): layer is PosterComposite => layer !== null)

  // Cornice stagionale (qualunque tema canonico valido, su ENTRAMBI i canvas
  // col proprio asset 500×750 / 768×432 — mai stirata — in TUTTI i layout:
  // standard, Fresh e Card, senza esclusioni): la cornice sta SOPRA lo
  // sfondo/il trattamento immagine (backdrop, vignetta, velo
  // pre-release, ombra superiore, blur) ma SOTTO TUTTO il chrome — logo,
  // rank/extra, Coming Soon, network, qualità, genere, separati, età e gli
  // overlay composti Fresh/Card (richiesta utente esplicita aggiornata: la
  // cornice va al di sotto di tutti i badge e loghi). L'ancora
  // `seasonalFrameAfter` (ultimo trattamento pre-chrome) fissa la posizione:
  // gli splice Fresh e il chrome conservato Card atterrano dopo di essa,
  // quindi la cornice resta sotto di loro in ogni layout. Fail-open: asset
  // illeggibile = poster storico, mai 500.
  let seasonalFrameLayer: PosterComposite | null = null
  if (seasonalTheme !== null) {
    try {
      const frame = await loadSeasonalFrame(CW, CH, seasonalTheme, isLandscape ? "landscape" : "poster")
      const fitted = await fitCompositeToCanvas({ input: frame, top: 0, left: 0 }, CW, CH)
      if (fitted) {
        const anchorIdx = seasonalFrameAfter ? safeComposites.indexOf(seasonalFrameAfter) : -1
        // Ancora trovata: subito dopo il trattamento. Ancora assente o
        // scartata (mai attesa: i trattamenti sono full-canvas validi): in
        // testa, comunque sotto tutto il chrome.
        if (anchorIdx >= 0) safeComposites.splice(anchorIdx + 1, 0, fitted)
        else safeComposites.splice(0, 0, fitted)
        seasonalFrameLayer = fitted
      }
    } catch {
      // asset mancante/illeggibile — il poster resta quello storico
    }
  }

  // Il blur è un overlay RGBA grezzo (nessun PNG intermedio): entra come primo
  // layer, sotto backdrop/vignetta/badge — stesso ordine del vecchio blur "cotto"
  // nella base. La base non subisce ritocchi colore: niente modulate,
  // l'artwork TMDB passa invariato nel composite finale (task16: la base è il
  // background ricostruito solo in Fresh-ranked, originale altrove; P5: con
  // Card effettiva la base è il poster completo della card e il chrome
  // conservato vi si compone sopra come per Fresh). ECCEZIONE Card: la fascia
  // blur è già cotta nell'artwork a monte (blocco 6c) e qui resta FUORI dai
  // layer — coprirebbe la card finita (metadata, titolo, provider, bordi).
  // Il blur esplicito pre-release sotto resta invece full-canvas per contratto.
  const cardBlurBaked = isCard && cardPng !== null && blurOverlay !== null
  // Root cause of the Fresh bottom-left blackout: the raw bottom blur/tint
  // overlay used to composite FIRST (below everything), so the Fresh lateral
  // black shade painted OVER the accent tint wherever they overlap
  // (bottom-left), hiding it. The tinted bottom band now interleaves between
  // the lateral shade (below) and the bottom legibility shade + content
  // (above): accent visible bottom-left AND bottom-right, upper-left lateral
  // shade untouched (the bottom overlay has no coverage there), and no color
  // intensities changed anywhere. Standard/Card never take this branch
  // (freshBottomShadeLayer stays null there).
  const blurRawLayer = blurOverlay && !cardBlurBaked
    ? { input: blurOverlay.overlay, raw: { width: CW, height: blurOverlay.height, channels: 4 }, top: blurOverlay.top, left: 0 }
    : null
  const freshBlurAt = blurRawLayer && freshBottomShadeLayer ? safeComposites.indexOf(freshBottomShadeLayer) : -1
  const layers: Array<PosterComposite | { input: Buffer; raw: { width: number; height: number; channels: 4 }; top: number; left: number }> = !blurRawLayer
    ? safeComposites
    : freshBlurAt >= 0
      ? [...safeComposites.slice(0, freshBlurAt), blurRawLayer, ...safeComposites.slice(freshBlurAt)]
      : [blurRawLayer, ...safeComposites]

  // La cornice resta sopra il trattamento immagine ritardato: con Fresh +
  // blur attivo il blur grezzo si intercala prima della shade di leggibilità
  // (dopo l'ancora), quindi finirebbe sopra la cornice — la si risolleva
  // subito sopra il blur, restando sotto shade/contenuti Fresh e sotto tutto
  // il chrome. Con blur in testa (standard) o senza blur è già sopra: nessun
  // movimento, zero pixel cambiati.
  if (seasonalFrameLayer && blurRawLayer) {
    const frameIdx = layers.indexOf(seasonalFrameLayer)
    const blurIdx = layers.indexOf(blurRawLayer)
    if (frameIdx >= 0 && blurIdx >= 0 && frameIdx < blurIdx) {
      layers.splice(frameIdx, 1)
      layers.splice(layers.indexOf(blurRawLayer) + 1, 0, seasonalFrameLayer)
    }
  }

  let pipeline = sharp(isCard && cardPng ? cardPng : freshBaseBuf)

  if (showComingSoon) {
    pipeline = pipeline.blur(PRE_RELEASE_BLUR_SIGMA)
  }

  if (glassLayers.size > 0) await insertFrostedGlassUnderlays(pipeline, layers, glassLayers, CW, CH, glassBlurOverrides)

  pipeline = pipeline.composite(layers)

  const q = POSTER_ENCODE_QUALITY[args.imageQuality ?? DEFAULT_IMAGE_QUALITY]
  if (args.format === "avif") {
    return await pipeline.avif({ quality: q.avif, effort: 2 }).toBuffer()
  }
  if (args.format === "webp") {
    return await pipeline.webp({ quality: q.webp, effort: 2 }).toBuffer()
  }
  return await pipeline.jpeg({ quality: q.jpeg, mozjpeg: true }).toBuffer()
}
