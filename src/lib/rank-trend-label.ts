import sharp from "sharp"
import type { ChartFamilyPin } from "@/lib/chart-generation"
import { badgeBody, type BadgeBleed } from "@/lib/poster-render-helpers"

export type RankTrendDir = "up" | "down"

/** Chart movement direction of a JW row; STABLE/missing = no arrow. */
export function rankTrendDirection(row: { trend?: string } | null | undefined): RankTrendDir | null {
  if (row?.trend === "UP") return "up"
  if (row?.trend === "DOWN") return "down"
  return null
}

/**
 * Direction for the automatic live rank only: the pinned family row must be
 * the very row the badge rank came from (same tmdbId AND same rank), so a
 * manual `rank=`/`rk=` override or a saved-rank fallback never wears a stale
 * arrow.
 */
export function rankTrendFromPin(
  pin: ChartFamilyPin | null | undefined,
  tmdbId: number,
  rank: number | null,
): RankTrendDir | null {
  if (!pin?.snapshot || rank === null) return null
  const row = pin.snapshot.rows.find((r) => r.tmdbId === tmdbId)
  return row && row.rank === rank ? rankTrendDirection(row) : null
}

export const RANK_TREND_UP_COLOR = "#2fd27a"
export const RANK_TREND_DOWN_COLOR = "#ff5d5d"

/**
 * Thin line arrow (24-unit box): stem + open chevron head with round caps,
 * a faint darker under-stroke keeps it legible on light and dark badges.
 */
