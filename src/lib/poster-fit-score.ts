import sharp from "sharp"
import { computeLogoLayout, PORTRAIT_LOGO_MAX_HEIGHT_PCT, PORTRAIT_LOGO_TOP_OFFSET } from "@/lib/logo-layout"
import { createLogger } from "@/lib/logger"
// Batch B: import shared utilities from image-utils.ts (single source of truth)
import { STD_W, STD_H, LAND_W, LAND_H, clamp, luma, type RgbData, decodePosterRaw, sliceRgb } from "@/lib/image-utils"
import type { PosterShape } from "@/lib/types"

const log = createLogger("poster-fit-score")

/**
 * ## Poster fit scoring algorithm
 *
 * `scorePosterLogoFit` ranks candidate posters by how well a logo will sit on
 * them. The final score is a weighted blend of four metrics, then penalized
 * multiplicatively when contrast is poor:
 *
 * ```
 * score = (cleanliness*0.35 + contrast*0.30 + lowDetail*0.25 + badgeReadability*0.10)
 *         × contrastMultiplier
 * ```
 *
 * where:
 * - **cleanliness** = `1 - clamp(stdDev/80, 0, 1)` — low variance in the logo
 *   safety area means a clean background. Penalized by skin-tone overlap and
 *   abrupt gradients.
 * - **contrast** = `clamp(inkContrast * 1.8, 0, 1)` — mean per-pixel weighted
 *   perceptual distance (0.30/0.59/0.11) between logo ink (alpha map) and the
 *   poster beneath it, so both luminance and hue differences count and a
 *   bicolor logo isn't diluted to its average color. Falls back to
 *   `clamp(|logoLuma - bgLuma| * 1.8, 0, 1)` if the logo is almost fully
 *   transparent.
 * - **lowDetail** = `1 - clamp(edgeAvg/60, 0, 1)` — low edge density in the
 *   safety area. Reduced further if the logo covers a high-detail hotspot.
 * - **badgeReadability** = `1 - clamp(stdDev/90, 0, 1)` in the badge zone
 *   (bottom 16%), only when badges are enabled.
 * - **contrastMultiplier** = `min(1, contrast*2.5 + 0.25)` — if contrast is
 *   poor, the whole score is scaled down. If `contrast < 0.35`, score is
 *   additionally capped at 0.55.
 *
 * When `offsetYVariants` is provided, the score is blended with the worst-case
 * variant score (`score*0.7 + worstCase*0.3`) to prefer posters robust to
 * small vertical logo offsets.
 *
 * `adjustFitResults` (poster-fit-adjust.ts) then applies text-penalty and
 * quality bonuses on top of this base score.
 */

export interface PosterFitInput {
  posterBuffer: Buffer
  logoBuffer: Buffer
  posterPath?: string
  logoScale: number
  logoOffsetX: number
  logoOffsetY: number
  hasBadges: boolean
  offsetYVariants?: number[]
  /** Formato canvas: "landscape" analizza a 768×432 con layout Cinematic
   *  Left (stessi vincoli di poster-service.ts). Default "poster". */
  shape?: PosterShape
  /** Valori derivati dal logo, pre-calcolati una volta per run da
   *  `rankPostersByFit`. Quando assenti (path test) vengono calcolati
   *  internamente. */
  context?: LogoFitContext
}

export interface LogoFitContext {
  logoW: number
  logoH: number
  logoLuma: number
  baseLayout: { left: number; top: number; width: number; height: number }
  /** Logo ridimensionato a "inside" nel box di layout, con canale alpha:
   *  mappa 1:1 la composizione reale (poster-service.ts), allineato a
   *  (maskLeft, maskTop). */
  logoMask: { data: Buffer; width: number; height: number }
  maskLeft: number
  maskTop: number
}

export interface PosterFitMetrics {
  cleanliness: number
  contrast: number
  detailPenalty: number
  badgeReadability: number
}

export interface PosterFitResult {
  posterPath: string | undefined
  score: number
  metrics: PosterFitMetrics
  reasons: string[]
  /** Poster già decodificato (raw RGB alle dimensioni canvas) durante lo scoring:
   *  `adjustFitResults` lo riusa per la text penalty senza ri-decodificare. */
  posterRaw?: RgbData
  /** Posizione del box logo (coordinate canvas) calcolata durante lo scoring:
   *  `adjustFitResults` ci limita la text penalty alla zona dove il logo
   *  atterrerà davvero, invece della striscia fissa globale. */
  logoZone?: { left: number; top: number; width: number; height: number }
}

