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

/** Minimum effective contrast for the preferred light text on flat
 * colored badges: an explicit VISUAL preference requested by the user
 * (more light text on mid-tone fills), NOT a WCAG readability or
 * compliance claim — 2:1 is below every WCAG threshold, including the
 * 3:1 large-text one. Near-white fills (golds, yellows, pastels) still
 * fall back to dark text via the max-contrast rule below. */
export const COLORED_BADGE_LIGHT_TEXT_MIN_CONTRAST = 2

/**
 * Picks the text color for a flat accent background (colored genre,
 * ranking, extra and corner badges, Netflix ribbon tint, style swatches).
 * Prefers the light-text candidate (`dark`, default white — legacy param
 * name: the text color meant for dark backgrounds) while its effective
 * contrast stays >= COLORED_BADGE_LIGHT_TEXT_MIN_CONTRAST (a visual
 * preference for light text on colored fills, not a WCAG claim);
 * on lighter backgrounds where it would wash out, falls back to the
 * highest-contrast candidate (previous behavior).
 * This is a readability preference, not a max-contrast claim: e.g. on
 * #E67E22 white is preferred at ~2.9:1 over dark text at ~5.9:1, while on
 * yellow/gold/near-white fills (white below 2:1) the dark candidate wins
 * and stays fully legible.
 * Param order and semantics are unchanged: the first candidate is always
 * the preferred one when readable, whichever custom colors callers pass.
 * Effective (alpha-blended on the background) contrast decides, never the
 * raw candidate values. Empty `hex` (unresolved accent) keeps the
 * historical `light` fallback. The former `#555555` special case is gone:
 * that gray is measured like any real background (white text at ~7.5:1).
 * Background, tint and shadow treatment are untouched.
 */
export function textColorForBg(hex: string, dark: string = "#ffffff", light: string = "rgba(0,0,0,0.80)"): string {
  if (!hex) return light
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)

  const bgLum = relativeLuminance(r, g, b)

  const scored = [dark, light]
    .map((textColor) => {
      const [tr, tg, tb, ta] = parseColor(textColor)
      const effectiveR = ta < 1 ? Math.round(tr * ta + r * (1 - ta)) : tr
      const effectiveG = ta < 1 ? Math.round(tg * ta + g * (1 - ta)) : tg
      const effectiveB = ta < 1 ? Math.round(tb * ta + b * (1 - ta)) : tb
      const textLum = relativeLuminance(effectiveR, effectiveG, effectiveB)
      return { color: textColor, ratio: contrastRatio(textLum, bgLum) }
    })

  if (scored[0].ratio >= COLORED_BADGE_LIGHT_TEXT_MIN_CONTRAST) return scored[0].color
  return scored[0].ratio >= scored[1].ratio ? scored[0].color : scored[1].color
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

/** Convert RGB [0,255] to HSL (H: 0-360, S: 0-1, L: 0-1), inverse of hslToRgb. */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2, d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

/**
 * Fixed lightness of the AUTOMATIC badge accent: 100/240 of the Windows
 * dialog = 5/12 HSL (~0.4167), hue-independent. Hue and saturation of the
 * detected tint stay intact; only L is brought back to the target. MANUAL
 * overrides (`ac=`, `accentOverride`) never pass through here: they stay
 * byte-identical.
 */
export const AUTO_BADGE_ACCENT_LIGHTNESS = 5 / 12

/**
 * Normalize an automatic accent to 5/12 HSL lightness, preserving hue and
 * saturation (pure: no I/O, no genre fallback). Achromatic grays (s = 0)
 * become neutral gray at L = 5/12 (#6a6a6a).
 */
export function normalizeAutomaticAccent(color: AccentResult): AccentResult {
  const { h, s } = rgbToHsl(color.r, color.g, color.b)
  const hue = ((h % 360) + 360) % 360
  const out = hslToRgb(hue, s, AUTO_BADGE_ACCENT_LIGHTNESS)
  return {
    r: Math.max(0, Math.min(255, out.r)),
    g: Math.max(0, Math.min(255, out.g)),
    b: Math.max(0, Math.min(255, out.b)),
  }
}

