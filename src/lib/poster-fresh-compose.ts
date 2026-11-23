import type { BlurOverlay } from "./blur"
import type { BadgeFont, SeparateBottomVariant } from "./badge-styles"
import { BadgeRender, PosterComposite, badgeCanvasForBody } from "./poster-render-helpers"
import { composeFreshOverlay, composeFreshOverlaySplit, freshMetaRows, type ComposeFreshInput, type FreshOverlayGeometry } from "./fresh-layout"
import type { GenerationInput } from "./poster-generation-input"

export interface FreshComposeArgs {
  readonly isFresh: boolean
  readonly topBadge: { type: "extra"; label: string } | { type: "rank"; rank: number; label: string; ribbonLabel?: string } | null
  readonly input: GenerationInput
  readonly freshBaseBuf: Buffer<ArrayBufferLike>
  readonly CW: number
  readonly CH: number
  readonly badgesEnabled: boolean
  readonly badgeGenre: boolean
  readonly badgeYear: boolean
  readonly isBottomStyle: boolean
  readonly bottomVariant: SeparateBottomVariant | null
  readonly genreName: string | null
  readonly year: string | undefined
  readonly voteAverage: number | null
  readonly typeIcon: boolean | undefined
  readonly mediaType: "movie" | "tv"
  readonly logoResult: { readonly input: Buffer<ArrayBufferLike>; readonly top: number; readonly left: number; readonly w: number; readonly h: number } | null
  readonly networkLogoForLayout: { png: Buffer; w: number; h: number; networkKey: string; matchedName: string } | null
  readonly badgeFont: BadgeFont | null | undefined
  readonly freshOverlayGeo: FreshOverlayGeometry | null
  readonly topBadgeScale: number
  readonly topBadgeOffsetX: number
  readonly topBadgeOffsetY: number
  readonly genreBadgeScale: number
  readonly genreBadgeOffsetX: number
  readonly genreBadgeOffsetY: number
  readonly networkLogoScale: number
  readonly networkLogoOffsetX: number
  readonly networkLogoOffsetY: number
  readonly networkLogoFollowTitle: boolean | undefined
  readonly networkFixedX: number | null | undefined
  readonly networkFixedY: number | null | undefined
  readonly logoScale: number | null
  readonly logoOffsetX: number | null
  readonly logoOffsetY: number | null
  readonly blurOverlay: BlurOverlay | null
  readonly freshBottomShadeLayer: PosterComposite | null
  readonly composites: PosterComposite[]
  readonly freshInsertAt: number | null
  readonly typeIconInlineAux: boolean
  readonly isExtraTopBadge: boolean
  readonly finalRankBadge: BadgeRender | null
  readonly finalRankLeft: number | null
  readonly finalRankTop: number
}

