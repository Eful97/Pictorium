import type { FreshOverlayGeometry } from "./fresh-layout"
import type { RelFam,RelBox,InkSource } from "./poster-layout-helpers"
import type { BadgeGeometryReport } from "./badge-layout"
import type { LogoRelativePosition } from "./badge-anchor"
import type { LogoAnchor } from "./logo-layout"
import { BadgeRender,PosterComposite,badgeBody,opaqueComponents,tightenBoxesToInk } from "./poster-render-helpers"
import { isActiveLogoAnchor } from "./logo-layout"
import { isFreshRank } from "./fresh-layout"
import { type CardOverlayGeometry } from "./card-layout"
import { isCardRankDisplayable } from "./card-layout-geometry"
import { type NetworkGeometry,type BadgeGeometryFamily,type BadgeGeometryLayout,type BadgeGeometryBox,type BadgeGeometryItem } from "./badge-layout"
import { rectsOverlap } from "./poster-layout-helpers"
import type { GenerationInput } from "./poster-generation-input"

export interface BadgeGeometryArgs {
  readonly isExtraTopBadge: boolean
  readonly isCard: boolean
  readonly topBadge: { type: "extra"; label: string }|{ type: "rank"; rank: number; label: string; ribbonLabel?: string }|null
  readonly isFresh: boolean
  readonly finalRankBadge: BadgeRender|null
  readonly finalRankLeft: number | null
  readonly badgeGeo: Partial<Record<BadgeGeometryFamily,BadgeGeometryBox>>
  readonly finalRankTop: number
  readonly isRankNetflixRibbonStyle: boolean
  readonly logoResult: { readonly input: Buffer<ArrayBufferLike>; readonly top: number; readonly left: number; readonly w: number; readonly h: number }|null
  readonly freshOverlayGeo: FreshOverlayGeometry | null
  readonly cardOverlayGeo: CardOverlayGeometry|null
  readonly isFixedNetwork: boolean
  readonly badgeGeoFixedX: Partial<Record<BadgeGeometryFamily,boolean>>
  readonly badgeGeoItems: BadgeGeometryItem[]
  readonly netRel: LogoRelativePosition | null
  readonly qualityRel: LogoRelativePosition | null
  readonly bottomRel: LogoRelativePosition | null
  readonly topRel: LogoRelativePosition | null
  readonly relGapPx: number
  readonly CW: number
  readonly relMarginPx: number
  readonly relBandBottomMargin: number
  readonly isBottomStyle: boolean
  readonly qualityStackAnchor: { top: number; centerX: number; leftCorner: boolean; boxTop: number; bottomRow: boolean }|null
  readonly bodyFrame: (src: InkSource) => { left: number; top: number; w: number; h: number }|null
  readonly genreBadgeRect: { top: number; left: number; w: number; h: number }|null
  readonly ratingBox: { left: number; top: number; w: number; h: number }|null
  readonly separateInkSource: InkSource|null
  readonly qualityInkSource: InkSource|null
  readonly combinedGenreOX: number
  readonly combinedGenreOY: number
  readonly qualityBadgeOffsetX: number
  readonly qualityBadgeOffsetY: number
  readonly networkLogoOffsetX: number
  readonly networkLogoOffsetY: number
  readonly combinedTopOX: number
  readonly combinedTopOY: number
  readonly topRankLayer: PosterComposite|null
  readonly famLayers: Record<"network"|"quality"|"genre"|"separate"|"rating",PosterComposite[]>
  readonly qualityDetachedInk: Map<string,InkSource>
  readonly netGeo: NetworkGeometry|null
  readonly relLogoTop: number
  readonly relLogoBottom: number
  readonly CH: number
  readonly onNetworkGeometry: ((geo: NetworkGeometry|null) => void)|null|undefined
  readonly topFixedActive: boolean
  readonly topAnchorActive: boolean
  readonly logoAnchorEff: LogoAnchor
  readonly networkManual: boolean
  readonly qualityManual: boolean
  readonly bottomManual: boolean
  readonly displaced: Set<"network"|"quality"|"genre"|"separate"|"rating">
  readonly input: GenerationInput
  readonly composites: PosterComposite[]
  readonly onBadgeGeometry: ((report: BadgeGeometryReport) => void)|null|undefined
}

