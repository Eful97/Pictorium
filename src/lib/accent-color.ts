import { GENRE_FALLBACK } from "./badges"
import { TOP_LIGHT_LUMINANCE } from "./constants"

export interface AccentResult { r: number; g: number; b: number }

/** sRGB linearization per componente [0,255] → [0,1] */
function linearize(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** Luminanza relativa sRGB (WCAG) */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** Rapporto di contrasto WCAG tra due luminanze */
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Sceglie il colore testo con miglior contrasto WCAG.
 * Valuta colore chiaro (`dark`) e scuro (`light`) contro lo sfondo.
 */
export function textColorForBg(hex: string, dark: string = "#ffffff", light: string = "rgba(0,0,0,0.80)"): string {
  if (!hex || hex === "#555555") return light
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)

  const bgLum = relativeLuminance(r, g, b)

  const best = [dark, light]
    .map((textColor) => {
      const [tr, tg, tb, ta] = parseColor(textColor)
      const effectiveR = ta < 1 ? Math.round(tr * ta + r * (1 - ta)) : tr
      const effectiveG = ta < 1 ? Math.round(tg * ta + g * (1 - ta)) : tg
      const effectiveB = ta < 1 ? Math.round(tb * ta + b * (1 - ta)) : tb
      const textLum = relativeLuminance(effectiveR, effectiveG, effectiveB)
      return { color: textColor, ratio: contrastRatio(textLum, bgLum) }
    })
    .sort((a, b) => b.ratio - a.ratio)[0]

  return best.color
}

/**
 * True se l'hex è un giallo/ambra/arancio saturo che uccide la stella oro del
 * badge (gradiente #FCD34D → #F59E0B, hue ~40°): in quel caso la stella va
 * resa nel colore del testo invece che in oro. Zona hue [20, 70] con
 * saturazione HSL > 0.35 — sotto soglia (freddi, grigi, pastelli spenti)
 * l'oro resta.
 */
export function isWarmGoldAccent(hex: string | null | undefined): boolean {
  if (!hex || !hex.startsWith("#")) return false
  const [r, g, b] = parseColor(hex)
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2, d = max - min
  if (d === 0) return false
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  if (s < 0.35) return false
  const hue = fastHue(rn, gn, bn, d, max)
  return hue >= 20 && hue <= 70
}

/** Parsea "#rrggbb" o "rgba(r,g,b,a)" restituendo [r,g,b,alpha]. Hex: alpha=1 */
function parseColor(color: string): [number, number, number, number] {
  if (color.startsWith("#")) {
    const hex = color.slice(1)
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
        1,
      ]
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      1,
    ]
  }
  const match = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/)
  if (match) {
    return [
      parseInt(match[1]),
      parseInt(match[2]),
      parseInt(match[3]),
      match[4] !== undefined ? parseFloat(match[4]) : 1,
    ]
  }
  return [0, 0, 0, 1]
}

/** Approssimazione hue veloce da RGB normalizzati [0,1], risultato [0, 360) */
function fastHue(r: number, g: number, b: number, d: number, max: number): number {
  if (d === 0) return 0
  let h: number
  if (max === r) h = 60 * ((g - b) / d)
  else if (max === g) h = 60 * (2 + (b - r) / d)
  else h = 60 * (4 + (r - g) / d)
  return h < 0 ? h + 360 : h
}