/**
 * Hex variant of normalizeAutomaticAccent for paths working in "#rrggbb"
 * (sceneTintHex, genre fallback). Non-hex or malformed input = returned
 * intact (never an invented color).
 */
export function normalizeAutomaticAccentHex(hex: string): string {
  if (typeof hex !== "string" || !hex.startsWith("#")) return hex
  const [r, g, b, a] = parseColor(hex)
  if (a !== 1 || ![r, g, b].every(Number.isFinite)) return hex
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  const out = normalizeAutomaticAccent({ r, g, b })
  const to2 = (n: number) => n.toString(16).padStart(2, "0")
  return `#${to2(out.r)}${to2(out.g)}${to2(out.b)}`
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

/**
 * Contrast-derived bounds for the UNUSED adaptive automatic-accent solver
 * below (foundation only: nothing calls it yet, so no rendered output
 * changes). The user chose readability (4.5:1 normal-text bar) over the
 * audit's 3:1 large-text proposal; hue and saturation are always preserved.
 */
export const AUTO_BADGE_ACCENT_L_MIN = 0.24
export const AUTO_BADGE_ACCENT_L_MAX = 0.6
export const AUTO_BADGE_ACCENT_TEXT_CONTRAST = 4.5
export const AUTO_BADGE_ACCENT_SEPARATION = 3
export const AUTO_BADGE_ACCENT_L_STEP = 0.01

/** Optional local badge-background context (WCAG linear luminance 0..1). */
export interface AdaptiveAccentOptions {
  readonly backgroundLuminance?: number | null
}

/** Diagnostics for the chosen adaptive candidate (see solveAdaptiveAccent). */
export interface AdaptiveAccentDiagnostics {
  /** Chosen lightness (HSL, exact value passed to hslToRgb). */
  readonly l: number
  /** Legacy anchor (AUTO_BADGE_ACCENT_LIGHTNESS), kept for stability. */
  readonly anchorL: number
  /** Renderer text choice for the chosen fill (textColorForBg rule). */
  readonly textColor: string
  /** Effective contrast of textColor on the chosen 8-bit fill. */
  readonly textContrast: number
  /** Contrast of the chosen fill vs backgroundLuminance (null without context). */
  readonly separation: number | null
  /** True when some bounded candidate reaches the 4.5 text target. */
  readonly feasibleText: boolean
  /** True when some text-safe candidate also reaches the 3:1 separation target. */
  readonly feasibleSeparation: boolean
  /** Number of bounded candidates evaluated (constant CPU cap). */
  readonly evaluations: number
}

/** Effective text choice for an 8-bit fill, replicating textColorForBg. */
function chosenTextForFill(r: number, g: number, b: number): { color: string; ratio: number } {
  const bgLum = relativeLuminance(r, g, b)
  const whiteLum = relativeLuminance(255, 255, 255)
  const whiteRatio = contrastRatio(whiteLum, bgLum)
  if (whiteRatio >= COLORED_BADGE_LIGHT_TEXT_MIN_CONTRAST) {
    return { color: "#ffffff", ratio: whiteRatio }
  }
  const er = Math.round(r * 0.2)
  const eg = Math.round(g * 0.2)
  const eb = Math.round(b * 0.2)
  const darkLum = relativeLuminance(er, eg, eb)
  const darkRatio = contrastRatio(darkLum, bgLum)
  return whiteRatio >= darkRatio
    ? { color: "#ffffff", ratio: whiteRatio }
    : { color: "rgba(0,0,0,0.80)", ratio: darkRatio }
}

function clampChannel(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(255, Math.round(v)))
}