export async function reportBadgeGeometry({
  isExtraTopBadge, isCard, topBadge, isFresh, finalRankBadge, finalRankLeft, badgeGeo, finalRankTop, isRankNetflixRibbonStyle, logoResult, freshOverlayGeo, cardOverlayGeo, isFixedNetwork, badgeGeoFixedX, badgeGeoItems, netRel, qualityRel, bottomRel, topRel, relGapPx, CW, relMarginPx, relBandBottomMargin, isBottomStyle, qualityStackAnchor, bodyFrame, genreBadgeRect, ratingBox, separateInkSource, qualityInkSource, combinedGenreOX, combinedGenreOY, qualityBadgeOffsetX, qualityBadgeOffsetY, networkLogoOffsetX, networkLogoOffsetY, combinedTopOX, combinedTopOY, topRankLayer, famLayers, qualityDetachedInk, netGeo, relLogoTop, relLogoBottom, CH, onNetworkGeometry, topFixedActive, topAnchorActive, logoAnchorEff, networkManual, qualityManual, bottomManual, displaced, input, composites, onBadgeGeometry,
}: BadgeGeometryArgs) {
  const topRankDisplayed=isExtraTopBadge
    ? false
    :isCard
      ? (topBadge?.type==="rank"&&isCardRankDisplayable(topBadge.rank))
      :isFresh
        ? (topBadge?.type==="rank"&&isFreshRank(topBadge.rank))
        :!!(finalRankBadge&&!isExtraTopBadge)
  const reportLayout: BadgeGeometryLayout=topRankDisplayed? "ranked":"fallback"
  if(finalRankBadge&&finalRankLeft!==null) {
    const topBody=badgeBody(finalRankBadge)
    if(isExtraTopBadge) {
      // Extra: stesso anchor in Standard, Fresh e Card (push sopra in ogni ramo).
      badgeGeo.extra={ top: finalRankTop,left: finalRankLeft,w: topBody.w,h: topBody.h }
    } else if(!isFresh&&!isCard&&!isRankNetflixRibbonStyle) {
      // Rank Standard centrato/angolo: gli offset sono applicati qui. Il
      // nastro Netflix ignora X e Y per contratto: nessuna maniglia.
      badgeGeo.rank={ top: finalRankTop,left: finalRankLeft,w: topBody.w,h: topBody.h }
    }
  }
  // Logo titolo (Standard): il bitmap composto com'e', offset applicati una
  // sola volta a monte. Fresh/Card riportano il proprio layer composto sotto.
  if(logoResult&&!isFresh&&!isCard) {
    badgeGeo.logo={ top: logoResult.top,left: logoResult.left,w: logoResult.w,h: logoResult.h }
  }
  // Fresh: il compositor riporta numerale (famiglia rank), blocco meta
  // (genere), provider (network) e titolo (logo) realmente dipinti. I
  // composite standard genere/logo sono gia' spenti sopra: nessun duplicato.
  // Le righe separate vivono dentro il blocco meta (contratto Fresh), quindi
  // si muovono con esso: nessuna maniglia fantasma.
  if(isFresh&&freshOverlayGeo) {
    const geo=freshOverlayGeo as FreshOverlayGeometry
    if(geo.numeral) badgeGeo.rank=geo.numeral
    if(geo.meta) badgeGeo.genre=geo.meta
    if(geo.provider) badgeGeo.network=geo.provider
    if(geo.logo) badgeGeo.logo=geo.logo
  }
  // Card: stesse famiglie dal compositor condiviso; la banda metadata (badge
  // principale + eventuali righe unite) è la famiglia genere, la colonna
  // separati laterale è già riportata dal chrome condiviso sopra.
  if(isCard&&cardOverlayGeo) {
    const geo=cardOverlayGeo as CardOverlayGeometry
    if(geo.numeral) badgeGeo.rank=geo.numeral
    if(geo.metadata) badgeGeo.genre=geo.metadata
    if(geo.provider) badgeGeo.network=geo.provider
    if(geo.title) badgeGeo.logo=geo.title
  }
  // Frozen network (follow OFF + complete absolute coords): in Standard and
  // Fresh the renderer uses the absolute box verbatim and never applies the
  // relative offset axes on top of it. Report the family as locked so the drag
  // overlay offers no offset handle at all (a Y handle would otherwise write a
  // `noy` that is reinterpreted as a relative offset later). Card keeps its
  // provider offsets applied, so it is deliberately excluded.
  if(isFixedNetwork&&!isCard) badgeGeoFixedX.network=true
  // Cornici dell'editor sull'inchiostro reale: la bitmap del gruppo qualità
  // porta pad d'ombra, tela della colonna comune e (notch) i raccordi vuoti,
  // quindi i box grezzi erano molto più grandi del dipinto. Calcolato solo
  // quando l'editor chiede la geometria; il render non cambia.
  let reportedItems: BadgeGeometryItem[]=badgeGeoItems
  // ---- Blocco "sopra/sotto il logo" (prima del pass). Per lato, i family si
  // impilano dal logo verso l'esterno nell'ordine fisso: fascia (genere, riga
  // rating, pillole bottom), qualita (+ colonna separati), network, rank/extra.
  // Centro orizzontale = centro del logo (clamp nei margini), gap =
  // round(8*CH/570); poi offset X/Y del badge; clamp verticale nel canvas. Le
  // posizioni sono manuali: il pass sotto le registra come ostacoli fissi.
  if(logoResult&&(netRel||qualityRel||bottomRel||topRel)) {
    const relGap=relGapPx
    const relMarginX=Math.round(18*CW/380)
    const relMarginY=relMarginPx
    // Margine inferiore per famiglia: la fascia genere/rating/pillole usa quello dell'Auto.
    const relBottomMargin=(fam: RelFam): number => (fam==="genre"||fam==="rating"||fam==="separate"? relBandBottomMargin:relMarginY)
    const relSepLinked=!isBottomStyle&&qualityStackAnchor!==null
    // Box VISIBILE, come il report finale: qualità e colonna separati sono
    // ristretti all'inchiostro (stessa formula del report geometria, più sotto).
    const relInkBox=async (src: InkSource,box: RelBox): Promise<RelBox> => {
      const comps=(await opaqueComponents(src.png)).map((c) => ({ ...c,left: c.left+src.left,top: c.top+src.top }))
      return bodyFrame(src)??tightenBoxesToInk([box],comps)[0]
    }
    const relBoxOf=async (fam: RelFam): Promise<RelBox|null> => {
      if(fam==="genre") return genreBadgeRect
      if(fam==="rating") return ratingBox
      if(fam==="separate") {
        if(badgeGeo.separate) return separateInkSource? relInkBox(separateInkSource,badgeGeo.separate):badgeGeo.separate
        const items=badgeGeoItems.filter((it) => it.family==="separate")
        if(items.length===0) return null
        const l=Math.min(...items.map((it) => it.left)),t=Math.min(...items.map((it) => it.top))
        const r=Math.max(...items.map((it) => it.left+it.w)),b=Math.max(...items.map((it) => it.top+it.h))
        return { left: l,top: t,w: r-l,h: b-t }
      }
      if(fam==="quality") {
        const q0=badgeGeo.quality
        if(!q0) return null
        const q=qualityInkSource? await relInkBox(qualityInkSource,q0):q0
        const sp0=relSepLinked? badgeGeo.separate:undefined
        if(!sp0) return q
        const sp=separateInkSource? await relInkBox(separateInkSource,sp0):sp0
        const l=Math.min(q.left,sp.left),t=Math.min(q.top,sp.top)
        const r=Math.max(q.left+q.w,sp.left+sp.w),b=Math.max(q.top+q.h,sp.top+sp.h)
        return { left: l,top: t,w: r-l,h: b-t }
      }
      if(fam==="network") return badgeGeo.network??null
      if(!finalRankBadge||finalRankLeft===null||isFresh||isCard) return null
      const body=badgeBody(finalRankBadge)
      return { left: finalRankLeft,top: finalRankTop,w: body.w,h: body.h }
    }
    const relOffsetOf=(fam: RelFam): { x: number; y: number}  => {
      if(fam==="genre") return { x: combinedGenreOX??0,y: combinedGenreOY??0 }
      if(fam==="quality") return { x: qualityBadgeOffsetX??0,y: qualityBadgeOffsetY??0 }
      if(fam==="network") return { x: networkLogoOffsetX??0,y: networkLogoOffsetY??0 }
      if(fam==="top") return { x: combinedTopOX??0,y: combinedTopOY??0 }
      return { x: 0,y: 0 }
    }
    // Sposta un family di (dx, dy): composite, box report, item, ink, geometria
    // network e rank. Ogni oggetto è spostato una sola volta per chiamata.
    const relMove=(fam: RelFam,dx: number,dy: number): void => {
      const seen=new Set<object>()
      const mv=(o: object|null|undefined): void => {
        if(!o||seen.has(o)) return
        seen.add(o)
        const m=o as { top: number; left?: number} 
        m.top+=dy
        if(typeof m.left==="number") m.left+=dx
      }
      const inkOf=(ink: InkSource|null): void => { if(ink) { mv(ink); mv(ink.body)}  }
      const itemsOf=(f: string): void => { for(const it of badgeGeoItems) if(it.family===f) mv(it) }
      if(fam==="top") {
        mv(topRankLayer)
        if(finalRankLeft!==null) finalRankLeft+=dx
        finalRankTop+=dy
        mv(badgeGeo[isExtraTopBadge? "extra":"rank"])
        return
      }
      for(const l of famLayers[fam]) mv(l)
      if(fam==="genre") { mv(genreBadgeRect); mv(badgeGeo.genre); itemsOf("genre")} 
      else if(fam==="rating") { mv(ratingBox); itemsOf("rating")} 
      else if(fam==="separate") { mv(badgeGeo.separate); inkOf(separateInkSource); itemsOf("separate")} 
      else if(fam==="quality") {
        mv(badgeGeo.quality); inkOf(qualityInkSource)
        for(const v of qualityDetachedInk.values()) mv(v)
        itemsOf("quality")
        if(relSepLinked) relMove("separate",dx,dy)
      } else {
        mv(netGeo); mv(badgeGeo.network); itemsOf("network")
      }
    }
    const relFamSide: Array<{ fam: RelFam; side: LogoRelativePosition} >=[]
    if(bottomRel) {
      relFamSide.push({ fam: "genre",side: bottomRel },{ fam: "rating",side: bottomRel })
      if(isBottomStyle) relFamSide.push({ fam: "separate",side: bottomRel })
    }
    if(qualityRel) relFamSide.push({ fam: "quality",side: qualityRel })
    if(netRel) relFamSide.push({ fam: "network",side: netRel })
    if(topRel) relFamSide.push({ fam: "top",side: topRel })
    const relOrder: RelFam[]=["genre","rating","separate","quality","network","top"]
    const relCx=logoResult.left+logoResult.w/2
    let relNetMoved=false
    // Un cursore per lato: si impila dal logo verso l'esterno. Se il badge non
    // sta dal lato chiesto (finirebbe sopra il logo per il clamp) passa
    // all'altro lato; se non sta in nessuno dei due resta sul lato chiesto.
    const relCursor={ above: relLogoTop-relGap,below: relLogoBottom+relGap }
    const relFits=(s: LogoRelativePosition,h: number,fam: RelFam) => s==="above"? relCursor.above-h>=relMarginY:relCursor.below+h<=CH-relBottomMargin(fam)
    for(const entry of relOrder.flatMap((fam) => relFamSide.filter((x) => x.fam===fam))) {
      const fam=entry.fam
      const box=await relBoxOf(fam)
      if(!box) continue
      const other: LogoRelativePosition=entry.side==="above"? "below":"above"
      const side=!relFits(entry.side,box.h,fam)&&relFits(other,box.h,fam)? other:entry.side
      // Stacking con dimensioni NON offsettate; clamp verticale nel canvas.
      let tTop=side==="above"? relCursor.above-box.h:relCursor.below
      if(tTop<relMarginY) tTop=relMarginY
      if(tTop+box.h>CH-relBottomMargin(fam)) tTop=Math.max(0,CH-relBottomMargin(fam)-box.h)
      if(side==="above") relCursor.above=tTop-relGap
      else relCursor.below=tTop+box.h+relGap
      const tLeft=Math.max(relMarginX,Math.min(CW-box.w-relMarginX,Math.round(relCx-box.w/2)))
      const off=relOffsetOf(fam)
      const fTop=Math.max(0,Math.min(CH-box.h,tTop+off.y))
      const fLeft=tLeft+off.x
      const dx=fLeft-box.left
      const dy=fTop-box.top
      if(dx===0&&dy===0) continue
      relMove(fam,dx,dy)
      if(fam==="network") relNetMoved=true
    }
    if(relNetMoved&&netGeo) onNetworkGeometry?.(netGeo)
  }

  // ---- Pass "auto evita manuali" (prima del report geometria: report e pixel
  // restano allineati). Ostacoli MANUALI sono fissi (rank/extra, logo, network,
  // qualità, genere/rating/pills in fascia manuale). Un badge AUTO che tocca un
  // ostacolo (rectsOverlap, margine 6) scende sotto di lui se sta nella metà alta
  // del canvas, sale sopra se nella metà bassa. Max 2 passate. La colonna
  // rating separati sotto una qualità AUTO è un'unica entry con la qualità: si
  // sposta con lei (stesso dy). Nessun ostacolo manuale = nessuna azione.
  {
    type AvoidFam="network"|"quality"|"genre"|"separate"|"rating"
    type Rect={ left: number; top: number; w: number; h: number} 
    const manualObs: Rect[]=[]
    if((topFixedActive||topAnchorActive||topRel!==null)&&finalRankBadge&&finalRankLeft!==null) {
      manualObs.push({ left: finalRankLeft,top: finalRankTop,w: badgeBody(finalRankBadge).w,h: badgeBody(finalRankBadge).h })
    }
    if(isActiveLogoAnchor(logoAnchorEff)&&logoResult) {
      manualObs.push({ left: logoResult.left,top: logoResult.top,w: logoResult.w,h: logoResult.h })
    }
    // Box di una famiglia: report (badgeGeo) o, per le pills bottom senza report
    // dedicato, unione degli item della famiglia "separate".
    const famBox=(fam: AvoidFam): Rect|null => {
      if(fam==="rating") return ratingBox
      if(fam==="separate"&&!badgeGeo.separate) {
        const items=badgeGeoItems.filter((it) => it.family==="separate")
        if(items.length===0) return null
        const l=Math.min(...items.map((it) => it.left)),t=Math.min(...items.map((it) => it.top))
        const r=Math.max(...items.map((it) => it.left+it.w)),b=Math.max(...items.map((it) => it.top+it.h))
        return { left: l,top: t,w: r-l,h: b-t }
      }
      return badgeGeo[fam]??null
    }
    if(networkManual&&badgeGeo.network) manualObs.push(badgeGeo.network)
    if(qualityManual&&badgeGeo.quality) manualObs.push(badgeGeo.quality)
    if(bottomManual&&badgeGeo.genre) manualObs.push(badgeGeo.genre)
    if(bottomManual&&ratingBox) manualObs.push(ratingBox)
    if(bottomManual&&isBottomStyle&&famBox("separate")) manualObs.push(famBox("separate")!)
    if(manualObs.length>0) {
      // Colonna separati collegata alla qualità AUTO (sotto di lei): una sola entry.
      // La colonna separati è sempre agganciata alla qualità (stessa stack): mai spostata da sola.
      const sepLinked=!isBottomStyle&&qualityStackAnchor!==null
      const autoFams: AvoidFam[]=(["network","quality","genre","rating","separate"] as AvoidFam[]).filter((fam) => {
        if(!famBox(fam)&&famLayers[fam].length===0) return false
        if(fam==="network") return !networkManual
        if(fam==="quality") return !qualityManual
        if(fam==="separate") return !sepLinked&&!(isBottomStyle&&bottomManual)
        return !bottomManual
      })
      // Sposta una famiglia: layer composti, box report, item, ink e geometria network.
      // La colonna separati collegata segue la qualità (stesso dy).
      const shiftFam=(fam: AvoidFam,dy: number) => {
        // Le strutture di geometria sono readonly per tipo: il solo spostamento verticale le muta qui.
        displaced.add(fam)
        const nudge=(o: { top: number} ) => { (o as { top: number} ).top+=dy }
        for(const l of famLayers[fam]) nudge(l)
        const g=fam==="rating"? ratingBox:badgeGeo[fam]
        if(g) nudge(g)
        if(fam==="genre"&&genreBadgeRect) nudge(genreBadgeRect)
        if(fam==="network"&&netGeo) nudge(netGeo)
        for(const it of badgeGeoItems) if(it.family===fam) nudge(it)
        const ink=fam==="quality"? qualityInkSource:fam==="separate"? separateInkSource:null
        if(ink) {
          nudge(ink)
          if(ink.body) nudge(ink.body)
        }
        if(fam==="quality") for(const v of qualityDetachedInk.values()) nudge(v)
        if(fam==="quality"&&sepLinked) shiftFam("separate",dy)
      }
      const avoidGap=6
      let networkMoved=false
      for(let iter=0;iter<2;iter++) {
        let moved=false
        for(const fam of autoFams) {
          const members: Array<{ box: Rect|null} >=[{ box: famBox(fam) }]
          if(fam==="quality"&&sepLinked) members.push({ box: famBox("separate") })
          let dy=0
          for(const { box } of members) {
            if(!box) continue
            const hit=manualObs.find((o) => rectsOverlap(box,o,6))
            if(!hit) continue
            dy=box.top+box.h/2<CH/2
              ? hit.top+hit.h+avoidGap-box.top
              :hit.top-avoidGap-(box.top+box.h)
            break
          }
          if(dy===0) continue
          shiftFam(fam,dy)
          if(fam==="network") networkMoved=true
          moved=true
        }
        if(!moved) break
      }
      if(networkMoved&&netGeo) onNetworkGeometry?.(netGeo)
    }
  }
  // Overflow "hide": le famiglie AUTO in collisione non si disegnano. Layer tolti
  // dai composite e dal report (badge, item, network) prima del report geometria,
  // così drag e pixel restano coerenti. Manuali, rank ed extra non entrano mai qui.
  if(input.badgeOverflow==="hide"&&displaced.size>0) {
    const gone=new Set<object>()
    for(const fam of displaced) for(const l of famLayers[fam]) gone.add(l)
    for(let i=composites.length-1;i>=0;i--) if(gone.has(composites[i])) composites.splice(i,1)
    if(displaced.has("network")) { delete badgeGeo.network; netGeo=null; onNetworkGeometry?.(null)} 
    if(displaced.has("quality")) { delete badgeGeo.quality; qualityInkSource=null; qualityDetachedInk.clear()} 
    if(displaced.has("separate")) { delete badgeGeo.separate; separateInkSource=null} 
    if(displaced.has("genre")) { delete badgeGeo.genre; genreBadgeRect=null} 
    if(displaced.has("rating")) ratingBox=null
    for(let i=badgeGeoItems.length-1;i>=0;i--) {
      if((displaced as Set<string>).has(badgeGeoItems[i].family)) badgeGeoItems.splice(i,1)
    }
  }
  if(onBadgeGeometry&&qualityInkSource&&badgeGeo.quality) {
    const src=qualityInkSource
    const comps=(await opaqueComponents(src.png)).map((c) => ({ ...c,left: c.left+src.left,top: c.top+src.top }))
    badgeGeo.quality=bodyFrame(src)??tightenBoxesToInk([badgeGeo.quality],comps)[0]
    const painted=badgeGeoItems.filter((it) => it.family==="quality"&&!it.ghost&&!qualityDetachedInk.has(it.id))
    const tight=tightenBoxesToInk(painted,comps)
    const detachedTight=new Map<string,BadgeGeometryItem>()
    for(const it of badgeGeoItems) {
      const own=it.family==="quality"? qualityDetachedInk.get(it.id):undefined
      if(!own) continue
      const ownComps=(await opaqueComponents(own.png)).map((c) => ({ ...c,left: c.left+own.left,top: c.top+own.top }))
      detachedTight.set(it.id,tightenBoxesToInk([it],ownComps)[0])
    }
    // Il box resta lo slot (contratto delle correzioni per-item e delle home);
    // l'area dipinta viaggia a parte in `ink`, solo per la cornice dell'editor.
    reportedItems=badgeGeoItems.map((it) => {
      const t=tight[painted.indexOf(it)]??detachedTight.get(it.id)
      return t&&(t.w!==it.w||t.h!==it.h||t.left!==it.left||t.top!==it.top)
        ? { ...it,ink: { top: t.top,left: t.left,w: t.w,h: t.h } }
        :it
    })
  }
  if(onBadgeGeometry&&separateInkSource&&badgeGeo.separate) {
    const src=separateInkSource
    const comps=(await opaqueComponents(src.png)).map((c) => ({ ...c,left: c.left+src.left,top: c.top+src.top }))
    badgeGeo.separate=bodyFrame(src)??tightenBoxesToInk([badgeGeo.separate],comps)[0]
  }
  onBadgeGeometry?.({
    canvasW: CW,
    canvasH: CH,
    layout: reportLayout,
    kind: isExtraTopBadge
      ? (finalRankBadge? "extra":null)
      :topRankDisplayed
        ? "rank"
        :null,
    families: badgeGeo,
    fixedX: badgeGeoFixedX,
    items: reportedItems,
  })
  return { finalRankLeft,finalRankTop,genreBadgeRect,ratingBox,separateInkSource,qualityInkSource,netGeo }
}