/** Dimensioni canvas di analisi per formato (stessi canvas del render). */
export function fitCanvasSize(shape?: PosterShape): { width: number; height: number } {
  return shape === "landscape" ? { width: LAND_W, height: LAND_H } : { width: STD_W, height: STD_H }
}

/** Vincoli di layout logo per formato (identici a poster-service.ts). */
function logoLayoutOverrides(shape?: PosterShape): { align: "left" | "center"; maxWidthPct?: number; maxHeightPct?: number; bottomMarginPct?: number; topOffset?: number } {
  return shape === "landscape"
    ? { align: "left", maxWidthPct: 40, maxHeightPct: 24, bottomMarginPct: 25, topOffset: 55 }
    : { align: "center", maxHeightPct: PORTRAIT_LOGO_MAX_HEIGHT_PCT, topOffset: PORTRAIT_LOGO_TOP_OFFSET }
}

function analyzeLuma(rgb: RgbData): { mean: number; stdDev: number; edgeAvg: number; meanR: number; meanG: number; meanB: number } {
  const { data, width, height } = rgb
  const totalPixels = width * height
  if (totalPixels === 0) return { mean: 0, stdDev: 0, edgeAvg: 0, meanR: 0, meanG: 0, meanB: 0 }

  let sum = 0
  let rSum = 0, gSum = 0, bSum = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3
      sum += luma(data[idx], data[idx + 1], data[idx + 2])
      rSum += data[idx]
      gSum += data[idx + 1]
      bSum += data[idx + 2]
    }
  }
  const mean = sum / totalPixels
  const meanR = rSum / totalPixels
  const meanG = gSum / totalPixels
  const meanB = bSum / totalPixels

  let sqSum = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3
      const d = luma(data[idx], data[idx + 1], data[idx + 2]) - mean
      sqSum += d * d
    }
  }
  const stdDev = Math.sqrt(sqSum / totalPixels)

  let edgeSum = 0
  let edgeCount = 0
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const idx = (y * width + x) * 3
      const cur = luma(data[idx], data[idx + 1], data[idx + 2])
      const right = luma(data[idx + 3], data[idx + 4], data[idx + 5])
      const bottomIdx = ((y + 1) * width + x) * 3
      const bottom = luma(data[bottomIdx], data[bottomIdx + 1], data[bottomIdx + 2])
      edgeSum += Math.abs(cur - right) + Math.abs(cur - bottom)
      edgeCount += 2
    }
  }
  const edgeAvg = edgeCount > 0 ? edgeSum / edgeCount : 0

  return { mean, stdDev, edgeAvg, meanR, meanG, meanB }
}

interface LumaAnalysisGrid {
  mean: number
  stdDev: number
  edgeAvg: number
  meanR: number
  meanG: number
  meanB: number
  grid: number[][]
}

function analyzeLumaWithGrid(rgb: RgbData, gridStride = 4): LumaAnalysisGrid {
  const { data, width, height } = rgb
  const totalPixels = width * height
  if (totalPixels === 0) return { mean: 0, stdDev: 0, edgeAvg: 0, meanR: 0, meanG: 0, meanB: 0, grid: [] }

  let sum = 0
  let rSum = 0, gSum = 0, bSum = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3
      sum += luma(data[idx], data[idx + 1], data[idx + 2])
      rSum += data[idx]
      gSum += data[idx + 1]
      bSum += data[idx + 2]
    }
  }
  const mean = sum / totalPixels
  const meanR = rSum / totalPixels
  const meanG = gSum / totalPixels
  const meanB = bSum / totalPixels

  let sqSum = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3
      const d = luma(data[idx], data[idx + 1], data[idx + 2]) - mean
      sqSum += d * d
    }
  }
  const stdDev = Math.sqrt(sqSum / totalPixels)

  const cols = Math.ceil(width / gridStride)
  const rows = Math.ceil(height / gridStride)
  const grid: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0))
  let edgeSum = 0
  let edgeCount = 0

  for (let gy = 0; gy < height - 1; gy += gridStride) {
    for (let gx = 0; gx < width - 1; gx += gridStride) {
      let cellEdgeSum = 0
      let cellPixelCount = 0
      for (let dy = 0; dy < gridStride && gy + dy < height - 1; dy++) {
        for (let dx = 0; dx < gridStride && gx + dx < width - 1; dx++) {
          const idx = ((gy + dy) * width + (gx + dx)) * 3
          const cur = luma(data[idx], data[idx + 1], data[idx + 2])
          const right = luma(data[((gy + dy) * width + (gx + dx + 1)) * 3], data[((gy + dy) * width + (gx + dx + 1)) * 3 + 1], data[((gy + dy) * width + (gx + dx + 1)) * 3 + 2])
          const bottom = luma(data[((gy + dy + 1) * width + (gx + dx)) * 3], data[((gy + dy + 1) * width + (gx + dx)) * 3 + 1], data[((gy + dy + 1) * width + (gx + dx)) * 3 + 2])
          cellEdgeSum += Math.abs(cur - right) + Math.abs(cur - bottom)
          cellPixelCount++
        }
      }
      const cellIdxX = Math.floor(gx / gridStride)
      const cellIdxY = Math.floor(gy / gridStride)
      grid[cellIdxY][cellIdxX] = cellPixelCount > 0 ? cellEdgeSum / cellPixelCount : 0
      edgeSum += cellEdgeSum
      edgeCount += cellPixelCount * 2
    }
  }

  const edgeAvg = edgeCount > 0 ? edgeSum / edgeCount : 0

  return { mean, stdDev, edgeAvg, meanR, meanG, meanB, grid }
}