export function buildRankTrendArrowSvg(dir: RankTrendDir, size: number, _surface: "auto" | "light" = "auto"): string {
  const color = dir === "up" ? RANK_TREND_UP_COLOR : RANK_TREND_DOWN_COLOR
  const d = "M12 20 V5 M6.2 10.6 L12 4.8 L17.8 10.6"
  const flip = dir === "down" ? ' transform="rotate(180 12 12)"' : ""
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><g fill="none" stroke-linecap="round" stroke-linejoin="round"${flip}><path d="${d}" stroke="rgba(0,0,0,0.32)" stroke-width="3.6"/><path d="${d}" stroke="${color}" stroke-width="2.2"/></g></svg>`
}

export interface RankTrendBox { readonly left: number; readonly top: number; readonly w: number; readonly h: number }

export interface RankBadgeBitmap {
  readonly png: Buffer
  readonly w: number
  readonly h: number
  readonly bleed?: BadgeBleed
}

export type RankTrendMode = "inside" | "ribbon" | "beside"

/**
 * Where the arrow lives for a ranking style: INSIDE containers that carry the
 * label (a trailing em space reserves its room), on the ribbon's numeral, or
 * beside bare styles that have no label container (number, editoriale).
 */
export function rankTrendModeFor(style: string | null | undefined): RankTrendMode {
  if (style === "netflix" || style === "netflix-color" || style === "colored") return "ribbon"
  if (style === "number" || style === "editoriale") return "beside"
  return "inside"
}

/** Opaque-ink bounds (alpha > 96) of a badge bitmap: shadow pad excluded. */
async function inkBounds(png: Buffer, w: number, h: number): Promise<{ right: number; top: number; bottom: number } | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let right = -1, top = h, bottom = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 96) {
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  void w
  return right < 0 ? null : { right: right + 1, top, bottom: bottom + 1 }
}

/**
 * Vertical band of the main glyph row (the numeral / the label text), found by
 * scanning opaque text-coloured pixels (dark digits on a light sheet, light
 * digits on a coloured one; bare styles are forced to `light`). The tallest
 * contiguous band wins, so thin underlines and small captions are ignored.
 */
async function glyphBand(png: Buffer, forced?: "dark" | "light"): Promise<{ top: number; bottom: number } | null> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  // Polarity follows the sheet: mostly light opaque pixels (cream ribbon) = dark glyphs, else light glyphs.
  let sum = 0, n = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= 220) { sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; n++ }
  }
  const polarity = forced ?? (n > 0 && sum / n > 150 ? "dark" : "light")
  const rows: boolean[] = []
  for (let y = 0; y < info.height; y++) {
    let hit = false
    for (let x = 0; x < info.width && !hit; x++) {
      const i = (y * info.width + x) * 4
      if (data[i + 3] < 220) continue
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      if (polarity === "dark" ? luma < 90 : luma > 215) hit = true
    }
    rows.push(hit)
  }
  let best: { top: number; bottom: number } | null = null
  let start = -1
  for (let y = 0; y <= rows.length; y++) {
    if (y < rows.length && rows[y]) { if (start < 0) start = y; continue }
    if (start >= 0) {
      if (!best || y - start > best.bottom - best.top) best = { top: start, bottom: y }
      start = -1
    }
  }
  return best
}

/**
 * Standard rank badge + arrow in ONE bitmap: the canvas grows to the right and
 * the visible body (bleed) grows with it, so every style/position/overlap
 * rule treats the arrow as part of the badge. The arrow hugs the badge ink
 * (shadow padding ignored) and is capped on the canvas so tall ribbons never
 * blow it up. Operates after the badge cache (never poisons it).
 */
export async function attachRankTrendArrow<T extends RankBadgeBitmap>(badge: T, dir: RankTrendDir, canvasW = 500, mode: RankTrendMode = "beside", style?: string | null): Promise<T> {
  const body = badgeBody(badge)
  const ink = await inkBounds(badge.png, badge.w, badge.h)
  const inkRight = ink ? Math.min(ink.right, body.x + body.w) : body.x + body.w
  const inkTop = ink ? Math.max(ink.top, body.y) : body.y
  const inkBottom = ink ? Math.min(ink.bottom, body.y + body.h) : body.y + body.h
  const inkH = Math.max(1, inkBottom - inkTop)
  const size = Math.min(Math.max(12, Math.round(inkH * 0.5)), Math.max(12, Math.round(canvasW * 0.06)))
  const gap = Math.max(3, Math.round(size * 0.35))
  if (mode === "inside" || mode === "ribbon") {
    // Same bitmap, no growth: the arrow sits inside the container.
    const inkLeft = body.x
    const inkW = inkRight - inkLeft
    const insideLeft = mode === "ribbon"
      ? Math.round(inkLeft + inkW * 0.7)
      // Notch plates flare into concave wings past the plate edge: more margin.
      : Math.round(inkRight - size - inkH * (style?.startsWith("notch-") ? 0.95 : 0.34))
    // Ribbon: centred on the numeral band; containers: centred on the plate.
    const band = mode === "ribbon" ? await glyphBand(badge.png) : null
    const insideTop = band
      ? Math.round((band.top + band.bottom - size) / 2)
      : Math.round(inkTop + (inkH - size) / 2)
    const arrowIn = await sharp(Buffer.from(buildRankTrendArrowSvg(dir, size, mode === "ribbon" ? "light" : "auto"))).png().toBuffer()
    const pngIn = await sharp(badge.png).composite([{ input: arrowIn, left: Math.max(0, insideLeft), top: Math.max(0, insideTop) }]).png().toBuffer()
    return { ...badge, png: pngIn }
  }
  // Bare text styles: centred on the text band (not the underline/shadow).
  const textBand = await glyphBand(badge.png, "light")
  const top = textBand
    ? Math.round((textBand.top + textBand.bottom - size) / 2)
    : Math.round(inkH > size * 2.2 ? inkTop + size * 0.6 : inkTop + (inkH - size) / 2)
  const left = inkRight + gap
  const addW = Math.max(0, left + size + 2 - badge.w)
  const arrow = await sharp(Buffer.from(buildRankTrendArrowSvg(dir, size))).png().toBuffer()
  const png = await sharp({ create: { width: badge.w + addW, height: badge.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: badge.png, left: 0, top: 0 },
      { input: arrow, left, top: Math.max(0, Math.min(top, badge.h - size)) },
    ])
    .png()
    .toBuffer()
  const bleed: BadgeBleed = { x: body.x, y: body.y, w: Math.max(body.w, left + size - body.x), h: body.h }
  return { ...badge, png, w: badge.w + addW, bleed }
}

/**
 * Arrow for the free-standing numerals. Fresh: right of the digit ink (the
 * measured box carries ~13% rim/shadow padding), near its top. Card: above the
 * numeral, centred in the left gutter (the artwork covers the numeral's right).
 * Null when the spot falls outside the canvas.
 */
export function placeRankTrendArrow(
  body: RankTrendBox,
  canvasW: number,
  canvasH: number,
  layout: "fresh" | "card" = "fresh",
  /** Card only: width of the left gutter (artwork card x); the arrow centres in it. */
  gutterW?: number,
): { left: number; top: number; size: number } | null {
  const size = Math.min(Math.max(14, Math.round(body.h * 0.14)), Math.max(14, Math.round(canvasW * 0.08)))
  const gap = Math.max(4, Math.round(size * 0.35))
  const spot = layout === "card"
    ? { left: Math.round(gutterW !== undefined ? gutterW / 2 - size / 2 : body.left + 16), top: Math.round(body.top - size - gap) }
    : { left: Math.round(body.left + body.w * 0.87 + gap), top: Math.round(body.top + body.h * 0.06) }
  if (spot.top < 0 || spot.top + size > canvasH || spot.left < 0 || spot.left + size > canvasW) return null
  return { ...spot, size }
}
