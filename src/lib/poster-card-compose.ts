import type { BadgeStyle,BadgeFont,RankingBadgeStyle } from "./badge-styles"
import type { BlurOverlay } from "./blur"
import type { ComingSoonRibbonLayout } from "./svg-badge"
import type { BadgeGeometryFamily,BadgeGeometryBox } from "./badge-layout"
import sharp from "sharp"
import { renderMultiRatings,MAX_CUSTOM_RATINGS } from "./multi-rating-renderer"
import { resolveSeparateDisplayState } from "./poster-config"
import { MAX_SEPARATE_RATINGS } from "./ratings"
import { renderSeparateRatingStack,renderSeparateRatingsBottom } from "./separate-rating-renderer"
import { cacheGet,cacheSet } from "./cache"
import { fitBadgeToCanvas,BadgeRender,PosterComposite,badgeCanvasForBody } from "./poster-render-helpers"
import { isRibbonRankingStyle,notchMaterialOf,type SeparateBottomVariant } from "./badge-styles"
import { renderCardPoster,aggregateCardRating,cardMetadataBand,type CardOverlayGeometry } from "./card-layout"
import { cardLayoutGeometry } from "./card-layout-geometry"
import { type CardSkin } from "./card-layout-skins"
import { resolveProviderGlassAccent } from "./provider-brand-palette"
import { isTopBadgeNumberRightCorner } from "./badge-layout"
import { BADGE_CACHE_TTL,scaleBitmapForLayout } from "./poster-layout-helpers"
import { PORTRAIT_SEPARATE_SHIFT_Y } from "./poster-layout-helpers"
import type { GenerationInput } from "./poster-generation-input"
import { resolveCardBrandAccent,renderCardMainBadge,stackCardOverlayParts } from "./poster-card-helpers"
import { badgeCacheKey,coalesceBadgeRender } from "./poster-cache-infra"

export interface CardComposeArgs {
  readonly isCard: boolean
  readonly topBadge: { type: "extra"; label: string }|{ type: "rank"; rank: number; label: string; ribbonLabel?: string }|null
  readonly input: GenerationInput
  readonly badgesEnabled: boolean
  readonly badgeGenre: boolean
  readonly badgeYear: boolean
  readonly isBottomStyle: boolean
  readonly bottomVariant: SeparateBottomVariant | null
  readonly voteAverage: number|null
  readonly genreName: string|null
  readonly year: string|undefined
  readonly typeIcon: boolean|undefined
  readonly mediaType: "movie" | "tv"
  readonly badgePw: number
  readonly CW: number
  readonly badgeStyle: BadgeStyle
  readonly accentColorGenre: string
  readonly bottomLight: boolean
  readonly badgeFont: BadgeFont
  readonly genreBadgeScale: number
  readonly cardMainBadgeRendered: boolean
  readonly typeIconInlineAux: boolean
  readonly genreBadgeLight: boolean
  readonly isLandscape: boolean
  readonly separateBadgeScaleEff: number
  readonly effSepBottomLight: boolean
  readonly CH: number
  readonly qualityStackAnchor: { top: number; centerX: number; leftCorner: boolean; boxTop: number; bottomRow: boolean }|null
  readonly rankingBadgeStyle: RankingBadgeStyle
  readonly ribbonSide: "left" | "right"
  readonly finalRankBadge: BadgeRender|null
  readonly showComingSoon: boolean
  readonly effComingSoonSide: "left" | "right"
  readonly ribbonLayout: ComingSoonRibbonLayout|null
  readonly topRightAnchored: boolean
  readonly extraBadgeStyle: string|null|undefined
  readonly effSepTopLight: boolean
  readonly sepColumnVariant: "rings" | "pill"
  readonly sepOY: number
  readonly logoFetch: Buffer<ArrayBufferLike>|null
  readonly hideLogo: boolean
  readonly sepOX: number
  readonly displaced: Set<"network"|"quality"|"genre"|"separate"|"rating">
  readonly composites: PosterComposite[]
  readonly badgeGeo: Partial<Record<BadgeGeometryFamily,BadgeGeometryBox>>
  readonly networkLogoResult: { png: Buffer; w: number; h: number; networkKey: string; matchedName: string }|null
  readonly rawLogoResult: { png: Buffer; w: number; h: number; networkKey: string; matchedName: string }|null
  readonly accentOverride: { genreColor: string; rankColor: string }|null
  readonly networkLogoForLayout: { png: Buffer; w: number; h: number; networkKey: string; matchedName: string }|null
  readonly posterBuf: Buffer<ArrayBufferLike>
  readonly blurOverlay: BlurOverlay|null
  readonly cardPng: Buffer<ArrayBufferLike>|null
  readonly logoScale: number|null
  readonly networkLogoScale: number
  readonly topBadgeScale: number
  readonly topBadgeOffsetX: number
  readonly topBadgeOffsetY: number
  readonly logoOffsetX: number|null
  readonly logoOffsetY: number|null
  readonly networkLogoOffsetX: number
  readonly networkLogoOffsetY: number
  readonly genreBadgeOffsetX: number
  readonly genreBadgeOffsetY: number
  readonly cardOverlayGeo: CardOverlayGeometry|null
  readonly isExtraTopBadge: boolean
  readonly finalRankLeft: number|null
  readonly finalRankTop: number
}