async function logoAvgLuma(logoBuffer: Buffer): Promise<number> {
  const { data, info } = await sharp(logoBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  let sum = 0
  let count = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const idx = (y * info.width + x) * 4
      if (data[idx + 3] > 32) {
        sum += luma(data[idx], data[idx + 1], data[idx + 2])
        count++
      }
    }
  }
  return count > 0 ? sum / count / 255 : 0.5
}

function computeInkContrast(
  posterRaw: RgbData,
  mask: { data: Buffer; width: number; height: number },
  maskLeft: number,
  maskTop: number,
): { inkContrast: number | null; poorFraction: number } {
  const mW = mask.width
  const mH = mask.height
  let sum = 0
  let count = 0
  let poor = 0
  for (let my = 0; my < mH; my++) {
    const py = maskTop + my
    if (py < 0 || py >= posterRaw.height) continue
    const rowBase = py * posterRaw.width
    for (let mx = 0; mx < mW; mx++) {
      const px = maskLeft + mx
      if (px < 0 || px >= posterRaw.width) continue
      const mi = (my * mW + mx) * 4
      const alpha = mask.data[mi + 3]
      if (alpha <= 32) continue
      const pi = (rowBase + px) * 3
      // Distanza percettiva pesata (0.30/0.59/0.11): cattura sia luminanza che
      // tonalità, a differenza della vecchia media "luma logo vs luma sfondo".
      // Scalata dall'alpha: i bordi antialiased contano meno.
      const dr = mask.data[mi] - posterRaw.data[pi]
      const dg = mask.data[mi + 1] - posterRaw.data[pi + 1]
      const db = mask.data[mi + 2] - posterRaw.data[pi + 2]
      const local = (alpha / 255) * Math.sqrt(0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db) / 255
      sum += local
      count++
      if (local < 0.15) poor++
    }
  }
  return { inkContrast: count > 0 ? sum / count : null, poorFraction: count > 0 ? poor / count : 0 }
}

/** Contrasto per una data posizione della mask (usata dalle varianti offset-Y:
 *  ricalcola il contrasto dove il logo atterrerebbe davvero invece di riusare
 *  quello della posizione base). */
function contrastForInk(
  posterRaw: RgbData,
  mask: { data: Buffer; width: number; height: number },
  maskLeft: number,
  maskTop: number,
  logoLuma: number,
  bgLumaAvg: number,
): number {
  const { inkContrast, poorFraction } = computeInkContrast(posterRaw, mask, maskLeft, maskTop)
  if (inkContrast !== null) {
    const c = clamp(inkContrast * 1.8, 0, 1)
    return poorFraction > 0.35 ? c * (1 - (poorFraction - 0.35) / 0.65) : c
  }
  return clamp(Math.abs(logoLuma - bgLumaAvg) * 1.8, 0, 1)
}

/** Rilevamento tonalità pelle basato su hue (spazio HSV): cattura la pelle a
 *  qualsiasi luminanza, incluse le carnagioni scure che la vecchia regola
 *  `lum > 90` escludeva. Banda rosso-arancio/giallo + rossi violacei. */