/** Convert HSL to RGB (H: 0-360, S: 0-1, L: 0-1) */
function hslToRgb(H: number, S: number, L: number): AccentResult {
  const c = (1 - Math.abs(2 * L - 1)) * S
  const x = c * (1 - Math.abs((H / 60) % 2 - 1))
  const m = L - c / 2
  let r1 = 0, g1 = 0, b1 = 0
  if (H < 60) { r1 = c; g1 = x }
  else if (H < 120) { r1 = x; g1 = c }
  else if (H < 180) { r1 = 0; g1 = c; b1 = x }
  else if (H < 240) { r1 = 0; g1 = x; b1 = c }
  else if (H < 300) { r1 = x; g1 = 0; b1 = c }
  else { r1 = c; g1 = 0; b1 = x }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

export interface BucketAnalysis {
  readonly hue: number
  readonly avgSat: number
  readonly vibrantWeight: number
  readonly bgRelLum: number
  readonly avgR: number
  readonly avgG: number
  readonly avgB: number
  readonly countLuma: number
}

export function analyzeBuckets(
  pixels: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  tintMode: "badge" | "scene" = "badge",
): BucketAnalysis {
  const step = 2
  let sumR = 0, sumG = 0, sumB = 0, countLuma = 0

  // 12 hue buckets (30° each)
  const buckets = Array.from({ length: 12 }, () => ({
    count: 0,
    totalSat: 0,
    hueSin: 0,
    hueCos: 0,
  }))
  let totalVibrantWeight = 0

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      // Modalità scena: campiona SOLO la cornice esterna (stile Ambilight).
      // Facce/loghi/titoli stanno al centro e hijackerebbero il voto (pelle
      // arancione su Silo); i bordi vedono quasi sempre lo sfondo/atmosfera.
      if (tintMode === "scene") {
        const bx = Math.max(8, Math.floor(width * 0.15))
        const by = Math.max(8, Math.floor(height * 0.15))
        if (x >= bx && x < width - bx && y >= by && y < height - by) continue
      }
      const i = (y * width + x) * 4
      const pr = pixels[i], pg = pixels[i + 1], pb = pixels[i + 2]
      const alpha = pixels[i + 3]
      if (alpha < 128) continue

      sumR += pr; sumG += pg; sumB += pb
      countLuma++

      const r = pr / 255, g = pg / 255, b = pb / 255
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const l = (max + min) / 2, d = max - min
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (s < 0.12 || l < 0.08 || l > 0.94) continue

      const hue = fastHue(r, g, b, d, max)
      const bucketIdx = Math.floor(hue / 30) % 12
      const bkt = buckets[bucketIdx]
      // Badge: penalità per scuro/chiaro (serve contrasto per il testo).
      // Scena: vince l'area satura e SCURA (lo scrim vive nel fondo scuro;
      // pelli e cieli chiari non devono hijackare la tinta).
      const weight = tintMode === "scene"
        ? Math.pow(s, 1.5) * (1 - l)
        : Math.pow(s, 1.5) * (1 - Math.abs(l - 0.5) * 1.5)
      bkt.count += weight
      bkt.totalSat += s * weight
      bkt.hueSin += Math.sin(hue * Math.PI / 180) * weight
      bkt.hueCos += Math.cos(hue * Math.PI / 180) * weight
      totalVibrantWeight += weight
    }
  }

  // Compute background relative luminance (WCAG) from average RGB
  const avgR = countLuma > 0 ? sumR / countLuma : 128
  const avgG = countLuma > 0 ? sumG / countLuma : 128
  const avgB = countLuma > 0 ? sumB / countLuma : 128
  const bgRelLum = relativeLuminance(avgR, avgG, avgB)

  if (totalVibrantWeight < 1) {
    return {
      hue: 0,
      avgSat: 0,
      vibrantWeight: totalVibrantWeight,
      bgRelLum,
      avgR,
      avgG,
      avgB,
      countLuma,
    }
  }

  // Find most vibrant hue bucket
  let bestBucket = buckets[0]
  for (const bkt of buckets) {
    if (bkt.count > bestBucket.count) bestBucket = bkt
  }

  // Dominant hue of the poster
  const posterHue = ((Math.atan2(bestBucket.hueSin, bestBucket.hueCos) * 180 / Math.PI) % 360 + 360) % 360
  const avgSat = bestBucket.count > 0 ? bestBucket.totalSat / bestBucket.count : 0

  return {
    hue: posterHue,
    avgSat,
    vibrantWeight: totalVibrantWeight,
    bgRelLum,
    avgR,
    avgG,
    avgB,
    countLuma,
  }
}

