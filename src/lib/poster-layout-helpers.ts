import type { LogoRelativePosition } from "./badge-anchor"
import sharp from "sharp"
import { BadgeRender,badgeBody,badgeCanvasForBody,type BadgeBleed,scaleBadgeBleed } from "./poster-render-helpers"
import { type BodyInkRatios } from "./badge-anchor"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const BADGE_CACHE_TTL = 24 * 60 * 60 * 1000

// B2: scala % di un bitmap già renderizzato (un solo resize sharp).
// Condiviso dai 4 badge scalabili (rank/genere/qualità/network): stessa
// matematica dei blocchi inline sostituiti (round + max 1px, no-op se le
// dimensioni non cambiano). Lo spread preserva i campi extra (isRank, …);
// il bleed viaggia con la bitmap (stesso rapporto effettivo, come nel fit).
export async function scaleBitmapForLayout<T extends BadgeRender>(r: T, pct: number): Promise<T> {
  const w = Math.max(1, Math.round(r.w * pct / 100))
  const h = Math.max(1, Math.round(r.h * pct / 100))
  if (w === r.w && h === r.h) return r
  const png = await sharp(r.png).resize(w, h).toBuffer()
  const bleed = r.bleed ? scaleBadgeBleed(r.bleed, w / r.w, h / r.h) : undefined
  return { ...r, png, w, h, ...(bleed ? { bleed } : {}) }
}


/** Bounding box dell'inchiostro (alpha > 40) di un bitmap badge, in px del bitmap. */
export async function inkBounds(png: Buffer): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 40) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * Rapporti (offset, larghezza) dell'inchiostro visibile rispetto al CORPO del
 * badge: input di `bottomAnchoredBodyLeft`. Costo (un decode sharp) solo con
 * ancora inferiore attiva. Null = bitmap senza inchiostro.
 */
export async function inkRatios(badge: { png: Buffer; w: number; h: number; bleed?: BadgeBleed }): Promise<BodyInkRatios | null> {
  const body = badgeBody(badge)
  const ink = await inkBounds(badge.png)
  if (!ink || body.w <= 0) return null
  return { offset: (ink.x - body.x) / body.w, width: ink.w / body.w }
}

/** Scala minima di genere + riga rating per farli entrare "sotto il logo". */
export const BELOW_LOGO_MIN_SCALE = 0.4
/** Il logo (ancora Auto) sale per tenere i badge "sotto il logo" almeno a questa scala. */
export const LOGO_LIFT_TARGET_SCALE = 0.8
/** Salita massima del logo, in frazione dell'altezza canvas. */
export const LOGO_LIFT_MAX_FRAC = 0.15

/** Respiro minimo tra inchiostro del badge genere e logo titolo. */
export const LOGO_BADGE_GAP = 6

/**
 * Anti-collisione badge/logo: shrink (floor 0.75, passo 0.05) finché
 * l'inchiostro del badge, piazzato da `placeBody` (ancora del CORPO, come il
 * layout), resta a più di `LOGO_BADGE_GAP` px da `rect`. Se nemmeno a 0.75
 * basta (logo molto largo sulla stessa linea), il badge resta a grandezza
 * piena e sale sopra il logo (`dy` negativo sul top). Nessuna collisione →
 * stesso oggetto e `dy` 0 (byte-identico allo storico).
 */
/** Sovrapposizione di due box `{left,top,w,h}` con margine di respiro `m` (px). */
export function rectsOverlap(
  a: { left: number; top: number; w: number; h: number },
  b: { left: number; top: number; w: number; h: number },
  m = 0,
): boolean {
  return a.left < b.left + b.w + m && a.left + a.w > b.left - m && a.top < b.top + b.h + m && a.top + a.h > b.top - m
}

export async function shrinkAwayFromRect<T extends BadgeRender>(
  badge: T,
  rect: { top: number; left: number; w: number; h: number },
  placeBody: (body: { w: number; h: number }) => { top: number; left: number },
): Promise<{ badge: T; dy: number }> {
  const ink = await inkBounds(badge.png)
  if (!ink) return { badge, dy: 0 }
  const inkAt = (scale: number) => {
    const w = Math.max(1, Math.round(badge.w * scale))
    const h = Math.max(1, Math.round(badge.h * scale))
    const bleed = badge.bleed ? scaleBadgeBleed(badge.bleed, w / badge.w, h / badge.h) : undefined
    const at = placeBody(badgeBody({ w, h, bleed }))
    const canvas = badgeCanvasForBody(at.left, at.top, { bleed })
    const kx = w / badge.w
    const ky = h / badge.h
    return { x: canvas.left + ink.x * kx, y: canvas.top + ink.y * ky, w: ink.w * kx, h: ink.h * ky }
  }
  const hits = (scale: number): boolean => {
    const k = inkAt(scale)
    return k.x < rect.left + rect.w + LOGO_BADGE_GAP && k.x + k.w > rect.left - LOGO_BADGE_GAP
      && k.y < rect.top + rect.h + LOGO_BADGE_GAP && k.y + k.h > rect.top - LOGO_BADGE_GAP
  }
  if (!hits(1)) return { badge, dy: 0 }
  let scale = 1
  while (scale > 0.75 && hits(scale)) scale = Math.max(0.75, Math.round((scale - 0.05) * 100) / 100)
  if (!hits(scale)) return { badge: await scaleBitmapForLayout(badge, scale * 100), dy: 0 }
  const full = inkAt(1)
  return { badge, dy: Math.min(0, Math.round(rect.top - LOGO_BADGE_GAP - (full.y + full.h))) }
}

// Base geometrica pills landscape: -20px X / -10px Y rispetto all'ancoraggio
// neutro (margine pieno 18*CW/380 + margine basso 20*CH/570). Solo default di
// geometria: gli slider sepox/sepoy restano neutri a 0 e si sommano sopra;
// default globali separateBadgeOffset invariati (la colonna non si sposta).
export const LANDSCAPE_BOTTOM_PILLS_SHIFT_X = -20
export const LANDSCAPE_BOTTOM_PILLS_SHIFT_Y = -10

// Base geometrica separati portrait: +5px Y (verso il basso) rispetto
// all'ancoraggio storico, SOLO formato poster/verticale, stili colonna e
// bottom-pills. Solo default di geometria PRIMA degli offset utente
// (sepox/sepoy neutri a 0 e additivi dopo, con clamp dentro il canvas);
// default globali separateBadgeOffset invariati (0 resta 0, nessun fallback
// landscape toccato). Eccezione: bottom-bar portrait full-width a filo
// (top = CH - h): il +5 sarebbe annullato dal clamp, resta a filo.
export const PORTRAIT_SEPARATE_SHIFT_Y = 5

// Fattore del sigma di sfocatura del vetro sul gradino dei rating separati
// (`notch-vetro`): il gradino copre due livelli, quindi la sfocatura reale è
// più forte del vetro standard (σ base = max(4, CW/40)) per restare leggibile.
export const NOTCH_STEP_GLASS_SIGMA_BOOST = 1.6

// Tipi condivisi dei blocchi di layout badge (anche per la geometria).
export type RelEntry = { key: "band" | "quality" | "network" | "top"; side: LogoRelativePosition; h: number; bm: number }
export type InkSource = { png: Buffer; left: number; top: number; body?: { left: number; top: number; w: number; h: number } }
export type RelFam = "genre" | "rating" | "separate" | "quality" | "network" | "top"
export type RelBox = { left: number; top: number; w: number; h: number }