function isSkinTone(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const v = max / 255
  if (v < 0.15) return false
  const diff = max - min
  if (diff === 0) return false
  const s = diff / max
  if (s < 0.12) return false
  let h: number
  if (max === r) h = ((g - b) / diff) * 60
  else if (max === g) h = ((b - r) / diff) * 60 + 120
  else h = ((r - g) / diff) * 60 + 240
  if (h < 0) h += 360
  return h < 55 || h > 335
}

async function buildLogoFitContext(
  logoBuffer: Buffer,
  logoScale: number,
  logoOffsetX: number,
  logoOffsetY: number,
  hasBadges: boolean,
  shape?: PosterShape,
): Promise<LogoFitContext> {
  const logoMeta = await sharp(logoBuffer).metadata()
  const logoW = logoMeta.width ?? 100
  const logoH = logoMeta.height ?? 100
  const logoLuma = await logoAvgLuma(logoBuffer)
  const canvas = fitCanvasSize(shape)
  const baseLayout = computeLogoLayout({
    posterW: canvas.width,
    posterH: canvas.height,
    logoW,
    logoH,
    logoScale,
    logoOffsetX,
    logoOffsetY,
    hasBadges,
    ...logoLayoutOverrides(shape),
  })
  // Mask dell'inchiostro alla stessa risoluzione/posizione della composizione
  // reale (poster-service.ts usa fit:"inside" + centratura nel box).
  const boxW = baseLayout.width
  const boxH = baseLayout.height
  const { data: maskData, info: maskInfo } = await sharp(logoBuffer)
    .resize(Math.max(1, boxW), Math.max(1, boxH), { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const maskLeft = Math.round(baseLayout.left + (boxW - maskInfo.width) / 2)
  const maskTop = Math.round(baseLayout.top + (boxH - maskInfo.height) / 2)
  return {
    logoW,
    logoH,
    logoLuma,
    baseLayout,
    logoMask: { data: maskData, width: maskInfo.width, height: maskInfo.height },
    maskLeft,
    maskTop,
  }
}

export async function scorePosterLogoFit(input: PosterFitInput): Promise<PosterFitResult> {
  const { posterBuffer, logoBuffer, posterPath, logoScale, logoOffsetX, logoOffsetY, hasBadges, offsetYVariants, shape, context } = input
  const ctx = context ?? await buildLogoFitContext(logoBuffer, logoScale, logoOffsetX, logoOffsetY, hasBadges, shape)
  const { logoW, logoH, logoLuma, baseLayout, logoMask, maskLeft, maskTop } = ctx
  const canvas = fitCanvasSize(shape)

  // Decode-once: raw RGB alle dimensioni canvas riusato da tutte le analisi (safety,
  // pelle, badge, varianti) via slice in JS — niente ri-decode sharp per regione.
  const posterRaw = await decodePosterRaw(posterBuffer, canvas.width, canvas.height)

  const padding = 24
  const analysisBox = {
    left: baseLayout.left - padding,
    top: baseLayout.top - padding,
    width: baseLayout.width + padding * 2,
    height: baseLayout.height + padding * 2,
  }

  const safetyArea = sliceRgb(posterRaw, analysisBox.left, analysisBox.top, analysisBox.width, analysisBox.height)

  let cleanliness = 0.5
  let contrast = 0.5
  let lowDetailScore = 0.5
  let badgeReadability = 0.5
  const reasons: string[] = []

  if (safetyArea) {
    const analysis = analyzeLumaWithGrid(safetyArea, 4)
    cleanliness = 1 - clamp(analysis.stdDev / 80, 0, 1)
    lowDetailScore = 1 - clamp(analysis.edgeAvg / 60, 0, 1)

    // Edge grid hotspot check: penalize if logo covers high-detail regions
    if (analysis.grid.length > 0) {
      const cellSize = 4
      const logoStartCol = Math.floor(Math.max(0, baseLayout.left - analysisBox.left) / cellSize)
      const logoStartRow = Math.floor(Math.max(0, baseLayout.top - analysisBox.top) / cellSize)
      const logoCols = Math.ceil(baseLayout.width / cellSize)
      const logoRows = Math.ceil(baseLayout.height / cellSize)

      let hotspotScore = 0
      let hotspotCount = 0
      for (let r = logoStartRow; r < logoStartRow + logoRows; r++) {
        for (let c = logoStartCol; c < logoStartCol + logoCols; c++) {
          if (r >= 0 && r < analysis.grid.length && c >= 0 && c < analysis.grid[0].length) {
            hotspotScore += analysis.grid[r][c]
            hotspotCount++
          }
        }
      }
      const avgHotspot = hotspotCount > 0 ? hotspotScore / hotspotCount : 0
      if (avgHotspot > 30) {
        lowDetailScore *= (1 - (avgHotspot - 30) / 120)
        reasons.push("Dettagli nell'area logo")
      }
    }

    const bgLumaAvg = analysis.mean / 255

    // Contrasto per-pixel dove c'è davvero l'inchiostro del logo (alpha map):
    // per i wordmark con molto trasparente la media "logo intero vs sfondo"
    // diluisce il contrasto, e un logo bicolore a luma medio avrebbe contrasto
    // quasi nullo anche se ogni parte è leggibile. Fallback sulla media solo
    // se il logo è quasi trasparente.
    const { inkContrast, poorFraction } = computeInkContrast(posterRaw, logoMask, maskLeft, maskTop)
    if (inkContrast !== null) {
      contrast = clamp(inkContrast * 1.8, 0, 1)
      // Worst-case: parte dell'inchiostro su zone di sfondo simili.
      if (poorFraction > 0.35) {
        contrast *= 1 - (poorFraction - 0.35) / 0.65
        reasons.push("Parte del logo su sfondo simile")
        if (poorFraction > 0.7) reasons.push("Colore logo simile allo sfondo")
      }
    } else {
      contrast = clamp(Math.abs(logoLuma - bgLumaAvg) * 1.8, 0, 1)
    }

    if (contrast > 0.55) reasons.push("Buon contrasto logo/sfondo")
    else if (contrast < 0.25) reasons.push("Scarso contrasto logo/sfondo")

    if (cleanliness > 0.75) reasons.push("Zona logo pulita")
    else if (cleanliness < 0.4) reasons.push("Zona logo caotica")

    if (lowDetailScore < 0.45) reasons.push("Molti dettagli dietro il logo")
    else if (lowDetailScore > 0.8) reasons.push("Zona logo senza distrazioni")
  } else {
    reasons.push("Zona logo non disponibile")
  }

  // Gradient smoothness: compare top/bottom half of safety area
  if (safetyArea && safetyArea.height >= 4) {
    const halfH = Math.floor(safetyArea.height / 2)
    const topHalfRgb = { data: safetyArea.data.subarray(0, halfH * safetyArea.width * 3), width: safetyArea.width, height: halfH }
    const bottomHalfRgb = { data: safetyArea.data.subarray(halfH * safetyArea.width * 3), width: safetyArea.width, height: safetyArea.height - halfH }
    const topL = analyzeLuma(topHalfRgb)
    const botL = analyzeLuma(bottomHalfRgb)
    const meanDiff = Math.abs(topL.mean - botL.mean)
    const gradientSmooth = 1 - clamp(meanDiff / 80, 0, 1)
    if (gradientSmooth < 0.3) {
      cleanliness *= 0.9
      reasons.push("Gradiente brusco nella zona logo")
    }
  }

  // Skin-tone detection in bottom 30%
  if (safetyArea) {
    const skinZoneTop = Math.round(canvas.height * 0.65)
    const skinZoneH = canvas.height - skinZoneTop
    if (skinZoneH > 0) {
      const skinData = sliceRgb(posterRaw, 0, skinZoneTop, canvas.width, skinZoneH)
      if (skinData) {
        let skinPixelCount = 0
        let skinZonePixels = 0
        for (let i = 0; i < skinData.data.length; i += 3) {
          skinZonePixels++
          const r = skinData.data[i]
          const g = skinData.data[i + 1]
          const b = skinData.data[i + 2]
          if (isSkinTone(r, g, b)) {
            skinPixelCount++
          }
        }
        const skinRatio = skinZonePixels > 0 ? skinPixelCount / skinZonePixels : 0
        if (skinRatio > 0.08) {
          const logoBottom = baseLayout.top + baseLayout.height
          const logoTop = baseLayout.top
          const overlapTop = Math.max(logoTop, skinZoneTop)
          const overlapBottom = Math.min(logoBottom, canvas.height)
          const overlapH = Math.max(0, overlapBottom - overlapTop)
          if (overlapH > 0) {
            const overlapRatio = overlapH / skinZoneH
            const skinPenalty = overlapRatio * skinRatio * 2
            cleanliness = clamp(cleanliness - skinPenalty, 0, 1)
            reasons.push("Pelle/volto nella zona logo")
          }
        }
      }
    }
  }

  if (hasBadges) {
    const badgeTop = Math.round(canvas.height * 0.82)
    const badgeHeight = Math.round(canvas.height * 0.16)
    if (badgeHeight > 0) {
      const badgeArea = sliceRgb(posterRaw, 0, badgeTop, canvas.width, badgeHeight)
      if (badgeArea) {
        const badgeAnalysis = analyzeLuma(badgeArea)
        badgeReadability = 1 - clamp(badgeAnalysis.stdDev / 90, 0, 1)
        if (badgeReadability < 0.45) reasons.push("Zona badge caotica")
      }
    }
  }

  // When contrast is poor, penalize the overall score multiplicatively
  const contrastMultiplier = Math.min(1, contrast * 2.5 + 0.25)
  let score = clamp(
    (cleanliness * 0.35 +
    contrast * 0.30 +
    lowDetailScore * 0.25 +
    badgeReadability * 0.10) * contrastMultiplier,
    0, 1,
  )

  if (contrast < 0.35) {
    score = Math.min(score, 0.55)
  }

  // OffsetY variants robustness bonus
  const variants = offsetYVariants ?? [0]
  if (variants.length > 1 && safetyArea) {
    let worstCaseScore = 1
    for (const oyVariant of variants) {
      if (oyVariant === logoOffsetY) continue
      const variantLayout = computeLogoLayout({
        posterW: canvas.width, posterH: canvas.height, logoW, logoH,
        logoScale, logoOffsetX, logoOffsetY: oyVariant,
        hasBadges,
        ...logoLayoutOverrides(shape),
      })
      const variantBox = {
        left: variantLayout.left - padding,
        top: variantLayout.top - padding,
        width: variantLayout.width + padding * 2,
        height: variantLayout.height + padding * 2,
      }
      const variantSafety = sliceRgb(posterRaw, variantBox.left, variantBox.top, variantBox.width, variantBox.height)
      if (variantSafety) {
        const vAnalysis = analyzeLumaWithGrid(variantSafety, 4)
        const vCleanliness = 1 - clamp(vAnalysis.stdDev / 80, 0, 1)
        const vLowDetail = 1 - clamp(vAnalysis.edgeAvg / 60, 0, 1)
        // Contrasto ricalcolato nella posizione della variante: la mask si
        // sposta con la layout, e un +20px può portare il logo su uno sfondo
        // molto diverso.
        const vMaskLeft = maskLeft + (variantLayout.left - baseLayout.left)
        const vMaskTop = maskTop + (variantLayout.top - baseLayout.top)
        const vContrast = contrastForInk(posterRaw, logoMask, vMaskLeft, vMaskTop, logoLuma, vAnalysis.mean / 255)
        const vContrastMultiplier = Math.min(1, vContrast * 2.5 + 0.25)
        const vScore = (vCleanliness * 0.35 + vContrast * 0.30 + vLowDetail * 0.25) * vContrastMultiplier
        worstCaseScore = Math.min(worstCaseScore, vScore)
      }
    }
    score = clamp(score * 0.7 + worstCaseScore * 0.3, 0, 1)
  }

  return {
    posterPath,
    score,
    metrics: { cleanliness, contrast, detailPenalty: 1 - lowDetailScore, badgeReadability },
    reasons,
    posterRaw,
    logoZone: { left: baseLayout.left, top: baseLayout.top, width: baseLayout.width, height: baseLayout.height },
  }
}

export async function rankPostersByFit(
  posters: { posterPath: string; posterBuffer: Buffer }[],
  logoBuffer: Buffer,
  logoScale: number,
  logoOffsetX: number,
  logoOffsetY: number,
  hasBadges: boolean,
  offsetYVariants?: number[],
  shape?: PosterShape,
): Promise<PosterFitResult[]> {
  const context = await buildLogoFitContext(logoBuffer, logoScale, logoOffsetX, logoOffsetY, hasBadges, shape)

  const results = await Promise.all(
    posters.map((p) =>
      scorePosterLogoFit({
        posterBuffer: p.posterBuffer,
        logoBuffer,
        posterPath: p.posterPath,
        logoScale,
        logoOffsetX,
        logoOffsetY,
        hasBadges,
        offsetYVariants,
        shape,
        context,
      }).catch((err: Error) => {
        log.warn(`Score failed for ${p.posterPath}`, { error: err.message })
        return null
      }),
    ),
  )
  return results
    .filter((r): r is PosterFitResult => r !== null)
    .sort((a, b) => b.score - a.score)
}