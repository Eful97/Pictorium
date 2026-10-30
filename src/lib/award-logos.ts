/**
 * Award logo pill (`awardstyle=logo`): the bundled gold mark of a canonical
 * award above its short name, on the shared anthracite plate.
 *
 * Server-only (fs/sharp). The icon is never recolored: the original SVG
 * artwork is rasterized on a transparent background and embedded as PNG,
 * exactly like the network marks. Missing/unreadable asset → `null`, so the
 * caller falls back to the historic textual extra badge (never a 500).
 */
import fs from "fs"
import path from "path"
import { createLogger } from "@/lib/logger"
import { AWARD_LOGO_FILES } from "./award-logo-files"
import {
  BADGE_BOX_PAD_X_FACTOR,
  TOP_SHADOW_FILTER,
  TOP_SHADOW_PAD,
  badgeBoxHeight,
  escSvg,
  fontFamilyFor,
  normalizeBadgeFont,
  pinnedBadgeTextWidth,
  textFitAttrs,
} from "./badge-svg-shared"
import type { BadgeFont } from "./badge-styles"
import type { AwardBadgeKey } from "./badge-labels"
import { renderSVG } from "./svg-badge"

const log = createLogger("award-logos")

const AWARDS_DIR = path.join(process.cwd(), "public", "awards")

/** Plate color: anthracite, polarity independent (spec, never themed). */
const AWARD_PILL_BG = "rgba(24,24,27,0.69)"
const AWARD_PILL_STROKE = "rgba(255,255,255,0.20)"
const AWARD_PILL_STROKE_WIDTH = 1.5
/**
 * Caption ink: the same high-contrast white as the `standard` quality pill on
 * a dark top. The plate is ALWAYS anthracite, so the ink never polarizes.
 */
const AWARD_CAPTION_INK = "rgba(255,255,255,0.95)"

/**
 * Base font size of the award pill on the 380 grid.
 *
 * 17px was the icon-only base (same band as the quality pill). The pill now
 * stacks icon + caption inside the same shared box, so the base grew to 25px:
 * `boxH = badgeBoxHeight(25) = 45` on the 380 grid (59px at pw=500, ~+47% vs
 * the icon-only pill) while the top-line still has room because the bitmap is
 * centered at the top edge and grows only downward — position/overlap math
 * downstream is dimension-driven (`fitBadgeToCanvas`, network/quality shrink).
 */
export const AWARD_PILL_BASE_FS = 25
/**
 * Floor of the base `fs` (small canvases): keeps the caption readable instead
 * of collapsing to a few pixels. Same proportional band as the old 10/17 floor.
 */
export const AWARD_PILL_MIN_FS = 15
/** Caption font size as a fraction of the pill base `fs`. */
export const AWARD_CAPTION_FS_FACTOR = 0.40
/** Icon → caption gap, in em of the caption font (spec: ~0.25em). */
export const AWARD_CAPTION_GAP_FACTOR = 0.25
/** Symmetric inner vertical padding, as a fraction of the base `fs`. */
export const AWARD_PILL_PAD_Y_FACTOR = 0.16
/** Max icon width relative to the icon max height (wide marks: Cannes 2:1). */
export const AWARD_ICON_MAX_WIDTH_RATIO = 1.9

const iconMemo = new Map<string, Promise<{ png: Buffer; w: number; h: number } | null>>()
const ICON_MEMO_MAX = 64

/**
 * Rasterized icon (transparent PNG, original gold fill) memoized per
 * (award, target pixel size). Assets are static: no TTL needed.
 */
function loadAwardIcon(key: AwardBadgeKey, maxW: number, maxH: number): Promise<{ png: Buffer; w: number; h: number } | null> {
  const memoKey = `${key}:${maxW}:${maxH}`
  const memo = iconMemo.get(memoKey)
  if (memo) return memo
  const p = loadAwardIconUncached(key, maxW, maxH)
  p.catch(() => { if (iconMemo.get(memoKey) === p) iconMemo.delete(memoKey) })
  if (iconMemo.size >= ICON_MEMO_MAX) iconMemo.delete(iconMemo.keys().next().value!)
  iconMemo.set(memoKey, p)
  return p
}

async function loadAwardIconUncached(key: AwardBadgeKey, maxW: number, maxH: number): Promise<{ png: Buffer; w: number; h: number } | null> {
  const filename = AWARD_LOGO_FILES[key]
  if (!filename) return null
  const filePath = path.join(AWARDS_DIR, filename)
  if (!fs.existsSync(filePath)) return null
  try {
    const sharp = (await import("sharp")).default
    const svgBuffer = await fs.promises.readFile(filePath)
    // Render upscaled first (high density) so small marks stay sharp at the
    // target size; `inside` preserves the original aspect ratio.
    const { data, info } = await sharp(svgBuffer, { density: 600 })
      .resize(maxW * 3, maxH * 3, { fit: "inside", withoutEnlargement: false })
      .resize(maxW, maxH, { fit: "inside" })
      .png()
      .toBuffer({ resolveWithObject: true })
    return { png: data, w: info.width, h: info.height }
  } catch (e) {
    log.warn("Award icon unavailable", { key, file: filename, error: String(e) })
    return null
  }
}

