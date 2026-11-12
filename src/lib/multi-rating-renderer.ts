import { escSvg, estimateTextWidth, fontFamilyFor, normalizeBadgeFont, satinPillStops, TOP_SHADOW_PAD, badgeDropShadow } from "./badge-svg-shared"
import { renderSVG } from "./svg-badge"
import { formatRating } from "./custom-rating/formatter"
import type { RatingItem } from "./custom-rating/types"
import type { BadgeFont } from "./badge-styles"

/** Display cap: oltre, le pill diventerebbero illeggibili su 380px. I dati restano completi. */
export const MAX_CUSTOM_RATINGS = 5

/**
 * Base type of the row at the REFERENCE canvas width (portrait 500): the
 * historic 20. Geometry (padding/height/gap) is derived from `fs`, so the whole
 * row keeps its proportions when the type scales with the canvas.
 */
const PILL_FS = 20
const PILL_FS_REF_PW = 500
/** Historic 20/28/38/8 measures expressed as factors of the base font. */
const PILL_PAD_X_PER_FS = 28 / PILL_FS
const PILL_H_PER_FS = 38 / PILL_FS
const PILL_GAP_PER_FS = 8 / PILL_FS
/** Font-fit floor relative to the base size (same idiom as the separate bottom row). */
const PILL_FS_FLOOR_RATIO = 0.55
const PILL_FIT_ATTEMPTS = 4

/**
 * Ombra 3D dedicata: con gap di 8px l'ombra dei badge superiori (dx=3, blur
 * 3.5) sborderebbe sulla pill accanto; stessa ricetta ridotta della riga
 * separati (`seps`: dx=2, dy=2, blur 2, 0.55).
 */
const CUSTOM_SHADOW_FILTER = badgeDropShadow("mrs")

/**
 * A separate horizontal row; no network or changes to legacy badge layout.
 * Material follows the shared pill recipe (`satinPillStops` + 1.5px polarized
 * stroke + `CUSTOM_SHADOW_FILTER`): dark satin pill with light ink on light
 * posters, light satin pill with dark ink on dark ones. Text uses per-label font
 * + textLength stabilization like every other badge (Windows/local vs Linux
 * metrics). The type scales with the canvas (20 at the portrait 500 reference)
 * and the row fits the budget by shrinking the FONT (never a whole-row squeeze,
 * except as the last resort when the floor is already reached).
 */
export async function renderMultiRatings(
  ratings: RatingItem[],
  maxWidth: number,
  topLight = true,
  font: BadgeFont = "inter",
) {
  const items = ratings.filter(item => Number.isFinite(item.value)).slice(0, MAX_CUSTOM_RATINGS)
  if (!items.length) return null
  const f = normalizeBadgeFont(font)
  const budget = Math.max(1, Math.round(maxWidth))
  // The caller passes the canvas width minus the 40px side margin
  // (poster-service: `CW - 40`), so the canvas width is reconstructed from the
  // budget: 20 at the portrait 500 reference, proportionally larger on a wider
  // canvas (landscape). `TOP_SHADOW_PAD` is carved out of the same budget, so
  // the returned bitmap never exceeds `maxWidth`.
  const pw = budget + 40
  const baseFs = Math.max(1, Math.round(PILL_FS * pw / PILL_FS_REF_PW))
  const floorFs = Math.max(8, Math.round(baseFs * PILL_FS_FLOOR_RATIO))
  const maxContentW = Math.max(1, budget - TOP_SHADOW_PAD * 2)
  // Materiale satinato condiviso: fondo chiaro → pill scura + inchiostro chiaro.
  const fg = topLight ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.88)"
  const stroke = topLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.22)"
  const padXFor = (fs: number) => Math.round(fs * PILL_PAD_X_PER_FS)
  const pillHFor = (fs: number) => Math.round(fs * PILL_H_PER_FS)
  const gapFor = (fs: number) => Math.max(2, Math.round(fs * PILL_GAP_PER_FS))
  interface Pill { label: string; textW: number; w: number }
  const buildPills = (fs: number): Pill[] => items.map(item => {
    const label = `${item.name.slice(0, 80)} ${formatRating(item.value, item.format)}`
    const textW = Math.max(Math.ceil(estimateTextWidth(label, fs, f)), 1)
    return { label, textW, w: textW + padXFor(fs) }
  })
  const rowW = (pills: Pill[], fs: number) =>
    pills.reduce((acc, pill) => acc + pill.w, 0) + gapFor(fs) * (pills.length - 1)
  // Font fit (max 4 tentativi, stesso idioma della riga separati bottom): il
  // font scende finché la riga entra nel budget, così il bitmap non viene mai
  // schiacciato in blocco se non come ultima rete di sicurezza.
  let fs = baseFs
  let pills = buildPills(fs)
  for (let attempt = 0; attempt < PILL_FIT_ATTEMPTS && rowW(pills, fs) > maxContentW && fs > floorFs; attempt++) {
    const next = Math.max(floorFs, Math.round(fs * 0.85))
    if (next === fs) break
    fs = next
    pills = buildPills(fs)
  }
  const gap = gapFor(fs)
  const pillH = pillHFor(fs)
  let x = 0
  const parts = pills.map(pill => {
    const group = `<g transform="translate(${x},0)"><rect width="${pill.w}" height="${pillH}" rx="${pillH / 2}" fill="url(#mrg)" stroke="${stroke}" stroke-width="1.5" filter="url(#mrs)"/><text x="${pill.w / 2}" y="${pillH / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamilyFor(pill.label, f)}" font-size="${fs}" font-weight="700" fill="${fg}" textLength="${pill.textW}" lengthAdjust="spacingAndGlyphs">${escSvg(pill.label)}</text></g>`
    x += pill.w + gap
    return group
  })
  const contentW = rowW(pills, fs)
  // Canvas = row + TOP_SHADOW_PAD su ogni lato (la riga galleggia sopra il
  // badge genere: l'ombra non deve mai essere tagliata).
  const natW = contentW + TOP_SHADOW_PAD * 2
  const natH = pillH + TOP_SHADOW_PAD * 2
  const defs = `<defs><linearGradient id="mrg" x1="0" y1="0" x2="0" y2="1">${satinPillStops(topLight)}</linearGradient>${CUSTOM_SHADOW_FILTER}</defs>`
  const body = `<g transform="translate(${TOP_SHADOW_PAD},${TOP_SHADOW_PAD})">${parts.join("")}</g>`
  // Ultima rete: font già al floor e riga ancora oltre il budget (etichette
  // lunghissime/arrotondamenti) → shrink proporzionale del bitmap, aspect
  // preservato, mai clipping.
  const fit = natW > budget ? budget / natW : 1
  const w = Math.max(1, Math.round(natW * fit))
  const h = Math.max(1, Math.round(natH * fit))
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${natW} ${natH}">${defs}${body}</svg>`
  const png = await renderSVG(raw, w)
  return { png, w, h }
}