function clampLum(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

/**
 * Pure adaptive automatic accent (FOUNDATION ONLY — not wired into any
 * normalizer, caller, render path or UI). Preserves hue/saturation and
 * searches a bounded deterministic L grid for the candidate closest to the
 * legacy anchor whose ACTUAL renderer text choice (textColorForBg rule,
 * measured on the final 8-bit fill) reaches 4.5:1. With an optional local
 * background luminance, separation (>= 3:1) is a second priority among
 * text-safe candidates; when both are unreachable, text stays first and
 * separation is maximized, then the smallest anchor move wins. When no
 * bounded candidate reaches 4.5, the deterministic best-text-contrast
 * candidate is returned with feasibleText=false (no guarantee is pretended).
 * No I/O, no randomness, no time/date/locale, no mutable external state.
 */
export function solveAdaptiveAccent(
  color: AccentResult,
  options?: AdaptiveAccentOptions,
): { color: AccentResult; diagnostics: AdaptiveAccentDiagnostics } {
  const cr = clampChannel(color.r)
  const cg = clampChannel(color.g)
  const cb = clampChannel(color.b)
  const { h, s } = rgbToHsl(cr, cg, cb)
  const hue = ((h % 360) + 360) % 360
  const sat = Math.max(0, Math.min(1, s))
  const anchorL = AUTO_BADGE_ACCENT_LIGHTNESS
  const rawBg = options?.backgroundLuminance
  const bgLum = rawBg === undefined || rawBg === null || !Number.isFinite(rawBg)
    ? null
    : clampLum(rawBg)

  const steps = Math.round((AUTO_BADGE_ACCENT_L_MAX - AUTO_BADGE_ACCENT_L_MIN) / AUTO_BADGE_ACCENT_L_STEP)
  const levels: number[] = []
  for (let i = 0; i <= steps; i++) {
    levels.push(AUTO_BADGE_ACCENT_L_MIN + i * AUTO_BADGE_ACCENT_L_STEP)
  }
  if (!levels.some((l) => Math.abs(l - anchorL) < 1e-12)) levels.push(anchorL)

  interface Candidate {
    l: number
    fill: AccentResult
    textColor: string
    textContrast: number
    separation: number | null
  }
  const candidates: Candidate[] = levels.map((l) => {
    const raw = hslToRgb(hue, sat, l)
    const fill = {
      r: clampChannel(raw.r),
      g: clampChannel(raw.g),
      b: clampChannel(raw.b),
    }
    const chosen = chosenTextForFill(fill.r, fill.g, fill.b)
    const fillLum = relativeLuminance(fill.r, fill.g, fill.b)
    return {
      l,
      fill,
      textColor: chosen.color,
      textContrast: chosen.ratio,
      separation: bgLum === null ? null : contrastRatio(fillLum, bgLum),
    }
  })

  const feasibleText = candidates.some((c) => c.textContrast >= AUTO_BADGE_ACCENT_TEXT_CONTRAST)
  const pool = feasibleText
    ? candidates.filter((c) => c.textContrast >= AUTO_BADGE_ACCENT_TEXT_CONTRAST)
    : candidates
  const feasibleSeparation = bgLum !== null &&
    pool.some((c) => (c.separation ?? 0) >= AUTO_BADGE_ACCENT_SEPARATION)

  const distAnchor = (l: number): number => Math.abs(l - anchorL)
  let best: Candidate = pool[0]
  if (!feasibleText) {
    // Best-effort fallback: deterministic best text contrast, then best
    // separation (when context exists), then smallest anchor move.
    for (const c of pool) {
      if (c.textContrast > best.textContrast + 1e-9) { best = c; continue }
      if (Math.abs(c.textContrast - best.textContrast) > 1e-9) continue
      if (bgLum !== null && (c.separation ?? 0) > (best.separation ?? 0) + 1e-9) { best = c; continue }
      if (bgLum !== null && Math.abs((c.separation ?? 0) - (best.separation ?? 0)) > 1e-9) continue
      if (distAnchor(c.l) < distAnchor(best.l) - 1e-12) best = c
      else if (Math.abs(distAnchor(c.l) - distAnchor(best.l)) <= 1e-12 && c.l < best.l) best = c
    }
  } else if (bgLum !== null && !feasibleSeparation) {
    // Text-first: maximize separation among text-safe candidates, then
    // smallest anchor move (predictable policy, documented).
    for (const c of pool) {
      if ((c.separation ?? 0) > (best.separation ?? 0) + 1e-9) { best = c; continue }
      if (Math.abs((c.separation ?? 0) - (best.separation ?? 0)) > 1e-9) continue
      if (distAnchor(c.l) < distAnchor(best.l) - 1e-12) best = c
      else if (Math.abs(distAnchor(c.l) - distAnchor(best.l)) <= 1e-12 && c.l < best.l) best = c
    }
  } else if (bgLum !== null && feasibleSeparation) {
    // Both reachable: closest to anchor among candidates passing both bars.
    const both = pool.filter((c) => (c.separation ?? 0) >= AUTO_BADGE_ACCENT_SEPARATION)
    best = both[0]
    for (const c of both) {
      if (distAnchor(c.l) < distAnchor(best.l) - 1e-12) best = c
      else if (Math.abs(distAnchor(c.l) - distAnchor(best.l)) <= 1e-12 && c.l < best.l) best = c
    }
  } else {
    // No background: closest to anchor among text-safe candidates.
    for (const c of pool) {
      if (distAnchor(c.l) < distAnchor(best.l) - 1e-12) best = c
      else if (Math.abs(distAnchor(c.l) - distAnchor(best.l)) <= 1e-12 && c.l < best.l) best = c
    }
  }

  return {
    color: best.fill,
    diagnostics: {
      l: best.l,
      anchorL,
      textColor: best.textColor,
      textContrast: best.textContrast,
      separation: best.separation,
      feasibleText,
      feasibleSeparation: bgLum === null ? false : feasibleSeparation,
      evaluations: candidates.length,
    },
  }
}

/**
 * RGB-only adaptive automatic accent (foundation only, unwired). See
 * solveAdaptiveAccent for the policy and diagnostics.
 */
export function adaptiveAutomaticAccent(
  color: AccentResult,
  options?: AdaptiveAccentOptions,
): AccentResult {
  return solveAdaptiveAccent(color, options).color
}

/**
 * Hex variant of adaptiveAutomaticAccent (foundation only, unwired).
 * Non-hex or malformed input is returned intact, like
 * normalizeAutomaticAccentHex (never an invented color).
 */
export function adaptiveAutomaticAccentHex(hex: string, options?: AdaptiveAccentOptions): string {
  if (typeof hex !== "string" || !hex.startsWith("#")) return hex
  const [r, g, b, a] = parseColor(hex)
  if (a !== 1 || ![r, g, b].every(Number.isFinite)) return hex
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  const out = adaptiveAutomaticAccent({ r, g, b }, options)
  const to2 = (n: number) => n.toString(16).padStart(2, "0")
  return `#${to2(out.r)}${to2(out.g)}${to2(out.b)}`
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
 * Computes the natural same-hue scene tint for the background blur.
 *
 * Unlike findAccentColor:
 * - NO +150° rotation: preserves the scene's native hue family.
 * - NO fixed-lightness HSL synthesis: returns the unweighted RGB medians of
 *   the winning bucket's valid samples (same sampling, filters and scoring
 *   as analyzeBuckets, just a dedicated second pass). The tint stays
 *   representative of the observed background (light backgrounds → light
 *   tints, dark backgrounds → dark tints) instead of always collapsing to a
 *   fixed depth; scenic darkening stays the renderer's job (blur
 *   shade/blurDarkness, which blends toward this tint along the ramp).
 * - NO saturation/lightness clamping and NO contrast binary search: it must
 *   blend harmoniously into the artwork.
 * - Monochrome fallback: pure GENRE_FALLBACK without pushContrast.
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

  // The winning bucket index is derived from the winner's mean hue
  // (same decision as analyzeBuckets, no re-scoring): the circular mean of
  // an arc < 180° stays inside the arc, so floor(hue / 30) identifies the
  // winning bucket exactly.
  const winnerBucket = Math.floor(analysis.hue / 30) % 12

  // Second pass over the winner's samples only, using the SAME criteria as
  // the analyzeBuckets "scene" branch (frame, step, alpha, s/l thresholds):
  // no arrays for every bucket/mode, cost confined to the scene branch.
  // These criteria must stay in sync with analyzeBuckets.
  const step = 2
  const bx = Math.max(8, Math.floor(width * 0.15))
  const by = Math.max(8, Math.floor(height * 0.15))
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (x >= bx && x < width - bx && y >= by && y < height - by) continue
      const i = (y * width + x) * 4
      const pr = pixels[i], pg = pixels[i + 1], pb = pixels[i + 2]
      const alpha = pixels[i + 3]
      if (alpha < 128) continue

      const r = pr / 255, g = pg / 255, b = pb / 255
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const l = (max + min) / 2, d = max - min
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (s < 0.12 || l < 0.08 || l > 0.94) continue

      const hue = fastHue(r, g, b, d, max)
      if (Math.floor(hue / 30) % 12 !== winnerBucket) continue
      rs.push(pr)
      gs.push(pg)
      bs.push(pb)
    }
  }

  // Guard: with identical criteria the winner always has ≥1 sample, but a
  // degenerate buffer must never produce NaN — genre fallback.
  if (rs.length === 0) {
    const fb = GENRE_FALLBACK[genre] || "#555555"
    const [r, g, b] = parseColor(fb)
    return { r, g, b }
  }

  return {
    r: Math.max(0, Math.min(255, Math.round(medianSorted(rs)))),
    g: Math.max(0, Math.min(255, Math.round(medianSorted(gs)))),
    b: Math.max(0, Math.min(255, Math.round(medianSorted(bs)))),
  }
}