export function findAccentColor(pixels: Uint8ClampedArray | Buffer, width: number, height: number, genre: string): AccentResult {
  const analysis = analyzeBuckets(pixels, width, height)

  // Fallback for monochrome/flat posters → genre palette color, contrast-adjusted
  if (analysis.vibrantWeight < 1) {
    const fb = GENRE_FALLBACK[genre] || '#C0C0C0'
    const cr = parseInt(fb.slice(1, 3), 16)
    const cg = parseInt(fb.slice(3, 5), 16)
    const cb = parseInt(fb.slice(5, 7), 16)
    const avgRawLum = analysis.countLuma > 0
      ? (0.2126 * analysis.avgR + 0.7152 * analysis.avgG + 0.0722 * analysis.avgB) / 255
      : 0.5
    return pushContrast({ r: cr, g: cg, b: cb }, avgRawLum)
  }

  const { hue: posterHue, avgSat, bgRelLum } = analysis

  // --- Split-Complementary Harmony (+150°) ---
  // Rotating by 150° gives a badge color that is:
  //   - Harmonious with the poster by color theory
  //   - Naturally contrasting (not the same hue family as the bg)
  // Examples:
  //   Blue-violet (251°) → 251+150 = 41° → warm orange  🟠
  //   Orange-sandy (35°) → 35+150  = 185° → cool cyan   🩵
  //   Green (120°)       → 120+150 = 270° → violet      🟣
  //   Red (0°)           → 0+150   = 150° → teal        🩵
  //   Cyan (180°)        → 180+150 = 330° → pink-rose   🌸
  const badgeHue = (posterHue + 150) % 360

  // Higher saturation since we're using a contrasting hue (not blending, but popping)
  const badgeSat = Math.min(0.82, Math.max(0.55, avgSat))

  // Lightness strategy:
  //   Dark poster  (bgRelLum < 0.18)  → very light badge (L=0.88) → cream/pastel tones
  //                                      Contrast on these dark bgs is always >8:1 at L=0.88
  //   Mid/light poster (bgRelLum ≥ 0.18) → binary-search for a darker badge that passes 3:1
  const targetL = bgRelLum < 0.18
    ? 0.88
    : findContrastingLightness(badgeHue, badgeSat, bgRelLum, 3.0)

  const result = hslToRgb(badgeHue, badgeSat, targetL)
  result.r = Math.max(0, Math.min(255, result.r))
  result.g = Math.max(0, Math.min(255, result.g))
  result.b = Math.max(0, Math.min(255, result.b))
  return result
}

/**
 * Calcola la tinta di scena naturale (same-hue) per la sfocatura di fondo.
 *
 * A differenza di findAccentColor:
 * - NESSUNA rotazione a +150°: preserva la famiglia cromatica della scena.
 * - Saturazione preservata in [0.30, 0.80]: scene sature (ori, teal) restano
 *   sature invece di schiacciarsi a oliva spento; scene piatte restano sobrie.
 * - Luminosità L = 0.26: tinta profonda ma luminosa come gli scrim di riferimento.
 * - NESSUNA ricerca dicotomica di contrasto: deve fondersi armoniosamente con l'immagine.
 * - Fallback monocromatico: GENRE_FALLBACK puro senza pushContrast.
 */
export function findSceneTint(
  pixels: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  genre: string,
): AccentResult {
  const analysis = analyzeBuckets(pixels, width, height, "scene")
  if (analysis.vibrantWeight < 1) {
    const fb = GENRE_FALLBACK[genre] || "#555555"
    const [r, g, b] = parseColor(fb)
    return { r, g, b }
  }

  // Same-hue: estrazione diretta della famiglia cromatica nativa della scena.
  // L medio-scuro (0.26): la tinta di scrim/badge nasce profonda ma luminosa
  // (riferimento concorrenza ~#7f5401 per Pluribus); lo shade del blur la
  // porta poi a fondo campo quando la velatura è attiva.
  const sat = Math.min(0.80, Math.max(0.30, analysis.avgSat))
  const res = hslToRgb(analysis.hue, sat, 0.26)
  return {
    r: Math.max(0, Math.min(255, res.r)),
    g: Math.max(0, Math.min(255, res.g)),
    b: Math.max(0, Math.min(255, res.b)),
  }
}

/**
 * Binary-search for the HSL lightness value that achieves the target WCAG
 * contrast ratio against bgRelLum, while staying in a visually pleasant range.
 * - Dark background (bgRelLum < 0.18) → we search for a lighter badge color
 * - Light background (bgRelLum ≥ 0.18) → we search for a darker badge color
 */
function findContrastingLightness(H: number, S: number, bgRelLum: number, targetContrast: number): number {
  const wantLight = bgRelLum < 0.18

  let lo = wantLight ? 0.45 : 0.05
  let hi = wantLight ? 0.95 : 0.50
  let bestL = wantLight ? 0.80 : 0.30

  for (let iter = 0; iter < 18; iter++) {
    const mid = (lo + hi) / 2
    const rgb = hslToRgb(H, S, mid)
    const lum = relativeLuminance(rgb.r, rgb.g, rgb.b)
    const contrast = contrastRatio(lum, bgRelLum)

    if (contrast >= targetContrast) {
      bestL = mid
      // Achieved contrast — try a less extreme value for elegance
      if (wantLight) hi = mid
      else lo = mid
    } else {
      // Need more contrast — push more extreme
      if (wantLight) lo = mid
      else hi = mid
    }
  }

  // Guard: stay off pure white/black
  return Math.max(0.18, Math.min(0.92, bestL))
}