export async function composeFreshLayer({
  isFresh, topBadge, input, freshBaseBuf, CW, CH, badgesEnabled, badgeGenre, badgeYear, isBottomStyle, bottomVariant, genreName, year, voteAverage, typeIcon, mediaType, logoResult, networkLogoForLayout, badgeFont, freshOverlayGeo, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, genreBadgeScale, genreBadgeOffsetX, genreBadgeOffsetY, networkLogoScale, networkLogoOffsetX, networkLogoOffsetY, networkLogoFollowTitle, networkFixedX, networkFixedY, logoScale, logoOffsetX, logoOffsetY, blurOverlay, freshBottomShadeLayer, composites, freshInsertAt, typeIconInlineAux, isExtraTopBadge, finalRankBadge, finalRankLeft, finalRankTop,
}: FreshComposeArgs) {
  if (isFresh) {
    // Stessa priorità dello standard: il rank arriva dal topBadge già
    // risolto (queryExtra > computato > Coming Soon). Mai inventato: solo un
    // rank reale disegna il numerale.
    const freshRank = topBadge?.type === "rank" ? topBadge.rank : null
    // La route pre-filtra già gli input rating per lo standard (flag
    // effettivi, custom soppresso in bottom, separate definiti solo quando
    // attivi) e passa i toggle raw equivalenti nei campi freshRaw* —
    // così freshMetaRows applica gli stessi gate condivisi
    // (resolveSeparateDisplayState) sui valori RAW, non su quelli effettivi
    // (già soppressi: con la colonna attiva l'effettivo sarebbe sempre OFF
    // e fresh non mostrerebbe mai i separati). I chiamanti diretti del
    // service senza campi freshRaw* usano `badgeRating` così com'è (mai
    // riacceso dall'esistenza degli array) e l'array definito come toggle
    // separato — `badgeRating: false` + array popolati = nessuna riga
    // separata, come nello standard.
    const freshRawBadgeRating = input.freshRawBadgeRating ?? input.badgeRating
    const freshRawSeparateEnabled = input.freshRawSeparateRatings ?? (input.separateRatings !== undefined)
    const freshOverlayInput: ComposeFreshInput = {
      posterBuf: freshBaseBuf,
      CW,
      CH,
      rank: freshRank,
      meta: {
        badgesEnabled,
        badgeGenre: input.freshRawBadgeGenre ?? badgeGenre,
        badgeYear: input.freshRawBadgeYear ?? badgeYear,
        badgeRating: freshRawBadgeRating,
        separateRatingsEnabled: freshRawSeparateEnabled,
        separateRatingsStyle: isBottomStyle && bottomVariant ? bottomVariant : "column",
        customRatingsEnabled: input.ratings !== undefined,
        genreName,
        year,
        voteAverage,
        separateRatings: input.separateRatings,
        customRatings: input.ratings,
        typeIcon: typeIcon ? mediaType : null,
      },
      logo: logoResult ? { png: logoResult.input, w: logoResult.w, h: logoResult.h } : null,
      provider: networkLogoForLayout ? { png: networkLogoForLayout.png, w: networkLogoForLayout.w, h: networkLogoForLayout.h } : null,
      badgeFont,
      // Existing per-shape Transform controls, no new params: the rank
      // numeral follows the classifica tuning, the meta column the genre
      // tuning, the provider its offsets (+ the follow/fixed contract), the
      // title logo its offsets once. Provider/logo SCALES ride the bitmaps
      // above (`netscale` in networkLogoForLayout, `logoScale` in
      // logoResult) and are never re-applied as a second resize inside
      // fresh-layout: the same % only enlarges the slot caps there, so one
      // fit grows the mark linearly until the canvas edge (neutral 100 =
      // historic caps, byte-identical; null logoScale counts as 100).
      onGeometry: (geo) => { freshOverlayGeo = geo },
      transforms: {
        numeralScale: topBadgeScale,
        numeralOffsetX: topBadgeOffsetX,
        numeralOffsetY: topBadgeOffsetY,
        metaScale: genreBadgeScale,
        metaOffsetX: genreBadgeOffsetX,
        metaOffsetY: genreBadgeOffsetY,
        providerScale: networkLogoScale,
        providerOffsetX: networkLogoOffsetX,
        providerOffsetY: networkLogoOffsetY,
        providerFollowTitle: networkLogoFollowTitle ?? true,
        providerFixedX: networkFixedX ?? null,
        providerFixedY: networkFixedY ?? null,
        logoScale: logoScale ?? null,
        logoOffsetX: logoOffsetX ?? null,
        logoOffsetY: logoOffsetY ?? null,
      },
    }
    // Split-shade interleaving (Fresh + active bottom blur only): the raw
    // bottom blur/tint overlay paints ABOVE the lateral shade and BELOW the
    // bottom legibility shade + content, so the accent tint stays visible
    // bottom-left instead of being blacked out by the side shade. Without an
    // active bottom blur the legacy combined-shade path runs byte-identically.
    if (blurOverlay) {
      const split = await composeFreshOverlaySplit(freshOverlayInput)
      freshBottomShadeLayer = split.aboveBottom[0] ?? null
      composites.splice(freshInsertAt ?? composites.length, 0, ...split.belowBottom, ...split.aboveBottom)
    } else {
      const freshLayers = await composeFreshOverlay(freshOverlayInput)
      composites.splice(freshInsertAt ?? composites.length, 0, ...freshLayers)
    }
    if (freshOverlayInput.meta.typeIcon && freshMetaRows(freshOverlayInput.meta).length > 0) typeIconInlineAux = true
    // Badge extra non-rank: bitmap standard riusato al top (stesso anchor).
    if (isExtraTopBadge && finalRankBadge && finalRankLeft !== null) {
      const extraCanvas = badgeCanvasForBody(finalRankLeft, finalRankTop, finalRankBadge)
      composites.push({ input: finalRankBadge.png, top: extraCanvas.top, left: extraCanvas.left })
    }
  }
  return { freshOverlayGeo, freshBottomShadeLayer, typeIconInlineAux }
}