export async function composeCardLayer({
  isCard, topBadge, input, badgesEnabled, badgeGenre, badgeYear, isBottomStyle, bottomVariant, voteAverage, genreName, year, typeIcon, mediaType, badgePw, CW, badgeStyle, accentColorGenre, bottomLight, badgeFont, genreBadgeScale, cardMainBadgeRendered, typeIconInlineAux, genreBadgeLight, isLandscape, separateBadgeScaleEff, effSepBottomLight, CH, qualityStackAnchor, rankingBadgeStyle, ribbonSide, finalRankBadge, showComingSoon, effComingSoonSide, ribbonLayout, topRightAnchored, extraBadgeStyle, effSepTopLight, sepColumnVariant, sepOY, logoFetch, hideLogo, sepOX, displaced, composites, badgeGeo, networkLogoResult, rawLogoResult, accentOverride, networkLogoForLayout, posterBuf, blurOverlay, cardPng, logoScale, networkLogoScale, topBadgeScale, topBadgeOffsetX, topBadgeOffsetY, logoOffsetX, logoOffsetY, networkLogoOffsetX, networkLogoOffsetY, genreBadgeOffsetX, genreBadgeOffsetY, cardOverlayGeo, isExtraTopBadge, finalRankLeft, finalRankTop,
}: CardComposeArgs) {
  if(isCard) {
    // Stessa priorità dello standard: il rank arriva dal topBadge già
    // risolto (queryExtra > computato > Coming Soon). Mai inventato: solo un
    // rank reale 1..20 disegna il numerale (il compositor ri-applica
    // `isCardRankDisplayable`: 21+ e assenti rendono la stessa composizione
    // senza numerale). Nessun parsing del testo badge, nessun fetch.
    const cardRank=topBadge?.type==="rank"? topBadge.rank:null
    // Metadata source selection mirrors Fresh (`freshMetaRows` gates via the
    // shared `resolveSeparateDisplayState`) on the SAME resolved values the
    // route selected — no new sources, no invented values, order preserved:
    // a rendered custom provider row keeps its historic priority over the
    // separate column (never both), bottom styles suppress the custom row
    // (values still render once via the separate rows), and with neither
    // active the ordinary TMDB average (`voteAverage`, the existing standard
    // pattern) still renders when its toggle is on. The compositor collapses
    // the selected stack to ONE aggregate score (`aggregateCardRating`:
    // equal mean normalized to /10, custom `format` carried for the
    // percent-scale evidence — never dropped, public contracts unchanged).
    // Direct service callers
    // without `freshRaw*` behave like Fresh's backward-compat (`badgeRating`
    // as-is, a defined array counts as enabled — an explicit
    // `badgeRating: false` with populated arrays still renders nothing).
    const cardRawBadgeRating=input.freshRawBadgeRating??input.badgeRating
    const cardRawSeparateEnabled=input.freshRawSeparateRatings??(input.separateRatings!==undefined)
    const cardDisplay=resolveSeparateDisplayState({
      badgesEnabled,
      badgeGenre,
      badgeYear,
      badgeRating: cardRawBadgeRating,
      separateRatings: cardRawSeparateEnabled,
      separateRatingsStyle: isBottomStyle&&bottomVariant? bottomVariant:"column",
      sepItemCount: (input.separateRatings??[]).length,
    })
    const cardCustomItems=(input.ratings??[])
      .filter((c) => !!c&&typeof c.id==="string"&&Number.isFinite(c.value))
      .slice(0,MAX_CUSTOM_RATINGS)
    const cardShowCustom=input.ratings!==undefined&&!cardDisplay.suppressCustomRow&&cardCustomItems.length>0
    const cardSeparates=(input.separateRatings??[]).slice(0,MAX_SEPARATE_RATINGS)
    const cardShowSeparate=!cardShowCustom&&cardSeparates.length>0&&(cardDisplay.useSeparate||cardDisplay.bottomActive)
    const cardRatings=!badgesEnabled
      ? null
      :cardShowCustom
        ? cardCustomItems.map((c) => ({ id: c.id,value: c.value,format: c.format }))
        :cardShowSeparate
          ? cardSeparates.map((s) => ({ id: s.id,value: s.value }))
          :cardDisplay.effectiveBadgeRating&&voteAverage!==null&&voteAverage>0
            ? [{ id: "tmdb",value: voteAverage }]
            :null
    // P15 raw (pre-suppression) genre/year toggles for the combined main
    // badge. The route passes EFFECTIVE (bottom-suppressed) badgeGenre/
    // badgeYear; the user-explicit combined badge + separates needs the raw
    // values (same pattern as cardRawBadgeRating above). Evidence for the
    // deviation from the standard bottom suppression (route.ts
    // resolveSeparateDisplayState: bottomActive hides genre/year/rating):
    // the Card main badge lives in the below-card band while the bottom row
    // sits at the canvas edge — they never collide like the standard bottom
    // strip — and Card already rendered its metadata band in bottom mode, so
    // the combined badge loses nothing. Absent fields = direct-caller
    // backward compat (the passed values as-is).
    const cardRawGenre=input.freshRawBadgeGenre??badgeGenre
    const cardRawYear=input.freshRawBadgeYear??badgeYear
    // P15 main standard badge: the ONE aggregate score (P8, computed once
    // above from the selected stack) through the EXISTING standard renderer —
    // never the ordinary vote when a custom/selected source feeds the
    // aggregate, no extra fetch, all source gates preserved above. No genre
    // preset branch: Card never consumed presets (the standard genre slot is
    // gated `!isCard`), so the standard style applies (no regression, never
    // a 500 on preset state).
    const cardAggregate=aggregateCardRating(cardRatings)
    const cardMainAvailable=badgesEnabled&&(
      (cardRawGenre&&!!genreName)||
      (cardRawYear&&!!year)||
      (cardRawBadgeRating&&cardAggregate!==null)
    )
    let cardMainBadge: { png: Buffer; w: number; h: number} |null=null
    if(cardMainAvailable) {
      const rendered=await renderCardMainBadge({
        genreName,
        year,
        aggregate: cardAggregate,
        showGenre: cardRawGenre,
        showYear: cardRawYear,
        showRating: cardRawBadgeRating,
        typeIcon: typeIcon? mediaType:null,
        badgePw,
        CW,
        // Card: la banda non è un bordo poster, la pillola a notch resterebbe
        // sospesa a metà → si rende come pill classica.
        badgeStyle: notchMaterialOf(badgeStyle)? "pill":badgeStyle,
        accentColor: accentColorGenre,
        bottomLight,
        badgeFont,
        nativeScale: badgeStyle==="bar"? genreBadgeScale:100,
      })
      // Non-bar styles scale via bitmap like the standard path (bar scales
      // natively via font above to stay full-width).
      cardMainBadge=rendered&&genreBadgeScale!==100&&badgeStyle!=="bar"
        ? await scaleBitmapForLayout(rendered,genreBadgeScale)
        :rendered
      cardMainBadgeRendered=cardMainBadge!==null
      if(cardMainBadge) typeIconInlineAux=true
    }
    // P15 individuals via the EXISTING renderers only (never Card text rows,
    // never silently dropped while the toggle is on):
    // - custom stack in column mode: the existing custom row, stacked above
    //   the main badge (same 10px gap as the standard row-over-genre); it
    //   keeps historic priority over the separate column (never both), and
    //   bottom styles suppress it via suppressCustomRow like Standard.
    let cardCustomRow: { png: Buffer; w: number; h: number} |null=null
    if(cardShowCustom&&input.ratings&&!isBottomStyle) {
      cardCustomRow=await renderMultiRatings(input.ratings,CW-40,genreBadgeLight,badgeFont).catch(() => null)
    }
    // - bottom styles: the existing bottom row, stacked below the main badge
    //   (same builder args/geometry inputs as Standard, so the cache entries
    //   are shared — no second render of the same bitmap).
    let cardBottomRow: { png: Buffer; w: number; h: number} |null=null
    if(cardShowSeparate&&cardDisplay.bottomActive&&bottomVariant) {
      const bottomItems=cardSeparates
      // Il gradino (`notch-*`) degrada a `bottom-pills` sul Card: la banda card
      // non è il bordo del poster, la sagoma a filo resterebbe sospesa al centro.
      const cardBottomVariant: SeparateBottomVariant=notchMaterialOf(bottomVariant)? "bottom-pills":bottomVariant
      const isBar=cardBottomVariant==="bottom-bar"
      const availW=isBar&&!isLandscape? CW:(isLandscape? CW-80:CW-36)
      const cardBottomKey=badgeCacheKey("separate-bottom",cardBottomVariant,bottomItems.map((i) => `${i.id}${i.value}`).join(","),CW,badgeFont,separateBadgeScaleEff,availW,effSepBottomLight? "bl1":"bl0")
      const cachedBottom=cacheGet<{ png: Buffer; w: number; h: number} >(cardBottomKey)
      cardBottomRow=cachedBottom??await coalesceBadgeRender(cardBottomKey,() => renderSeparateRatingsBottom(bottomItems,badgePw,cardBottomVariant,badgeFont,separateBadgeScaleEff,availW,effSepBottomLight)
        .then((r) => { if(r) cacheSet(cardBottomKey,r,["badge"],BADGE_CACHE_TTL); return r })
      )
    }
    // Single overlay bitmap for the below-card band (main first, then the
    // one active row): the compositor contain-fits it centered in the band,
    // so the main badge can never be overwritten or clipped. Custom and
    // bottom rows are mutually exclusive by the gates above (never two
    // rating stacks).
    let cardMetadataOverlay: { png: Buffer; w: number; h: number} |null=null
    if(cardCustomRow&&cardMainBadge) {
      cardMetadataOverlay=await stackCardOverlayParts(cardCustomRow,cardMainBadge,10)
    } else {
      cardMetadataOverlay=cardCustomRow??cardMainBadge
    }
    if(cardBottomRow) {
      cardMetadataOverlay=cardMetadataOverlay
        ? await stackCardOverlayParts(cardMetadataOverlay,cardBottomRow,8)
        :cardBottomRow
    }
    // P15 column individuals as side chrome under the quality anchor (same
    // geometry inputs as Standard: same builder args, so the cache entries
    // are shared). Shrink-only caps keep every kept layer intact: above the
    // below-card metadata band (never over the main badge) and clear of the
    // fixed title slot (never over the title); quality/provider/rank never
    // move. Toggle off (or custom priority) = no individuals.
    if(cardShowSeparate&&cardDisplay.useSeparate&&!cardDisplay.bottomActive) {
      const columnItems=cardSeparates
      const netPadX=Math.round(18*CW/380)
      const netBaseTop=Math.round(18*CH/570)
      const rightCorner=qualityStackAnchor
        ? qualityStackAnchor.leftCorner
        :((isRibbonRankingStyle(rankingBadgeStyle)&&ribbonSide==="right"&&topBadge?.type==="rank"&&!!finalRankBadge)
          ||(showComingSoon&&effComingSoonSide==="right"&&!!ribbonLayout)
          ||(topRightAnchored&&!!finalRankBadge)
          ||isTopBadgeNumberRightCorner({ topBadgeType: topBadge?.type,rankingBadgeStyle,extraBadgeStyle,ribbonSide,hasTopBadge: !!finalRankBadge }))
      const stackTop=(qualityStackAnchor? qualityStackAnchor.top+6:netBaseTop-10)
        +(isLandscape? 0:PORTRAIT_SEPARATE_SHIFT_Y)
      const stackKey=badgeCacheKey("separate",columnItems.map((i) => `${i.id}${i.value}`).join(","),CW,badgeFont,effSepTopLight,separateBadgeScaleEff,sepColumnVariant==="rings"? "rings":undefined)
      const cachedStack=cacheGet<{ png: Buffer; w: number; h: number} >(stackKey)
      const stack=cachedStack??await coalesceBadgeRender(stackKey,() => renderSeparateRatingStack(columnItems,badgePw,effSepTopLight,badgeFont,separateBadgeScaleEff,undefined,sepColumnVariant)
        .then((r) => { if(r) cacheSet(stackKey,r,["badge"],BADGE_CACHE_TTL); return r })
      )
      let stackFitted=stack? await fitBadgeToCanvas(stack,CW,CH):null
      // Cap above the below-card metadata band (the Standard cap uses the
      // genre rect; Card has no genre rect — the band top is the equivalent
      // edge): shrink-only on real overflow, never enlarge.
      const cardGeo=cardLayoutGeometry(isLandscape? "landscape":"poster",CW,CH,cardRank)
      const cardBand=cardGeo? cardMetadataBand(CW,CH,cardGeo):null
      const bandTop=cardBand? cardBand.y0:CH-Math.round(20*CH/570)
      if(stackFitted) {
        const intendedTop=Math.max(0,Math.min(Math.max(0,CH-1),stackTop+sepOY))
        const maxStackH=bandTop-intendedTop-6
        if(stackFitted.h>maxStackH&&maxStackH>0) {
          stackFitted=await scaleBitmapForLayout(stackFitted,(maxStackH/stackFitted.h)*100)
        }
      }
      // Clear of the fixed title slot (conservative slot box, same
      // shrink-only idiom as the Standard logo-overlap loops, floor 0.7):
      // the column shares the card's right side with the bottom-centered
      // title mark. No title (hideLogo/absent) = no guard.
      if(stackFitted&&cardGeo&&logoFetch&&!hideLogo) {
        const slot=cardGeo.titleLogo
        const leftFor=(w: number) => qualityStackAnchor
          ? Math.round(qualityStackAnchor.centerX-w/2)
          :(rightCorner? netPadX:Math.round(CW-netPadX+10-w))
        const topFor=(h: number) => Math.max(0,Math.min(CH-h,stackTop+sepOY))
        const overlapsTitle=(w: number,h: number) => {
          const l=Math.max(0,Math.min(CW-w,leftFor(w)+sepOX))
          const t=topFor(h)
          return l<slot.x+slot.maxWidth&&l+w>slot.x&&t<slot.y+slot.maxHeight&&t+h>slot.y
        }
        if(overlapsTitle(stackFitted.w,stackFitted.h)) {
          let scale=1
          const minScale=0.7
          let curW=stackFitted.w
          let curH=stackFitted.h
          while(scale>minScale&&overlapsTitle(curW,curH)) {
            scale-=0.1
            if(scale<minScale) scale=minScale
            const newW=Math.max(1,Math.round(stackFitted.w*scale))
            const newH=Math.max(1,Math.round(stackFitted.h*scale))
            if(newW===curW&&newH===curH) break
            curW=newW
            curH=newH
            if(scale<=minScale) break
          }
          if(curW!==stackFitted.w||curH!==stackFitted.h) {
            displaced.add("separate")
            const png=await sharp(stackFitted.png).resize(curW,curH).toBuffer()
            stackFitted={ ...stackFitted,png,w: curW,h: curH }
          }
        }
      }
      if(stackFitted) {
        const leftPos=qualityStackAnchor
          ? Math.round(qualityStackAnchor.centerX-stackFitted.w/2)
          :(rightCorner? netPadX:Math.round(CW-netPadX+10-stackFitted.w))
        const sepLeft=Math.max(0,Math.min(CW-stackFitted.w,leftPos+sepOX))
        const sepTop=Math.max(0,Math.min(CH-stackFitted.h,stackTop+sepOY))
        composites.push({ input: stackFitted.png,top: sepTop,left: sepLeft })
        badgeGeo.separate={ top: sepTop,left: sepLeft,w: stackFitted.w,h: stackFitted.h }
      }
    }
    // Automatic provider-glass brand tint from the already-resolved brand
    // IDENTITY (`networkLogoResult`/`rawLogoResult` canonical `networkKey`,
    // same priority as the drawn logo — no new matcher, no pixel sampling,
    // no extra fetch): a valid manual `ac=`/mapping accent wins (existing
    // public contract); otherwise the fixed 8-provider palette applies
    // (`provider-brand-palette.ts`); unlisted/missing providers render the
    // documented neutral — never the scene tint, which describes the
    // artwork atmosphere, not the provider brand. The key is read from the
    // ORIGINAL match records (not the geometry-fitted bitmap, which only
    // carries pixels). Other Card skins keep the existing pixel-sampling
    // resolver below (`resolveCardBrandAccent`) untouched.
    const cardSkin=input.posterLayout as CardSkin
    const cardBrandAccent=cardSkin==="provider-glass"
      ? resolveProviderGlassAccent(
        networkLogoResult?.networkKey??rawLogoResult?.networkKey??null,
        accentOverride
      )
      :await resolveCardBrandAccent(networkLogoForLayout,accentOverride)
    // Bottom-blur exception (Card only): the user-controlled bottom blur is
    // an artwork treatment, not chrome. The SAME already-computed raw RGBA
    // overlay (same algorithm/tint/controls, single computation, no extra
    // blur pass — it composites straight onto the artwork bytes) is baked
    // into the full-canvas artwork BEFORE the shared single compositor, so
    // the finished Card (skin, numeral, title logo, provider mark, metadata
    // band, rounded edges) is never covered by it. The intermediate is PNG
    // (lossless): unblurred artwork pixels stay bit-identical instead of
    // collecting a JPEG re-encode generation. Standard and Fresh keep the
    // overlay in the final layers below, pixel-identical.
    // The explicit pre-release full blur in section 7 still applies over the
    // whole Card by contract (Coming Soon state, not a user blur control).
    let cardArtwork=posterBuf
    if(blurOverlay) {
      cardArtwork=await sharp(posterBuf)
        .composite([
          {
            input: blurOverlay.overlay,
            raw: { width: CW,height: blurOverlay.height,channels: 4 },
            top: blurOverlay.top,
            left: 0,
          },
        ])
        .png({ compressionLevel: 1 })
        .toBuffer()
    }
    cardPng=await renderCardPoster({
      // `isCard` implica un cover layout valido (stesso gate): il cast è
      // stretto, il compositor rivalida comunque e rifiuta gli altri.
      skin: input.posterLayout as CardSkin,
      shape: isLandscape? "landscape":"poster",
      width: CW,
      height: CH,
      // Base pipeline pre-chrome (già a CW×CH) con la fascia blur già cotta
      // dentro (eccezione Card, vedi sopra): mai il poster finale standard
      // — i badge standard sono overlay e non vi sono cotti dentro.
      artwork: cardArtwork,
      displayedRank: cardRank,
      // P14: il titolo riusa il buffer ORIGINALE già risolto (hideLogo lo
      // azzera a monte, la selezione manuale resta a monte invariata) — MAI
      // il bitmap `logoResult` già ridimensionato per lo Standard (con lo
      // shrink-only erediterebbe la misura piccola e ignorerebbe la scala).
      // La scala utente esistente (`logoScale`, null = 100 neutro come Fresh)
      // viaggia come scalare: il compositor ridimensiona lo slot e fitta UNA
      // sola volta (nessun secondo resize, nessun nuovo parametro/fetch).
      titleLogo: logoFetch&&!hideLogo? logoFetch:null,
      logoScale: logoScale??null,
      // P14: il mark riusa il bitmap raw originale (colori originali, PRIMA
      // del `netscale` Standard) + lo slider esistente (`networkLogoScale`,
      // valori salvati preservati): il compositor ingrandisce lo slot della
      // stessa % e fitta UNA sola volta con upscale limitato allo slot.
      // Assente = omesso senza errore (stesso input del provider Fresh).
      providerLogo: rawLogoResult? rawLogoResult.png:null,
      providerScale: networkLogoScale,
      // Brand tint: manuale esplicito (`ac=`/mapping) quando presente,
      // altrimenti tinta fissa dalla palette 8 provider per identità brand
      // già risolta (`provider-glass`), neutro documentato per provider
      // assenti e non listati (mai cataloghi di match copiati, mai testo
      // raw nel SVG, mai tinta di scena come brand, mai campionamento
      // pixel per `provider-glass`).
      // Existing per-shape Transform offsets: Card slots stay the same, the
      // composed layer moves (neutral 0 = historic fixed geometry).
      numeralScale: topBadgeScale,
      numeralOffsetX: topBadgeOffsetX,
      numeralOffsetY: topBadgeOffsetY,
      titleOffsetX: logoOffsetX,
      titleOffsetY: logoOffsetY,
      providerOffsetX: networkLogoOffsetX,
      providerOffsetY: networkLogoOffsetY,
      metadataOffsetX: genreBadgeOffsetX,
      metadataOffsetY: genreBadgeOffsetY,
      onGeometry: (geo) => { cardOverlayGeo=geo },
      brandAccent: cardBrandAccent,
      // Metadati già risolti con le scelte di resa effettive condivise con
      // Fresh (vedi sopra: custom > separati > media ★, mai valori inventati).
      // P15: il percorso valori testuali custom della card NON è alimentato
      // dal service (mai un secondo renderer genere/stelle/anno); il badge
      // standard già reso (aggregato P15 sopra) + le eventuali righe
      // esistenti viaggiano nel singolo slot overlay condiviso. Gli helper
      // custom restano come fallback del compositore + superficie unit.
      genreName: null,
      year: null,
      ratings: null,
      metadataOverlay: cardMetadataOverlay,
    })
    // Badge extra non-rank: bitmap standard riusato al top (stesso anchor di Fresh).
    if(isExtraTopBadge&&finalRankBadge&&finalRankLeft!==null) {
      const extraCanvas=badgeCanvasForBody(finalRankLeft,finalRankTop,finalRankBadge)
      composites.push({ input: finalRankBadge.png,top: extraCanvas.top,left: extraCanvas.left })
    }
  }
  return { cardMainBadgeRendered,typeIconInlineAux,cardPng,cardOverlayGeo }
}