/**
 * Spinge la luminanza del colore nella direzione opposta allo sfondo,
 * in modo che il badge sia ben visibile (fallback per poster monocromatici).
 */
function pushContrast(color: AccentResult, bgLum: number): AccentResult {
  let { r, g, b } = color
  const currentLum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

  // Transizione fluida: da bgLum 0.5 nessuna spinta, a bgLum 0.0/1.0 spinta massima
  const contrastNeeded = (bgLum - 0.5) * 2  // -1 (scuro) a +1 (chiaro)
  const rawTarget = 0.53 - contrastNeeded * 0.35  // 0.88 (sfondo scuro) a 0.18 (sfondo chiaro)
  const targetLum = Math.max(0.15, Math.min(0.88, rawTarget))

  const diff = targetLum - currentLum
  if (Math.abs(diff) < 0.02) return { r, g, b }  // già vicino al target

  const pushStrength = 0.65
  const blendedLum = currentLum + diff * pushStrength
  const scale = Math.max(0.15, Math.min(
    blendedLum / Math.max(currentLum, 0.001),
    255 / Math.max(r, g, b, 1),
  ))

  r = Math.min(255, Math.max(0, Math.round(r * scale)))
  g = Math.min(255, Math.max(0, Math.round(g * scale)))
  b = Math.min(255, Math.max(0, Math.round(b * scale)))

  return { r, g, b }
}

export function topEdgeAverage(pixels: Uint8ClampedArray | Buffer, width: number, height: number): { r: number; g: number; b: number } {
  const rowCount = Math.max(Math.round(height * 0.08), 3)
  let r = 0, g = 0, b = 0, n = 0
  for (let y = 0; y < rowCount; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]
      n++
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
}

/** Media del bordo inferiore (ultimo 8% delle righe): speculare a topEdgeAverage. */
export function bottomEdgeAverage(pixels: Uint8ClampedArray | Buffer, width: number, height: number): { r: number; g: number; b: number } {
  const rowCount = Math.max(Math.round(height * 0.08), 3)
  let r = 0, g = 0, b = 0, n = 0
  for (let y = height - rowCount; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]
      n++
    }
  }
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
}

/**
 * Luminanza Rec.709 di un hex "#rrggbb", null se assente/malformato.
 * Stessi coefficienti di computeTopLight (poster-url.ts) e soglia condivisa
 * TOP_LIGHT_LUMINANCE: il client deve accordarsi col server.
 */
export function hexLuminance(hexColor: string | null | undefined): number | null {
  if (!hexColor || hexColor.length < 7) return null
  const r = parseInt(hexColor.slice(1, 3), 16) / 255
  const g = parseInt(hexColor.slice(3, 5), 16) / 255
  const b = parseInt(hexColor.slice(5, 7), 16) / 255
  if (![r, g, b].every(Number.isFinite)) return null
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Polarità del badge inferiore (true = fondo chiaro → pill scura).
 * Come topLight ma corretta per la banda blur: la banda scurisce il fondo in
 * proporzione a blurDarkness, quindi una striscia chiara con blur intenso conta
 * come scura. Approssimazione documentata: la banda è un blend non uniforme,
 * qui modellato come velo nero uniforme (stima conservativa: preferisce la
 * pill chiara, sempre leggibile sullo scuro).
 */
export function computeBottomLight(lum: number | null, blurDarkness: number, blurEnabled: boolean): boolean | null {
  if (lum === null || !Number.isFinite(lum)) return null
  const d = Math.max(0, Math.min(100, blurDarkness)) / 100
  const effective = blurEnabled ? lum * (1 - d) : lum
  return effective > TOP_LIGHT_LUMINANCE
}

/**
 * Vero solo quando l'utente ha scelto un colore diverso da quello
 * auto-rilevato: l'auto-rilevamento scrive lo stesso valore in entrambi gli
 * stati a ogni cambio poster, quindi un `ac=` emesso sempre scavalcerebbe il
 * calcolo server anche quando l'utente non ha toccato nulla (preview e
 * mapping salvato congelerebbero il thumb client invece della tinta di scena).
 */
export function isManualAccent(
  accentColor: string | null | undefined,
  autoAccentColor: string | null | undefined,
): boolean {
  if (!accentColor) return false
  if (!autoAccentColor) return true
  return accentColor.toLowerCase() !== autoAccentColor.toLowerCase()
}