/**
 * Deterministic median: for even counts, the average of the two middle
 * values (no randomness, same input → same output, stable ETags/snapshots).
 */
function medianSorted(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Single-pass client root-color sampling (M3 frontend perf).
 *
 * Fuses `findSceneTint` (scene branch) + `topEdgeAverage` + `bottomEdgeAverage`
 * into ONE loop over the pixel buffer. Output is bit-identical to calling the
 * three functions on the same buffer: tint samples are processed on the same
 * step-2 lattice in the same y-outer/x-inner relative order (so every float
 * accumulation matches exactly), edge strips see every pixel in the same
 * order (integer sums, order-independent), and the winner-bucket median runs
 * over the same multiset in the same insertion order through the same
 * `medianSorted`. The per-bucket RGB aggregates that the old dedicated second
 * pass in `findSceneTint` re-collected are carried through this single pass
 * instead — no second loop over the buffer.
 *
 * The per-sample transcendentals (`Math.pow`, `Math.sin`/`Math.cos`) are kept
 * verbatim for bit-exactness: the win is computing them once per sampled
 * pixel instead of twice (the old path ran the full HSL/weight/hue scoring in
 * both `analyzeBuckets` and the `findSceneTint` second pass).
 *
 * The three fused functions are left untouched: the server render path
 * (`poster-render-helpers.ts`, `custom-colors.ts`) and their pinned unit
 * tests keep reading them.
 */
export interface RootColorSample {
  readonly tint: AccentResult
  readonly top: AccentResult
  readonly bottom: AccentResult
}

export function analyzeRootColors(
  pixels: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  genre: string,
): RootColorSample {
  const step = 2
  // Edge strips: identical geometry to topEdgeAverage/bottomEdgeAverage.
  const rowCount = Math.max(Math.round(height * 0.08), 3)
  let topR = 0, topG = 0, topB = 0, topN = 0
  let botR = 0, botG = 0, botB = 0, botN = 0
  // Tint buckets: same shape as analyzeBuckets, plus the carried per-bucket
  // RGB aggregates that replace the old second pass (winner median below).
  const buckets = Array.from({ length: 12 }, () => ({
    count: 0,
    totalSat: 0,
    hueSin: 0,
    hueCos: 0,
    rs: [] as number[],
    gs: [] as number[],
    bs: [] as number[],
  }))
  // (The scene branch never uses the global luma sums — like findSceneTint,
  // only hue/vibrant stats and the winner bucket feed the tint.)
  let totalVibrantWeight = 0
  // Scene branch samples the frame only (same exclusion as analyzeBuckets).
  const bx = Math.max(8, Math.floor(width * 0.15))
  const by = Math.max(8, Math.floor(height * 0.15))
  for (let y = 0; y < height; y++) {
    const inTop = y < rowCount
    const inBottom = y >= height - rowCount
    const tintRow = y % step === 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      // Edge strips see every pixel (step 1), in the same order as the
      // dedicated functions.
      if (inTop) {
        topR += pixels[i]; topG += pixels[i + 1]; topB += pixels[i + 2]
        topN++
      }
      if (inBottom) {
        botR += pixels[i]; botG += pixels[i + 1]; botB += pixels[i + 2]
        botN++
      }
      // Tint samples see the step-2 lattice only, in the same relative
      // order as the analyzeBuckets scene branch.
      if (!tintRow || x % step !== 0) continue
      if (x >= bx && x < width - bx && y >= by && y < height - by) continue
      const pr = pixels[i], pg = pixels[i + 1], pb = pixels[i + 2]
      const alpha = pixels[i + 3]
      if (alpha < 128) continue

      const r = pr / 255, g = pg / 255, b = pb / 255
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const l = (max + min) / 2, d = max - min
      const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      if (s < 0.12 || l < 0.08 || l > 0.94) continue

      const hue = fastHue(r, g, b, d, max)
      const bucketIdx = Math.floor(hue / 30) % 12
      const bkt = buckets[bucketIdx]
      const weight = Math.pow(s, 1.5) * (1 - l)
      bkt.count += weight
      bkt.totalSat += s * weight
      bkt.hueSin += Math.sin(hue * Math.PI / 180) * weight
      bkt.hueCos += Math.cos(hue * Math.PI / 180) * weight
      totalVibrantWeight += weight
      bkt.rs.push(pr)
      bkt.gs.push(pg)
      bkt.bs.push(pb)
    }
  }

  const top = { r: Math.round(topR / topN), g: Math.round(topG / topN), b: Math.round(topB / topN) }
  const bottom = { r: Math.round(botR / botN), g: Math.round(botG / botN), b: Math.round(botB / botN) }

  if (totalVibrantWeight < 1) {
    const fb = GENRE_FALLBACK[genre] || "#555555"
    const [r, g, b] = parseColor(fb)
    return { tint: { r, g, b }, top, bottom }
  }

  let bestBucket = buckets[0]
  for (const bkt of buckets) {
    if (bkt.count > bestBucket.count) bestBucket = bkt
  }
  const posterHue = ((Math.atan2(bestBucket.hueSin, bestBucket.hueCos) * 180 / Math.PI) % 360 + 360) % 360
  // Winner index derived from the winner's mean hue (same decision as
  // findSceneTint: the circular mean of an arc < 180° stays inside the arc,
  // so floor(hue / 30) identifies the winning bucket exactly — the median
  // runs over that bucket, like the old second pass did.
  const winnerBucket = buckets[Math.floor(posterHue / 30) % 12]
  if (winnerBucket.rs.length === 0) {
    const fb = GENRE_FALLBACK[genre] || "#555555"
    const [r, g, b] = parseColor(fb)
    return { tint: { r, g, b }, top, bottom }
  }
  const tint = {
    r: Math.max(0, Math.min(255, Math.round(medianSorted(winnerBucket.rs)))),
    g: Math.max(0, Math.min(255, Math.round(medianSorted(winnerBucket.gs)))),
    b: Math.max(0, Math.min(255, Math.round(medianSorted(winnerBucket.bs)))),
  }
  return { tint, top, bottom }
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