export interface AwardLogoBadgeOptions {
  /**
   * Short LOCALIZED award name drawn under the icon ("Oscar", "Venezia", …).
   * Always supplied by the call-site (same `awardShortName` the textual badge
   * uses) — never an English literal here. Absent/empty falls back to the
   * canonical key, so a direct caller still renders a caption.
   */
  readonly caption?: string
  /** Effective top-badge font (default `inter`, the historic rendering). */
  readonly font?: BadgeFont
}

/**
 * Renders the award logo pill at `pw` (same badge reference width as the
 * quality pill). Layout inside the shared box: icon on top, short award name
 * below, both centered, one symmetric vertical padding. Returns null when the
 * asset is missing so the caller keeps the textual extra badge.
 *
 * The caption and the font are render inputs (the caller also folds them into
 * its bitmap cache key): two awards or two locales can never share a bitmap.
 */
export async function renderAwardLogoBadge(
  key: AwardBadgeKey,
  pw: number,
  opts?: AwardLogoBadgeOptions,
): Promise<{ png: Buffer; w: number; h: number } | null> {
  const fs = Math.round(Math.max((AWARD_PILL_BASE_FS * pw) / 380, AWARD_PILL_MIN_FS))
  const font = normalizeBadgeFont(opts?.font)
  // Canonical key as caption fallback: never an English literal, never empty.
  const caption = (opts?.caption ?? "").trim() || key
  // Same shared box as the quality pill (`badgeBoxHeight`), larger base: the
  // anchor math downstream (scale/offset/cap) reads the bitmap, so a bigger
  // base needs no other change.
  const boxH = badgeBoxHeight(fs)
  const padX = Math.round(fs * BADGE_BOX_PAD_X_FACTOR)
  const capFs = Math.max(1, Math.round(fs * AWARD_CAPTION_FS_FACTOR))
  const gap = Math.round(capFs * AWARD_CAPTION_GAP_FACTOR)
  const padY = Math.round(fs * AWARD_PILL_PAD_Y_FACTOR)
  // Icon box from the vertical budget of the shared box: padding, caption and
  // gap are reserved FIRST and the icon takes the rest, so the stack can never
  // overflow the pill (no manual height sum).
  const iconMaxH = Math.max(1, boxH - padY * 2 - gap - capFs)
  const iconMaxW = Math.max(1, Math.round(iconMaxH * AWARD_ICON_MAX_WIDTH_RATIO))
  const icon = await loadAwardIcon(key, iconMaxW, iconMaxH)
  if (!icon) return null

  // Width = widest of (icon, caption) + symmetric padding; the caption is
  // pinned with the shared tracking estimate (`textLength`/`lengthAdjust`),
  // exactly like the quality pill glyphs.
  const captionW = pinnedBadgeTextWidth(caption, capFs, font)
  const pillW = Math.max(icon.w, captionW) + padX * 2
  const pillH = boxH
  const r = Math.round(pillH / 2)
  const renderW = pillW + TOP_SHADOW_PAD * 2
  const renderH = pillH + TOP_SHADOW_PAD * 2
  const ox = TOP_SHADOW_PAD
  const oy = TOP_SHADOW_PAD
  // Icon + gap + caption as ONE stack, vertically centered: a wide mark
  // clamped by width keeps symmetric padding above and below (icon below its
  // max height leaves the spare room split evenly, never dumped at the bottom).
  const contentH = icon.h + gap + capFs
  const topPad = Math.max(0, Math.round((pillH - contentH) / 2))
  const iconX = ox + Math.round((pillW - icon.w) / 2)
  const iconY = oy + topPad
  const captionY = iconY + icon.h + gap + Math.round(capFs / 2)
  const captionEl =
    `<text x="${ox + pillW / 2}" y="${captionY}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="${fontFamilyFor(caption, font)}" font-weight="700" font-size="${capFs}" ` +
    `letter-spacing="0.06em" fill="${AWARD_CAPTION_INK}"${textFitAttrs(captionW)}>${escSvg(caption)}</text>`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${renderW}" height="${renderH}" viewBox="0 0 ${renderW} ${renderH}">` +
    `<defs>${TOP_SHADOW_FILTER}</defs>` +
    `<rect x="${ox}" y="${oy}" width="${pillW}" height="${pillH}" rx="${r}" fill="${AWARD_PILL_BG}" stroke="${AWARD_PILL_STROKE}" stroke-width="${AWARD_PILL_STROKE_WIDTH}" filter="url(#tds)"/>` +
    `<image href="data:image/png;base64,${icon.png.toString("base64")}" x="${iconX}" y="${iconY}" width="${icon.w}" height="${icon.h}"/>` +
    captionEl +
    `</svg>`
  const png = await renderSVG(svg, renderW)
  return { png, w: renderW, h: renderH }
}
